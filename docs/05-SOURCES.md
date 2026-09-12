# 05 — Source Inventory

**Status: Q1 resolved, populated 2026-09-12.** Bluecore Energy is a real target, literally — see §6 item 2. Seven sources triaged across all four sections; the table below is real, not illustrative.

This document is the real specification. `SPEC.md` describes a machine; this describes its fuel.

---

## 1. Why this comes before code

Two things here can invalidate architectural decisions already made:

**PDF share.** If more than roughly 30% of sources are PDFs, "Cheerio primary, Playwright fallback" is the wrong stack constraint, and the `pdf` kind — currently a sketch in `02-CONFIG-SCHEMA.md` §7 — becomes a first-class design problem rather than a deferred one. Scanned PDFs needing OCR raise a sharper question: OCR has an error rate, which sits awkwardly next to a determinism guarantee. That may need to be a labelled, lower-confidence class of block rather than a normal one.

**Session-state applications.** Government dockets frequently live in older frameworks with server-side session state, postback pagination, and no addressable URLs per record. These are not "use Playwright" problems — they are "the deep link you want does not exist" problems, and they change what is extractable at all.

Finding either out during implementation costs a rewrite. Finding out during triage costs an afternoon.

---

## 2. Triage columns

| Column         | Values                                                                 | Why it matters                                  |
| -------------- | ---------------------------------------------------------------------- | ----------------------------------------------- |
| `id`           | slug                                                                   | Becomes `targetId` and the data filename        |
| Section        | target / segment / regulatory / climate                                | Grid placement                                  |
| URL            | absolute                                                               | The source                                      |
| Type           | static-html / js-rendered / json-api / pdf / pdf-scanned / session-app | Drives `kind` and `renderer`                    |
| Volatility     | realtime / daily / weekly / monthly / quarterly / episodic             | Drives `cron` and `ttlHours`                    |
| Auth           | none / key / login                                                     | Login sources need a separate risk conversation |
| Robots         | allow / disallow / unclear                                             | Q6 input                                        |
| Anchor quality | stable-id / class / positional / text-only                             | Predicts breakage rate                          |
| Facts          | count                                                                  | Extractors on this target                       |
| Feasibility    | easy / moderate / hard / blocked                                       | Build order                                     |
| Notes          | prose                                                                  | The fragile parts                               |

**Anchor quality** is the maintenance predictor. A source with stable `id` attributes may never break. A table matched by `nth-child` will break the first time a row is inserted. Triaging this up front tells you where the weekly cost will land, and lets you drop a source that is more trouble than the fact is worth.

---

## 3. Inventory

Entity `bluecore-energy` (role: primary) is BlueCore Energy, Inc. — SEC CIK [0002125928](https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0002125928), DE-incorporated, HQ at Berth 48, Port of Long Beach, CA. Building a ~10 MWe floating water-cooled SMR for maritime/port power; emerged from stealth July 2026; $50M seed closed September 2026 (Silverton Partners). Entity `oklo-inc` (role: competitor) is Oklo Inc. (NYSE: OKLO, CIK 0001849056) — the closest publicly-traded advanced-fission peer, used as the Industry Segment "competitor activity" source.

### Section: Target Company State

| id                  | URL                                                                                                      | Type                  | Volatility                                               | Auth | Robots                                                 | Anchor                                                                                                  | Facts | Feasibility | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------- | ---- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bluecore-form-d`   | [sec.gov Form D XML](https://www.sec.gov/Archives/edgar/data/2125928/000212592826000003/primary_doc.xml) | static-html (XML doc) | episodic (2 filings in 5 months: 2026-04-06, 2026-09-04) | none | allow (`/Archives/edgar/data` explicitly Allow-listed) | stable-id (SEC's Form D XML schema fixes tag names — as durable as a real `id`)                         | 2     | easy        | Official Form D, not press coverage. `totalOfferingAmount`/`totalAmountSold` are ground truth for "financial milestones," and disagree with the $50M headline (offering $21.81M, sold $19.4M as of this filing) — exactly the kind of fact a deal-team reader wants over press. Filer's own business address lists city "Long Beach" but state "FL" (likely a filer typo, state should be CA) — cosmetic, not our bug to fix.                                                                                                                 |
| `bluecore-newsroom` | [bluecore.energy/news-insights](https://www.bluecore.energy/news-insights)                               | static-html           | weekly (9 posts/press mentions Aug 10 – Sep 11)          | none | allow (no robots.txt restrictions at all)              | class (hand-authored `bc-n-*` classes; Webflow UUID `id`s nearby are unstable — do not anchor on those) | 3     | easy        | Use `:first`, **not** `:first-child` — each card sits in its own individual Webflow collection-list wrapper (`div.w-dyn-item`), so every card is trivially the first child of its own parent and `:first-child` matched all 12 (caught live, via the dry run). Also avoid the `.bc-n-feat-*` hero block — it's manually pinned to the July stealth-launch post and does not advance. `.bc-n-cat-key` is a genuine small enum (`Press Release`, `In the News`, `Insights` — confirmed via the filter pills) suitable for a `status` extractor. |
| `bluecore-careers`  | [api.lever.co/v0/postings/bluecore-energy](https://api.lever.co/v0/postings/bluecore-energy?mode=json)   | json-api              | weekly (9 postings created Aug 10 – Sep 10, ~2/wk)       | none | allow (`Allow: /`, `Crawl-delay: 1`)                   | stable-id (documented public API)                                                                       | 1     | easy        | Open-roles count as a real-time headcount-growth proxy. `jsonPath: "$.length"` — jsonpath-plus's array-length pseudo-property, verified against the live payload (returns `[9]`, single match). Respect `Crawl-delay: 1` via `politeness.minIntervalMs`.                                                                                                                                                                                                                                                                                      |

### Section: Industry Segment

| id                        | URL                                                                                                                                                             | Type     | Volatility                                                                                   | Auth | Robots                                                                                                                                                                          | Anchor                                            | Facts | Feasibility | Notes                                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oklo-sec-filings`        | [data.sec.gov/submissions/CIK0001849056.json](https://data.sec.gov/submissions/CIK0001849056.json)                                                              | json-api | realtime/daily (multiple Form 4/144/8-K filings per week, several in the days before triage) | none | allow (no robots.txt at `data.sec.gov` → 404 → unrestricted; still honor SEC's Fair Access policy: declared UA with contact info, ≤10 req/sec — a daily cron is far under this) | stable-id (documented, versioned JSON field path) | 2     | easy        | **Competitor activity**, literally per `SPEC.md` §3's own definition of this section. Oklo (NYSE: OKLO) is the closest publicly-traded peer at a comparable "advanced reactor, pre-revenue-but-scaling" stage. NuScale (CIK 0001822966) is an equally-viable second competitor, deferred to M2 breadth.                                             |
| `fr-segment-smr-mentions` | [federalregister.gov API, term="small modular reactor"](https://www.federalregister.gov/api/v1/documents.json?conditions%5Bterm%5D=%22small+modular+reactor%22) | json-api | weekly                                                                                       | none | allow (API path not in `/robots.txt` disallow list; only `/documents/search` etc. are blocked)                                                                                  | stable-id (documented `count` field)              | 1     | easy        | Sector-wide document volume as a "sector capacity metrics" proxy, distinct from the NRC-specific regulatory count below (76 vs. 55 documents at triage time — the ~21 document gap is exactly the non-NRC agencies, e.g. DOE, discussing SMRs). No `expectMonotonic` — FR's index can in principle be revised down, so this isn't a hard invariant. |

### Section: Regulatory Landscape

| id                      | URL                                                                                                                                                                                                                                                                 | Type     | Volatility | Auth | Robots | Anchor    | Facts | Feasibility | Notes                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- | ---- | ------ | --------- | ----- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fr-regulatory-nrc-smr` | [federalregister.gov API, agency=nuclear-regulatory-commission + term="small modular reactor"](https://www.federalregister.gov/api/v1/documents.json?conditions%5Bagencies%5D%5B%5D=nuclear-regulatory-commission&conditions%5Bterm%5D=%22small+modular+reactor%22) | json-api | weekly     | none | allow  | stable-id | 1     | easy        | NRC-specific regulatory-attention proxy for the SMR class Bluecore competes in. Bluecore itself has **no NRC docket yet** — the Long Beach barge holds no fuel and is pre-certification (confirmed via news coverage) — so this is a segment-level regulatory signal, not a Bluecore-specific docket. Revisit once/if a Bluecore-specific NRC docket opens. |

### Section: Market Climate

| id                       | URL                                                                                                                                                                                                                               | Type     | Volatility     | Auth | Robots | Anchor    | Facts | Feasibility | Notes                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------- | ---- | ------ | --------- | ----- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fr-climate-doe-nuclear` | [federalregister.gov API, agency=energy-department + term="advanced nuclear"](https://www.federalregister.gov/api/v1/documents.json?conditions%5Bagencies%5D%5B%5D=energy-department&conditions%5Bterm%5D=%22advanced+nuclear%22) | json-api | weekly/monthly | none | allow  | stable-id | 1     | easy        | DOE policy-attention document count — "policy incentives" per `SPEC.md` §3's Market Climate definition. EIA's regional price-index APIs (the shape the synthetic `example.config.ts` target mimics) require a free `api_key` (confirmed: `api.eia.gov` 403s without one) — deferred to M2 rather than adding a secret for this pass. |

---

## 4. Summary

| Metric             | Count                                      | Decision it drives                                                                                                                          |
| ------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Total sources      | 7                                          | Well under any scale ceiling; maintenance cost is low                                                                                       |
| static-html        | 2 (`bluecore-form-d`, `bluecore-newsroom`) | Baseline — both server-rendered, no Playwright needed                                                                                       |
| js-rendered        | 0                                          | No `renderer: "browser"` targets needed for this set                                                                                        |
| json-api           | 5                                          | Cheapest and most durable — the strong majority, as hoped                                                                                   |
| pdf / pdf-scanned  | 0 (0%)                                     | **Well under 30%** — "Cheerio primary, Playwright fallback" stands; no PDF handler needed for this set (see §5 flag below on Form D format) |
| session-app        | 0                                          | None found; no infeasible sources                                                                                                           |
| Requiring auth     | 0                                          | No secrets needed for this initial real config (EIA's key-gated API deferred to M2)                                                         |
| robots: disallow   | 0                                          | Q6 — no blocked sources in this set; nothing to resolve                                                                                     |
| Positional anchors | 0                                          | No `nth-child`-style anchors used; predicted weekly breakage from this set is near zero                                                     |

**PDF flag (per task instructions, not built here):** none of the 7 triaged sources are PDFs — the SEC Form D is XML, not PDF, and cheerio parses it correctly as a lenient HTML-ish document (verified: tag-name selectors like `totalOfferingAmount` resolve as expected). If a future source turns out to need a `pdf` kind, that's new-handler work per ADR-010/`02-CONFIG-SCHEMA.md` §7 and should be flagged before building, not assumed in scope.

---

## 5. Method

Per candidate source, fifteen minutes:

1. `curl` it. Does the fact appear in the raw HTML? If yes, it's `static-html` and easy.
2. If not, open devtools. Is there an XHR returning JSON? **Scrape that instead of the DOM** — an internal JSON endpoint is more stable than the page rendering it and is usually the single biggest durability win available.
3. If neither, it's `js-rendered` and needs Playwright. Note the cost.
4. Inspect the anchor. Stable `id`? A `data-` attribute? Or `nth-child` against an unlabelled table?
5. Check `/robots.txt`.
6. Estimate volatility from the page's own timestamps, not from what you'd like the cadence to be.
7. Write the `notes` field now, while you have the page open.

**Prefer the boring source.** A government JSON endpoint that updates weekly beats a beautiful dashboard that updates hourly behind a React SPA. Durability is worth more than freshness for most of these facts, and every avoided Playwright target is CI minutes and a class of breakage you never deal with.

---

## 6. What to hand back

1. **This table, populated.** Done — see §3/§4 above, seven sources across all four sections.

2. **A one-line answer on Bluecore Energy.** Real target, literally — confirmed via SEC EDGAR (CIK 0002125928, BlueCore Energy, Inc., DE-incorporated), its own domain `bluecore.energy`, and independent press (TechCrunch, Bloomberg, Axios, Fortune, LA Times) around its July 2026 stealth launch and September 2026 $50M seed. Nothing here is throwaway.

3. **The three facts that matter most to the reader.** Proposed, per the "I'll propose them from triage" answer:
   - **Latest funding milestone** (`bluecore-form-d`: `totalOfferingAmount`, `totalAmountSold`) — the single fact a deal-team reader cares most about, and one where the _official_ filing already disagrees with the _press_ headline ($21.8M offered / $19.4M sold vs. the widely-reported "$50M raise"). That gap is exactly the kind of noise-cutting `SPEC.md` §1 says this tool exists to do.
   - **Latest headline + date + category** (`bluecore-newsroom`, three extractors on one page) — the freshness/"what's happening now" signal, and a clean architectural fit: one target, one section, three extractors, real anchors, weekly cadence. **This is the recommended M1 walking-skeleton target** — it satisfies the roadmap's "one target, two or three extractors, one section" scope discipline better than any other candidate here (Form D updates too rarely to demo a freshness badge changing state; the newsroom updates about weekly).
   - **Open-roles count** (`bluecore-careers`) — a cheap, durable, genuinely volatile hiring-velocity proxy or growth signal that a JSON API makes nearly free to maintain.

   `oklo-sec-filings` (competitor activity) is a strong fourth candidate for M2 breadth once M1's single target is proven end to end, since Industry Segment's whole point per `SPEC.md` §3 is competitor activity, not just Bluecore's own state.
