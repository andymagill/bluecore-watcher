// docs/plans/m3-operability.md M3b — for each relocation candidate, run the
// real extraction pipeline against the new fixture, then the same shape
// assertions/change guards a live run would apply, ranking every candidate
// by whether it's trustworthy, not just whether it matches something.
// Reuses extractOne (src/ingest/extract/pipeline.ts) and
// checkShapeAssertions/checkEnum/checkScalarGuard/checkListCountGuard
// (src/ingest/validate.ts) exactly as process-extractor.ts does for a real
// run -- a candidate that "passes" here is a candidate the real pipeline
// would also accept.
import type { ExtractorDef, TargetDef } from "../config/schema.js";
import type { Block } from "../contract/block.js";
import type { ExtractHandler } from "../ingest/extract/types.js";
import {
  extractOne,
  type Candidate,
  type ListCandidate,
  type ScalarCandidate,
} from "../ingest/extract/pipeline.js";
import {
  checkEnum,
  checkListCountGuard,
  checkScalarGuard,
  checkShapeAssertions,
} from "../ingest/validate.js";
import { guardComparisonValue } from "../ingest/process-extractor.js";
import { IngestError } from "../ingest/errors.js";
import { locatorOf, type LocationPatch, type RelocationCandidate } from "./relocate.js";

export type CandidateStatus =
  "pass" | "extract-failed" | "assertion-failed" | "guard-tripped" | "unsupported";

export interface ScoredCandidate {
  patch: LocationPatch;
  basis: string;
  status: CandidateStatus;
  matchCount: number | null;
  value: Candidate["value"] | null;
  displayValue: string | string[] | null;
  /** Failure reason, or empty on pass. */
  detail: string;
}

export interface ScoreCandidatesParams<TDoc> {
  target: TargetDef;
  extractor: ExtractorDef;
  handler: ExtractHandler<TDoc>;
  newDoc: TDoc;
  candidates: readonly RelocationCandidate[];
  /** The previously committed block, or null if this extractor never published. */
  previousBlock: Block | null;
  now: Date;
}

function applyPatch(extractor: ExtractorDef, patch: LocationPatch): ExtractorDef {
  if (extractor.kind === "html" && "selector" in patch) {
    return { ...extractor, selector: patch.selector };
  }
  if (extractor.kind === "api" && "jsonPath" in patch) {
    return { ...extractor, jsonPath: patch.jsonPath };
  }
  return extractor;
}

// 0 (identical) to 1 (unrelated) -- lower is better. Absent a previous
// value there's nothing to be close to, so every candidate is treated
// equally (this only breaks ties among otherwise-equal candidates).
function closeness(candidate: Candidate, previousBlock: Block | null): number {
  if (!previousBlock || previousBlock.value === null) return 0;
  if (previousBlock.provenance && candidate.contentHash === previousBlock.provenance.contentHash) {
    return 0;
  }
  if (candidate.presenter === "list") {
    const prev = new Set((previousBlock.value as string[]) ?? []);
    const cur = new Set((candidate as ListCandidate).value);
    if (prev.size === 0 && cur.size === 0) return 0;
    const intersection = [...cur].filter((v) => prev.has(v)).length;
    const union = new Set([...prev, ...cur]).size;
    return union === 0 ? 0 : 1 - intersection / union;
  }
  const curVal = (candidate as ScalarCandidate).value;
  const prevVal = previousBlock.value;
  if (typeof curVal === "number" && typeof prevVal === "number") {
    if (prevVal === 0) return curVal === 0 ? 0 : 1;
    return Math.min(1, Math.abs(curVal - prevVal) / Math.abs(prevVal));
  }
  return curVal === prevVal ? 0 : 1;
}

function lastPathSegment(jsonPath: string): string | null {
  const m = /\.([A-Za-z0-9_$]+)$|\['([^']+)'\]$/.exec(jsonPath);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

// 0 if the candidate's jsonPath's final key matches the old jsonPath's
// final key -- a relocation that kept the same field name (just moved) is
// more trustworthy than one that landed on a differently-named field with
// a coincidentally equal value.
function apiKeyMatchRank(extractor: ExtractorDef, patch: LocationPatch): number {
  // extractor.jsonPath is undefined for a composite/indexed location (ADR-022);
  // scoreCandidates already short-circuits those before ranking is ever
  // reached, but the type no longer guarantees it, so guard here too.
  if (extractor.kind !== "api" || extractor.jsonPath === undefined || !("jsonPath" in patch))
    return 1;
  const oldKey = lastPathSegment(extractor.jsonPath);
  const newKey = lastPathSegment(patch.jsonPath);
  return oldKey !== null && oldKey === newKey ? 0 : 1;
}

// 2 = a positional selector that breaks on the next reorder (nth-child,
// nth-of-type, :eq/:nth/:lt/:gt). 1 = a light positional pseudo a config
// might use deliberately (:first/:last, e.g. "the latest post"). 0 = no
// positional token at all.
function positionalPenalty(locator: string): number {
  if (/nth-child|nth-of-type|:eq\(|:nth\(|:lt\(|:gt\(/.test(locator)) return 2;
  if (/:first|:last/.test(locator)) return 1;
  return 0;
}

function rankKey(
  status: CandidateStatus,
  matchCount: number | null,
  candidate: Candidate | null,
  patch: LocationPatch,
  extractor: ExtractorDef,
  previousBlock: Block | null,
): readonly number[] {
  const passRank = status === "pass" ? 0 : 1;
  const matchRank = extractor.presenter === "list" || matchCount === 1 ? 0 : 1;
  const closenessRank = candidate ? closeness(candidate, previousBlock) : 1;
  const keyRank = apiKeyMatchRank(extractor, patch);
  const posRank = positionalPenalty(locatorOf(patch));
  return [passRank, matchRank, closenessRank, keyRank, posRank];
}

function compareRankKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function scoreCandidates<TDoc>(
  params: ScoreCandidatesParams<TDoc>,
): Promise<ScoredCandidate[]> {
  const { target, extractor, handler, newDoc, candidates, previousBlock, now } = params;

  // ADR-022 — a composite (fields+template) or indexed api location has no
  // single locator to relocate automatically; relocate.ts already declines
  // to propose candidates for these, but a hand-supplied one (e.g.
  // `repair:verify --json-path`) shouldn't be silently patched into an
  // extractor that would then carry both a `jsonPath` and `fields`/`index`
  // — an invalid, mutually-exclusive shape per config rule 13. Surface the
  // limitation explicitly instead.
  if (
    extractor.kind === "api" &&
    (extractor.fields !== undefined || extractor.index !== undefined)
  ) {
    return [
      {
        patch: { jsonPath: "(unsupported — composite/indexed api location)" },
        basis: "unsupported",
        status: "unsupported",
        matchCount: null,
        value: null,
        displayValue: null,
        detail:
          `extractor "${extractor.key}" uses a composite/indexed api location ` +
          "(fields+template or index) — automatic relocation isn't supported for these; " +
          "repair config/*.config.ts by hand (ADR-022).",
      },
    ];
  }

  const scored: { result: ScoredCandidate; key: readonly number[] }[] = [];

  for (const { patch, basis } of candidates) {
    const patched = applyPatch(extractor, patch);
    const located = handler.locate(newDoc, patched, target);
    const matchCount = located.matchCount;

    let candidate: Candidate | null = null;
    let status: CandidateStatus = "pass";
    let detail = "";

    try {
      candidate = await extractOne(handler, newDoc, patched, target);
    } catch (err) {
      status = "extract-failed";
      detail = err instanceof IngestError ? `${err.errorClass}: ${err.message}` : String(err);
    }

    if (candidate) {
      const enumFailures =
        candidate.presenter !== "list"
          ? checkEnum((candidate as ScalarCandidate).value as string, patched)
          : [];
      const shapeFailures = [...checkShapeAssertions(candidate, patched, now), ...enumFailures];
      if (shapeFailures.length > 0) {
        status = "assertion-failed";
        detail = shapeFailures.map((f) => `${f.rule}: ${f.message}`).join("; ");
      } else if (previousBlock && previousBlock.value !== null) {
        const guardTrip =
          candidate.presenter === "list"
            ? checkListCountGuard(
                (candidate as ListCandidate).value.length,
                (previousBlock.value as string[]).length,
                extractor.assert ?? {},
              )
            : checkScalarGuard(
                guardComparisonValue((candidate as ScalarCandidate).value, extractor),
                guardComparisonValue(previousBlock.value as number | string, extractor),
                extractor.assert ?? {},
              );
        if (guardTrip) {
          status = "guard-tripped";
          detail = `${guardTrip.rule}: ${guardTrip.message}`;
        }
      }
    }

    scored.push({
      result: {
        patch,
        basis,
        status,
        matchCount,
        value: candidate?.value ?? null,
        displayValue: candidate?.displayValue ?? null,
        detail,
      },
      key: rankKey(status, matchCount, candidate, patch, extractor, previousBlock),
    });
  }

  scored.sort((a, b) => compareRankKeys(a.key, b.key));
  return scored.map((s) => s.result);
}

export function anyPassed(scored: readonly ScoredCandidate[]): boolean {
  return scored.some((s) => s.status === "pass");
}
