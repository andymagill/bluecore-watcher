// 04-FRONTEND.md §2: "Large value, unit, label, delta chip, freshness badge."
// Every value-bearing block carries data-block-key -- the convention gate
// check 3 (src/gate/smoke-render.ts) counts against published block count,
// including the ZeroState rendered for a `missing` block (Decision 7).
import type { ScalarBlock } from "../../contract/block.js";
import { useFreshness } from "../lib/use-freshness.js";
import { FreshnessBadge } from "./FreshnessBadge.js";
import { DeltaChip } from "./DeltaChip.js";
import { ProvenancePopover } from "./ProvenancePopover.js";
import { ZeroState } from "./ZeroState.js";

export function MetricBlock({
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

  // `expired`: value suppressed, shown behind a disclosure (01-DATA-CONTRACT §5).
  const suppressed = state === "expired";

  return (
    <div data-block-key={`${targetId}.${block.key}`} className="space-y-1">
      <p className="text-xs text-neutral-500">{block.label}</p>
      {suppressed ? (
        <details>
          <summary className="cursor-pointer text-sm text-neutral-500">
            Last known value from an earlier check
          </summary>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-300">
            {block.displayValue}
            {block.unit ? (
              <span className="ml-1 text-sm text-neutral-500">{block.unit}</span>
            ) : null}
          </p>
        </details>
      ) : (
        <p className="text-2xl font-semibold tabular-nums">
          {block.displayValue}
          {block.unit ? <span className="ml-1 text-sm text-neutral-500">{block.unit}</span> : null}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <FreshnessBadge block={block} state={state} />
        <DeltaChip delta={block.delta} ttlHours={ttlHours} now={now} />
        <ProvenancePopover provenance={block.provenance} />
      </div>
    </div>
  );
}
