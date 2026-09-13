// 03-INGESTION.md §5 "weekly drift check". Kind-agnostic structural
// fingerprints — deliberately not the same thing extraction cares about
// (a matched value), but a broader "does this page/response still look
// like the shape we built extractors against" signal, per doc 03 §5: "even
// if extraction still succeeds."
//
// Both fingerprints are *presence* sets only — no leaf type recorded. A
// null value or a changed value at an existing path never shows up as
// added/removed here; only a path appearing or disappearing does. That is
// this module's implementation of "null counts as wildcard": a field's
// nullability or value never perturbs structural similarity, only its
// existence does. Per-extractor *type* drift (does this specific jsonPath
// now resolve to a different JS type than it used to) is a separate,
// more precise question answered by re-running the real extractor against
// both documents — see check.ts — not by this module.
import * as cheerio from "cheerio";
import type { Element } from "domhandler";

function elementSignature(el: Element): string {
  const classAttr = (el.attribs?.class ?? "").trim();
  const classes = classAttr ? classAttr.split(/\s+/).filter(Boolean).sort().join(".") : "";
  return classes ? `${el.name}.${classes}` : el.name;
}

// Every (parent, child) tag pair in the document, as `<parentSig> > <childSig>`.
// Set semantics mean a repeated pattern (e.g. twelve `.bc-n-card` siblings)
// collapses to one entry — a page growing more of the same card is not
// drift; a new *kind* of wrapper around it is.
export function htmlSkeleton(html: string): Set<string> {
  const $ = cheerio.load(html);
  const skeleton = new Set<string>();
  $("*").each((_i, el) => {
    if (el.type !== "tag") return;
    const parent = el.parent;
    if (!parent || parent.type !== "tag") return;
    skeleton.add(`${elementSignature(parent)} > ${elementSignature(el)}`);
  });
  return skeleton;
}

// Every key path present in a parsed JSON document, with array indices
// collapsed to `[]` (only the first element of an array is walked — arrays
// are assumed structurally homogeneous, which is true of every API target
// in this config) and object/array leaves left unexpanded when empty.
export function jsonShape(doc: unknown, path = "$", out: Set<string> = new Set()): Set<string> {
  if (doc === null || doc === undefined) {
    out.add(path);
  } else if (Array.isArray(doc)) {
    if (doc.length === 0) out.add(`${path}[]`);
    else jsonShape(doc[0], `${path}[]`, out);
  } else if (typeof doc === "object") {
    const entries = Object.entries(doc as Record<string, unknown>);
    if (entries.length === 0) out.add(path);
    for (const [key, value] of entries) jsonShape(value, `${path}.${key}`, out);
  } else {
    out.add(path);
  }
  return out;
}

// 0 (nothing in common) to 1 (identical sets); two empty sets are
// vacuously identical.
export function jaccardSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

export function setDiff(
  baseline: ReadonlySet<string>,
  live: ReadonlySet<string>,
): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  for (const x of live) if (!baseline.has(x)) added.push(x);
  for (const x of baseline) if (!live.has(x)) removed.push(x);
  return { added: added.sort(), removed: removed.sort() };
}
