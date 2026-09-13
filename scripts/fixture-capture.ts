#!/usr/bin/env tsx
// npm run fixture:capture -- --env <id> <targetId>
// 06-OPS-RUNBOOK.md §3 step 3 / §8 step 2: capture a fresh fixture for one
// target. Reuses the real HttpFetcher (politeness, robots, auth, ${ENV_VAR}
// interpolation) exactly as scripts/ingest.ts --live does -- this is
// deliberately not a second, simpler fetch implementation, so a captured
// fixture always matches what a live --live run would actually have seen.
//
// Writes fixtures/<targetId>/response.<ext> verbatim (no formatting --
// .prettierignore excludes fixtures/** on purpose, see docs/00-DECISIONS.md).
// Overwriting an existing fixture prints old vs. new byte size so a
// redesign is visible before it's blessed.
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { CmieConfig } from "../src/config/index.js";
import { HttpFetcher } from "../src/ingest/fetch/http-fetcher.js";
import { EXTENSION_BY_KIND } from "../src/ingest/fetch/fixture-fetcher.js";
import { IngestError } from "../src/ingest/errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function usage(): never {
  console.error("Usage: npm run fixture:capture -- --env <environmentId> <targetId>");
  process.exit(2);
}

function getEnvArg(): string {
  const idx = process.argv.indexOf("--env");
  const env = idx !== -1 ? process.argv[idx + 1] : undefined;
  if (!env) usage();
  return env;
}

function getTargetIdArg(): string {
  // The one positional argument: whatever's left after `--env <id>` and the
  // node/tsx/script argv entries.
  const args = process.argv.slice(2);
  const envIdx = args.indexOf("--env");
  const positional = args.filter((_, i) => i !== envIdx && i !== envIdx + 1);
  const targetId = positional[0];
  if (!targetId) usage();
  return targetId;
}

async function main() {
  const envId = getEnvArg();
  const targetId = getTargetIdArg();

  const mod = await import(pathToFileURL(join(root, "config", `${envId}.config.ts`)).href);
  const config = CmieConfig.parse(mod.config ?? mod.default);

  const target = config.targets.find((t) => t.id === targetId);
  if (!target) {
    console.error(
      `Target "${targetId}" not found in config/${envId}.config.ts. Known ids: ${config.targets.map((t) => t.id).join(", ")}`,
    );
    process.exit(2);
  }

  const fetcher = new HttpFetcher(config.defaults);
  console.log(`Fetching ${target.url} (politeness/robots/auth applied as configured)...`);

  let result;
  try {
    result = await fetcher.fetch(target, { runId: "fixture-capture", now: () => new Date() });
  } catch (err) {
    if (err instanceof IngestError) {
      console.error(`Fetch failed: ${err.errorClass} — ${err.message}`);
    } else {
      console.error(err);
    }
    process.exit(1);
  }

  const ext = EXTENSION_BY_KIND[target.kind];
  const dir = join(root, "fixtures", target.id);
  const path = join(dir, `response.${ext}`);

  let previousSize: number | null = null;
  try {
    previousSize = (await readFile(path, "utf-8")).length;
  } catch {
    // No existing fixture -- this is a first capture, not an overwrite.
  }

  await mkdir(dir, { recursive: true });
  await writeFile(path, result.body, "utf-8");

  if (previousSize !== null) {
    console.log(
      `Overwrote ${path} (${previousSize} -> ${result.body.length} bytes). ` +
        `Diff the old and new fixtures before trusting the new one -- a byte-count ` +
        `swing usually means a structural change, not just fresh data.`,
    );
  } else {
    console.log(`Captured ${path} (${result.body.length} bytes).`);
  }
  console.log(`Next: npm run fixture:bless -- ${target.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
