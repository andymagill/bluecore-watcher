# 07 — Roadmap

Milestone shape was undecided. Recommending the **walking skeleton**, for a specific reason: every architectural mistake in this system is cheap to fix once and expensive to fix twenty times. One source driven all the way through finds them at N=1.

The alternative — building all four sections before showing anyone — compounds a wrong data contract across every scraper written under it. The frontend-first-on-fixtures path demos faster but reliably produces a contract ingestion cannot satisfy, which is why it's in the rejected list.

---

## M0 — Source triage

**Blocked on Q1.** Nothing else starts.

Populate `05-SOURCES.md`. Name the target. Pick the three facts that matter most to the reader.

**Exit:** the inventory table has rows, and the PDF share is known.

**Why first:** the PDF and session-app answers can invalidate the stack constraint. Finding that out now costs an afternoon; finding out in M2 costs a rewrite.

---

## M1 — Walking skeleton

One real source, end to end, nothing mocked.

Config → fetch → extract → validate → diff → commit → branch → preview → gate → merge → deploy → render → freshness badge → delta chip → provenance popover → health entry.

**Scope discipline:** one target, two or three extractors, one section. The other three sections render as zero-states — which also proves the zero-state path.

**Exit criteria:**
- A cron run updates a value in production with no human involvement.
- A deliberately broken selector produces a health entry, retains the cached value, and does **not** reach production.
- The freshness badge changes state as the clock advances (test with a fake clock).
- A value change produces a correct delta chip.
- Re-running with unchanged source data produces a zero-line diff. *(Invariant 7 — verify it early; retrofitting stable serialization is miserable.)*

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
| PDF extraction | Q2 says PDFs are a meaningful share |
| Edge relay validation | A source actually returns `BLOCKED` (ADR-006) |
| Time-series charts | A client asks; the data model already supports it |
| Client-facing alerts | After M4 — an alert carrying a value is a disclosure |
| Git retention policy | ~2,000 commits (Q7) |

---

## Critical path

```
Q1 ──► M0 ──► M1 ──► M2 ──► M3 ──► M4 ──► first client
                              │
                   Q2 ────────┘  (may fork the stack constraint)
```

Everything hangs off Q1. The docs are as far as this can go without the source list.
