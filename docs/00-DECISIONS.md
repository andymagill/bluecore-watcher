# 00 — Decision Log

Status of record for architectural decisions on Bluecore Watcher / CMIE.
Where this document and `SPEC.md` disagree, **this document wins** and SPEC.md is the bug.

Last updated: 2026-09-17

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

**Cost floor.** _(Corrected 2026-09-12 — the host is Cloudflare, not Vercel; ADR-013.)_ The previous version of this note cited Vercel's Hobby tier, which explicitly prohibits commercial use and would have forced a paid plan at the first client deliverable. Cloudflare Pages' free tier does not carry that specific restriction as of this writing, but that has not been independently re-verified against Cloudflare's current terms of service for this project's actual usage pattern — do that check before treating it as cost-free, rather than relying on this note. "Near-zero cost" remains a claim relative to database and pipeline infrastructure, not a guarantee of literal zero at any scale.

### ADR-008 — Silent-wrong guards are in v1 (was Q3)

**Decision.** Shape assertions and change-magnitude guards ship in v1, not as a later hardening pass.

**Rationale.** They are designed into the schema already and cost nothing to leave unused on a target that doesn't need them. The alternative — bolting them on after the first silent-wrong incident — is strictly worse for a product whose pitch is determinism.

### ADR-009 — Alerts route to the operator only in v1 (was Q5)

**Decision.** All v1 alerting is operator-facing (GitHub Issues). No client-facing alert channel exists until ADR-004 (access control) lands.

**Rationale.** An alert carrying a value is a data disclosure through a channel that, pre-auth, has no access control. Client-facing alerting is listed in the roadmap's Deferred table, triggered by auth (ADR-004).

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

### ADR-016 — Design tokens (tweakcn export), permanently dark, no `cn()`

**Decision.** `src/app/styles.css` carries a full shadcn-style token layer generated by tweakcn (Tailwind v4 `@theme inline` syntax: background/foreground/card/popover/primary/secondary/muted/accent/border/input/ring/chart-1..5, radius, shadow scale), replacing the single hardcoded `body { background-color: #0b0d10; color: #e6e6e6 }` rule that previously supplied the app's entire look. Components reference these tokens (`bg-muted`, `text-destructive`, etc.) instead of hardcoding Tailwind palette classes. The app still ships permanently dark (`class="dark"` hardcoded on `<html>`, no toggle) — only the print stylesheet ever renders the light half of the theme.

**Deviations from the tweakcn export**, so a future regeneration doesn't silently reintroduce them:

- `--destructive` is overridden in both themes, regardless of what a given export hands back. It's been unusable both times this theme was regenerated (2026-09-13): first a bright yellow-green with near-white text that failed the 4.5:1 contrast bar (`04-FRONTEND.md` §7), then a value identical to `--primary`. Replaced with an actual red in both themes.
- `--success` and `--warning` were added (shadcn's set has neither) with per-theme foregrounds, needed by `FreshnessBadge` (five states) and `HealthPill` (ok/degraded/failed).
- `--sidebar-*`, `--secondary`/`--secondary-foreground`, and `--input` are dropped: no sidebar, no secondary buttons, and no form inputs exist in this app. Grep the component tree for the actual Tailwind utility classes (`bg-secondary`, `border-input`, etc.) before reintroducing any of these on a future regeneration — presence in the export isn't evidence they're used.
- `--card`/`--card-foreground` are kept despite the same "is it used" test the others failed above, because they're wired into `TargetCard` — the one surface in this app that wants to sit visually above the page.
- The export's `--font-sans: Geist Mono` is overridden — see Fonts below.
- `chart-1..5` backs `StatusBlock`'s hash-indexed pill colours and nothing else. It's the only token family in the set that's genuinely non-semantic; mapping any state colour (freshness, health, run status) onto it would make that colour's meaning depend on tweakcn's arbitrary chart ordering.

**Fonts.** Geist Sans and the export's chosen monospace face (JetBrains Mono originally, Space Mono as of the 2026-09-13 palette refresh) are self-hosted via `@fontsource*` (imported in `main.tsx`), not linked from Google Fonts. The smoke gate (`src/gate/smoke-render.ts`) waits on `networkidle` and fails on any console error, so a third-party font request during CI or preview is an avoidable extra failure mode; this is also a diligence tool opened inside client networks with egress restrictions. `--font-sans` is set to Geist **Sans**, not Geist Mono as the export specifies — the export's choice makes the entire UI monospace (headings and markdown prose included), which favors the dense numeric look at the cost of prose readability. The export's `--font-mono` choice is followed as-is and backs values, anchors, and raw provenance text; whichever face that is, install its actual `@fontsource` package (`@fontsource-variable/*` if the face has a variable axis, `@fontsource/*` — static weights only — otherwise, as with Space Mono) rather than just updating the CSS string, or the declared font silently falls back to the browser's default monospace.

**No `cn()` / `clsx` / `tailwind-merge`.** `tailwind-merge` resolves conflicts when a parent overrides a child's `className`; no component in this app accepts a `className` prop, so there's nothing to merge. Revisit if shadcn CLI components are ever vendored — those hard-require `cn()` and `cva`.

**Consequences.**

- `@theme inline` (not `@theme`) is load-bearing: dropping `inline` would make Tailwind resolve token utilities to literals at build time, silently breaking the `.dark` override.
- The print stylesheet (`@media print` in `styles.css`) forces the light values of `--background`/`--foreground`/`--card`/`--popover`/`--muted`/`--border`/`--accent` regardless of the active theme, and strips freshness/delta badge tints down to an outline — `04-FRONTEND.md` §7's "legible in greyscale" requirement. Other tokens (`--success`, `--warning`, `--destructive`, `--chart-*`) are not forced light in print and keep whichever theme's values are active; since the app never removes `.dark`, these badges print with a faint dark-theme tint rather than a fully forced light one. Verified legible in practice; revisit if a real diligence-memo screenshot disagrees.
- `@tailwindcss/typography` was installed to back `MarkdownBlock`'s `prose` classes, which had been dead since M1 (the plugin was never installed; markdown rendered with zero prose styling). The token-to-`--tw-prose-*` wiring in `styles.css` is deliberately **unlayered** — the plugin's own colour defaults live in Tailwind's `utilities` layer, which outranks `@layer base` regardless of source order, so a layered override would have silently lost to the plugin's literal colours.
- `04-FRONTEND.md` §3's freshness-state table and `.tabular-nums` rule cross-reference are updated to name tokens instead of raw colours.

---

### ADR-017 — Date coercion is anchored to UTC, independent of the host's timezone

**Decision.** `src/ingest/extract/coerce.ts`'s `date` case no longer trusts `new Date(rawText).toISOString()` (or, with `dateFormat` set, date-fns's `parse()`) to produce a host-independent result. Both resolve an unqualified date/time string — a human-readable page date like `"September 8, 2026"`, or a `dateFormat` pattern with no zone token — against the **host's local timezone**, not UTC. The committed `value` for `bluecore-newsroom.latest_post_date` (and any future `dateFormat` target) therefore depended on which machine or CI runner produced it: a UTC-7 laptop and a UTC GitHub Actions runner would coerce the same rawText to instants 7 hours apart, which is a spurious semantic change under ADR-011 / Invariant 7 (two runs against unchanged source data must agree) — and would have been baked permanently into the M2a golden fixture files. `formatDisplayValue`'s `date` case had the mirror bug: it re-parsed the already-UTC ISO `value` with date-fns's local-zone `format()`, so a UTC-midnight value could **display** as the previous day west of Greenwich.

Fixed by re-anchoring: after parsing, an explicit `dateFormat` is always re-anchored (date-fns has no zone-token support, so it never resolves a zone correctly); the no-`dateFormat` path is re-anchored only when `rawText` carries no zone information at all — an ISO date-only string (`"2026-09-11"`) is already UTC by spec, and a string with an explicit offset/`Z`/`GMT` was already resolved correctly, so re-anchoring either of those would double-shift a value that was already right. Display now reads the stored ISO instant back with UTC getters instead of date-fns's local-zone `format()`.

**Why this belongs in the M2a coverage PR, not a separate change.** M2a introduces golden fixture files (`fixtures/<id>/expected.json`) as the mechanism enforcing "a fixture and unit test per target" (`07-ROADMAP.md` M2). A golden file pins a value forever; pinning a timezone-dependent value would have made the bug permanent and machine-specific across every future CI run and contributor's laptop.

**Consequences.** `bluecore-newsroom`'s committed `latest_post_date` value/`displayValue` for existing runs may shift, depending on the timezone the original commit was produced in — expected and desired, not a regression. `vitest.config.ts` (new; previously nonexistent, so vitest implicitly fell back to `vite.config.ts` for its React/Tailwind plugins — now explicitly re-imported via `mergeConfig`) additionally pins `TZ=UTC` for the test run as a belt-and-braces measure so a non-UTC dev machine's `npm test` agrees with CI; that pin is not itself the fix and does not mask it — `tests/pipeline.test.ts`'s regression tests explicitly override `process.env.TZ` to a non-UTC zone to prove the coercion logic is correct regardless of ambient TZ.

---

### ADR-018 — `type: "date"` gets its own shape assertions and guard, and no-op assert combinations are rejected at config time

**Decision.** Before this, a `type: "date"` extractor had **zero** silent-wrong protection: `checkScalarShape` (`01-DATA-CONTRACT.md` §6 layer 1) only evaluates `min`/`max` under a `typeof value === "number"` guard, and a coerced date is always a string (`coerce.ts`); `checkScalarGuard` (layer 3) likewise returns `null` unless both the candidate and the previous value are numbers. `bluecore-newsroom.latest_post_date` and both `*-sec-filings.latest_filing_date` extractors carried only `assert: { notEmpty: true }` — which rejects an empty string, and nothing else. A selector that started resolving to the wrong node but still produced _some_ parseable date string would publish silently.

Two additions close this, both `type: "date"`-only:

- `AssertDef.maxFutureDays` (shape) — reject a value later than `now + N` days. Catches a selector that lands on a "scheduled" or placeholder date.
- `AssertDef.notBefore` (shape) — reject a value earlier than a fixed floor date. Catches a selector that regresses to a stale or unrelated node.
- `expectMonotonic` (existing guard field) now also applies to dates — `process-extractor.ts` converts an ISO instant to epoch milliseconds before calling the same `checkScalarGuard` a numeric extractor uses, so "this source's dates only move forward" is enforceable the same way "this count only increases" already was. `maxChangePct`/`maxChangeAbs` deliberately stay numeric-only — a percentage change between two instants isn't a meaningful quantity — so a date extractor's guard vocabulary is `expectMonotonic` alone.

Because `checkShapeAssertions` needed a clock for `maxFutureDays`, it now takes `now: Date` as a parameter — `processExtractor` already carries one (its own `now` param), and `maxFutureDays`'s asymmetry keeps this compatible with ADR-011: it only ever rejects, and a rejection can flip to a pass as the clock advances (the value is no longer "in the future") but never the reverse, so a value that published once can't later be invalidated by the same clock movement.

**Rule 8 also grew a general no-op check.** Before this, config validation would silently accept e.g. `min: 0` on a `type: "string"` extractor — a config author could reasonably believe the value was bounded when `checkScalarShape`'s numeric guard meant it never was. Every `assert` field is now checked against the extractor's `type`/`presenter` and rejected if it can never fire: `min`/`max` need a numeric type; `pattern`/`maxLength` need a string-like type or presenter `"list"` (per-item, per the existing list semantics); `maxChangePct`/`maxChangeAbs` need a numeric type or `"list"` (item count); `expectMonotonic` needs numeric, `"date"`, or `"list"`; `maxFutureDays`/`notBefore` need `"date"`. `notEmpty` is intentionally left unrestricted — it was already harmlessly inert on a numeric type before this change (e.g. `eia-ca-industrial-price.retail_price_industrial` combines it with `min`/`max`), and narrowing it now would break a currently-valid, currently-correct config for no safety gain.

**Why this is a schema change, not a config change.** `07-ROADMAP.md`'s M2 "Watch for" line: "if this milestone requires application-code changes, ADR-001 is being violated and the schema needs to absorb the difference instead." A date extractor with no usable guard is a gap in what the engine can express, independent of which client's dates are involved — the fix has to live in the schema/validator, not in any one target's config.

---

### ADR-019 — Alerts are dispatched from a diff of two committed states, not a run artifact

**Decision.** `03-INGESTION.md` §4 originally specified alerting "dispatched post-merge, from the run artifact" — a run-scoped object nothing in the codebase ever produced. M3a implements alerting instead as a diff of `public/data` as committed at two git shas: the ingest job's base commit (`main`'s `HEAD` before the run touched anything) and the commit the squash-merge just produced. `scripts/alert-dispatch.ts --env <id> --from <sha> --to <sha> --issues` runs inside the same job, immediately after the merge, and hands both states — loaded via `src/ingest/persist.ts`'s `loadPreviousState`, now generalized to take a pluggable `StateReader` rather than only a filesystem path — to `src/alerts/plan.ts`'s `planAlerts()`, a pure function evaluated against config.

**Rationale.** A "run artifact" implies alerting logic threaded through the orchestrator itself, coupling it to the exact shape of one run's in-memory state. Diffing two _committed_ states instead means: the dispatcher is a standalone script the ingest workflow calls once, after the merge (so a run that fails its gate never alerts on data that never reached `main` — `03-INGESTION.md` §4's own stated invariant); the same diff can be replayed offline against any two shas in git history, for testing, without a live run; and `StateReader` is generic enough that a `git show`-backed reader (this) and a filesystem reader (every existing caller) are the same fifteen lines of code, not two parallel implementations.

**Consequences.**

- GitHub Issues are the entire alert state store — no new database, no run-artifact file format to design or version. Health alerts are one issue per `targetId`; value alerts are one issue per `targetId.extractorKey`; both dedup by title (`Health: <targetId>` / `Alert: <targetId>.<extractorKey>`) and reopen a closed issue rather than duplicating it.
- Pipeline-gate failures (the offline gate, or the live gate against the preview) are a third, independent case: one deduped `Pipeline: ingestion gate failed` issue, replacing the previous per-run `gh issue create` in `.github/workflows/ingest.yml` that made a week-long outage open 7 separate issues.
- `alert.thresholdPct` gets the same no-op-field validation ADR-018 gave `assert` fields: it only means something when `alert.on` is `"threshold"`, against a numeric type or `presenter: "list"`. `alerting.channel` is restricted to `"github-issue"` at config time — `"webhook"`/`"email"` stay documented union members with no dispatcher, so selecting either today would be a config field that reads as configured and silently does nothing.
- A change-guard warning (`Validation.warnings[]`, `01-DATA-CONTRACT.md` §4) grew `rejectedContentHash` — the ADR-012 acknowledgement key an operator previously had to re-derive by re-running ingestion locally — so a guard-trip alert's body can carry a paste-ready acknowledgement entry.
- Full design and the remaining M3 workstreams (repair tooling — delivered, M3b; the failing-data safety valve resolving Q4's safety half — delivered, ADR-020; the fire-drill exit proof, M3d) are tracked in `docs/plans/m3-operability.md`. Q4's SLA/UX half (analyst-facing copy) is deferred past M3 — see `07-ROADMAP.md` Deferred.

### ADR-020 — A failure-age ceiling, independent of `ttlHours`, closes Q4's safety gap (M3c)

**Decision.** `computeFreshness` (`01-DATA-CONTRACT.md` §5) gets a second, independent path to `expired`: a `cached` (failing) block whose failure has run longer than a failure-age ceiling (default 14 days) is `expired` regardless of `ttlHours`. `Block` grows `failingSince` — the instant a block first turned `cached`, carried forward unchanged on every subsequent failing run, reset to `null` on recovery — so the client doesn't need to join `health.json` to blocks to get it. `TargetFile` grows `staleCeilingHours`, resolved server-side from `schedule.staleCeilingHours` (per-target override) or `environment.staleCeilingMultiplier × ttlHours` (the default), so those two config fields — previously validated but never published or consumed — actually take effect.

**Rationale.** `block.provenance.extractedAt` freezes at the _last successful_ extraction, so the existing ttl-based ceiling (`age > ttlHours × 3`) only fires that long _after_ the last success. For a short-TTL target this is fine. For a long-TTL target — `ttlHours: 2160` (90 days), a real shape in this codebase — a selector that breaks immediately and stays broken would keep rendering its stale value as `failing` (not `expired`) for roughly 270 days before the ttl-based ceiling ever caught it. That is the exact "six-weeks-broken" scenario Q4 asked about, just with a bigger number, and it's independent of any analyst-facing UI question — a wrong-looking-current value is a defect regardless of who's looking at the dashboard.

**Why this is M3c, not M3d or later.** Everything else originally scoped into M3c (analyst copy, an outage banner, `HealthModal` rewrite, an `outage.note` config field) needs an actual analyst audience to design for, and that audience doesn't exist until auth ships — see the M3c re-scope note in `07-ROADMAP.md`'s M3 section and Deferred table. This fix needs no audience: it's a data-correctness gap regardless of who's looking, so it stays in M3.

**Consequences.**

- `Block.failingSince` and `TargetFile.staleCeilingHours` are both optional on their schemas, following the ADR-019 `rejectedContentHash` precedent — a target file or block committed before this ADR still validates, and `computeFreshness` falls back to the pre-M3c 3x-multiplier behavior when either is absent.
- `computeFreshness`'s `staleCeilingHours` input (the resolved, absolute number) takes precedence over the pre-existing `staleCeilingMultiplier` input when both are given, so the M1-era test suite reasoning in multiplier terms keeps working unchanged.
- The failure-age ceiling (14 days) is a code default, not a config field — no target has yet needed to override it, so no schema surface was added for it ahead of a real need (ADR-018's no-op-field principle, applied in the opposite direction: don't add a knob nothing turns).
- `computeFingerprint` (`03-INGESTION.md` §1 persist) gained `staleCeilingHours` — a config-only edit to it or its inputs must still produce a commit, the same class of bug ADR-011's fingerprint exists to prevent elsewhere. `failingSince` was deliberately _not_ added to the fingerprint: it only ever changes in lockstep with `block.status`, which the fingerprint already tracks, so adding it would be redundant.
- Resolves the safety half of Q4 (`00-DECISIONS.md` Open Questions). The SLA/UX half stays open, deferred pending auth (ADR-004).

---

### ADR-021 — ADR-001 purity extends to `tests/`, not just `src/`

**Decision.** `tests/adr001-no-bluecore.test.ts` mechanically enforces ADR-001 for `src/` — no engine file may mention "bluecore" (case-insensitive). That guard now also scans `tests/`. No test file may import `config/bluecore.config.ts`, a real target's fixture, or otherwise reference "bluecore" in code, strings, or comments. Real-config/real-fixture validation moves entirely to the ops layer — scripts that already run in CI outside `vitest run` (`npm run validate:config`, `npm run drift`, `npm run ingest -- --dry`, and a new `npm run fixture:verify`) — rather than living in the unit test suite.

**Rationale.** As the project moved from M0.5 (engine spine, proven against a synthetic `config/example.config.ts`) into M1–M3, five test files started importing the real `config/bluecore.config.ts` directly — `targets.baseline.test.ts`, `bluecore-newsroom.integration.test.ts`, `drift.test.ts`, `repair.test.ts`, `config-coverage.test.ts` — and two more leaked "bluecore" into mock data or comments as flavor text. None of the underlying concerns are source-specific: selector-failure handling, drift-shape detection, repair scoring, and config-completeness rules are all generic engine behavior that happened to get coupled to the real config for expedience. That coupling is exactly what ADR-001 already forbids in `src/`; this closes the same gap in `tests/`.

**Consequences.**

- `config-coverage.test.ts` is deleted — its entity-resolution check duplicated `config-schema.test.ts`'s generic Rule 2 coverage; its fixture-existence check is absorbed by the new `fixture:verify` script below (a missing golden file is still a hard failure, just reported there instead); its section-completeness check ("every section has ≥1 target") was a one-time-per-deployment fact, not a general invariant (zero-state sections are explicitly supported — `SPEC.md` Part 4 §1), and moves to a manual onboarding step in `06-OPS-RUNBOOK.md` §10.
- `targets.baseline.test.ts` is deleted from `vitest`; both of its checks (a golden file exists and its extraction matches) become `scripts/fixture-verify.ts` / `npm run fixture:verify`, parameterized by `--env` like every other ops script, run as its own CI step.
- `drift.test.ts` and `repair.test.ts` are rewritten to use synthetic fixtures shaped like the real edge cases (a key removed, a type changed, a class renamed) instead of the real config/fixtures — the same treatment `orchestrate-fetch-failure.test.ts` and `alerts.test.ts` already give comparable engine logic.
- `bluecore-newsroom.integration.test.ts` is deleted; the two invariants it proved that existed nowhere else (required-selector-failure retention per Invariant 1, and `delta.changedAt` persist-layer lifecycle) move to a new synthetic-config test, `orchestrate-selector-failure.test.ts`.
- **Exception:** `resolve-preview-url.test.ts` stays excluded from the guard. It asserts against the real, committed `wrangler.jsonc` and hardcodes the literal Worker/repo name `bluecore-watcher` — that's this repo's own deployment identity (one Worker per repo, like `package.json`'s `name` field), not multi-tenant source/client configuration, and a different axis from what ADR-001 governs.
- Onboarding a second environment (`06-OPS-RUNBOOK.md` §10, the real ADR-001 test) now needs zero new or modified test files — every test in `tests/` already runs against whatever config an implementer points the ops scripts at.

### ADR-022 — Composite/indexed `api` locations (M4a)

**Decision.** An `api` location (`02-CONFIG-SCHEMA.md` §3) is either the original simple shape (`jsonPath`, one value) or a new composite shape: `fields` (a name-keyed map of JSONPath reads, each with optional `strip`/`split`/`valueMap`/`join`/`escape` transforms) plus `template` (a markdown string filling `{name}` placeholders), optionally preceded by `index` (one JSONPath resolving to an integer row position, substituted into every field's `{index}` token before it runs). Both shapes live on one `ApiLocation` object — mutual exclusivity and internal consistency (every template name is a field and vice versa, `index`/`{index}` usage agrees, `join` requires `split`, a composite location is always `presenter: "markdown"`/`type: "markdown"`) are enforced by a new validation rule 13, not by a second discriminated-union branch.

**Rationale.** M4 (`07-ROADMAP.md`) needs the SEC targets to extract a filing's `items` and primary document alongside its form code and date, not just the two scalar facts M2 shipped. `filings.recent` is SEC's real shape: parallel arrays (`form[i]`, `filingDate[i]`, `items[i]`, ...), newest-first, with no guarantee the row of interest sits at index 0 — verified live, Oklo's `form[0]` is a `424B5`, and its most recent 8-K is at `form[1]`. A plain `jsonPath` can find _which_ index matches a filter (`$.filings.recent.form[?(@ === "8-K")]~` resolves to the matching indices), but JSONPath has no join operator to bind that index into a sibling array's read — confirmed live: a filter expression referencing `@root` inside a predicate throws in jsonpath-plus's safe-eval sandbox. Something has to do that binding, and a per-target script would violate ADR-001 (entity-specific code) the same way a hardcoded PDF handler would have.

A second discriminated-union branch on the same `kind: "api"` literal isn't available — `z.discriminatedUnion` requires a distinct value per branch, and `kind` is already the union's only discriminant (ADR-010). Rather than add a second discriminant field just to route between two `api` shapes, both stay on one object with a `.check()`-based mutual-exclusivity rule (the same mechanism rule 8's no-op-field checks already use).

**Consequences.**

- `src/ingest/extract/api-handler.ts`'s `locateComposite` resolves `index` (`SELECTOR_NO_MATCH` on zero matches, `PARSE_ERROR` on a non-integer), substitutes it into every field's `jsonPath`, and requires each field to match exactly once (`SELECTOR_NO_MATCH`/`SELECTOR_AMBIGUOUS` otherwise, naming the field — the same defence-in-depth rule 01-DATA-CONTRACT.md §6 layer 2 already applies to a scalar location, now per-field).
- `src/ingest/extract/compose.ts` is pure and kind-agnostic (strip → split → valueMap → join → escape per field, then template fill) — a future handler needing the same shape reuses it, same ADR-010 spirit as the shared pipeline.
- **Provenance asymmetry, deliberate:** a composite block's `provenance.rawText` (and what `contentHash` hashes) is a stable-key JSON snapshot of the _raw_, pre-transform field values — not the composed markdown. Editing a `valueMap` label or `template` wording changes `value`/`displayValue` (and so triggers a commit, since that's a real content change) but not `contentHash` — so it can never look like an any-change alert or a `maxChangePct` guard trip against the underlying source data, which hasn't moved. `LocateResult` gained an optional `texts` field to carry this split (narrowing/coercion runs on `texts`, hashing/storage runs on `rawTexts`); every existing handler leaves it unset and is unaffected.
- **Repair is out of scope for these.** `src/repair/relocate.ts`/`score.ts` (ADR-003/M3b) relocate a _value_ to a new _single_ locator; a composite location has neither. Both now declare composite/indexed extractors unsupported (`relocateApi` proposes no candidates; `scoreCandidates` returns an explicit `"unsupported"` status) rather than silently patching a bare `jsonPath` onto an extractor that still carries `fields`/`index`/`template` — a shape rule 13 would then reject. `.claude/skills/repair-selector/SKILL.md` documents the same limit: a broken composite/indexed target needs a human (or an agent following the SEC vocabulary in `notes`) to hand-edit `config/*.config.ts`.
- Drift's `TYPE_CHANGED` check (`src/drift/check.ts`) iterates the new `resolveApiPaths` export, which resolves one entry per field for a composite location (re-resolving `index` independently against baseline and live, exactly as a real run would) — a row moving position is not itself drift; the underlying value's JS type changing is.
- `extractorLocatorOf` (`src/ingest/extract/locator.ts`) replaces the `kind === "html" ? selector : jsonPath` ternary repeated across `pipeline.ts`, `process-extractor.ts`, and `scripts/repair-diff.ts` — a composite location has no single field any of those could have fallen back to.
- Verified additive: `npm run fixture:verify` reports all ten real `bluecore.config.ts` targets unchanged (zero golden drift) — every existing `jsonPath` extractor takes the same code path it always did.

### ADR-023 — `ingest.yml` gets a preview mode, so ingestion changes are testable off `main`

**Decision.** `.github/workflows/ingest.yml` can now run against any branch via a manual `workflow_dispatch` — checking out that branch's own tip instead of `main` — and executes the identical fetch → extract → validate → diff → gate pipeline against a real Cloudflare preview deploy. It stops at the gate: a preview run never squash-merges into `main` and never opens, comments on, or closes a GitHub Issue. `schedule` and the `config/**` `push` trigger are unaffected — both only ever fire against `main`, so prod behavior (ADR-005) is unchanged.

**Rationale.** Before this, ingestion could only be exercised for real (a live fetch, real extractors, a real gate run) after landing on `main` — and the same `push: config/**` trigger that re-ingests a merged repair immediately would also fire on any PR that touches `config/**`, running an untested extractor against production the moment it merges. An ingestion change now gets the same end-to-end proof `main` gets — including the Workers Builds preview and the smoke-render gate — while still on a branch, with zero risk to production data or operator-facing issues.

**Consequences.**

- One `env.PREVIEW` flag (`github.ref_name != 'main'`) gates every prod-only effect: the squash-merge step, and every `--issues` flag on `scripts/alert-dispatch.ts`. Without `--issues`, that script's normal mode only prints its alert plan and its `--pipeline-failure` mode makes no GitHub API call at all — so gating on the flag, not on separate preview/prod code paths, was enough.
- A preview run pushes `ingest-preview/<branch>/<run-id>` (vs. prod's `ingest/<run-id>`) and never deletes it — unlike the prod branch, which the squash-merge step deletes on success. These accumulate; periodic manual cleanup is expected (`06-OPS-RUNBOOK.md` §12).
- Concurrency is now grouped per ref (`ingest-<branch>`) rather than one global `ingest` group, so a preview run never queues behind or blocks the prod cron. Prod's group is never cancelled (ADR-005's serialization requirement); a preview group cancels its own stale runs.
- `workflow_dispatch` only reads a workflow definition that exists on the default branch, so this change had to land on `main` before it could be dispatched against any other branch — a one-time bootstrapping order, not an ongoing constraint.
- Does not change what merges to `main` or what triggers alerting — a preview run that looks good still needs its branch to actually merge (normally via the next scheduled prod run, once the branch's own PR lands) before it affects production.

### ADR-024 — `viewUrl`: a dashboard link independent of the fetched endpoint (M5a)

**Decision.** A target may set an optional `viewUrl` (`02-CONFIG-SCHEMA.md` §2) — a human-browsable page. New validation rule 14 requires it whenever `method: "POST"`; a `GET` target may still set it when `url` isn't the nicest page to send a reader to. `provenance.sourceUrl` and `TargetFile.sourceUrl` keep meaning exactly what they mean today — the real fetched endpoint — and stay untouched. Only the dashboard's clickable target-header link (`TargetCard.tsx`) changes, rendering `viewUrl ?? sourceUrl`. `ProvenancePopover`'s per-block source link is deliberately left alone: it's a provenance record of what was actually requested, not a navigation aid, so it keeps showing the literal `sourceUrl` even when that link would 405 if clicked — same honesty tradeoff as `eia-ca-industrial-price`'s existing "link 403s without the key" precedent.

**Rationale.** M5 (`docs/plans/m5-new-source-types.md`) needed the first `method: "POST"` target — USAspending's `spending_by_award` search — and a plain `GET` on that endpoint returns 405. `HttpFetcher` already sends `target.method`/`headers`/`body` correctly (M2a's EIA `auth` work exercised the surrounding plumbing; no real target had exercised `POST` itself until now), so the gap wasn't fetching, it was that `TargetFile.sourceUrl`/`provenance.sourceUrl` are the _fetched_ endpoint by design (Invariant 2, `01-DATA-CONTRACT.md`) — repurposing either field to sometimes mean "a clickable page" instead would quietly break that invariant for every other target. A new, purely additive field keeps both meanings intact and correct.

**Consequences.**

- `src/config/schema.ts`: `TargetDef.viewUrl` (`z.url().optional()`) plus rule 14's `.check()`.
- `src/contract/target-file.ts`: `TargetFile.viewUrl`, optional so a target file committed before this field existed still validates.
- `src/ingest/orchestrate.ts` threads `target.viewUrl` onto the assembled `TargetFile`; `src/ingest/persist.ts`'s semantic fingerprint (ADR-011) includes it, so a config-only `viewUrl` edit still produces a commit — same treatment `staleCeilingHours` already gets.
- `schemas/config.schema.json` / `schemas/target-file.schema.json` regenerated (`npm run schema:gen`) — purely additive, no existing target's validated shape changes.
- `TargetCard.tsx`'s header link swaps to `viewUrl ?? sourceUrl`; `ProvenancePopover.tsx` is unchanged by design (see Decision above).
- Verified additive: `npm run fixture:verify` reports every pre-existing target unchanged (zero golden drift) — no target set `viewUrl` before this workstream added one.

### ADR-025 — Composite `list` locations: row-level `fields`+`template` (M6a)

**Decision.** A `list` extractor may now use a **composite** location instead of a single `selector`/`jsonPath`: `fields`+`template` (ADR-022's shape) compose each of the first `limit` matched rows into one markdown string, one array entry per row. For `html`, the extractor's own `selector`+`multiple: true` pick the row nodes exactly as a plain list does; `fields` are then row-relative (`row.find(field.selector)`, or the row node itself when `selector` is omitted). `limit` (new, on `ExtractorBase` so a future composite `api` list can share it) bounds the row count **before** field resolution and is required on any composite list. Rule 7 extends: `list` accepts `type: "string"` (plain, unchanged) or `type: "markdown"` (composite, new) — never the other pairing. The per-field transform set (`ApiFieldDef`, now factored into a shared `FieldTransformDef` both `html` and `api` fields extend) gains `format: "date"` (normalizes free-text dates through the same path `type: "date"` uses), `truncate` (display-only), and `escape: "href"` (resolves a relative URL against `target.url`, rejects a non-`http(s)` scheme as `PARSE_ERROR`, percent-encodes parens/whitespace).

**Rationale.** `bluecore-newsroom`'s `latest_headline` rendered as a single, unlinked scalar — the dashboard's one existing `list` presenter had never been exercised by a real target, and every "latest X" extractor across the config (this one included) showed exactly one row when the source held dozens. ADR-022 already solved "several facts, one row, one markdown string" for `api`; this milestone needed the same composition generalized to **several rows**, and to a second kind (`html`) — a plain `list` can only repeat one selector's text per row, which can't express `bluecore-newsroom`'s `.bc-n-card` (title + link + category + date per card). Building it against `html` first, rather than `api`, was deliberate: `bluecore-newsroom` was already this repo's M1 walking-skeleton target, its fixture already existed, and a real target's mixed relative/absolute hrefs (`escape: "href"`) and free-text dates (`format: "date"`) forced the transform-set additions a synthetic fixture alone would not have surfaced.

Building this exposed three pre-existing defects in the `list` presenter that had never been reachable before, all fixed in the same workstream since none of the three are meaningfully separable from "make `list` work correctly, period":

1. **`ListBlock.tsx`'s per-item anchor was already broken** (`${sourceUrl}#${encodeURIComponent(anchor[i])}` double-wrapped `anchor[i]`, itself already a full `sourceUrl#selector-path` string). Rather than patch the wrapping anchor, `ListBlock.tsx` now renders each row through the same `marked.parseInline` + `DOMPurify.sanitize` treatment `MarkdownBlock.tsx` gives a scalar — a composite row's own template already carries its real link (`[title](url)`), so a second, provenance-only anchor wrapping the whole `<li>` would either nest invalid `<a>`s or point somewhere less useful. Per-row provenance (`anchor`/`rawText`) moved to a `ProvenancePopover`, added alongside expired-state disclosure `ListBlock.tsx` never had either.
2. **`processExtractor`'s "unchanged" branch carried the _previous_ block's `value`/`displayValue` forward whenever `contentHash` matched** — correct for ADR-011 ("no commit on unchanged source data"), but a composite's `contentHash` hashes the raw pre-transform field values (ADR-022), so a `template`/`valueMap`-only edit left `contentHash` unchanged while `value`/`displayValue` should have moved. Nothing caught this because no composite extractor — scalar or list — had ever had its `template` edited in place before. Now the branch takes `value`/`displayValue` from the fresh candidate; for every non-composite extractor this is a no-op (candidate and previous already agree).
3. **`computeSetDelta` diffed rendered strings, not row identity**, and had no notion of a bounded window: an ordinary new row pushing the oldest out of a `limit`-ed list reported as `added: [newest], removed: [oldest]` — "+1 −1" for what's actually one new item — and a `template`/`valueMap` edit would report every row as both added and removed, since the rendered string for every row changed even though nothing underlying moved. `computeSetDelta` now diffs identity (rawText/stableRawJson) and, given `limit`, excludes rows evicted purely by the window filling back up from `removed` — see `01-DATA-CONTRACT.md` §4.1's added semantics note.

**Consequences.**

- `src/config/schema.ts`: `HtmlLocation` gains the composite shape (own `.check()`, sharing a new `templateFieldIssues` helper with `ApiLocation`'s existing rule 13 checks); `limit` moves to `ExtractorBase`; rule 7 extended for `list`'s two valid `type` pairings; `FieldTransformDef` factored out of `ApiFieldDef`, extended by both it and the new `HtmlFieldDef`.
- `src/ingest/extract/html-handler.ts`: `locateComposite`, mirroring `ApiHandler`'s (per-row instead of per-extractor), reusing `compose.ts`'s `applyFieldTransform`/`composeTemplate`/`stableRawJson`.
- `src/ingest/extract/compose.ts`: `applyFieldTransform` gains the `format`/`truncate` transform steps, the `escape: "href"` case, and a `baseUrl` parameter (only `href` reads it).
- `src/ingest/extract/pipeline.ts`'s list branch now honors `located.texts` (an existing `LocateResult` field the list branch had never read) the same way the scalar branch already did — the gap that made defect 2 possible for a composite _scalar_ extractor was already there, just never observed.
- `src/ingest/diff.ts`: `computeSetDelta` takes an optional `limit` and diffs identity, not display text (defect 3, above).
- `src/ingest/process-extractor.ts`: the "unchanged" branch fix (defect 2, above); `publish()`'s list branch passes rawText identity and `extractor.limit` to `computeSetDelta`.
- `src/app/components/ListBlock.tsx`/`ProvenancePopover.tsx`/`TargetCard.tsx`: sanitized inline markdown, expired-state disclosure, `ProvenancePopover`, `col-span-full` grid placement, and a list's `anchor`/`rawText` rendering as one entry per row instead of a flat comma-joined string (defect 1, above).
- `src/repair/relocate.ts`/`score.ts` decline a composite `html` location exactly as they already decline a composite/indexed `api` one (`"unsupported"`, ADR-022's precedent) — no single locator to relocate a row to.
- `config/bluecore.config.ts`: `bluecore-newsroom`'s `latest_headline`/`latest_post_category` collapse into `recent_posts` (a 3-row composite list); `latest_post_date` stays, since its `expectMonotonic`/`maxFutureDays` guard is a metric-only concern a list can't carry. M4c folded in: `bluecore-form-d` (the one target parsing XML through the `html` kind, made to look like an unexplained inconsistency once a real `kind: "xml"` was on the near-term roadmap) is retired.
- Verified: `npm run fixture:verify` re-blesses `bluecore-newsroom`'s golden and reports zero drift on the other ten targets; an ADR-023 preview ingest run proved the real extraction end to end before merge.

### ADR-026 — `kind: "xml"` for RSS and other XML feeds (M6b)

**Decision.** A new extraction handler `kind: "xml"` uses Cheerio's XML mode (`cheerio.load(body, { xml: true })`) instead of the default HTML mode. The handler shares all selector-matching and anchor-resolution logic with `HtmlHandler` via a new `src/ingest/extract/cheerio-locate.ts` module, keeping both handlers thin and maintaining zero-drift for HTML mode when extracting the shared code — verified by `fixture:verify` on pre-existing targets. `XmlLocation` mirrors `HtmlLocation` exactly (same `selector`, `attr`, `multiple`, and composite support for `fields`+`template`); no new transform steps or field types are needed. Registered additively in `src/ingest/extract/registry.ts`, following ADR-010's contract (one handler adds one line).

**Rationale.** Oklo and NuScale publish RSS feeds for press releases. Both feeds hold `<link>` elements containing article URLs — the key fact each competitor target needs to surface. In Cheerio's default HTML parsing mode, `<link>` is a void element (parsed with no text content), and direct attempts to workaround this (e.g., reading the `href` attribute when no text exists) couple the extractor to HTML's specific quirks. A new handler kind, using Cheerio's XML mode where `<link>` has full text content, is the cleanest, most extensible solution — it handles both RSS 2.0 and any future XML source uniformly, and requires no per-target `<link>` workarounds in config.

**Consequences.**

- `src/config/schema.ts`: `TargetDef.kind` gains `"xml"`; `XmlLocation` added as a discriminated union member of `LocationDef` (mirroring `HtmlLocation`'s shape exactly); rule 13 composite check extended to include `xml` in its `list`-type pairings.
- `src/ingest/extract/xml-handler.ts`: new handler implementing `ExtractHandler<cheerio.CheerioAPI>`, with `parse()` calling `cheerio.load(body, { xml: true })` and `locate()` delegating to shared `locateCompositeRows`/`locateScalar` helpers from `cheerio-locate.ts`.
- `src/ingest/extract/cheerio-locate.ts`: new module factoring selector-matching and anchor-resolution shared between `HtmlHandler` and `XmlHandler` — `locateScalar()`, `locateCompositeRows()`, `resolveAnchor()` extracted from `html-handler.ts`, zero-drift verified by re-running `fixture:verify` on bluecore's pre-existing twelve targets (all passed, no extraction changes).
- `src/ingest/extract/html-handler.ts`: refactored to use `locateCompositeRows()` and `locateScalar()` from `cheerio-locate.ts` instead of inline versions (behavior unchanged, verified by fixture:verify).
- `src/ingest/extract/registry.ts`: `XmlHandler` instance registered under `xml` key.
- `src/ingest/fetch/fixture-fetcher.ts`: `EXTENSION_BY_KIND` gains `xml: "xml"`, so fixtures are stored as `.xml` files (consistent with the media type).
- `src/ingest/extract/locator.ts`: `extractorLocatorOf()` extended to handle `xml` kind by treating it as selector-based (same as `html`).
- `src/drift/structure.ts`: `xmlSkeleton()` added, identical logic to `htmlSkeleton()` but using `cheerio.load(xml, { xml: true })`.
- `src/drift/check.ts`: structure-similarity and anchor-moved checks extend to `xml` kind, using `xmlSkeleton()` for the structural fingerprint and checking anchor movement the same way `html` does.
- `scripts/repair-diff.ts`: structure diffing extends to `xml` kind, using `xmlSkeleton()` just like `html`.
- `src/repair/relocate.ts`: `relocateXml()` added (mirroring `relocateHtml()`'s logic), dispatched in `relocate()` alongside `html` and `api` cases. XML extractors inherit the same "unsupported for composite repair" posture as `html` (since both new M6b XML targets are themselves composite lists, already unsupported per ADR-025).
- `src/repair/score.ts`: composite-unsupported check extends to `xml`, consistent with `html`.
- `scripts/repair-verify.ts`: `loadCandidatesFile()` type extends to include `"xml"` (strings become selectors, same as `html`).
- `02-CONFIG-SCHEMA.md`: adds a note on XML selector gotchas — case-sensitivity (`pubDate` not `pubdate`), namespace-prefixed tags needing colon escapes in CSS selectors (`dc\\:creator`), and htmlparser2's XML mode not resolving external entities (by design, no XXE risk).
- Verified: Full standard verification suite passes (format/lint/typecheck/schema/validate-config/test/fixture:verify). Two new targets (`oklo-press-releases`, `nuscale-press-releases`) added to Competitive Landscape section with the composite `list` shape from ADR-025; each fetches its respective RSS feed and extracts three recent releases. An ADR-023 preview ingest run could verify end-to-end extraction before merge if needed.
- Config carries 13 targets (up from 11 pre-M6b): 12 pre-existing targets verified zero-drift, 2 new press-release targets verified successful extraction.

---

## Open

| #   | Question                                                                                                                                                                                                                                                                                                                                                                                                                                  | Blocks                                                                                                            | Owner              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------ |
| Q1  | What is Bluecore Energy, and what are the actual source URLs?                                                                                                                                                                                                                                                                                                                                                                             | Resolved 2026-09-12 — seven sources triaged, see `05-SOURCES.md`.                                                 | Resolved           |
| Q2  | What share of sources are PDFs or session-state web apps?                                                                                                                                                                                                                                                                                                                                                                                 | Informational only as of ADR-010 — drives handler build order, no longer able to invalidate the stack constraint. | Andrew             |
| Q3  | Silent-wrong guards in v1?                                                                                                                                                                                                                                                                                                                                                                                                                | Resolved — **ADR-008**.                                                                                           | Resolved           |
| Q4  | What is the honest weekly maintenance budget, and what does the client see when a source has been broken for six weeks? **Split 2026-09-14:** the safety half (long-broken data must stop rendering as current) is **resolved — ADR-020**; the SLA/UX half (analyst-facing copy, an outage note, a client sees this at all) needs an actual analyst and is deferred. See `docs/plans/m3-operability.md` M3c and `07-ROADMAP.md` Deferred. | Weekly maintenance budget: `06-OPS-RUNBOOK.md` §9. SLA/UX half: deferred, needs auth (ADR-004) first.             | Partially resolved |
| Q5  | Do alerts route to the operator or the client?                                                                                                                                                                                                                                                                                                                                                                                            | Resolved — **ADR-009**.                                                                                           | Resolved           |
| Q6  | robots.txt and ToS posture. Needs a written position before any client deliverable. **Deferred** — `respectRobotsTxt` keeps defaulting to `true` until then.                                                                                                                                                                                                                                                                              | Legal review                                                                                                      | Andrew             |
| Q7  | Git retention policy once commit count passes ~2,000.                                                                                                                                                                                                                                                                                                                                                                                     | —                                                                                                                 | Deferred           |
| Q8  | Target time-to-stand-up-a-new-environment. Sets how much authoring tooling belongs in v1.                                                                                                                                                                                                                                                                                                                                                 | `06-OPS-RUNBOOK.md` §8                                                                                            | Andrew             |

---

## Rejected

- **Long-lived `data/latest` branch served at the origin root.** The static host (Cloudflare Pages, per ADR-013) maps one branch per project to production; the SPEC's Part 5 assumed a capability that does not exist natively. Superseded by ADR-005.
- **Multi-tenant single deployment.** Contradicts the Single-Environment Scope principle and multiplies the auth problem. One environment, one config, one target set.
- **Frontend-first on hand-written fixtures.** Fast to demo, but tends to produce a data contract ingestion cannot satisfy. Superseded by the walking-skeleton milestone.

| #   | Question                                                                                                                                                                                                                                                                                                                                                                                                                                  | Blocks                                                                                                            | Owner              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------ |
| Q1  | What is Bluecore Energy, and what are the actual source URLs?                                                                                                                                                                                                                                                                                                                                                                             | Resolved 2026-09-12 — seven sources triaged, see `05-SOURCES.md`.                                                 | Resolved           |
| Q2  | What share of sources are PDFs or session-state web apps?                                                                                                                                                                                                                                                                                                                                                                                 | Informational only as of ADR-010 — drives handler build order, no longer able to invalidate the stack constraint. | Andrew             |
| Q3  | Silent-wrong guards in v1?                                                                                                                                                                                                                                                                                                                                                                                                                | Resolved — **ADR-008**.                                                                                           | Resolved           |
| Q4  | What is the honest weekly maintenance budget, and what does the client see when a source has been broken for six weeks? **Split 2026-09-14:** the safety half (long-broken data must stop rendering as current) is **resolved — ADR-020**; the SLA/UX half (analyst-facing copy, an outage note, a client sees this at all) needs an actual analyst and is deferred. See `docs/plans/m3-operability.md` M3c and `07-ROADMAP.md` Deferred. | Weekly maintenance budget: `06-OPS-RUNBOOK.md` §9. SLA/UX half: deferred, needs auth (ADR-004) first.             | Partially resolved |
| Q5  | Do alerts route to the operator or the client?                                                                                                                                                                                                                                                                                                                                                                                            | Resolved — **ADR-009**.                                                                                           | Resolved           |
| Q6  | robots.txt and ToS posture. Needs a written position before any client deliverable. **Deferred** — `respectRobotsTxt` keeps defaulting to `true` until then.                                                                                                                                                                                                                                                                              | Legal review                                                                                                      | Andrew             |
| Q7  | Git retention policy once commit count passes ~2,000.                                                                                                                                                                                                                                                                                                                                                                                     | —                                                                                                                 | Deferred           |
| Q8  | Target time-to-stand-up-a-new-environment. Sets how much authoring tooling belongs in v1.                                                                                                                                                                                                                                                                                                                                                 | `06-OPS-RUNBOOK.md` §8                                                                                            | Andrew             |

---

## Rejected

- **Long-lived `data/latest` branch served at the origin root.** The static host (Cloudflare Pages, per ADR-013) maps one branch per project to production; the SPEC's Part 5 assumed a capability that does not exist natively. Superseded by ADR-005.
- **Multi-tenant single deployment.** Contradicts the Single-Environment Scope principle and multiplies the auth problem. One environment, one config, one target set.
- **Frontend-first on hand-written fixtures.** Fast to demo, but tends to produce a data contract ingestion cannot satisfy. Superseded by the walking-skeleton milestone.
