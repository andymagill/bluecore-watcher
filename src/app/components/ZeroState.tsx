// 04-FRONTEND.md §2/§8, 01-DATA-CONTRACT.md §4/§5: explicit placeholder for
// missing data. No copy string is specified anywhere in the docs -- this is
// the M1 wording, kept short and honest rather than apologetic.
export function ZeroState({ label, reason }: { label: string; reason?: string }) {
  return (
    <div className="rounded border border-dashed border-neutral-700 p-3 text-sm text-neutral-500">
      <p className="font-medium text-neutral-400">{label}</p>
      <p>{reason ?? "Not yet available."}</p>
    </div>
  );
}
