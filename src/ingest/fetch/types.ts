// 03-INGESTION.md §1 "fetch". A Fetcher is keyed by `renderer`, not `kind` —
// the same html document can come from a static request or a browser render.
import type { TargetDef } from "../../config/schema.js";

export interface FetchResult {
  body: string;
  httpStatus: number;
  fetchedAt: string; // ISO timestamp
}

export interface RunContext {
  runId: string;
  now: () => Date; // injected clock — 01-DATA-CONTRACT.md §5 freshness is render-time, but tests still need determinism here
}

export interface Fetcher {
  fetch(target: TargetDef, ctx: RunContext): Promise<FetchResult>;
}
