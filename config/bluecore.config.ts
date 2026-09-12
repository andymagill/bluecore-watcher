// Real Bluecore Watcher config — triaged 2026-09-12, see docs/05-SOURCES.md
// for the full method/notes behind each target. Seven targets across all
// four sections; no auth/secrets required for this pass (EIA's key-gated
// API was deferred to M2 — see docs/05-SOURCES.md §3 Market Climate notes).
//
// Paired fixtures live under fixtures/<targetId>/ — captured once, politely,
// per docs/06-OPS-RUNBOOK.md §8 step 2 (see git history for capture notes).
import type { CmieConfigInput } from "../src/config/schema.js";

const SEC_UA = "bluecore-watcher/0.1 (contact: andymagill@gmail.com)";
const GENERAL_UA = "bluecore-watcher/0.1 (+https://github.com/andymagill/bluecore-watcher)";

export const config: CmieConfigInput = {
  schemaVersion: 1,

  environment: {
    id: "bluecore",
    displayName: "Bluecore Watcher",
    entities: [
      { id: "bluecore-energy", name: "BlueCore Energy, Inc.", role: "primary" },
      { id: "oklo-inc", name: "Oklo Inc.", role: "competitor" },
    ],
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
    politeness: { minIntervalMs: 1000, respectRobotsTxt: true, userAgent: GENERAL_UA },
  },

  targets: [
    // --- Target Company State ---------------------------------------

    // Official SEC Form D, not press coverage — ground truth for financial
    // milestones. Deliberately disagrees with the widely-reported "$50M
    // raise": this filing's offering/sold amounts are the real number.
    {
      id: "bluecore-form-d",
      label: "BlueCore Energy — SEC Form D (Seed, Sept 2026)",
      entityId: "bluecore-energy",
      sectionId: "target",
      kind: "html",
      url: "https://www.sec.gov/Archives/edgar/data/2125928/000212592826000003/primary_doc.xml",
      schedule: { cron: "0 6 * * *", ttlHours: 2160 },
      politeness: { minIntervalMs: 2000, userAgent: SEC_UA },
      notes:
        "Form D XML, not a scraped page — tag names are SEC's own schema, as durable as a real id. " +
        "Cheerio's default (non-XML) parser handles the custom tags fine (verified against the live " +
        "filing). Episodic: only 2 filings exist since incorporation (2026-04-06, 2026-09-04), so " +
        "maxChangePct is set generously — an early-stage seed company's next filing could plausibly " +
        "show a multiple of this amount, and that's a real jump worth surfacing, not a selector bug.",
      extractors: [
        {
          key: "total_offering_amount",
          label: "Total Offering Amount",
          presenter: "metric",
          kind: "html",
          selector: "totalOfferingAmount",
          type: "currency",
          currency: "USD",
          required: true,
          assert: { min: 0, max: 200_000_000, maxChangePct: 300 },
        },
        {
          key: "total_amount_sold",
          label: "Total Amount Sold",
          presenter: "metric",
          kind: "html",
          selector: "totalAmountSold",
          type: "currency",
          currency: "USD",
          required: true,
          assert: { min: 0, max: 200_000_000, maxChangePct: 300 },
        },
      ],
    },

    // Recommended M1 walking-skeleton target (see docs/05-SOURCES.md §6.3):
    // one page, three extractors, one section, real anchors, weekly cadence.
    {
      id: "bluecore-newsroom",
      label: "BlueCore Energy — Latest News",
      entityId: "bluecore-energy",
      sectionId: "target",
      kind: "html",
      url: "https://www.bluecore.energy/news-insights",
      schedule: { cron: "0 13 * * *", ttlHours: 168 },
      notes:
        "Use :first, NOT :first-child — each .bc-n-card sits in its own individual Webflow " +
        "collection-list wrapper (div.w-dyn-item), so every card is trivially the first child of its " +
        "own parent and :first-child matched all 12 (SELECTOR_AMBIGUOUS territory), confirmed against " +
        "the live dry run. Also avoid .bc-n-feat-* — that hero block is manually pinned to the July " +
        "stealth-launch post and never advances. Hand-authored bc-n-* classes are stable; nearby " +
        "Webflow UUID ids churn on every republish and must not be used as anchors. .bc-n-cat-key is " +
        "a genuine 3-value enum confirmed via the page's own filter pills.",
      extractors: [
        {
          key: "latest_headline",
          label: "Latest Headline",
          presenter: "markdown",
          kind: "html",
          selector: ".bc-n-ctitle:first",
          type: "string",
          required: true,
          assert: { notEmpty: true, maxLength: 200 },
        },
        {
          key: "latest_post_date",
          label: "Latest Post Date",
          presenter: "metric",
          kind: "html",
          selector: ".bc-n-cdate:first",
          type: "date",
          required: true,
          assert: { notEmpty: true },
        },
        {
          key: "latest_post_category",
          label: "Latest Post Category",
          presenter: "status",
          kind: "html",
          selector: ".bc-n-cat-key:first",
          type: "enum",
          enumValues: ["Press Release", "In the News", "Insights"],
          alert: { on: "any-change", severity: "info" },
        },
      ],
    },

    // Public Lever job board API — no key required. Real-time headcount-
    // growth proxy; genuinely volatile (9 postings created in the last month).
    {
      id: "bluecore-careers",
      label: "BlueCore Energy — Open Roles",
      entityId: "bluecore-energy",
      sectionId: "target",
      kind: "api",
      url: "https://api.lever.co/v0/postings/bluecore-energy?mode=json",
      schedule: { cron: "0 14 * * *", ttlHours: 168 },
      politeness: { minIntervalMs: 1000 }, // Lever's robots.txt sets Crawl-delay: 1
      notes:
        '$.length is jsonpath-plus\'s array-length pseudo-property (verified against the live payload: ' +
        "returns [9], a single match) — cheaper and more durable than counting DOM job-listing rows.",
      extractors: [
        {
          key: "open_roles_count",
          label: "Open Roles",
          presenter: "metric",
          kind: "api",
          jsonPath: "$.length",
          type: "number",
          unit: "roles",
          // Tuned from the real dry-run value (9): maxChangePct is misleading
          // at this base size (9->12 alone is +33%), so this guard leans on
          // maxChangeAbs instead — a jump of >15 open reqs in one interval is
          // the actual anomaly worth flagging for a company this size.
          assert: { min: 0, max: 60, maxChangeAbs: 15 },
        },
      ],
    },

    // --- Industry Segment ---------------------------------------------

    // "Competitor activity" per SPEC.md §3's own definition of this
    // section — Oklo (NYSE: OKLO) is the closest publicly-traded peer at a
    // comparable pre-revenue, scaling-fast stage.
    {
      id: "oklo-sec-filings",
      label: "Oklo Inc. — Latest SEC Filing",
      entityId: "oklo-inc",
      sectionId: "segment",
      kind: "api",
      url: "https://data.sec.gov/submissions/CIK0001849056.json",
      schedule: { cron: "0 12 * * 1-5", ttlHours: 48 },
      politeness: { minIntervalMs: 2000, userAgent: SEC_UA },
      notes:
        "data.sec.gov has no robots.txt (404 = unrestricted) but SEC's documented Fair Access policy " +
        "requires a declared UA with contact info and caps at 10 req/sec — a weekday-daily cron is " +
        "far under that. NuScale (CIK 0001822966) is an equally-viable second competitor, deferred " +
        "to M2 breadth.",
      extractors: [
        {
          key: "latest_filing_form",
          label: "Latest Filing Type",
          presenter: "markdown",
          kind: "api",
          jsonPath: "$.filings.recent.form[0]",
          type: "string",
          required: true,
          assert: { notEmpty: true, maxLength: 20 },
        },
        {
          key: "latest_filing_date",
          label: "Latest Filing Date",
          presenter: "metric",
          kind: "api",
          jsonPath: "$.filings.recent.filingDate[0]",
          type: "date",
          required: true,
          assert: { notEmpty: true },
        },
      ],
    },

    // Sector-wide document volume — a "sector capacity metrics" proxy,
    // distinct from the NRC-specific regulatory count below.
    {
      id: "fr-segment-smr-mentions",
      label: "Federal Register — SMR Mentions (All Agencies)",
      entityId: "bluecore-energy",
      sectionId: "segment",
      kind: "api",
      url: "https://www.federalregister.gov/api/v1/documents.json?conditions%5Bterm%5D=%22small+modular+reactor%22&per_page=1&order=newest",
      schedule: { cron: "0 15 * * *", ttlHours: 168 },
      notes:
        "Federal Register's own documented `count` field. No expectMonotonic — the index can in " +
        "principle be revised down, so a decrease isn't necessarily a bug.",
      extractors: [
        {
          key: "smr_mention_count",
          label: "SMR Document Count",
          presenter: "metric",
          kind: "api",
          jsonPath: "$.count",
          type: "number",
          unit: "documents",
          assert: { min: 0, maxChangePct: 25 }, // tuned: real weekly deltas here run a handful of documents, not dozens
        },
      ],
    },

    // --- Regulatory Landscape -------------------------------------------

    // Bluecore itself has no NRC docket yet (the Long Beach barge holds no
    // fuel and is pre-certification) — this is a segment-level regulatory-
    // attention signal, not a Bluecore-specific docket.
    {
      id: "fr-regulatory-nrc-smr",
      label: "Federal Register — NRC SMR Documents",
      entityId: "bluecore-energy",
      sectionId: "regulatory",
      kind: "api",
      url: "https://www.federalregister.gov/api/v1/documents.json?conditions%5Bagencies%5D%5B%5D=nuclear-regulatory-commission&conditions%5Bterm%5D=%22small+modular+reactor%22&per_page=1&order=newest",
      schedule: { cron: "0 15 * * *", ttlHours: 168 },
      notes: "Revisit once/if a Bluecore-specific NRC docket opens; until then this tracks the class of reactor, not the company.",
      extractors: [
        {
          key: "nrc_smr_document_count",
          label: "NRC SMR Document Count",
          presenter: "metric",
          kind: "api",
          jsonPath: "$.count",
          type: "number",
          unit: "documents",
          assert: { min: 0, maxChangePct: 25 }, // tuned: real weekly deltas here run a handful of documents, not dozens
        },
      ],
    },

    // --- Market Climate ---------------------------------------------

    // DOE policy-attention proxy — "policy incentives" per SPEC.md §3's
    // Market Climate definition.
    {
      id: "fr-climate-doe-nuclear",
      label: "Federal Register — DOE Advanced Nuclear Documents",
      entityId: "bluecore-energy",
      sectionId: "climate",
      kind: "api",
      url: "https://www.federalregister.gov/api/v1/documents.json?conditions%5Bagencies%5D%5B%5D=energy-department&conditions%5Bterm%5D=%22advanced+nuclear%22&per_page=1&order=newest",
      schedule: { cron: "0 15 * * *", ttlHours: 168 },
      notes:
        "EIA's regional price-index APIs (the shape example.config.ts's synthetic climate target " +
        "mimics) require a free api_key (confirmed: api.eia.gov 403s without one) — deferred to M2 " +
        "rather than adding a secret for this pass.",
      extractors: [
        {
          key: "doe_nuclear_policy_count",
          label: "DOE Advanced Nuclear Document Count",
          presenter: "metric",
          kind: "api",
          jsonPath: "$.count",
          type: "number",
          unit: "documents",
          assert: { min: 0, maxChangePct: 25 }, // tuned: real weekly deltas here run a handful of documents, not dozens
        },
      ],
    },
  ],

  alerting: { channel: "github-issue", minSeverity: "warn" },
};
