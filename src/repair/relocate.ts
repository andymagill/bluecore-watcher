// docs/plans/m3-operability.md M3b — given the old block's evidence
// (rawText, the only thing that survives a redesign) and the newly-fetched
// document, find location candidates deterministically, before any LLM
// involvement. Pure and engine-generic (ADR-001: no entity name in code) —
// takes an already-parsed document (whatever the real ExtractHandler for
// this kind would have produced via .parse()), exactly what score.ts then
// re-runs the real extraction pipeline against.
import * as cheerio from "cheerio";
import type { Element, ParentNode } from "domhandler";
import type { ExtractorDef } from "../config/schema.js";

export type HtmlPatch = { selector: string };
export type ApiPatch = { jsonPath: string };
export type LocationPatch = HtmlPatch | ApiPatch;

export interface RelocationCandidate {
  patch: LocationPatch;
  /** Human-readable explanation of how this candidate was derived. */
  basis: string;
}

// A relocation report is meant to be skimmed by a human or an agent, not
// exhaustively enumerated -- cap it well below "every selector that could
// possibly match."
const MAX_CANDIDATES = 15;

export function locatorOf(patch: LocationPatch): string {
  return "selector" in patch ? patch.selector : patch.jsonPath;
}

// ---- html ----

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function classesOf(el: Element): string[] {
  const raw = (el.attribs?.class ?? "").trim();
  return raw ? raw.split(/\s+/).filter(Boolean) : [];
}

function ownClassSelector(el: Element): string | null {
  const classes = classesOf(el);
  return classes.length ? `.${classes.join(".")}` : null;
}

function tagClassSelectors(el: Element): string[] {
  return classesOf(el).map((c) => `${el.name}.${c}`);
}

function dataAttrSelectors(el: Element): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(el.attribs ?? {})) {
    if (name.startsWith("data-") && value) out.push(`[${name}="${value}"]`);
  }
  return out;
}

// Same nth-of-type-chain convention as html-handler.ts's resolveAnchor, but
// rendered as a CSS selector rather than a diagnostic anchor string. This is
// deliberately the *last* candidate emitted -- positional selectors are the
// ones that break (06-OPS-RUNBOOK.md §3).
function positionalSelector($: cheerio.CheerioAPI, el: Element): string {
  const segments: string[] = [];
  let current: Element | null = el;
  while (current && current.type === "tag") {
    const tag = current.name;
    const parent: ParentNode | null = current.parent;
    if (parent && parent.type === "tag") {
      const siblings = $(parent).children(tag).toArray();
      const index = siblings.indexOf(current) + 1;
      segments.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
    } else {
      segments.unshift(tag);
    }
    current = parent && parent.type === "tag" ? parent : null;
  }
  return segments.join(" > ");
}

// The old selector's ancestor scope -- every space-separated compound token
// except the last -- kept verbatim. A class rename inside a still-standing
// wrapper (e.g. ".bc-n-card:first .bc-n-ctitle" -> ".bc-n-card:first
// .bc-n-ctitle-v2") is the single most common redesign, so reproducing it
// as candidate #1 is deliberate rather than rediscovering the ancestor
// scope from scratch.
function ancestorPrefixOf(extractor: ExtractorDef): string | null {
  if (extractor.kind !== "html") return null;
  const tokens = extractor.selector.trim().split(/\s+/);
  if (tokens.length < 2) return null;
  return tokens.slice(0, -1).join(" ");
}

function isAncestorOf(a: Element, b: Element): boolean {
  let current: ParentNode | null = b.parent;
  while (current && current.type === "tag") {
    if (current === a) return true;
    current = current.parent;
  }
  return false;
}

// Every element whose (attr-aware) text normalizes to the target, keeping
// only the deepest matches -- a wrapper whose full text happens to equal
// the target too (e.g. it has only this one child) is a worse anchor than
// the actual leaf that carries the text.
function findMatches($: cheerio.CheerioAPI, extractor: ExtractorDef, target: string): Element[] {
  const normalizedTarget = normalizeText(target);
  if (!normalizedTarget) return [];
  const attr = extractor.kind === "html" ? extractor.attr : undefined;
  const matches: Element[] = [];
  $("*").each((_i, el) => {
    if (el.type !== "tag") return;
    const node = $(el);
    const text = attr ? (node.attr(attr) ?? "") : node.text();
    if (normalizeText(text) === normalizedTarget) matches.push(el);
  });
  return matches.filter((el) => !matches.some((other) => other !== el && isAncestorOf(el, other)));
}

function pushCandidate(
  out: RelocationCandidate[],
  seen: Set<string>,
  selector: string,
  basis: string,
): void {
  if (seen.has(selector) || out.length >= MAX_CANDIDATES) return;
  seen.add(selector);
  out.push({ patch: { selector }, basis });
}

export function relocateHtml(
  $: cheerio.CheerioAPI,
  extractor: ExtractorDef,
  oldRawText: string | string[],
): RelocationCandidate[] {
  if (extractor.kind !== "html") return [];
  // ADR-025 — a composite html location has no single selector to relocate
  // by value match (oldRawText for one is the raw-field JSON blob per row,
  // not text that would appear verbatim in a redesigned page), same
  // reasoning ADR-022 gives for declining a composite/indexed api location.
  if (extractor.fields !== undefined) return [];
  const targets = Array.isArray(oldRawText) ? oldRawText : [oldRawText];
  const primary = targets[0];
  if (primary === undefined) return [];

  const out: RelocationCandidate[] = [];
  const seen = new Set<string>();
  const ancestorPrefix = ancestorPrefixOf(extractor);
  const matches = findMatches($, extractor, primary);

  for (const el of matches) {
    const own = ownClassSelector(el);

    if (ancestorPrefix && own) {
      pushCandidate(
        out,
        seen,
        `${ancestorPrefix} ${own}`,
        "same ancestor scope as the old selector, own class on the located node",
      );
    }
    if (ancestorPrefix) {
      for (const tc of tagClassSelectors(el)) {
        pushCandidate(out, seen, `${ancestorPrefix} ${tc}`, "same ancestor scope, tag+class");
      }
    }
    if (own) pushCandidate(out, seen, own, "own class, unscoped");
    for (const tc of tagClassSelectors(el)) pushCandidate(out, seen, tc, "tag+class, unscoped");
    for (const da of dataAttrSelectors(el)) {
      pushCandidate(out, seen, da, "data attribute on the located node");
    }

    // Nearest classed ancestor + own class.
    let anc: ParentNode | null = el.parent;
    while (anc && anc.type === "tag") {
      const ancClass = ownClassSelector(anc);
      if (ancClass && own) {
        pushCandidate(out, seen, `${ancClass} ${own}`, "nearest classed ancestor + own class");
        break;
      }
      anc = anc.parent;
    }

    // A short preceding-sibling text that isn't the value itself often
    // names the field ("Label:" followed by the value).
    const prevText = $(el).prev().length ? normalizeText($(el).prev().text()) : "";
    if (prevText && prevText.length <= 40 && prevText !== normalizeText(primary) && own) {
      pushCandidate(
        out,
        seen,
        `*:contains("${prevText}") + ${own}`,
        "preceding sibling text as a label anchor",
      );
    }
  }

  // Positional fallback -- always emitted (even with a pure structural
  // shift and no changed text), always last via score.ts's rank penalty.
  for (const el of matches) {
    pushCandidate(out, seen, positionalSelector($, el), "positional (fragile) — last resort");
  }

  return out;
}

// ---- api ----

function jsonPathSegment(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `.${key}` : `['${key.replace(/'/g, "\\'")}']`;
}

function buildJsonPath(segments: readonly (string | number)[]): string {
  let out = "$";
  for (const seg of segments) {
    out += typeof seg === "number" ? `[${seg}]` : jsonPathSegment(seg);
  }
  return out;
}

// Mirrors ApiHandler's own stringification (extract/api-handler.ts) exactly,
// so a match here is a match there.
function stringifyLeaf(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function walkJson(
  doc: unknown,
  path: readonly (string | number)[],
  target: string,
  out: RelocationCandidate[],
  seen: Set<string>,
): void {
  if (out.length >= MAX_CANDIDATES) return;
  if (doc === null || doc === undefined) return;
  if (Array.isArray(doc)) {
    doc.forEach((item, i) => walkJson(item, [...path, i], target, out, seen));
    return;
  }
  if (typeof doc !== "object") return;
  for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
    if (out.length >= MAX_CANDIDATES) return;
    if (value !== null && typeof value === "object") {
      walkJson(value, [...path, key], target, out, seen);
    } else if (stringifyLeaf(value) === target) {
      const jsonPath = buildJsonPath([...path, key]);
      if (!seen.has(jsonPath)) {
        seen.add(jsonPath);
        out.push({ patch: { jsonPath }, basis: "value match" });
      }
    }
  }
}

export function relocateApi(
  doc: unknown,
  extractor: ExtractorDef,
  oldRawText: string | string[],
): RelocationCandidate[] {
  if (extractor.kind !== "api") return [];
  // ADR-022 — a composite/indexed location has no single jsonPath to
  // relocate by value match, and `oldRawText` for one is the raw-field JSON
  // blob, not a value that would ever appear verbatim in a redesigned
  // response. score.ts surfaces the "repair manually" guidance for these;
  // this just declines to propose candidates that couldn't mean anything.
  if (extractor.fields !== undefined || extractor.index !== undefined) return [];
  const targets = Array.isArray(oldRawText) ? oldRawText : [oldRawText];
  const primary = targets[0];
  if (primary === undefined) return [];
  const out: RelocationCandidate[] = [];
  walkJson(doc, [], primary, out, new Set());
  return out;
}

// ---- dispatch ----

export function relocate(
  extractor: ExtractorDef,
  newDoc: unknown,
  oldRawText: string | string[],
): RelocationCandidate[] {
  if (extractor.kind === "html")
    return relocateHtml(newDoc as cheerio.CheerioAPI, extractor, oldRawText);
  return relocateApi(newDoc, extractor, oldRawText);
}
