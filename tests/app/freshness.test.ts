// M1 exit criterion: "the freshness badge changes state as the clock
// advances (test with a fake clock)". computeFreshness is a pure function
// taking an injected `now` for exactly this reason (01-DATA-CONTRACT.md §5:
// "Never baked into the data files").
import { describe, expect, it } from "vitest";
import { computeFreshness } from "../../src/app/lib/freshness.js";
import type { ScalarBlock } from "../../src/contract/block.js";

const EXTRACTED_AT = "2026-09-01T00:00:00Z";
const TTL_HOURS = 168; // 7 days, matching bluecore-newsroom

function block(overrides: Partial<ScalarBlock> = {}): ScalarBlock {
  return {
    key: "latest_headline",
    label: "Latest Headline",
    type: "string",
    presenter: "markdown",
    status: "ok",
    value: "hello",
    displayValue: "hello",
    provenance: {
      sourceUrl: "https://example.test",
      anchor: "p",
      extractedAt: EXTRACTED_AT,
      rawText: "hello",
      contentHash: "sha256:aabbcc",
    },
    delta: null,
    validation: { passed: true, warnings: [] },
    ...overrides,
  };
}

describe("computeFreshness -- the freshness state machine, driven by a fake clock", () => {
  it("never: no block", () => {
    expect(
      computeFreshness({ now: new Date(EXTRACTED_AT), block: undefined, ttlHours: TTL_HOURS }),
    ).toBe("never");
  });

  it("never: status missing", () => {
    expect(
      computeFreshness({
        now: new Date(EXTRACTED_AT),
        block: block({ status: "missing", provenance: null, delta: null }),
        ttlHours: TTL_HOURS,
      }),
    ).toBe("never");
  });

  it("fresh: just extracted", () => {
    expect(
      computeFreshness({ now: new Date(EXTRACTED_AT), block: block(), ttlHours: TTL_HOURS }),
    ).toBe("fresh");
  });

  it("fresh: age exactly at ttl boundary is still fresh (age <= ttl)", () => {
    const now = new Date(new Date(EXTRACTED_AT).getTime() + TTL_HOURS * 3_600_000);
    expect(computeFreshness({ now, block: block(), ttlHours: TTL_HOURS })).toBe("fresh");
  });

  it("stale: just past ttl", () => {
    const now = new Date(new Date(EXTRACTED_AT).getTime() + (TTL_HOURS + 1) * 3_600_000);
    expect(computeFreshness({ now, block: block(), ttlHours: TTL_HOURS })).toBe("stale");
  });

  it("stale: just under the 3x ceiling", () => {
    const now = new Date(new Date(EXTRACTED_AT).getTime() + TTL_HOURS * 3 * 3_600_000 - 1);
    expect(computeFreshness({ now, block: block(), ttlHours: TTL_HOURS })).toBe("stale");
  });

  it("expired: just past the 3x ceiling", () => {
    const now = new Date(new Date(EXTRACTED_AT).getTime() + TTL_HOURS * 3 * 3_600_000 + 1);
    expect(computeFreshness({ now, block: block(), ttlHours: TTL_HOURS })).toBe("expired");
  });

  it("expired: honours a custom staleCeilingMultiplier override", () => {
    const now = new Date(new Date(EXTRACTED_AT).getTime() + TTL_HOURS * 2 * 3_600_000 + 1);
    expect(
      computeFreshness({ now, block: block(), ttlHours: TTL_HOURS, staleCeilingMultiplier: 2 }),
    ).toBe("expired");
  });

  it("failing: block.status cached, still within ttl", () => {
    expect(
      computeFreshness({
        now: new Date(EXTRACTED_AT),
        block: block({ status: "cached" }),
        ttlHours: TTL_HOURS,
      }),
    ).toBe("failing");
  });

  it("failing takes precedence over stale (co-occurrence, per 04-FRONTEND.md §3)", () => {
    const now = new Date(new Date(EXTRACTED_AT).getTime() + (TTL_HOURS + 1) * 3_600_000);
    expect(computeFreshness({ now, block: block({ status: "cached" }), ttlHours: TTL_HOURS })).toBe(
      "failing",
    );
  });

  it("expired takes precedence even over a failing (cached) block once past the ceiling", () => {
    const now = new Date(new Date(EXTRACTED_AT).getTime() + TTL_HOURS * 3 * 3_600_000 + 1);
    expect(computeFreshness({ now, block: block({ status: "cached" }), ttlHours: TTL_HOURS })).toBe(
      "expired",
    );
  });

  it("flagged: block.status flagged", () => {
    expect(
      computeFreshness({
        now: new Date(EXTRACTED_AT),
        block: block({ status: "flagged" }),
        ttlHours: TTL_HOURS,
      }),
    ).toBe("flagged");
  });

  it("the same block transitions fresh -> stale -> expired purely as the injected clock advances", () => {
    const b = block();
    const t0 = new Date(EXTRACTED_AT);
    const t1 = new Date(t0.getTime() + (TTL_HOURS + 1) * 3_600_000);
    const t2 = new Date(t0.getTime() + TTL_HOURS * 3 * 3_600_000 + 1);
    expect(computeFreshness({ now: t0, block: b, ttlHours: TTL_HOURS })).toBe("fresh");
    expect(computeFreshness({ now: t1, block: b, ttlHours: TTL_HOURS })).toBe("stale");
    expect(computeFreshness({ now: t2, block: b, ttlHours: TTL_HOURS })).toBe("expired");
  });
});
