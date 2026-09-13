// 03-INGESTION.md §1 "extract" steps 5-6: coerce rawText to `type`, then
// format `displayValue`. Shared across every handler — kind-agnostic.
import { parse as parseDateFns } from "date-fns";
import type { ExtractorDef } from "../../config/schema.js";
import { IngestError } from "../errors.js";

export type CoercedValue = number | string;

// An ISO date-only string ("2026-09-11") is UTC by spec (no fix needed); a
// string carrying an explicit zone/offset (trailing Z, +HH:MM, or "GMT")
// is parsed against that offset, not the host's local zone (also fine).
// Anything else -- notably a human-readable date like "September 11, 2026",
// which is what real scraped pages actually contain -- is implementation-
// defined and V8 parses it in the HOST's local timezone. Re-anchoring only
// that case to UTC keeps a run's result independent of which machine (or
// which CI runner's TZ) produced it -- required for ADR-011 (Invariant 7:
// two runs against unchanged source data must agree).
const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_EXPLICIT_ZONE = /(?:Z|GMT|UTC|[+-]\d{2}:?\d{2})\s*$/i;

function needsUtcReanchor(rawText: string): boolean {
  return !ISO_DATE_ONLY.test(rawText) && !HAS_EXPLICIT_ZONE.test(rawText);
}

// Rebuilds a Date's *local* wall-clock components as a UTC instant. Used
// only when the source text carried no zone information at all, so the
// wall-clock numbers the runtime parsed are the actual intended calendar
// date/time -- they just got anchored to the wrong offset.
function reanchorToUtc(parsed: Date): Date {
  return new Date(
    Date.UTC(
      parsed.getFullYear(),
      parsed.getMonth(),
      parsed.getDate(),
      parsed.getHours(),
      parsed.getMinutes(),
      parsed.getSeconds(),
      parsed.getMilliseconds(),
    ),
  );
}

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
      // date-fns's parse() always resolves against the host's local zone
      // (it has no zone-token support), so an explicit dateFormat always
      // needs the same re-anchoring `new Date(rawText)` needs conditionally.
      let parsed = extractor.dateFormat
        ? parseDateFns(rawText, extractor.dateFormat, new Date())
        : new Date(rawText);
      if (Number.isNaN(parsed.getTime())) {
        throw new IngestError(
          "PARSE_ERROR",
          `Could not coerce "${rawText}" to a date for extractor "${extractor.key}"`,
        );
      }
      if (extractor.dateFormat || needsUtcReanchor(rawText)) {
        parsed = reanchorToUtc(parsed);
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
    case "date": {
      // `value` is always our own coerce() output: a full ISO instant. Read
      // it back with the UTC getters (not date-fns's local-zone format())
      // so display can't shift a day relative to the stored/committed value.
      const d = new Date(value as string);
      const day = String(d.getUTCDate()).padStart(2, "0");
      const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
      return `${day} ${month} ${d.getUTCFullYear()}`;
    }
    case "string":
    case "markdown":
    case "enum":
      return String(value);
  }
}
