// 04-FRONTEND.md §5. "Every value is one interaction from its source."
// Radix Popover for accessible focus handling (shadcn/ui vendors this same
// primitive; used directly here rather than through the shadcn CLI scaffold).
import * as Popover from "@radix-ui/react-popover";
import type { ScalarProvenance, ListProvenance } from "../../contract/block.js";

function formatRawText(rawText: string | string[]): string {
  return Array.isArray(rawText) ? rawText.join(", ") : rawText;
}

function formatAnchor(anchor: string | string[]): string {
  return Array.isArray(anchor) ? anchor.join(", ") : anchor;
}

export function ProvenancePopover({
  provenance,
}: {
  provenance: ScalarProvenance | ListProvenance;
}) {
  const extractedAt = new Date(provenance.extractedAt);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="rounded px-1 text-xs text-muted-foreground underline decoration-dotted hover:text-foreground"
          aria-label="Show source"
        >
          source
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-10 w-80 rounded border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md"
          sideOffset={4}
        >
          <dl className="space-y-2">
            <div>
              <dt className="text-muted-foreground">Source</dt>
              <dd>
                <a
                  href={provenance.sourceUrl}
                  target="_blank"
                  rel="noopener"
                  className="text-primary hover:underline"
                >
                  {provenance.sourceUrl}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Anchor</dt>
              <dd className="break-all font-mono">{formatAnchor(provenance.anchor)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Extracted</dt>
              <dd>
                {extractedAt.toLocaleString()} ({extractedAt.toISOString()})
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Raw text</dt>
              <dd className="break-words font-mono">{formatRawText(provenance.rawText)}</dd>
            </div>
          </dl>
          <Popover.Arrow className="fill-popover" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
