// 03-INGESTION.md §1 "extract". Kind-agnostic: takes whatever an
// ExtractHandler located and applies narrowing → coercion → formatting →
// provenance, identically regardless of `kind`. Handlers never touch this.
import type { ExtractorDef, TargetDef } from "../../config/schema.js";
import { IngestError } from "../errors.js";
import { coerce, formatDisplayValue, type CoercedValue } from "./coerce.js";
import { hashRawText } from "./provenance.js";
import type { ExtractHandler } from "./types.js";
import { extractorLocatorOf } from "./locator.js";

export interface ScalarCandidate {
  presenter: "metric" | "markdown" | "status";
  value: CoercedValue;
  displayValue: string;
  rawText: string;
  anchor: string;
  contentHash: string;
}

export interface ListCandidate {
  presenter: "list";
  value: string[];
  displayValue: string[];
  rawText: string[];
  anchor: string[];
  contentHash: string;
}

export type Candidate = ScalarCandidate | ListCandidate;

function failingSelectorOf(extractor: ExtractorDef): string {
  return extractorLocatorOf(extractor);
}

function applyRegex(rawText: string, extractor: ExtractorDef): string {
  let text = rawText;
  if (extractor.regex) {
    const re = new RegExp(extractor.regex);
    const match = re.exec(rawText);
    const group = match?.[extractor.regexGroup];
    if (group === undefined) {
      throw new IngestError(
        "PARSE_ERROR",
        `regex "${extractor.regex}" did not match rawText for extractor "${extractor.key}": "${rawText}"`,
        {
          failingSelector: failingSelectorOf(extractor),
        },
      );
    }
    text = group;
  }
  return extractor.trim ? text.trim() : text;
}

export async function extractOne<TDoc>(
  handler: ExtractHandler<TDoc>,
  doc: TDoc,
  extractor: ExtractorDef,
  target: TargetDef,
): Promise<Candidate> {
  const located = handler.locate(doc, extractor, target);
  const isList = extractor.presenter === "list";

  if (!isList) {
    if (located.matchCount === 0) {
      throw new IngestError(
        "SELECTOR_NO_MATCH",
        `Selector matched 0 nodes for extractor "${extractor.key}"`,
        {
          failingSelector: failingSelectorOf(extractor),
        },
      );
    }
    if (located.matchCount > 1) {
      throw new IngestError(
        "SELECTOR_AMBIGUOUS",
        `Selector matched ${located.matchCount} nodes for extractor "${extractor.key}" without multiple: true`,
        { failingSelector: failingSelectorOf(extractor) },
      );
    }
    const rawText = located.rawTexts[0] ?? "";
    const anchor = located.resolvedAnchors[0] ?? "";
    // ADR-022: `texts` is what a composite api location's already-composed
    // markdown string lives in — narrow/coerce that, but keep `rawText`
    // (the raw pre-transform field values) as what's stored and hashed
    // below. Every other handler leaves `texts` unset, so this is a no-op.
    const startText = located.texts?.[0] ?? rawText;
    const narrowed = applyRegex(startText, extractor);
    const value = coerce(narrowed, extractor);
    const displayValue = formatDisplayValue(value, extractor);
    return {
      presenter: extractor.presenter as ScalarCandidate["presenter"],
      value,
      displayValue,
      rawText,
      anchor,
      contentHash: hashRawText(rawText),
    };
  }

  // list presenter — a plain list narrows/coerces `rawText` itself (type
  // "string", identity). ADR-025: a composite row list's `texts[i]` is the
  // already-composed markdown row, distinct from `rawTexts[i]` (the raw
  // pre-transform field snapshot that's stored and hashed below) — the same
  // rawText/texts split ADR-022 introduced for a scalar composite, which
  // this list branch previously ignored.
  const value: string[] = [];
  const displayValue: string[] = [];
  located.rawTexts.forEach((rawText, i) => {
    const startText = located.texts?.[i] ?? rawText;
    const narrowed = applyRegex(startText, extractor);
    const coerced = coerce(narrowed, extractor);
    value.push(String(coerced));
    displayValue.push(formatDisplayValue(coerced, extractor));
  });
  return {
    presenter: "list",
    value,
    displayValue,
    rawText: located.rawTexts,
    anchor: located.resolvedAnchors,
    contentHash: hashRawText(located.rawTexts),
  };
}
