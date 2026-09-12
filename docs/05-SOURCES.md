# 05 — Source Inventory

**Status: blocked on open question Q1.** This is a template with the triage method filled in. The rows are empty because nobody has named the sources yet.

This document is the real specification. `SPEC.md` describes a machine; this describes its fuel. Until it is populated, the extraction design is guesswork and the stack constraints in SPEC Part 2 §1 are unvalidated.

---

## 1. Why this comes before code

Two things here can invalidate architectural decisions already made:

**PDF share.** If more than roughly 30% of sources are PDFs, "Cheerio primary, Playwright fallback" is the wrong stack constraint, and the `pdf` kind — currently a sketch in `02-CONFIG-SCHEMA.md` §7 — becomes a first-class design problem rather than a deferred one. Scanned PDFs needing OCR raise a sharper question: OCR has an error rate, which sits awkwardly next to a determinism guarantee. That may need to be a labelled, lower-confidence class of block rather than a normal one.

**Session-state applications.** Government dockets frequently live in older frameworks with server-side session state, postback pagination, and no addressable URLs per record. These are not "use Playwright" problems — they are "the deep link you want does not exist" problems, and they change what is extractable at all.

Finding either out during implementation costs a rewrite. Finding out during triage costs an afternoon.

---

## 2. Triage columns

| Column | Values | Why it matters |
|---|---|---|
| `id` | slug | Becomes `targetId` and the data filename |
| Section | target / segment / regulatory / climate | Grid placement |
| URL | absolute | The source |
| Type | static-html / js-rendered / json-api / pdf / pdf-scanned / session-app | Drives `kind` and `renderer` |
| Volatility | realtime / daily / weekly / monthly / quarterly / episodic | Drives `cron` and `ttlHours` |
| Auth | none / key / login | Login sources need a separate risk conversation |
| Robots | allow / disallow / unclear | Q6 input |
| Anchor quality | stable-id / class / positional / text-only | Predicts breakage rate |
| Facts | count | Extractors on this target |
| Feasibility | easy / moderate / hard / blocked | Build order |
| Notes | prose | The fragile parts |

**Anchor quality** is the maintenance predictor. A source with stable `id` attributes may never break. A table matched by `nth-child` will break the first time a row is inserted. Triaging this up front tells you where the weekly cost will land, and lets you drop a source that is more trouble than the fact is worth.

---

## 3. Inventory

### Section: Target Company State

| id | URL | Type | Volatility | Auth | Robots | Anchor | Facts | Feasibility | Notes |
|---|---|---|---|---|---|---|---|---|---|
| _(empty)_ | | | | | | | | | |

### Section: Industry Segment

| id | URL | Type | Volatility | Auth | Robots | Anchor | Facts | Feasibility | Notes |
|---|---|---|---|---|---|---|---|---|---|
| _(empty)_ | | | | | | | | | |

### Section: Regulatory Landscape

| id | URL | Type | Volatility | Auth | Robots | Anchor | Facts | Feasibility | Notes |
|---|---|---|---|---|---|---|---|---|---|
| _(empty)_ | | | | | | | | | |

### Section: Market Climate

| id | URL | Type | Volatility | Auth | Robots | Anchor | Facts | Feasibility | Notes |
|---|---|---|---|---|---|---|---|---|---|
| _(empty)_ | | | | | | | | | |

---

## 4. Summary (recompute on population)

| Metric | Count | Decision it drives |
|---|---|---|
| Total sources | — | Scale ceiling (ADR-007), maintenance estimate |
| static-html | — | Baseline |
| js-rendered | — | Playwright targets; CI minutes |
| json-api | — | Cheapest and most durable — prefer where they exist |
| pdf / pdf-scanned | — | **If >30%, revisit the stack constraint** |
| session-app | — | May be infeasible; flag early |
| Requiring auth | — | Secrets management |
| robots: disallow | — | Q6 — must be resolved, not ignored |
| Positional anchors | — | Predicted weekly breakage |

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

Three things unblock everything downstream:

1. **This table, populated** — even roughly. Type and anchor quality matter more than precision.
2. **A one-line answer on Bluecore Energy** — real client, real target, or constructed demo. It changes how much of this is throwaway.
3. **The three facts that matter most to the reader.** Those become the walking skeleton (`07-ROADMAP.md`), and everything else is config afterwards.
