// 04-FRONTEND.md §2: "One target: label, source link, run status, its blocks."
import type { TargetFile } from "../../contract/target-file.js";
import { MetricBlock } from "./MetricBlock.js";
import { MarkdownBlock } from "./MarkdownBlock.js";
import { StatusBlock } from "./StatusBlock.js";
import { ListBlock } from "./ListBlock.js";

const RUN_STATUS_LABEL: Record<TargetFile["run"]["status"], string> = {
  ok: "OK",
  partial: "Partial",
  failed_cached: "Failed (serving cached data)",
};

const RUN_STATUS_COLOR: Record<TargetFile["run"]["status"], string> = {
  ok: "text-green-400",
  partial: "text-amber-400",
  failed_cached: "text-red-400",
};

export function TargetCard({ targetFile, now }: { targetFile: TargetFile; now?: Date }) {
  return (
    <div className="rounded border border-neutral-800 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <a href={targetFile.sourceUrl} target="_blank" rel="noopener" className="font-medium hover:underline">
          {targetFile.label}
        </a>
        <span className={`text-xs ${RUN_STATUS_COLOR[targetFile.run.status]}`}>{RUN_STATUS_LABEL[targetFile.run.status]}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {targetFile.blocks.map((block) => {
          const key = `${targetFile.targetId}.${block.key}`;
          if (block.presenter === "list") return <ListBlock key={key} targetId={targetFile.targetId} block={block} ttlHours={targetFile.ttlHours} now={now} />;
          if (block.presenter === "metric") return <MetricBlock key={key} targetId={targetFile.targetId} block={block} ttlHours={targetFile.ttlHours} now={now} />;
          if (block.presenter === "markdown") return <MarkdownBlock key={key} targetId={targetFile.targetId} block={block} ttlHours={targetFile.ttlHours} now={now} />;
          return <StatusBlock key={key} targetId={targetFile.targetId} block={block} ttlHours={targetFile.ttlHours} now={now} />;
        })}
      </div>
    </div>
  );
}
