// The real Fetcher (03-INGESTION.md §1 "fetch"), M1's biggest engine gap:
// undici over the network, honouring politeness/robots/auth/retry exactly as
// documented. One instance per run (constructed fresh in scripts/ingest.ts),
// so its per-host caches are correctly scoped to that run.
import { request } from "undici";
import type { TargetDef, TargetDefaults } from "../../config/schema.js";
import { IngestError } from "../errors.js";
import type { Fetcher, FetchResult, RunContext } from "./types.js";
import { ALLOW_ALL, isDisallowed, parseRobotsTxt, type RobotsRules } from "./robots.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_MIN_INTERVAL_MS = 1_000;
// Generic, source-independent fallback (ADR-001) -- real environments are
// expected to set their own via `defaults.politeness.userAgent` or a
// per-target override, as production config files already do.
const DEFAULT_USER_AGENT = "cmie-ingest-engine/0.1";

// `${ENV_VAR}` in `url`/`headers`/`body` is interpolated at run time only
// (03-INGESTION.md §6) -- never written back to any committed file.
function interpolateEnv(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (match, name: string) => process.env[name] ?? match);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retry only on NETWORK_ERROR, TIMEOUT, and 5xx -- never a 403/429, which
// would turn a BLOCKED signal into a ban (03-INGESTION.md §1 "fetch"). A
// non-5xx HTTP_ERROR (e.g. a plain 404) is a URL-drift signal, not a
// transient failure, so it must not retry either.
function isRetryable(err: unknown): boolean {
  if (!(err instanceof IngestError)) return false;
  if (err.errorClass === "NETWORK_ERROR" || err.errorClass === "TIMEOUT") return true;
  if (err.errorClass === "HTTP_ERROR") return (err.httpStatus ?? 0) >= 500;
  return false;
}

function classifyThrown(err: unknown, url: string): IngestError {
  if (err instanceof IngestError) return err;
  const name = (err as { name?: string })?.name;
  const code =
    (err as { code?: string; cause?: { code?: string } })?.code ??
    (err as { cause?: { code?: string } })?.cause?.code;
  if (
    name === "TimeoutError" ||
    name === "AbortError" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_BODY_TIMEOUT"
  ) {
    return new IngestError("TIMEOUT", `Timed out fetching ${url}`);
  }
  if (
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EAI_AGAIN"
  ) {
    return new IngestError("NETWORK_ERROR", `${code} fetching ${url}`);
  }
  return new IngestError("UNKNOWN", `${(err as Error)?.message ?? String(err)} fetching ${url}`);
}

export class HttpFetcher implements Fetcher {
  private readonly lastFetchAtByHost = new Map<string, number>();
  private readonly robotsCache = new Map<string, Promise<RobotsRules>>();

  constructor(private readonly defaults: TargetDefaults = {}) {}

  async fetch(target: TargetDef, ctx: RunContext): Promise<FetchResult> {
    const url = new URL(interpolateEnv(target.url));
    const politeness = { ...this.defaults.politeness, ...target.politeness };
    const minIntervalMs = politeness.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    const userAgent = politeness.userAgent ?? DEFAULT_USER_AGENT;
    const respectRobotsTxt = politeness.respectRobotsTxt ?? true;

    await this.waitForPoliteness(url.host, minIntervalMs);

    if (respectRobotsTxt) {
      const rules = await this.getRobotsRules(url, userAgent);
      if (isDisallowed(url.pathname, rules)) {
        throw new IngestError(
          "BLOCKED",
          `robots.txt disallows ${url.pathname} for UA "${userAgent}" on ${url.host}`,
        );
      }
    }

    const headers: Record<string, string> = { "user-agent": userAgent };
    for (const [k, v] of Object.entries(target.headers ?? {}))
      headers[k.toLowerCase()] = interpolateEnv(v);

    let requestUrl = url;
    if (target.auth) {
      const secretValue = process.env[target.auth.secretEnv];
      if (!secretValue) {
        // A missing secret skips the target with AUTH_ERROR; it does not
        // fail the whole run (03-INGESTION.md §6).
        throw new IngestError(
          "AUTH_ERROR",
          `Missing secret env var "${target.auth.secretEnv}" for target "${target.id}"`,
        );
      }
      if (target.auth.type === "bearer") {
        headers.authorization = `Bearer ${secretValue}`;
      } else if (target.auth.type === "header") {
        headers[(target.auth.name ?? "x-api-key").toLowerCase()] = secretValue;
      } else {
        requestUrl = new URL(url.toString());
        requestUrl.searchParams.set(target.auth.name ?? "api_key", secretValue);
      }
    }

    const timeoutMs = this.defaults.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = this.defaults.retries ?? DEFAULT_RETRIES;
    const body = target.body !== undefined ? interpolateEnv(target.body) : undefined;

    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.attemptOnce(requestUrl, target.method, headers, body, timeoutMs, ctx);
      } catch (err) {
        lastErr = classifyThrown(err, requestUrl.toString());
        if (!isRetryable(lastErr) || attempt === maxRetries) break;
        await sleep(2 ** attempt * 250);
      }
    }
    throw lastErr;
  }

  private async attemptOnce(
    url: URL,
    method: TargetDef["method"],
    headers: Record<string, string>,
    body: string | undefined,
    timeoutMs: number,
    ctx: RunContext,
  ): Promise<FetchResult> {
    const res = await request(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const status = res.statusCode;

    if (status === 403 || status === 429) {
      throw new IngestError("BLOCKED", `HTTP ${status} for ${url}`, { httpStatus: status });
    }
    if (status === 401) {
      throw new IngestError("AUTH_ERROR", `HTTP 401 for ${url}`, { httpStatus: status });
    }
    if (status >= 400) {
      throw new IngestError("HTTP_ERROR", `HTTP ${status} for ${url}`, { httpStatus: status });
    }
    const text = await res.body.text();
    return { body: text, httpStatus: status, fetchedAt: ctx.now().toISOString() };
  }

  private async waitForPoliteness(host: string, minIntervalMs: number): Promise<void> {
    const last = this.lastFetchAtByHost.get(host);
    const now = Date.now();
    if (last !== undefined) {
      const elapsed = now - last;
      if (elapsed < minIntervalMs) await sleep(minIntervalMs - elapsed);
    }
    this.lastFetchAtByHost.set(host, Date.now());
  }

  private getRobotsRules(url: URL, userAgent: string): Promise<RobotsRules> {
    const cached = this.robotsCache.get(url.host);
    if (cached) return cached;
    const promise = (async () => {
      try {
        const res = await request(new URL("/robots.txt", url.origin), {
          method: "GET",
          headers: { "user-agent": userAgent },
          signal: AbortSignal.timeout(5_000),
        });
        if (res.statusCode !== 200) return ALLOW_ALL;
        return parseRobotsTxt(await res.body.text(), userAgent);
      } catch {
        // A robots.txt fetch failure is not itself a fetch failure for the
        // target -- fail open, matching the common crawler convention.
        return ALLOW_ALL;
      }
    })();
    this.robotsCache.set(url.host, promise);
    return promise;
  }
}
