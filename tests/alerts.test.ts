// Exercises src/alerts/plan.ts — the pure post-merge alert planner
// (M3a/ADR-019). Every case builds two committed states (prev/next) plus a
// config and existing-issue list, and asserts on the resulting actions.
import { describe, expect, it } from "vitest";
import { planAlerts, type CommittedState, type ExistingAlertIssue } from "../src/alerts/plan.js";
import { CmieConfig, type CmieConfigInput } from "../src/config/schema.js";
import { TargetFile } from "../src/contract/target-file.js";
import { Health, HealthEntry } from "../src/contract/health.js";
import type { Block } from "../src/contract/block.js";

const NOW = new Date("2026-09-14T12:00:00.000Z");

function makeConfig(params: {
  extractor: CmieConfigInput["targets"][number]["extractors"][number];
  minSeverity?: "info" | "warn" | "critical";
}): CmieConfig {
  const input: CmieConfigInput = {
    schemaVersion: 1,
    environment: {
      id: "test-env",
      displayName: "Test Env",
      entities: [{ id: "primary", name: "Primary Co", role: "primary" }],
    },
    sections: [{ id: "company", label: "Company", order: 1 }],
    targets: [
      {
        id: "t1",
        label: "Target One",
        entityId: "primary",
        sectionId: "company",
        kind: "html",
        url: "https://example.test/page",
        schedule: { cron: "0 6 * * *", ttlHours: 72 },
        extractors: [params.extractor],
      },
    ],
    alerting: { channel: "github-issue", minSeverity: params.minSeverity ?? "warn" },
  };
  return CmieConfig.parse(input);
}

function makeTargetFile(blocks: Block[], overrides: Partial<TargetFile> = {}): TargetFile {
  return TargetFile.parse({
    schemaVersion: 1,
    targetId: "t1",
    entityId: "primary",
    sectionId: "company",
    label: "Target One",
    sourceUrl: "https://example.test/page",
    ttlHours: 72,
    run: {
      runId: "run1",
      startedAt: "2026-09-14T00:00:00.000Z",
      completedAt: "2026-09-14T00:00:05.000Z",
      durationMs: 5000,
      status: "ok",
      renderer: "static",
      httpStatus: 200,
    },
    blocks,
    ...overrides,
  });
}

function makeHealthEntry(overrides: Partial<HealthEntry> = {}): HealthEntry {
  return HealthEntry.parse({
    targetId: "t1",
    extractorKey: "e1",
    status: "failed",
    errorClass: "SELECTOR_NO_MATCH",
    message: "Selector matched 0 nodes",
    failingSelector: "#x",
    httpStatus: 200,
    firstSeenAt: "2026-09-14T00:00:00.000Z",
    consecutiveFailures: 1,
    servingCachedFrom: null,
    stack: null,
    ...overrides,
  });
}

function makeHealth(entries: HealthEntry[]): Health {
  return Health.parse({
    schemaVersion: 1,
    generatedAt: "2026-09-14T00:00:00.000Z",
    runId: "run1",
    summary: {
      targets: 1,
      ok: 0,
      degraded: entries.filter((e) => e.status === "flagged").length,
      failed: entries.filter((e) => e.status === "failed").length,
      oldestDataAgeHours: 0,
      targetsPastCeiling: 0,
    },
    entries,
  });
}

function state(targetFiles: TargetFile[] = [], health: Health | null = null): CommittedState {
  return {
    manifest: null,
    health,
    targetFiles: new Map(targetFiles.map((tf) => [tf.targetId, tf])),
  };
}

const HTML_EXTRACTOR_BASE = {
  key: "e1",
  label: "Extractor One",
  presenter: "metric" as const,
  kind: "html" as const,
  selector: "#x",
  type: "number" as const,
};

function scalarBlock(overrides: Partial<Block> = {}): Block {
  return {
    key: "e1",
    label: "Extractor One",
    type: "number",
    status: "ok",
    validation: { passed: true, warnings: [] },
    presenter: "metric",
    value: 100,
    displayValue: "100",
    provenance: {
      sourceUrl: "https://example.test/page",
      extractedAt: "2026-09-14T00:00:00.000Z",
      contentHash: "sha256:aaaaaa",
      anchor: "#x",
      rawText: "100",
    },
    delta: null,
    ...overrides,
  } as Block;
}

describe("planAlerts — value alerts", () => {
  it("any-change: fires when contentHash differs from a prior value", () => {
    const config = makeConfig({
      extractor: { ...HTML_EXTRACTOR_BASE, alert: { on: "any-change" } },
    });
    const prev = state([
      makeTargetFile([
        scalarBlock({
          value: 100,
          provenance: {
            sourceUrl: "https://example.test/page",
            extractedAt: "2026-09-13T00:00:00.000Z",
            contentHash: "sha256:aaaaaa",
            anchor: "#x",
            rawText: "100",
          },
        }),
      ]),
    ]);
    const next = state([
      makeTargetFile([
        scalarBlock({
          value: 200,
          displayValue: "200",
          provenance: {
            sourceUrl: "https://example.test/page",
            extractedAt: "2026-09-14T00:00:00.000Z",
            contentHash: "sha256:bbbbbb",
            anchor: "#x",
            rawText: "200",
          },
        }),
      ]),
    ]);

    const actions = planAlerts({ prev, next, config, existingIssues: [], now: NOW });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: "create", key: "value:t1.e1", severity: "warn" });
  });

  it("any-change: does not fire on first extraction (no prior value)", () => {
    const config = makeConfig({
      extractor: { ...HTML_EXTRACTOR_BASE, alert: { on: "any-change" } },
    });
    const prev = state([]);
    const next = state([makeTargetFile([scalarBlock()])]);

    expect(planAlerts({ prev, next, config, existingIssues: [], now: NOW })).toHaveLength(0);
  });

  it("threshold: fires above the limit, not below it", () => {
    const config = makeConfig({
      extractor: { ...HTML_EXTRACTOR_BASE, alert: { on: "threshold", thresholdPct: 10 } },
    });
    const prev = state([makeTargetFile([scalarBlock({ value: 100 })])]);

    const above = state([
      makeTargetFile([
        scalarBlock({
          value: 116,
          delta: {
            kind: "scalar",
            previousValue: 100,
            previousExtractedAt: "2026-09-13T00:00:00.000Z",
            changedAt: "2026-09-14T00:00:00.000Z",
            direction: "up",
            absolute: 16,
            percent: 16,
          },
        }),
      ]),
    ]);
    expect(planAlerts({ prev, next: above, config, existingIssues: [], now: NOW })).toHaveLength(1);

    const below = state([
      makeTargetFile([
        scalarBlock({
          value: 105,
          delta: {
            kind: "scalar",
            previousValue: 100,
            previousExtractedAt: "2026-09-13T00:00:00.000Z",
            changedAt: "2026-09-14T00:00:00.000Z",
            direction: "up",
            absolute: 5,
            percent: 5,
          },
        }),
      ]),
    ]);
    expect(planAlerts({ prev, next: below, config, existingIssues: [], now: NOW })).toHaveLength(0);
  });

  it("does not fire on a block that isn't status ok this run", () => {
    const config = makeConfig({
      extractor: { ...HTML_EXTRACTOR_BASE, alert: { on: "any-change" } },
    });
    const prev = state([makeTargetFile([scalarBlock()])]);
    const next = state([
      makeTargetFile([
        scalarBlock({
          status: "cached",
          provenance: {
            sourceUrl: "https://example.test/page",
            extractedAt: "2026-09-14T00:00:00.000Z",
            contentHash: "sha256:cccccc",
            anchor: "#x",
            rawText: "different",
          },
        }),
      ]),
    ]);
    expect(planAlerts({ prev, next, config, existingIssues: [], now: NOW })).toHaveLength(0);
  });

  it("the severity filter suppresses a below-minSeverity alert and lets a matching one through", () => {
    const suppressed = makeConfig({
      extractor: { ...HTML_EXTRACTOR_BASE, alert: { on: "any-change", severity: "info" } },
      minSeverity: "warn",
    });
    const prev = state([makeTargetFile([scalarBlock()])]);
    const next = state([
      makeTargetFile([
        scalarBlock({
          provenance: {
            sourceUrl: "https://example.test/page",
            extractedAt: "2026-09-14T00:00:00.000Z",
            contentHash: "sha256:bbbbbb",
            anchor: "#x",
            rawText: "changed",
          },
        }),
      ]),
    ]);
    expect(
      planAlerts({ prev, next, config: suppressed, existingIssues: [], now: NOW }),
    ).toHaveLength(0);

    const allowed = makeConfig({
      extractor: { ...HTML_EXTRACTOR_BASE, alert: { on: "any-change", severity: "critical" } },
      minSeverity: "warn",
    });
    expect(planAlerts({ prev, next, config: allowed, existingIssues: [], now: NOW })).toHaveLength(
      1,
    );
  });

  it("quietHours suppresses a repeat within the window and allows one past it", () => {
    const config = makeConfig({
      extractor: { ...HTML_EXTRACTOR_BASE, alert: { on: "any-change", quietHours: 24 } },
    });
    const prev = state([makeTargetFile([scalarBlock()])]);
    const next = state([
      makeTargetFile([
        scalarBlock({
          provenance: {
            sourceUrl: "https://example.test/page",
            extractedAt: "2026-09-14T00:00:00.000Z",
            contentHash: "sha256:bbbbbb",
            anchor: "#x",
            rawText: "changed",
          },
        }),
      ]),
    ]);

    const withinWindow: ExistingAlertIssue[] = [
      { key: "value:t1.e1", number: 5, state: "open", lastFiredAt: "2026-09-14T11:00:00.000Z" }, // 1h ago
    ];
    expect(planAlerts({ prev, next, config, existingIssues: withinWindow, now: NOW })).toHaveLength(
      0,
    );

    const pastWindow: ExistingAlertIssue[] = [
      { key: "value:t1.e1", number: 5, state: "open", lastFiredAt: "2026-09-13T06:00:00.000Z" }, // 30h ago
    ];
    const actions = planAlerts({ prev, next, config, existingIssues: pastWindow, now: NOW });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: "comment", number: 5 });
  });

  it("reopens a closed issue instead of creating a duplicate", () => {
    const config = makeConfig({
      extractor: { ...HTML_EXTRACTOR_BASE, alert: { on: "any-change" } },
    });
    const prev = state([makeTargetFile([scalarBlock()])]);
    const next = state([
      makeTargetFile([
        scalarBlock({
          provenance: {
            sourceUrl: "https://example.test/page",
            extractedAt: "2026-09-14T00:00:00.000Z",
            contentHash: "sha256:bbbbbb",
            anchor: "#x",
            rawText: "changed",
          },
        }),
      ]),
    ]);
    const existingIssues: ExistingAlertIssue[] = [
      { key: "value:t1.e1", number: 7, state: "closed", lastFiredAt: "2026-08-01T00:00:00.000Z" },
    ];
    const actions = planAlerts({ prev, next, config, existingIssues, now: NOW });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: "reopen", number: 7 });
  });

  it("identical prev/next state produces no actions", () => {
    const config = makeConfig({
      extractor: { ...HTML_EXTRACTOR_BASE, alert: { on: "any-change" } },
    });
    const s = state([makeTargetFile([scalarBlock()])]);
    expect(planAlerts({ prev: s, next: s, config, existingIssues: [], now: NOW })).toHaveLength(0);
  });
});

describe("planAlerts — health alerts", () => {
  const config = makeConfig({ extractor: HTML_EXTRACTOR_BASE });

  it("fires only at 1/3/7 consecutive failures, not at 2/4/5/6/8", () => {
    const expectedFires: Record<number, boolean> = {
      1: true,
      2: false,
      3: true,
      4: false,
      5: false,
      6: false,
      7: true,
      8: false,
    };
    for (const [countStr, shouldFire] of Object.entries(expectedFires)) {
      const count = Number(countStr);
      const prev = state(
        [],
        count > 1
          ? makeHealth([makeHealthEntry({ consecutiveFailures: count - 1 })])
          : makeHealth([]),
      );
      const next = state([], makeHealth([makeHealthEntry({ consecutiveFailures: count })]));
      const actions = planAlerts({ prev, next, config, existingIssues: [], now: NOW });
      expect(actions.length, `consecutiveFailures=${count}`).toBe(shouldFire ? 1 : 0);
    }
  });

  it("closes the issue on recovery (no entries left for the target)", () => {
    const prev = state([], makeHealth([makeHealthEntry({ consecutiveFailures: 3 })]));
    const next = state([], makeHealth([]));
    const existingIssues: ExistingAlertIssue[] = [
      { key: "health:t1", number: 9, state: "open", lastFiredAt: "2026-09-10T00:00:00.000Z" },
    ];
    const actions = planAlerts({ prev, next, config, existingIssues, now: NOW });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: "close", number: 9, key: "health:t1" });
  });

  it("does not close when there is no open issue to close", () => {
    const prev = state([], makeHealth([makeHealthEntry({ consecutiveFailures: 1 })]));
    const next = state([], makeHealth([]));
    expect(planAlerts({ prev, next, config, existingIssues: [], now: NOW })).toHaveLength(0);
  });

  it("escalates to critical severity at 7 consecutive failures", () => {
    const prev = state([], makeHealth([makeHealthEntry({ consecutiveFailures: 6 })]));
    const next = state([], makeHealth([makeHealthEntry({ consecutiveFailures: 7 })]));
    const actions = planAlerts({ prev, next, config, existingIssues: [], now: NOW });
    expect(actions[0]).toMatchObject({ severity: "critical" });
  });

  it("the guard-trip body includes a ready-to-paste acknowledgement snippet with the rejected hash", () => {
    const tf = makeTargetFile([
      scalarBlock({
        status: "flagged",
        validation: {
          passed: false,
          warnings: [
            {
              guard: "maxChangePct",
              rejectedCandidate: 9999,
              retainedValue: 100,
              rejectedContentHash: "sha256:deadbeef",
            },
          ],
        },
      }),
    ]);
    const prev = state([tf], makeHealth([]));
    const next = state(
      [tf],
      makeHealth([
        makeHealthEntry({
          status: "flagged",
          errorClass: "CHANGE_GUARD_TRIPPED",
          message: "maxChangePct: candidate 9999 exceeds tolerance",
          failingSelector: null,
          consecutiveFailures: 1,
        }),
      ]),
    );
    const actions = planAlerts({ prev, next, config, existingIssues: [], now: NOW });
    expect(actions).toHaveLength(1);
    expect(actions[0]!.body).toContain("sha256:deadbeef");
    expect(actions[0]!.body).toContain("acknowledgements.json");
  });
});
