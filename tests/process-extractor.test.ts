// M3c — failingSince stamping/carrying/reset on the ingest side. freshness.ts
// tests (tests/app/freshness.test.ts) prove the *client-side* failure-age
// math against hand-built blocks; this proves the *engine* actually stamps,
// carries forward, and resets that field the way freshness.ts assumes.
// Drives the real HtmlHandler + processExtractor across several simulated
// runs, controlling success/failure purely via whether the fixture doc
// contains the matched element (real SELECTOR_NO_MATCH, not a stub).
import { describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import { CmieConfig, type TargetDef } from "../src/config/schema.js";
import { HtmlHandler } from "../src/ingest/extract/html-handler.js";
import { processExtractor } from "../src/ingest/process-extractor.js";
import { AcknowledgementStore } from "../src/ingest/acknowledgements.js";
import type { Block } from "../src/contract/block.js";

const handler = new HtmlHandler();

function target(): TargetDef {
  const cfg = CmieConfig.parse({
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
        schedule: { cron: "0 6 * * *", ttlHours: 2160 },
        extractors: [
          {
            key: "ex1",
            label: "Ex 1",
            presenter: "markdown",
            kind: "html",
            selector: "#value",
            type: "string",
          },
        ],
      },
    ],
  });
  return cfg.targets[0]!;
}

async function emptyAcks(): Promise<AcknowledgementStore> {
  // A path that doesn't exist loads as an empty in-memory store (no
  // filesystem write happens unless .save() is called, which this test
  // never does).
  return AcknowledgementStore.load("/nonexistent/acks.json");
}

async function run(
  html: string,
  previousBlock: Block | null,
  now: Date,
): ReturnType<typeof processExtractor> {
  const t = target();
  const doc = cheerio.load(html);
  return processExtractor({
    handler,
    doc,
    extractor: t.extractors[0]!,
    target: t,
    previousBlock,
    acknowledgements: await emptyAcks(),
    now,
    httpStatus: 200,
  });
}

describe("processExtractor -- M3c failingSince lifecycle", () => {
  it("a fresh success carries failingSince: null", async () => {
    const { block } = await run(
      '<div id="value">hello</div>',
      null,
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(block.status).toBe("ok");
    expect(block.failingSince).toBeNull();
  });

  it("the first failure stamps failingSince to the run it happened", async () => {
    const { block: ok } = await run(
      '<div id="value">hello</div>',
      null,
      new Date("2026-01-01T00:00:00Z"),
    );
    const { block: failed } = await run(
      "<div>no match here</div>",
      ok,
      new Date("2026-01-02T00:00:00Z"),
    );
    expect(failed.status).toBe("cached");
    expect(failed.failingSince).toBe("2026-01-02T00:00:00.000Z");
  });

  it("a second consecutive failure carries failingSince forward unchanged", async () => {
    const { block: ok } = await run(
      '<div id="value">hello</div>',
      null,
      new Date("2026-01-01T00:00:00Z"),
    );
    const { block: failed1 } = await run(
      "<div>no match here</div>",
      ok,
      new Date("2026-01-02T00:00:00Z"),
    );
    const { block: failed2 } = await run(
      "<div>still no match</div>",
      failed1,
      new Date("2026-01-20T00:00:00Z"), // 18 days later
    );
    expect(failed2.status).toBe("cached");
    expect(failed2.failingSince).toBe(failed1.failingSince); // unchanged, not bumped to run 3's time
    expect(failed2.failingSince).toBe("2026-01-02T00:00:00.000Z");
  });

  it("recovery with the same value resets failingSince to null", async () => {
    const { block: ok } = await run(
      '<div id="value">hello</div>',
      null,
      new Date("2026-01-01T00:00:00Z"),
    );
    const { block: failed } = await run(
      "<div>no match here</div>",
      ok,
      new Date("2026-01-02T00:00:00Z"),
    );
    // Same content as the original success -> the "unchanged/reverified"
    // branch in process-extractor.ts, not `publish()`.
    const { block: recovered } = await run(
      '<div id="value">hello</div>',
      failed,
      new Date("2026-01-03T00:00:00Z"),
    );
    expect(recovered.status).toBe("ok");
    expect(recovered.failingSince).toBeNull();
  });

  it("recovery with a changed value also resets failingSince to null", async () => {
    const { block: ok } = await run(
      '<div id="value">hello</div>',
      null,
      new Date("2026-01-01T00:00:00Z"),
    );
    const { block: failed } = await run(
      "<div>no match here</div>",
      ok,
      new Date("2026-01-02T00:00:00Z"),
    );
    const { block: recovered } = await run(
      '<div id="value">a new value</div>',
      failed,
      new Date("2026-01-03T00:00:00Z"),
    );
    expect(recovered.status).toBe("ok");
    expect(recovered.failingSince).toBeNull();
  });
});
