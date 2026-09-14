// 03-INGESTION.md §5 "weekly drift check" — the early-warning layer that
// catches a source redesign before a selector starts matching the wrong
// node, per that doc's own framing: "even if extraction still succeeds."
//
// Deliberately reuses the real extraction pipeline (getHandler + extractOne,
// exactly what a live ingestion run and scripts/fixture-verify.ts both call)
// rather than a second, drift-specific parser — running the *actual*
// extractor against both the committed fixture (baseline) and a freshly
// fetched live response is what makes EXTRACTION_BROKEN/ANCHOR_MOVED/
// TYPE_CHANGED precise instead of heuristic. Fetching itself (fixture vs.
// live HTTP) is the caller's job — scripts/drift-check.ts for a real run,
// a hand-built FetchResult in tests/drift.test.ts — so this module is pure
// and network-free.
import { JSONPath } from "jsonpath-plus";
import type { ExtractorDef, TargetDef } from "../config/schema.js";
import type { FetchResult } from "../ingest/fetch/types.js";
import { getHandler } from "../ingest/extract/registry.js";
import { extractOne, type Candidate } from "../ingest/extract/pipeline.js";
import { IngestError } from "../ingest/errors.js";
import { htmlSkeleton, jsonShape, jaccardSimilarity, setDiff } from "./structure.js";

export type DriftSignalCode =
  "EXTRACTION_BROKEN" | "ANCHOR_MOVED" | "TYPE_CHANGED" | "STRUCTURE_CHANGED" | "FETCH_FAILED";

export interface DriftSignal {
  code: DriftSignalCode;
  extractorKey: string | null;
  message: string;
}

export interface TargetDriftResult {
  targetId: string;
  signals: DriftSignal[];
}

// Below this, the page/response is different enough to warrant a look even
// though nothing necessarily broke. 0.8 is a starting point, not measured —
// tests/drift.test.ts pins the shape of the check itself, not this number;
// retune here if real runs prove it too sensitive or too quiet.
const STRUCTURE_SIMILARITY_THRESHOLD = 0.8;

// A signal set containing only FETCH_FAILED means the check itself never
// ran (the live fetch failed before there was anything to compare) — that
// is not a drift finding, just a failed attempt. Real ingestion's health
// log already owns fetch failures (03-INGESTION.md §1 "fetch"); this check
// only reports on responses it successfully compared.
export function isDrifting(result: TargetDriftResult): boolean {
  return result.signals.some((s) => s.code !== "FETCH_FAILED");
}

export function fetchFailedResult(targetId: string, message: string): TargetDriftResult {
  return { targetId, signals: [{ code: "FETCH_FAILED", extractorKey: null, message }] };
}

// Deliberately NOT `typeof candidate.value` — coerce.ts (extract/coerce.ts)
// normalizes every extracted value to the extractor's *declared* `type`
// regardless of what the underlying JSON actually held (a JSONPath match
// of `424` for a `type: "string"` extractor still ends up a JS string,
// since ApiHandler stringifies any non-string match before coercion even
// runs); if coercion can't produce that type at all, extraction throws and
// surfaces as EXTRACTION_BROKEN above, not here. So the only way to see the
// underlying value's real type is to re-run the extractor's own jsonPath
// directly and read the first match's raw `typeof`, bypassing coercion.
function rawJsonPathType(doc: unknown, jsonPath: string): string {
  const matches: unknown[] = JSONPath({ path: jsonPath, json: doc as object });
  const first = matches[0];
  if (first === undefined) return "undefined";
  if (first === null) return "null";
  return typeof first;
}

export async function checkTargetDrift(
  target: TargetDef,
  baseline: FetchResult,
  live: FetchResult,
): Promise<TargetDriftResult> {
  const handler = getHandler(target.kind);
  const signals: DriftSignal[] = [];

  const baselineDoc = await handler.parse(baseline);
  const liveDoc = await handler.parse(live);

  const baselineShape =
    target.kind === "html" ? htmlSkeleton(baseline.body) : jsonShape(baselineDoc);
  const liveShape = target.kind === "html" ? htmlSkeleton(live.body) : jsonShape(liveDoc);
  const similarity = jaccardSimilarity(baselineShape, liveShape);
  if (similarity < STRUCTURE_SIMILARITY_THRESHOLD) {
    const { added, removed } = setDiff(baselineShape, liveShape);
    signals.push({
      code: "STRUCTURE_CHANGED",
      extractorKey: null,
      message:
        `structural similarity ${(similarity * 100).toFixed(0)}% (below ${STRUCTURE_SIMILARITY_THRESHOLD * 100}% threshold) — ` +
        `added: ${added.slice(0, 5).join(", ") || "none"}${added.length > 5 ? ", …" : ""}; ` +
        `removed: ${removed.slice(0, 5).join(", ") || "none"}${removed.length > 5 ? ", …" : ""}`,
    });
  }

  for (const extractor of target.extractors) {
    signals.push(...(await checkExtractorDrift(handler, baselineDoc, liveDoc, extractor, target)));
  }

  return { targetId: target.id, signals };
}

async function checkExtractorDrift(
  handler: ReturnType<typeof getHandler>,
  baselineDoc: unknown,
  liveDoc: unknown,
  extractor: ExtractorDef,
  target: TargetDef,
): Promise<DriftSignal[]> {
  let baselineCandidate: Candidate;
  try {
    baselineCandidate = await extractOne(handler, baselineDoc, extractor, target);
  } catch {
    // The fixture itself doesn't extract cleanly — not this run's drift to
    // report. scripts/fixture-verify.ts is what catches a broken
    // fixture/config pairing; comparing a live response against a baseline
    // that's already broken would only produce noise.
    return [];
  }

  let liveCandidate: Candidate;
  try {
    liveCandidate = await extractOne(handler, liveDoc, extractor, target);
  } catch (err) {
    const detail = err instanceof IngestError ? `${err.errorClass}: ${err.message}` : String(err);
    return [
      {
        code: "EXTRACTION_BROKEN",
        extractorKey: extractor.key,
        message: `extracts cleanly from the fixture but fails against the live response: ${detail}`,
      },
    ];
  }

  if (target.kind === "html") {
    const baselineAnchor = JSON.stringify(baselineCandidate.anchor);
    const liveAnchor = JSON.stringify(liveCandidate.anchor);
    if (baselineAnchor !== liveAnchor) {
      return [
        {
          code: "ANCHOR_MOVED",
          extractorKey: extractor.key,
          message:
            "the selector still matches, but the resolved node moved — the page structure around it shifted",
        },
      ];
    }
    return [];
  }

  if (extractor.kind === "api" && extractor.presenter !== "list") {
    const baselineType = rawJsonPathType(baselineDoc, extractor.jsonPath);
    const liveType = rawJsonPathType(liveDoc, extractor.jsonPath);
    if (baselineType !== liveType) {
      return [
        {
          code: "TYPE_CHANGED",
          extractorKey: extractor.key,
          message: `\`${extractor.jsonPath}\` resolved to a JS ${baselineType} in the fixture, ${liveType} live`,
        },
      ];
    }
  }
  return [];
}
