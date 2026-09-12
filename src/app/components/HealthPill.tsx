// 04-FRONTEND.md §2: "ok / degraded / failed from manifest.health; opens the
// modal." Status is never colour-only (04-FRONTEND.md §7) -- text label
// accompanies the colour here.
const COLOR: Record<"ok" | "degraded" | "failed", string> = {
  ok: "bg-green-900/60 text-green-300",
  degraded: "bg-amber-900/60 text-amber-300",
  failed: "bg-red-900/60 text-red-300",
};

export function HealthPill({
  overall,
  onClick,
}: {
  overall: "ok" | "degraded" | "failed";
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
