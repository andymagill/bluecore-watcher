// 03-INGESTION.md §1 "extract" steps 5-6: coerce rawText to `type`, then
// format `displayValue`. Shared across every handler — kind-agnostic.
import { format as formatDate, parse as parseDateFns } from "date-fns";
import type { ExtractorDef } from "../../config/schema.js";
import { IngestError } from "../errors.js";

export type CoercedValue = number | string;

export function coerce(rawText: string, extractor: ExtractorDef): CoercedValue {
  switch (extractor.type) {
    case "number":
    case "currency":
    case "percent": {
      const stripped = rawText.replace(/[^0-9.-]/g, "");
      const n = Number(stripped);
      if (stripped === "" || Number.isNaN(n)) {
        throw new IngestError(
          "PARSE_ERROR",
          `Could not coerce "${rawText}" to ${extractor.type} for extractor "${extractor.key}"`,
        );
      }
      return n;
    }
    case "date": {
      const parsed = extractor.dateFormat
        ? parseDateFns(rawText, extractor.dateFormat, new Date())
        : new Date(rawText);
      if (Number.isNaN(parsed.getTime())) {
        throw new IngestError(
          "PARSE_ERROR",
          `Could not coerce "${rawText}" to a date for extractor "${extractor.key}"`,
        );
      }
      return parsed.toISOString();
    }
    case "string":
    case "markdown":
    case "enum":
      return rawText;
  }
}

export function formatDisplayValue(value: CoercedValue, extractor: ExtractorDef): string {
  switch (extractor.type) {
    case "number": {
      const formatted = new Intl.NumberFormat(extractor.locale).format(value as number);
      return extractor.unit ? `${formatted} ${extractor.unit}` : formatted;
    }
    case "currency":
      return new Intl.NumberFormat(extractor.locale, {
        style: "currency",
        currency: extractor.currency,
      }).format(value as number);
    case "percent":
      return new Intl.NumberFormat(extractor.locale, {
        style: "percent",
        maximumFractionDigits: 2,
      }).format((value as number) / 100);
    case "date":
      return formatDate(new Date(value as string), "d MMM yyyy");
    case "string":
    case "markdown":
    case "enum":
      return String(value);
  }
}
