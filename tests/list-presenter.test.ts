// 01-DATA-CONTRACT.md §4.1 — the `list` presenter's array value/provenance
// and SetDelta shape, including added/removed tracking across a run.
import { describe, expect, it } from "vitest";
import { CmieConfig, type TargetDef } from "../src/config/schema.js";
import { HtmlHandler } from "../src/ingest/extract/html-handler.js";
import { processExtractor } from "../src/ingest/process-extractor.js";
import { AcknowledgementStore } from "../src/ingest/acknowledgements.js";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

function buildTarget(): TargetDef {
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
        kind: "html",
        url: "https://example.test/dockets",
        schedule: { cron: "0 6 * * *", ttlHours: 72 },
        extractors: [
          {
            key: "dockets",
            label: "Dockets",
            presenter: "list",
            kind: "html",
            selector: ".docket",
            multiple: true,
            type: "string",
            assert: { notEmpty: true, minItems: 1, maxItems: 10 },
          },
        ],
      },
    ],
  });
  return cfg.targets[0]!;
}

async function freshAckStore() {
  const dir = await mkdtemp(join(tmpdir(), "acks-list-"));
  return AcknowledgementStore.load(join(dir, "acknowledgements.json"));
}

describe("list presenter — array shape and SetDelta", () => {
  it("first extraction produces an array value with null delta", async () => {
    const target = buildTarget();
    const handler = new HtmlHandler();
    const doc = handler.parse({
      body: "<ul><li class='docket'>A</li><li class='docket'>B</li></ul>",
      httpStatus: 200,
      fetchedAt: new Date().toISOString(),
    });

    const result = await processExtractor({
      handler,
      doc,
      extractor: target.extractors[0]!,
      target,
      previousBlock: null,
      acknowledgements: await freshAckStore(),
      now: new Date("2026-09-12T00:00:00Z"),
      httpStatus: 200,
    });

    expect(result.block.presenter).toBe("list");
    expect(result.block.value).toEqual(["A", "B"]);
    expect(Array.isArray(result.block.provenance?.anchor)).toBe(true);
    expect(result.block.delta).toBeNull();
  });

  it("a changed set produces added/removed and count/previousCount", async () => {
    const target = buildTarget();
    const handler = new HtmlHandler();
    const previousBlock = {
      key: "dockets",
      label: "Dockets",
      type: "string" as const,
      presenter: "list" as const,
      status: "ok" as const,
      value: ["A", "B"],
      displayValue: ["A", "B"],
      provenance: {
        sourceUrl: target.url,
        anchor: [".docket:nth-of-type(1)", ".docket:nth-of-type(2)"],
        extractedAt: "2026-09-01T00:00:00.000Z",
        rawText: ["A", "B"],
        contentHash: "sha256:dddd",
      },
      delta: null,
      validation: { passed: true, warnings: [] },
    };
    // B dropped, C added.
    const doc = handler.parse({
      body: "<ul><li class='docket'>A</li><li class='docket'>C</li></ul>",
      httpStatus: 200,
      fetchedAt: new Date().toISOString(),
    });

    const result = await processExtractor({
      handler,
      doc,
      extractor: target.extractors[0]!,
      target,
      previousBlock,
      acknowledgements: await freshAckStore(),
      now: new Date("2026-09-12T00:00:00Z"),
      httpStatus: 200,
    });

    expect(result.block.value).toEqual(["A", "C"]);
    expect(result.block.delta).toMatchObject({
      kind: "set",
      added: ["C"],
      removed: ["B"],
      count: 2,
      previousCount: 2,
    });
  });

  it("assert.minItems rejects an empty list", async () => {
    const target = buildTarget();
    const handler = new HtmlHandler();
    const doc = handler.parse({
      body: "<ul></ul>",
      httpStatus: 200,
      fetchedAt: new Date().toISOString(),
    });

    const result = await processExtractor({
      handler,
      doc,
      extractor: target.extractors[0]!,
      target,
      previousBlock: null,
      acknowledgements: await freshAckStore(),
      now: new Date("2026-09-12T00:00:00Z"),
      httpStatus: 200,
    });

    expect(result.block.status).toBe("missing");
    expect(result.healthEntryDraft?.errorClass).toBe("ASSERTION_FAILED");
  });
});

// ADR-025 — a composite row list's row identity for SetDelta is rawText
// (the raw pre-transform field snapshot), not the composed displayValue,
// and a bounded (`limit`-ed) list masks window-eviction churn out of
// `removed`. All three targets below share one field ("label", the row's
// own text) + template ("{label}") so identity/value divergence is easy to
// force by editing the field's transform between runs.
function buildCompositeTarget(
  limit: number,
  fieldOverrides: Record<string, unknown> = {},
): TargetDef {
  const cfg = CmieConfig.parse({
    schemaVersion: 1,
    environment: { id: "t", displayName: "T", entities: [{ id: "p", name: "P", role: "primary" }] },
    sections: [{ id: "s", label: "S", order: 1 }],
    targets: [
      {
        id: "target-2",
        label: "Target 2",
        entityId: "p",
        sectionId: "s",
        kind: "html",
        url: "https://example.test/items",
        schedule: { cron: "0 6 * * *", ttlHours: 72 },
        extractors: [
          {
            key: "recent_items",
            label: "Recent Items",
            presenter: "list",
            kind: "html",
            type: "markdown",
            selector: ".item",
            multiple: true,
            limit,
            fields: { label: { ...fieldOverrides } },
            template: "{label}",
          },
        ],
      },
    ],
  });
  return cfg.targets[0]!;
}

function itemsDoc(handler: HtmlHandler, labels: readonly string[]) {
  const body = labels.map((l) => `<div class="item">${l}</div>`).join("");
  return handler.parse({ body, httpStatus: 200, fetchedAt: new Date().toISOString() });
}

describe("list presenter — composite row identity and window eviction (ADR-025)", () => {
  it("a template/valueMap-only edit changes value/displayValue without any SetDelta churn", async () => {
    const handler = new HtmlHandler();
    const acks = await freshAckStore();
    const now = new Date("2026-09-12T00:00:00Z");

    const run1 = await processExtractor({
      handler,
      doc: itemsDoc(handler, ["A", "B"]),
      extractor: buildCompositeTarget(3).extractors[0]!,
      target: buildCompositeTarget(3),
      previousBlock: null,
      acknowledgements: acks,
      now,
      httpStatus: 200,
    });
    expect(run1.block.value).toEqual(["A", "B"]);
    expect(run1.block.delta).toBeNull();

    // Same source rows, but the field's valueMap now relabels "A" — the raw
    // per-row text hasn't moved, so contentHash is unchanged (the
    // "unchanged/reverified" branch fires), yet the composed value must
    // still reflect the edit rather than freezing at run1's value.
    const relabeled = buildCompositeTarget(3, {
      valueMap: { A: "Item A (relabeled)", B: "B" },
    });
    const run2 = await processExtractor({
      handler,
      doc: itemsDoc(handler, ["A", "B"]),
      extractor: relabeled.extractors[0]!,
      target: relabeled,
      previousBlock: run1.block,
      acknowledgements: acks,
      now: new Date("2026-09-13T00:00:00Z"),
      httpStatus: 200,
    });
    expect(run2.block.value).toEqual(["Item A \\(relabeled\\)", "B"]);
    // No fake any-change: delta is carried forward untouched, not recomputed.
    expect(run2.block.delta).toBeNull();
  });

  it('window eviction: a new row pushing a full window reports "+1", not "+1 -1"', async () => {
    const handler = new HtmlHandler();
    const acks = await freshAckStore();
    const target = buildCompositeTarget(3);

    const run1 = await processExtractor({
      handler,
      doc: itemsDoc(handler, ["A", "B", "C"]),
      extractor: target.extractors[0]!,
      target,
      previousBlock: null,
      acknowledgements: acks,
      now: new Date("2026-09-12T00:00:00Z"),
      httpStatus: 200,
    });
    expect(run1.block.value).toEqual(["A", "B", "C"]);

    // "D" is new; the window (still full at 3) pushes "C" off the tail —
    // that's window eviction, not a real removal.
    const run2 = await processExtractor({
      handler,
      doc: itemsDoc(handler, ["D", "A", "B"]),
      extractor: target.extractors[0]!,
      target,
      previousBlock: run1.block,
      acknowledgements: acks,
      now: new Date("2026-09-13T00:00:00Z"),
      httpStatus: 200,
    });
    // `added`/`removed` hold row identity (a composite's stableRawJson), not
    // display text — the dashboard only ever renders their *counts*
    // (DeltaChip.tsx), so this asserts "+1 -0" the same way it's observed.
    expect(run2.block.delta).toMatchObject({ kind: "set", count: 3, previousCount: 3 });
    const delta2 = run2.block.delta as { added: string[]; removed: string[] };
    expect(delta2.added).toHaveLength(1);
    expect(delta2.added[0]).toContain('"D"');
    expect(delta2.removed).toHaveLength(0);
  });

  it('reports a genuine removal ("+1 -1") when the window was not already full', async () => {
    const handler = new HtmlHandler();
    const acks = await freshAckStore();
    const target = buildCompositeTarget(3); // limit 3, but only 2 rows ever appear below

    const run1 = await processExtractor({
      handler,
      doc: itemsDoc(handler, ["B", "C"]),
      extractor: target.extractors[0]!,
      target,
      previousBlock: null,
      acknowledgements: acks,
      now: new Date("2026-09-12T00:00:00Z"),
      httpStatus: 200,
    });
    expect(run1.block.value).toEqual(["B", "C"]);

    // The window was never full (2 rows against a limit of 3), so eviction
    // masking doesn't apply: "C" genuinely disappearing is reported.
    const run2 = await processExtractor({
      handler,
      doc: itemsDoc(handler, ["D", "B"]),
      extractor: target.extractors[0]!,
      target,
      previousBlock: run1.block,
      acknowledgements: acks,
      now: new Date("2026-09-13T00:00:00Z"),
      httpStatus: 200,
    });
    expect(run2.block.delta).toMatchObject({ kind: "set", count: 2, previousCount: 2 });
    const delta3 = run2.block.delta as { added: string[]; removed: string[] };
    expect(delta3.added).toHaveLength(1);
    expect(delta3.added[0]).toContain('"D"');
    expect(delta3.removed).toHaveLength(1);
    expect(delta3.removed[0]).toContain('"C"');
  });
});
