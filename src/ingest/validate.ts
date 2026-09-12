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
export function checkShapeAssertions(candidate: Candidate, extractor: ExtractorDef): AssertionFailure[] {
  const assert = extractor.assert;
  if (!assert) return [];
  const failures: AssertionFailure[] = [];

  if (candidate.presenter === "list") {
    const list = candidate as ListCandidate;
    if (assert.minItems !== undefined && list.value.length < assert.minItems) {
      failures.push({ rule: "minItems", message: `array has ${list.value.length} item(s), fewer than minItems ${assert.minItems}` });
    }
    if (assert.maxItems !== undefined && list.value.length > assert.maxItems) {
      failures.push({ rule: "maxItems", message: `array has ${list.value.length} item(s), more than maxItems ${assert.maxItems}` });
    }
    for (const item of list.value) {
      failures.push(...checkScalarShape(item, assert));
    }
    return failures;
  }

  const scalar = candidate as ScalarCandidate;
  return checkScalarShape(scalar.value, assert);
}

function checkScalarShape(value: number | string, assert: NonNullable<ExtractorDef["assert"]>): AssertionFailure[] {
  const failures: AssertionFailure[] = [];
  if (assert.notEmpty && (value === "" || value === null || value === undefined)) {
    failures.push({ rule: "notEmpty", message: "value is empty" });
  }
  if (typeof value === "number") {
    if (assert.min !== undefined && value < assert.min) failures.push({ rule: "min", message: `${value} < min ${assert.min}` });
    if (assert.max !== undefined && value > assert.max) failures.push({ rule: "max", message: `${value} > max ${assert.max}` });
  }
  if (typeof value === "string") {
    if (assert.maxLength !== undefined && value.length > assert.maxLength) {
      failures.push({ rule: "maxLength", message: `length ${value.length} > maxLength ${assert.maxLength}` });
    }
    if (assert.pattern !== undefined && !new RegExp(assert.pattern).test(value)) {
      failures.push({ rule: "pattern", message: `"${value}" does not match pattern ${assert.pattern}` });
    }
  }
  return failures;
}

export function checkEnum(value: string, extractor: ExtractorDef): AssertionFailure[] {
  if (extractor.type !== "enum" || !extractor.enumValues) return [];
  if (!extractor.enumValues.includes(value)) {
    return [{ rule: "enumValues", message: `"${value}" is not one of [${extractor.enumValues.join(", ")}]` }];
  }
  return [];
}

// ---- Change-magnitude guards — 01-DATA-CONTRACT.md §6 layer 3 ----

export interface GuardTrip {
  rule: string;
  message: string;
}

export function checkScalarGuard(
  candidateValue: number,
  previousValue: number,
  assert: NonNullable<ExtractorDef["assert"]>,
): GuardTrip | null {
  if (typeof candidateValue !== "number" || typeof previousValue !== "number") return null;

  const absolute = candidateValue - previousValue;
  const percent = previousValue === 0 ? (candidateValue === 0 ? 0 : Infinity) : (absolute / Math.abs(previousValue)) * 100;

  if (assert.maxChangePct !== undefined && Math.abs(percent) > assert.maxChangePct) {
    return { rule: "maxChangePct", message: `moved ${percent.toFixed(1)}%, exceeds maxChangePct ${assert.maxChangePct}%` };
  }
  if (assert.maxChangeAbs !== undefined && Math.abs(absolute) > assert.maxChangeAbs) {
    return { rule: "maxChangeAbs", message: `moved ${absolute}, exceeds maxChangeAbs ${assert.maxChangeAbs}` };
  }
  if (assert.expectMonotonic === "increasing" && candidateValue < previousValue) {
    return { rule: "expectMonotonic", message: `expected increasing, got ${previousValue} -> ${candidateValue}` };
  }
  if (assert.expectMonotonic === "decreasing" && candidateValue > previousValue) {
    return { rule: "expectMonotonic", message: `expected decreasing, got ${previousValue} -> ${candidateValue}` };
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
