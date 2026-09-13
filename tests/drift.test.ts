// 03-INGESTION.md §5 "weekly drift check" / docs/07-ROADMAP.md M2b.
// checkTargetDrift is exercised against the REAL config
// (config/bluecore.config.ts) throughout, and against real committed
// fixtures for the JSON (Federal Register, SEC) cases, mutated in memory
// to simulate the specific failure modes a redesign actually produces —
// a key removed, a field's type changed, an envelope wrapped around the
// whole body. The HTML (newsroom) cases use a small synthetic document
// shaped like the real one (same `.bc-n-card`/`.bc-n-ctitle` selector
// convention) rather than string-surgery on the real ~40KB Webflow export,
// which is too deeply nested to mutate reliably by hand — the extraction
// logic under test (extractOne, the real handler) is identical either way.
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CmieConfig, type TargetDef } from "../src/config/schema.js";
import { config as bluecoreConfig } from "../config/bluecore.config.js";
import {
  checkTargetDrift,
  fetchFailedResult,
  isDrifting,
  type TargetDriftResult,
} from "../src/drift/check.js";
import { planIssueSync, type OpenDriftIssue } from "../src/drift/issues.js";
import type { FetchResult } from "../src/ingest/fetch/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const config = CmieConfig.parse(bluecoreConfig);

function realTarget(id: string): TargetDef {
  const target = config.targets.find((t) => t.id === id);
  if (!target) throw new Error(`no such target in config/bluecore.config.ts: ${id}`);
  return target;
}

async function fixtureBody(targetId: string, ext: "html" | "json"): Promise<string> {
  return readFile(join(root, "fixtures", targetId, `response.${ext}`), "utf-8");
}

function asFetchResult(body: string): FetchResult {
  return { body, httpStatus: 200, fetchedAt: "2026-09-13T00:00:00.000Z" };
}

// A small, hand-built document shaped like the real newsroom page: three
// `.bc-n-card`s, each carrying `.bc-n-ctitle`/`.bc-n-cdate`/`.bc-n-cat-key`,
// matching config/bluecore.config.ts's real ".bc-n-card:first <field>"
// selectors (M2b's selector-scoping fix) exactly.
function newsroomDoc(cards: string[]): string {
  return `<html><body><div class="bc-n-grid">${cards.join("")}</div></body></html>`;
}

function card(headline: string, date: string, category: string): string {
  return (
    `<a class="bc-n-card"><div class="bc-n-cat-key">${category}</div>` +
    `<div class="bc-n-cdate">${date}</div><div class="bc-n-ctitle">${headline}</div></a>`
  );
}

describe("checkTargetDrift — html (newsroom-shaped, selector-matched)", () => {
  const newsroom = realTarget("bluecore-newsroom");
  const baselineDoc = newsroomDoc([
    card("First post", "September 8, 2026", "Press Release"),
    card("Second post", "August 1, 2026", "Insights"),
  ]);

  it("identical baseline and live: clean", async () => {
    const result = await checkTargetDrift(
      newsroom,
      asFetchResult(baselineDoc),
      asFetchResult(baselineDoc),
    );
    expect(isDrifting(result)).toBe(false);
  });

  it("a renamed class breaks extraction: EXTRACTION_BROKEN on that extractor", async () => {
    const live = baselineDoc.replaceAll("bc-n-ctitle", "bc-n-ctitle-v2");
    const result = await checkTargetDrift(
      newsroom,
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
    const live = newsroomDoc([
      card("Brand new post", "September 20, 2026", "Press Release"),
      card("First post", "September 8, 2026", "Press Release"),
      card("Second post", "August 1, 2026", "Insights"),
    ]);
    const result = await checkTargetDrift(
      newsroom,
      asFetchResult(baselineDoc),
      asFetchResult(live),
    );
    expect(isDrifting(result)).toBe(false);
  });

  it("an extra wrapper div around the card list: ANCHOR_MOVED", async () => {
    const live = baselineDoc
      .replace(
        '<div class="bc-n-grid">',
        '<div class="bc-n-grid"><div class="bc-n-redesign-wrapper">',
      )
      .replace("</div></body>", "</div></div></body>");
    const result = await checkTargetDrift(
      newsroom,
      asFetchResult(baselineDoc),
      asFetchResult(live),
    );
    expect(result.signals.some((s) => s.code === "ANCHOR_MOVED")).toBe(true);
  });
});

describe("checkTargetDrift — api (real Federal Register / SEC fixtures, mutated)", () => {
  it("identical baseline and live (real fr-nrc-smr fixture): clean", async () => {
    const body = await fixtureBody("fr-nrc-smr", "json");
    const result = await checkTargetDrift(
      realTarget("fr-nrc-smr"),
      asFetchResult(body),
      asFetchResult(body),
    );
    expect(isDrifting(result)).toBe(false);
  });

  it("`count` removed from the response: EXTRACTION_BROKEN", async () => {
    const baseline = await fixtureBody("fr-nrc-smr", "json");
    const parsed = JSON.parse(baseline) as Record<string, unknown>;
    delete parsed.count;
    const live = JSON.stringify(parsed);
    const result = await checkTargetDrift(
      realTarget("fr-nrc-smr"),
      asFetchResult(baseline),
      asFetchResult(live),
    );
    expect(
      result.signals.some(
        (s) => s.code === "EXTRACTION_BROKEN" && s.extractorKey === "nrc_smr_document_count",
      ),
    ).toBe(true);
  });

  it("results[0] gains an unrelated optional field: clean", async () => {
    const baseline = await fixtureBody("fr-nrc-smr", "json");
    const parsed = JSON.parse(baseline) as { results: Record<string, unknown>[] };
    parsed.results[0]!.some_new_optional_field = "unrelated";
    const live = JSON.stringify(parsed);
    const result = await checkTargetDrift(
      realTarget("fr-nrc-smr"),
      asFetchResult(baseline),
      asFetchResult(live),
    );
    expect(isDrifting(result)).toBe(false);
  });

  it("form[0] changes from string to number: TYPE_CHANGED", async () => {
    const baseline = await fixtureBody("oklo-sec-filings", "json");
    const parsed = JSON.parse(baseline) as { filings: { recent: { form: unknown[] } } };
    parsed.filings.recent.form[0] = 424; // was a string like "424B5"
    const live = JSON.stringify(parsed);
    const result = await checkTargetDrift(
      realTarget("oklo-sec-filings"),
      asFetchResult(baseline),
      asFetchResult(live),
    );
    expect(
      result.signals.some(
        (s) => s.code === "TYPE_CHANGED" && s.extractorKey === "latest_filing_form",
      ),
    ).toBe(true);
  });

  it("the whole body gets wrapped in a new envelope: STRUCTURE_CHANGED", async () => {
    const baseline = await fixtureBody("oklo-sec-filings", "json");
    const live = JSON.stringify({ data: JSON.parse(baseline) });
    const result = await checkTargetDrift(
      realTarget("oklo-sec-filings"),
      asFetchResult(baseline),
      asFetchResult(live),
    );
    expect(result.signals.some((s) => s.code === "STRUCTURE_CHANGED")).toBe(true);
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
