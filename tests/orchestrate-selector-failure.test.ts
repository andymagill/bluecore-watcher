// Proves two of M1's exit criteria (docs/07-ROADMAP.md M1) through the real
// runAndPersist pipeline, with a synthetic single-target config (ADR-021 —
// tests stay entity-agnostic; the same style as
// tests/orchestrate-fetch-failure.test.ts's whole-target fetch-failure
// proof, but for a *required-extractor selector* failure, a different code
// path per that file's own comment):
//
//   - "A deliberately broken selector produces a health entry, retains the
//     cached value, and does not reach production."
//   - "A value change produces a correct delta chip, including the
//     unchanged case" -- exercised at the diff/persist level here; the
//     DeltaChip *rendering* of these exact shapes is covered separately by
//     tests/app/delta.test.ts (display layer only, no persist path).
import { describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { CmieConfig, type TargetDef } from "../src/config/schema.js";
import { runAndPersist } from "../src/ingest/orchestrate.js";
import type { Fetcher, FetchResult, RunContext } from "../src/ingest/fetch/types.js";
import type { TargetFile } from "../src/contract/target-file.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(__dirname, "..", "schemas");

const ORIGINAL_HEADLINE = "Original headline";
const NEW_HEADLINE = "Updated headline";

function singleTargetConfig(mutate?: (target: TargetDef) => TargetDef) {
  const parsed = CmieConfig.parse({
    schemaVersion: 1,
    environment: {
      id: "t",
      displayName: "T",
      entities: [{ id: "p", name: "P", role: "primary" }],
    },
    sections: [{ id: "s", label: "S", order: 1 }],
    targets: [
      {
        id: "target-1",
        label: "Target 1",
        entityId: "p",
        sectionId: "s",
        kind: "html",
        url: "https://example.test/page",
        schedule: { cron: "0 6 * * *", ttlHours: 48 },
        extractors: [
          {
            key: "latest_headline",
            label: "Latest Headline",
            presenter: "markdown",
            kind: "html",
            selector: ".card:first .ctitle",
            type: "string",
            required: true,
          },
        ],
      },
    ],
  });
  if (!mutate) return parsed;
  return { ...parsed, targets: [mutate(parsed.targets[0]!)] };
}

function doc(headline: string): string {
  return `<html><body><div class="card"><div class="ctitle">${headline}</div></div></body></html>`;
}

class BodyFetcher implements Fetcher {
  constructor(private readonly getBody: () => string) {}
  async fetch(_target: TargetDef, ctx: RunContext): Promise<FetchResult> {
    return { body: this.getBody(), httpStatus: 200, fetchedAt: ctx.now().toISOString() };
  }
}

function getBlock(tf: TargetFile, key: string) {
  const block = tf.blocks.find((b) => b.key === key);
  if (!block) throw new Error(`block "${key}" not found`);
  return block;
}

describe("a required extractor's selector breaking -- synthetic single target, real pipeline", () => {
  it("retains the entire prior file, with a health entry, per Invariant 1", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "cmie-selector-fail-"));
    try {
      const opts = {
        dataDir,
        fixturesDir: join(dataDir, "unused-fixtures"),
        acknowledgementsPath: join(dataDir, "acknowledgements.json"),
      };

      // Run 1: the selector matches -- establishes a known-good state.
      const first = await runAndPersist(
        {
          ...opts,
          config: singleTargetConfig(),
          runId: "run-1",
          now: () => new Date("2026-09-08T13:00:00Z"),
          fetcher: new BodyFetcher(() => doc(ORIGINAL_HEADLINE)),
        },
        false,
        schemasDir,
      );
      expect(first.gate?.passed).toBe(true);
      const goodTargetFile = first.targetFiles[0]!;
      expect(getBlock(goodTargetFile, "latest_headline").value).toBe(ORIGINAL_HEADLINE);
      expect(goodTargetFile.run.status).toBe("ok");

      // Run 2: latest_headline's selector (required: true) stops matching --
      // e.g. a page redesign. The page itself is unchanged otherwise.
      const brokenConfig = singleTargetConfig((target) => ({
        ...target,
        extractors: target.extractors.map((ex) =>
          ex.key === "latest_headline" && ex.kind === "html"
            ? { ...ex, selector: ".ctitle-DOES-NOT-EXIST" }
            : ex,
        ),
      }));
      const second = await runAndPersist(
        {
          ...opts,
          config: brokenConfig,
          runId: "run-2",
          now: () => new Date("2026-09-09T13:00:00Z"),
          fetcher: new BodyFetcher(() => doc(ORIGINAL_HEADLINE)),
        },
        false,
        schemasDir,
      );

      expect(second.changed).toBe(true); // the health entry itself is a semantic change (ADR-011)
      expect(second.gate?.passed).toBe(true); // a retained cached value is not a gate violation
      const brokenTargetFile = second.targetFiles[0]!;

      // Invariant 1: a failed run never deletes or blanks a previously good
      // value -- and because latest_headline is required, 01-DATA-CONTRACT §3
      // says the *entire* file is retained unchanged except `run`. "Unchanged"
      // is literal: the block's status stays "ok" (what it was in the last
      // successful commit), not re-marked "cached" -- that status is for the
      // different partial-run case (some non-required extractor fails while
      // others in the *same* run still get fresh values).
      expect(brokenTargetFile.run.status).toBe("failed_cached");
      expect(getBlock(brokenTargetFile, "latest_headline").value).toBe(ORIGINAL_HEADLINE);
      expect(getBlock(brokenTargetFile, "latest_headline").status).toBe("ok");

      const healthEntry = second.health.entries.find((e) => e.extractorKey === "latest_headline");
      expect(healthEntry?.errorClass).toBe("SELECTOR_NO_MATCH");
      expect(healthEntry?.status).toBe("failed");

      // The retained value really was written to disk -- "does not reach
      // production" is about the *broken* value, not about withholding the
      // failure record itself (which is exactly what the health entry is for).
      const onDisk = JSON.parse(
        await readFile(join(dataDir, "sections", "s", "target-1.json"), "utf-8"),
      );
      expect(onDisk.blocks.find((b: { key: string }) => b.key === "latest_headline").value).toBe(
        ORIGINAL_HEADLINE,
      );
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("a value change produces delta.changedAt at the moment it changed, then carries it forward untouched while unchanged", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "cmie-selector-delta-"));
    try {
      const config = singleTargetConfig();
      const baseOpts = {
        config,
        dataDir,
        fixturesDir: join(dataDir, "unused-fixtures"),
        acknowledgementsPath: join(dataDir, "acknowledgements.json"),
      };

      // Run 1: first extraction ever -- delta is null (01-DATA-CONTRACT §4).
      const first = await runAndPersist(
        {
          ...baseOpts,
          runId: "r1",
          now: () => new Date("2026-09-08T13:00:00Z"),
          fetcher: new BodyFetcher(() => doc(ORIGINAL_HEADLINE)),
        },
        false,
        schemasDir,
      );
      expect(getBlock(first.targetFiles[0]!, "latest_headline").delta).toBeNull();

      // Run 2: the headline actually changes -- changedAt is set to *this* run's time.
      const second = await runAndPersist(
        {
          ...baseOpts,
          runId: "r2",
          now: () => new Date("2026-09-11T13:00:00Z"),
          fetcher: new BodyFetcher(() => doc(NEW_HEADLINE)),
        },
        false,
        schemasDir,
      );
      const changedBlock = getBlock(second.targetFiles[0]!, "latest_headline");
      expect(changedBlock.value).toBe(NEW_HEADLINE);
      expect(changedBlock.delta).not.toBeNull();
      expect(changedBlock.delta!.changedAt).toBe("2026-09-11T13:00:00.000Z");

      // Run 3: same (updated) content, days later -- ADR-011 says no commit
      // at all, and 01-DATA-CONTRACT §4 says changedAt survives untouched.
      const third = await runAndPersist(
        {
          ...baseOpts,
          runId: "r3",
          now: () => new Date("2026-09-15T13:00:00Z"),
          fetcher: new BodyFetcher(() => doc(NEW_HEADLINE)),
        },
        false,
        schemasDir,
      );
      expect(third.changed).toBe(false);

      // Confirm what's actually committed on disk still reflects run 2's
      // changedAt -- this is exactly what powers "unchanged for N days".
      const onDisk = JSON.parse(
        await readFile(join(dataDir, "sections", "s", "target-1.json"), "utf-8"),
      );
      const onDiskBlock = onDisk.blocks.find((b: { key: string }) => b.key === "latest_headline");
      expect(onDiskBlock.delta.changedAt).toBe("2026-09-11T13:00:00.000Z");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
