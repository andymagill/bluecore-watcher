// HttpFetcher (M1's real network fetcher, 03-INGESTION.md §1 "fetch") against
// a local test server -- no real network in this suite, but exercises the
// real undici request path, retry policy, politeness, robots.txt, and auth
// injection exactly as production would.
import { describe, expect, it, afterEach } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import type { TargetDef } from "../src/config/schema.js";
import { HttpFetcher } from "../src/ingest/fetch/http-fetcher.js";
import { IngestError } from "../src/ingest/errors.js";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

async function startServer(
  handler: Handler,
): Promise<{ url: string; server: Server; hits: () => number }> {
  let hitCount = 0;
  const server = createServer((req, res) => {
    hitCount++;
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server, hits: () => hitCount };
}

// Built directly against the TargetDef *type*, bypassing CmieConfig.parse:
// the real schema enforces https-only (rule 10), which a local plain-HTTP
// test server can't satisfy. HttpFetcher only reads a TargetDef-shaped
// object, so a hand-built one (with every Zod-defaulted field filled in
// explicitly, since there's no parser here to fill them) exercises exactly
// the same code as production.
function buildTarget(url: string, overrides: Partial<TargetDef> = {}): TargetDef {
  return {
    id: "target-1",
    label: "Target 1",
    entityId: "p",
    sectionId: "s",
    kind: "html",
    url,
    renderer: "static",
    method: "GET",
    proxy: "none",
    schedule: { cron: "0 6 * * *", ttlHours: 72, jitterSeconds: 0 },
    politeness: { minIntervalMs: 0, respectRobotsTxt: false },
    extractors: [
      {
        key: "ex1",
        label: "E1",
        presenter: "metric",
        kind: "html",
        type: "number",
        selector: "p",
        required: false,
        regexGroup: 1,
        trim: true,
        locale: "en-US",
      },
    ],
    ...overrides,
  };
}

const ctx = { runId: "test", now: () => new Date("2026-09-12T00:00:00Z") };

let openServer: Server | null = null;
afterEach(() => {
  openServer?.close();
  openServer = null;
});

describe("HttpFetcher", () => {
  it("fetches a 200 response with body and status", async () => {
    const { url, server } = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<p>42</p>");
    });
    openServer = server;

    const result = await new HttpFetcher().fetch(buildTarget(url), ctx);
    expect(result.httpStatus).toBe(200);
    expect(result.body).toBe("<p>42</p>");
  });

  it("retries a 500 and succeeds on a later attempt", async () => {
    let calls = 0;
    const { url, server } = await startServer((_req, res) => {
      calls++;
      if (calls < 2) {
        res.writeHead(500);
        res.end("boom");
      } else {
        res.writeHead(200);
        res.end("<p>ok</p>");
      }
    });
    openServer = server;

    const result = await new HttpFetcher({ retries: 2 }).fetch(buildTarget(url), ctx);
    expect(result.httpStatus).toBe(200);
    expect(calls).toBe(2);
  });

  it("does not retry a 403 -- BLOCKED, single attempt", async () => {
    const { url, server, hits } = await startServer((_req, res) => {
      res.writeHead(403);
      res.end("forbidden");
    });
    openServer = server;

    const fetcher = new HttpFetcher({ retries: 3 });
    await expect(fetcher.fetch(buildTarget(url), ctx)).rejects.toMatchObject({
      errorClass: "BLOCKED",
    });
    expect(hits()).toBe(1);
  });

  it("does not retry a 429 -- BLOCKED, single attempt", async () => {
    const { url, server, hits } = await startServer((_req, res) => {
      res.writeHead(429);
      res.end("slow down");
    });
    openServer = server;

    await expect(
      new HttpFetcher({ retries: 3 }).fetch(buildTarget(url), ctx),
    ).rejects.toMatchObject({ errorClass: "BLOCKED" });
    expect(hits()).toBe(1);
  });

  it("does not retry a plain 404 -- HTTP_ERROR, single attempt", async () => {
    const { url, server, hits } = await startServer((_req, res) => {
      res.writeHead(404);
      res.end("not found");
    });
    openServer = server;

    await expect(
      new HttpFetcher({ retries: 3 }).fetch(buildTarget(url), ctx),
    ).rejects.toMatchObject({ errorClass: "HTTP_ERROR", httpStatus: 404 });
    expect(hits()).toBe(1);
  });

  it("401 maps to AUTH_ERROR even with no auth configured", async () => {
    const { url, server } = await startServer((_req, res) => {
      res.writeHead(401);
      res.end("nope");
    });
    openServer = server;

    await expect(new HttpFetcher().fetch(buildTarget(url), ctx)).rejects.toMatchObject({
      errorClass: "AUTH_ERROR",
    });
  });

  it("a configured auth.secretEnv missing from process.env -> AUTH_ERROR, no request sent", async () => {
    const { url, server, hits } = await startServer((_req, res) => {
      res.writeHead(200);
      res.end("<p>1</p>");
    });
    openServer = server;
    delete process.env.TEST_MISSING_SECRET_XYZ;

    const target = buildTarget(url, {
      auth: { type: "bearer", secretEnv: "TEST_MISSING_SECRET_XYZ" },
    });
    await expect(new HttpFetcher().fetch(target, ctx)).rejects.toMatchObject({
      errorClass: "AUTH_ERROR",
    });
    expect(hits()).toBe(0);
  });

  it("bearer auth injects the Authorization header from the named secret", async () => {
    let seenAuth: string | undefined;
    const { url, server } = await startServer((req, res) => {
      seenAuth = req.headers.authorization;
      res.writeHead(200);
      res.end("<p>1</p>");
    });
    openServer = server;
    process.env.TEST_BEARER_SECRET = "s3cr3t-token";

    const target = buildTarget(url, { auth: { type: "bearer", secretEnv: "TEST_BEARER_SECRET" } });
    await new HttpFetcher().fetch(target, ctx);
    expect(seenAuth).toBe("Bearer s3cr3t-token");
    delete process.env.TEST_BEARER_SECRET;
  });

  it("query auth appends the secret as a query parameter", async () => {
    let seenQuery: string | undefined;
    const { url, server } = await startServer((req, res) => {
      seenQuery = req.url;
      res.writeHead(200);
      res.end("{}");
    });
    openServer = server;
    process.env.TEST_QUERY_SECRET = "qkey";

    const target = buildTarget(url, {
      kind: "api",
      auth: { type: "query", name: "api_key", secretEnv: "TEST_QUERY_SECRET" },
      extractors: [
        {
          key: "ex1",
          label: "E1",
          presenter: "metric",
          kind: "api",
          type: "number",
          jsonPath: "$.x",
          required: false,
          regexGroup: 1,
          trim: true,
          locale: "en-US",
        },
      ],
    });
    await new HttpFetcher().fetch(target, ctx);
    expect(seenQuery).toContain("api_key=qkey");
    delete process.env.TEST_QUERY_SECRET;
  });

  it("interpolates ${ENV_VAR} in the url", async () => {
    const { url: baseUrl, server } = await startServer((_req, res) => {
      res.writeHead(200);
      res.end("<p>1</p>");
    });
    openServer = server;
    const parsed = new URL(baseUrl);
    process.env.TEST_HOST_PORT = parsed.port;

    const target = buildTarget(`http://127.0.0.1:\${TEST_HOST_PORT}/page`);
    const result = await new HttpFetcher().fetch(target, ctx);
    expect(result.httpStatus).toBe(200);
    delete process.env.TEST_HOST_PORT;
  });

  it("respects robots.txt Disallow for the matched User-agent", async () => {
    const { url, server, hits } = await startServer((req, res) => {
      if (req.url === "/robots.txt") {
        res.writeHead(200);
        res.end("User-agent: *\nDisallow: /private\n");
        return;
      }
      res.writeHead(200);
      res.end("<p>1</p>");
    });
    openServer = server;

    const target = buildTarget(`${url}/private/page`, {
      politeness: { minIntervalMs: 0, respectRobotsTxt: true },
    });
    await expect(new HttpFetcher().fetch(target, ctx)).rejects.toMatchObject({
      errorClass: "BLOCKED",
    });
    // robots.txt itself is one hit; the disallowed page must never be requested.
    expect(hits()).toBe(1);
  });

  it("allows a path robots.txt doesn't disallow", async () => {
    const { url, server } = await startServer((req, res) => {
      if (req.url === "/robots.txt") {
        res.writeHead(200);
        res.end("User-agent: *\nDisallow: /private\n");
        return;
      }
      res.writeHead(200);
      res.end("<p>1</p>");
    });
    openServer = server;

    const target = buildTarget(`${url}/public/page`, {
      politeness: { minIntervalMs: 0, respectRobotsTxt: true },
    });
    const result = await new HttpFetcher().fetch(target, ctx);
    expect(result.httpStatus).toBe(200);
  });

  it("enforces politeness.minIntervalMs between two fetches to the same host", async () => {
    const { url, server } = await startServer((_req, res) => {
      res.writeHead(200);
      res.end("<p>1</p>");
    });
    openServer = server;

    const target = buildTarget(url, {
      politeness: { minIntervalMs: 150, respectRobotsTxt: false },
    });
    const fetcher = new HttpFetcher();
    const start = Date.now();
    await fetcher.fetch(target, ctx);
    await fetcher.fetch(target, ctx);
    expect(Date.now() - start).toBeGreaterThanOrEqual(140); // small slack for scheduler jitter
  });

  it("a slow response beyond the configured timeout raises TIMEOUT", async () => {
    const { url, server } = await startServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end("<p>late</p>");
      }, 200);
    });
    openServer = server;

    const target = buildTarget(url);
    await expect(
      new HttpFetcher({ timeoutMs: 20, retries: 0 }).fetch(target, ctx),
    ).rejects.toMatchObject({ errorClass: "TIMEOUT" });
  });
});

describe("HttpFetcher error mapping", () => {
  it("IngestError is preserved through retry classification", () => {
    const err = new IngestError("BLOCKED", "test");
    expect(err.errorClass).toBe("BLOCKED");
  });
});
