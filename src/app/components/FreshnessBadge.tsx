// 04-FRONTEND.md §3. Purely presentational -- the freshness *state* is
// computed once by useFreshness in the parent block (which also needs it to
// decide whether to suppress the value when `expired`), and passed down.
import type { Block } from "../../contract/block.js";
import type { FreshnessState } from "../lib/freshness.js";

const LABEL: Record<FreshnessState, (block: Block) => string> = {
  never: () => "",
  fresh: (b) => relativeAge(b),
  stale: (b) => `Updated ${relativeAge(b)}`,
  // 01-DATA-CONTRACT.md §5 wording; 04-FRONTEND.md §3 previously read
  // "Last verified" -- reconciled to the data contract's phrasing, which
  // is the more specific of the two on this exact string.
  expired: (b) => `Last known value from ${formatDate(b)}`,
  failing: (b) => relativeAge(b),
  flagged: (b) => relativeAge(b),
};

// stale and flagged share a colour, as do expired and fresh (differing only
// in opacity) -- that's deliberate, not a gap: LABEL above already gives
// each state distinct text, which is what 04-FRONTEND.md §7's "never
// encoded by colour alone" actually requires.
const COLOR: Record<FreshnessState, string> = {
  never: "",
  fresh: "bg-muted text-muted-foreground",
  stale: "bg-warning text-warning-foreground",
  expired: "bg-muted text-muted-foreground/70",
  failing: "bg-destructive/15 text-destructive",
  flagged: "bg-warning text-warning-foreground",
};

function relativeAge(block: Block): string {
  if (!block.provenance) return "";
  const ms = Date.now() - new Date(block.provenance.extractedAt).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function formatDate(block: Block): string {
  if (!block.provenance) return "";
  return new Date(block.provenance.extractedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function FreshnessBadge({ block, state }: { block: Block; state: FreshnessState }) {
  if (state === "never") return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs tabular-nums ${COLOR[state]}`}
      data-freshness-state={state}
    >
      {LABEL[state](block)}
    </span>
  );
}
