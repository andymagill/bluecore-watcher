// 03-INGESTION.md §1 "validate" / 01-DATA-CONTRACT.md §6. Shape assertions
// reject; change guards quarantine (subject to an acknowledgement, ADR-012).
import type { ExtractorDef } from "../config/schema.js";
import type { Candidate, ScalarCandidate, ListCandidate } from "./extract/pipeline.js";

export interface AssertionFailure {
  rule: string;
  message: string;
}

// Shape assertions — 01-DATA-CONTRACT.md §6 layer 1. For `list`, per-item
// checks apply to every item (§4.1); minItems/maxItems bound the array.
// `now` drives the two date-only checks (ADR-018, maxFutureDays/notBefore);
// callers pass a fixed clock (processExtractor's `now` param) so a fake-clock
// test is deterministic and the offline dry run never depends on wall time.
export function checkShapeAssertions(
  candidate: Candidate,
  extractor: ExtractorDef,
  now: Date,
): AssertionFailure[] {
  const assert = extractor.assert;
  if (!assert) return [];
  const failures: AssertionFailure[] = [];
  const isDate = extractor.type === "date";

  if (candidate.presenter === "list") {
    const list = candidate as ListCandidate;
    if (assert.minItems !== undefined && list.value.length < assert.minItems) {
      failures.push({
        rule: "minItems",
        message: `array has ${list.value.length} item(s), fewer than minItems ${assert.minItems}`,
      });
    }
    if (assert.maxItems !== undefined && list.value.length > assert.maxItems) {
      failures.push({
        rule: "maxItems",
        message: `array has ${list.value.length} item(s), more than maxItems ${assert.maxItems}`,
      });
    }
    for (const item of list.value) {
      failures.push(...checkScalarShape(item, assert, false, now));
    }
    return failures;
  }

  const scalar = candidate as ScalarCandidate;
  return checkScalarShape(scalar.value, assert, isDate, now);
}

function checkScalarShape(
  value: number | string,
  assert: NonNullable<ExtractorDef["assert"]>,
  isDate: boolean,
  now: Date,
): AssertionFailure[] {
  const failures: AssertionFailure[] = [];
  if (assert.notEmpty && (value === "" || value === null || value === undefined)) {
    failures.push({ rule: "notEmpty", message: "value is empty" });
  }
  if (typeof value === "number") {
    if (assert.min !== undefined && value < assert.min)
      failures.push({ rule: "min", message: `${value} < min ${assert.min}` });
    if (assert.max !== undefined && value > assert.max)
      failures.push({ rule: "max", message: `${value} > max ${assert.max}` });
  }
  if (typeof value === "string") {
    if (assert.maxLength !== undefined && value.length > assert.maxLength) {
      failures.push({
        rule: "maxLength",
        message: `length ${value.length} > maxLength ${assert.maxLength}`,
      });
    }
    if (assert.pattern !== undefined && !new RegExp(assert.pattern).test(value)) {
      failures.push({
        rule: "pattern",
        message: `"${value}" does not match pattern ${assert.pattern}`,
      });
    }
    // ADR-018 — value is coerce.ts's output for type "date": always a full
    // ISO instant (see coerce.ts), so Date.parse is exact, never a
    // rawText-format guess.
    if (isDate) {
      const instant = Date.parse(value);
      if (assert.maxFutureDays !== undefined) {
        const limit = now.getTime() + assert.maxFutureDays * 24 * 60 * 60 * 1000;
        if (instant > limit) {
          failures.push({
            rule: "maxFutureDays",
            message: `${value} is more than ${assert.maxFutureDays} day(s) past now (${now.toISOString()})`,
          });
        }
      }
      if (assert.notBefore !== undefined) {
        const floor = Date.parse(`${assert.notBefore}T00:00:00.000Z`);
        if (instant < floor) {
          failures.push({
            rule: "notBefore",
            message: `${value} is before notBefore ${assert.notBefore}`,
          });
        }
      }
    }
  }
  return failures;
}

export function checkEnum(value: string, extractor: ExtractorDef): AssertionFailure[] {
  if (extractor.type !== "enum" || !extractor.enumValues) return [];
  if (!extractor.enumValues.includes(value)) {
    return [
      {
        rule: "enumValues",
        message: `"${value}" is not one of [${extractor.enumValues.join(", ")}]`,
      },
    ];
  }
  return [];
}

// ---- Change-magnitude guards — 01-DATA-CONTRACT.md §6 layer 3 ----

export interface GuardTrip {
  rule: string;
  message: string;
}

// For type "date" extractors, callers pass epoch milliseconds (Date.parse
// of the ISO instant coerce.ts always produces), not the ISO string itself
// -- this function only ever compares numbers. Config validation (rule 8,
// ADR-018) restricts a date extractor's assert to expectMonotonic only
// (maxChangePct/maxChangeAbs stay numeric-type-only), so the branches below
// that don't apply to a date simply never trigger for one.
export function checkScalarGuard(
  candidateValue: number,
  previousValue: number,
  assert: NonNullable<ExtractorDef["assert"]>,
): GuardTrip | null {
  if (typeof candidateValue !== "number" || typeof previousValue !== "number") return null;

  const absolute = candidateValue - previousValue;
  const percent =
    previousValue === 0
      ? candidateValue === 0
        ? 0
        : Infinity
      : (absolute / Math.abs(previousValue)) * 100;

  if (assert.maxChangePct !== undefined && Math.abs(percent) > assert.maxChangePct) {
    return {
      rule: "maxChangePct",
      message: `moved ${percent.toFixed(1)}%, exceeds maxChangePct ${assert.maxChangePct}%`,
    };
  }
  if (assert.maxChangeAbs !== undefined && Math.abs(absolute) > assert.maxChangeAbs) {
    return {
      rule: "maxChangeAbs",
      message: `moved ${absolute}, exceeds maxChangeAbs ${assert.maxChangeAbs}`,
    };
  }
  if (assert.expectMonotonic === "increasing" && candidateValue < previousValue) {
    return {
      rule: "expectMonotonic",
      message: `expected increasing, got ${previousValue} -> ${candidateValue}`,
    };
  }
  if (assert.expectMonotonic === "decreasing" && candidateValue > previousValue) {
    return {
      rule: "expectMonotonic",
      message: `expected decreasing, got ${previousValue} -> ${candidateValue}`,
    };
  }
  return null;
}

// For `list`, change guards apply to item count, not to any single item
// (01-DATA-CONTRACT.md §4.1).
export function checkListCountGuard(
  candidateCount: number,
  previousCount: number,
  assert: NonNullable<ExtractorDef["assert"]>,
): GuardTrip | null {
  return checkScalarGuard(candidateCount, previousCount, assert);
}
