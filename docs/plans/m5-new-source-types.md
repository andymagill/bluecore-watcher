# M5 — Source quality: new source types — plan

Implements the milestone in `07-ROADMAP.md` M5: add sources exposing regulatory and procurement
content the public web dashboard currently has none of. Exit test: **all four dashboard sections
display ≥1 source extracting substantive, non-numeric content, and the maritime-regulatory gap is
closed.**

## How to use this doc

Only the workstream marked **Next** below gets implemented in a given conversation — the other is
design only, for a future conversation to pick up cold. Each workstream:

1. Confirms its own prerequisites checklist below.
2. Branches off `main` (`origin/main`, not a stale local branch).
3. Commits per verified phase, not once at the end.
4. Runs the standard verification (format/lint/typecheck/schema/validate-config/test) plus
   `npm run fixture:verify -- --env bluecore`.
5. Updates the status table below and the M5 section of `07-ROADMAP.md` on completion.

## Status

| Workstream                                               | Status    | PR  |
| -------------------------------------------------------- | --------- | --- |
| M5a — `viewUrl` (ADR-024) + USAspending contracts target | Delivered | #30 |
| M5b — Maritime FR target, M5 close-out                   | Next      | —   |

## Context / findings (all of M5, live-verified 2026-09-17)

**Contracts (roadmap named "SAM.gov FPDS contract awards")**

- **The roadmap's own filter is empty.** `api.usaspending.gov` (FPDS-derived award data, same
  underlying system SAM.gov's contract-awards search reads from) `spending_by_award_count` for
  NAICS `221113` ("Nuclear Electric Power Generation") with place-of-performance California
  returned **zero** contracts since FY2007-10-01 (the earliest date USAspending's search supports
  without a bulk download). Recipient-location CA is also zero. Nationwide, `221113` alone returns
  48 contracts + 2 IDVs, with real miscoding noise in that set (e.g. a Department of Justice
  "EXPERT WITNESS SERVICES" award, NAICS-tagged but unrelated). A target built on this filter as
  written would fail `SELECTOR_NO_MATCH` on day one and stay that way.
- **`api.sam.gov` cannot be verified without a registered key.** Every route tried — the
  documented `/contract-awards/v1/search`, `/opportunities/v2/search`,
  `/entity-information/v3/entities`, and the bare host root — returns an Envoy `404` with an empty
  body when unkeyed, indistinguishable from a wrong path. Per SAM.gov's own API docs, a personal
  key with no assigned role gets **10 requests/day**, and no sort parameter is documented for the
  contract-awards search, so "most recent award" has no stable ordering to extract even once a key
  exists.
- **USAspending's award search works keyless and is sortable.** `POST
https://api.usaspending.gov/api/v2/search/spending_by_award/` with body
  `{"filters":{"award_type_codes":["A","B","C","D"],"keywords":["small modular reactor","microreactor","advanced reactor"]},"fields":[...],"sort":"Base Obligation Date","order":"desc","limit":1,"page":1}`
  (verified live):
  - Returns **43 contracts** total across this keyword set, ~6 in the trailing 12 months. Newest
    at triage: 2026-08-27, NRC → DEF-LOGIX INC, $249,978, "CYBERSECURITY OF NOVEL TECHNOLOGY
    IMPLEMENTATIONS IN OPERATING AND NEW ADVANCED REACTORS …".
  - Row fields confirmed present: `Award ID`, `Recipient Name`, `Award Amount` (number),
    `Awarding Agency`, `Description`, `generated_internal_id`, `Base Obligation Date`
    (`YYYY-MM-DD`).
  - Omitting `time_period` entirely returns the same result as an explicit range — no hardcoded
    end date that would need bumping to avoid going stale.
  - `https://www.usaspending.gov/award/{generated_internal_id}` resolves 200 for the awards
    checked — a real, human-readable award record page.
  - Bracket-syntax JSONPath (`$.results[0]['Recipient Name']`) resolves correctly under
    jsonpath-plus against field names containing spaces — checked live against a captured
    response.
  - The CA-restricted version of the same keywords returns only 7 contracts (newest 2024-08-26,
    nearly two years stale at triage) and includes false positives (NASA ozone-sensor R&D that
    happens to contain "microfabricated" — not "microreactor" — matched loosely). Rejected as the
    filter: too sparse and too noisy for the value it would add over the nationwide set.
  - `robots.txt`: `api.usaspending.gov/robots.txt` → 404 (unrestricted — same convention already
    relied on for `data.sec.gov`). `www.usaspending.gov/robots.txt` disallows only `/*.php*` and
    `/*?*`, neither of which the award-record link path matches.
- **This is the first `method: "POST"` target.** `HttpFetcher`
  (`src/ingest/fetch/http-fetcher.ts`) already sends `target.method`/`headers`/`body` — with
  `${ENV}` interpolation applied to the body — through every path that matters
  (`fixture-capture`, `drift-check`, `ingest --live`), but no real target has ever exercised it.
  Same class of "first real use" as EIA's `auth`/`secretEnv` at M2a. The JSON body must avoid any
  literal `${` sequence, since `interpolateEnv` would try to resolve it as a secret reference.
- **Provenance-link gap, the one real engine finding.** `provenance.sourceUrl` and
  `TargetFile.sourceUrl` are always set to `target.url`
  (`src/ingest/process-extractor.ts:292,322`, `src/ingest/orchestrate.ts:164`), and the dashboard
  renders that value as a clickable link in both `TargetCard.tsx` and `ProvenancePopover.tsx`. A
  plain `GET` on USAspending's search endpoint returns **405 Method Not Allowed** — the link as
  currently derived would be dead on the dashboard.
- **No new handler kind needed.** The response is ordinary JSON, extractable with the existing
  `api` kind and ADR-022's composite/indexed locations exactly as SEC's `filings.recent` already
  is.

**Maritime (roadmap named "MARAD / Coast Guard maritime regulatory")**

- **Federal Register covers it, keyless, identical API/shape to the existing `fr-*` targets.**
  `conditions[agencies][]=coast-guard&conditions[agencies][]=maritime-administration&conditions[term]=reactor&order=newest`
  returned **15 documents** live. Newest: **2026-05-07, Notice, agency Maritime Administration —
  "Request for Information: Development of a Commercially Viable System-Centric Small Modular
  Reactor Concept for Deployment…"** — directly on point for BlueCore's floating-power-plant
  concept. The rest of the 15 are NS Savannah decommissioning notices and nuclear-power-plant
  Coast Guard security zones (Pilgrim, Maine Yankee) — genuine maritime/nuclear regulatory
  content, not noise.
  - `term=nuclear` on Coast Guard alone returns 185 documents, dominated by unrelated marine
    security zones (Tampa Bay events, MacDill AFB) — too noisy to be a useful "latest document"
    signal.
  - Quoted `term="small modular reactor"` returns only 1 document — too narrow to ever change
    again.
  - `reactor` is the right middle filter: broad enough to have moved as recently as May 2026,
    narrow enough that every result is genuinely on-topic.
  - `type` values observed (`Notice`, `Proposed Rule`, `Rule`) are within M4b's existing
    five-value enum — no schema change needed there.
- **regulations.gov v4 also covers this ground** (confirmed the same MARAD RFI under docket
  `MARAD-2026-0729`, plus USCG dockets like the Pilgrim security-zone rulemaking) but needs its
  own `api.data.gov` key — the shared `DEMO_KEY` used for triage is capped at 10 requests/hour and
  was exhausted mid-triage. It surfaces no signal beyond what Federal Register already gives, so
  it isn't worth a second registered secret and a second target shape. Rejected in favor of
  reusing the FR extractor pattern verbatim.
- **Federal Register API instability observed, not blocking.** Several queries during triage
  (including production `fr-nrc-smr`'s exact live URL) intermittently returned
  `500 {"status":500,"message":"Internal Server Error"}` while other queries against the same API
  succeeded seconds apart, with no discernible query-shape pattern. Flagged for M5b to check
  whether `isRetryable` (`src/ingest/fetch/http-fetcher.ts`) already retries a bare 5xx — if not,
  this is worth a small follow-up, but it isn't new to M5 and doesn't block this design.
- **Gap noted, explicitly out of scope:** USCG guidance that never reaches the Federal Register
  (NVICs, CG-ENG/MSC policy letters, docket attachments) isn't covered by this target. If Federal
  Register coverage proves insufficient once the target is live, that's a fresh `static-html`
  triage for a future milestone, not assumed here.
- **No new handler kind needed** — same `api` kind, same simple-`jsonPath` shape M4b already
  proved for `fr-*` targets (`results[0]` resolves directly, no composite needed).

## Decisions

| Topic                                 | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Workstream      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Contracts source                      | **USAspending's `spending_by_award` search, nationwide keyword filter** (`small modular reactor` / `microreactor` / `advanced reactor`), not `api.sam.gov` and not the roadmap's NAICS `221113` + California filter. The latter returns zero results; the former needs a registered, rate-limited key this project doesn't have yet and has no documented sort. Same underlying FPDS award data either way.                                                                                                                           | M5a             |
| POST provenance link                  | **New engine field, ADR-024**: an optional `viewUrl` on a target — a human-browsable page shown as the dashboard link — required when `method: "POST"` (new schema rule 14). `provenance.sourceUrl`/`TargetFile.sourceUrl` keep meaning exactly what they mean today (the real fetched endpoint); the link the dashboard renders is `viewUrl ?? sourceUrl`. Rejected: leaving the dashboard link 405ing, which is worse than `eia-ca-industrial-price`'s existing "link 403s without the key" precedent — that one at least resolves. | M5a             |
| Maritime source                       | Federal Register, `agencies[]=coast-guard&agencies[]=maritime-administration&term=reactor`. Rejected regulations.gov v4 despite equal or better coverage — it needs its own key and adds a second secret/target shape for no additional signal.                                                                                                                                                                                                                                                                                       | M5b             |
| New handler kind                      | **None.** Both new targets are `kind: "api"`; the ADR-010 registry (`html`/`api`) is untouched, confirming the roadmap's own framing that this was a triage finding, not an assumption.                                                                                                                                                                                                                                                                                                                                               | — (roadmap doc) |
| Workstream split                      | Engine first, same discipline as M4a → M4b: **M5a** ships the `viewUrl`/rule-14 capability and proves it against the one target that needs it (the first POST target) before anything else depends on it; **M5b** is straightforward config + docs using an already-proven FR shape, split out because it's close-out work, not new engine surface.                                                                                                                                                                                   | —               |
| `example-maritime-regulatory` fixture | **Dropped from the roadmap's testing-approach line.** The maritime target's shape is identical to the already-tested `fr-*` simple-`jsonPath` shape — `example-regulatory-api` (M4b) already covers it generically. A second, structurally-identical fixture would test nothing new.                                                                                                                                                                                                                                                  | M5b             |

---

## M5a — `viewUrl` (ADR-024) + `usaspending-advanced-reactor-awards` (Market Conditions)

**Prerequisites:** none beyond `main` — this is the milestone's first workstream.

### Engine change (ADR-024)

- `src/config/schema.ts`: add `viewUrl: z.url().optional()` to the target object. New validation
  rule 14: if `method === "POST"`, `viewUrl` must be set (a POST endpoint is never itself a
  dashboard-clickable link; a GET target may still set `viewUrl` if its `url` isn't the nicest
  page to send a reader to, but that's optional).
- `src/contract/target-file.ts`: add optional `viewUrl`, threaded through
  `src/ingest/orchestrate.ts`/`src/ingest/persist.ts` alongside the existing `sourceUrl`. Purely
  additive to the JSON contract — regenerate the JSON Schema so the schema-freshness test stays
  green.
- `src/app/components/TargetCard.tsx` and `ProvenancePopover.tsx`: link `href={targetFile.viewUrl ?? targetFile.sourceUrl}`.
  Confirm at implementation time how `ProvenancePopover` reaches target-level fields (it currently
  renders `provenance.sourceUrl`, which is block-level, not target-level) — worth checking whether
  the popover should keep showing the literal fetched `sourceUrl` as text (for provenance honesty)
  while only the target header link swaps to `viewUrl`.
- Docs: new `ADR-024` in `00-DECISIONS.md` (mirror the ADR-022 write-up structure: Decision /
  Rationale / Consequences); `02-CONFIG-SCHEMA.md` gets the field and rule 14; `01-DATA-CONTRACT.md`
  gets a one-line note on `TargetFile.viewUrl`.

### Target: `usaspending-advanced-reactor-awards`

- `kind: "api"`, `method: "POST"`,
  `url: "https://api.usaspending.gov/api/v2/search/spending_by_award/"`,
  `headers: { "content-type": "application/json" }`.
- `body`: the JSON verified above — `award_type_codes: ["A","B","C","D"]`,
  `keywords: ["small modular reactor", "microreactor", "advanced reactor"]`, `sort: "Base Obligation Date"`,
  `order: "desc"`, `limit: 1`, `page: 1`. No `time_period` (confirmed live it isn't required and
  omitting it doesn't change the result, so there's no hardcoded end date to go stale).
- `viewUrl: "https://www.usaspending.gov/keyword_search/advanced%20reactor"` — confirm at
  implementation time that this renders a sensible results page in a browser (checked live only
  that the base search/keyword-search paths 200; the exact query-string form for a multi-keyword
  view wasn't separately confirmed).
- `entityId: "bluecore-energy"`, `sectionId: "market"`. Schedule mirrors the `fr-*` targets
  (daily cron, `ttlHours: 168`) — re-derive against rule 5 (`ttlHours` vs. cron interval) at
  implementation time rather than copy blind.
- Politeness: `GENERAL_UA`, no auth.

### Extractors

- `latest_award` — composite, no `index` (row 0 is always "the latest" given the `sort`/`order`
  in the request body itself, unlike SEC's `filings.recent` which is newest-first by API default
  with no filter). Fields: `recipient` (`$.results[0]['Recipient Name']`), `desc`
  (`$.results[0].Description`), `id` (`$.results[0].generated_internal_id`, `escape: "none"` — it's
  a path-safe token, not free text). Template:
  `**{recipient}** — {desc} — [award record](https://www.usaspending.gov/award/{id})`. Assert
  `notEmpty`, `maxLength` sized from live description lengths (check the longest description across
  the 43-contract set before finalizing, same discipline as M4b's FR `maxLength` correction).
- `latest_award_amount` — `metric`, `type: "number"`, `unit: "USD"`,
  `jsonPath: "$.results[0]['Award Amount']"`, `assert: { min: 0, notEmpty: true }`. **No
  `maxChangePct`** — unlike EIA's price series, each value here is a different award's dollar
  amount, not a step in one continuous series; a `maxChangePct` guard would be comparing unrelated
  numbers and firing constantly.
- `latest_award_agency` — `type: "string"` (not `enum` — awarding agencies vary; NRC, DOE, DoD,
  and others all appear across the 43-contract set), `jsonPath: "$.results[0]['Awarding Agency']"`.
- `latest_award_date` — `presenter: "metric"`, `type: "date"`,
  `jsonPath: "$.results[0]['Base Obligation Date']"`,
  `assert: { notEmpty: true, maxFutureDays: 1, notBefore: "2007-10-01" }` (USAspending's own
  documented earliest-searchable date). **No `expectMonotonic`** — a contract can be indexed into
  USAspending after its obligation date, out of strict order, same reasoning as the FR targets'
  publication-date extractors.
- Alert: `any-change` on `latest_award_date`, mirroring the M4b convention of "one sibling field
  alerts, the composite doesn't duplicate it."

### Testing

- `fixtures/example-contracts-api/response.json` — a synthetic, entity-agnostic
  `spending_by_award`-shaped envelope (bracket-keyed field names included, to regression-guard the
  JSONPath bracket-syntax behavior confirmed live). Exercised in a vitest suite in the
  `composite-config-shapes.test.ts` style — no "SAM.gov"/"nuclear"/"BlueCore" in test code
  (ADR-001/ADR-021).
- New schema tests for rule 14 (`method: "POST"` without `viewUrl` rejected; with `viewUrl`
  accepted; a GET target's `viewUrl` remains optional).
- Real fixture via `npm run fixture:capture` + `npm run fixture:bless` against the live
  USAspending endpoint.
- `npm run fixture:verify -- --env bluecore` → 11 targets (10 existing + this one, or 10 if M4c
  has landed first — see M5b close-out), all existing goldens unchanged.
- Optional: exercise the ADR-023 preview workflow (`workflow_dispatch --ref <branch>`) once, to
  prove the first real POST target against a live Cloudflare preview before merging — the same
  proof M2a's EIA auth target got informally, made systematic by ADR-023 since M4.

**Prerequisites for M5b:** this workstream merged to `main` — M5b assumes `viewUrl`/rule 14 exist,
though the maritime target itself is a plain GET and won't need to set `viewUrl` unless its
`url` is judged not dashboard-friendly as-is.

---

## M5b — Maritime FR target, M5 close-out

**Not started.**

### Target: `fr-maritime-reactor` (Regulatory & Policy)

- `kind: "api"`,
  `url: "https://www.federalregister.gov/api/v1/documents.json?conditions%5Bagencies%5D%5B%5D=coast-guard&conditions%5Bagencies%5D%5B%5D=maritime-administration&conditions%5Bterm%5D=reactor&order=newest"`.
  Same simple-`jsonPath` shape as `fr-nrc-smr`/`fr-doe-nuclear`/`fr-smr-mentions` — no composite
  needed, `results[0]` is directly the newest matching document.
- Extractors, copying M4b's FR pattern verbatim:
  - `document_count` — `$.count`, same as the three existing FR targets.
  - `latest_document_title` — composite link (`[title](html_url)`), same two-field shape as
    `fr-smr-mentions`.
  - `latest_document_type` — `enum`, the same five-value vocabulary M4b already established
    (`Rule`/`Proposed Rule`/`Notice`/`Presidential Document`/`Uncategorized Document`) — all three
    types observed live for this query (`Notice`, `Proposed Rule`, `Rule`) are already in that set.
  - `latest_document_date` — same shape/assertions as the existing FR targets.
  - `latest_document_agency` — **include this one** (unlike `fr-nrc-smr`/`fr-doe-nuclear`, which
    skip it because they filter to one agency): this query spans two agencies
    (Coast Guard, Maritime Administration), so which one published the latest document is itself
    signal, same reasoning that already justified including it on `fr-smr-mentions`.
- Notes field should record the `reactor` vs. `nuclear` filter-width tradeoff from triage above,
  so a future maintainer doesn't "fix" it back to a noisier or emptier term.
- Check whether `isRetryable` already covers a bare FR 5xx (flagged in Context above); if not,
  decide whether to add it here or split it out — small either way.

### Testing

- Reuses `example-regulatory-api` (M4b) — no new fixture. Add whatever assertion cases are
  missing for the two-agency `latest_document_agency` string case if the existing fixture doesn't
  already cover it generically.
- `npm run fixture:capture` + `fixture:bless` for the real target.
- `npm run fixture:verify -- --env bluecore` → all real targets passing, this one new.

### M5 close-out

1. `05-SOURCES.md`: add both targets' rows (Market Conditions, Regulatory & Policy), update §4's
   summary counts (json-api count, first POST target flagged), update the doc's header status
   line.
2. `07-ROADMAP.md` M5 section: flip both bullets to ✅, update the "Impact on source inventory"
   line, mark the milestone's exit criterion met (verify: every section has ≥1 non-numeric
   source — Company via `bluecore-newsroom`/M4b's SEC upgrades, Competitive via M4b's `latest_8k`,
   Regulatory via this workstream, Market via M5a).
3. This doc's status table.
4. Note the interaction with M4c (`bluecore-form-d` retirement, not started as of this writing):
   the final target count in `05-SOURCES.md` depends on whether M4c has landed — call out whichever
   is true at the time M5b actually ships rather than hardcoding a number here.

**Verification (M5b specifically, beyond the standard set):**
`npm run fixture:verify -- --env bluecore` reports the new target passing with zero drift on every
existing one; `npm run validate:config -- --env bluecore` passes; a fresh `npm run ingest -- --dry`
run shows a populated `latest_award`/`latest_document_title` block for both new targets, not just
counts.
