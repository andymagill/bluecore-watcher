#!/usr/bin/env tsx
// npm run fixture:capture -- --env <id> <targetId> [--out <dir>]
// npm run fixture:capture -- --env <id> --all [--out <dir>]
// 06-OPS-RUNBOOK.md §3 step 3 / §10 step 2: capture a fresh fixture for one
// target, or every target (M3b, docs/plans/m3-operability.md --
// copilot-setup-steps.yml uses --all --out .runs/live to give the repair
// agent a live snapshot without it ever touching the network itself).
// Reuses the real HttpFetcher (politeness, robots, auth, ${ENV_VAR}
// interpolation) exactly as scripts/ingest.ts --live does -- this is
// deliberately not a second, simpler fetch implementation, so a captured
// fixture always matches what a live --live run would actually have seen.
//
// Without --out, writes fixtures/<targetId>/response.<ext> -- unchanged
// single-target behavior, scrubbed of any active auth.secretEnv value
// first (src/ingest/scrub.ts -- the same scrubbing the persist layer
// applies to committed target files/health entries, reused here rather
// than duplicated). This matters because an authenticated source can echo
// the secret back in its own response body -- confirmed live against
// EIA's v2 API, which echoes `api_key` in `request.params` -- and a
// fixture is committed to Git exactly like any other file. Otherwise
// unformatted/verbatim (.prettierignore excludes fixtures/** on purpose,
// see docs/00-DECISIONS.md). Overwriting an existing fixture prints old vs.
// new byte size so a redesign is visible before it's blessed.
//
// --all captures every target in the config, one at a time; one target's
// fetch failure (e.g. an authenticated source with no key available in
// this environment) is reported and counted, never aborts the rest of the
// loop, and produces a nonzero exit only at the very end.
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { CmieConfig, type TargetDef } from "../src/config/index.js";
import { HttpFetcher } from "../src/ingest/fetch/http-fetcher.js";
import { EXTENSION_BY_KIND } from "../src/ingest/fetch/fixture-fetcher.js";
import { IngestError } from "../src/ingest/errors.js";
import { collectActiveSecretValues, scrubSecrets } from "../src/ingest/scrub.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function usage(): never {
  console.error(
    "Usage: npm run fixture:capture -- --env <environmentId> <targetId> [--out <dir>]\n" +
      "       npm run fixture:capture -- --env <environmentId> --all [--out <dir>]",
  );
  process.exit(2);
}

function getEnvArg(): string {
  const idx = process.argv.indexOf("--env");
  const env = idx !== -1 ? process.argv[idx + 1] : undefined;
  if (!env) usage();
  return env;
}

function getOutArg(): string {
  const idx = process.argv.indexOf("--out");
  if (idx === -1) return "fixtures";
  const out = process.argv[idx + 1];
  if (!out) usage();
  return out;
}

function getPositionalTargetIds(): string[] {
  const args = process.argv.slice(2);
  const flagsWithValue = new Set(["--env", "--out"]);
  const ids: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (flagsWithValue.has(a)) {
      i++;
      continue;
    }
    if (a === "--all") continue;
    if (!a.startsWith("--")) ids.push(a);
  }
  return ids;
}

// Throws (rather than exiting) on any failure, so a --all loop can catch it
// per target and keep going.
async function captureOne(
  target: TargetDef,
  fetcher: HttpFetcher,
  secretValues: string[],
  outDir: string,
): Promise<void> {
  console.log(`Fetching ${target.url} (politeness/robots/auth applied as configured)...`);

  let result;
  try {
    result = await fetcher.fetch(target, { runId: "fixture-capture", now: () => new Date() });
  } catch (err) {
    if (err instanceof IngestError) {
      throw new Error(`Fetch failed for "${target.id}": ${err.errorClass} — ${err.message}`);
    }
    throw err;
  }

  const scrubbedBody = scrubSecrets(result.body, secretValues);
  if (scrubbedBody !== result.body) {
    console.log(
      `${target.id}: the live response echoed an active secret value back to us — redacted before writing to disk.`,
    );
  }

  const ext = EXTENSION_BY_KIND[target.kind];
  const dir = join(outDir, target.id);
  const path = join(dir, `response.${ext}`);

  let previousSize: number | null = null;
  try {
    previousSize = (await readFile(path, "utf-8")).length;
  } catch {
    // No existing fixture at this path -- a first capture, not an overwrite.
  }

  await mkdir(dir, { recursive: true });
  await writeFile(path, scrubbedBody, "utf-8");

  if (previousSize !== null) {
    console.log(
      `Overwrote ${path} (${previousSize} -> ${scrubbedBody.length} bytes). ` +
        `Diff the old and new fixtures before trusting the new one -- a byte-count ` +
        `swing usually means a structural change, not just fresh data.`,
    );
  } else {
    console.log(`Captured ${path} (${scrubbedBody.length} bytes).`);
  }
}

async function main() {
  const envId = getEnvArg();
  const all = process.argv.includes("--all");
  // resolve, not join: an absolute --out must override root, not be
  // concatenated onto it (path.join treats a leading drive/slash as just
  // another segment).
  const outDir = resolve(root, getOutArg());
  const targetIds = getPositionalTargetIds();

  if (all && targetIds.length > 0) usage(); // --all takes no positional target ids
  if (!all && targetIds.length !== 1) usage();

  const mod = await import(pathToFileURL(join(root, "config", `${envId}.config.ts`)).href);
  const config = CmieConfig.parse(mod.config ?? mod.default);

  let targets: TargetDef[];
  if (all) {
    targets = config.targets;
  } else {
    const targetId = targetIds[0]!;
    const target = config.targets.find((t) => t.id === targetId);
    if (!target) {
      console.error(
        `Target "${targetId}" not found in config/${envId}.config.ts. Known ids: ${config.targets.map((t) => t.id).join(", ")}`,
      );
      process.exit(2);
    }
    targets = [target];
  }

  const fetcher = new HttpFetcher(config.defaults);
  const secretValues = collectActiveSecretValues(config);

  let failed = 0;
  for (const target of targets) {
    try {
      await captureOne(target, fetcher, secretValues, outDir);
    } catch (err) {
      failed++;
      console.error((err as Error).message ?? err);
    }
  }

  if (all) {
    console.log(`\n${targets.length - failed}/${targets.length} target(s) captured.`);
  } else if (failed === 0) {
    console.log(`Next: npm run fixture:bless -- ${targets[0]!.id}`);
  }

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
