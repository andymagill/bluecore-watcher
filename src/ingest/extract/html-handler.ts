// kind: "html" — 03-INGESTION.md §1 "extract" step 1-2. Cheerio, static DOM.
// ADR-025 adds a second location shape: a composite location (`fields` +
// `template`) resolves each of the first `limit` matched row nodes' fields
// and composes them into one markdown string per row — see
// src/ingest/extract/compose.ts for the shared per-field transforms.
import * as cheerio from "cheerio";
import type { Element, ParentNode } from "domhandler";
import type { ExtractorDef, TargetDef } from "../../config/schema.js";
import { IngestError } from "../errors.js";
import type { FetchResult } from "../fetch/types.js";
import type { ExtractHandler, LocateResult } from "./types.js";
import { applyFieldTransform, composeTemplate, stableRawJson } from "./compose.js";

export class HtmlHandler implements ExtractHandler<cheerio.CheerioAPI> {
  parse(fetchResult: FetchResult): cheerio.CheerioAPI {
    return cheerio.load(fetchResult.body);
  }

  locate($: cheerio.CheerioAPI, extractor: ExtractorDef, target: TargetDef): LocateResult {
    if (extractor.kind !== "html") {
      throw new Error(`HtmlHandler received a non-html extractor "${extractor.key}"`);
    }
    if (extractor.fields !== undefined) {
      return this.locateComposite($, extractor, target);
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

  private locateComposite(
    $: cheerio.CheerioAPI,
    extractor: ExtractorDef,
    target: TargetDef,
  ): LocateResult {
    if (extractor.kind !== "html" || !extractor.fields || !extractor.template) {
      throw new Error(
        `HtmlHandler.locateComposite called on a non-composite extractor "${extractor.key}"`,
      );
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
}

// Builds a resolved-node anchor distinct from the *configured* selector, per
// 01-DATA-CONTRACT.md §4: "If config says `.capacity-table td` and it
// matched, the anchor records which node." Uses id > nth-of-type chain from
// the root, which is diagnosable even though it's not what a human authored.
function resolveAnchor($: cheerio.CheerioAPI, el: Element, sourceUrl: string): string {
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
