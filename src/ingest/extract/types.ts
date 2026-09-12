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
}

export interface ExtractHandler<TDoc = unknown> {
  parse(fetchResult: FetchResult): Promise<TDoc> | TDoc;
  locate(doc: TDoc, extractor: ExtractorDef, target: TargetDef): LocateResult;
}
