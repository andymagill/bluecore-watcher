#!/usr/bin/env tsx
// Resolves the Cloudflare Workers Builds preview URL for a given commit,
// per ADR-005's staging note ("a Cloudflare API token, preview-URL
// resolution, and a deploy-ready wait") and ADR-014 (Worker, not Pages).
//
// Recipe proven live against the real bluecore-watcher Worker during M1
// build (2026-09-12) -- the classic `workers/scripts/<name>/deployments`
// API only shows manual "upload" deploys, and the git-integration-specific
// `workers/scripts/<name>/builds` endpoint 401's on a plain
// "Workers Scripts:Edit" token. This avoids both:
//
//   1. Poll GitHub's Check Runs API for the "Workers Builds: <name>" check
//      on the target commit (needs only the Actions-provided GITHUB_TOKEN,
//      already scoped to this repo -- no extra Cloudflare permission).
//   2. Parse the Version ID out of that check's `output.summary` text.
//   3. GET /accounts/<account>/workers/scripts/<name>/versions/<version_id>
//      (works fine on "Workers Scripts:Edit") and read
//      annotations["workers/alias"] -- Cloudflare sets this to the
//      sanitized branch name.
//   4. previewUrl = https://<alias>-<name>.<subdomain>.workers.dev
//      (subdomain via GET /accounts/<account>/workers/subdomain, cached).
//
// Usage: tsx scripts/resolve-preview-url.ts --sha <commit-sha> [--timeout-ms 180000]
// Prints the resolved URL to stdout on success; exits 1 with a message on
// timeout or a failed/errored build.
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const POLL_INTERVAL_MS = 10_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

// wrangler.jsonc's "name" is the deploy-time source of truth for the Worker
// name -- read it rather than restating it here, so a rename can't silently
// desync this script from the config that actually deploys it. wrangler.jsonc
// is JSONC (line comments only, no "//" inside any string value), so a
// line-level strip is sufficient without pulling in a JSONC parser.
async function readWorkerName(): Promise<string> {
  const path = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
  const raw = await readFile(path, "utf-8");
  const stripped = raw
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  const match = (JSON.parse(stripped) as { name?: string }).name;
  if (!match) throw new Error(`wrangler.jsonc has no "name" field (resolved path: ${path})`);
  return match;
}

async function githubJson<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API ${path} returned ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function cloudflareJson<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as { success: boolean; result: T; errors: unknown[] };
  if (!res.ok || !body.success)
    throw new Error(
      `Cloudflare API ${path} returned ${res.status}: ${JSON.stringify(body.errors)}`,
    );
  return body.result;
}

interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  output: { summary: string | null };
}

async function waitForBuildCheck(
  repo: string,
  sha: string,
  token: string,
  deadline: number,
  workerName: string,
): Promise<CheckRun> {
  const checkName = `Workers Builds: ${workerName}`;
  for (;;) {
    const { check_runs } = await githubJson<{ check_runs: CheckRun[] }>(
      `/repos/${repo}/commits/${sha}/check-runs`,
      token,
    );
    const check = check_runs.find((c) => c.name === checkName);
    if (check && check.status === "completed") return check;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for "${checkName}" check run on ${sha} (last seen: ${check ? check.status : "not yet reported"})`,
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

// Pure, unit-testable pieces -- exported so tests/resolve-preview-url.test.ts
// can prove the parsing/construction logic without mocking three chained
// network calls. The network orchestration itself was proven live against
// the real repo/Worker during M1 build (2026-09-12).
export function parseVersionId(summary: string | null): string {
  const match = summary?.match(/Version ID:\s*([0-9a-f-]+)/i);
  if (!match)
    throw new Error(`Could not find a Version ID in the build check's summary: ${summary}`);
  return match[1]!;
}

export function buildPreviewUrl(alias: string, workerName: string, subdomain: string): string {
  return `https://${alias}-${workerName}.${subdomain}.workers.dev`;
}

async function main() {
  const sha = getArg("--sha");
  if (!sha) {
    console.error(
      "Usage: tsx scripts/resolve-preview-url.ts --sha <commit-sha> [--timeout-ms 180000] [--worker-name <name>]",
    );
    process.exit(2);
  }
  const timeoutMs = Number(getArg("--timeout-ms") ?? 180_000);
  const workerName = getArg("--worker-name") ?? (await readWorkerName());

  const githubToken = requireEnv("GITHUB_TOKEN");
  const cfToken = requireEnv("CLOUDFLARE_API_TOKEN");
  const cfAccount = requireEnv("CLOUDFLARE_ACCOUNT_ID");
  const repo = requireEnv("GITHUB_REPOSITORY"); // "<owner>/<repo>", set by Actions

  const deadline = Date.now() + timeoutMs;

  const check = await waitForBuildCheck(repo, sha, githubToken, deadline, workerName);
  if (check.conclusion !== "success") {
    throw new Error(
      `Workers Builds check concluded "${check.conclusion}" for ${sha} -- build failed, no preview to gate against`,
    );
  }

  const versionId = parseVersionId(check.output.summary);

  const version = await cloudflareJson<{ annotations?: Record<string, string> }>(
    `/accounts/${cfAccount}/workers/scripts/${workerName}/versions/${versionId}`,
    cfToken,
  );
  const alias = version.annotations?.["workers/alias"];
  if (!alias)
    throw new Error(
      `Version ${versionId} has no "workers/alias" annotation -- cannot resolve a preview URL`,
    );

  const { subdomain } = await cloudflareJson<{ subdomain: string }>(
    `/accounts/${cfAccount}/workers/subdomain`,
    cfToken,
  );

  const previewUrl = buildPreviewUrl(alias, workerName, subdomain);
  console.log(previewUrl);
}

// Guarded so tests can import parseVersionId/buildPreviewUrl above without
// triggering main() (which would otherwise run immediately on import and
// exit the test process looking for a --sha it was never given).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
