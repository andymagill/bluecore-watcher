// Ties extract -> shape-assert -> change-guard/acknowledgement -> diff into
// one Block per extractor, per run. This is the heart of 03-INGESTION.md §1
// "validate" and "diff", and the M0.5 offline dry run exercises it directly.
import type { ErrorClass } from "../contract/health.js";
import type { Block, ListBlock, ScalarBlock } from "../contract/block.js";
import type { ExtractorDef, TargetDef } from "../config/schema.js";
import type { Acknowledgement } from "../contract/acknowledgements.js";
import { IngestError, toErrorClass } from "./errors.js";
import {
  extractOne,
  type Candidate,
  type ListCandidate,
  type ScalarCandidate,
} from "./extract/pipeline.js";
import type { ExtractHandler } from "./extract/types.js";
import {
  checkEnum,
  checkListCountGuard,
  checkScalarGuard,
  checkShapeAssertions,
} from "./validate.js";
import { computeScalarDelta, computeSetDelta } from "./diff.js";
import type { AcknowledgementStore } from "./acknowledgements.js";
import { extractorLocatorOf } from "./extract/locator.js";

export interface HealthEntryDraft {
  targetId: string;
  extractorKey: string;
  status: "failed" | "flagged";
  errorClass: ErrorClass;
  message: string;
  failingSelector: string | null;
  httpStatus: number | null;
}

export interface ProcessExtractorResult {
  block: Block;
  healthEntryDraft: HealthEntryDraft | null;
  consumedAcknowledgement: Acknowledgement | null;
}

interface ProcessExtractorParams<TDoc> {
  handler: ExtractHandler<TDoc>;
  doc: TDoc;
  extractor: ExtractorDef;
  target: TargetDef;
  previousBlock: Block | null;
  acknowledgements: AcknowledgementStore;
  now: Date;
  httpStatus: number;
}

// checkScalarGuard only ever compares numbers (validate.ts). A scalar
// candidate/previous value is already a number for every type except
// "date", which coerce.ts always renders as a full ISO instant string --
// convert that to epoch milliseconds so expectMonotonic (ADR-018, the only
// guard rule config validation permits on a date, per rule 8) can compare
// it the same way it compares a plain number.
export function guardComparisonValue(value: number | string, extractor: ExtractorDef): number {
  return extractor.type === "date" ? Date.parse(value as string) : (value as number);
}

function emptyBlockCommon(extractor: ExtractorDef) {
  return { key: extractor.key, label: extractor.label, type: extractor.type, unit: extractor.unit };
}

function missingBlock(extractor: ExtractorDef): Block {
  const common = emptyBlockCommon(extractor);
  if (extractor.presenter === "list") {
    return {
      ...common,
      presenter: "list",
      status: "missing",
      value: null,
      displayValue: null,
      provenance: null,
      delta: null,
      validation: { passed: false, warnings: [] },
      failingSince: null,
    } as ListBlock;
  }
  return {
    ...common,
    presenter: extractor.presenter as ScalarBlock["presenter"],
    status: "missing",
    value: null,
    displayValue: null,
    provenance: null,
    delta: null,
    validation: { passed: false, warnings: [] },
    failingSince: null,
  } as ScalarBlock;
}

// M3c — failingSince is stamped the first run a block turns cached (nowIso),
// then carried forward unchanged on every subsequent failing run via
// `previousBlock.failingSince ?? nowIso`: if the previous block wasn't
// already cached, its failingSince is null, so this naturally stamps fresh.
function cachedBlock(previousBlock: Block, nowIso: string): Block {
  return {
    ...previousBlock,
    status: "cached",
    failingSince: previousBlock.failingSince ?? nowIso,
    validation: { passed: false, warnings: previousBlock.validation.warnings },
  };
}

function failureResult(
  target: TargetDef,
  extractor: ExtractorDef,
  previousBlock: Block | null,
  errorClass: ErrorClass,
  message: string,
  failingSelector: string | null,
  httpStatus: number | null,
  nowIso: string,
): ProcessExtractorResult {
  return {
    block: previousBlock ? cachedBlock(previousBlock, nowIso) : missingBlock(extractor),
    healthEntryDraft: {
      targetId: target.id,
      extractorKey: extractor.key,
      status: "failed",
      errorClass,
      message,
      failingSelector,
      httpStatus,
    },
    consumedAcknowledgement: null,
  };
}

export async function processExtractor<TDoc>(
  params: ProcessExtractorParams<TDoc>,
): Promise<ProcessExtractorResult> {
  const { handler, doc, extractor, target, previousBlock, acknowledgements, now, httpStatus } =
    params;
  const nowIso = now.toISOString();

  let candidate: Candidate;
  try {
    candidate = await extractOne(handler, doc, extractor, target);
  } catch (err) {
    const ingestErr = err instanceof IngestError ? err : null;
    return failureResult(
      target,
      extractor,
      previousBlock,
      toErrorClass(err),
      ingestErr?.message ?? String(err),
      ingestErr?.failingSelector ?? null,
      httpStatus,
      nowIso,
    );
  }

  // Enum membership is a shape assertion in spirit (02-CONFIG-SCHEMA.md:
  // "anything else -> ASSERTION_FAILED") even though it's driven by `type`
  // rather than `assert`.
  const enumFailures =
    candidate.presenter !== "list"
      ? checkEnum((candidate as ScalarCandidate).value as string, extractor)
      : [];
  const shapeFailures = [...checkShapeAssertions(candidate, extractor, now), ...enumFailures];
  if (shapeFailures.length > 0) {
    return failureResult(
      target,
      extractor,
      previousBlock,
      "ASSERTION_FAILED",
      shapeFailures.map((f) => `${f.rule}: ${f.message}`).join("; "),
      extractorLocatorOf(extractor),
      httpStatus,
      nowIso,
    );
  }

  const previousProvenance = previousBlock?.provenance ?? null;
  const unchanged =
    previousProvenance !== null && previousProvenance.contentHash === candidate.contentHash;

  if (unchanged && previousBlock && previousBlock.provenance) {
    // Re-verified, nothing moved: extractedAt advances honestly (ADR-011),
    // delta is carried forward untouched (01-DATA-CONTRACT.md §4, corrected).
    // value/displayValue come from the fresh candidate, not previousBlock —
    // ADR-022/025: a composite's contentHash hashes the raw pre-transform
    // field values, so a template/valueMap-only edit leaves `unchanged` true
    // even though the composed value/displayValue changed. Carrying the
    // *previous* value forward would silently un-apply that edit. For every
    // non-composite extractor, candidate.value/displayValue already equal
    // previousBlock's here (same rawText, same deterministic transform), so
    // this is a no-op for them.
    // The two branches are identical in substance -- the split exists because
    // TS can't narrow the Block union through an object spread, so a single
    // branch produces a provenance type that's a union of both shapes rather
    // than the one matching `presenter`.
    const block: Block =
      previousBlock.presenter === "list"
        ? {
            ...previousBlock,
            status: "ok",
            value: (candidate as ListCandidate).value,
            displayValue: (candidate as ListCandidate).displayValue,
            provenance: { ...previousBlock.provenance, extractedAt: nowIso },
            validation: { passed: true, warnings: [] },
            failingSince: null, // recovered, if it was cached
          }
        : {
            ...previousBlock,
            status: "ok",
            value: (candidate as ScalarCandidate).value,
            displayValue: (candidate as ScalarCandidate).displayValue,
            provenance: { ...previousBlock.provenance, extractedAt: nowIso },
            validation: { passed: true, warnings: [] },
            failingSince: null, // recovered, if it was cached
          };
    return { block, healthEntryDraft: null, consumedAcknowledgement: null };
  }

  // Value changed, or first extraction ever (previousBlock is null).
  const guardTrip =
    previousBlock && previousBlock.value !== null
      ? candidate.presenter === "list"
        ? checkListCountGuard(
            (candidate as ListCandidate).value.length,
            (previousBlock.value as string[]).length,
            extractor.assert ?? {},
          )
        : checkScalarGuard(
            guardComparisonValue((candidate as ScalarCandidate).value, extractor),
            guardComparisonValue(previousBlock.value as number | string, extractor),
            extractor.assert ?? {},
          )
      : null;

  if (guardTrip) {
    const ack = acknowledgements.find(target.id, extractor.key, candidate.contentHash);
    if (!ack) {
      // Quarantined: keep displaying the prior value, record both figures.
      const block: Block = {
        ...previousBlock!,
        status: "flagged",
        failingSince: null, // a guard trip isn't an extraction failure
        validation: {
          passed: false,
          warnings: [
            {
              guard: guardTrip.rule,
              rejectedCandidate: candidate.value,
              retainedValue: previousBlock!.value as string | number | string[],
              rejectedContentHash: candidate.contentHash,
            },
          ],
        },
      };
      return {
        block,
        healthEntryDraft: {
          targetId: target.id,
          extractorKey: extractor.key,
          status: "flagged",
          errorClass: "CHANGE_GUARD_TRIPPED",
          message: `${guardTrip.rule}: ${guardTrip.message}`,
          failingSelector: null,
          httpStatus,
        },
        consumedAcknowledgement: null,
      };
    }
    // Acknowledged (ADR-012): fall through to publish, consuming the entry.
    return {
      ...publish(candidate, extractor, target, previousBlock, nowIso),
      consumedAcknowledgement: ack,
    };
  }

  return {
    ...publish(candidate, extractor, target, previousBlock, nowIso),
    consumedAcknowledgement: null,
  };
}

function publish(
  candidate: Candidate,
  extractor: ExtractorDef,
  target: TargetDef,
  previousBlock: Block | null,
  nowIso: string,
): Pick<ProcessExtractorResult, "block" | "healthEntryDraft"> {
  const common = emptyBlockCommon(extractor);

  if (candidate.presenter === "list") {
    const c = candidate as ListCandidate;
    // Row identity for the diff is rawText (ADR-025) — the previous block's
    // own provenance.rawText, not its displayed `value` — so a
    // template/valueMap-only edit (which changes value but not rawText)
    // produces no added/removed churn.
    const previousRawText =
      previousBlock && previousBlock.provenance
        ? (previousBlock.provenance.rawText as string[])
        : [];
    const delta = previousBlock
      ? computeSetDelta(c.rawText, previousRawText, nowIso, extractor.limit)
      : null;
    const block: ListBlock = {
      ...common,
      presenter: "list",
      status: "ok",
      value: c.value,
      displayValue: c.displayValue,
      provenance: {
        sourceUrl: target.url,
        anchor: c.anchor,
        extractedAt: nowIso,
        rawText: c.rawText,
        contentHash: c.contentHash,
      },
      delta,
      validation: { passed: true, warnings: [] },
      failingSince: null,
    };
    return { block, healthEntryDraft: null };
  }

  const c = candidate as ScalarCandidate;
  const delta =
    previousBlock && previousBlock.value !== null
      ? computeScalarDelta(
          c.value,
          previousBlock.value as number | string,
          previousBlock.provenance!.extractedAt,
          nowIso,
        )
      : null;
  const block: ScalarBlock = {
    ...common,
    presenter: candidate.presenter,
    status: "ok",
    value: c.value,
    displayValue: c.displayValue,
    provenance: {
      sourceUrl: target.url,
      anchor: c.anchor,
      extractedAt: nowIso,
      rawText: c.rawText,
      contentHash: c.contentHash,
    },
    delta,
    validation: { passed: true, warnings: [] },
    failingSince: null,
  };
  return { block, healthEntryDraft: null };
}
