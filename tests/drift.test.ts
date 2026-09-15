// 03-INGESTION.md §5 "weekly drift check" / docs/07-ROADMAP.md M2b.
// checkTargetDrift is exercised against synthetic targets and fixtures
// (ADR-021 — tests stay entity-agnostic; real-config drift behavior is
// verified live by scripts/drift-check.ts, which reuses this same module).
// The HTML case builds a small document shaped like a generic "card list"
// page; the API cases build small literal JSON envelopes shaped like the
// edge cases a redesign actually produces — a key removed, a field's type
// changed, an envelope wrapped around the whole body — rather than
// string-surgery on a real page export.
import { describe, expect, it } from "vitest";
import { CmieConfig, type TargetDef } from "../src/config/schema.js";
import {
  checkTargetDrift,
  fetchFailedResult,
  isDrifting,
  type TargetDriftResult,
} from "../src/drift/check.js";
import { planIssueSync, type OpenDriftIssue } from "../src/drift/issues.js";
import type { FetchResult } from "../src/ingest/fetch/types.js";

function asFetchResult(body: string): FetchResult {
  return { body, httpStatus: 200, fetchedAt: "2026-09-13T00:00:00.000Z" };
}

// `extractors` is typed `unknown[]` rather than `ExtractorDef[]` so callers
// can pass a discriminated-union literal without fighting the output type's
// defaulted fields (regexGroup/trim/locale) — CmieConfig.parse validates the
// real shape at runtime regardless.
function baseTarget(kind: "html" | "api", extractors: unknown[]): TargetDef {
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

// A small, hand-built document shaped like a generic "card list" page:
// three cards, each carrying a title/date/category, matching the
// ".card:first <field>" selector-scoping convention (M2b's fix).
function cardListDoc(cards: string[]): string {
  return `<html><body><div class="list-grid">${cards.join("")}</div></body></html>`;
}

function card(headline: string, date: string, category: string): string {
  return (
    `<a class="card"><div class="cat-key">${category}</div>` +
    `<div class="cdate">${date}</div><div class="ctitle">${headline}</div></a>`
  );
}

describe("checkTargetDrift — html (card-list-shaped, selector-matched)", () => {
  const cardListTarget = baseTarget("html", [
    {
      key: "latest_headline",
      label: "Latest Headline",
      presenter: "markdown",
      kind: "html",
      selector: ".card:first .ctitle",
      type: "string",
      required: true,
    },
  ]);
  const baselineDoc = cardListDoc([
    card("First post", "September 8, 2026", "Press Release"),
    card("Second post", "August 1, 2026", "Insights"),
  ]);

  it("identical baseline and live: clean", async () => {
    const result = await checkTargetDrift(
      cardListTarget,
      asFetchResult(baselineDoc),
      asFetchResult(baselineDoc),
    );
    expect(isDrifting(result)).toBe(false);
  });

  it("a renamed class breaks extraction: EXTRACTION_BROKEN on that extractor", async () => {
    const live = baselineDoc.replaceAll("ctitle", "ctitle-v2");
    const result = await checkTargetDrift(
      cardListTarget,
      asFetchResult(baselineDoc),
      asFetchResult(live),
    );
    expect(
      result.signals.some(
        (s) => s.code === "EXTRACTION_BROKEN" && s.extractorKey === "latest_headline",
      ),
    ).toBe(true);
  });

  it("a new card prepended (new content, same structure): clean", async () => {
    const live = cardListDoc([
      card("Brand new post", "September 20, 2026", "Press Release"),
      card("First post", "September 8, 2026", "Press Release"),
      card("Second post", "August 1, 2026", "Insights"),
    ]);
    const result = await checkTargetDrift(
      cardListTarget,
      asFetchResult(baselineDoc),
      asFetchResult(live),
    );
    expect(isDrifting(result)).toBe(false);
  });

  it("an extra wrapper div around the card list: ANCHOR_MOVED", async () => {
    const live = baselineDoc
      .replace('<div class="list-grid">', '<div class="list-grid"><div class="redesign-wrapper">')
      .replace("</div></body>", "</div></div></body>");
    const result = await checkTargetDrift(
      cardListTarget,
      asFetchResult(baselineDoc),
      asFetchResult(live),
    );
    expect(result.signals.some((s) => s.code === "ANCHOR_MOVED")).toBe(true);
  });
});

describe("checkTargetDrift — api (synthetic envelopes)", () => {
  const countTarget = baseTarget("api", [
    {
      key: "document_count",
      label: "Document Count",
      presenter: "metric",
      kind: "api",
      jsonPath: "$.count",
      type: "number",
      required: true,
    },
  ]);
  // Enough baseline key-paths that adding one unrelated field stays a small
  // proportional change (jaccardSimilarity stays above the 0.8 threshold) —
  // a 2-key object would let one new field alone read as STRUCTURE_CHANGED.
  const countBaseline = JSON.stringify({
    count: 12,
    total_pages: 1,
    results: [
      {
        id: "a",
        title: "First",
        type: "Notice",
        publication_date: "2026-09-08",
        agencies: [{ name: "Example Agency" }],
      },
    ],
  });

  it("identical baseline and live: clean", async () => {
    const result = await checkTargetDrift(
      countTarget,
      asFetchResult(countBaseline),
      asFetchResult(countBaseline),
    );
    expect(isDrifting(result)).toBe(false);
  });

  it("`count` removed from the response: EXTRACTION_BROKEN", async () => {
    const parsed = JSON.parse(countBaseline) as Record<string, unknown>;
    delete parsed.count;
    const live = JSON.stringify(parsed);
    const result = await checkTargetDrift(
      countTarget,
      asFetchResult(countBaseline),
      asFetchResult(live),
    );
    expect(
      result.signals.some(
        (s) => s.code === "EXTRACTION_BROKEN" && s.extractorKey === "document_count",
      ),
    ).toBe(true);
  });

  it("results[0] gains an unrelated optional field: clean", async () => {
    const parsed = JSON.parse(countBaseline) as { results: Record<string, unknown>[] };
    parsed.results[0]!.some_new_optional_field = "unrelated";
    const live = JSON.stringify(parsed);
    const result = await checkTargetDrift(
      countTarget,
      asFetchResult(countBaseline),
      asFetchResult(live),
    );
    expect(isDrifting(result)).toBe(false);
  });

  const formTarget = baseTarget("api", [
    {
      key: "latest_filing_form",
      label: "Latest Filing Form",
      presenter: "markdown",
      kind: "api",
      jsonPath: "$.filings.recent.form[0]",
      type: "string",
      required: true,
    },
  ]);
  const formBaseline = JSON.stringify({ filings: { recent: { form: ["424B5", "8-K"] } } });

  it("form[0] changes from string to number: TYPE_CHANGED", async () => {
    const parsed = JSON.parse(formBaseline) as { filings: { recent: { form: unknown[] } } };
    parsed.filings.recent.form[0] = 424;
    const live = JSON.stringify(parsed);
    const result = await checkTargetDrift(
      formTarget,
      asFetchResult(formBaseline),
      asFetchResult(live),
    );
    expect(
      result.signals.some(
        (s) => s.code === "TYPE_CHANGED" && s.extractorKey === "latest_filing_form",
      ),
    ).toBe(true);
  });

  it("the whole body gets wrapped in a new envelope: STRUCTURE_CHANGED", async () => {
    const live = JSON.stringify({ data: JSON.parse(formBaseline) });
    const result = await checkTargetDrift(
      formTarget,
      asFetchResult(formBaseline),
      asFetchResult(live),
    );
    expect(result.signals.some((s) => s.code === "STRUCTURE_CHANGED")).toBe(true);
  });

  // ADR-022 — a composite location's TYPE_CHANGED check re-resolves `index`
  // (and so each field's `{index}`-substituted path) independently against
  // baseline and live, same as a real run resolves it fresh each time.
  const compositeTarget = baseTarget("api", [
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
  const compositeBaseline = JSON.stringify({
    rows: { form: ["A", "B"], amount: [1, 2] },
  });

  it("a composite field's resolved value changes from number to string: TYPE_CHANGED", async () => {
    const parsed = JSON.parse(compositeBaseline) as { rows: { amount: unknown[] } };
    parsed.rows.amount[1] = "2"; // still index 1 ("B" unmoved) -- just a type change
    const live = JSON.stringify(parsed);
    const result = await checkTargetDrift(
      compositeTarget,
      asFetchResult(compositeBaseline),
      asFetchResult(live),
    );
    expect(
      result.signals.some(
        (s) =>
          s.code === "TYPE_CHANGED" &&
          s.extractorKey === "latest_b" &&
          s.message.includes('field "amount"'),
      ),
    ).toBe(true);
  });

  it("a composite field stays the same JS type even when the index moves: clean", async () => {
    // "B" moves from index 1 to index 0 -- the resolved path changes, but the
    // underlying value's JS type (number) doesn't, so this isn't drift.
    const live = JSON.stringify({ rows: { form: ["B", "A"], amount: [2, 1] } });
    const result = await checkTargetDrift(
      compositeTarget,
      asFetchResult(compositeBaseline),
      asFetchResult(live),
    );
    expect(isDrifting(result)).toBe(false);
  });
});

describe("fetchFailedResult / isDrifting", () => {
  it("a fetch-failed-only result never counts as drifting", () => {
    const result = fetchFailedResult("some-target", "NETWORK_ERROR: timed out");
    expect(isDrifting(result)).toBe(false);
    expect(result.signals).toEqual([
      { code: "FETCH_FAILED", extractorKey: null, message: "NETWORK_ERROR: timed out" },
    ]);
  });
});

describe("planIssueSync", () => {
  function drifting(targetId: string): TargetDriftResult {
    return {
      targetId,
      signals: [{ code: "EXTRACTION_BROKEN", extractorKey: "x", message: "broke" }],
    };
  }
  function clean(targetId: string): TargetDriftResult {
    return { targetId, signals: [] };
  }

  it("creates an issue for a newly-drifting target with none open", () => {
    const actions = planIssueSync([drifting("a")], []);
    expect(actions).toEqual([{ type: "create", targetId: "a", body: expect.any(String) }]);
  });

  it("comments on an already-open issue for a still-drifting target", () => {
    const open: OpenDriftIssue[] = [{ targetId: "a", number: 42 }];
    const actions = planIssueSync([drifting("a")], open);
    expect(actions).toEqual([
      { type: "comment", targetId: "a", number: 42, body: expect.any(String) },
    ]);
  });

  it("closes an open issue once the target comes back clean", () => {
    const open: OpenDriftIssue[] = [{ targetId: "a", number: 42 }];
    const actions = planIssueSync([clean("a")], open);
    expect(actions).toEqual([
      { type: "close", targetId: "a", number: 42, body: expect.any(String) },
    ]);
  });

  it("does nothing for a clean target with no open issue", () => {
    expect(planIssueSync([clean("a")], [])).toEqual([]);
  });

  it("leaves an open issue untouched when the check only fetch-failed", () => {
    const open: OpenDriftIssue[] = [{ targetId: "a", number: 42 }];
    const actions = planIssueSync([fetchFailedResult("a", "timed out")], open);
    expect(actions).toEqual([]);
  });

  it("does not create an issue for a fetch-failed-only result", () => {
    expect(planIssueSync([fetchFailedResult("a", "timed out")], [])).toEqual([]);
  });
});
