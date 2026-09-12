// Synthetic, non-Bluecore config exercising every kind, presenter, type,
// and assertion — proves the validator and the M0.5 engine spine without a
// real source list (ADR-010 area; Q1 does not block this). Doubles as the
// ADR-001 conformance check: nothing here may become entity-specific code.
//
// Paired fixtures live under fixtures/<targetId>/ (Phase 5).
import type { CmieConfigInput } from "../src/config/schema.js";

export const config: CmieConfigInput = {
  schemaVersion: 1,

  environment: {
    id: "example",
    displayName: "Example Environment",
    entities: [
      { id: "example-co", name: "Example Co", role: "primary" },
      { id: "rival-co", name: "Rival Co", role: "competitor" },
    ],
    staleCeilingMultiplier: 3,
  },

  sections: [
    { id: "target", label: "Target Company State", order: 1 },
    { id: "segment", label: "Industry Segment", order: 2 },
    { id: "regulatory", label: "Regulatory Landscape", order: 3 },
    { id: "climate", label: "Market Climate", order: 4 },
  ],

  defaults: {
    renderer: "static",
    proxy: "none",
    politeness: { minIntervalMs: 1000, respectRobotsTxt: true },
  },

  targets: [
    // --- html target: metric presenter, number type, full assertion set. ---
    {
      id: "example-capacity",
      label: "Example Co — Facility Capacity",
      entityId: "example-co",
      sectionId: "target",
      kind: "html",
      url: "https://example.test/facility/capacity",
      schedule: { cron: "0 6 * * *", ttlHours: 72 },
      notes: "Synthetic fixture. Table cell matched by a stable id, not nth-child.",
      extractors: [
        {
          key: "facility_capacity_teu",
          label: "Facility Capacity",
          presenter: "metric",
          kind: "html",
          selector: "#capacity-table td[data-field=capacity]",
          type: "number",
          unit: "TEU",
          required: true,
          regex: "([\\d,]+)",
          assert: { min: 1000, max: 500000, maxChangePct: 25 },
          alert: { on: "threshold", thresholdPct: 10, severity: "warn" },
        },
      ],
    },

    // --- html target: list presenter, multiple: true, SetDelta path. ---
    {
      id: "example-dockets",
      label: "Example Co — Active Dockets",
      entityId: "example-co",
      sectionId: "regulatory",
      kind: "html",
      url: "https://example.test/puc/dockets",
      schedule: { cron: "0 7 * * *", ttlHours: 168 },
      notes: "Synthetic fixture. List items keyed by docket id, not position.",
      extractors: [
        {
          key: "active_dockets",
          label: "Active Dockets",
          presenter: "list",
          kind: "html",
          selector: ".docket-list li",
          multiple: true,
          type: "string",
          assert: { notEmpty: true, maxLength: 200, minItems: 0, maxItems: 50 },
        },
        // --- same target, status presenter, enum type. ---
        {
          key: "lead_docket_status",
          label: "Lead Docket Status",
          presenter: "status",
          kind: "html",
          selector: ".docket-header .status-badge",
          type: "enum",
          enumValues: ["Filed", "Under Review", "Approved", "Denied", "Withdrawn"],
          alert: { on: "any-change", severity: "critical" },
        },
        // --- same target, markdown presenter. ---
        {
          key: "latest_filing_summary",
          label: "Latest Filing",
          presenter: "markdown",
          kind: "html",
          selector: ".filing-list li:first-child .summary",
          type: "markdown",
          assert: { notEmpty: true, maxLength: 2000 },
        },
      ],
    },

    // --- api target: metric presenter, currency type via jsonPath. ---
    {
      id: "example-price-index",
      label: "Example Regional Price Index",
      entityId: "example-co",
      sectionId: "climate",
      kind: "api",
      url: "https://api.example.test/v1/series?series_id=EXAMPLE",
      schedule: { cron: "0 7 * * 1-5", ttlHours: 48 },
      extractors: [
        {
          key: "spot_price",
          label: "Spot Price",
          presenter: "metric",
          kind: "api",
          jsonPath: "$.series[0].data[0][1]",
          type: "currency",
          currency: "USD",
          assert: { min: 0, maxChangePct: 40 },
          alert: { on: "threshold", thresholdPct: 15, quietHours: 24 },
        },
      ],
    },
  ],

  alerting: { channel: "github-issue", minSeverity: "warn" },
};
