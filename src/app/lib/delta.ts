// DeltaChip rendering rules -- 04-FRONTEND.md §4. `delta.changedAt` is the
// only timestamp available to distinguish "just moved" from "long settled"
// (01-DATA-CONTRACT.md §4: changedAt is carried forward untouched across
// unchanged runs). The docs don't give a numeric boundary between "changed
// recently" and "unchanged for N days" -- this reuses the block's own
// ttlHours as that boundary (Decision 5 in the M1 plan): while the value is
// still within the window it would be considered "fresh" if just observed,
// showing it moved is the news; past that, "hasn't moved in N days" is.
import type { Delta } from "../../contract/block.js";

export type DeltaDisplay =
  | { kind: "none" }
  | {
      kind: "changed-scalar";
      direction: "up" | "down";
      absolute: number;
      percent: number;
      daysAgo: number;
    }
  | { kind: "unchanged-scalar"; daysAgo: number }
  | { kind: "changed-set"; added: string[]; removed: string[]; daysAgo: number }
  | { kind: "unchanged-set"; daysAgo: number };

export function computeDeltaDisplay(
  now: Date,
  delta: Delta | null,
  ttlHours: number,
): DeltaDisplay {
  if (!delta) return { kind: "none" };

  const changedAt = new Date(delta.changedAt).getTime();
  const ageHours = (now.getTime() - changedAt) / 3_600_000;
  const daysAgo = Math.max(0, Math.floor(ageHours / 24));
  const isRecent = ageHours <= ttlHours;

  if (delta.kind === "scalar") {
    return isRecent
      ? {
          kind: "changed-scalar",
          direction: delta.direction,
          absolute: delta.absolute,
          percent: delta.percent,
          daysAgo,
        }
      : { kind: "unchanged-scalar", daysAgo };
  }

  return isRecent
    ? { kind: "changed-set", added: delta.added, removed: delta.removed, daysAgo }
    : { kind: "unchanged-set", daysAgo };
}
