// @vitest-environment jsdom
// M1 scope discipline: "one target, two or three extractors, one section.
// The other three sections render as zero-states -- which also proves the
// zero-state path" (07-ROADMAP.md M1). This is that proof, at the component
// level rather than just reading the manifest shape.
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SectionPanel } from "../../src/app/components/SectionPanel.js";
import { TargetFile } from "../../src/contract/target-file.js";

// No global test-framework detection (this file imports `vitest` explicitly
// rather than using globals: true), so RTL's automatic afterEach cleanup
// never registers itself -- without this, DOM from one test leaks into the
// next's queries against `document`.
afterEach(cleanup);

const NOW = new Date("2026-09-12T00:00:00Z");

function makeTargetFile(): TargetFile {
  return TargetFile.parse({
    schemaVersion: 1,
    targetId: "bluecore-newsroom",
    entityId: "bluecore-energy",
    sectionId: "target",
    label: "BlueCore Energy - Latest News",
    sourceUrl: "https://www.bluecore.energy/news-insights",
    ttlHours: 168,
    run: { runId: "r1", startedAt: "2026-09-12T00:00:00Z", completedAt: "2026-09-12T00:00:00Z", durationMs: 100, status: "ok", renderer: "static", httpStatus: 200 },
    blocks: [
      {
        key: "latest_headline",
        label: "Latest Headline",
        type: "string",
        presenter: "markdown",
        status: "ok",
        value: "BlueCore announces new milestone",
        displayValue: "BlueCore announces new milestone",
        provenance: { sourceUrl: "https://www.bluecore.energy/news-insights", anchor: ".bc-n-ctitle:first", extractedAt: "2026-09-12T00:00:00Z", rawText: "BlueCore announces new milestone", contentHash: "sha256:aabbcc" },
        delta: null,
        validation: { passed: true, warnings: [] },
      },
    ],
  });
}

describe("SectionPanel -- M1 scope discipline (one populated section, others zero-state)", () => {
  it("renders target cards when the section has targets", () => {
    const tf = makeTargetFile();
    render(
      <SectionPanel
        section={{ id: "target", label: "Target Company State", order: 1 }}
        manifestTargets={[{ id: "bluecore-newsroom", sectionId: "target", entityId: "bluecore-energy", label: tf.label, path: "sections/target/bluecore-newsroom.json", ttlHours: 168, lastRunStatus: "ok", lastSuccessAt: "2026-09-12T00:00:00Z" }]}
        targetFiles={new Map([["bluecore-newsroom", tf]])}
        now={NOW}
      />,
    );
    expect(screen.getByText("Target Company State")).toBeInTheDocument();
    expect(screen.getByText(tf.label)).toBeInTheDocument();
    expect(document.querySelector('[data-block-key="bluecore-newsroom.latest_headline"]')).not.toBeNull();
  });

  it("renders an explicit zero-state when the section has no targets (segment/regulatory/climate in M1)", () => {
    render(<SectionPanel section={{ id: "segment", label: "Industry Segment", order: 2 }} manifestTargets={[]} targetFiles={new Map()} now={NOW} />);
    expect(screen.getByRole("heading", { name: "Industry Segment" })).toBeInTheDocument();
    expect(screen.getByText(/No targets configured for this section yet/)).toBeInTheDocument();
    // No block-bearing node should be counted for an empty section.
    expect(document.querySelectorAll("[data-block-key]").length).toBe(0);
  });
});
