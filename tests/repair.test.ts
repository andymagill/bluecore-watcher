// docs/plans/m3-operability.md M3b. Exercises src/repair/relocate.ts and
// src/repair/score.ts against the REAL config/bluecore.config.ts and its
// real fixtures, mutated in memory to simulate a redesign -- the same
// pattern tests/drift.test.ts uses for checkTargetDrift, so a finding here
// means the real repair tooling would see the same thing.
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { CmieConfig, type TargetDef, type ExtractorDef } from "../src/config/schema.js";
import { config as bluecoreConfig } from "../config/bluecore.config.js";
import { getHandler } from "../src/ingest/extract/registry.js";
import { extractOne, type ScalarCandidate } from "../src/ingest/extract/pipeline.js";
import type { Block, ScalarBlock } from "../src/contract/block.js";
import { locatorOf, relocateApi, relocateHtml } from "../src/repair/relocate.js";
import { scoreCandidates } from "../src/repair/score.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const config = CmieConfig.parse(bluecoreConfig);
const NOW = new Date("2026-09-14T00:00:00.000Z");

function realTarget(id: string): TargetDef {
  const target = config.targets.find((t) => t.id === id);
  if (!target) throw new Error(`no such target in config/bluecore.config.ts: ${id}`);
  return target;
}

function realExtractor(target: TargetDef, key: string): ExtractorDef {
  const extractor = target.extractors.find((e) => e.key === key);
  if (!extractor) throw new Error(`no such extractor "${key}" on target "${target.id}"`);
  return extractor;
}

async function fixtureBody(targetId: string, ext: "html" | "json"): Promise<string> {
  return readFile(join(root, "fixtures", targetId, `response.${ext}`), "utf-8");
}

// A previous block built from a real (unmutated) candidate -- exactly what
// process-extractor.ts's `publish()` would have committed.
function blockFromScalarCandidate(candidate: ScalarCandidate, extractor: ExtractorDef): Block {
  const block: ScalarBlock = {
    key: extractor.key,
    label: extractor.label,
    type: extractor.type as ScalarBlock["type"],
    status: "ok",
    presenter: candidate.presenter,
    value: candidate.value,
    displayValue: candidate.displayValue,
    provenance: {
      sourceUrl: "https://example.invalid/x",
      anchor: candidate.anchor,
      extractedAt: NOW.toISOString(),
      rawText: candidate.rawText,
      contentHash: candidate.contentHash,
    },
    delta: null,
    validation: { passed: true, warnings: [] },
  };
  return block;
}

describe("src/repair — newsroom (html, class rename)", () => {
  const target = realTarget("bluecore-newsroom");
  const extractor = realExtractor(target, "latest_headline");
  const handler = getHandler("html");

  it("relocates by the old rawText and ranks the class-based candidate above the positional one", async () => {
    const originalHtml = await fixtureBody("bluecore-newsroom", "html");
    const originalDoc = handler.parse({
      body: originalHtml,
      httpStatus: 200,
      fetchedAt: NOW.toISOString(),
    });
    const originalCandidate = (await extractOne(
      handler,
      originalDoc,
      extractor,
      target,
    )) as ScalarCandidate;
    const previousBlock = blockFromScalarCandidate(originalCandidate, extractor);

    // Simulate a redesign: the field's class is renamed everywhere, exactly
    // like a real Webflow republish would (06-OPS-RUNBOOK.md §3's routine
    // failure).
    const mutatedHtml = originalHtml.replace(/\bbc-n-ctitle\b/g, "bc-n-ctitle-v2");
    const mutatedDoc = handler.parse({
      body: mutatedHtml,
      httpStatus: 200,
      fetchedAt: NOW.toISOString(),
    });

    // The old selector no longer matches.
    expect(() => handler.locate(mutatedDoc as cheerio.CheerioAPI, extractor, target)).not.toThrow();
    expect(handler.locate(mutatedDoc as cheerio.CheerioAPI, extractor, target).matchCount).toBe(0);

    const candidates = relocateHtml(
      mutatedDoc as cheerio.CheerioAPI,
      extractor,
      originalCandidate.rawText,
    );
    expect(candidates.length).toBeGreaterThan(1);

    const scored = await scoreCandidates({
      target,
      extractor,
      handler,
      newDoc: mutatedDoc,
      candidates,
      previousBlock,
      now: NOW,
    });

    expect(scored[0]?.status).toBe("pass");
    expect(scored[0]?.patch).toEqual({ selector: ".bc-n-card:first .bc-n-ctitle-v2" });
    expect(scored[0]?.value).toBe(originalCandidate.value);

    const positionalIndex = scored.findIndex((s) => /nth-of-type/.test(locatorOf(s.patch)));
    expect(positionalIndex).toBeGreaterThan(0);
  });

  it("rejects a candidate that fails its shape assertions, ranking it below a passing one", async () => {
    const categoryExtractor = realExtractor(target, "latest_post_category");
    if (categoryExtractor.kind !== "html") throw new Error("expected an html extractor");
    const originalHtml = await fixtureBody("bluecore-newsroom", "html");
    const doc = handler.parse({
      body: originalHtml,
      httpStatus: 200,
      fetchedAt: NOW.toISOString(),
    });

    const candidates = [
      // The headline text isn't one of the category's enumValues.
      { patch: { selector: ".bc-n-card:first .bc-n-ctitle" }, basis: "wrong node (title text)" },
      { patch: { selector: categoryExtractor.selector }, basis: "original (still works)" },
    ];

    const scored = await scoreCandidates({
      target,
      extractor: categoryExtractor,
      handler,
      newDoc: doc,
      candidates,
      previousBlock: null,
      now: NOW,
    });

    expect(scored[0]?.status).toBe("pass");
    expect(scored[0]?.patch).toEqual({ selector: categoryExtractor.selector });
    const failing = scored.find((s) => locatorOf(s.patch) === ".bc-n-card:first .bc-n-ctitle");
    expect(failing?.status).toBe("assertion-failed");
    expect(failing?.detail).toContain("enumValues");
    expect(scored.indexOf(failing!)).toBeGreaterThan(0);
  });

  it("returns no candidates and nothing passes when the old value is gone entirely", async () => {
    const originalHtml = await fixtureBody("bluecore-newsroom", "html");
    const doc = handler.parse({
      body: originalHtml,
      httpStatus: 200,
      fetchedAt: NOW.toISOString(),
    });

    const candidates = relocateHtml(doc as cheerio.CheerioAPI, extractor, "NONEXISTENT VALUE ZzZ");
    expect(candidates).toHaveLength(0);

    const scored = await scoreCandidates({
      target,
      extractor,
      handler,
      newDoc: doc,
      candidates,
      previousBlock: null,
      now: NOW,
    });
    expect(scored).toHaveLength(0);
  });
});

describe("src/repair — eia (api, moved key)", () => {
  const target = realTarget("eia-ca-industrial-price");
  const extractor = realExtractor(target, "retail_price_industrial");
  const handler = getHandler("api");

  it("relocates a moved jsonPath key by its value and scores it as a pass", async () => {
    const originalJson = JSON.parse(await fixtureBody("eia-ca-industrial-price", "json"));
    const originalCandidate = (await extractOne(
      handler,
      originalJson,
      extractor,
      target,
    )) as ScalarCandidate;

    // Simulate a redesign: the API nests price/period under a new "values"
    // envelope instead of directly on the data-row object.
    const mutated = structuredClone(originalJson);
    const row = mutated.response.data[0];
    row.values = { price: row.price };
    delete row.price;

    const candidates = relocateApi(mutated, extractor, originalCandidate.rawText);
    const wantedPath = "$.response.data[0].values.price";
    expect(candidates.some((c) => locatorOf(c.patch) === wantedPath)).toBe(true);

    const scored = await scoreCandidates({
      target,
      extractor,
      handler,
      newDoc: mutated,
      candidates,
      previousBlock: null,
      now: NOW,
    });

    const best = scored.find((s) => locatorOf(s.patch) === wantedPath);
    expect(best?.status).toBe("pass");
    expect(best?.value).toBe(originalCandidate.value);
  });
});
