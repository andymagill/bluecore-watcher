// 03-INGESTION.md §1 "diff" / 01-DATA-CONTRACT.md §4 (as corrected) and
// §4.1. `delta` is null only on first extraction; every other run either
// recomputes it (value changed) or carries it forward untouched (unchanged).
import type { ScalarDelta, SetDelta } from "../contract/block.js";

export function computeScalarDelta(
  candidateValue: number | string,
  previousValue: number | string,
  previousExtractedAt: string,
  now: string,
): ScalarDelta {
  if (typeof candidateValue === "number" && typeof previousValue === "number") {
    const absolute = candidateValue - previousValue;
    const percent = previousValue === 0 ? 0 : (absolute / Math.abs(previousValue)) * 100;
    return {
      kind: "scalar",
      previousValue,
      previousExtractedAt,
      changedAt: now,
      direction: absolute >= 0 ? "up" : "down",
      absolute,
      percent,
    };
  }
  // Non-numeric (string/date/enum) scalar — there is no notion of direction,
  // so "up" is reported as a change sentinel for any change at all (a
  // downgrade renders identically to an upgrade); absolute/percent are not
  // meaningful, reported as 0.
  return {
    kind: "scalar",
    previousValue,
    previousExtractedAt,
    changedAt: now,
    direction: "up",
    absolute: 0,
    percent: 0,
  };
}

// `candidateValues`/`previousValues` are row *identity* keys (a plain
// list's rawText, or a composite row's stableRawJson — never displayValue),
// per ADR-025: a template/valueMap-only edit changes the rendered row but
// not its identity, so it produces no added/removed churn.
//
// `limit` is the extractor's composite row limit (ADR-025), when set. A
// bounded list that's still full after this run lost exactly
// `added.length` rows off the tail (rows are newest-first by convention)
// purely because new rows pushed them out of the window — not a real
// source-side removal — so those specific rows are excluded from `removed`.
// A row that drops out for any other reason (the window isn't full, i.e.
// the source itself shrank below `limit`) still reports as removed.
export function computeSetDelta(
  candidateValues: string[],
  previousValues: string[],
  now: string,
  limit?: number,
): SetDelta {
  const prevSet = new Set(previousValues);
  const currSet = new Set(candidateValues);
  const added = candidateValues.filter((v) => !prevSet.has(v));
  let removed = previousValues.filter((v) => !currSet.has(v));

  if (
    limit !== undefined &&
    previousValues.length === limit &&
    candidateValues.length === limit &&
    added.length > 0 &&
    removed.length > 0
  ) {
    const removedSet = new Set(removed);
    const evictCount = Math.min(added.length, removed.length);
    const evicted = new Set<string>();
    for (let i = previousValues.length - 1; i >= 0 && evicted.size < evictCount; i--) {
      const v = previousValues[i]!;
      if (removedSet.has(v)) evicted.add(v);
    }
    removed = removed.filter((v) => !evicted.has(v));
  }

  return {
    kind: "set",
    added,
    removed,
    count: candidateValues.length,
    previousCount: previousValues.length,
    changedAt: now,
  };
}
