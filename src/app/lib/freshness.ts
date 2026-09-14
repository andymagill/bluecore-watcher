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
  /** Absolute ceiling in hours, resolved server-side from
   * schedule.staleCeilingHours or environment.staleCeilingMultiplier x
   * ttlHours, and published as TargetFile.staleCeilingHours
   * (src/ingest/orchestrate.ts). Takes precedence over
   * staleCeilingMultiplier below when both are given. Falls back to the
   * documented 3x default when neither is given (older committed data, or
   * a caller that hasn't threaded it through). */
  staleCeilingHours?: number;
  /** Overrides the default 3x ceiling multiplier, used only when
   * staleCeilingHours isn't given. Kept for callers (and the existing test
   * suite) that reason in multiplier terms rather than an absolute hour
   * count. */
  staleCeilingMultiplier?: number;
  /** Independent axis from the ttl-based ceiling above: how many days a
   * `cached` (failing) block may keep rendering its last value before
   * being treated as expired regardless of ttlHours (M3c,
   * 01-DATA-CONTRACT.md §5). Closes the gap where a long-TTL target that
   * starts failing immediately would otherwise wait ttlHours x ceiling --
   * hundreds of days for a multi-month TTL -- before ever suppressing a
   * permanently broken selector's stale value. Default 14. */
  failingCeilingDays?: number;
}

export function computeFreshness(input: FreshnessInput): FreshnessState {
  const { now, block, ttlHours } = input;
  const ceiling = input.staleCeilingHours ?? ttlHours * (input.staleCeilingMultiplier ?? 3);
  const failingCeilingHours = (input.failingCeilingDays ?? 14) * 24;

  // "never: No block, or status: missing" (§5).
  if (!block || block.status === "missing" || !block.provenance) return "never";

  const ageHours = (now.getTime() - new Date(block.provenance.extractedAt).getTime()) / 3_600_000;

  // Precedence, most safety-critical first. The docs explicitly resolve
  // only one co-occurrence ("failing and stale can co-occur; failing takes
  // display precedence") -- expired is checked first regardless of status
  // because its entire purpose is to stop the UI asserting a stale value as
  // current, independent of *why* the value stopped moving.
  if (ageHours > ceiling) return "expired";

  if (block.status === "cached") {
    // provenance.extractedAt freezes at the last successful extraction, so
    // ageHours above only reaches the ttl-based ceiling once ttlHours x
    // multiplier has passed since that last success -- fine for a short-TTL
    // target, much too slow for a long one. failingSince tracks how long
    // *this specific failure* has been going, independent of ttlHours, so a
    // long-TTL target that starts failing immediately still expires on a
    // human timescale.
    if (block.failingSince) {
      const failingHours = (now.getTime() - new Date(block.failingSince).getTime()) / 3_600_000;
      if (failingHours > failingCeilingHours) return "expired";
    }
    return "failing";
  }

  if (block.status === "flagged") return "flagged";
  if (ageHours > ttlHours) return "stale";
  return "fresh";
}
