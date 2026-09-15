// ADR-022 — pure, kind-agnostic composition helpers for a composite api
// location (`fields` + `template`). Kept separate from api-handler.ts so a
// future handler (e.g. a composite html location, if one is ever needed)
// can reuse the same transform/template logic — same ADR-010 spirit as
// pipeline.ts being shared across handlers.
import type { ApiFieldDef } from "../../config/schema.js";
import { IngestError } from "../errors.js";

// Markdown-significant characters DOMPurify/marked would otherwise treat as
// syntax — escaped so a field value (e.g. a filer's free-text description)
// renders as literal text inside the composed template.
const MARKDOWN_SPECIAL = /([\\`*_{}[\]()#+\-.!|>~])/g;

function escapeMarkdown(s: string): string {
  return s.replace(MARKDOWN_SPECIAL, "\\$1");
}

/**
 * strip -> split -> valueMap -> join -> escape, in that order. Throws
 * PARSE_ERROR (same class a coercion failure uses) when `valueMap` doesn't
 * cover a token — an unmapped code is exactly as much a silent-wrong risk as
 * an unrecognized enum value (01-DATA-CONTRACT.md §6).
 */
export function applyFieldTransform(
  rawValue: string,
  field: ApiFieldDef,
  extractorKey: string,
  fieldName: string,
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

  const joined = tokens.join(field.join ?? ", ");
  const escape = field.escape ?? "markdown";
  if (escape === "markdown") return escapeMarkdown(joined);
  if (escape === "url") return encodeURIComponent(joined);
  return joined;
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
