// kind: "html" — 03-INGESTION.md §1 "extract" step 1-2. Cheerio, static DOM.
import * as cheerio from "cheerio";
import type { Element, ParentNode } from "domhandler";
import type { ExtractorDef, TargetDef } from "../../config/schema.js";
import type { FetchResult } from "../fetch/types.js";
import type { ExtractHandler, LocateResult } from "./types.js";

export class HtmlHandler implements ExtractHandler<cheerio.CheerioAPI> {
  parse(fetchResult: FetchResult): cheerio.CheerioAPI {
    return cheerio.load(fetchResult.body);
  }

  locate($: cheerio.CheerioAPI, extractor: ExtractorDef, target: TargetDef): LocateResult {
    if (extractor.kind !== "html") {
      throw new Error(`HtmlHandler received a non-html extractor "${extractor.key}"`);
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
