// Real Bluecore Watcher config — triaged 2026-09-12, see docs/05-SOURCES.md
// for the full method/notes behind each target. M2a (2026-09-13) brought
// this to nine targets across all four sections, adding the second
// competitor (nuscale-sec-filings) and the first authenticated target
// (eia-ca-industrial-price, EIA_API_KEY) to populate Market Conditions.
//
// Paired fixtures live under fixtures/<targetId>/ — captured via
// `npm run fixture:capture` (scripts/fixture-capture.ts) per
// docs/06-OPS-RUNBOOK.md §10 step 2; golden expected-output files via
// `npm run fixture:bless` (scripts/fixture-bless.ts).
import type { CmieConfigInput } from "../src/config/schema.js";

const SEC_UA = "bluecore-watcher/0.1 (contact: andymagill@gmail.com)";
const GENERAL_UA = "bluecore-watcher/0.1 (+https://github.com/andymagill/bluecore-watcher)";

// M4b (ADR-022): SEC's own Form 8-K item schedule — code to plain-English
// title, covering the full modern (post-2004) set so a composite `valueMap`
// extractor over `filings.recent.items[i]` never hits an unmapped code
// (compose.ts throws PARSE_ERROR on a miss). 19 of these 32 codes have been
// observed across the two competitor fixtures' history; the rest are mapped
// ahead of need rather than guessed, from SEC's own Form 8-K instructions.
// Does not cover pre-2004 bare item numbers ("Item 5") — neither fixture's
// `recent` window reaches back that far.
const SEC_8K_ITEMS: Record<string, string> = {
  "1.01": "Entry into a Material Definitive Agreement",
  "1.02": "Termination of a Material Definitive Agreement",
  "1.03": "Bankruptcy or Receivership",
  "1.04": "Mine Safety – Reporting of Shutdowns and Patterns of Violations",
  "1.05": "Material Cybersecurity Incidents",
  "2.01": "Completion of Acquisition or Disposition of Assets",
  "2.02": "Results of Operations and Financial Condition",
  "2.03":
    "Creation of a Direct Financial Obligation or an Obligation under an Off-Balance Sheet Arrangement of a Registrant",
  "2.04":
    "Triggering Events That Accelerate or Increase a Direct Financial Obligation or an Obligation under an Off-Balance Sheet Arrangement",
  "2.05": "Costs Associated with Exit or Disposal Activities",
  "2.06": "Material Impairments",
  "3.01":
    "Notice of Delisting or Failure to Satisfy a Continued Listing Rule or Standard; Transfer of Listing",
  "3.02": "Unregistered Sales of Equity Securities",
  "3.03": "Material Modification to Rights of Security Holders",
  "4.01": "Changes in Registrant's Certifying Accountant",
  "4.02":
    "Non-Reliance on Previously Issued Financial Statements or a Related Audit Report or Completed Interim Review",
  "5.01": "Changes in Control of Registrant",
  "5.02":
    "Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers; Compensatory Arrangements of Certain Officers",
  "5.03": "Amendments to Articles of Incorporation or Bylaws; Change in Fiscal Year",
  "5.04": "Temporary Suspension of Trading Under Registrant's Employee Benefit Plans",
  "5.05":
    "Amendment to Registrant's Code of Ethics, or Waiver of a Provision of the Code of Ethics",
  "5.06": "Change in Shell Company Status",
  "5.07": "Submission of Matters to a Vote of Security Holders",
  "5.08": "Shareholder Director Nominations",
  "6.01": "ABS Informational and Computational Material",
  "6.02": "Change of Servicer or Trustee",
  "6.03": "Change in Credit Enhancement or Other External Support",
  "6.04": "Failure to Make a Required Distribution",
  "6.05": "Securities Act Updating Disclosure",
  "7.01": "Regulation FD Disclosure",
  "8.01": "Other Events",
  "9.01": "Financial Statements and Exhibits",
};

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
        "floor used for the two established competitors above. M4b: this filer has exactly two " +
        "filings on record (both Form D) — no 8-K exists (verified live 2026-09-16), so unlike the " +
        "two competitor targets this gets a generic latest-filing composite over row 0 (always " +
        "present) rather than an 8-K-specific one.",
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
        {
          key: "latest_filing_summary",
          label: "Latest Filing",
          presenter: "markdown",
          kind: "api",
          type: "markdown",
          // No `index` — row 0 always exists here, unlike the two
          // competitor targets' 8-K-specific extractor. CIK unpadded, same
          // reasoning as latest_8k above. `doc` is escape: "none", not
          // "url" — this filer's own row-0 primaryDocument is
          // "xslFormDX01/primary_doc.xml" (SEC's XSL-viewer path prefix for
          // a Form D), and encodeURIComponent turns that literal "/" into
          // "%2F", which 303s instead of 200 (verified live 2026-09-16).
          fields: {
            form: { jsonPath: "$.filings.recent.form[0]" },
            date: { jsonPath: "$.filings.recent.filingDate[0]" },
            acc: { jsonPath: "$.filings.recent.accessionNumber[0]", strip: "-", escape: "none" },
            doc: { jsonPath: "$.filings.recent.primaryDocument[0]", escape: "none" },
          },
          template:
            "**{form}** filed {date} — [primary document](https://www.sec.gov/Archives/edgar/data/2125928/{acc}/{doc})",
          assert: { notEmpty: true, maxLength: 500 },
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
        {
          key: "latest_8k",
          label: "Latest 8-K",
          presenter: "markdown",
          kind: "api",
          type: "markdown",
          // ADR-022: the row of interest isn't at a fixed index (verified
          // live 2026-09-16 — Oklo's first 8-K sat at index 1 on 2026-09-13
          // and index 7 three days later), so `index` finds it and every
          // {index} field reads that same row.
          index: { jsonPath: '$.filings.recent.form[?(@ === "8-K")]~', pick: "first" },
          fields: {
            items: {
              jsonPath: "$.filings.recent.items[{index}]",
              split: ",",
              valueMap: SEC_8K_ITEMS,
              join: "; ",
            },
            date: { jsonPath: "$.filings.recent.filingDate[{index}]" },
            acc: {
              jsonPath: "$.filings.recent.accessionNumber[{index}]",
              strip: "-",
              escape: "none",
            },
            // escape: "none", not "url" — an 8-K's primaryDocument is a
            // flat filename today, but bluecore-sec-filings' Form D proved
            // SEC sometimes nests it under a viewer-path prefix
            // ("xslFormDX01/primary_doc.xml"); encodeURIComponent would
            // turn that "/" into "%2F" and break the link (verified live
            // 2026-09-16 — see bluecore-sec-filings' latest_filing_summary).
            doc: { jsonPath: "$.filings.recent.primaryDocument[{index}]", escape: "none" },
          },
          // CIK unpadded — the zero-padded form of the EDGAR Archives path
          // 301-redirects (verified live 2026-09-16); no alert here, mirroring
          // latest_filing_date's pattern — latest_filing_form's any-change
          // would be redundant noise since it already fires on any new filing.
          template:
            "**{items}** filed {date} — [primary document](https://www.sec.gov/Archives/edgar/data/1849056/{acc}/{doc})",
          // 1200, not the plan doc's 500: a multi-item 8-K can compose six
          // labels, several over 100 chars, before markdown-escaping.
          assert: { notEmpty: true, maxLength: 1200 },
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
        {
          key: "latest_8k",
          label: "Latest 8-K",
          presenter: "markdown",
          kind: "api",
          type: "markdown",
          // ADR-022: same reasoning as oklo-sec-filings — NuScale's first
          // 8-K sat at index 9 (verified live 2026-09-16, matching the
          // 2026-09-13 fixture). `doc` is escape: "none" for the same
          // reason as oklo-sec-filings' latest_8k.
          index: { jsonPath: '$.filings.recent.form[?(@ === "8-K")]~', pick: "first" },
          fields: {
            items: {
              jsonPath: "$.filings.recent.items[{index}]",
              split: ",",
              valueMap: SEC_8K_ITEMS,
              join: "; ",
            },
            date: { jsonPath: "$.filings.recent.filingDate[{index}]" },
            acc: {
              jsonPath: "$.filings.recent.accessionNumber[{index}]",
              strip: "-",
              escape: "none",
            },
            doc: { jsonPath: "$.filings.recent.primaryDocument[{index}]", escape: "none" },
          },
          template:
            "**{items}** filed {date} — [primary document](https://www.sec.gov/Archives/edgar/data/1822966/{acc}/{doc})",
          assert: { notEmpty: true, maxLength: 1200 },
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
        "volatility bound. M4b: `per_page=1` in the URL is not honoured by FR's API (verified live " +
        "2026-09-16 — it returns 20 results regardless), but `order=newest` still puts the most " +
        "recent document at `results[0]`, which is what every extractor below relies on.",
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
        {
          key: "latest_document_title",
          label: "Latest Document",
          presenter: "markdown",
          kind: "api",
          type: "markdown",
          // Composite so the dashboard links straight to the document.
          // `url` needs escape: "none" — the default markdown escape would
          // mangle "://" and the path's own hyphens/parens.
          fields: {
            title: { jsonPath: "$.results[0].title" },
            url: { jsonPath: "$.results[0].html_url", escape: "none" },
          },
          template: "[{title}]({url})",
          // 1000, not the ~300 a title alone would need: live titles across
          // this query run up to 299 chars, and 5-8% contain "[]()" that the
          // default markdown escape doubles in length (verified live 2026-09-16).
          assert: { notEmpty: true, maxLength: 1000 },
        },
        {
          key: "latest_document_type",
          label: "Latest Document Type",
          presenter: "status",
          kind: "api",
          type: "enum",
          jsonPath: "$.results[0].type",
          // Verified live 2026-09-16 against 1000 documents spanning
          // 2011-2026 across all three FR targets' queries: exactly these
          // five values occur. "Uncategorized Document" is real (one hit in
          // fr-doe-nuclear's own 51-document result set) and easy to miss —
          // an unmapped value here would be silently rejected as invalid.
          enumValues: [
            "Rule",
            "Proposed Rule",
            "Notice",
            "Presidential Document",
            "Uncategorized Document",
          ],
          assert: { notEmpty: true },
        },
        {
          key: "latest_document_date",
          label: "Latest Document Date",
          presenter: "metric",
          kind: "api",
          type: "date",
          jsonPath: "$.results[0].publication_date",
          // No expectMonotonic: a document can be indexed out of strict date
          // order (revisions, corrections) — see this target's own notes
          // above on count possibly revising down.
          assert: { notEmpty: true, maxFutureDays: 1, notBefore: "2015-01-01" },
        },
        {
          key: "latest_document_agency",
          label: "Latest Document Agency",
          presenter: "markdown",
          kind: "api",
          type: "string",
          // Only meaningful here — fr-nrc-smr/fr-doe-nuclear already filter
          // to one agency, so this would be a constant there. Eight distinct
          // agency lists observed live across this query's own 76 results;
          // string, not enum, since that set can grow. `[-1:]`, not `[0]`:
          // FR lists a sub-agency's document as [parent department,
          // sub-agency] (verified live 2026-09-17 — e.g. [Transportation
          // Department, Maritime Administration], [Commerce Department,
          // International Trade Administration]), so `[0]` named the parent
          // department instead of the publishing agency. The slice always
          // yields exactly one match, so it can't go SELECTOR_AMBIGUOUS.
          jsonPath: "$.results[0].agencies[-1:].name",
          assert: { notEmpty: true, maxLength: 120 },
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
        "ceiling. M4b: `per_page=1` is not honoured by FR's API (verified live 2026-09-16 — same " +
        "finding as fr-smr-mentions), but `order=newest` still puts the newest document at " +
        "`results[0]`.",
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
        {
          key: "latest_document_title",
          label: "Latest Document",
          presenter: "markdown",
          kind: "api",
          type: "markdown",
          fields: {
            title: { jsonPath: "$.results[0].title" },
            url: { jsonPath: "$.results[0].html_url", escape: "none" },
          },
          template: "[{title}]({url})",
          assert: { notEmpty: true, maxLength: 1000 },
        },
        {
          key: "latest_document_type",
          label: "Latest Document Type",
          presenter: "status",
          kind: "api",
          type: "enum",
          jsonPath: "$.results[0].type",
          // Same vocabulary as fr-smr-mentions — verified live 2026-09-16
          // against this target's own query too (Rule/Proposed Rule/Notice
          // all present; Presidential Document/Uncategorized Document not
          // observed here but mapped ahead of need, same reasoning as
          // SEC_8K_ITEMS above).
          enumValues: [
            "Rule",
            "Proposed Rule",
            "Notice",
            "Presidential Document",
            "Uncategorized Document",
          ],
          assert: { notEmpty: true },
        },
        {
          key: "latest_document_date",
          label: "Latest Document Date",
          presenter: "metric",
          kind: "api",
          type: "date",
          jsonPath: "$.results[0].publication_date",
          assert: { notEmpty: true, maxFutureDays: 1, notBefore: "2015-01-01" },
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
        "0-1 document/week; maxChangeAbs 10 is ~10x that observed ceiling. M4b: `per_page=1` is not " +
        "honoured by FR's API (verified live 2026-09-16 — same finding as fr-smr-mentions), but " +
        "`order=newest` still puts the newest document at `results[0]`. This query's own live " +
        '51-document result set is where the rare "Uncategorized Document" type value was ' +
        "observed (2026-09-16) — see latest_document_type below.",
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
        {
          key: "latest_document_title",
          label: "Latest Document",
          presenter: "markdown",
          kind: "api",
          type: "markdown",
          fields: {
            title: { jsonPath: "$.results[0].title" },
            url: { jsonPath: "$.results[0].html_url", escape: "none" },
          },
          template: "[{title}]({url})",
          assert: { notEmpty: true, maxLength: 1000 },
        },
        {
          key: "latest_document_type",
          label: "Latest Document Type",
          presenter: "status",
          kind: "api",
          type: "enum",
          jsonPath: "$.results[0].type",
          enumValues: [
            "Rule",
            "Proposed Rule",
            "Notice",
            "Presidential Document",
            "Uncategorized Document",
          ],
          assert: { notEmpty: true },
        },
        {
          key: "latest_document_date",
          label: "Latest Document Date",
          presenter: "metric",
          kind: "api",
          type: "date",
          jsonPath: "$.results[0].publication_date",
          assert: { notEmpty: true, maxFutureDays: 1, notBefore: "2015-01-01" },
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

    // M5a — the roadmap's original filter (NAICS 221113 + California
    // place-of-performance, via api.sam.gov) returns zero contracts since
    // 2007 and api.sam.gov cannot be verified without a registered,
    // rate-limited key (verified live 2026-09-17). Substituted:
    // USAspending's own spending_by_award search (same underlying FPDS
    // award data, keyless, sortable), filtered nationwide on keywords
    // rather than NAICS+state — 43 real contracts at triage, newest
    // 2026-08-27. First method: "POST" target (ADR-024) — a plain GET on
    // this endpoint 405s, hence viewUrl for the dashboard link.
    {
      id: "usaspending-advanced-reactor-awards",
      label: "USAspending — Advanced Reactor Contract Awards",
      entityId: "bluecore-energy",
      sectionId: "market",
      kind: "api",
      method: "POST",
      url: "https://api.usaspending.gov/api/v2/search/spending_by_award/",
      headers: { "content-type": "application/json" },
      body: '{"filters":{"award_type_codes":["A","B","C","D"],"keywords":["small modular reactor","microreactor","advanced reactor"]},"fields":["Award ID","Recipient Name","Award Amount","Awarding Agency","Description","generated_internal_id","Base Obligation Date"],"sort":"Base Obligation Date","order":"desc","limit":1,"page":1}',
      // Verified live 2026-09-17: resolves to a real, human-readable
      // multi-keyword results page (200), same host as the award-record
      // links latest_award composes.
      viewUrl: "https://www.usaspending.gov/keyword_search/advanced%20reactor",
      schedule: { cron: "0 17 * * *", ttlHours: 168 },
      notes:
        "Verified live 2026-09-17: this exact request body returns 43 contracts (newest 2026-08-27, " +
        "NRC -> DEF-LOGIX INC, $249,978, cybersecurity-of-advanced-reactors work). No time_period " +
        "filter — omitting it returns the same result as an explicit range, so there's no hardcoded " +
        "end date to go stale. api.usaspending.gov/robots.txt 404s (unrestricted, same convention as " +
        "data.sec.gov). No auth — this endpoint is keyless. maxLength on latest_award (3000) is sized " +
        "from the live 43-contract set's longest composed value (2564 chars, post-escape) plus " +
        "headroom, not a guess — federal contract Description fields run far longer than the " +
        "SEC/FR composites elsewhere in this config. No maxChangePct on latest_award_amount: each " +
        "value is a different award's dollar amount, not a step in one continuous series, so a " +
        "percent-change guard would compare unrelated numbers and fire constantly. No " +
        "expectMonotonic on latest_award_date: a contract can be indexed after its own obligation " +
        "date, out of strict order, same reasoning as the fr-* targets' publication-date extractors. " +
        "notBefore is USAspending's own documented earliest-searchable date (2007-10-01).",
      extractors: [
        {
          key: "latest_award",
          label: "Latest Award",
          presenter: "markdown",
          kind: "api",
          type: "markdown",
          // No `index` — row 0 is always "the latest" given the
          // sort/order in the request body itself, unlike SEC's
          // filings.recent which is newest-first with no filter applied.
          fields: {
            recipient: { jsonPath: "$.results[0]['Recipient Name']" },
            desc: { jsonPath: "$.results[0].Description" },
            // escape: "none" — generated_internal_id is a path-safe token
            // ("CONT_AWD_..."), not free text that needs markdown escaping.
            id: { jsonPath: "$.results[0].generated_internal_id", escape: "none" },
          },
          template:
            "**{recipient}** — {desc} — [award record](https://www.usaspending.gov/award/{id})",
          assert: { notEmpty: true, maxLength: 3000 },
        },
        {
          key: "latest_award_amount",
          label: "Latest Award Amount",
          presenter: "metric",
          kind: "api",
          type: "number",
          unit: "USD",
          jsonPath: "$.results[0]['Award Amount']",
          assert: { min: 0, notEmpty: true },
        },
        {
          key: "latest_award_agency",
          label: "Latest Award Agency",
          presenter: "markdown",
          kind: "api",
          type: "string",
          // Not enum — NRC, DOE, DoD, and others all appear across the
          // 43-contract set (7 distinct agencies observed live).
          jsonPath: "$.results[0]['Awarding Agency']",
          assert: { notEmpty: true, maxLength: 120 },
        },
        {
          key: "latest_award_date",
          label: "Latest Award Date",
          presenter: "metric",
          kind: "api",
          type: "date",
          jsonPath: "$.results[0]['Base Obligation Date']",
          assert: { notEmpty: true, maxFutureDays: 1, notBefore: "2007-10-01" },
          alert: { on: "any-change" },
        },
      ],
    },
  ],

  alerting: { channel: "github-issue", minSeverity: "warn" },
};
