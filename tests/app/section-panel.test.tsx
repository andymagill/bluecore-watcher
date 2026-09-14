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
    targetId: "example-newsroom",
    entityId: "example-co",
    sectionId: "company",
    label: "Example Co - Latest News",
    sourceUrl: "https://www.example.test/news-insights",
    ttlHours: 168,
    run: {
      runId: "r1",
      startedAt: "2026-09-12T00:00:00Z",
      completedAt: "2026-09-12T00:00:00Z",
      durationMs: 100,
      status: "ok",
      renderer: "static",
      httpStatus: 200,
    },
    blocks: [
      {
        key: "latest_headline",
        label: "Latest Headline",
        type: "string",
        presenter: "markdown",
        status: "ok",
        value: "Example Co announces new milestone",
        displayValue: "Example Co announces new milestone",
        provenance: {
          sourceUrl: "https://www.example.test/news-insights",
          anchor: ".bc-n-ctitle:first",
          extractedAt: "2026-09-12T00:00:00Z",
          rawText: "Example Co announces new milestone",
          contentHash: "sha256:aabbcc",
        },
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
        section={{ id: "company", label: "Company Performance", order: 1 }}
        manifestTargets={[
          {
            id: "example-newsroom",
            sectionId: "company",
            entityId: "example-co",
            label: tf.label,
            path: "sections/company/example-newsroom.json",
            ttlHours: 168,
            lastRunStatus: "ok",
            lastSuccessAt: "2026-09-12T00:00:00Z",
          },
        ]}
        targetFiles={new Map([["example-newsroom", tf]])}
        now={NOW}
      />,
    );
    expect(screen.getByText("Company Performance")).toBeInTheDocument();
    expect(screen.getByText(tf.label)).toBeInTheDocument();
    expect(
      document.querySelector('[data-block-key="example-newsroom.latest_headline"]'),
    ).not.toBeNull();
  });

  // M3c gate risk (docs/plans/m3-operability.md M3c): a block suppressed via
  // the new failure-age path to `expired` must still be counted by the
  // smoke-render gate the same way a ttl-based `expired` block already is
  // (src/gate/smoke-render.ts counts data-block-key nodes, not visible
  // text) -- MetricBlock/MarkdownBlock render the suppressed value behind a
  // <details> disclosure, not omit it.
  it("a long-failing (cached) block past the failure-age ceiling still renders its data-block-key node, suppressed behind a disclosure", () => {
    const longFailingTargetFile = TargetFile.parse({
      ...makeTargetFile(),
      ttlHours: 2160, // long TTL -- the ttl-based ceiling (270 days) is nowhere close
      staleCeilingHours: 2160 * 3,
      blocks: [
        {
          key: "latest_headline",
          label: "Latest Headline",
          type: "string",
          presenter: "markdown",
          status: "cached",
          value: "Example Co announces new milestone",
          displayValue: "Example Co announces new milestone",
          provenance: {
            sourceUrl: "https://www.example.test/news-insights",
            anchor: ".bc-n-ctitle:first",
            extractedAt: "2026-08-01T00:00:00Z",
            rawText: "Example Co announces new milestone",
            contentHash: "sha256:aabbcc",
          },
          delta: null,
          validation: { passed: false, warnings: [] },
          failingSince: "2026-08-01T00:00:00Z", // 42 days before NOW -- past the default 14-day ceiling
        },
      ],
    });
    render(
      <SectionPanel
        section={{ id: "company", label: "Company Performance", order: 1 }}
        manifestTargets={[
          {
            id: "example-newsroom",
            sectionId: "company",
            entityId: "example-co",
            label: longFailingTargetFile.label,
            path: "sections/company/example-newsroom.json",
            ttlHours: 2160,
            lastRunStatus: "partial",
            lastSuccessAt: "2026-08-01T00:00:00Z",
          },
        ]}
        targetFiles={new Map([["example-newsroom", longFailingTargetFile]])}
        now={NOW}
      />,
    );
    // Still counted -- the gate risk this test guards against.
    const blockNode = document.querySelector('[data-block-key="example-newsroom.latest_headline"]');
    expect(blockNode).not.toBeNull();
    // And genuinely suppressed, not just present: the value sits behind a
    // <details> summary rather than in the open, same as ttl-based expired.
    expect(blockNode!.querySelector("details")).not.toBeNull();
    const badge = blockNode!.querySelector('[data-freshness-state="expired"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toMatch(/Last known value from/);
  });

  it("renders an explicit zero-state when the section has no targets (competitive/regulatory/market in M1)", () => {
    render(
      <SectionPanel
        section={{ id: "competitive", label: "Competitive Landscape", order: 2 }}
        manifestTargets={[]}
        targetFiles={new Map()}
        now={NOW}
      />,
    );
    expect(screen.getByRole("heading", { name: "Competitive Landscape" })).toBeInTheDocument();
    expect(screen.getByText(/No targets configured for this section yet/)).toBeInTheDocument();
    // No block-bearing node should be counted for an empty section.
    expect(document.querySelectorAll("[data-block-key]").length).toBe(0);
  });
});
