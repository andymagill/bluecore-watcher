// Exercises the extract -> shape-assert -> guard pipeline directly against
// the HtmlHandler, per 01-DATA-CONTRACT.md §6's three validation layers and
// the error taxonomy in §7.
import { afterEach, describe, expect, it } from "vitest";
import { CmieConfig, type ExtractorDef, type TargetDef } from "../src/config/schema.js";
import { HtmlHandler } from "../src/ingest/extract/html-handler.js";
import { IngestError } from "../src/ingest/errors.js";
import { extractOne } from "../src/ingest/extract/pipeline.js";
import { processExtractor } from "../src/ingest/process-extractor.js";
import { checkShapeAssertions } from "../src/ingest/validate.js";
import { AcknowledgementStore } from "../src/ingest/acknowledgements.js";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

function buildTarget(extractorOverrides: Partial<ExtractorDef> & { selector: string }): TargetDef {
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
        url: "https://example.test/page",
        schedule: { cron: "0 6 * * *", ttlHours: 72 },
        extractors: [
          {
            key: "ex1",
            label: "Extractor 1",
            presenter: "metric",
            kind: "html",
            type: "number",
            ...extractorOverrides,
          },
        ],
      },
    ],
  });
  return cfg.targets[0]!;
}

async function withAckStore<T>(fn: (store: AcknowledgementStore) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "acks-"));
  const path = join(dir, "acknowledgements.json");
  try {
    const store = await AcknowledgementStore.load(path);
    return await fn(store);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("HtmlHandler + extractOne", () => {
  it("throws SELECTOR_NO_MATCH when the selector matches nothing", async () => {
    const target = buildTarget({ selector: "#does-not-exist" });
    const handler = new HtmlHandler();
    const doc = handler.parse({
      body: "<html><body><p id='x'>1</p></body></html>",
      httpStatus: 200,
      fetchedAt: new Date().toISOString(),
    });
    await expect(extractOne(handler, doc, target.extractors[0]!, target)).rejects.toMatchObject({
      errorClass: "SELECTOR_NO_MATCH",
    } satisfies Partial<IngestError>);
  });

  it("throws SELECTOR_AMBIGUOUS when the selector matches more than one node without multiple: true", async () => {
    const target = buildTarget({ selector: ".val" });
    const handler = new HtmlHandler();
    const doc = handler.parse({
      body: "<html><body><span class='val'>1</span><span class='val'>2</span></body></html>",
      httpStatus: 200,
      fetchedAt: new Date().toISOString(),
    });
    await expect(extractOne(handler, doc, target.extractors[0]!, target)).rejects.toMatchObject({
      errorClass: "SELECTOR_AMBIGUOUS",
    });
  });

  it("extracts a scalar value with full provenance", async () => {
    const target = buildTarget({ selector: "#capacity", unit: "TEU" });
    const handler = new HtmlHandler();
    const doc = handler.parse({
      body: "<html><body><span id='capacity'>48,200</span></body></html>",
      httpStatus: 200,
      fetchedAt: new Date().toISOString(),
    });
    const candidate = await extractOne(handler, doc, target.extractors[0]!, target);
    expect(candidate.value).toBe(48200);
    expect(candidate.rawText).toBe("48,200");
    expect(candidate.anchor).toContain("capacity");
    expect(candidate.contentHash).toMatch(/^sha256:[0-9a-f]+$/);
  });
});

describe("date coercion is timezone-independent (docs/00-DECISIONS.md timezone entry)", () => {
  // vitest.config.ts pins TZ=UTC for the whole run, which would hide this
  // exact bug (no local offset to apply => the pre-fix code would already
  // "accidentally" pass). Force a non-UTC host zone here so this test
  // actually exercises the re-anchoring logic, not just the UTC case
  // already covered by "an ISO date-only string" below.
  const ORIGINAL_TZ = process.env.TZ;
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it("a human-readable date with no zone info coerces to UTC midnight, not the host's local midnight", async () => {
    process.env.TZ = "America/Los_Angeles"; // UTC-7 or UTC-8 -- always west of UTC
    const target = buildTarget({ selector: "#posted", type: "date" });
    const handler = new HtmlHandler();
    const doc = handler.parse({
      body: "<html><body><span id='posted'>September 11, 2026</span></body></html>",
      httpStatus: 200,
      fetchedAt: new Date().toISOString(),
    });
    const candidate = await extractOne(handler, doc, target.extractors[0]!, target);
    expect(candidate.value).toBe("2026-09-11T00:00:00.000Z");
    expect((candidate as { displayValue: string }).displayValue).toBe("11 Sep 2026");
  });

  it("an ISO date-only string is already UTC and passes through unchanged", async () => {
    const target = buildTarget({ selector: "#posted", type: "date" });
    const handler = new HtmlHandler();
    const doc = handler.parse({
      body: "<html><body><span id='posted'>2026-09-11</span></body></html>",
      httpStatus: 200,
      fetchedAt: new Date().toISOString(),
    });
    const candidate = await extractOne(handler, doc, target.extractors[0]!, target);
    expect(candidate.value).toBe("2026-09-11T00:00:00.000Z");
  });

  it("a datetime with an explicit zone offset is not re-anchored (would otherwise double-shift)", async () => {
    const target = buildTarget({ selector: "#posted", type: "date" });
    const handler = new HtmlHandler();
    const doc = handler.parse({
      body: "<html><body><span id='posted'>2026-09-11T22:00:00-05:00</span></body></html>",
      httpStatus: 200,
      fetchedAt: new Date().toISOString(),
    });
    const candidate = await extractOne(handler, doc, target.extractors[0]!, target);
    expect(candidate.value).toBe("2026-09-12T03:00:00.000Z");
  });
});

describe("processExtractor — shape assertions and change guards", () => {
  it("ASSERTION_FAILED: an out-of-range value is not published, prior value retained", async () => {
    const target = buildTarget({ selector: "#capacity", assert: { min: 1000, max: 500000 } });
    const handler = new HtmlHandler();
    const previousBlock = {
      key: "ex1",
      label: "Extractor 1",
      type: "number" as const,
      presenter: "metric" as const,
      status: "ok" as const,
      value: 50000,
      displayValue: "50,000",
      provenance: {
        sourceUrl: target.url,
        anchor: "#capacity",
        extractedAt: "2026-09-01T00:00:00.000Z",
        rawText: "50,000",
        contentHash: "sha256:aaaa",
      },
      delta: null,
      validation: { passed: true, warnings: [] },
    };
    const doc = handler.parse({
      body: "<html><body><span id='capacity'>1</span></body></html>",
      httpStatus: 200,
      fetchedAt: new Date().toISOString(),
    });

    await withAckStore(async (acks) => {
      const result = await processExtractor({
        handler,
        doc,
        extractor: target.extractors[0]!,
        target,
        previousBlock,
        acknowledgements: acks,
        now: new Date("2026-09-12T00:00:00Z"),
        httpStatus: 200,
      });
      expect(result.block.status).toBe("cached");
      expect(result.block.value).toBe(50000); // retained, not the out-of-range candidate
      expect(result.healthEntryDraft?.errorClass).toBe("ASSERTION_FAILED");
    });
  });

  it("CHANGE_GUARD_TRIPPED: a candidate exceeding maxChangePct is quarantined, prior value shown", async () => {
    const target = buildTarget({ selector: "#capacity", assert: { maxChangePct: 25 } });
    const handler = new HtmlHandler();
    const previousBlock = {
      key: "ex1",
      label: "Extractor 1",
      type: "number" as const,
      presenter: "metric" as const,
      status: "ok" as const,
      value: 40000,
      displayValue: "40,000",
      provenance: {
        sourceUrl: target.url,
        anchor: "#capacity",
        extractedAt: "2026-09-01T00:00:00.000Z",
        rawText: "40,000",
        contentHash: "sha256:bbbb",
      },
      delta: null,
      validation: { passed: true, warnings: [] },
    };
    // 90,000 is +125% vs 40,000 — well past a 25% tolerance.
    const doc = handler.parse({
      body: "<html><body><span id='capacity'>90,000</span></body></html>",
      httpStatus: 200,
      fetchedAt: new Date().toISOString(),
    });

    await withAckStore(async (acks) => {
      const result = await processExtractor({
        handler,
        doc,
        extractor: target.extractors[0]!,
        target,
        previousBlock,
        acknowledgements: acks,
        now: new Date("2026-09-12T00:00:00Z"),
        httpStatus: 200,
      });
      expect(result.block.status).toBe("flagged");
      expect(result.block.value).toBe(40000); // prior value still shown
      expect(result.block.validation.warnings[0]?.rejectedCandidate).toBe(90000);
      expect(result.healthEntryDraft?.errorClass).toBe("CHANGE_GUARD_TRIPPED");
      expect(result.consumedAcknowledgement).toBeNull();
    });
  });

  it("ADR-012: a matching acknowledgement releases the guard and publishes the candidate", async () => {
    const target = buildTarget({ selector: "#capacity", assert: { maxChangePct: 25 } });
    const handler = new HtmlHandler();
    const previousBlock = {
      key: "ex1",
      label: "Extractor 1",
      type: "number" as const,
      presenter: "metric" as const,
      status: "ok" as const,
      value: 40000,
      displayValue: "40,000",
      provenance: {
        sourceUrl: target.url,
        anchor: "#capacity",
        extractedAt: "2026-09-01T00:00:00.000Z",
        rawText: "40,000",
        contentHash: "sha256:cccc",
      },
      delta: null,
      validation: { passed: true, warnings: [] },
    };
    const doc = handler.parse({
      body: "<html><body><span id='capacity'>90,000</span></body></html>",
      httpStatus: 200,
      fetchedAt: new Date().toISOString(),
    });
    const candidate = await extractOne(handler, doc, target.extractors[0]!, target);

    await withAckStore(async (acks) => {
      // Manually seed the store the way a real acknowledgements.json would.
      // @ts-expect-error accessing private state for the test seed
      acks.acknowledgements = [
        {
          targetId: target.id,
          extractorKey: "ex1",
          contentHash: candidate.contentHash,
          reason: "verified real spike",
          acknowledgedBy: "test",
          acknowledgedAt: "2026-09-12T00:00:00.000Z",
        },
      ];
      const result = await processExtractor({
        handler,
        doc,
        extractor: target.extractors[0]!,
        target,
        previousBlock,
        acknowledgements: acks,
        now: new Date("2026-09-12T00:00:00Z"),
        httpStatus: 200,
      });
      expect(result.block.status).toBe("ok");
      expect(result.block.value).toBe(90000);
      expect(result.consumedAcknowledgement).not.toBeNull();
    });
  });
});

describe("ADR-018 — date shape assertions (maxFutureDays / notBefore)", () => {
  const target = buildTarget({
    selector: "#posted",
    type: "date",
    assert: { maxFutureDays: 1, notBefore: "2020-01-01" },
  });
  const extractor = target.extractors[0]!;

  function dateCandidate(iso: string) {
    return {
      presenter: "metric" as const,
      value: iso,
      displayValue: iso,
      rawText: iso,
      anchor: "https://example.test/page#posted",
      contentHash: "sha256:dead",
    };
  }

  it("passes a date within both bounds", () => {
    const failures = checkShapeAssertions(
      dateCandidate("2026-09-11T00:00:00.000Z"),
      extractor,
      new Date("2026-09-12T00:00:00Z"),
    );
    expect(failures).toEqual([]);
  });

  it("maxFutureDays: rejects a date more than N days past now", () => {
    const failures = checkShapeAssertions(
      dateCandidate("2026-09-20T00:00:00.000Z"), // 8 days past "now" below, limit is 1
      extractor,
      new Date("2026-09-12T00:00:00Z"),
    );
    expect(failures).toEqual([{ rule: "maxFutureDays", message: expect.any(String) }]);
  });

  it("maxFutureDays: the same date passes once the clock advances past it (ADR-011 asymmetry)", () => {
    const failures = checkShapeAssertions(
      dateCandidate("2026-09-20T00:00:00.000Z"),
      extractor,
      new Date("2026-09-25T00:00:00Z"), // now later than the value + tolerance
    );
    expect(failures).toEqual([]);
  });

  it("notBefore: rejects a date earlier than the floor", () => {
    const failures = checkShapeAssertions(
      dateCandidate("2019-06-01T00:00:00.000Z"),
      extractor,
      new Date("2026-09-12T00:00:00Z"),
    );
    expect(failures).toEqual([{ rule: "notBefore", message: expect.any(String) }]);
  });
});

describe("ADR-018 — expectMonotonic applies to dates via epoch-ms comparison", () => {
  function buildDateTarget() {
    return buildTarget({
      selector: "#posted",
      type: "date",
      assert: { expectMonotonic: "increasing" },
    });
  }

  function previousDateBlock(iso: string) {
    return {
      key: "ex1",
      label: "Extractor 1",
      type: "date" as const,
      presenter: "metric" as const,
      status: "ok" as const,
      value: iso,
      displayValue: iso,
      provenance: {
        sourceUrl: "https://example.test/page",
        anchor: "#posted",
        extractedAt: "2026-09-01T00:00:00.000Z",
        rawText: iso,
        contentHash: "sha256:prev",
      },
      delta: null,
      validation: { passed: true, warnings: [] },
    };
  }

  it("trips when the new date is earlier than the previous one", async () => {
    const target = buildDateTarget();
    const handler = new HtmlHandler();
    const doc = handler.parse({
      body: "<html><body><span id='posted'>2026-09-01</span></body></html>",
      httpStatus: 200,
      fetchedAt: new Date().toISOString(),
    });

    await withAckStore(async (acks) => {
      const result = await processExtractor({
        handler,
        doc,
        extractor: target.extractors[0]!,
        target,
        previousBlock: previousDateBlock("2026-09-11T00:00:00.000Z"),
        acknowledgements: acks,
        now: new Date("2026-09-12T00:00:00Z"),
        httpStatus: 200,
      });
      expect(result.block.status).toBe("flagged");
      expect(result.block.value).toBe("2026-09-11T00:00:00.000Z"); // prior value retained
      expect(result.healthEntryDraft?.errorClass).toBe("CHANGE_GUARD_TRIPPED");
    });
  });

  it("ADR-012: a matching acknowledgement releases a tripped date guard", async () => {
    const target = buildDateTarget();
    const handler = new HtmlHandler();
    const doc = handler.parse({
      body: "<html><body><span id='posted'>2026-09-01</span></body></html>",
      httpStatus: 200,
      fetchedAt: new Date().toISOString(),
    });
    const candidate = await extractOne(handler, doc, target.extractors[0]!, target);

    await withAckStore(async (acks) => {
      // @ts-expect-error accessing private state for the test seed
      acks.acknowledgements = [
        {
          targetId: target.id,
          extractorKey: "ex1",
          contentHash: candidate.contentHash,
          reason: "confirmed backdated post",
          acknowledgedBy: "test",
          acknowledgedAt: "2026-09-12T00:00:00.000Z",
        },
      ];
      const result = await processExtractor({
        handler,
        doc,
        extractor: target.extractors[0]!,
        target,
        previousBlock: previousDateBlock("2026-09-11T00:00:00.000Z"),
        acknowledgements: acks,
        now: new Date("2026-09-12T00:00:00Z"),
        httpStatus: 200,
      });
      expect(result.block.status).toBe("ok");
      expect(result.block.value).toBe("2026-09-01T00:00:00.000Z");
      expect(result.consumedAcknowledgement).not.toBeNull();
    });
  });

  it("does not trip when the new date is later than the previous one", async () => {
    const target = buildDateTarget();
    const handler = new HtmlHandler();
    const doc = handler.parse({
      body: "<html><body><span id='posted'>2026-09-15</span></body></html>",
      httpStatus: 200,
      fetchedAt: new Date().toISOString(),
    });

    await withAckStore(async (acks) => {
      const result = await processExtractor({
        handler,
        doc,
        extractor: target.extractors[0]!,
        target,
        previousBlock: previousDateBlock("2026-09-11T00:00:00.000Z"),
        acknowledgements: acks,
        now: new Date("2026-09-16T00:00:00Z"),
        httpStatus: 200,
      });
      expect(result.block.status).toBe("ok");
      expect(result.block.value).toBe("2026-09-15T00:00:00.000Z");
    });
  });
});
