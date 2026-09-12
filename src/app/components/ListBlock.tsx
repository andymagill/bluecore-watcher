// 04-FRONTEND.md §2: "Bulleted items, per-item anchors." Built for contract
// completeness (01-DATA-CONTRACT.md §4.1) even though no M1 target uses
// presenter: "list" -- bluecore-newsroom's three extractors are markdown/
// metric/status. Exercising this path is left to M2's real list source.
import type { ListBlock as ListBlockType } from "../../contract/block.js";
import { useFreshness } from "../lib/use-freshness.js";
import { FreshnessBadge } from "./FreshnessBadge.js";
import { DeltaChip } from "./DeltaChip.js";
import { ZeroState } from "./ZeroState.js";

export function ListBlock({
  targetId,
  block,
  ttlHours,
  now,
}: {
  targetId: string;
  block: ListBlockType;
  ttlHours: number;
  now?: Date;
}) {
  const state = useFreshness(block, ttlHours, now);

  if (block.status === "missing" || !block.provenance || !block.value) {
    return (
      <div data-block-key={`${targetId}.${block.key}`}>
        <ZeroState label={block.label} />
      </div>
    );
  }

  const { anchor, sourceUrl } = block.provenance;

  return (
    <div data-block-key={`${targetId}.${block.key}`} className="space-y-1">
      <p className="text-xs text-neutral-500">{block.label}</p>
      <ul className="list-disc space-y-0.5 pl-4 text-sm">
        {(block.displayValue ?? []).map((item, i) => (
          <li key={i}>
            <a
              href={`${sourceUrl}#${encodeURIComponent(anchor[i] ?? "")}`}
              className="hover:underline"
            >
              {item}
            </a>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <FreshnessBadge block={block} state={state} />
        <DeltaChip delta={block.delta} ttlHours={ttlHours} now={now} />
      </div>
    </div>
  );
}
