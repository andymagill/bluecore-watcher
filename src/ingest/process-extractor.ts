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
  } as ScalarBlock;
}

function cachedBlock(previousBlock: Block): Block {
  return {
    ...previousBlock,
    status: "cached",
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
): ProcessExtractorResult {
  return {
    block: previousBlock ? cachedBlock(previousBlock) : missingBlock(extractor),
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
    );
  }

  // Enum membership is a shape assertion in spirit (02-CONFIG-SCHEMA.md:
  // "anything else -> ASSERTION_FAILED") even though it's driven by `type`
  // rather than `assert`.
  const enumFailures =
    candidate.presenter !== "list"
      ? checkEnum((candidate as ScalarCandidate).value as string, extractor)
      : [];
  const shapeFailures = [...checkShapeAssertions(candidate, extractor), ...enumFailures];
  if (shapeFailures.length > 0) {
    return failureResult(
      target,
      extractor,
      previousBlock,
      "ASSERTION_FAILED",
      shapeFailures.map((f) => `${f.rule}: ${f.message}`).join("; "),
      extractor.kind === "html" ? extractor.selector : extractor.jsonPath,
      httpStatus,
    );
  }

  const previousProvenance = previousBlock?.provenance ?? null;
  const unchanged =
    previousProvenance !== null && previousProvenance.contentHash === candidate.contentHash;

  if (unchanged && previousBlock && previousBlock.provenance) {
    // Re-verified, nothing moved: extractedAt advances honestly (ADR-011),
    // delta is carried forward untouched (01-DATA-CONTRACT.md §4, corrected).
    // The two branches are identical in substance -- the split exists because
    // TS can't narrow the Block union through an object spread, so a single
    // branch produces a provenance type that's a union of both shapes rather
    // than the one matching `presenter`.
    const block: Block =
      previousBlock.presenter === "list"
        ? {
            ...previousBlock,
            status: "ok",
            provenance: { ...previousBlock.provenance, extractedAt: nowIso },
            validation: { passed: true, warnings: [] },
          }
        : {
            ...previousBlock,
            status: "ok",
            provenance: { ...previousBlock.provenance, extractedAt: nowIso },
            validation: { passed: true, warnings: [] },
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
            (candidate as ScalarCandidate).value as number,
            previousBlock.value as number,
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
        validation: {
          passed: false,
          warnings: [
            {
              guard: guardTrip.rule,
              rejectedCandidate: candidate.value,
              retainedValue: previousBlock!.value as string | number | string[],
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
    const previousValues =
      previousBlock && previousBlock.value !== null ? (previousBlock.value as string[]) : [];
    const delta = previousBlock ? computeSetDelta(c.value, previousValues, nowIso) : null;
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
  };
  return { block, healthEntryDraft: null };
}
