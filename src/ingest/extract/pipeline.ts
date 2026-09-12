// 03-INGESTION.md §1 "extract". Kind-agnostic: takes whatever an
// ExtractHandler located and applies narrowing → coercion → formatting →
// provenance, identically regardless of `kind`. Handlers never touch this.
import type { ExtractorDef, TargetDef } from "../../config/schema.js";
import { IngestError } from "../errors.js";
import { coerce, formatDisplayValue, type CoercedValue } from "./coerce.js";
import { hashRawText } from "./provenance.js";
import type { ExtractHandler } from "./types.js";

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
  return extractor.kind === "html" ? extractor.selector : extractor.jsonPath;
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
    const narrowed = applyRegex(rawText, extractor);
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

  // list presenter — per 02-CONFIG-SCHEMA.md §3 the only type it accepts is
  // "string", so coercion is identity; still routed through coerce/format
  // for a single code path.
  const value: string[] = [];
  const displayValue: string[] = [];
  for (const rawText of located.rawTexts) {
    const narrowed = applyRegex(rawText, extractor);
    const coerced = coerce(narrowed, extractor);
    value.push(String(coerced));
    displayValue.push(formatDisplayValue(coerced, extractor));
  }
  return {
    presenter: "list",
    value,
    displayValue,
    rawText: located.rawTexts,
    anchor: located.resolvedAnchors,
    contentHash: hashRawText(located.rawTexts),
  };
}
