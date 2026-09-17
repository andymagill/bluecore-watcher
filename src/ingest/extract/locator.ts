// A one-line, human-readable description of where an extractor reads from —
// used for health-entry `failingSelector` and repair-diff.ts's context.md,
// wherever code previously assumed `kind === "html" ? selector : jsonPath`.
// ADR-022 added a third shape (composite api: fields + template, optionally
// index) that has no single field to fall back to, so this is now its own
// module rather than an inline ternary repeated at each call site.
// ADR-026 adds xml: same as html (selector-based, row-relative for composite).
import type { ExtractorDef } from "../../config/schema.js";

export function extractorLocatorOf(extractor: ExtractorDef): string {
  if (extractor.kind === "html" || extractor.kind === "xml") return extractor.selector;
  // API kind — either simple (jsonPath) or composite (fields+template, optionally index).
  if ("jsonPath" in extractor && extractor.jsonPath !== undefined) return extractor.jsonPath;
  const indexPart =
    "index" in extractor && extractor.index
      ? `index:${"jsonPath" in extractor.index ? extractor.index.jsonPath : ""}`
      : null;
  const fieldsPart =
    "fields" in extractor && extractor.fields
      ? Object.entries(extractor.fields)
          .map(([name, f]) => `${name}=${"jsonPath" in f ? f.jsonPath : ""}`)
          .join(", ")
      : "";
  return [indexPart, fieldsPart].filter(Boolean).join(" ");
}
