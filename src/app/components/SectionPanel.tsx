// 04-FRONTEND.md §2: "Section label, description, target cards." A section
// with zero targets (M1's segment/regulatory/climate, per the roadmap's
// scope-discipline cut) renders as an explicit zero-state -- "which also
// proves the zero-state path" (07-ROADMAP.md M1).
import type { ManifestSection, ManifestTarget } from "../../contract/manifest.js";
import type { TargetFile } from "../../contract/target-file.js";
import { TargetCard } from "./TargetCard.js";
import { ZeroState } from "./ZeroState.js";

export function SectionPanel({
  section,
  manifestTargets,
  targetFiles,
  now,
}: {
  section: ManifestSection;
  manifestTargets: ManifestTarget[];
  targetFiles: Map<string, TargetFile>;
  now?: Date;
}) {
  return (
    <section aria-labelledby={`section-${section.id}`} className="space-y-3">
      <h2 id={`section-${section.id}`} className="text-lg font-semibold">
        {section.label}
      </h2>
      {manifestTargets.length === 0 ? (
        <ZeroState label={section.label} reason="No targets configured for this section yet." />
      ) : (
        <div className="space-y-3">
          {manifestTargets.map((mt) => {
            const tf = targetFiles.get(mt.id);
            return tf ? <TargetCard key={mt.id} targetFile={tf} now={now} /> : <ZeroState key={mt.id} label={mt.label} reason="Data not yet available for this target." />;
          })}
        </div>
      )}
    </section>
  );
}
