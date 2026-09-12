# Bluecore Watcher

A configurable market intelligence engine: a static dashboard that renders a verified, current-state operational snapshot of a target company, its segment, its regulatory landscape, and its market climate — with every number traceable to the exact page and DOM node it came from.

No database. No LLM in the data path. No hallucination surface.

**Status: pre-implementation.** The architecture is specified and the decisions are recorded. No code has been written. See [Current blockers](#current-blockers).

---

## How it works

A scheduled GitHub Action reads a config file describing *what to watch and where*, fetches each source, extracts values with rigid CSS selectors or JSON paths, validates them, and writes flat JSON files. Those files are committed to a short-lived branch, deployed to a preview URL, and merged to `main` only after proving they render correctly. The React SPA fetches them same-origin and computes freshness in the browser.

Git is the data warehouse, the audit trail, and the deployment trigger.

```
sources → ingest (cron) → validate → commit to branch → preview + gate → squash-merge → deploy
```

The property that matters: **`main` only ever contains data that has been proven to render.** A failed run leaves production serving the last verified snapshot rather than publishing something broken.

---

## Why not just use an LLM

Because a deal team cannot act on a number that might be invented. Every value here is the text of a specific DOM node on a specific page at a specific timestamp, and the interface shows you all three. When a selector breaks, the dashboard says so instead of guessing.

LLMs are used — offline, to draft extractor configs and propose replacement selectors as reviewed pull requests. They never touch the data path.

---

## Documentation

Read in order. `docs/00-DECISIONS.md` is the status of record; where it and `SPEC.md` disagree, the decision log wins.

| Doc | What's in it |
|---|---|
| [`SPEC.md`](SPEC.md) | Product canvas, positioning, competitive framing |
| [`docs/00-DECISIONS.md`](docs/00-DECISIONS.md) | ADR log — accepted, open, and rejected decisions |
| [`docs/01-DATA-CONTRACT.md`](docs/01-DATA-CONTRACT.md) | **Start here for implementation.** File layout, block envelope, provenance, freshness states, error taxonomy, invariants |
| [`docs/02-CONFIG-SCHEMA.md`](docs/02-CONFIG-SCHEMA.md) | TypeScript types, validation rules, annotated example |
| [`docs/03-INGESTION.md`](docs/03-INGESTION.md) | Orchestrator lifecycle, Git write protocol, the validation gate, testing |
| [`docs/04-FRONTEND.md`](docs/04-FRONTEND.md) | Component inventory, block states, provenance UI |
| [`docs/05-SOURCES.md`](docs/05-SOURCES.md) | Source inventory and triage method — **currently empty** |
| [`docs/06-OPS-RUNBOOK.md`](docs/06-OPS-RUNBOOK.md) | Deploy topology, secrets, failure runbooks, maintenance cost |
| [`docs/07-ROADMAP.md`](docs/07-ROADMAP.md) | Milestones M0–M4 with exit criteria |

`01-DATA-CONTRACT.md` constrains both the ingestion output and the React props. Change it deliberately; change it in one place.

---

## Design constraints

These are load-bearing. Violating one is a defect, not a trade-off.

- **Nothing entity-specific in code.** Adding a client is a config file, not a code change.
- **Freshness is computed at render time**, never baked into a build.
- **A failed run never destroys a good value.** It marks it cached and says why.
- **No value publishes that failed a hard assertion**, and a value that moves beyond its configured tolerance is quarantined for a human rather than published.
- **Deterministic serialization.** A run that changes nothing produces a zero-line diff.
- **Near-zero infrastructure cost.** Static CDN, a Git repo, and free-tier CI.

---

## Stack

React + Vite + Tailwind + shadcn/ui (static SPA) · Node.js + TypeScript (ingestion) · Cheerio primary, Playwright fallback · GitHub Actions · Vercel

---

## Current blockers

| # | Blocker | Impact |
|---|---|---|
| Q1 | The source inventory is empty | Blocks all extraction work — the engine is specified, its fuel is not |
| Q2 | Unknown share of PDF / session-state sources | Could invalidate the Cheerio-first stack constraint |
| Q6 | robots.txt and ToS posture unwritten | Needed before any client deliverable |

Full list in [`docs/00-DECISIONS.md`](docs/00-DECISIONS.md#open).

---

## Known gaps

- **No authentication.** v1 deploys public. Nothing damaging-if-crawled may be ingested until whole-site auth lands (ADR-004).
- **PDF extraction is sketched, not designed.** Deliberately deferred until the source triage says whether it matters.
- **The edge proxy is unvalidated.** It may not defeat the blocking it exists to prevent. Evidence is being gathered per-source (ADR-006).

---

## Getting started

Nothing to run yet. The first milestone is a walking skeleton — one real source driven end to end, from config through to a rendered value with a freshness badge and a delta chip. See [`docs/07-ROADMAP.md`](docs/07-ROADMAP.md).

It starts with filling in `docs/05-SOURCES.md`.
