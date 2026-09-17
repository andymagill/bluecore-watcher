// ADR-022 — composite/indexed api locations. Synthetic fixtures shaped like
// the real-world case that motivated this (a "recent filings" endpoint as
// parallel arrays, per ADR-021 with no entity name in code): resolve one
// "row" from an index match, bind several other arrays to that row, and
// compose the result into one markdown string.
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CmieConfig, type TargetDef } from "../src/config/schema.js";
import { Block } from "../src/contract/block.js";
import { ApiHandler } from "../src/ingest/extract/api-handler.js";
import { extractOne } from "../src/ingest/extract/pipeline.js";
import {
  applyFieldTransform,
  composeTemplate,
  stableRawJson,
} from "../src/ingest/extract/compose.js";
import { processExtractor } from "../src/ingest/process-extractor.js";
import { AcknowledgementStore } from "../src/ingest/acknowledgements.js";
import { IngestError } from "../src/ingest/errors.js";

// A generic "recent filings" endpoint: parallel arrays, newest first, the
// row of interest ("form" === "B") not at index 0 — the exact shape that
// makes a plain jsonPath insufficient.
function doc(overrides: Partial<Record<string, unknown[]>> = {}) {
  return {
    filings: {
      recent: {
        form: overrides.form ?? ["A", "B", "C"],
        filingDate: overrides.filingDate ?? ["2026-03-01", "2026-02-01", "2026-01-01"],
        items: overrides.items ?? ["", "1.01,,9.01", ""],
        accessionNumber: overrides.accessionNumber ?? ["0001-26-3", "0001-26-2", "0001-26-1"],
        primaryDocument: overrides.primaryDocument ?? ["a.htm", "b filing.htm", "c.htm"],
      },
    },
  };
}

// `extra`/`fields` are typed loosely — `ApiFieldDef`'s *inferred* type makes
// `escape` required (its zod default fills the output type, per
// CmieConfigInput's own z.input/z.infer split), which would force every
// field literal below to spell out `escape: "markdown"` even when relying
// on the default. CmieConfig.parse validates the real shape at runtime
// regardless, same pattern drift.test.ts/repair.test.ts use for a
// discriminated-union literal.
function buildTarget(
  fields: Record<string, Record<string, unknown>>,
  extra: Record<string, unknown> = {},
): TargetDef {
  const cfg = CmieConfig.parse({
    schemaVersion: 1,
    environment: { id: "t", displayName: "T", entities: [{ id: "p", name: "P", role: "primary" }] },
    sections: [{ id: "s", label: "S", order: 1 }],
    targets: [
      {
        id: "target-1",
        label: "Target 1",
        entityId: "p",
        sectionId: "s",
        kind: "api",
        url: "https://example.test/api/filings",
        schedule: { cron: "0 6 * * *", ttlHours: 72 },
        extractors: [
          {
            key: "latest_b",
            label: "Latest B Filing",
            presenter: "markdown",
            kind: "api",
            type: "markdown",
            index: { jsonPath: '$.filings.recent.form[?(@ === "B")]~', pick: "first" },
            fields,
            template: "**{items}** filed {date} — [doc](https://example.test/{acc}/{doc})",
            ...extra,
          },
        ],
      },
    ],
  });
  return cfg.targets[0]!;
}

const STANDARD_FIELDS: Record<string, Record<string, unknown>> = {
  items: {
    jsonPath: "$.filings.recent.items[{index}]",
    split: ",",
    valueMap: { "1.01": "Material Agreement", "9.01": "Exhibits" },
    join: "; ",
  },
  date: { jsonPath: "$.filings.recent.filingDate[{index}]" },
  acc: { jsonPath: "$.filings.recent.accessionNumber[{index}]", strip: "-", escape: "none" },
  doc: { jsonPath: "$.filings.recent.primaryDocument[{index}]", escape: "url" },
};

describe("ApiHandler — composite location (ADR-022)", () => {
  it("resolves the index to the first match and binds every field at that row", async () => {
    const target = buildTarget(STANDARD_FIELDS);
    const handler = new ApiHandler();
    const candidate = await extractOne(handler, doc(), target.extractors[0]!, target);
    expect(candidate.value).toBe(
      "**Material Agreement; Exhibits** filed 2026\\-02\\-01 — [doc](https://example.test/0001262/b%20filing.htm)",
    );
    expect(candidate.anchor).toContain("index@1:");
    expect(candidate.anchor).toContain("items:$.filings.recent.items[1]");
  });

  it("throws SELECTOR_NO_MATCH when the index filter matches nothing", async () => {
    const target = buildTarget(STANDARD_FIELDS);
    const handler = new ApiHandler();
    const noB = doc({ form: ["A", "C"], items: ["", ""] });
    await expect(extractOne(handler, noB, target.extractors[0]!, target)).rejects.toMatchObject({
      errorClass: "SELECTOR_NO_MATCH",
    } satisfies Partial<IngestError>);
  });

  it("throws PARSE_ERROR when the index jsonPath resolves to a non-integer", async () => {
    const target = buildTarget(STANDARD_FIELDS, {
      index: { jsonPath: "$.filings.recent.form[0]", pick: "first" }, // "A", not an index
    });
    const handler = new ApiHandler();
    await expect(extractOne(handler, doc(), target.extractors[0]!, target)).rejects.toMatchObject({
      errorClass: "PARSE_ERROR",
    } satisfies Partial<IngestError>);
  });

  it("throws SELECTOR_NO_MATCH naming the field when a field jsonPath matches nothing", async () => {
    const target = buildTarget({
      ...STANDARD_FIELDS,
      date: { jsonPath: "$.filings.recent.doesNotExist[{index}]" },
    });
    const handler = new ApiHandler();
    await expect(extractOne(handler, doc(), target.extractors[0]!, target)).rejects.toMatchObject({
      errorClass: "SELECTOR_NO_MATCH",
      message: expect.stringContaining('field "date"'),
    });
  });

  it("throws SELECTOR_AMBIGUOUS naming the field when a field jsonPath matches more than one node", async () => {
    const target = buildTarget({
      ...STANDARD_FIELDS,
      date: { jsonPath: "$.filings.recent.filingDate[*]" },
    });
    const handler = new ApiHandler();
    await expect(extractOne(handler, doc(), target.extractors[0]!, target)).rejects.toMatchObject({
      errorClass: "SELECTOR_AMBIGUOUS",
      message: expect.stringContaining('field "date"'),
    });
  });

  it("throws PARSE_ERROR when a token has no valueMap entry", async () => {
    const target = buildTarget({
      ...STANDARD_FIELDS,
      items: { jsonPath: "$.filings.recent.items[{index}]", split: ",", valueMap: { "1.01": "x" } }, // "9.01" unmapped
    });
    const handler = new ApiHandler();
    await expect(extractOne(handler, doc(), target.extractors[0]!, target)).rejects.toMatchObject({
      errorClass: "PARSE_ERROR",
      message: expect.stringContaining('no valueMap entry for "9.01"'),
    });
  });

  it("drops empty tokens produced by split before valueMap/join run", async () => {
    // items[1] is "1.01,,9.01" — an empty middle token must not reach
    // valueMap (which has no entry for "") or the joined output.
    const target = buildTarget(STANDARD_FIELDS);
    const handler = new ApiHandler();
    const candidate = await extractOne(handler, doc(), target.extractors[0]!, target);
    const value = candidate.value as string;
    expect(value).toContain("Material Agreement; Exhibits");
    expect(value).not.toMatch(/;\s*;/);
  });

  it("rawText is a stable-key JSON of the raw pre-transform field values, not the composed text", async () => {
    const target = buildTarget(STANDARD_FIELDS);
    const handler = new ApiHandler();
    const candidate = await extractOne(handler, doc(), target.extractors[0]!, target);
    const parsed = JSON.parse(candidate.rawText as string) as Record<string, string>;
    expect(parsed).toEqual({
      acc: "0001-26-2",
      date: "2026-02-01",
      doc: "b filing.htm",
      items: "1.01,,9.01",
    });
  });

  it("contentHash is unchanged when only a valueMap label changes (no fake any-change alert)", async () => {
    const targetA = buildTarget(STANDARD_FIELDS);
    const targetB = buildTarget({
      ...STANDARD_FIELDS,
      items: {
        ...STANDARD_FIELDS.items!,
        valueMap: { "1.01": "Renamed Material Agreement Label", "9.01": "Exhibits" },
      },
    });
    const handler = new ApiHandler();
    const candidateA = await extractOne(handler, doc(), targetA.extractors[0]!, targetA);
    const candidateB = await extractOne(handler, doc(), targetB.extractors[0]!, targetB);
    expect(candidateA.contentHash).toBe(candidateB.contentHash);
    expect(candidateA.value).not.toBe(candidateB.value);
  });

  it("a full processExtractor result validates against the contract Block schema", async () => {
    const target = buildTarget(STANDARD_FIELDS);
    const handler = new ApiHandler();
    const dir = await mkdtemp(join(tmpdir(), "acks-"));
    try {
      const store = await AcknowledgementStore.load(join(dir, "acknowledgements.json"));
      const result = await processExtractor({
        handler,
        doc: doc(),
        extractor: target.extractors[0]!,
        target,
        previousBlock: null,
        acknowledgements: store,
        now: new Date("2026-09-15T00:00:00.000Z"),
        httpStatus: 200,
      });
      expect(() => Block.parse(result.block)).not.toThrow();
      expect(result.block.status).toBe("ok");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("compose.ts — per-field transforms (unit)", () => {
  it("strip removes every match before split/join run", () => {
    const out = applyFieldTransform("0001-26-000002", { strip: "-", escape: "none" }, "e", "acc");
    expect(out).toBe("000126000002");
  });

  it("escape: markdown escapes markdown-significant characters", () => {
    const out = applyFieldTransform("a [link] *bold*", { escape: "markdown" }, "e", "f");
    expect(out).toBe("a \\[link\\] \\*bold\\*");
  });

  it("escape: url percent-encodes the joined value", () => {
    const out = applyFieldTransform("a filing.htm", { escape: "url" }, "e", "f");
    expect(out).toBe("a%20filing.htm");
  });

  it("composeTemplate fills every {name} placeholder", () => {
    expect(composeTemplate("{a} and {b}", { a: "1", b: "2" })).toBe("1 and 2");
  });

  it("stableRawJson sorts keys so field-order changes don't move the hash", () => {
    expect(stableRawJson({ b: "2", a: "1" })).toBe(stableRawJson({ a: "1", b: "2" }));
  });
});
