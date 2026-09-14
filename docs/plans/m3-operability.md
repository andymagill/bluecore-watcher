# M3 — Operability plan

Implements the milestone in `07-ROADMAP.md` M3: proving one person can maintain this system. Exit test: **a selector break goes from alert to merged fix in under 30 minutes.**

Context usage runs high on a milestone this size, so M3 is split into **four sequential workstreams, one conversation each**: M3a → M3b → M3c → M3d. Each depends on the ones before it landing on `main` first.

## How to use this doc

Only the workstream marked **Next** below gets implemented in a given conversation — the others are design only, for a future conversation to pick up cold. Each workstream:

1. Confirms its own prerequisites checklist below.
2. Branches off `main` (`origin/main`, not a stale local branch).
3. Commits per verified phase, not once at the end.
4. Runs the standard verification (format/lint/typecheck/schema/validate-config/test) plus its own workstream-specific checks.
5. Updates the status table below and the M3 section of `07-ROADMAP.md` on completion.

## Status

| Workstream                          | Status      | PR                                                            |
| ----------------------------------- | ----------- | ------------------------------------------------------------- |
| M3a — Alerting                      | In review   | [#16](https://github.com/andymagill/bluecore-watcher/pull/16) |
| M3b — Repair tooling                | Not started | —                                                             |
| M3c — Analyst-facing health UX (Q4) | Not started | —                                                             |
| M3d — Drill, ops report, close-out  | Not started | —                                                             |

## Context / findings (all of M3)

- **Alerting doesn't exist.** `AlertDef`/`AlertingConfig` are validated but nothing ever sends an alert (`03-INGESTION.md` §4 describes dispatch that was never built).
- **The ingest workflow opens a new issue on every failing run.** `ingest.yml`'s two failure steps put the runId in the title, so a week-long outage creates 7 issues.
- **An ADR-012 guard release can't be done from published data.** An acknowledgement needs the quarantined candidate's `contentHash`, but `validation.warnings[]` only stores `rejectedCandidate`/`retainedValue`.
- **Q4 (the six-weeks-broken UX) is unsolved.** Freshness is keyed on _data_ age (`ceiling = 3 × ttlHours`), so a broken `bluecore-form-d` (TTL 2160h) would look current for about 9 months. The UI never joins `health.json` to blocks, and `HealthModal` shows raw developer fields.
- **Nothing has ever broken in production.** All 10 targets are healthy, so the exit criterion has to be proven with a scripted drill, not a real incident.
- **Constraints:**
  - Pushes made with the Actions `GITHUB_TOKEN` don't trigger other workflows.
  - `GITHUB_TOKEN` can't create PRs (confirmed live, ADR-013/ingest.yml history) — the ingest workflow already squash-merges directly for this reason.
  - The repo is public, with no branch protection on `main`.
  - The `alert` and `drift` labels already exist.
  - Copilot's cloud agent starts when an issue is _assigned_ to it (not via an `@copilot` comment — that only works on PRs). Auto-assigning it programmatically needs a user-token PAT, which is out of scope for M3.
  - Agent PRs need "Approve and run workflows" clicked before CI runs.

## Decisions (from grilling)

| Topic         | Decision                                                                                                                                                                                   | Workstream |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| Repair driver | A portable Agent Skill plus a deterministic harness. Start it by manually assigning the alert issue to Copilot's cloud agent (Copilot Pro plan). The same skill runs in local Claude Code. | M3b        |
| Q4 UX         | Escalate by outage age (health `firstSeenAt`), plus an optional operator-written note in config                                                                                            | M3c        |
| Exit proof    | Scripted fire drill on a real target (`bluecore-newsroom`)                                                                                                                                 | M3d        |
| Measurement   | M3 closes on a passing drill; cost measurement continues afterward as a weekly ops report that updates runbook §9                                                                          | M3d        |
| Q6 robots/ToS | Moved to M4 (it's a legal position, not operability tooling)                                                                                                                               | —          |

## Other decisions

- **(M3a)** Alerts come from diffing two committed states after the merge, not a run artifact (new ADR). This lets the dispatcher run inside the ingest job (a `GITHUB_TOKEN` push can't trigger a separate workflow), be replayed for testing, and never alert on data that failed its gate.
- **(M3a)** GitHub Issues are the only alert state store, following the drift-check pattern (`src/drift/issues.ts`). Health alerts are one issue per target; value alerts are one issue per extractor.
- **(M3a)** `alerting.channel` values other than `"github-issue"` are rejected at config time until implemented (the ADR-018 no-op-field principle).
- **(M3a)** Add `rejectedContentHash` to the validation-warning shape, so an ADR-012 acknowledgement can be written directly from an alert issue's body.
- **(M3a)** `ingest.yml` also runs on `push` to `main` with `paths: config/**`, so a merged repair (M3b) re-ingests immediately and its alert auto-closes.
- **(M3b)** The skill lives in `.claude/skills/repair-selector/` (Copilot reads `.claude/skills` as well as `.github/skills`, so one copy serves both hosts).
- **(M3b)** The agent never touches the network or secrets directly. `copilot-setup-steps.yml` (using a `copilot` environment holding `EIA_API_KEY`) captures every target's live fixture into `.runs/live/` _before_ the agent starts — setup steps run outside the agent's firewall. The firewall itself stays at its default allowlist.
- **(M3b)** Fixture pairs are not kept on disk; `repair:diff` reads the prior fixture with `git show`, using git history as the pair. This amends `03-INGESTION.md` §5 and runbook §3 step 3 ("the old one is kept").

## M3a — Alerting

**In review** — [PR #16](https://github.com/andymagill/bluecore-watcher/pull/16). Delivered once it merges to `main`. See the PR / commit history for the implementation; this section is a pointer, not a spec — the spec lived in the planning conversation and is captured by ADR-019 in `00-DECISIONS.md` plus the rewritten `03-INGESTION.md` §4.

Summary of what ships:

- `src/alerts/plan.ts` — pure planner: value alerts (`any-change`/`threshold`, filtered by `minSeverity`, deduped by `quietHours`) and health alerts (fire at 1/3/7 consecutive failures, close on recovery).
- `scripts/alert-dispatch.ts --env <id> --from <sha> --to <sha> [--issues]`, plus `--pipeline-failure <offline|gate>` for the offline-gate/live-gate failure paths.
- `scripts/lib/gh-issues.ts`, shared with `drift-check.ts`.
- `rejectedContentHash` on the validation-warning contract, enabling a paste-ready acknowledgement snippet in a guard-trip alert body.
- Config rules: `thresholdPct` requires `on: "threshold"` and a numeric/`list` type; `alerting.channel` must be `"github-issue"`.
- `ingest.yml`: `BASE_SHA` capture, post-merge dispatch, deduped pipeline-failure issues, and the `config/**` push trigger.

**Prerequisites to start M3b:** confirm this PR is merged, that a real alert issue exists in the expected shape (or the fire-drill in M3d has been run once), and that `rejectedContentHash` is present in `src/contract/block.ts`.

## M3b — Repair tooling

**Prerequisites:** M3a merged. Read `docs/00-DECISIONS.md` ADR-019 and the alert issue body shape it produces before starting.

- **`src/repair/relocate.ts`** (pure, engine-generic — no "bluecore" in code, per ADR-001). Given the old block (`rawText`, `anchor`) and the newly-fetched document, find location candidates deterministically, before any LLM involvement:
  - `html`: nodes whose normalized text contains the old `rawText`, emitted as class/attribute/text-based selectors (never re-proposing `nth-child`).
  - `api`: JSON paths whose value equals the old raw value.
- **`src/repair/score.ts`.** For each candidate `ExtractorDef` patch: run `extractOne` against the new fixture, then the existing `checkShapeAssertions`/`checkScalarGuard` (reused from `src/ingest/process-extractor.ts`) against the previously committed block. Rank by: passes all checks, `matchCount === 1`, value equal to or close to the previous value, with a penalty for positional selectors (`nth-child`, `:eq`).
- **`scripts/repair-diff.ts --env <id> <targetId> [--live-dir .runs/live] [--baseline HEAD]`.** Diffs the git-historical fixture against the new one (`src/drift/structure.ts`'s `setDiff`). Per extractor: old anchor/context, whether it still extracts, and the relocation candidates. Writes `.runs/repair/<id>/context.md`.
- **`scripts/repair-verify.ts --env <id> <targetId> --extractor <key> (--selector|--json-path <v> | --candidates <file>)`.** Prints a ranked table; exits non-zero if nothing passes.
- **`scripts/fixture-capture.ts`:** add `--all` and `--out <dir>` (default behavior for a single target is unchanged; one target's failure must not abort `--all`).
- **npm scripts:** `repair:diff`, `repair:verify`.
- **`.claude/skills/repair-selector/SKILL.md`** — steps: read the alert issue and the target's `notes`; get a fresh fixture (`.runs/live/<id>/` if present, else `fixture:capture`); run `repair:diff`; propose up to 5 resilient candidates; run `repair:verify` and apply the best one to `config/<env>.config.ts`; run `fixture:bless`, `validate:config`, `npm test`; open a PR `repair(<targetId>): …` with the verify table, `Fixes #<n>`, and a `Time spent:` line.
  - **Hard rules:** never edit `src/` or `public/data/`; if the fix needs an engine change, stop and say so (ADR-001). Never loosen an `assert` or guard to make a candidate pass — that launders a silent-wrong.
- **`.github/workflows/copilot-setup-steps.yml`:** a single `copilot-setup-steps` job, `environment: copilot` (holding `EIA_API_KEY`): checkout, Node 22, `npm ci`, `npm run fixture:capture -- --env bluecore --all --out .runs/live`.
- **`.github/copilot-instructions.md`:** a short pointer at the skill and its hard rules.
- **M3a alert body:** add a "Repair: assign this issue to Copilot" block for `SELECTOR_*`/`PARSE_ERROR` health alerts (this is the one place M3b modifies M3a's output).
- **ESLint (`eslint.config.js`):** `src/app` may not import `**/repair/*`; `src/repair` may not import `**/app/*`.
- **Tests (`tests/repair.test.ts`):** an in-test mutated newsroom fixture (renamed class) — relocation finds the node by its old `rawText`, and a positional candidate ranks below a class-based one; a candidate that fails assertions is rejected; an `api` case where a moved key is relocated by value.
- **One-time operator setup (add to runbook, not code):** enable the Copilot cloud agent for the repo; create the `copilot` environment with the `EIA_API_KEY` secret; leave the firewall at its default allowlist.
- **Verify:** mutate a copy of the newsroom fixture into `.runs/live/` and confirm `repair:diff`/`repair:verify` rank the correct selector first; push the branch so `copilot-setup-steps.yml` runs its own validation.

## M3c — Analyst-facing health UX (Q4 + modal copy)

**Prerequisites:** none from M3a/M3b (independent), but sequenced after them so the health-entry shape is stable. Read `01-DATA-CONTRACT.md` §5 (freshness) and §7 (`health.json`) before starting.

- **Config/contract:** `TargetDef.outage?: { note: string }` (non-empty, ≤280 chars), published as `TargetFile.outage` in `src/ingest/orchestrate.ts`, included in `computeFingerprint` (so editing the note produces a commit). Run `schema:gen`.
- **`src/app/lib/outage.ts`** (pure, fake-clock testable). `computeOutage(now, healthEntry)` → `none | brief (<3d) | ongoing (3–14d) | prolonged (>14d)`, keyed on `firstSeenAt`, for `status: failed` entries. A `flagged` entry older than 3 days reads "awaiting review since {date}", not as an outage.
- **`src/app/lib/health-copy.ts`.** An exhaustive `Record<ErrorClass, string>` of analyst sentences (a new `ErrorClass` becomes a type error):
  - `SELECTOR_*`/`PARSE_ERROR` → "The source page changed structure"
  - `NETWORK_ERROR`/`TIMEOUT`/`HTTP_ERROR` → "The source site couldn't be reached"
  - `BLOCKED` → "The source site refused our request"
  - `AUTH_ERROR` → "Our access to this source needs renewing"
  - `ASSERTION_FAILED` → "The source returned a value that failed our sanity checks"
  - `CHANGE_GUARD_TRIPPED` → "A large change is awaiting verification"
  - `SCHEMA_INVALID`/`UNKNOWN` → "An internal error on our side"
- **Health reaches blocks:** thread a `healthByKey` map (`targetId.extractorKey`) through `AppShell.tsx` → `SectionGrid` → `TargetCard.tsx` → the block components.
  - `TargetCard`: a banner when any failed entry exists (tier text, "since {date}", outage note); replace the developer-facing `RUN_STATUS_LABEL` with analyst copy.
  - Blocks: at the `prolonged` tier, suppress the value behind the same disclosure `expired` already uses.
  - Precedence: `prolonged` > `expired` > `failing` > `flagged` > `stale` > `fresh`.
- **`HealthModal.tsx`:** group by target label (from the manifest); use block labels, not keys; one analyst sentence per entry with dates, a text tier badge, and the outage note; put errorClass/selector/HTTP status/stack behind a "Technical details" disclosure. `HeaderBar` needs to pass the manifest and target files. Review `HealthPill` copy too.
- **Gate risk to verify:** the smoke render counts rendered blocks (`src/gate/smoke-render.ts`) — a suppressed prolonged-outage block must still count, the same way `expired` does today.
- **Tests:** `tests/app/outage.test.ts` (tier boundaries), `tests/app/health-modal.test.tsx` (analyst copy visible, technical details collapsed); extend `tests/app/section-panel.test.tsx` and `tests/smoke-render.test.ts` for a prolonged block.
- **Docs:** `04-FRONTEND.md` §3/§6, `01-DATA-CONTRACT.md`/`02-CONFIG-SCHEMA.md` for `outage`, a new ADR resolving Q4.
- **Verify:** `npm run dev` with a hand-edited, **uncommitted** `health.json` whose `firstSeenAt` values straddle 3 and 14 days — check the banner, the suppressed value, and the modal copy; `npm run gate` still passes against a local build.

## M3d — Drill, ops report, close-out

**Prerequisites:** M3a, M3b, and M3c all merged.

- **`src/ops/report.ts`** (pure) + **`scripts/ops-report.ts --since <date>`** (via `gh … --json`): alert/drift issues opened and closed, time from issue `createdAt` to linked PR `mergedAt` (via `closingIssuesReferences`), repair PR count, the sum of `Time spent:` values, mean time-to-resolve by errorClass. **`.github/workflows/ops-report.yml`** runs Mondays 15:00, writes the step summary, and comments on one pinned `Ops report` issue.
- **Fire drill** (write up as runbook §12, scripted so it's repeatable):
  1. Open a PR `drill(bluecore-newsroom): …` that renames one class in _both_ `fixtures/bluecore-newsroom/response.html` and the config selector, then re-blesses — CI passes (config and fixture agree), but the live page no longer matches, exactly like a real redesign.
  2. Merge it. The `config/**` push trigger ingests: `SELECTOR_NO_MATCH` → block `cached` → gate passes → merge → **alert issue opens (T0)**.
  3. On GitHub Mobile, assign the issue to Copilot; the skill runs and opens a PR.
  4. Click "Approve and run workflows", review, merge (**T1**). Re-ingest fires and the alert auto-closes.
  5. Record `T1 − T0`. Pass means under 30 minutes.
- **Close-out docs:**
  - a new ADR: repair via the portable skill plus the cloud agent (ADR-003's data-path boundary is unchanged — still a reviewed PR through CI and the gate)
  - move Q6 to M4 in `00-DECISIONS.md` and `07-ROADMAP.md`
  - runbook §3 (repair via the agent), §9 (point at the ops report)
  - mark M3 delivered in `07-ROADMAP.md` with the drill's timing
  - Deferred table: "auto-assign repair at a failure threshold (needs a user PAT)", "webhook/email alert channels"
- **Verify:** `npm run ops-report -- --since 2026-09-01` renders sensibly; the fire drill passes end to end with T0/T1 taken from GitHub timestamps.

## Out of scope for all of M3

- Q6 (robots.txt/ToS position) — moved to M4.
- Auto-assigning the repair agent (needs a user PAT).
- Claude/Codex via GitHub Agent HQ — not needed; availability depends on Copilot plan tier.
- Webhook/email alert channels.
- Client-facing alerts (ADR-009 — blocked on M4 auth).
