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
