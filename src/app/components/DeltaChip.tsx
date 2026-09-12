// 04-FRONTEND.md §4. "Colour encodes direction only, never sentiment" --
// both up and down use the same neutral color; only the arrow differs.
import type { Delta } from "../../contract/block.js";
import { computeDeltaDisplay } from "../lib/delta.js";

function daysLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export function DeltaChip({
  delta,
  ttlHours,
  now,
}: {
  delta: Delta | null;
  ttlHours: number;
  now?: Date;
}) {
  const display = computeDeltaDisplay(now ?? new Date(), delta, ttlHours);

  if (display.kind === "none") return null; // "First observations get no chip."

  if (display.kind === "changed-scalar") {
    const arrow = display.direction === "up" ? "▲" : "▼";
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-neutral-300 tabular-nums"
        data-delta-kind="changed"
      >
        <span aria-hidden>{arrow}</span>
        <span>
          {Math.abs(display.absolute).toLocaleString()} ({Math.abs(display.percent).toFixed(1)}%)
        </span>
        <span className="text-neutral-500">{daysLabel(display.daysAgo)}</span>
      </span>
    );
  }

  if (display.kind === "unchanged-scalar") {
    return (
      <span className="text-xs text-neutral-500" data-delta-kind="unchanged">
        unchanged for {display.daysAgo} day{display.daysAgo === 1 ? "" : "s"}
      </span>
    );
  }

  if (display.kind === "changed-set") {
    const parts: string[] = [];
    if (display.added.length > 0) parts.push(`+${display.added.length}`);
    if (display.removed.length > 0) parts.push(`-${display.removed.length}`);
    return (
      <span className="text-xs text-neutral-300 tabular-nums" data-delta-kind="changed">
        {parts.join(" ")} <span className="text-neutral-500">{daysLabel(display.daysAgo)}</span>
      </span>
    );
  }

  // unchanged-set
  return (
    <span className="text-xs text-neutral-500" data-delta-kind="unchanged">
      unchanged for {display.daysAgo} day{display.daysAgo === 1 ? "" : "s"}
    </span>
  );
}
