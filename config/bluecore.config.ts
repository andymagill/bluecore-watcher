// Real Bluecore Watcher config — triaged 2026-09-12, see docs/05-SOURCES.md
// for the full method/notes behind each target. M2a (2026-09-13) brought
// this to nine targets across all four sections, adding the second
// competitor (nuscale-sec-filings) and the first authenticated target
// (eia-ca-industrial-price, EIA_API_KEY) to populate Market Conditions.
//
// Paired fixtures live under fixtures/<targetId>/ — captured via
// `npm run fixture:capture` (scripts/fixture-capture.ts) per
// docs/06-OPS-RUNBOOK.md §9 step 2; golden expected-output files via
// `npm run fixture:bless` (scripts/fixture-bless.ts).
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
      { id: "nuscale-power", name: "NuScale Power Corporation", role: "competitor" },
    ],
  },

  sections: [
    { id: "company", label: "Company Performance", order: 1 },
    { id: "competitive", label: "Competitive Landscape", order: 2 },
    { id: "regulatory", label: "Regulatory & Policy", order: 3 },
    { id: "market", label: "Market Conditions", order: 4 },
  ],

  defaults: {
    renderer: "static",
    proxy: "none",
    politeness: { minIntervalMs: 1000, respectRobotsTxt: true, userAgent: GENERAL_UA },
  },

  targets: [
    // --- Company Performance ---------------------------------------

    // Official SEC Form D, not press coverage — ground truth for financial
    // milestones. Deliberately disagrees with the widely-reported "$50M
    // raise": this filing's offering/sold amounts are the real number.
    {
      id: "bluecore-form-d",
      label: "BlueCore Energy — SEC Form D (Seed, Sept 2026)",
      entityId: "bluecore-energy",
      sectionId: "company",
      kind: "html",
      url: "https://www.sec.gov/Archives/edgar/data/2125928/000212592826000003/primary_doc.xml",
      schedule: { cron: "0 6 * * *", ttlHours: 2160 },
      politeness: { minIntervalMs: 2000, userAgent: SEC_UA },
      notes:
        "Form D XML, not a scraped page — tag names are SEC's own schema, as durable as a real id. " +
        "Cheerio's default (non-XML) parser handles the custom tags fine (verified against the live " +
        "filing). Episodic: only 2 filings exist since incorporation (2026-04-06, 2026-09-04), so " +
        "maxChangePct is set generously — an early-stage seed company's next filing could plausibly " +
        "show a multiple of this amount, and that's a real jump worth surfacing, not a selector bug. " +
        "This URL is pinned to one specific filing (accession 0002125928-26-000003) and cannot see a " +
        "future Form D on its own — bluecore-sec-filings below (M2b) surfaces a new D/D-A so the " +
        "operator knows to repoint this URL.",
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

    // M2b — companion to bluecore-form-d above, which is pinned to one
    // specific accession number and so can never observe BlueCore's next
    // Form D on its own. Same shape as oklo-sec-filings/nuscale-sec-filings:
    // SEC's own submissions JSON, newest-filing-first. Its job is to reveal
    // *that* a new filing exists so the operator can repoint the pinned URL
    // above — not to replace it, since the XML-vs-JSON extraction paths
    // pull genuinely different facts (dollar amounts vs. form/date).
    {
      id: "bluecore-sec-filings",
      label: "BlueCore Energy — Latest SEC Filing",
      entityId: "bluecore-energy",
      sectionId: "company",
      kind: "api",
      url: "https://data.sec.gov/submissions/CIK0002125928.json",
      schedule: { cron: "0 12 * * 1-5", ttlHours: 48 },
      politeness: { minIntervalMs: 2000, userAgent: SEC_UA },
      notes:
        "Verified live 2026-09-13: $.filings.recent.form[0]/.filingDate[0] resolve to the same 'D' " +
        "filing bluecore-form-d's pinned URL currently points at (2026-09-04, accession " +
        "0002125928-26-000003) — identical shape to oklo-sec-filings/nuscale-sec-filings. " +
        "any-change alert so a new filing is visible without waiting on M3 alert dispatch review; " +
        "notBefore is set to the entity's own incorporation (2026-04-06), tighter than the 2020 " +
        "floor used for the two established competitors above.",
      extractors: [
        {
          key: "latest_filing_form",
          label: "Latest Filing Type",
          presenter: "markdown",
          kind: "api",
          jsonPath: "$.filings.recent.form[0]",
          type: "string",
          required: true,
          assert: { notEmpty: true, maxLength: 20, pattern: "^[A-Z0-9][A-Z0-9 ./-]*$" },
          alert: { on: "any-change", severity: "warn" },
        },
        {
          key: "latest_filing_date",
          label: "Latest Filing Date",
          presenter: "metric",
          kind: "api",
          jsonPath: "$.filings.recent.filingDate[0]",
          type: "date",
          required: true,
          assert: {
            notEmpty: true,
            maxFutureDays: 1,
            notBefore: "2026-01-01",
            expectMonotonic: "increasing",
          },
        },
      ],
    },

    // Recommended M1 walking-skeleton target (see docs/05-SOURCES.md §6.3):
    // one page, three extractors, one section, real anchors, polled daily
    // against a source that updates roughly weekly (hence ttlHours: 168).
    {
      id: "bluecore-newsroom",
      label: "BlueCore Energy — Latest News",
      entityId: "bluecore-energy",
      sectionId: "company",
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
          // M2b (was ".bc-n-ctitle:first"): the three fields on this card were
          // each matched by an independent :first over the whole page. Every
          // card carries all three elements today (verified against the
          // fixture: 12/12/12), but that made it possible for a future
          // redesign to drop one field from just the newest card -- the
          // other two :first selectors would then silently pair the
          // headline/date/category from *different* cards. Scoping to
          // ".bc-n-card:first" first, then the field, ties all three to the
          // same DOM node the way "latest post" actually means.
          selector: ".bc-n-card:first .bc-n-ctitle",
          type: "string",
          required: true,
          assert: { notEmpty: true, maxLength: 200 },
        },
        {
          key: "latest_post_date",
          label: "Latest Post Date",
          presenter: "metric",
          kind: "html",
          selector: ".bc-n-card:first .bc-n-cdate",
          type: "date",
          required: true,
          // ADR-018: maxFutureDays catches a selector landing on a scheduled/
          // draft post; expectMonotonic catches a selector regressing to an
          // older card once a newer one is published. A once-real reordering
          // (a post edited and bumped) is exactly what an acknowledgement
          // (ADR-012) is for, not a wider tolerance.
          assert: { notEmpty: true, maxFutureDays: 1, expectMonotonic: "increasing" },
        },
        {
          key: "latest_post_category",
          label: "Latest Post Category",
          presenter: "status",
          kind: "html",
          selector: ".bc-n-card:first .bc-n-cat-key",
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
      sectionId: "company",
      kind: "api",
      url: "https://api.lever.co/v0/postings/bluecore-energy?mode=json",
      schedule: { cron: "0 14 * * *", ttlHours: 168 },
      politeness: { minIntervalMs: 1000 }, // Lever's robots.txt sets Crawl-delay: 1
      notes:
        "$.length is jsonpath-plus's array-length pseudo-property (verified against the live payload: " +
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

    // --- Competitive Landscape ---------------------------------------------

    // "Competitor activity" per SPEC.md §3's own definition of this
    // section — Oklo (NYSE: OKLO) is the closest publicly-traded peer at a
    // comparable pre-revenue, scaling-fast stage.
    {
      id: "oklo-sec-filings",
      label: "Oklo Inc. — Latest SEC Filing",
      entityId: "oklo-inc",
      sectionId: "competitive",
      kind: "api",
      url: "https://data.sec.gov/submissions/CIK0001849056.json",
      schedule: { cron: "0 12 * * 1-5", ttlHours: 48 },
      politeness: { minIntervalMs: 2000, userAgent: SEC_UA },
      notes:
        "data.sec.gov has no robots.txt (404 = unrestricted) but SEC's documented Fair Access policy " +
        "requires a declared UA with contact info and caps at 10 req/sec — a weekday-daily cron is " +
        "far under that. NuScale (CIK 0001822966) is an equally-viable second competitor — see " +
        "nuscale-sec-filings below, added M2a.",
      extractors: [
        {
          key: "latest_filing_form",
          label: "Latest Filing Type",
          presenter: "markdown",
          kind: "api",
          jsonPath: "$.filings.recent.form[0]",
          type: "string",
          required: true,
          // M2b: pattern tuned against all 52 distinct form values across
          // both SEC targets' fixtures (e.g. "4/A", "SCHEDULE 13G/A", "SEC
          // STAFF LETTER") — every one matches; the point is to reject
          // something SEC's own form-code vocabulary would never produce
          // (stray HTML, a JSON key leaking through).
          assert: { notEmpty: true, maxLength: 20, pattern: "^[A-Z0-9][A-Z0-9 ./-]*$" },
        },
        {
          key: "latest_filing_date",
          label: "Latest Filing Date",
          presenter: "metric",
          kind: "api",
          jsonPath: "$.filings.recent.filingDate[0]",
          type: "date",
          required: true,
          // ADR-018: `recent` is SEC's own newest-first array, so a
          // backwards move means the shape changed underneath jsonPath, not
          // a real event. notBefore predates this entity's SEC registration.
          assert: {
            notEmpty: true,
            maxFutureDays: 1,
            notBefore: "2020-01-01",
            expectMonotonic: "increasing",
          },
        },
      ],
    },

    // Second competitor per M2 breadth (previously deferred, see the note
    // on oklo-sec-filings above) — NuScale (NYSE: SMR) is the other
    // publicly-traded advanced-fission peer at a comparable pre-revenue,
    // scaling stage. Identical shape to oklo-sec-filings by design: same
    // API, same two facts, same Fair Access politeness.
    {
      id: "nuscale-sec-filings",
      label: "NuScale Power — Latest SEC Filing",
      entityId: "nuscale-power",
      sectionId: "competitive",
      kind: "api",
      url: "https://data.sec.gov/submissions/CIK0001822966.json",
      schedule: { cron: "0 12 * * 1-5", ttlHours: 48 },
      politeness: { minIntervalMs: 2000, userAgent: SEC_UA },
      notes:
        'Verified live 2026-09-13: CIK 0001822966 resolves to "NUSCALE POWER Corp" (NYSE: SMR), ' +
        "$.filings.recent.form[0] and .filingDate[0] populated identically to oklo-sec-filings' shape " +
        "(most recent filing at triage time: a 4/A dated 2026-09-11). Same Fair Access reasoning as " +
        "oklo-sec-filings — a weekday-daily cron against data.sec.gov is far under the 10 req/sec cap.",
      extractors: [
        {
          key: "latest_filing_form",
          label: "Latest Filing Type",
          presenter: "markdown",
          kind: "api",
          jsonPath: "$.filings.recent.form[0]",
          type: "string",
          required: true,
          // M2b: same pattern/reasoning as oklo-sec-filings — tuned against
          // all 52 distinct form values across both fixtures.
          assert: { notEmpty: true, maxLength: 20, pattern: "^[A-Z0-9][A-Z0-9 ./-]*$" },
        },
        {
          key: "latest_filing_date",
          label: "Latest Filing Date",
          presenter: "metric",
          kind: "api",
          jsonPath: "$.filings.recent.filingDate[0]",
          type: "date",
          required: true,
          // ADR-018: same reasoning as oklo-sec-filings.
          assert: {
            notEmpty: true,
            maxFutureDays: 1,
            notBefore: "2020-01-01",
            expectMonotonic: "increasing",
          },
        },
      ],
    },

    // Sector-wide document volume — a "sector capacity metrics" proxy,
    // distinct from the NRC-specific regulatory count below.
    {
      id: "fr-smr-mentions",
      label: "Federal Register — SMR Mentions (All Agencies)",
      entityId: "bluecore-energy",
      sectionId: "competitive",
      kind: "api",
      url: "https://www.federalregister.gov/api/v1/documents.json?conditions%5Bterm%5D=%22small+modular+reactor%22&per_page=1&order=newest",
      schedule: { cron: "0 15 * * *", ttlHours: 168 },
      notes:
        "Federal Register's own documented `count` field. No expectMonotonic — the index can in " +
        "principle be revised down, so a decrease isn't necessarily a bug. M2b: backfilled weekly " +
        "counts 2026-06-01 through 2026-09-13 (73→76) show real movement of 0-1 document/week; " +
        "maxChangeAbs 10 is ~10x that observed ceiling. min/max are a sanity floor/ceiling, not a " +
        "volatility bound.",
      extractors: [
        {
          key: "smr_mention_count",
          label: "SMR Document Count",
          presenter: "metric",
          kind: "api",
          jsonPath: "$.count",
          type: "number",
          unit: "documents",
          assert: { min: 50, max: 500, maxChangeAbs: 10 },
        },
      ],
    },

    // --- Regulatory & Policy -------------------------------------------

    // Bluecore itself has no NRC docket yet (the Long Beach barge holds no
    // fuel and is pre-certification) — this is a sector-level regulatory-
    // attention signal, not a Bluecore-specific docket.
    {
      id: "fr-nrc-smr",
      label: "Federal Register — NRC SMR Documents",
      entityId: "bluecore-energy",
      sectionId: "regulatory",
      kind: "api",
      url: "https://www.federalregister.gov/api/v1/documents.json?conditions%5Bagencies%5D%5B%5D=nuclear-regulatory-commission&conditions%5Bterm%5D=%22small+modular+reactor%22&per_page=1&order=newest",
      schedule: { cron: "0 15 * * *", ttlHours: 168 },
      notes:
        "Revisit once/if a Bluecore-specific NRC docket opens; until then this tracks the class of " +
        "reactor, not the company. M2b: backfilled weekly counts 2026-06-01 through 2026-09-13 " +
        "(52→55) show real movement of 0-1 document/week; maxChangeAbs 10 is ~10x that observed " +
        "ceiling.",
      extractors: [
        {
          key: "nrc_smr_document_count",
          label: "NRC SMR Document Count",
          presenter: "metric",
          kind: "api",
          jsonPath: "$.count",
          type: "number",
          unit: "documents",
          assert: { min: 35, max: 400, maxChangeAbs: 10 },
        },
      ],
    },

    // DOE policy-attention proxy — "policy incentives" is regulatory
    // attention, not a macro indicator, so this target lives here rather
    // than under Market Conditions.
    {
      id: "fr-doe-nuclear",
      label: "Federal Register — DOE Advanced Nuclear Documents",
      entityId: "bluecore-energy",
      sectionId: "regulatory",
      kind: "api",
      url: "https://www.federalregister.gov/api/v1/documents.json?conditions%5Bagencies%5D%5B%5D=energy-department&conditions%5Bterm%5D=%22advanced+nuclear%22&per_page=1&order=newest",
      schedule: { cron: "0 15 * * *", ttlHours: 168 },
      notes:
        "M2b: backfilled weekly counts 2026-06-01 through 2026-09-13 (49→51) show real movement of " +
        "0-1 document/week; maxChangeAbs 10 is ~10x that observed ceiling.",
      extractors: [
        {
          key: "doe_nuclear_policy_count",
          label: "DOE Advanced Nuclear Document Count",
          presenter: "metric",
          kind: "api",
          jsonPath: "$.count",
          type: "number",
          unit: "documents",
          assert: { min: 35, max: 400, maxChangeAbs: 10 },
        },
      ],
    },

    // --- Market Conditions -----------------------------------------

    // EIA's regional retail electricity price index — the intended fit
    // flagged since M0 (api.eia.gov 403s on every route, including
    // metadata, without a key; deferred until now). California industrial
    // rate is the regional/sector cut most relevant to a Long Beach port
    // operator. First (and so far only) target in this config using
    // `auth` — the config-time (rule 9) and runtime (AUTH_ERROR skip on a
    // missing secret) paths were already implemented and tested before
    // this target existed; this is their first real exercise.
    {
      id: "eia-ca-industrial-price",
      label: "EIA — CA Industrial Retail Electricity Price",
      entityId: "bluecore-energy",
      sectionId: "market",
      kind: "api",
      url: "https://api.eia.gov/v2/electricity/retail-sales/data/?frequency=monthly&data%5B0%5D=price&facets%5Bstateid%5D%5B%5D=CA&facets%5Bsectorid%5D%5B%5D=IND&sort%5B0%5D%5Bcolumn%5D=period&sort%5B0%5D%5Bdirection%5D=desc&length=1",
      schedule: { cron: "0 16 * * *", ttlHours: 1440 },
      auth: { type: "query", name: "api_key", secretEnv: "EIA_API_KEY" },
      notes:
        "EIA v2 API, verified live 2026-09-13: $.response.data[0].price and .period populated as " +
        "expected (most recent at triage time: 20.74 cents/kWh, period 2026-06 — EIA's retail-sales " +
        "series runs ~2-3 months behind real time, hence the generous ttlHours). period is kept as a " +
        'plain string ("YYYY-MM"), not `type: "date"` — it has no day component, and forcing one ' +
        "would be a fabricated fact. The response also echoes `api_key` back verbatim in " +
        "`request.params` — fixture:capture scrubs this (src/ingest/scrub.ts) before writing to disk, " +
        "the same scrubbing the persist layer already applies to committed target files.",
      extractors: [
        {
          key: "retail_price_industrial",
          label: "CA Industrial Retail Price",
          presenter: "metric",
          kind: "api",
          jsonPath: "$.response.data[0].price",
          type: "number",
          unit: "¢/kWh",
          required: true,
          // M2b: min/max tightened from a bare non-negative check to a real
          // sanity band for a US industrial retail rate in ¢/kWh (EIA's
          // national range across all states/sectors runs roughly 5-40;
          // California industrial has run 17.7-25.53 over the 3yr backfill
          // below). maxChangePct backfilled against 36mo of this series'
          // real history (api.eia.gov, 2023-07 through 2026-06): prices
          // trace a seasonal summer-peak/winter-trough pattern, and the
          // largest observed single-month move in that window was 16.31%
          // (2025-10: 23.05 -> 2025-11: 19.29). 25 is ~1.5x that ceiling —
          // real seasonal swings publish, a decimal-place/unit error (a 10x
          // jump) doesn't.
          assert: { min: 5, max: 60, maxChangePct: 25, notEmpty: true },
        },
        {
          key: "price_period",
          label: "Price Period",
          presenter: "markdown",
          kind: "api",
          jsonPath: "$.response.data[0].period",
          type: "string",
          required: true,
          // M2b: pattern is tighter than maxLength alone — rejects a
          // structurally-valid-but-wrong string (e.g. a day-granularity
          // period, or the API starting to echo a range) that 7 characters
          // wouldn't catch.
          assert: { notEmpty: true, maxLength: 7, pattern: "^\\d{4}-(0[1-9]|1[0-2])$" },
        },
      ],
    },
  ],

  alerting: { channel: "github-issue", minSeverity: "warn" },
};
