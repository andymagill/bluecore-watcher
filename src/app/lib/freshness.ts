// Freshness state machine -- 01-DATA-CONTRACT.md §5, rendering table in
// 04-FRONTEND.md §3. Computed at render time from an injected `now`, never
// baked into data (Invariant 3) -- this is what makes the M1 exit criterion
// "the freshness badge changes state as the clock advances (fake clock)"
// testable: tests call computeFreshness directly with fixed Dates, the
// component wraps it with Date.now() + a recompute interval.
import type { Block } from "../../contract/block.js";

export type FreshnessState = "never" | "fresh" | "stale" | "expired" | "failing" | "flagged";

export interface FreshnessInput {
  now: Date;
  block: Block | undefined;
  ttlHours: number;
  /** Overrides the default 3x ceiling multiplier. Not currently part of the
   * published contract (target-file.ts carries only ttlHours, not
   * schedule.staleCeilingHours or environment.staleCeilingMultiplier) -- a
   * real gap between 01-DATA-CONTRACT.md §5's stated inputs and what's
   * actually published. No M1 target needs an override, so this defaults
   * to the documented 3x and is left overridable in code for when a future
   * target does and the contract gets the field added. */
  staleCeilingMultiplier?: number;
}

export function computeFreshness(input: FreshnessInput): FreshnessState {
  const { now, block, ttlHours } = input;
  const ceilingMultiplier = input.staleCeilingMultiplier ?? 3;

  // "never: No block, or status: missing" (§5).
  if (!block || block.status === "missing" || !block.provenance) return "never";

  const ageHours = (now.getTime() - new Date(block.provenance.extractedAt).getTime()) / 3_600_000;
  const ceiling = ttlHours * ceilingMultiplier;

  // Precedence, most safety-critical first. The docs explicitly resolve
  // only one co-occurrence ("failing and stale can co-occur; failing takes
  // display precedence") -- expired is checked first regardless of status
  // because its entire purpose is to stop the UI asserting a stale value as
  // current, independent of *why* the value stopped moving.
  if (ageHours > ceiling) return "expired";
  if (block.status === "cached") return "failing";
  if (block.status === "flagged") return "flagged";
  if (ageHours > ttlHours) return "stale";
  return "fresh";
}
