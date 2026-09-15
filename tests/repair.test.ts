// docs/plans/m3-operability.md M3b. Exercises src/repair/relocate.ts and
// src/repair/score.ts against synthetic targets and fixtures, mutated in
// memory to simulate a redesign (ADR-021 — tests stay entity-agnostic; the
// same pattern tests/drift.test.ts uses for checkTargetDrift). A finding
// here means the real repair tooling, run through scripts/repair-diff.ts
// against whatever config an operator points it at, would see the same
// thing — relocateHtml/relocateApi/scoreCandidates take no config-specific
// input beyond a TargetDef/ExtractorDef.
import { describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import { CmieConfig, type TargetDef, type ExtractorDef } from "../src/config/schema.js";
import { getHandler } from "../src/ingest/extract/registry.js";
import { extractOne, type ScalarCandidate } from "../src/ingest/extract/pipeline.js";
import type { Block, ScalarBlock } from "../src/contract/block.js";
import { locatorOf, relocateApi, relocateHtml } from "../src/repair/relocate.js";
import { scoreCandidates } from "../src/repair/score.js";

const NOW = new Date("2026-09-14T00:00:00.000Z");

function targetWith(kind: "html" | "api", extractors: unknown[]): TargetDef {
  return CmieConfig.parse({
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
        kind,
        url: "https://example.test/page",
        schedule: { cron: "0 6 * * *", ttlHours: 48 },
        extractors,
      },
    ],
  }).targets[0]!;
}

function extractorOf(target: TargetDef, key: string): ExtractorDef {
  const extractor = target.extractors.find((e) => e.key === key);
  if (!extractor) throw new Error(`no such extractor "${key}" on target "${target.id}"`);
  return extractor;
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

describe("src/repair — html (card list, class rename)", () => {
  const target = targetWith("html", [
    {
      key: "latest_headline",
      label: "Latest Headline",
      presenter: "markdown",
      kind: "html",
      selector: ".card:first .ctitle",
      type: "string",
      required: true,
    },
    {
      key: "latest_category",
      label: "Latest Category",
      presenter: "status",
      kind: "html",
      selector: ".card:first .cat-key",
      type: "enum",
      enumValues: ["Press Release", "Insights"],
      required: false,
    },
  ]);
  const extractor = extractorOf(target, "latest_headline");
  const handler = getHandler("html");

  function cardListDoc(cards: string[]): string {
    return `<html><body><div class="list-grid">${cards.join("")}</div></body></html>`;
  }
  function card(headline: string, category: string): string {
    return (
      `<a class="card"><div class="cat-key">${category}</div>` +
      `<div class="ctitle">${headline}</div></a>`
    );
  }

  it("relocates by the old rawText and ranks the class-based candidate above the positional one", async () => {
    // Both cards share the same category text so the preceding-sibling-text
    // relocation candidate (`*:contains("Press Release") + .ctitle-v2`)
    // resolves to matchCount 2, not 1 -- it's a real candidate the scorer
    // considers, it just shouldn't beat the ancestor-scoped one on a page
    // where the label text isn't unique to one card.
    const originalHtml = cardListDoc([
      card("First post", "Press Release"),
      card("Second post", "Press Release"),
    ]);
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
    // like a real CMS republish would (06-OPS-RUNBOOK.md §3's routine
    // failure).
    const mutatedHtml = originalHtml.replace(/\bctitle\b/g, "ctitle-v2");
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
    expect(scored[0]?.patch).toEqual({ selector: ".card:first .ctitle-v2" });
    expect(scored[0]?.value).toBe(originalCandidate.value);

    const positionalIndex = scored.findIndex((s) => /nth-of-type/.test(locatorOf(s.patch)));
    expect(positionalIndex).toBeGreaterThan(0);
  });

  it("rejects a candidate that fails its shape assertions, ranking it below a passing one", async () => {
    const categoryExtractor = extractorOf(target, "latest_category");
    if (categoryExtractor.kind !== "html") throw new Error("expected an html extractor");
    const originalHtml = cardListDoc([
      card("First post", "Press Release"),
      card("Second post", "Insights"),
    ]);
    const doc = handler.parse({
      body: originalHtml,
      httpStatus: 200,
      fetchedAt: NOW.toISOString(),
    });

    const candidates = [
      // The headline text isn't one of the category's enumValues.
      { patch: { selector: ".card:first .ctitle" }, basis: "wrong node (title text)" },
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
    const failing = scored.find((s) => locatorOf(s.patch) === ".card:first .ctitle");
    expect(failing?.status).toBe("assertion-failed");
    expect(failing?.detail).toContain("enumValues");
    expect(scored.indexOf(failing!)).toBeGreaterThan(0);
  });

  it("returns no candidates and nothing passes when the old value is gone entirely", async () => {
    const originalHtml = cardListDoc([
      card("First post", "Press Release"),
      card("Second post", "Insights"),
    ]);
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

describe("src/repair — api (moved key)", () => {
  const target = targetWith("api", [
    {
      key: "retail_price",
      label: "Retail Price",
      presenter: "metric",
      kind: "api",
      jsonPath: "$.response.data[0].price",
      type: "number",
      required: true,
    },
  ]);
  const extractor = extractorOf(target, "retail_price");
  const handler = getHandler("api");

  it("relocates a moved jsonPath key by its value and scores it as a pass", async () => {
    const originalJson = { response: { data: [{ price: 42.5, period: "2026-08" }] } };
    const originalCandidate = (await extractOne(
      handler,
      originalJson,
      extractor,
      target,
    )) as ScalarCandidate;

    // Simulate a redesign: the API nests price under a new "values"
    // envelope instead of directly on the data-row object.
    const mutated = structuredClone(originalJson) as {
      response: { data: { price?: number; values?: { price: number } }[] };
    };
    const row = mutated.response.data[0]!;
    row.values = { price: row.price! };
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

// ADR-022 — a composite/indexed api location has no single locator to
// relocate by value match or patch onto; both relocate.ts and score.ts
// decline rather than silently producing an invalid, mutually-exclusive
// extractor shape (a jsonPath patched onto an extractor that still carries
// fields/template/index).
describe("src/repair — composite/indexed api locations are unsupported (ADR-022)", () => {
  const target = targetWith("api", [
    {
      key: "latest_b",
      label: "Latest B",
      presenter: "markdown",
      kind: "api",
      type: "markdown",
      index: { jsonPath: '$.rows.form[?(@ === "B")]~', pick: "first" },
      fields: { amount: { jsonPath: "$.rows.amount[{index}]" } },
      template: "{amount}",
    },
  ]);
  const extractor = extractorOf(target, "latest_b");
  const handler = getHandler("api");

  it("relocateApi declines to propose candidates", () => {
    const doc = { rows: { form: ["A", "B"], amount: [1, 2] } };
    expect(relocateApi(doc, extractor, "2")).toEqual([]);
  });

  it("scoreCandidates reports an explicit unsupported status instead of scoring a patch", async () => {
    const doc = { rows: { form: ["A", "B"], amount: [1, 2] } };
    const scored = await scoreCandidates({
      target,
      extractor,
      handler,
      newDoc: doc,
      candidates: [],
      previousBlock: null,
      now: NOW,
    });
    expect(scored).toHaveLength(1);
    expect(scored[0]?.status).toBe("unsupported");
    expect(scored[0]?.detail).toMatch(/composite\/indexed api location/);
  });
});
