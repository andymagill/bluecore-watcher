// 04-FRONTEND.md §2: "Bulleted items, per-item anchors." ADR-025 — first
// exercised for real by a composite row list (M6a): each item renders as
// sanitized inline markdown (a composed row's own `[title](url) —
// category, date` template), with expired-state disclosure and a
// ProvenancePopover matching MarkdownBlock's treatment.
import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { ListBlock as ListBlockType } from "../../contract/block.js";
import { useFreshness } from "../lib/use-freshness.js";
import { FreshnessBadge } from "./FreshnessBadge.js";
import { DeltaChip } from "./DeltaChip.js";
import { ProvenancePopover } from "./ProvenancePopover.js";
import { ZeroState } from "./ZeroState.js";

function sanitizeInline(raw: string): string {
  return DOMPurify.sanitize(marked.parseInline(raw, { async: false }) as string);
}

export function ListBlock({
  targetId,
  block,
  ttlHours,
  staleCeilingHours,
  now,
}: {
  targetId: string;
  block: ListBlockType;
  ttlHours: number;
  staleCeilingHours?: number;
  now?: Date;
}) {
  const state = useFreshness(block, ttlHours, staleCeilingHours, now);
  const items = block.displayValue ?? [];
  const html = useMemo(() => items.map(sanitizeInline), [items]);

  if (block.status === "missing" || !block.provenance || !block.value) {
    return (
      <div data-block-key={`${targetId}.${block.key}`}>
        <ZeroState label={block.label} />
      </div>
    );
  }

  const suppressed = state === "expired";
  // "prose" (Tailwind Typography) gives each row's inline markdown the same
  // link/emphasis styling MarkdownBlock's rendered content already has —
  // without it, a row's `<a>` renders with no visible link affordance.
  const list = (
    <ul className="prose prose-sm max-w-none list-disc space-y-0.5 pl-4 text-sm marker:text-muted-foreground">
      {html.map((itemHtml, i) => (
        <li key={i} dangerouslySetInnerHTML={{ __html: itemHtml }} />
      ))}
    </ul>
  );

  return (
    <div data-block-key={`${targetId}.${block.key}`} className="col-span-full space-y-1">
      <p className="text-xs text-muted-foreground">{block.label}</p>
      {suppressed ? (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Last known values from an earlier check
          </summary>
          <div className="mt-1">{list}</div>
        </details>
      ) : (
        list
      )}
      <div className="flex flex-wrap items-center gap-2">
        <FreshnessBadge block={block} state={state} />
        <DeltaChip delta={block.delta} ttlHours={ttlHours} now={now} />
        <ProvenancePopover provenance={block.provenance} />
      </div>
    </div>
  );
}
