// ADR-010: handlers do location only. Narrowing, coercion, formatting,
// provenance, and hashing are shared and live in pipeline.ts — this is what
// makes a future handler (pdf, xlsx, session-app) small and additive.
import type { ExtractorDef, TargetDef } from "../../config/schema.js";
import type { FetchResult } from "../fetch/types.js";

export interface LocateResult {
  /** One entry per matched node, in document/match order. */
  rawTexts: string[];
  /** Resolved anchor per matched node — 01-DATA-CONTRACT.md: "which node", not the configured selector. */
  resolvedAnchors: string[];
  /** Always returned, even for `multiple: true` — SELECTOR_AMBIGUOUS is enforced centrally, not per handler. */
  matchCount: number;
  /**
   * ADR-022 — the text regex/coercion should actually narrow, when it
   * differs from what gets stored as `rawText`/hashed as `contentHash`. A
   * composite api location uses this: `rawTexts` carries the raw,
   * pre-transform field values (so a relabeling doesn't fake a content
   * change), while `texts` carries the already-composed markdown string.
   * Defaults to `rawTexts` when absent — every existing handler is
   * unaffected.
   */
  texts?: string[];
}

export interface ExtractHandler<TDoc = unknown> {
  parse(fetchResult: FetchResult): Promise<TDoc> | TDoc;
  locate(doc: TDoc, extractor: ExtractorDef, target: TargetDef): LocateResult;
}
