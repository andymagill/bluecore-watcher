// 04-FRONTEND.md §2: "Narrative prose via markdown parser, sanitised."
// marked -> DOMPurify -> dangerouslySetInnerHTML is the standard, minimal
// pairing for this; no larger markdown-in-React dependency needed.
import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { ScalarBlock } from "../../contract/block.js";
import { useFreshness } from "../lib/use-freshness.js";
import { FreshnessBadge } from "./FreshnessBadge.js";
import { DeltaChip } from "./DeltaChip.js";
import { ProvenancePopover } from "./ProvenancePopover.js";
import { ZeroState } from "./ZeroState.js";

export function MarkdownBlock({ targetId, block, ttlHours, now }: { targetId: string; block: ScalarBlock; ttlHours: number; now?: Date }) {
  const state = useFreshness(block, ttlHours, now);
  const raw = typeof block.value === "string" ? block.value : "";
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(raw, { async: false }) as string), [raw]);

  if (block.status === "missing" || !block.provenance) {
    return (
      <div data-block-key={`${targetId}.${block.key}`}>
        <ZeroState label={block.label} />
      </div>
    );
  }

  const suppressed = state === "expired";

  return (
    <div data-block-key={`${targetId}.${block.key}`} className="space-y-1">
      <p className="text-xs text-neutral-500">{block.label}</p>
      {suppressed ? (
        <details>
          <summary className="cursor-pointer text-sm text-neutral-500">Last known value from an earlier check</summary>
          <div className="prose prose-invert prose-sm mt-1 max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
        </details>
      ) : (
        <div className="prose prose-invert prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <FreshnessBadge block={block} state={state} />
        <DeltaChip delta={block.delta} ttlHours={ttlHours} now={now} />
        <ProvenancePopover provenance={block.provenance} />
      </div>
    </div>
  );
}
