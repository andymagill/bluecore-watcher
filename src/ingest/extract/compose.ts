// ADR-022/ADR-025 — pure, kind-agnostic composition helpers for a composite
// location (`fields` + `template`): api's flat rows and html/xml's DOM rows
// both resolve their fields elsewhere (api-handler.ts / html-handler.ts) and
// hand the raw values here for the shared strip/split/valueMap/join/format/
// truncate/escape pipeline and template fill — same ADR-010 spirit as
// pipeline.ts being shared across handlers.
import type { FieldTransformDef } from "../../config/schema.js";
import { IngestError } from "../errors.js";
import { coerceDate, formatDateDisplay } from "./coerce.js";

// Markdown-significant characters DOMPurify/marked would otherwise treat as
// syntax — escaped so a field value (e.g. a filer's free-text description)
// renders as literal text inside the composed template.
const MARKDOWN_SPECIAL = /([\\`*_{}[\]()#+\-.!|>~])/g;

function escapeMarkdown(s: string): string {
  return s.replace(MARKDOWN_SPECIAL, "\\$1");
}

// escape: "href" (ADR-025) percent-encodes characters that would otherwise
// break the composed `[text](url)` markdown link syntax once resolved.
// `encodeURIComponent` deliberately leaves "(" and ")" unescaped (they're
// valid in a URI per RFC 3986's sub-delims), so they need an explicit map;
// everything else `HREF_UNSAFE` matches (whitespace) is a normal
// `encodeURIComponent` target.
const HREF_UNSAFE = /[()\s]/g;
const HREF_ENCODE_OVERRIDES: Readonly<Record<string, string>> = { "(": "%28", ")": "%29" };

/**
 * strip -> split -> valueMap -> join -> format -> truncate -> escape, in
 * that order. Throws PARSE_ERROR (same class a coercion failure uses) when
 * `valueMap` doesn't cover a token — an unmapped code is exactly as much a
 * silent-wrong risk as an unrecognized enum value (01-DATA-CONTRACT.md §6)
 * — or when `escape: "href"` can't resolve to an http(s) URL.
 *
 * `baseUrl` is only required when `escape: "href"` is used — every other
 * transform ignores it.
 */
export function applyFieldTransform(
  rawValue: string,
  field: FieldTransformDef,
  extractorKey: string,
  fieldName: string,
  baseUrl?: string,
): string {
  let text = rawValue;
  if (field.strip) {
    text = text.replace(new RegExp(field.strip, "g"), "");
  }

  let tokens: string[];
  if (field.split !== undefined) {
    tokens = text
      .split(field.split)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  } else {
    tokens = [text];
  }

  if (field.valueMap) {
    tokens = tokens.map((t) => {
      const mapped = field.valueMap![t];
      if (mapped === undefined) {
        throw new IngestError(
          "PARSE_ERROR",
          `extractor "${extractorKey}": field "${fieldName}" has no valueMap entry for "${t}"`,
        );
      }
      return mapped;
    });
  }

  let joined = tokens.join(field.join ?? ", ");

  if (field.format === "date") {
    joined = formatDateDisplay(
      coerceDate(joined, `extractor "${extractorKey}", field "${fieldName}"`),
    );
  }
  if (field.truncate !== undefined && joined.length > field.truncate) {
    joined = `${joined.slice(0, field.truncate).trimEnd()}…`;
  }

  const escape = field.escape ?? "markdown";
  if (escape === "markdown") return escapeMarkdown(joined);
  if (escape === "url") return encodeURIComponent(joined);
  if (escape === "href") return resolveHref(joined, extractorKey, fieldName, baseUrl);
  return joined;
}

function resolveHref(
  value: string,
  extractorKey: string,
  fieldName: string,
  baseUrl: string | undefined,
): string {
  let resolved: URL;
  try {
    resolved = new URL(value, baseUrl);
  } catch {
    throw new IngestError(
      "PARSE_ERROR",
      `extractor "${extractorKey}": field "${fieldName}" is not a resolvable URL ("${value}")`,
    );
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    throw new IngestError(
      "PARSE_ERROR",
      `extractor "${extractorKey}": field "${fieldName}" has a disallowed URL scheme ` +
        `("${resolved.protocol}")`,
    );
  }
  return resolved.href.replace(
    HREF_UNSAFE,
    (ch) => HREF_ENCODE_OVERRIDES[ch] ?? encodeURIComponent(ch),
  );
}

/** Fills `{name}` placeholders. Config validation (rule 13) already proves every name resolves. */
export function composeTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => values[name] ?? "");
}

/**
 * A stable-key JSON snapshot of the *raw* (pre-transform) field values —
 * what a composite block's `provenance.rawText` holds and `contentHash`
 * hashes. Sorted keys so editing a `valueMap`/`template` (which changes
 * `value`/`displayValue` but not the underlying facts) never produces a
 * spurious content change or any-change alert.
 */
export function stableRawJson(values: Readonly<Record<string, string>>): string {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(values).sort()) sorted[key] = values[key]!;
  return JSON.stringify(sorted);
}
