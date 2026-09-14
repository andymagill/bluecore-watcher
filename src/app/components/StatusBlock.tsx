// 04-FRONTEND.md §2: "Enum rendered as a coloured pill." Colour is
// per-value-stable (hashed), not semantic -- the engine has no opinion on
// whether a given enum value is good or bad news (mirrors DeltaChip's
// "colour encodes direction only, never sentiment" rule for the same reason).
import type { ScalarBlock } from "../../contract/block.js";
import { useFreshness } from "../lib/use-freshness.js";
import { FreshnessBadge } from "./FreshnessBadge.js";
import { DeltaChip } from "./DeltaChip.js";
import { ProvenancePopover } from "./ProvenancePopover.js";
import { ZeroState } from "./ZeroState.js";

// chart-1..5 is the token family for exactly this: categorical, carries no
// meaning of its own -- unlike bg-success/bg-warning/bg-destructive, which
// would assert a judgement this component deliberately doesn't make. Text
// stays on `foreground` rather than `text-chart-N` so contrast holds in
// both themes (04-FRONTEND.md §7); the hue lives in the tint and ring,
// which carries no information the text doesn't already carry.
const PILL_COLORS = [
  "bg-chart-1/15 text-foreground ring-1 ring-chart-1/40",
  "bg-chart-2/15 text-foreground ring-1 ring-chart-2/40",
  "bg-chart-3/15 text-foreground ring-1 ring-chart-3/40",
  "bg-chart-4/15 text-foreground ring-1 ring-chart-4/40",
  "bg-chart-5/15 text-foreground ring-1 ring-chart-5/40",
];

function colorFor(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return PILL_COLORS[hash % PILL_COLORS.length]!;
}

export function StatusBlock({
  targetId,
  block,
  ttlHours,
  staleCeilingHours,
  now,
}: {
  targetId: string;
  block: ScalarBlock;
  ttlHours: number;
  staleCeilingHours?: number;
  now?: Date;
}) {
  const state = useFreshness(block, ttlHours, staleCeilingHours, now);

  if (block.status === "missing" || !block.provenance) {
    return (
      <div data-block-key={`${targetId}.${block.key}`}>
        <ZeroState label={block.label} />
      </div>
    );
  }

  const value = String(block.value ?? "");

  return (
    <div data-block-key={`${targetId}.${block.key}`} className="space-y-1">
      <p className="text-xs text-muted-foreground">{block.label}</p>
      <span
        className={`inline-block rounded-full px-2 py-0.5 text-sm font-medium ${colorFor(value)}`}
      >
        {block.displayValue}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <FreshnessBadge block={block} state={state} />
        <DeltaChip delta={block.delta} ttlHours={ttlHours} now={now} />
        <ProvenancePopover provenance={block.provenance} />
      </div>
    </div>
  );
}
