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

One real source, end to end, nothing mocked. Builds on M0.5's engine spine — this milestone is config, selectors, the frontend, and the two pieces the spine deliberately deferred: the SPA to render against, and the Cloudflare-Pages-preview stage of the gate (amended ADR-005).

Config → fetch → extract → validate → diff → commit → branch → preview → gate → merge → deploy → render → freshness badge → delta chip → provenance popover → health entry.

**Scope discipline:** one target, two or three extractors, one section. The other three sections render as zero-states — which also proves the zero-state path.

**Exit criteria:**
- A cron run updates a value in production with no human involvement.
- A deliberately broken selector produces a health entry, retains the cached value, and does **not** reach production.
- The freshness badge changes state as the clock advances (test with a fake clock).
- A value change produces a correct delta chip, including the unchanged case ("unchanged for N days") per `01-DATA-CONTRACT.md` §4.
- Re-running with unchanged source data produces no commit. *(ADR-011 / Invariant 7 — already verified offline in M0.5; this criterion re-proves it against the real deployed pipeline.)*
- The Cloudflare-Pages-preview smoke render (doc 03 §3 check 3) catches a case where data is schema-valid but the block count the UI renders disagrees with the block count published.

**Why this set:** each criterion exercises a decision made in the docs. If one can't be met, a doc is wrong, and it's better to learn that now.

---

## M2 — Breadth

Every triaged source configured. Mostly config plus fixtures plus tests; architecture should not move.

- All four sections populated.
- A fixture and unit test per target.
- Assertions tuned from dry-run values, not guesses.
- Weekly drift check running.

**Exit:** a full run completes with `ok` on the large majority, and the health modal honestly reports the rest.

**Watch for:** if this milestone requires application-code changes, ADR-001 is being violated and the schema needs to absorb the difference instead.

---

## M3 — Operability

The milestone that decides whether this is maintainable by one person.

- Alerting live (GitHub Issues, operator-only).
- Repair tooling: fixture capture, selector diff, LLM-proposed repair PRs (ADR-003).
- Health modal copy rewritten for analysts rather than developers.
- Six-weeks-broken UX resolved (Q4).
- Maintenance cost measured against the `06-OPS-RUNBOOK.md` §7 estimate.

**Exit:** a selector break goes from alert to merged fix in under 30 minutes.

---

## M4 — Access control

Whole-site magic-link auth (ADR-004).

**Gates the first real client deliverable.** Until this lands the deployment is public, which constrains what can be ingested at all.

Near-zero cost points to edge middleware plus signed cookies rather than a hosted identity vendor. Needs its own design pass.

---

## Deferred

| Item | Trigger |
|---|---|
| Second environment | A second client — and it is the real ADR-001 test |
| PDF extraction | A triaged source (M0) is actually a PDF — write the handler per `02-CONFIG-SCHEMA.md` §7. No longer a stack question (ADR-010). |
| Edge relay validation | A source actually returns `BLOCKED` (ADR-006) |
| Time-series charts | A client asks; the data model already supports it |
| Client-facing alerts | After M4 — an alert carrying a value is a disclosure |
| Git retention policy | ~2,000 commits (Q7) |
| robots.txt / ToS enforcement (Q6) | Before any client deliverable, deferred to M3/M4 by decision |

---

## Critical path

```
M0.5 (engine spine) ──────────┐
                               ├──► M1 ──► M2 ──► M3 ──► M4 ──► first client
Q1 (source triage, M0) ────────┘
```

**Corrected 2026-09-12** — the original diagram chained `Q1 ──► M0 ──► M1` and read "everything hangs off Q1." That was wrong on the engine's own terms: ADR-001 requires the engine to work without knowledge of any specific client's sources, so an engine that cannot be built until the source list exists would be a defect, not a sequencing fact. M0.5 and M0/Q1 run **concurrently**; M1 is gated on the later of the two finishing. Q1 still gates M0, M1, M2, and the client deliverable — it was never optional, only mis-sequenced against the spine.
