// 04-FRONTEND.md §2: "Renders sections by order." Each SectionPanel gets its
// own ErrorBoundary (per-section, not one wrapping the whole grid) --
// 04-FRONTEND.md §2's explicit rationale: a boundary at app granularity
// would let one malformed block fail the entire smoke-render gate check.
import type { Manifest } from "../../contract/manifest.js";
import type { TargetFile } from "../../contract/target-file.js";
import { SectionPanel } from "./SectionPanel.js";
import { ErrorBoundary } from "./ErrorBoundary.js";

export function SectionGrid({ manifest, targetFiles, now }: { manifest: Manifest; targetFiles: Map<string, TargetFile>; now?: Date }) {
  const sections = [...manifest.sections].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-8">
      {sections.map((section) => {
        const manifestTargets = manifest.targets.filter((t) => t.sectionId === section.id);
        return (
          <ErrorBoundary key={section.id} sectionLabel={section.label}>
            <SectionPanel section={section} manifestTargets={manifestTargets} targetFiles={targetFiles} now={now} />
          </ErrorBoundary>
        );
      })}
    </div>
  );
}
