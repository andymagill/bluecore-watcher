// 03-INGESTION.md §1 "fetch". One Fetcher instance serves every target in a
// run; `renderer` is recorded on the target's `run` output, not used to pick
// between fetcher implementations.
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
