# Bluecore Watcher

A configurable market intelligence engine: a static dashboard that renders a verified, current-state operational snapshot of a target company, its segment, its regulatory landscape, and its market climate — with every number traceable to the exact page and DOM node it came from.

No database. No LLM in the data path. No hallucination surface.

**Status: implementation started.** The architecture is specified, the decisions are recorded, and the doc-level contradictions found in review are closed. M0.5 (the source-independent engine spine — contract layer, config validator, extraction handlers, offline gate) is underway on `feature/m0.5-engine-spine`, concurrently with source triage. See [Current blockers](#current-blockers).

---

## How it works

A scheduled GitHub Action reads a config file describing _what to watch and where_, fetches each source, extracts values with rigid CSS selectors or JSON paths, validates them, and writes flat JSON files. Those files are committed to a short-lived branch, deployed to a preview URL, and merged to `main` only after proving they render correctly. The React SPA fetches them same-origin and computes freshness in the browser.

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

| Doc                                                    | What's in it                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| [`SPEC.md`](SPEC.md)                                   | Product canvas, positioning, competitive framing                                                                         |
| [`docs/00-DECISIONS.md`](docs/00-DECISIONS.md)         | ADR log — accepted, open, and rejected decisions                                                                         |
| [`docs/01-DATA-CONTRACT.md`](docs/01-DATA-CONTRACT.md) | **Start here for implementation.** File layout, block envelope, provenance, freshness states, error taxonomy, invariants |
| [`docs/02-CONFIG-SCHEMA.md`](docs/02-CONFIG-SCHEMA.md) | TypeScript types, validation rules, annotated example                                                                    |
| [`docs/03-INGESTION.md`](docs/03-INGESTION.md)         | Orchestrator lifecycle, Git write protocol, the validation gate, testing                                                 |
| [`docs/04-FRONTEND.md`](docs/04-FRONTEND.md)           | Component inventory, block states, provenance UI                                                                         |
| [`docs/05-SOURCES.md`](docs/05-SOURCES.md)             | Source inventory and triage method — **currently empty**                                                                 |
| [`docs/06-OPS-RUNBOOK.md`](docs/06-OPS-RUNBOOK.md)     | Deploy topology, secrets, failure runbooks, maintenance cost                                                             |
| [`docs/07-ROADMAP.md`](docs/07-ROADMAP.md)             | Milestones M0–M4 with exit criteria                                                                                      |

`01-DATA-CONTRACT.md` constrains both the ingestion output and the React props. Change it deliberately; change it in one place.

---

## Design constraints

These are load-bearing. Violating one is a defect, not a trade-off.

- **Nothing entity-specific in code.** Adding a client is a config file, not a code change.
- **Freshness is computed at render time**, never baked into a build.
- **A failed run never destroys a good value.** It marks it cached and says why.
- **No value publishes that failed a hard assertion**, and a value that moves beyond its configured tolerance is quarantined for a human rather than published.
- **Deterministic serialization.** A run in which nothing changed semantically produces no commit at all (ADR-011).
- **Near-zero infrastructure cost, relative to the alternatives.** Static CDN, a Git repo, and free-tier CI. Host is Cloudflare (ADR-013); the real cost floor at the first client deliverable (M4) is unverified against Cloudflare's current terms (ADR-007).

---

## Stack

React + Vite + Tailwind + shadcn/ui (static SPA) · Node.js + TypeScript (ingestion) · Cheerio primary, Playwright fallback · GitHub Actions · Cloudflare Workers + Workers

---

## Current blockers

| #   | Blocker                              | Impact                                                                                                                                                            |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | The source inventory is empty        | Blocks M0–M2 config work and the client deliverable. **Does not block the engine spine** (M0.5) — that runs concurrently against a synthetic config, per ADR-001. |
| Q6  | robots.txt and ToS posture unwritten | Needed before any client deliverable. Deferred to M3/M4 by decision.                                                                                              |

Q2 (PDF / session-state share) is resolved as informational, not blocking — ADR-010 made source kinds additive, so no share of PDFs can invalidate the stack. Full list in [`docs/00-DECISIONS.md`](docs/00-DECISIONS.md#open).

---

## Known gaps

- **No authentication.** v1 deploys public. Nothing damaging-if-crawled may be ingested until whole-site auth lands (ADR-004).
- **PDF extraction is unbuilt, not undesigned.** The extraction layer is a handler registry (ADR-010); a `pdf` handler is additive whenever a triaged source needs one — see `02-CONFIG-SCHEMA.md` §7.
- **The edge proxy is unvalidated.** It may not defeat the blocking it exists to prevent. Evidence is being gathered per-source (ADR-006).

---

## Getting started

M0.5 (engine spine) is in progress — see [`docs/07-ROADMAP.md`](docs/07-ROADMAP.md). It builds the contract layer, config validator, and `html`/`api` extraction handlers against a synthetic config, proven with an offline dry run. No cron, no real target, no deploy yet.

The walking skeleton (M1) — one real Bluecore source driven end to end, with a freshness badge and a delta chip in production — starts once both M0.5 and `docs/05-SOURCES.md` are done. Filling in that source inventory is the other concurrent track.
