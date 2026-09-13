// 04-FRONTEND.md §2: "ok / degraded / failed from manifest.health; opens the
// modal." Status is never colour-only (04-FRONTEND.md §7) -- text label
// accompanies the colour here.
import type { HealthSummaryOverall } from "../../contract/manifest.js";

const COLOR: Record<HealthSummaryOverall, string> = {
  ok: "bg-success text-success-foreground",
  degraded: "bg-warning text-warning-foreground",
  failed: "bg-destructive text-destructive-foreground",
};

export function HealthPill({
  overall,
  onClick,
}: {
  overall: HealthSummaryOverall;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium ${COLOR[overall]}`}
      aria-label={`Pipeline health: ${overall}. Open health details.`}
    >
      {overall}
    </button>
  );
}
