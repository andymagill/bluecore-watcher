// M2a "baseline extractor tests" (docs/07-ROADMAP.md M2a: "no
// assertion-tightening beyond obvious schema/range correctness"). One
// table-driven suite over the REAL config, rather than one file per target
// (tests/bluecore-newsroom.integration.test.ts already covers the
// failure/delta *behavior* that would be expensive to duplicate 9x here —
// this suite is deliberately the cheaper, offline extraction-correctness
// layer: does every extractor on every real target still produce exactly
// what fixtures/<id>/expected.json says it should, and does that value pass
// its own configured shape assertions).
//
// A missing expected.json is a hard failure, by design -- that's what
// mechanically enforces "a fixture and unit test per target"
// (docs/07-ROADMAP.md M2 exit criteria) rather than relying on someone
// remembering to add one.
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CmieConfig } from "../src/config/schema.js";
import { config as bluecoreConfig } from "../config/bluecore.config.js";
import { FixtureFetcher } from "../src/ingest/fetch/fixture-fetcher.js";
import { getHandler } from "../src/ingest/extract/registry.js";
import { extractOne, type Candidate } from "../src/ingest/extract/pipeline.js";
import { checkEnum, checkShapeAssertions } from "../src/ingest/validate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const fixturesDir = join(root, "fixtures");

const config = CmieConfig.parse(bluecoreConfig);

describe("target baselines — every real target's extractors match their golden file", () => {
  for (const target of config.targets) {
    describe(target.id, () => {
      it("extracts every extractor and matches fixtures/<id>/expected.json", async () => {
        const goldenPath = join(fixturesDir, target.id, "expected.json");
        let golden: Record<string, Candidate>;
        try {
          golden = JSON.parse(await readFile(goldenPath, "utf-8"));
        } catch {
          throw new Error(
            `No golden file at ${goldenPath} — run "npm run fixture:bless -- --env bluecore ${target.id}" ` +
              `before this target can be considered covered (docs/07-ROADMAP.md M2 exit criteria).`,
          );
        }

        const fetcher = new FixtureFetcher(fixturesDir);
        const fetchResult = await fetcher.fetch(target, {
          runId: "baseline-test",
          now: () => new Date("2026-09-13T00:00:00Z"),
        });
        const handler = getHandler(target.kind);
        const doc = await handler.parse(fetchResult);

        for (const extractor of target.extractors) {
          const candidate = await extractOne(handler, doc, extractor, target);
          expect(
            golden[extractor.key],
            `no golden entry for extractor "${extractor.key}"`,
          ).toBeDefined();
          expect(candidate).toEqual(golden[extractor.key]);
        }
      });

      it("every extracted value passes its own configured shape assertions", async () => {
        const fetcher = new FixtureFetcher(fixturesDir);
        const fetchResult = await fetcher.fetch(target, {
          runId: "baseline-test",
          now: () => new Date("2026-09-13T00:00:00Z"),
        });
        const handler = getHandler(target.kind);
        const doc = await handler.parse(fetchResult);

        for (const extractor of target.extractors) {
          const candidate = await extractOne(handler, doc, extractor, target);
          const shapeFailures = checkShapeAssertions(candidate, extractor);
          expect(
            shapeFailures,
            `"${target.id}.${extractor.key}" failed shape assertions: ${JSON.stringify(shapeFailures)}`,
          ).toEqual([]);

          if (extractor.type === "enum" && candidate.presenter !== "list") {
            const enumFailures = checkEnum(candidate.value as string, extractor);
            expect(
              enumFailures,
              `"${target.id}.${extractor.key}" failed enum check: ${JSON.stringify(enumFailures)}`,
            ).toEqual([]);
          }
        }
      });
    });
  }
});
