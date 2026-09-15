// A one-line, human-readable description of where an extractor reads from —
// used for health-entry `failingSelector` and repair-diff.ts's context.md,
// wherever code previously assumed `kind === "html" ? selector : jsonPath`.
// ADR-022 added a third shape (composite api: fields + template, optionally
// index) that has no single field to fall back to, so this is now its own
// module rather than an inline ternary repeated at each call site.
import type { ExtractorDef } from "../../config/schema.js";

export function extractorLocatorOf(extractor: ExtractorDef): string {
  if (extractor.kind === "html") return extractor.selector;
  if (extractor.jsonPath !== undefined) return extractor.jsonPath;
  const indexPart = extractor.index ? `index:${extractor.index.jsonPath}` : null;
  const fieldsPart = Object.entries(extractor.fields ?? {})
    .map(([name, f]) => `${name}=${f.jsonPath}`)
    .join(", ");
  return [indexPart, fieldsPart].filter(Boolean).join(" ");
}
