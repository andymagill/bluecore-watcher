// M1 exit criterion: "A value change produces a correct delta chip,
// including the unchanged case ('unchanged for N days')" (01-DATA-CONTRACT
// §4, 04-FRONTEND.md §4).
import { describe, expect, it } from "vitest";
import { computeDeltaDisplay } from "../../src/app/lib/delta.js";
import type { Delta } from "../../src/contract/block.js";

const TTL_HOURS = 168;
const NOW = new Date("2026-09-12T00:00:00Z");

function scalarDelta(overrides: Partial<Extract<Delta, { kind: "scalar" }>> = {}): Delta {
  return {
    kind: "scalar",
    previousValue: 46800,
    previousExtractedAt: "2026-09-04T06:00:07Z",
    changedAt: "2026-09-11T06:00:08Z",
    direction: "up",
    absolute: 1400,
    percent: 2.99,
    ...overrides,
  };
}

function setDelta(overrides: Partial<Extract<Delta, { kind: "set" }>> = {}): Delta {
  return {
    kind: "set",
    added: ["Docket 2024-098: Under Review"],
    removed: [],
    count: 2,
    previousCount: 1,
    changedAt: "2026-09-11T06:00:08Z",
    ...overrides,
  };
}

describe("computeDeltaDisplay", () => {
  it("delta: null -> no chip (first observation)", () => {
    expect(computeDeltaDisplay(NOW, null, TTL_HOURS)).toEqual({ kind: "none" });
  });

  it("scalar delta changed within the ttl window -> 'changed' shape with direction/magnitude", () => {
    // changedAt is ~18h before NOW; well within a 168h ttl window.
    const result = computeDeltaDisplay(NOW, scalarDelta(), TTL_HOURS);
    expect(result.kind).toBe("changed-scalar");
    if (result.kind === "changed-scalar") {
      expect(result.direction).toBe("up");
      expect(result.absolute).toBe(1400);
      expect(result.percent).toBeCloseTo(2.99);
    }
  });

  it("scalar delta older than the ttl window -> 'unchanged for N days'", () => {
    // changedAt 34 days before NOW -- the exact "unchanged for 34 days" case
    // 04-FRONTEND.md §4 calls out.
    const oldChangedAt = new Date(NOW.getTime() - 34 * 86_400_000).toISOString();
    const result = computeDeltaDisplay(NOW, scalarDelta({ changedAt: oldChangedAt }), TTL_HOURS);
    expect(result).toEqual({ kind: "unchanged-scalar", daysAgo: 34 });
  });

  it("set delta changed within the ttl window -> 'changed-set' with added/removed", () => {
    const result = computeDeltaDisplay(NOW, setDelta(), TTL_HOURS);
    expect(result.kind).toBe("changed-set");
    if (result.kind === "changed-set") {
      expect(result.added).toEqual(["Docket 2024-098: Under Review"]);
      expect(result.removed).toEqual([]);
    }
  });

  it("set delta older than the ttl window -> 'unchanged-set'", () => {
    const oldChangedAt = new Date(NOW.getTime() - 10 * 86_400_000).toISOString();
    const result = computeDeltaDisplay(NOW, setDelta({ changedAt: oldChangedAt }), TTL_HOURS);
    expect(result).toEqual({ kind: "unchanged-set", daysAgo: 10 });
  });

  it("the same delta transitions from 'changed' to 'unchanged' purely as the clock advances past the ttl window", () => {
    const delta = scalarDelta();
    const justAfterChange = new Date(new Date(delta.changedAt).getTime() + 3_600_000); // 1h later
    const wellAfterChange = new Date(
      new Date(delta.changedAt).getTime() + (TTL_HOURS + 1) * 3_600_000,
    );
    expect(computeDeltaDisplay(justAfterChange, delta, TTL_HOURS).kind).toBe("changed-scalar");
    expect(computeDeltaDisplay(wellAfterChange, delta, TTL_HOURS).kind).toBe("unchanged-scalar");
  });
});
