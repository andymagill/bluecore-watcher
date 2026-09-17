# 07 — Roadmap

Milestone shape was undecided. Recommending the **walking skeleton**, for a specific reason: every architectural mistake in this system is cheap to fix once and expensive to fix twenty times. One source driven all the way through finds them at N=1.

The alternative — building all four sections before showing anyone — compounds a wrong data contract across every scraper written under it. The frontend-first-on-fixtures path demos faster but reliably produces a contract ingestion cannot satisfy, which is why it's in the rejected list.

---

## M0 — Source triage

Populate `05-SOURCES.md`. Name the target. Pick the three facts that matter most to the reader.

**Exit:** the inventory table has rows, and the PDF share is known.

**Owned by Andrew, runs concurrently with M0.5.** Per ADR-001 the engine must be source-independent, so M0.5 (below) does not wait on this — it proceeds against a synthetic config. M0 blocks M1 and M2, which need real targets; it does not block the engine spine.

**Why it still matters early:** the session-app answer can reveal a source that is infeasible outright — "the deep link you want does not exist," not an extraction difficulty. Finding that out during triage costs an afternoon; finding it during M1 costs a rewrite of that target's plan. The PDF share no longer carries this risk (ADR-010 made `kind` additive) — it now only affects handler build order.

---

## M0.5 — Engine spine

**Owned by the implementer, runs concurrently with M0.** Everything that has no dependency on a real source: doc consistency, the contract layer (Zod schemas, generated JSON Schema, Ajv-validated), the config validator, the `html`/`api` handler registry (ADR-010), the semantic-diff persist layer (ADR-011), and the offline half of the gate (schema validation + contract assertions). Proven against a synthetic, non-Bluecore config and fixtures — no cron, no Cloudflare deploy, no real target.

**Exit criteria:**

- `npm run validate:config` rejects a config violating each documented rule.
- A `--dry` ingestion run over the synthetic config extracts every block with full provenance and writes nothing.
- A second identical `--dry` run reports no semantic change (ADR-011 / Invariant 7).
- A deliberately broken selector, an ambiguous selector, an out-of-range value, and a guard-tripping value each produce their documented error class and health entry, with the prior value retained.
- A guard trip with a matching acknowledgement publishes and consumes the entry (ADR-012).
- A `list`-presenter extractor produces the array value/provenance/`SetDelta` shape from `01-DATA-CONTRACT.md` §4.1.
- Adding a second, stub source kind in a test touches no existing handler (ADR-010 — proves PDF is now additive rather than architectural).
- Zero occurrences of "bluecore" (case-insensitive) under `src/` (ADR-001, as a test).

**Why this doesn't wait for M0:** waiting would violate ADR-001's own premise — if the engine cannot be built without knowing a specific client's sources, "nothing entity-specific in code" isn't true yet. M0.5 is also the concrete test of that claim.

---

## M1 — Walking skeleton

One real source, end to end, nothing mocked. Builds on M0.5's engine spine — this milestone is config, selectors, the frontend, and the two pieces the spine deliberately deferred: the SPA to render against, and the Cloudflare-Workers-preview stage of the gate (amended ADR-005).

Config → fetch → extract → validate → diff → commit → branch → preview → gate → merge → deploy → render → freshness badge → delta chip → provenance popover → health entry.

**Scope discipline:** one target, two or three extractors, one section. The other three sections render as zero-states — which also proves the zero-state path.

**Exit criteria:**

- A cron run updates a value in production with no human involvement.
- A deliberately broken selector produces a health entry, retains the cached value, and does **not** reach production.
- The freshness badge changes state as the clock advances (test with a fake clock).
- A value change produces a correct delta chip, including the unchanged case ("unchanged for N days") per `01-DATA-CONTRACT.md` §4.
- Re-running with unchanged source data produces no commit. _(ADR-011 / Invariant 7 — already verified offline in M0.5; this criterion re-proves it against the real deployed pipeline.)_
- The Cloudflare-Workers-preview smoke render (doc 03 §3 check 3) catches a case where data is schema-valid but the block count the UI renders disagrees with the block count published.

**Why this set:** each criterion exercises a decision made in the docs. If one can't be met, a doc is wrong, and it's better to learn that now.

---

## M2 — Breadth

Every triaged source configured. Mostly config plus fixtures plus tests; architecture should not move.

**PR sizing:** treat M2 as **two PRs**, not one, unless target count is very small. One-PR M2 tends to hide regressions because config churn and assertion tuning land together.

**Recommended split:**

- **M2a — Coverage PR:** add all remaining target configs + fixtures + baseline extractor tests; no assertion-tightening beyond obvious schema/range correctness. **Delivered 2026-09-13.** Scope turned out narrower than "all remaining target configs" implied — 7 of 9 targets were already configured with fixtures from Q1; the real gap was baseline tests (6 of 7 existing targets had none), two new targets (`nuscale-sec-filings`, the second competitor named at Q1 but deferred; `eia-ca-industrial-price`, populating the previously-empty Market Conditions section and exercising `auth`/`secretEnv` for the first time), the `fixture:capture`/`fixture:bless` tooling the ops runbook already prescribed but didn't exist, and a timezone-correctness bug in date coercion (ADR-017) found while building golden fixtures.
- **M2b — Stabilization PR:** tune assertions from dry-run observations, fix drift/selector edge cases, and enable/verify weekly drift check. **Delivered 2026-09-13** ([PR #13](https://github.com/andymagill/bluecore-watcher/pull/13)). Widened beyond the line item: four date extractors (`bluecore-newsroom.latest_post_date`, both SEC targets' `latest_filing_date`) had zero silent-wrong protection before this — `min`/`max`/`expectMonotonic` only ever evaluated numbers, and a coerced date is always a string — closed via ADR-018 (`maxFutureDays`/`notBefore` shape assertions, `expectMonotonic` extended to dates via epoch-ms comparison, plus a config-time rule rejecting assert fields that are silent no-ops for an extractor's type). Also added a tenth target, `bluecore-sec-filings`, since `bluecore-form-d`'s URL is pinned to one accession number and could never observe BlueCore's next Form D on its own.

- All four sections populated. ✅ M2a.
- A fixture and unit test per target. ✅ M2a — originally `tests/targets.baseline.test.ts`, table-driven over the real config, plus `fixtures/<id>/expected.json` golden files; retired 2026-09-14 (ADR-021) in favor of `npm run fixture:verify`, the ops-layer equivalent, so vitest stays entity-agnostic.
- Assertions tuned from dry-run values, not guesses. ✅ M2b — Federal Register guards backfilled from 3.5 months of real weekly counts (previous `maxChangePct: 25` was ~20x looser than observed movement); `eia-ca-industrial-price`'s `maxChangePct` sized from 36 months of the real series; SEC filing-form pattern verified against all 52 distinct historical values across both fixtures.
- Weekly drift check running. ✅ M2b — `src/drift/`, `scripts/drift-check.ts` (`npm run drift`), `.github/workflows/drift.yml` (Monday cron + `workflow_dispatch`). Verified live on `main` (run [34782023672](https://github.com/andymagill/bluecore-watcher/actions/runs/34782023672)): 10/10 targets clean, zero issues opened.

**Exit:** a full run completes with `ok` on the large majority, and the health modal honestly reports the rest. **Met** — verified live 2026-09-13 (run [34782290966](https://github.com/andymagill/bluecore-watcher/actions/runs/34782290966)): ingestion → offline gate → branch → live gate (schema/contract/smoke-render against a real Cloudflare Workers Builds preview) → squash-merge; `health.json` on `main` reports `"ok":10,"failed":0,"degraded":0` out of 10 targets.

**Watch for:** if this milestone requires application-code changes, ADR-001 is being violated and the schema needs to absorb the difference instead.

---

## M3 — Operability

The milestone that decides whether this is maintainable by one person. Delivered across four sequential workstreams — see [`docs/plans/m3-operability.md`](plans/m3-operability.md) for the plan, decisions, and status.

- Alerting live (GitHub Issues, operator-only). ✅ M3a — [PR #16](https://github.com/andymagill/bluecore-watcher/pull/16), ADR-019.
- Repair tooling: fixture capture, selector diff, LLM-proposed repair PRs (ADR-003). ✅ M3b — [PR #18](https://github.com/andymagill/bluecore-watcher/pull/18).
- Failing-data safety valve: a long-outage value stops rendering as current past a configurable ceiling, regardless of TTL (Q4 safety half). ✅ M3c — ADR-020.
- Maintenance cost measured against the `06-OPS-RUNBOOK.md` §7 estimate.

**Re-scoped 2026-09-14.** M3c originally bundled a code-level safety gap with analyst-facing UX (copy, an outage banner, a modal rewrite) for an audience — analysts with dashboard access — that doesn't exist until auth ships, and that does nothing for M3's own exit test (an operator fixing a selector). Split: the safety gap (a `cached` block can render "3 days ago" in red for up to `3 × ttlHours` — 270 days at `bluecore-form-d`'s TTL — before the `expired` disclosure ever kicks in) stayed in M3c, scoped down to just that fix. The analyst-copy half moved to Deferred, below. See `docs/plans/m3-operability.md` M3c for the full writeup and the preserved original spec.

**Exit:** a selector break goes from alert to merged fix in under 30 minutes.

---

## M4 — Source quality: content-depth

Upgrade three existing source types to extract substantive content alongside volume metrics, and reconfigure one dashboard-occupying source as alert-only. Builds on M2's verified baseline extractors. In progress across three sequential workstreams (M4a, M4b delivered; M4c not started) — see [`docs/plans/m4-source-quality.md`](plans/m4-source-quality.md) for the plan, decisions, and status.

**Scope:**

- **Engine:** a composite/indexed `api` location (ADR-022) — SEC's `filings.recent` is parallel arrays with no stable index for "the latest 8-K," which a plain `jsonPath` can't bind across arrays. ✅ M4a.
- **Federal Register sources** (`fr-nrc-smr`, `fr-doe-nuclear`, `fr-smr-mentions`): Extract the title (as a link), type, and date of the most recent document matching each filter, alongside the existing count; `fr-smr-mentions` also extracts the publishing agency (the other two already filter to one agency, so it'd be a constant there). A regulatory signal moves from "NRC attention is 56 documents" to "NRC published a [specific] rulemaking on [date]". ✅ M4b.
- **SEC submissions** (`oklo-sec-filings`, `nuscale-sec-filings`): Extract the filing's `items` field and a link to the primary document from the most recent 8-K, not just the form code and date, using M4a's composite location. Turns "Oklo filed an 8-K on Tuesday" into "Oklo [filed a partnership agreement / announced financing]". `bluecore-sec-filings` (Company section) gets a generic latest-filing composite instead — live-verified to have no 8-K in its history, just two Form D filings. ✅ M4b.
- **BlueCore Form D** (`bluecore-form-d`): Retire the target — the companion `bluecore-sec-filings` already detects new filings, and M4b's `bluecore-sec-filings` upgrade absorbs the primary-document link Form D existed partly to surface. The XML target's dollar amounts were relevant once (the seed filing) but static between filings; frees dashboard real estate for higher-signal sources. M4c.

**Testing approach:** Per ADR-001, the engine feature (M4a) is proven against synthetic fixtures directly in vitest (`tests/api-composite.test.ts`), not `config/example.config.ts` — the real bluecore config (`npm run fixture:verify`) already proves it doesn't disturb any existing target. FR/SEC extractors (M4b) are tested the same way against generalized, entity-agnostic fixtures (`example-regulatory-api`, `example-sec-submissions`) in `tests/composite-config-shapes.test.ts`. Entity configs verified via `npm run fixture:verify` against `bluecore-*` and competitor config (ADR-021). No entity names in test requirements.

**Exit:** Dry run produces correct delta chips and provenance popovers for the new extractor shapes. Company, Competitive, and Regulatory sections display substantive content (not just counts or dates) — Market Conditions' turn is M5, which already carries the "all four sections" exit criterion. Standard verification passes.

---

## M5 — Source quality: new source types

Add sources that expose regulatory and procurement content currently unavailable through the public web dashboard. Whether this needs a new handler kind beyond `html`/`api` (ADR-010's additive registry) depends entirely on what triage finds — not assumed up front.

**Scope:**

- **SAM.gov FPDS contract awards**: Triage and configure at least one target in the **Market Conditions** section (per `docs/05-SOURCES.md` method) filtering for nuclear power generation (`naics_code`) and California (`place_of_performance.state`). Extract award amount, recipient, and agency. Market Conditions specifically, not Regulatory & Policy — M4's plan doc already committed this ("M5's SAM.gov work is what gives Market its substantive-content source"), and M4b gave Regulatory its own non-numeric content (`fr-nrc-smr`/`fr-doe-nuclear`'s title/type/date). Market Conditions is the only section still all-numeric (`eia-ca-industrial-price`'s `retail_price_industrial`/`price_period`); putting SAM.gov in Regulatory instead would leave this milestone's own exit criterion (below) unmet.
- **MARAD / Coast Guard maritime regulatory**: Triage one docket or regulatory guidance source relevant to floating power plants and port operations. Maritime regulatory approval is the actual path for BlueCore's Long Beach deployment; the dashboard has no source currently covering this.

**Testing approach:** Same as M4 — generalized `example-contracts-api` and `example-maritime-regulatory` fixtures in vitest; entity configs verified via `npm run fixture:verify`.

**Exit:** All four dashboard sections display ≥1 source extracting substantive, non-numeric content (title, description, agency, vendor). The regulatory gap (no maritime sources in M2) is closed. Standard verification passes.

**Impact on source inventory:** M4 + M5 complete `docs/05-SOURCES.md` across all four sections with sources exposing content, not just volume. This completes the source-quality gate for the first client deliverable (M5 exit = source quality ≥ threshold).

---

## M6 — Source quality: competitor depth & sector signal

Beyond M4+M5's completeness bar (every section has ≥1 substantive source) — this fills the remaining named-but-unfilled `SPEC.md` §3 sub-dimensions: "technology updates"/"supply chain bottlenecks" under Competitive Landscape, and "sector sentiment" under Market Conditions. Not required for the first client deliverable (that gate is M5's); this is depth beyond it.

**Scope:**

- **Competitor depth (`oklo-inc`, `nuscale-power`):** Triage and configure at least one additional source type about the two existing competitor entities — not new entities. Candidates to triage: patent filings (USPTO), investor-relations/press pages, technology-update announcements. Chosen per `docs/05-SOURCES.md` method; should extract substantive content the way M4b's SEC upgrade did, not just another count.
- **Sector sentiment (Market Conditions):** Triage a **documented** sentiment index or survey for the nuclear/advanced-energy sector — a real organization's already-published number or category, not a value computed in-app from scraped text. Two hard constraints from `SPEC.md` §2 rule out the latter: Zero-LLM Runtime (no LLM call during ingestion/transformation/rendering) and Deterministic Provenance (every block anchors to one raw value at one documented location, not a multi-source aggregate). If triage finds no such source for this sector, drop this scope item rather than force a fit.
- **Explicitly out of scope: Google Trends.** No official public API exists — every source triaged so far in this project is an official, documented API or a robots.txt-compliant page (SEC, Federal Register, EIA, Lever), and an unofficial/reverse-engineered endpoint conflicts with that bar and with the Deferred table's "robots.txt / ToS enforcement (Q6) — before any client deliverable" note. If search/attention-interest data is still wanted later, triage a documented alternative instead.

**Testing approach:** Same as M4/M5 — generalized, entity-agnostic fixtures in vitest per new source type; entity configs verified via `npm run fixture:verify`.

**Exit:** At least one new substantive, non-numeric source added to Competitive Landscape for an existing competitor. Market Conditions' sector-sentiment sub-dimension filled if triage finds a documented source (not a hard requirement — none may exist). Standard verification passes.

**Status:** Not started — more exploratory than M4/M5 at time of writing; neither the competitor-depth source nor a candidate sentiment index has been triaged yet. A future planning conversation should live-verify real candidates (same discipline as M4a/M4b: confirm the actual shape/API/documentation before writing config) before any implementation.

---

## Deferred

| Item                                                    | Trigger                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Second environment                                      | A second client — and it is the real ADR-001 test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| PDF extraction                                          | A triaged source (M0) is actually a PDF — write the handler per `02-CONFIG-SCHEMA.md` §7. No longer a stack question (ADR-010).                                                                                                                                                                                                                                                                                                                                                                                                     |
| Edge relay validation                                   | A source actually returns `BLOCKED` (ADR-006)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Time-series charts                                      | A client asks; the data model already supports it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Access control                                          | Whole-site magic-link auth (ADR-004). Required before charging a client.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Client-facing alerts                                    | After auth (ADR-004) — an alert carrying a value is a disclosure                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Git retention policy                                    | ~2,000 commits (Q7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| robots.txt / ToS enforcement (Q6)                       | Before any client deliverable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Analyst-facing health UX (Q4 SLA/UX half)               | Before first client deliverable, after auth (ADR-004). Rewritten health-modal copy, a tiered outage banner, an operator-written `outage.note` config field. **Re-scoped out of M3c 2026-09-14** — needs an actual analyst audience to design for; the full original spec is preserved in `docs/plans/m3-operability.md`'s M3c section.                                                                                                                                                                                              |
| `extractedAt` means "last changed", not "last verified" | If TTL/freshness tuning surfaces confusion. The ADR-011 fingerprint deliberately excludes timestamps, so a no-op re-verification still advances `extractedAt` (`src/ingest/process-extractor.ts`) — but a run that skips the commit entirely never publishes that advance, so a long-unchanged-but-still-passing value's displayed age can lag its true last-checked time. Noticed while investigating the Q4 safety half; not itself a defect, just a naming/documentation gap between Invariant 7's wording and what's published. |

---

## Critical path

```
M0.5 (engine spine) ──────────┐
                               ├──► M1 ──► M2 ──► M3 ──► M4 ──► M5 ──► first client (source quality gate) ──► M6 (depth, optional)
Q1 (source triage, M0) ────────┘

Auth (ADR-004, Deferred) ─────► required before charging a client
```

**Corrected 2026-09-12** — the original diagram chained `Q1 ──► M0 ──► M1` and read "everything hangs off Q1." That was wrong on the engine's own terms: ADR-001 requires the engine to work without knowledge of any specific client's sources, so an engine that cannot be built until the source list exists would be a defect, not a sequencing fact. M0.5 and M0/Q1 run **concurrently**; M1 is gated on the later of the two finishing. Q1 still gates M0, M1, M2, and the client deliverable — it was never optional, only mis-sequenced against the spine.

**2026-09-14 update:** M4 and M5 gate the first client deliverable (source quality: all four sections have substantive, non-metric sources). Auth (ADR-004) is deferred to Backlog; it is required before charging, not a pipeline prerequisite.

**2026-09-17 update:** M6 hangs off the gate, not into it — it adds depth (competitor breadth, sector sentiment if a documented source exists) beyond the four-section completeness bar M5 already satisfies. Nothing downstream is blocked on it.
