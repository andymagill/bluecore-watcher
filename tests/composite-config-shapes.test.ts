// M4b: proves the two real composite/indexed extractor *shapes* the real
// config now uses (an "8-K"-style filing pulled from parallel arrays; a
// single-row document-title link) against synthetic, entity-agnostic
// fixtures — per ADR-001/ADR-021, no real entity name, CIK, or vocabulary
// term appears here. tests/api-composite.test.ts already proves the
// underlying ApiHandler/compose.ts mechanics generically; this suite proves
// the actual field lists/templates/vocabularies mirror the real config
// without depending on it, and regression-guards a doc-field escape bug
// found while building the real config's own generic-latest-filing
// composite (a primaryDocument value that is itself a path, not a flat
// filename, breaks under escape: "url" but not escape: "none").
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CmieConfig, type TargetDef } from "../src/config/schema.js";
import { ApiHandler } from "../src/ingest/extract/api-handler.js";
import { extractOne } from "../src/ingest/extract/pipeline.js";
import { processExtractor } from "../src/ingest/process-extractor.js";
import { AcknowledgementStore } from "../src/ingest/acknowledgements.js";
import { IngestError } from "../src/ingest/errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures");

async function loadFixture(name: string): Promise<unknown> {
  const raw = await readFile(join(fixturesDir, name, "response.json"), "utf-8");
  return JSON.parse(raw);
}

async function emptyAcks(): Promise<AcknowledgementStore> {
  return AcknowledgementStore.load("/nonexistent/acks.json");
}

// A small, generic code->label vocabulary standing in for SEC_8K_ITEMS —
// covers exactly the codes the fixture uses, plus one deliberately left
// unmapped for the PARSE_ERROR case below.
const EXAMPLE_ITEM_VOCAB: Record<string, string> = {
  "1.01": "Entry into a Material Agreement",
  "2.02": "Results of Operations",
  "9.01": "Financial Statements and Exhibits",
  // "5.02" intentionally absent
};

function buildFilingTarget(itemsFieldOverride?: Record<string, unknown>): TargetDef {
  const cfg = CmieConfig.parse({
    schemaVersion: 1,
    environment: { id: "t", displayName: "T", entities: [{ id: "p", name: "P", role: "primary" }] },
    sections: [{ id: "s", label: "S", order: 1 }],
    targets: [
      {
        id: "target-filings",
        label: "Target Filings",
        entityId: "p",
        sectionId: "s",
        kind: "api",
        url: "https://example.test/api/submissions",
        schedule: { cron: "0 6 * * *", ttlHours: 48 },
        extractors: [
          {
            key: "latest_notable_filing",
            label: "Latest Notable Filing",
            presenter: "markdown",
            kind: "api",
            type: "markdown",
            // Mirrors latest_8k's real shape: row of interest isn't at
            // index 0, found via a filter-match index.
            index: { jsonPath: '$.filings.recent.form[?(@ === "8-K")]~', pick: "first" },
            fields: {
              items: itemsFieldOverride ?? {
                jsonPath: "$.filings.recent.items[{index}]",
                split: ",",
                valueMap: EXAMPLE_ITEM_VOCAB,
                join: "; ",
              },
              date: { jsonPath: "$.filings.recent.filingDate[{index}]" },
              acc: {
                jsonPath: "$.filings.recent.accessionNumber[{index}]",
                strip: "-",
                escape: "none",
              },
              // escape: "none", not "url" — mirrors the real config's fix:
              // this fixture's target row's primaryDocument is itself a
              // path ("viewer-path/8k.htm"), and encodeURIComponent would
              // turn the "/" into "%2F".
              doc: { jsonPath: "$.filings.recent.primaryDocument[{index}]", escape: "none" },
            },
            template:
              "**{items}** filed {date} — [primary document](https://example.test/{acc}/{doc})",
            assert: { notEmpty: true, maxLength: 1200 },
          },
        ],
      },
    ],
  });
  return cfg.targets[0]!;
}

function buildDocumentLinkTarget(): TargetDef {
  const cfg = CmieConfig.parse({
    schemaVersion: 1,
    environment: { id: "t", displayName: "T", entities: [{ id: "p", name: "P", role: "primary" }] },
    sections: [{ id: "s", label: "S", order: 1 }],
    targets: [
      {
        id: "target-documents",
        label: "Target Documents",
        entityId: "p",
        sectionId: "s",
        kind: "api",
        url: "https://example.test/api/documents",
        schedule: { cron: "0 15 * * *", ttlHours: 168 },
        extractors: [
          {
            key: "latest_document_title",
            label: "Latest Document",
            presenter: "markdown",
            kind: "api",
            type: "markdown",
            // Single-row composite — no `index` — mirrors the FR title
            // extractor's shape.
            fields: {
              title: { jsonPath: "$.results[0].title" },
              url: { jsonPath: "$.results[0].html_url", escape: "none" },
            },
            template: "[{title}]({url})",
            assert: { notEmpty: true, maxLength: 1000 },
          },
          {
            key: "latest_document_type",
            label: "Latest Document Type",
            presenter: "status",
            kind: "api",
            type: "enum",
            jsonPath: "$.results[0].type",
            enumValues: [
              "Rule",
              "Proposed Rule",
              "Notice",
              "Presidential Document",
              "Uncategorized Document",
            ],
            assert: { notEmpty: true },
          },
        ],
      },
    ],
  });
  return cfg.targets[0]!;
}

function buildContractAwardTarget(): TargetDef {
  const cfg = CmieConfig.parse({
    schemaVersion: 1,
    environment: { id: "t", displayName: "T", entities: [{ id: "p", name: "P", role: "primary" }] },
    sections: [{ id: "s", label: "S", order: 1 }],
    targets: [
      {
        id: "target-awards",
        label: "Target Contract Awards",
        entityId: "p",
        sectionId: "s",
        kind: "api",
        method: "POST",
        url: "https://example.test/api/awards/search",
        body: '{"filters":{"keywords":["example"]},"sort":"Base Obligation Date","order":"desc","limit":1,"page":1}',
        // ADR-024/rule 14 — a POST target requires viewUrl.
        viewUrl: "https://example.test/awards/search-page",
        schedule: { cron: "0 15 * * *", ttlHours: 168 },
        extractors: [
          {
            key: "latest_award",
            label: "Latest Award",
            presenter: "markdown",
            kind: "api",
            type: "markdown",
            // Mirrors the real target's shape: no `index` — row 0 is always
            // "the latest" given the sort/order in the request body itself.
            // Field names contain spaces ("Recipient Name", "Award Amount",
            // "Awarding Agency", "Base Obligation Date") — bracket-syntax
            // JSONPath, live-verified against a real captured
            // spending_by_award response (docs/plans/m5-new-source-types.md).
            fields: {
              recipient: { jsonPath: "$.results[0]['Recipient Name']" },
              desc: { jsonPath: "$.results[0].Description" },
              id: { jsonPath: "$.results[0].generated_internal_id", escape: "none" },
            },
            template: "**{recipient}** — {desc} — [award record](https://example.test/award/{id})",
            assert: { notEmpty: true, maxLength: 3000 },
          },
          {
            key: "latest_award_amount",
            label: "Latest Award Amount",
            presenter: "metric",
            kind: "api",
            type: "number",
            unit: "USD",
            jsonPath: "$.results[0]['Award Amount']",
            assert: { min: 0, notEmpty: true },
          },
          {
            key: "latest_award_agency",
            label: "Latest Award Agency",
            presenter: "markdown",
            kind: "api",
            type: "string",
            jsonPath: "$.results[0]['Awarding Agency']",
            assert: { notEmpty: true, maxLength: 120 },
          },
          {
            key: "latest_award_date",
            label: "Latest Award Date",
            presenter: "metric",
            kind: "api",
            type: "date",
            jsonPath: "$.results[0]['Base Obligation Date']",
            assert: { notEmpty: true, maxFutureDays: 1, notBefore: "2007-10-01" },
            alert: { on: "any-change" },
          },
        ],
      },
    ],
  });
  return cfg.targets[0]!;
}

describe("composite config shapes — SEC-style indexed filing (mirrors latest_8k)", () => {
  it("binds the index to the first matching row and composes items/date/link from it", async () => {
    const doc = await loadFixture("example-sec-submissions");
    const target = buildFilingTarget();
    const handler = new ApiHandler();
    const candidate = await extractOne(handler, doc, target.extractors[0]!, target);
    // Fixture's first "8-K" is at index 1 (2026-07-15), not the later one
    // at index 3 — proves "pick: first" picks the earlier match, not just
    // any match.
    expect(candidate.value).toBe(
      "**Results of Operations; Financial Statements and Exhibits** filed 2026\\-07\\-15 — " +
        "[primary document](https://example.test/000110465926000003/viewer-path/8k.htm)",
    );
  });

  it('preserves a literal "/" in a primaryDocument path (escape: none regression)', async () => {
    // Guards a real bug found while building the real config: escape:
    // "url" would percent-encode this row's "viewer-path/8k.htm" into
    // "viewer-path%2F8k.htm", which 303s instead of resolving.
    const doc = await loadFixture("example-sec-submissions");
    const target = buildFilingTarget();
    const handler = new ApiHandler();
    const candidate = await extractOne(handler, doc, target.extractors[0]!, target);
    expect(candidate.value).toContain("/viewer-path/8k.htm)");
    expect(candidate.value).not.toContain("%2F");
  });

  it("throws PARSE_ERROR when an item code has no valueMap entry", async () => {
    // The *second* 8-K (index 3) carries "5.02", deliberately left out of
    // EXAMPLE_ITEM_VOCAB — same strictness SEC_8K_ITEMS relies on.
    const doc = await loadFixture("example-sec-submissions");
    const target = buildFilingTarget({
      jsonPath: "$.filings.recent.items[3]", // force-read the second 8-K's row directly
      split: ",",
      valueMap: EXAMPLE_ITEM_VOCAB,
      join: "; ",
    });
    const handler = new ApiHandler();
    await expect(extractOne(handler, doc, target.extractors[0]!, target)).rejects.toMatchObject({
      errorClass: "PARSE_ERROR",
      message: expect.stringContaining('no valueMap entry for "5.02"'),
    } satisfies Partial<IngestError>);
  });
});

describe("composite config shapes — single-row document link (mirrors latest_document_title)", () => {
  it("composes a markdown link and escapes brackets/parens in the title", async () => {
    const doc = await loadFixture("example-regulatory-api");
    const target = buildDocumentLinkTarget();
    const handler = new ApiHandler();
    const candidate = await extractOne(handler, doc, target.extractors[0]!, target);
    // The fixture's title deliberately contains "(...)" and "[...]" — the
    // default markdown escape on `title` must neutralize both so they
    // render as literal text rather than breaking the [text](url) link.
    expect(candidate.value).toBe(
      "[Example Rule on Widget Safety \\(Amendment\\) \\[Revised\\]]" +
        "(https://example.test/documents/2026/07/15/2026-90001/example-rule-on-widget-safety)",
    );
  });

  it("every live-verified FR type value coerces through the enum extractor", async () => {
    const handler = new ApiHandler();
    const acks = await emptyAcks();
    const target = buildDocumentLinkTarget();
    const typeExtractor = target.extractors[1]!;
    for (const value of [
      "Rule",
      "Proposed Rule",
      "Notice",
      "Presidential Document",
      "Uncategorized Document",
    ]) {
      const doc = { results: [{ type: value }] };
      const { block } = await processExtractor({
        handler,
        doc,
        extractor: typeExtractor,
        target,
        previousBlock: null,
        acknowledgements: acks,
        now: new Date("2026-09-16T00:00:00.000Z"),
        httpStatus: 200,
      });
      expect(block.status).toBe("ok");
      expect(block.value).toBe(value);
    }
  });

  it("flags a value outside the enum as ASSERTION_FAILED (vocabulary-drift guard)", async () => {
    const handler = new ApiHandler();
    const acks = await emptyAcks();
    const target = buildDocumentLinkTarget();
    const typeExtractor = target.extractors[1]!;
    const doc = { results: [{ type: "Executive Order" }] }; // not in enumValues
    const { block, healthEntryDraft } = await processExtractor({
      handler,
      doc,
      extractor: typeExtractor,
      target,
      previousBlock: null,
      acknowledgements: acks,
      now: new Date("2026-09-16T00:00:00.000Z"),
      httpStatus: 200,
    });
    expect(block.status).toBe("missing");
    expect(healthEntryDraft?.errorClass).toBe("ASSERTION_FAILED");
    expect(healthEntryDraft?.message).toContain("enumValues");
  });
});

describe("composite config shapes — contract-award POST/composite record (mirrors latest_award, M5a)", () => {
  it("composes the latest award record from row 0, escaping markdown-special characters in the description", async () => {
    const doc = await loadFixture("example-contracts-api");
    const target = buildContractAwardTarget();
    const handler = new ApiHandler();
    const candidate = await extractOne(handler, doc, target.extractors[0]!, target);
    // Row 0, not row 1 -- there's no `index`, so this proves the plain
    // array-position read, not a filter match. The description's "(PHASE
    // 2)" must render as literal parens, not break the composed link.
    expect(candidate.value).toBe(
      "**Example Vendor & Co\\.** — EXAMPLE PROCUREMENT FOR WIDGET TESTING \\(PHASE 2\\) — " +
        "[award record](https://example.test/award/CONT_AWD_TEST0001_0000_-NONE-_-NONE-)",
    );
  });

  it("resolves bracket-syntax jsonPath on scalar (non-composite) locations for field names containing spaces", async () => {
    const doc = await loadFixture("example-contracts-api");
    const target = buildContractAwardTarget();
    const handler = new ApiHandler();
    const acks = await emptyAcks();
    const now = new Date("2026-09-17T00:00:00.000Z");

    const { block: amountBlock } = await processExtractor({
      handler,
      doc,
      extractor: target.extractors[1]!, // latest_award_amount: $.results[0]['Award Amount']
      target,
      previousBlock: null,
      acknowledgements: acks,
      now,
      httpStatus: 200,
    });
    expect(amountBlock.status).toBe("ok");
    expect(amountBlock.value).toBe(500000.5);

    const { block: agencyBlock } = await processExtractor({
      handler,
      doc,
      extractor: target.extractors[2]!, // latest_award_agency: $.results[0]['Awarding Agency']
      target,
      previousBlock: null,
      acknowledgements: acks,
      now,
      httpStatus: 200,
    });
    expect(agencyBlock.status).toBe("ok");
    expect(agencyBlock.value).toBe("Example Federal Agency");
  });

  it("coerces Base Obligation Date to a validated date within the notBefore/maxFutureDays band", async () => {
    const doc = await loadFixture("example-contracts-api");
    const target = buildContractAwardTarget();
    const handler = new ApiHandler();
    const acks = await emptyAcks();
    const { block } = await processExtractor({
      handler,
      doc,
      extractor: target.extractors[3]!, // latest_award_date
      target,
      previousBlock: null,
      acknowledgements: acks,
      now: new Date("2026-09-17T00:00:00.000Z"),
      httpStatus: 200,
    });
    expect(block.status).toBe("ok");
    expect(block.value).toBe("2026-06-15T00:00:00.000Z");
  });
});
