# 00 — Decision Log

Status of record for architectural decisions on Bluecore Watcher / CMIE.
Where this document and `SPEC.md` disagree, **this document wins** and SPEC.md is the bug.

Last updated: 2026-09-11

---

## Accepted

### ADR-001 — Bluecore Watcher is a reference implementation, not a one-off

**Decision.** Bluecore Energy is the first real deployment, but the engine is built to be re-pointed at any target from day one. Nothing entity-specific may be hardcoded in application or ingestion code.

**Consequences.**
- All entity, section, and source knowledge lives in config. Code contains zero references to "Bluecore".
- The config schema is a v1 deliverable, not an extraction from working code.
- Adding a second client should require: one config file, one secrets set, one deployment. If it requires a code change, that's a defect.
- Cost: some generality we may never use. Accepted deliberately.

### ADR-002 — Deltas and alerts are in v1

**Decision.** Each rendered block shows what changed and when. Watched values emit alerts when they move.

**Rationale.** Git already stores every version; the marginal cost of surfacing it is small. A dashboard that cannot answer "what moved since I last looked?" is a report, not a monitor.

**Consequences.**
- The data envelope carries a `delta` object per block — this is a schema commitment, see `01-DATA-CONTRACT.md`.
- Diffing needs a previous-value source of truth. We read the previous committed data file rather than walking Git history — simpler, and the file *is* the last known state.
- Alert noise becomes a real failure mode. Mitigated by per-extractor `alert.on` config and quiet periods.
- **Amends** the SPEC "Current-State Snapshot" principle, which excluded historical diffs from the UI. Deltas are in; commit timelines and time-series charts remain out.

### ADR-003 — LLMs allowed for authoring and repair, never in the data path

**Decision.** No LLM call may occur during ingestion, transformation, or rendering. LLMs may be used offline to draft extractor configs and to propose replacement selectors when one breaks, delivered as a reviewed pull request.

**Rationale.** The determinism claim is about the data path. Selector maintenance is the dominant operating cost and the LLM is genuinely good at it. Keeping the boundary at "proposes a diff a human merges" preserves the claim intact.

**Consequences.**
- "Zero-LLM Runtime" stays accurate and sellable.
- A repair tool is a legitimate roadmap item (fetch the broken page, propose candidate selectors, open a PR).
- Every LLM-proposed change must pass the same data validation gate as a hand-written one. No merge without a green preview.

### ADR-004 — Access control deferred, then whole-site email-link auth

**Decision.** v1 ships with no authentication. The eventual model is site-wide per-user access via emailed magic link — not per-entity permissions.

**Consequences.**
- Until auth lands, **treat the deployment as public.** Do not ingest anything that would be damaging if crawled. This constraint belongs in the source triage.
- Whole-site gating preserves the static architecture; per-user *data* permissions would not, and are explicitly out of scope.
- Magic-link auth at near-zero cost points to an edge-middleware + signed-cookie approach rather than a hosted identity vendor. Revisit when scheduled.
- **Risk accepted, not resolved.** Revisit before any real client data is loaded.

### ADR-005 — Ingestion runs on a branch, validates on preview, squash-merges to main

**Decision.** Each ingestion run creates a short-lived branch, pushes data commits to it, and is gated on a validated Vercel preview deploy before squash-merging into `main`. Production builds from `main`.

**Rationale.** Supersedes the SPEC's long-lived `data/latest` branch. A preview deploy is a free, real integration test: it proves the exact data files render in the exact application before they reach production.

**Consequences.**
- **The gate must actually gate.** A preview that nothing checks is ceremony. The merge blocks on JSON Schema validation plus a smoke render of the preview URL.
- `main` is always a snapshot that has been proven to render. A failed run leaves production untouched, serving the last good data — a strictly better failure mode than the SPEC's design.
- **Amends** SPEC Part 3 §5 and Part 5. The "avoid build thrashing" rationale is retired: data commits *do* land on `main` and *do* trigger a production build. For a static Vite SPA that build is cheap, and buying an integration test with it is a good trade.
- Runs must be serialized (single CI concurrency group) so each branch forks from current `main`.

### ADR-006 — Edge proxy retained as specified, pending investigation

**Decision.** Keep the edge-relay + pre-shared-key design in the architecture. Do not treat it as validated.

**Open concern.** Serverless egress is datacenter IP space; a source that blocks a CI runner will likely block it too. Until a source actually returns 403/429, we cannot know whether the relay solves a real problem. The hard constraint is near-zero cost, which rules out commercial residential proxy services.

**Consequences.**
- Every target config carries a `proxy` field so relaying is per-source, not global. Default `none`.
- Ingestion records a `BLOCKED` error class distinctly from generic HTTP failure, so we accumulate evidence about which sources actually need it.
- Decide for real after the first two weeks of live running.

### ADR-007 — Flat JSON in Git, with a stated scale ceiling

**Decision.** No database. Runtime state is flat JSON committed to the repository.

**Honest framing.** This is a database with no indexes and a slow write path. That is fine at the intended scale and stops being fine at a knowable point. Stating the ceiling now means we notice when we reach it instead of discovering it.

**Ceiling.** Comfortable through roughly 50 targets × 20 extractors × daily cadence for a single environment. Pressure appears as: clone times in CI, repo size, and the SPA fetching too many section files. Past that, the answer is a per-environment repo, not a database.

---

## Open

| # | Question | Blocks | Owner |
|---|---|---|---|
| Q1 | What is Bluecore Energy, and what are the actual source URLs? | `05-SOURCES.md`, all extraction work | Andrew |
| Q2 | What share of sources are PDFs or session-state web apps? If >30%, the Cheerio-first stack constraint is wrong. | Stack constraints, `02-CONFIG-SCHEMA.md` | Andrew |
| Q3 | Are silent-wrong guards (assertions, change-magnitude limits) in v1? Provisionally **yes** — designed into the schema, cheap to leave unused. | — | Provisionally resolved |
| Q4 | What is the honest weekly maintenance budget, and what does the client see when a source has been broken for six weeks? | Health UX, SLA language | Andrew |
| Q5 | Do alerts route to the operator or the client? Provisionally **operator only** in v1. | `06-OPS-RUNBOOK.md` | Provisionally resolved |
| Q6 | robots.txt and ToS posture. Needs a written position before any client deliverable. | Legal review | Andrew |
| Q7 | Git retention policy once commit count passes ~2,000. | — | Deferred |
| Q8 | Target time-to-stand-up-a-new-environment. Sets how much authoring tooling belongs in v1. | `07-ROADMAP.md` | Andrew |

---

## Rejected

- **Long-lived `data/latest` branch served at the origin root.** Vercel maps one branch per project to production; the SPEC's Part 5 assumed a capability that does not exist natively. Superseded by ADR-005.
- **Multi-tenant single deployment.** Contradicts the Single-Environment Scope principle and multiplies the auth problem. One environment, one config, one target set.
- **Frontend-first on hand-written fixtures.** Fast to demo, but tends to produce a data contract ingestion cannot satisfy. Superseded by the walking-skeleton milestone.
