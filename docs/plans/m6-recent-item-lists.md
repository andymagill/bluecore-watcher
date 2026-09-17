# M6 — Recent-item lists & competitor news — plan

Implements the milestone in `07-ROADMAP.md` M6: every "latest X" block on the dashboard becomes a
short, linked list of recent items instead of a single value, and both existing competitors
(Oklo, NuScale) get a news source for the first time. Exit test: all list-shaped blocks render 3
linked items each, a new item produces a clean "+1" delta (not "+1 −1"), and standard verification
passes.

## How to use this doc

Only the workstream marked **Next** below gets implemented in a given conversation — the others
are design only, for a future conversation to pick up cold. Each workstream:

1. Confirms its own prerequisites checklist below.
2. Branches off `main` (`origin/main`, not a stale local branch).
3. Commits per verified phase, not once at the end.
4. Runs the standard verification (format/lint/typecheck/schema/validate-config/test) plus
   `npm run fixture:verify -- --env bluecore`.
5. Updates the status table below and the M6 section of `07-ROADMAP.md` on completion.

## Status

| Workstream                                                       | Status      | PR  |
| ---------------------------------------------------------------- | ----------- | --- |
| M6a — Row lists (html), `bluecore-newsroom`, M4c (retire form-d) | Delivered   | #33 |
| M6b — `kind: "xml"`, Oklo + NuScale press-release targets        | Delivered   | TBD |
| M6c — Row lists (api), FR targets                                | Not started | —   |
| M6d — SEC + USAspending targets, M6 close-out                    | Not started | —   |

## Context / findings (all of M6, live-verified 2026-09-17)

**Why now:** `bluecore-newsroom`'s `latest_headline` renders as **plain, unlinked text** — the one
existing `list` presenter (`src/app/components/ListBlock.tsx`) has never been exercised by a real
target since M0.5 shipped it. Every other "latest X" extractor across the config (FR, SEC,
USAspending) shows exactly one row when the underlying source has dozens. A short linked list is
more useful in every one of these cases, and it's the same engine feature everywhere.

**BlueCore newsroom** (`fixtures/bluecore-newsroom/response.html`): each `.bc-n-card` is itself an
`<a href>` wrapping title/date/category. Hrefs are mixed — some relative (`/post/…`), most absolute
external press links (techcrunch.com, axios.com, bloomberg.com, …) — so a row's URL field must
resolve against `target.url` only when relative. 12 cards, newest first, confirmed against the
live fixture.

**Oklo:** `https://oklo.com/newsroom/rss.xml` returns 200 `application/rss+xml`, RSS 2.0, 50 items
newest-first, `<guid isPermaLink="true">` holding the canonical article URL, `pubDate` in RFC-822
GMT. **The newsroom page does not advertise this feed** (no `<link rel="alternate">` in its
`<head>`) — found by trying the conventional path, not by following a link. Recorded as a `notes`
risk: if the feed is ever pulled, the fallback is `oklo.com/newsroom`'s HTML, which live-verified
as 12 `<article>` elements with `time[datetime]` (ISO) and `h2|h3 > a` — but its CSS classes are
build-hashed (`mzn1th1`, `_11krm2v0`, …) and churn on redeploy, so a future html-based repair would
need semantic-only selectors (`article`, `time[datetime]`, `h2 a, h3 a`), not class names.
`oklo.com/robots.txt`: `Allow: /`, disallows only `/studio` and `/api`.

**NuScale:** `https://www.nuscalepower.com/press-releases/rss.xml` (HubSpot-hosted) returns 200
`text/xml`, 10 items newest-first, and **is** advertised via `<link rel="alternate">` on the page.
`robots.txt` only disallows HubSpot preview paths, none of which this endpoint matches. The old
`ir.nuscalepower.com` subdomain now redirects to `www.nuscalepower.com`; `ir.oklo.com` doesn't
resolve at all — neither company runs a separate IR site worth targeting directly.

**Why a new `kind: "xml"`, not the existing html handler:** in Cheerio's default (HTML) parsing
mode, `<link>` is a void element — `item link` returns an empty string on both feeds, verified
live. XML mode (`cheerio.load(body, { xml: true })`) parses it correctly. `ExtractHandler.parse()`
takes only the fetch result, no target, so threading a per-target "parse as XML" flag through would
touch the handler interface and every existing call site. A new handler kind, registered
additively (ADR-010's own contract), is the correct-sized change.

**API row counts, all live-verified:**

- FR fixtures (`fr-smr-mentions`, `fr-nrc-smr`, `fr-doe-nuclear`) each carry 20 results;
  `fr-maritime-reactor` carries 15. `$.results[*]~` resolves to `[0, 1, 2, …]` under jsonpath-plus
  (an indexed-each expression, confirmed against the real fixtures) — the same mechanism ADR-022's
  `index.jsonPath` already uses for "first", generalized to "every".
- SEC `filings.recent.form` has 32 `8-K` entries for Oklo (455 filings total), 107 for NuScale (789
  total), and **0 for `bluecore-sec-filings`** (2 filings total, both Form D) — its list can never
  be 8-K-specific; it needs the same generic "any recent filing" composite the existing scalar
  extractor already uses.
- `usaspending-advanced-reactor-awards`'s committed fixture has exactly **1** row — the request
  body hardcodes `"limit":1` — so M6d must both change the body to `"limit":3` and recapture.
- Synthetic fixtures `example-regulatory-api` (1 row) and `example-contracts-api` (2 rows) need
  extending to ≥3 rows so a list test isn't trivially satisfied by "every row".

## Pre-existing defects found while triaging the `list` presenter (fix in M6a)

None of these were previously visible — no real target has ever used `presenter: "list"`.

1. **`ListBlock.tsx`'s per-item link is already broken.** Its href is
   `${sourceUrl}#${encodeURIComponent(anchor[i])}`, but `anchor[i]` (from `html-handler.ts`'s
   `resolveAnchor`) is already a full `sourceUrl#selector-path` string — the component doubles the
   base URL and mangles the fragment. `ListBlock` also has no `expired`-state disclosure
   (`MarkdownBlock.tsx` has one, ADR-020/M3c) and no `ProvenancePopover`.
2. **A template-only edit (relabeling, wording) never publishes.** `processExtractor`'s
   "unchanged" branch (`src/ingest/process-extractor.ts`, the `unchanged` spread) carries the
   _previous_ `value`/`displayValue` forward whenever `contentHash` is unchanged — correct for
   ADR-011's "no commit on unchanged source data," but ADR-022 explicitly documents the opposite
   intent for composite locations: editing a `valueMap` or `template` should change `value` without
   looking like an any-change alert. Nothing caught this because no composite `list` extractor has
   existed until now.
3. **`computeSetDelta` (`src/ingest/diff.ts`) diffs rendered strings, not row identity.** For a
   bounded (`limit`-ed) window, an ordinary new post pushes the oldest row out — today that reports
   as both `added: [newest]` and `removed: [oldest]`, i.e. "+1 −1" on the dashboard for what is
   actually just one new item. And a template/valueMap edit would show every row as both added and
   removed, since the rendered string for row 0..N-1 all changed even though nothing underlying
   moved.

## Decisions

| Topic                    | Decision                                                                                                                                                                                                                                                                                                                                                                                     | Workstream |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Engine shape             | **Rows in the existing `list` presenter**, composed per-item the way ADR-022 composes one row (`fields` + `template`), not one markdown blob repeated N times. Chosen for per-item deltas, per-item provenance/anchors, and per-item asserts — a blob loses all three.                                                                                                                       | M6a/M6c    |
| Competitor source        | **RSS feeds**, parsed via a new `kind: "xml"` handler (ADR-026) — not the existing html handler with a `<guid>` workaround, and not scraping either company's HTML newsroom page (Oklo's build-hashed classes are a repair liability; a feed is a published, stable contract).                                                                                                               | M6b        |
| Existing scalar fields   | Descriptive per-row scalars that a list now subsumes (headline, category, document type/agency,latest-filing "summary" markdown) are **removed**. Scalars carrying a guard, alert, or a metric (dates with ADR-018 monotonic/notBefore guards, dollar amounts, form codes with any-change alerts) **stay** alongside the list.                                                               | M6a/c/d    |
| API scope                | **Full scope**: extend row lists to `api` locations (`index.pick: "each"`, ADR-025 amendment) and upgrade all 4 FR targets, both competitor SEC targets, `bluecore-sec-filings`, and USAspending — not just the html-only Company card.                                                                                                                                                      | M6c/M6d    |
| Alerts on new lists      | **None.** The dashboard's own delta chip ("+1 · 2 days ago") already surfaces a new item; `bluecore-newsroom`'s existing `latest_post_category` extractor already has an `any-change`/`info` alert that has never once dispatched (info < `minSeverity: "warn"`) — the same "would just be noise" reasoning applies to competitor cadence (Oklo posts roughly weekly).                       | —          |
| Item count               | **3 per list** (`limit: 3`). Covers roughly 1–3 months of history at each source's observed cadence and keeps a full-width list block from dominating its section.                                                                                                                                                                                                                           | —          |
| M4c (retire form-d)      | **Folded into M6a.** `bluecore-form-d` is the one target parsing XML through the `html` kind (Cheerio's non-XML parser happens to tolerate its custom tags) — leaving it as-is next to a real `kind: "xml"` reads as an unexplained inconsistency, and M6a already reworks the Company card it lives on. Retiring it was already planned (M4c, `07-ROADMAP.md`); this just picks the moment. | M6a        |
| Deliverable of this plan | **Design-only docs PR.** Mirrors PR #29 (M5's design PR): this plan doc plus `07-ROADMAP.md` edits, renumbering the old M6 to M7. M6a implementation starts in a fresh conversation, same discipline as every prior milestone.                                                                                                                                                               | —          |

---

## Engine design (ADR-025 — row lists; ADR-026 — `kind: "xml"`)

Full ADR text is written when M6a lands (`00-DECISIONS.md`); this section is the design brief a
future implementer works from.

### ADR-025 — Composite row lists

**Schema (`src/config/schema.ts`):**

- A `list` extractor may now use a **composite** location (`fields` + `template`, ADR-022's shape)
  instead of a single `selector`/`jsonPath`. Rule 7 (presenter/type compatibility) extends: `list`
  accepts `type: "string"` (plain, unchanged) or `type: "markdown"` (composite rows only).
  Rule 13 (composite mutual-exclusivity/consistency) extends to cover `presenter: "list"` the same
  way it covers `presenter: "markdown"` today.
- A composite `list` extractor **requires `limit`** (new field, positive integer) — SEC's `recent`
  arrays run into the hundreds; an unbounded list is never the intent. `limit` applies to the row
  count _before_ field resolution, so a malformed row past the window can't fail extraction for a
  well-formed one inside it.
- **Html/xml row shape:** the extractor's own `selector`/`multiple: true` picks the row nodes (as
  it does today); `fields` are row-relative — `{ selector?, attr?, ...transforms }`, where an
  omitted `selector` means the row node itself (needed for `.bc-n-card`, which is the `<a>`).
- **Api row shape:** `ApiIndexDef.pick` gains `"each"` alongside the existing `"first"`.
  `pick: "each"` is only valid with `presenter: "list"` (a new rule-13 check, symmetric with
  today's "index set ⟺ a field uses `{index}`" check). Fields keep `{index}` substitution,
  resolved once per matched row.
- **Field transform additions** to `ApiFieldDef` (shared by html/xml/api composites once html/xml
  fields reuse the same transform set):
  - `format: "date"` — runs the field's raw text through the existing `coerce`/`formatDisplayValue`
    date path (`src/ingest/extract/coerce.ts`) so `"September 8, 2026"`, `"AUG 6, 2026"`, and RFC-822
    all normalize to the same `08 Sep 2026` display convention already used elsewhere on the
    dashboard; throws `PARSE_ERROR` like any other coercion failure.
  - `truncate: n` — display-only (the stored `rawText` keeps the full value, so `contentHash` is
    unaffected); needed because USAspending's `Description` field reaches 2,564 characters live.
  - `escape: "href"` — resolves a relative URL against `target.url` (needed for
    `bluecore-newsroom`'s mixed relative/absolute hrefs), rejects any non-`http(s)` scheme as
    `PARSE_ERROR` (a `javascript:` or `mailto:` href must not silently become a clickable dashboard
    link), and percent-encodes parens/whitespace so the composed markdown link syntax can't break.
  - Transform order becomes: strip → split → valueMap → join → format → truncate → escape.

**Extraction (`src/ingest/extract/`):**

- `compose.ts` stays pure and kind-agnostic; `applyFieldTransform` gains the base URL parameter
  `escape: "href"` needs.
- Html/xml handlers: for each of the first `limit` matched row nodes, resolve every field within
  that row; zero or >1 matches for a field raise `SELECTOR_NO_MATCH`/`SELECTOR_AMBIGUOUS` naming
  both the field and the row index (extends the per-field error handling `api-handler.ts`'s
  `locateComposite` already has).
- `pipeline.ts`'s list branch (`extract/pipeline.ts`) must start honoring `located.texts` — today
  it always narrows/coerces `rawTexts` even when a handler sets `texts` (the ADR-022 split that lets
  a composite's raw pre-transform values differ from its composed display). This is an existing gap
  the scalar branch already handles correctly; the list branch needs the same treatment.
- A zero-row result surfaces through `assert.minItems` (`ASSERTION_FAILED`), same as a plain list
  today — no new error path needed.

**Diff (`src/ingest/diff.ts` — fixes defect 3 above):**

- `computeSetDelta`'s row identity keys on each row's raw `rawText` (or the pre-transform
  `stableRawJson`, for a composite), not the rendered `displayValue` — a template/valueMap edit no
  longer produces spurious set churn.
- **Window eviction:** when the extractor declares `limit` and the new row count equals `limit`,
  rows that fall off the _end_ of the window purely because a new row pushed them out are excluded
  from `removed`. A genuinely new item then reports as `added: [newest]`, `removed: []` — "+1", not
  "+1 −1". A row that disappears from the _source_ for a reason other than window eviction (the
  underlying page/feed actually dropped it — e.g. list shrank below `limit`) still reports as
  removed. The `SetDelta` contract shape (`01-DATA-CONTRACT.md` §4.1) is unchanged; this is a
  semantics note added there, not a schema change.

**Frontend (`src/app/components/`):**

- `ListBlock.tsx`: render each item through `marked.parseInline` + `DOMPurify.sanitize` (a small
  shared helper alongside `MarkdownBlock.tsx`'s existing `marked.parse`), fix the broken per-item
  href (drop the redundant anchor-in-anchor construction — `anchor[i]` is already the full link),
  add `expired`-state disclosure (mirrors `MarkdownBlock.tsx`), add a `ProvenancePopover`. Keep
  exactly one `data-block-key` node per block (the wrapper) so `src/gate/smoke-render.ts`'s
  rendered-vs-published block-count check is unaffected by per-item markup.
- `TargetCard.tsx`: a `list` block spans the full grid row (`col-span-full`) rather than sharing a
  grid cell with scalar blocks — three linked rows read poorly squeezed into a metric-sized tile.
- `ProvenancePopover.tsx`: render list `rawText`/`anchor` as one entry per row (a short list),
  replacing today's flat comma-joined string — which was never actually seen with real data.

**Drift and repair:**

- `src/drift/check.ts`'s `TYPE_CHANGED` check (currently skips any `extractor.presenter === "list"`
  api extractor) resolves the first row's field paths via the same `resolveApiPaths` helper
  ADR-022 built, so a list composite gets the same drift coverage a scalar composite already has.
- `src/repair/relocate.ts`/`score.ts` declare composite `list` extractors `"unsupported"` for
  auto-repair — same precedent ADR-022 set for composite/indexed scalars, extended to cover
  `pick: "each"`. `.claude/skills/repair-selector/SKILL.md` gets a line documenting the limit.

### ADR-026 — `kind: "xml"`

- `XmlLocation` mirrors `HtmlLocation` (`kind: "xml"`, same `selector`/`attr`/`multiple` fields).
  `TargetDef.kind` gains `"xml"`; rule 6 (extractor kind must match target kind) is unaffected by
  construction.
- New `src/ingest/extract/xml-handler.ts`: `parse()` calls `cheerio.load(body, { xml: true })`;
  `locate()` reuses `html-handler.ts`'s selector-matching and `resolveAnchor` logic, factored into a
  shared cheerio helper both handlers call — with a fixture-verified zero-drift proof that the html
  path's behavior is unchanged by the refactor.
- Registered additively in `src/ingest/extract/registry.ts` (the one line ADR-010 promises a new
  kind costs).
- Every other `kind === "html" ? … : …` branch needs an `"xml"` arm: `EXTENSION_BY_KIND`
  (`src/ingest/fetch/fixture-fetcher.ts`, → `xml: "xml"`), the drift structural-skeleton check
  (`src/drift/check.ts`, `src/drift/structure.ts`), `extractorLocatorOf`
  (`src/ingest/extract/locator.ts`), and `scripts/repair-diff.ts`/`scripts/repair-verify.ts`. Repair
  treats `xml` extractors as `"unsupported"` in M6 — every xml extractor this milestone adds is
  itself a composite list, already unsupported for that reason.
- `02-CONFIG-SCHEMA.md` documents the XML-mode gotchas found in triage: selectors are
  case-sensitive (`pubDate`, not `pubdate`), a namespaced tag needs its colon escaped in a CSS
  selector (`dc\\:creator`), and htmlparser2's XML mode resolves no external entities (no XXE
  surface to worry about).

---

## Per-target changes (M6a–M6d)

3-item lists throughout. `minItems`/`maxItems` sized per target; per-item `maxLength` sized from
the live data cited above.

| Target                                                  | New list                                                                                                                                   | Scalars removed                                                           | Scalars kept                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `bluecore-newsroom` (M6a)                               | `recent_posts`: `[{title}]({url}) — {category}, {date}`, row = `.bc-n-card:lt(3)`                                                          | `latest_headline`, `latest_post_category`                                 | `latest_post_date` (keeps its `expectMonotonic`/`maxFutureDays` guard) |
| `oklo-press-releases` (M6b, new, Competitive)           | `recent_releases`: rows = `channel > item`, `[{title}]({link}) — {date}`; `kind: "xml"`, `viewUrl` → `https://oklo.com/newsroom`           | —                                                                         | new `latest_release_date` (maxFutureDays, notBefore, expectMonotonic)  |
| `nuscale-press-releases` (M6b, new, Competitive)        | same shape against NuScale's feed; `viewUrl` → `https://www.nuscalepower.com/press-releases`                                               | —                                                                         | new `latest_release_date`                                              |
| `fr-smr-mentions`, `fr-nrc-smr`, `fr-doe-nuclear` (M6c) | `recent_documents`: `index: { jsonPath: "$.results[*]~", pick: "each" }`, `[{title}]({url}) — {type}, {date}`                              | `latest_document_title`, `latest_document_type`                           | count metric, `latest_document_date`                                   |
| `fr-maritime-reactor` (M6c)                             | same, plus `{agency}` field (`agencies[-1:].name`) — the only FR target spanning multiple agencies                                         | `latest_document_title`, `latest_document_type`, `latest_document_agency` | count metric, `latest_document_date`                                   |
| `oklo-sec-filings`, `nuscale-sec-filings` (M6d)         | `recent_8ks`: existing 8-K `index.jsonPath` with `pick: "each"`, same `items`/`date`/link fields as today's `latest_8k`                    | `latest_8k`                                                               | `latest_filing_form`, `latest_filing_date`                             |
| `bluecore-sec-filings` (M6d)                            | `recent_filings`: `$.filings.recent.form[*]~` each (generic — not 8-K-specific, per the 0-8-K finding above); `minItems: 1`, `maxItems: 2` | `latest_filing_summary`                                                   | `latest_filing_form` (any-change/warn alert), `latest_filing_date`     |
| `usaspending-advanced-reactor-awards` (M6d)             | `recent_awards`: request body `"limit":3` (recaptured fixture), `**{recipient}** — {agency} — {desc, truncated} — [award record]({url})`   | `latest_award`, `latest_award_agency`                                     | `latest_award_amount`, `latest_award_date` (any-change alert)          |

No acknowledgement entries or open alert issues reference any removed key (checked against
`config/acknowledgements.json` and current alert-issue history) — removals are clean.

---

## M6a — Row lists (html), `bluecore-newsroom`, M4c close-out

**Delivered 2026-09-17.** Implemented as planned below — no scope surprises during the build. One
real bug caught while writing the transform tests: `encodeURIComponent` deliberately leaves `"("`
and `")"` unescaped (RFC 3986 sub-delims), so `escape: "href"`'s percent-encoding needed an explicit
override map rather than relying on `encodeURIComponent` alone. Also gave `ListBlock`'s rendered
rows the `prose` typography class `MarkdownBlock` already applies — caught visually (dev server +
screenshot): without it, a composed row's own markdown link resolved correctly in the DOM but had
no visible link styling.

**Prerequisites:** none beyond `main` — this is the milestone's first workstream, same "engine
first" precedent M4a/M5a set.

**Scope:**

- ADR-025's schema/extraction/diff/frontend/drift/repair changes, proven against `html` locations
  only (`kind: "xml"` is M6b's job).
- Fix the three pre-existing defects above (`ListBlock`'s broken href + missing `expired`/
  provenance, the unchanged-branch value freeze, `computeSetDelta`'s row-identity/window-eviction
  gap) — all three block `list` from working correctly regardless of which handler feeds it, so
  they belong in the workstream that first exercises `list` for real.
- Convert `bluecore-newsroom` to the new shape (see table above).
- **M4c, folded in:** retire `bluecore-form-d` — remove the target from `config/bluecore.config.ts`,
  delete `fixtures/bluecore-form-d/`, delete its committed `public/data/sections/.../bluecore-form-d.json`
  (`writeAll` in `src/ingest/persist.ts` never prunes orphaned target files — this needs a manual
  delete), remove its row from `docs/05-SOURCES.md`, and update `bluecore-sec-filings`'s `notes`
  (which currently describes itself as form-d's "companion") to drop the now-stale cross-reference.

**Testing:**

- New synthetic fixture `fixtures/example-news-cards/response.html`: anchor-wrapped rows mixing a
  relative href, an absolute href, a `javascript:` href (must reject), and one row missing a field
  (must raise `SELECTOR_NO_MATCH` naming the row).
- `tests/list-composite.test.ts` (new): row limiting before field resolution, per-row/per-field
  error naming, `format: "date"`/`truncate`/`escape: "href"` transforms, href scheme rejection.
- `tests/list-presenter.test.ts`: extend with row-identity SetDelta cases (template edit → no
  churn) and window-eviction cases ("+1 −0" on a full window, "+1 −1" only when the source itself
  shrank below `limit`).
- `tests/config-schema.test.ts`: rule 7/13 extensions (composite list requires `limit`,
  `type: "markdown"`).
- `tests/app/list-block.test.tsx` (new): renders sanitized markdown links, `expired` suppression,
  exactly one `data-block-key` per block.
- `npm run schema:gen`; `tests/adr001-no-bluecore.test.ts` stays green (no entity names leak into
  `src/`/`tests/`).
- `npm run fixture:verify -- --env bluecore`: `bluecore-newsroom`'s golden is re-blessed; every
  other target (including the ones M6b–d haven't touched yet) shows zero drift; `bluecore-form-d`
  is gone from the target list entirely.
- An ADR-023 preview ingest run (`workflow_dispatch --ref <branch>`) before merge, same as every
  prior workstream that touches real extraction.

---

## M6b — `kind: "xml"`, Oklo + NuScale press-release targets

**Prerequisites:** M6a merged (needs `ListBlock`'s fixed rendering and the diff/persist fixes).

**Scope:**

- ADR-026: `xml-handler.ts`, registry entry, every `kind === "html" ? … : …` branch gets an `"xml"`
  arm (enumerated above), `02-CONFIG-SCHEMA.md` XML-mode notes.
- `oklo-press-releases` and `nuscale-press-releases`, both new targets in the Competitive Landscape
  section, `entityId` pointing at the existing `oklo-inc`/`nuscale-power` entities (no new entity
  rows — ADR-001's "one primary entity" rule is about `environment.entities`, unaffected here).
- Fixtures captured via `npm run fixture:capture` per `06-OPS-RUNBOOK.md` §10 step 2, `.xml`
  extension (`EXTENSION_BY_KIND`'s new entry).
- `notes` on `oklo-press-releases` records the undocumented-feed risk and names the HTML fallback
  (semantic selectors only) for a future repair.

**Testing:**

- New synthetic fixture `fixtures/example-rss-feed/response.xml`: `<link>`, `pubDate`, a namespaced
  `dc:creator` field, to prove xml-mode parsing generically before any real target depends on it.
- `tests/xml-handler.test.ts` (new): `<link>` resolves correctly (the defect that motivated
  ADR-026), case-sensitivity, an ADR-010 additivity check (registering `xml` touches no existing
  handler file, same proof `adr010-additivity.test.ts` already gives for a stub kind).
- `npm run fixture:verify -- --env bluecore`: both new targets pass; the 12 pre-existing targets
  (M4c already removed form-d) show zero drift.
- ADR-023 preview run before merge.

---

## M6c — Row lists (api), Federal Register targets

**Prerequisites:** M6a merged (needs the `list`/composite engine changes; api-specific parts are
additive on top).

**Scope:**

- `ApiIndexDef.pick: "each"`, the associated rule-13 checks, `resolveApiPaths`/drift support for
  `pick: "each"`.
- `fr-smr-mentions`, `fr-nrc-smr`, `fr-doe-nuclear`, `fr-maritime-reactor` each gain `recent_documents`
  per the table above; the existing per-target `latest_document_title`/`_type`/`_agency` scalars are
  removed (count and date scalars stay).

**Testing:**

- Extend `fixtures/example-regulatory-api/response.json` to ≥3 results (existing tests reading
  `results[0]` only must stay green — verify explicitly).
- `tests/composite-config-shapes.test.ts`: add `pick: "each"` cases against the extended fixture.
- `tests/drift.test.ts`: a `pick: "each"` `TYPE_CHANGED` case.
- `npm run fixture:verify -- --env bluecore`: all 4 FR targets re-blessed; every other target
  (including M6b's two new ones) shows zero drift.
- ADR-023 preview run before merge.

---

## M6d — SEC + USAspending targets, M6 close-out

**Prerequisites:** M6a and M6c merged (reuses `pick: "each"` for the SEC targets).

**Scope:**

- `oklo-sec-filings`, `nuscale-sec-filings`: `recent_8ks` alongside the existing `latest_8k` →
  `latest_8k` is removed once the list covers it; `latest_filing_form`/`latest_filing_date` stay.
- `bluecore-sec-filings`: generic `recent_filings` (not 8-K-filtered — see the 0-8-K finding),
  `minItems: 1, maxItems: 2` since only 2 filings exist total; `latest_filing_summary` removed.
- `usaspending-advanced-reactor-awards`: request body `"limit":3"`, `recent_awards` composite list,
  `latest_award`/`latest_award_agency` removed; `latest_award_amount`/`latest_award_date` stay.
  Fixture must be recaptured (`fixture:capture`), not hand-edited — the committed fixture is a real
  captured response per `06-OPS-RUNBOOK.md` §10.
- **M6 close-out:** update `docs/07-ROADMAP.md`'s M6 section (status → Delivered, live-verification
  notes), `docs/05-SOURCES.md` rows for the two new competitor targets, this plan doc's status
  table, and confirm the M6 exit criteria below.

**Testing:**

- Extend `fixtures/example-contracts-api/response.json` to ≥3 results.
- `tests/composite-config-shapes.test.ts`: `pick: "each"` cases for the contracts shape.
- Full-suite `fixture:verify -- --env bluecore`: all 14 real targets (12 pre-existing minus
  `bluecore-form-d` plus 2 new competitor targets) pass with the expected re-blessed goldens.
- Full standard verification (format/lint/typecheck/schema/validate-config/test).
- ADR-023 preview run before merge; confirm the smoke-render block count matches published count
  with every list block's single `data-block-key` wrapper.

### M6 exit criteria

- All list-shaped blocks (11 total: 1 html, 2 xml, 4 FR, 3 SEC, 1 USAspending) render 3 linked
  items with working per-item hrefs.
- Oklo and NuScale each have a news source in Competitive Landscape — the first non-SEC signal for
  either competitor.
- A genuinely new item produces `added: [1 item], removed: []` in its SetDelta — "+1", not "+1 −1"
  — verified against at least one real target's dry-run history.
- A template/valueMap-only edit changes `displayValue` without changing `contentHash` and without
  firing an any-change alert.
- `bluecore-form-d` is retired; `bluecore-sec-filings`'s notes no longer reference it.
- `npm run fixture:verify -- --env bluecore` reports zero drift on every untouched target
  (`bluecore-careers`, `eia-ca-industrial-price`) throughout M6a–d.
- Standard verification passes at every workstream boundary.

---

## Suggestions record

- **Adopted:** window-aware `SetDelta` (fixes the "+1 −1" defect); `limit` required on every
  composite list; `escape: "href"` scheme validation (rejects `javascript:`/`mailto:` at extraction
  time, not silently rendered); keeping guard-bearing scalars alongside their new list;
  folding M4c into M6a.
- **Open, for a future milestone:** conditional GET (ETag/If-Modified-Since) on the two RSS feeds,
  if feed-polling cost ever becomes a concern — recorded in `07-ROADMAP.md`'s Deferred table rather
  than designed here, since nothing today indicates it's needed.
- **Open, for a future milestone:** a list-block footer link ("more at `viewUrl`") if 3 items proves
  too few in practice once this is live and observed.
