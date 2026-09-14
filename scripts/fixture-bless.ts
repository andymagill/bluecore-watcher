#!/usr/bin/env tsx
// npm run fixture:bless -- <targetId> [<targetId2> ...] | --all
// Runs the real, offline extraction pipeline (FixtureFetcher -> handler ->
// extractOne, exactly what scripts/fixture-verify.ts asserts against)
// for one or more targets and writes fixtures/<id>/expected.json -- the
// golden file 03-INGESTION.md §5 specifies and fixture-verify.ts
// enforces exists for every target (docs/07-ROADMAP.md M2 "a fixture and
// unit test per target").
//
// Deliberately errors rather than writing anything if extraction throws --
// a golden file must never encode a failure, or a broken selector would
// get pinned as the "expected" result instead of caught.
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { CmieConfig, type TargetDef } from "../src/config/index.js";
import { FixtureFetcher } from "../src/ingest/fetch/fixture-fetcher.js";
import { getHandler } from "../src/ingest/extract/registry.js";
import { extractOne, type Candidate } from "../src/ingest/extract/pipeline.js";
import { IngestError } from "../src/ingest/errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function usage(): never {
  console.error(
    "Usage: npm run fixture:bless -- --env <environmentId> <targetId> [<targetId2> ...]",
  );
  console.error("       npm run fixture:bless -- --env <environmentId> --all");
  process.exit(2);
}

function getEnvArg(): string {
  const idx = process.argv.indexOf("--env");
  const env = idx !== -1 ? process.argv[idx + 1] : undefined;
  if (!env) usage();
  return env;
}

async function blessOne(target: TargetDef, fixturesDir: string): Promise<void> {
  const fetcher = new FixtureFetcher(fixturesDir);
  const fetchResult = await fetcher.fetch(target, {
    runId: "fixture-bless",
    now: () => new Date(),
  });
  const handler = getHandler(target.kind);
  const doc = await handler.parse(fetchResult);

  const expected: Record<string, Candidate> = {};
  for (const extractor of target.extractors) {
    try {
      expected[extractor.key] = await extractOne(handler, doc, extractor, target);
    } catch (err) {
      const detail = err instanceof IngestError ? `${err.errorClass} — ${err.message}` : err;
      throw new Error(
        `Refusing to bless "${target.id}": extractor "${extractor.key}" failed: ${detail}. ` +
          `Fix the selector or the fixture before blessing -- a golden file must never encode a failure.`,
      );
    }
  }

  const path = join(fixturesDir, target.id, "expected.json");
  const serialized = JSON.stringify(expected, null, 2) + "\n";

  let previous: string | null = null;
  try {
    previous = await readFile(path, "utf-8");
  } catch {
    // First bless for this target.
  }

  if (previous === serialized) {
    console.log(`${target.id}: unchanged.`);
    return;
  }
  await writeFile(path, serialized, "utf-8");
  console.log(
    previous === null
      ? `${target.id}: blessed (new).`
      : `${target.id}: blessed (changed -- review the diff).`,
  );
}

async function main() {
  const envId = getEnvArg();
  const all = process.argv.includes("--all");
  const args = process.argv.slice(2);
  const envIdx = args.indexOf("--env");
  const positional = args.filter((a, i) => i !== envIdx && i !== envIdx + 1 && a !== "--all");

  const mod = await import(pathToFileURL(join(root, "config", `${envId}.config.ts`)).href);
  const config = CmieConfig.parse(mod.config ?? mod.default);

  if (!all && positional.length === 0) usage();

  const targets = all
    ? config.targets
    : positional.map((id) => {
        const target = config.targets.find((t) => t.id === id);
        if (!target) {
          console.error(`Target "${id}" not found in config/${envId}.config.ts.`);
          process.exit(2);
        }
        return target;
      });

  const fixturesDir = join(root, "fixtures");
  let failed = false;
  for (const target of targets) {
    try {
      await blessOne(target, fixturesDir);
    } catch (err) {
      failed = true;
      console.error((err as Error).message ?? err);
    }
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
