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

const PILL_COLORS = [
  "bg-blue-900/60 text-blue-300",
  "bg-purple-900/60 text-purple-300",
  "bg-teal-900/60 text-teal-300",
  "bg-pink-900/60 text-pink-300",
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
  now,
}: {
  targetId: string;
  block: ScalarBlock;
  ttlHours: number;
  now?: Date;
}) {
  const state = useFreshness(block, ttlHours, now);

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
      <p className="text-xs text-neutral-500">{block.label}</p>
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
