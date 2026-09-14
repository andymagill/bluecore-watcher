#!/usr/bin/env tsx
// npm run fixture:verify -- --env <environmentId>
// Runs the real, offline extraction pipeline (FixtureFetcher -> handler ->
// extractOne) for every target in the given environment's config and
// diffs the result against fixtures/<id>/expected.json — the golden file
// `npm run fixture:bless` writes and 03-INGESTION.md §5 specifies.
//
// Replaces tests/targets.baseline.test.ts (removed per ADR-021 — vitest
// stays entity-agnostic; per-environment regression checks like this one
// live in the ops layer instead). A missing golden file is a hard failure
// by design, same as before: it's what mechanically enforces "a fixture
// and unit test per target" (docs/07-ROADMAP.md M2 exit criteria) rather
// than relying on someone remembering to add one.
import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CmieConfig } from "../src/config/index.js";
import { FixtureFetcher } from "../src/ingest/fetch/fixture-fetcher.js";
import { getHandler } from "../src/ingest/extract/registry.js";
import { extractOne, type Candidate } from "../src/ingest/extract/pipeline.js";
import { IngestError } from "../src/ingest/errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function usage(): never {
  console.error("Usage: npm run fixture:verify -- --env <environmentId>");
  process.exit(2);
}

function getEnvArg(): string {
  const idx = process.argv.indexOf("--env");
  const env = idx !== -1 ? process.argv[idx + 1] : undefined;
  if (!env) usage();
  return env;
}

async function main() {
  const envId = getEnvArg();
  const mod = await import(pathToFileURL(join(root, "config", `${envId}.config.ts`)).href);
  const config = CmieConfig.parse(mod.config ?? mod.default);
  const fixturesDir = join(root, "fixtures");

  let failed = false;

  for (const target of config.targets) {
    const goldenPath = join(fixturesDir, target.id, "expected.json");
    let golden: Record<string, Candidate>;
    try {
      golden = JSON.parse(await readFile(goldenPath, "utf-8"));
    } catch {
      failed = true;
      console.error(
        `${target.id}: no golden file at ${goldenPath} — run ` +
          `"npm run fixture:bless -- --env ${envId} ${target.id}" before this target can be considered covered.`,
      );
      continue;
    }

    try {
      const fetcher = new FixtureFetcher(fixturesDir);
      const fetchResult = await fetcher.fetch(target, {
        runId: "fixture-verify",
        now: () => new Date(),
      });
      const handler = getHandler(target.kind);
      const doc = await handler.parse(fetchResult);

      let targetFailed = false;
      for (const extractor of target.extractors) {
        const candidate = await extractOne(handler, doc, extractor, target);
        const goldenCandidate = golden[extractor.key];
        if (goldenCandidate === undefined) {
          targetFailed = true;
          console.error(`${target.id}.${extractor.key}: no golden entry — re-bless.`);
          continue;
        }
        if (!isDeepStrictEqual(candidate, goldenCandidate)) {
          targetFailed = true;
          console.error(
            `${target.id}.${extractor.key}: extraction no longer matches fixtures/${target.id}/expected.json.\n` +
              `  expected: ${JSON.stringify(goldenCandidate)}\n` +
              `  actual:   ${JSON.stringify(candidate)}`,
          );
        }
      }
      if (targetFailed) {
        failed = true;
      } else {
        console.log(`${target.id}: ok.`);
      }
    } catch (err) {
      failed = true;
      const detail = err instanceof IngestError ? `${err.errorClass} — ${err.message}` : err;
      console.error(`${target.id}: extraction threw: ${detail}`);
    }
  }

  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
