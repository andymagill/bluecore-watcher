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
  // Non-numeric (string/date/enum) scalar — direction is defined only by
  // simple inequality; absolute/percent are not meaningful, reported as 0.
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

export function computeSetDelta(candidateValues: string[], previousValues: string[], now: string): SetDelta {
  const prevSet = new Set(previousValues);
  const currSet = new Set(candidateValues);
  const added = candidateValues.filter((v) => !prevSet.has(v));
  const removed = previousValues.filter((v) => !currSet.has(v));
  return {
    kind: "set",
    added,
    removed,
    count: candidateValues.length,
    previousCount: previousValues.length,
    changedAt: now,
  };
}
