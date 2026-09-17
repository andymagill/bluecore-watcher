// Shared Cheerio helper functions for html and xml handlers. ADR-026 — both
// html and xml handlers use Cheerio for DOM parsing (xml mode differs only in
// parse options); selector matching and anchor resolution are identical.
import * as cheerio from "cheerio";
import type { Element, ParentNode } from "domhandler";
import type { ExtractorDef, TargetDef } from "../../config/schema.js";
import { IngestError } from "../errors.js";
import type { LocateResult } from "./types.js";
import { applyFieldTransform, composeTemplate, stableRawJson } from "./compose.js";

// Builds a resolved-node anchor distinct from the *configured* selector, per
// 01-DATA-CONTRACT.md §4: "If config says `.capacity-table td` and it
// matched, the anchor records which node." Uses id > nth-of-type chain from
// the root, which is diagnosable even though it's not what a human authored.
export function resolveAnchor($: cheerio.CheerioAPI, el: Element, sourceUrl: string): string {
  const segments: string[] = [];
  let current: Element | null = el;
  while (current && current.type === "tag") {
    const node = $(current);
    const id = node.attr("id");
    if (id) {
      segments.unshift(id);
      break;
    }
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
  return `${sourceUrl}#${segments.join(" > ")}`;
}

// Scalar locate — match a single selector and extract text/attr from each match.
export function locateScalar(
  $: cheerio.CheerioAPI,
  extractor: ExtractorDef,
  target: TargetDef,
): LocateResult {
  if (extractor.kind !== "html" && extractor.kind !== "xml") {
    throw new Error(
      `locateScalar called on a ${extractor.kind} extractor — only html/xml supported`,
    );
  }
  if (extractor.fields !== undefined) {
    throw new Error(`locateScalar called on a composite extractor "${extractor.key}"`);
  }

  const matches = $(extractor.selector);
  const rawTexts: string[] = [];
  const resolvedAnchors: string[] = [];

  matches.each((_i, el) => {
    const node = $(el);
    const text = extractor.attr ? (node.attr(extractor.attr) ?? "") : node.text();
    rawTexts.push(text);
    if (el.type === "tag") {
      resolvedAnchors.push(resolveAnchor($, el, target.url));
    } else {
      resolvedAnchors.push(target.url);
    }
  });

  return { rawTexts, resolvedAnchors, matchCount: matches.length };
}

// Composite locate — match rows and resolve fields per row.
export function locateCompositeRows(
  $: cheerio.CheerioAPI,
  extractor: ExtractorDef,
  target: TargetDef,
): LocateResult {
  if (extractor.kind !== "html" && extractor.kind !== "xml") {
    throw new Error(
      `locateCompositeRows called on a ${extractor.kind} extractor — only html/xml supported`,
    );
  }
  if (!extractor.fields || !extractor.template) {
    throw new Error(`locateCompositeRows called on a non-composite extractor "${extractor.key}"`);
  }

  const fields = extractor.fields;
  const template = extractor.template;

  // Row limiting happens before field resolution (config rule 13, ADR-025)
  // — a malformed row past the window can't fail extraction for a
  // well-formed one inside it.
  const rowMatches = $(extractor.selector).toArray();
  const rows = extractor.limit !== undefined ? rowMatches.slice(0, extractor.limit) : rowMatches;

  const rawTexts: string[] = [];
  const texts: string[] = [];
  const resolvedAnchors: string[] = [];

  rows.forEach((rowEl, rowIndex) => {
    const row = $(rowEl);
    const rawValues: Record<string, string> = {};
    for (const [name, field] of Object.entries(fields)) {
      const node = field.selector ? row.find(field.selector) : row;
      if (node.length === 0) {
        throw new IngestError(
          "SELECTOR_NO_MATCH",
          `extractor "${extractor.key}": field "${name}" (row ${rowIndex}) matched 0 nodes`,
          { failingSelector: field.selector ?? extractor.selector },
        );
      }
      if (node.length > 1) {
        throw new IngestError(
          "SELECTOR_AMBIGUOUS",
          `extractor "${extractor.key}": field "${name}" (row ${rowIndex}) matched ${node.length} nodes`,
          { failingSelector: field.selector ?? extractor.selector },
        );
      }
      rawValues[name] = field.attr ? (node.attr(field.attr) ?? "") : node.text();
    }

    const transformed: Record<string, string> = {};
    for (const [name, field] of Object.entries(fields)) {
      transformed[name] = applyFieldTransform(
        rawValues[name]!,
        field,
        extractor.key,
        name,
        target.url,
      );
    }

    rawTexts.push(stableRawJson(rawValues));
    texts.push(composeTemplate(template, transformed));
    resolvedAnchors.push(rowEl.type === "tag" ? resolveAnchor($, rowEl, target.url) : target.url);
  });

  return { rawTexts, resolvedAnchors, matchCount: rows.length, texts };
}
