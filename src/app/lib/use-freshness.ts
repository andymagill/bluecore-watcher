// Shared clock-driving hook behind FreshnessBadge and every value-bearing
// block component (which also needs the *state*, not just the badge text,
// to decide whether to suppress its value per the `expired` row in
// 01-DATA-CONTRACT.md §5). One interval/focus-listener per block keeps this
// simple; at M1's scale (a handful of blocks) that's a non-issue.
import { useEffect, useState } from "react";
import type { Block } from "../../contract/block.js";
import { computeFreshness, type FreshnessState } from "./freshness.js";

const RECOMPUTE_INTERVAL_MS = 60_000;

export function useFreshness(block: Block, ttlHours: number, nowOverride?: Date): FreshnessState {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (nowOverride) return; // test override -- no live clock needed
    const interval = setInterval(() => setTick((t) => t + 1), RECOMPUTE_INTERVAL_MS);
    const onFocus = () => setTick((t) => t + 1);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [nowOverride]);
  void tick;

  const now = nowOverride ?? new Date();
  return computeFreshness({ now, block, ttlHours });
}
