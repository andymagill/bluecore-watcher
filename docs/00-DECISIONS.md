# 00 — Decision Log

Status of record for architectural decisions on Bluecore Watcher / CMIE.
Where this document and `SPEC.md` disagree, **this document wins** and SPEC.md is the bug.

Last updated: 2026-09-12

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
- Diffing needs a previous-value source of truth. We read the previous committed data file rather than walking Git history — simpler, and the file _is_ the last known state.
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
- Whole-site gating preserves the static architecture; per-user _data_ permissions would not, and are explicitly out of scope.
- Magic-link auth at near-zero cost points to an edge-middleware + signed-cookie approach rather than a hosted identity vendor. Revisit when scheduled.
- **Risk accepted, not resolved.** Revisit before any real client data is loaded.

### ADR-005 — Ingestion runs on a branch, validates on preview, squash-merges to main

**Decision.** Each ingestion run creates a short-lived branch, pushes data commits to it, and is gated on a validated preview deploy before squash-merging into `main`. Production builds from `main`. _(Host is Cloudflare, per ADR-013 — a preview deploy here means a Cloudflare Pages preview build, not Vercel's.)_

**Rationale.** Supersedes the SPEC's long-lived `data/latest` branch. A preview deploy is a free, real integration test: it proves the exact data files render in the exact application before they reach production.

**Consequences.**

- **The gate must actually gate.** A preview that nothing checks is ceremony. The merge blocks on JSON Schema validation plus a smoke render of the preview URL.
- `main` is always a snapshot that has been proven to render. A failed run leaves production untouched, serving the last good data — a strictly better failure mode than the SPEC's design.
- **Amends** SPEC Part 3 §5 and Part 5. The "avoid build thrashing" rationale is retired: data commits _do_ land on `main` and _do_ trigger a production build. For a static Vite SPA that build is cheap, and buying an integration test with it is a good trade.
- Runs must be serialized (single CI concurrency group) so each branch forks from current `main`.

**Staging note (added with ADR-010/011/012).** The gate is built in two stages, not delivered whole on day one. Schema validation and contract assertions (offline, no deploy dependency) land with the engine spine, before any real target exists. The smoke render against an actual Cloudflare Pages preview URL — which needs a Cloudflare API token, preview-URL resolution, and a deploy-ready wait — lands when the SPA exists to render, i.e. alongside the first real target. "`main` only contains data proven to render" holds at both stages; the second stage is what makes the proof cover the real deployed artifact rather than a local build.

### ADR-006 — Edge proxy retained as specified, pending investigation

**Decision.** Keep the edge-relay + pre-shared-key design in the architecture. Do not treat it as validated.

**Open concern.** Serverless egress is datacenter IP space; a source that blocks a CI runner will likely block it too. Until a source actually returns 403/429, we cannot know whether the relay solves a real problem. The hard constraint is near-zero cost, which rules out commercial residential proxy services.

**Consequences.**

- Every target config carries a `proxy` field so relaying is per-source, not global. Default `none`.
- Ingestion records a `BLOCKED` error class distinctly from generic HTTP failure, so we accumulate evidence about which sources actually need it.
- Decide for real after the first two weeks of live running.
- The relay is a Cloudflare Worker (ADR-013), not the "Vercel function" this ADR originally specified — same design (PSK header, per-target opt-in), different host.

### ADR-007 — Flat JSON in Git, with a stated scale ceiling

**Decision.** No database. Runtime state is flat JSON committed to the repository.

**Honest framing.** This is a database with no indexes and a slow write path. That is fine at the intended scale and stops being fine at a knowable point. Stating the ceiling now means we notice when we reach it instead of discovering it.

**Ceiling.** Comfortable through roughly 50 targets × 20 extractors × daily cadence for a single environment. Pressure appears as: clone times in CI, repo size, and the SPA fetching too many section files. Past that, the answer is a per-environment repo, not a database.

**Cost floor.** _(Corrected 2026-09-12 — the host is Cloudflare, not Vercel; ADR-013.)_ The previous version of this note cited Vercel's Hobby tier, which explicitly prohibits commercial use and would have forced a paid plan at M4. Cloudflare Pages' free tier does not carry that specific restriction as of this writing, but that has not been independently re-verified against Cloudflare's current terms of service for this project's actual usage pattern — do that check before treating M4 as cost-free, rather than relying on this note. "Near-zero cost" remains a claim relative to database and pipeline infrastructure, not a guarantee of literal zero at any scale.

### ADR-008 — Silent-wrong guards are in v1 (was Q3)

**Decision.** Shape assertions and change-magnitude guards ship in v1, not as a later hardening pass.

**Rationale.** They are designed into the schema already and cost nothing to leave unused on a target that doesn't need them. The alternative — bolting them on after the first silent-wrong incident — is strictly worse for a product whose pitch is determinism.

### ADR-009 — Alerts route to the operator only in v1 (was Q5)

**Decision.** All v1 alerting is operator-facing (GitHub Issues). No client-facing alert channel exists until ADR-004 (access control) lands.

**Rationale.** An alert carrying a value is a data disclosure through a channel that, pre-auth, has no access control. Client-facing alerting is listed in the roadmap's Deferred table, triggered by M4.

### ADR-010 — Extraction handlers are a registry; location fields are a discriminated union

**Decision.** `kind` maps to a handler module implementing a narrow interface (`parse` + `locate`, returning `rawText`, resolved `anchor`, and `matchCount`). Extractor location fields (`selector`/`attr` vs `jsonPath` vs future kinds) are a TypeScript discriminated union keyed on `kind`, not a flat bag of optional fields policed by a runtime rule.

**Rationale.** As specified, `ExtractorDef` mixed every kind's location fields into one type, with `02-CONFIG-SCHEMA.md` validation rule 6 enforcing agreement at runtime. That makes every new source kind an edit to the schema, the validator, _and_ the extract loop — which is exactly why PDF support (`02-CONFIG-SCHEMA.md` §7 as originally written) read as architecture-defining rather than as a deferred module. Narrowing, coercion, formatting, provenance, and hashing are kind-agnostic and live once in the shared pipeline; only location is kind-specific.

**Consequences.**

- v1 ships `html` and `api` handlers. `pageRange`/`textAnchor` are removed from the v1 schema, not sketched in it — see the rewritten `02-CONFIG-SCHEMA.md` §7, "Adding a source kind."
- A future `pdf` (or `xlsx`, or `session-app`) handler is a new module plus one union member. It touches no existing handler and requires no new ADR.
- **Neutralizes Q2.** Whatever share of sources turn out to be PDFs, the answer is "write that handler," not "reconsider the stack." Q2 is reclassified below from architecture-blocking to informational.

### ADR-011 — Commit on semantic change

**Decision.** A run in which no target changed **semantically** produces no commit and no branch. `01-DATA-CONTRACT.md` Invariant 7 is restated accordingly: determinism means a semantically-unchanged run writes nothing, not that timestamps never move.

**Rationale.** As originally written, Invariant 7 said both "timestamps are the only expected churn" and "an unchanged run produces a zero-line diff" — self-contradictory, since `extractedAt` must advance on every successful re-verification or the freshness state machine (`01-DATA-CONTRACT.md` §5) has no way to distinguish "verified an hour ago" from "verified 90 days ago and never checked since."

**Consequences.**

- Persist computes a **semantic fingerprint** per run: block `key` + `status` + `contentHash` + typed `value`, target-level `label`/`sourceUrl`/`ttlHours`, and the health entry set including `consecutiveFailures` — explicitly excluding `runId` and all timestamps.
- If every fingerprint matches the previous commit, the run exits 0 with no branch, exactly as `03-INGESTION.md` §2 step 4 already intends.
- Within a run that _does_ commit, timestamp-only movement on targets outside that run's queue is not expected — they stay byte-identical per `03-INGESTION.md` §1 persist.

### ADR-012 — Guard release via committed acknowledgements

**Decision.** A change guard (`maxChangePct`, `maxChangeAbs`, `expectMonotonic`) that trips on a **genuine** large move is released by adding an entry to a committed acknowledgements file, keyed by `targetId.extractorKey` plus the candidate's `contentHash`, single-use. The guard's configured tolerance is not touched.

**Rationale.** `06-OPS-RUNBOOK.md` §4 originally prescribed widening `maxChangePct` and re-running as the response to a real move. That permanently loosens the guard on every genuine step-change, so guards only ever get weaker over time — the opposite of the tuning discipline `01-DATA-CONTRACT.md` §6 asks for. An acknowledgement is a reviewed commit, preserving the audit trail, and lets exactly one candidate through without changing what the guard rejects next time.

**Consequences.**

- Widening `maxChangePct` remains the correct response to a guard that trips on _routine_ volatility it was tuned too tight for — that case is unchanged.
- `validate.ts` checks the acknowledgements file before quarantining a candidate; a match publishes the value and consumes the entry.

### ADR-013 — Host is Cloudflare, not Vercel

**Decision.** The deployment host is Cloudflare: Cloudflare Pages for the static SPA and its git-integrated preview deployments, Cloudflare Workers for the edge relay (ADR-006). Every prior reference to Vercel in this project's documents — ADR-005's preview-deploy mechanics, ADR-006's edge relay, ADR-007's cost-floor note, the ops runbook's deployment topology and secrets table, `SPEC.md` Part 5, and the README — described a host that was never an accepted decision.

**Correction, not addition.** This isn't a new architectural direction; it's fixing a fact that was wrong in every document that stated it. Cloudflare Pages' branch-to-deployment model is close enough to what ADR-005 already specifies (a branch push produces a preview URL; one branch — `main` — serves production; other branches don't) that none of ADR-005's mechanics need to change, only the vendor name and the specific secrets/tokens involved.

**Consequences.**

- Preview-URL resolution in the gate (`03-INGESTION.md` §3 check 3, still M1 scope) uses a Cloudflare API token, not `VERCEL_TOKEN`.
- The edge relay (ADR-006) is a Cloudflare Worker route, not a Vercel serverless function.
- The cost-floor claim in ADR-007 needs re-deriving against Cloudflare's actual terms, not assumed to carry over from the Vercel-specific finding it replaces — see that ADR's corrected note.
- Every doc that named Vercel (`03-INGESTION.md`, `06-OPS-RUNBOOK.md`, `07-ROADMAP.md`, `SPEC.md`, `README.md`) is corrected alongside this entry. If a future doc edit reintroduces "Vercel," that's the bug this ADR exists to prevent.

### ADR-014 — SPA host is a Cloudflare Worker (Static Assets + Workers Builds), not Pages

**Decision.** The static SPA is served from a Cloudflare Worker using the Workers Static Assets feature, deployed via Workers Builds' git integration — the Workers analog of Pages' git-integrated preview deployments. This supersedes ADR-013's assignment of "Cloudflare Pages for the static SPA."

**Rationale.** Cloudflare is phasing out Pages in favor of Workers as its unified platform for static and dynamic content. Workers Static Assets now covers what Pages did for a static build, and Workers Builds provides the same push → automatic build → per-branch preview-URL mechanic that ADR-005 depends on. Building the M1 deploy plumbing on Pages now would mean building on a path Cloudflare itself is retiring.

**Consequences.**

- ADR-005's mechanics are unchanged in substance — a branch push still produces a preview URL, one branch (production) serves the live site, other branches get their own preview — only the Cloudflare product providing it changes from Pages to Workers Builds.
- The repo needs a `wrangler.jsonc` (Workers require one; Pages' git integration didn't): `assets.directory` pointing at the Vite build output (`dist/`), a `compatibility_date`, and no `main` entry script needed for a pure static site.
- Preview-URL resolution in the gate (`03-INGESTION.md` §3 check 3) queries the Cloudflare API for the Workers Builds deployment tied to a given branch, not the Pages deployments endpoint ADR-013 implied.
- The edge relay (ADR-006) may end up as a route on this same Worker or stay a separate one — undecided, out of scope for M1; revisit when a source actually needs the relay.
- `06-OPS-RUNBOOK.md` §1's topology table and ADR-013's own consequences list are corrected alongside this entry, same pattern ADR-013 used for the Vercel→Cloudflare fix.

### ADR-015 — Prettier for formatting, ESLint kept for lint (not Biome)

**Decision.** Prettier owns formatting; ESLint (flat config, `eslint.config.js`) keeps owning lint, with `eslint-config-prettier` disabling the stylistic rules that would otherwise fight Prettier. Enforced via a husky pre-commit hook (`lint-staged` on staged files) and `.github/workflows/ci.yml` on every PR and push to `main`.

**Rationale.** `eslint.config.js` isn't lint fluff — its `no-restricted-imports` blocks are the mechanical enforcement of the ADR-010 boundary (`src/contract` depends on nothing internal; `src/app` cannot import `ingest`/`gate`; `ingest`/`gate` cannot import `app`; see `01-DATA-CONTRACT.md` §0). Migrating to Biome would mean porting those per-directory boundaries to Biome's config and re-proving each still fails on violation — a rewrite of the file that encodes the architecture, to remove a dependency that wasn't causing any actual pain. Reconsider Biome only if lint/format speed becomes a real problem.

**Consequences.**

- `.prettierignore` excludes three directories whose exact bytes matter: `schemas/*.json` (compared byte-for-byte by `npm run schema:check` against `scripts/schema-gen.ts`'s output), `public/data/**` (written by the ingest persist layer; reformatting fights ADR-011's semantic-diff), and `fixtures/**` (captured HTML/JSON golden test input — extraction tests assert exact selector/whitespace behavior against the real bytes).
- `.prettierrc.json` sets `endOfLine: "auto"` rather than Prettier's `"lf"` default: this repo has no `.gitattributes` pinning line endings, so on a checkout with `core.autocrlf=true`, `"lf"` would fight git's CRLF checkout and make `format:check` flap on every branch switch.
- §5's "runs in CI and as a pre-commit hook" claim for `npm run validate:config` is now literally true (`.husky/pre-commit` via `scripts/validate-staged-config.ts`; `.github/workflows/ci.yml`).
- `.github/workflows/ci.yml` is new — `.github/workflows/` previously contained only `ingest.yml` (the scheduled data pipeline), so no lint/typecheck/test/schema/config check ran on pull requests at all. The pre-commit hook is a bypassable convenience (`--no-verify`); CI is the actual gate.

---

## Open

| #   | Question                                                                                                                                                                          | Blocks                                                                                                                                                                                                                     | Owner    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Q1  | What is Bluecore Energy, and what are the actual source URLs?                                                                                                                     | `05-SOURCES.md`, M0–M2 config work and the client deliverable. **Does not block the M0.5 engine spine** — ADR-001 requires the engine to be source-independent, and M0.5 proceeds concurrently against a synthetic config. | Andrew   |
| Q2  | What share of sources are PDFs or session-state web apps?                                                                                                                         | Informational only as of ADR-010 — drives handler build order, no longer able to invalidate the stack constraint.                                                                                                          | Andrew   |
| Q3  | Silent-wrong guards in v1?                                                                                                                                                        | Resolved — **ADR-008**.                                                                                                                                                                                                    | Resolved |
| Q4  | What is the honest weekly maintenance budget, and what does the client see when a source has been broken for six weeks?                                                           | Health UX, SLA language                                                                                                                                                                                                    | Andrew   |
| Q5  | Do alerts route to the operator or the client?                                                                                                                                    | Resolved — **ADR-009**.                                                                                                                                                                                                    | Resolved |
| Q6  | robots.txt and ToS posture. Needs a written position before any client deliverable. **Deferred to M3/M4 by decision** — `respectRobotsTxt` keeps defaulting to `true` until then. | Legal review                                                                                                                                                                                                               | Andrew   |
| Q7  | Git retention policy once commit count passes ~2,000.                                                                                                                             | —                                                                                                                                                                                                                          | Deferred |
| Q8  | Target time-to-stand-up-a-new-environment. Sets how much authoring tooling belongs in v1.                                                                                         | `06-OPS-RUNBOOK.md` §8                                                                                                                                                                                                     | Andrew   |

---

## Rejected

- **Long-lived `data/latest` branch served at the origin root.** The static host (Cloudflare Pages, per ADR-013) maps one branch per project to production; the SPEC's Part 5 assumed a capability that does not exist natively. Superseded by ADR-005.
- **Multi-tenant single deployment.** Contradicts the Single-Environment Scope principle and multiplies the auth problem. One environment, one config, one target set.
- **Frontend-first on hand-written fixtures.** Fast to demo, but tends to produce a data contract ingestion cannot satisfy. Superseded by the walking-skeleton milestone.
