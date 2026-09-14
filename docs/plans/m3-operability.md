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

| Workstream                                 | Status      | PR                                                            |
| ------------------------------------------ | ----------- | ------------------------------------------------------------- |
| M3a — Alerting                             | Delivered   | [#16](https://github.com/andymagill/bluecore-watcher/pull/16) |
| M3b — Repair tooling                       | Delivered   | [#18](https://github.com/andymagill/bluecore-watcher/pull/18) |
| M3c — Failing-data safety (Q4 safety half) | Delivered   | [#20](https://github.com/andymagill/bluecore-watcher/pull/20) |
| M3d — Drill, ops report, close-out         | Not started | —                                                             |

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
- **(M3b)** The agent never touches the network directly. `copilot-setup-steps.yml` captures every target's live fixture into `.runs/live/` _before_ the agent starts — setup steps run outside the agent's firewall. The firewall itself stays at its default allowlist. **Corrected during implementation:** the design above assumed a `copilot` GitHub Actions environment holding `EIA_API_KEY`; GitHub replaced that with a repo-level **Agents** secret type, and `copilot-setup-steps.yml` doesn't accept an `environment:` key at all (only `steps`/`permissions`/`runs-on`/`services`/`snapshot`/`timeout-minutes`). `EIA_API_KEY` is an Agents secret instead — reachable by the setup step as designed, but also by the agent's own shell (masked in its session logs), which the original "never touches secrets directly" framing didn't anticipate. Accepted as a deliberate tradeoff for a free, low-value key (`06-OPS-RUNBOOK.md` §2); reconsider before repeating this for a higher-value secret.
- **(M3b)** Fixture pairs are not kept on disk; `repair:diff` reads the prior fixture with `git show`, using git history as the pair. This amends `03-INGESTION.md` §5 and runbook §3 step 3 ("the old one is kept").

## M3a — Alerting

**Delivered** — [PR #16](https://github.com/andymagill/bluecore-watcher/pull/16), merged 2026-09-14. See the PR / commit history for the implementation; this section is a pointer, not a spec — the spec lived in the planning conversation and is captured by ADR-019 in `00-DECISIONS.md` plus the rewritten `03-INGESTION.md` §4.

Summary of what ships:

- `src/alerts/plan.ts` — pure planner: value alerts (`any-change`/`threshold`, filtered by `minSeverity`, deduped by `quietHours`) and health alerts (fire at 1/3/7 consecutive failures, close on recovery).
- `scripts/alert-dispatch.ts --env <id> --from <sha> --to <sha> [--issues]`, plus `--pipeline-failure <offline|gate>` for the offline-gate/live-gate failure paths.
- `scripts/lib/gh-issues.ts`, shared with `drift-check.ts`.
- `rejectedContentHash` on the validation-warning contract, enabling a paste-ready acknowledgement snippet in a guard-trip alert body.
- Config rules: `thresholdPct` requires `on: "threshold"` and a numeric/`list` type; `alerting.channel` must be `"github-issue"`.
- `ingest.yml`: `BASE_SHA` capture, post-merge dispatch, deduped pipeline-failure issues, and the `config/**` push trigger.

**Prerequisites to start M3b:** confirm this PR is merged, that a real alert issue exists in the expected shape (or the fire-drill in M3d has been run once), and that `rejectedContentHash` is present in `src/contract/block.ts`.

## M3b — Repair tooling

**Delivered** — [PR #18](https://github.com/andymagill/bluecore-watcher/pull/18). See the PR / commit history for the implementation; this section is a pointer, not a spec.

Summary of what ships:

- `src/repair/relocate.ts` + `src/repair/score.ts` — pure, engine-generic (ADR-001) candidate-finding and ranking. Given the old block's evidence (`rawText`) and the newly-fetched document, finds location candidates before any LLM involvement (`html`: class/tag-class/data-attribute/ancestor-scope/label-sibling selectors, plus a flagged positional fallback; `api`: JSONPath value matches), then scores each by re-running `extractOne` plus the target's own `checkShapeAssertions`/`checkEnum`/`checkScalarGuard`/`checkListCountGuard` against the previously committed block.
- `scripts/repair-diff.ts --env <id> <targetId> [--live-dir .runs/live] [--baseline HEAD]` / `scripts/repair-verify.ts --env <id> <targetId> --extractor <key> (--selector|--json-path <v>|--candidates <file>)` — `repair:diff`/`repair:verify` npm scripts.
- `scripts/lib/git.ts` (`gitShowFile`/`gitShowStateReader`, shared with `alert-dispatch.ts`) and `scripts/lib/repair-inputs.ts` — the fixture pair is git history, not a second file kept on disk; `repair-diff.ts` reads the prior fixture with `git show`.
- `scripts/fixture-capture.ts --all --out <dir>` — one target's fetch failure no longer aborts the rest.
- `.claude/skills/repair-selector/SKILL.md` + `.github/copilot-instructions.md` — the portable skill, runnable by Copilot's cloud agent or local Claude Code.
- `.github/workflows/copilot-setup-steps.yml` — captures a live snapshot of every target before the agent starts, so the agent never touches the network or a secret directly.
- `docs/06-OPS-RUNBOOK.md` §2/§3/§10 rewritten; `docs/03-INGESTION.md` §5 corrected.

**Decided during implementation, not in the original design above:** `src/alerts/plan.ts` does **not** get a "Repair: assign this issue to Copilot" block. Alerts stay pure notifications (consistent with ADR-009 — operator-facing, not action-triggering) and don't nudge past runbook §3 step 1's own triage-by-age judgment call; the skill is fully discoverable from `.claude/skills/` and the runbook regardless of whether the alert body echoes it, so nothing is lost by keeping M3a's alert body untouched. `EIA_API_KEY` (and any future authenticated source's key) is mirrored into the repo's Agents secret store with `gh secret set <NAME> --app agents`, documented as one extra step in runbook §10's onboarding checklist rather than a second manual dashboard visit.

**Design correction from the original plan above:** GitHub replaced the per-repo `copilot` Actions environment with a repo-level **Agents** secret type (`Settings → Secrets and variables → Agents`), and `copilot-setup-steps.yml` does not accept an `environment:` key at all — only `steps`/`permissions`/`runs-on`/`services`/`snapshot`/`timeout-minutes`. `EIA_API_KEY` is an Agents secret instead, exposed to both the setup step and the agent's own shell (masked in session logs) — a deliberate, documented tradeoff for a free, low-value key (`06-OPS-RUNBOOK.md` §2).

**One-time operator setup — not done as of PR #18.** Enabling the Copilot cloud agent and adding the `EIA_API_KEY` Agents secret are manual GitHub-settings steps; see `06-OPS-RUNBOOK.md` §3's "one-time operator setup" list.

**Prerequisites to start M3c:** none from M3a/M3b (independent), but sequence after them so the health-entry shape used in M3c stays stable against what M3a/M3b already ship.

## M3c — Failing-data safety (Q4 safety half)

**Delivered** — [PR #20](https://github.com/andymagill/bluecore-watcher/pull/20), ADR-020. See the PR / commit history for the implementation; this section (plus ADR-020 in `00-DECISIONS.md`) is the spec.

**Re-scoped 2026-09-14.** The original design below bundled a real code-level safety gap with an analyst-facing UX pass (copy, an outage banner, a modal rewrite) for an audience — dashboard-visible analysts — that doesn't exist until M4 auth ships, and that contributes nothing to M3's own exit test (an operator taking a selector break from alert to merged fix). The analyst-UX half is moved to `07-ROADMAP.md`'s Deferred table (Q4 SLA/UX half); the original spec for it is preserved verbatim at the bottom of this file under "Deferred: analyst-facing health UX" so a future conversation can pick it up cold. What's left here is the one thing that's a genuine bug regardless of audience:

**The gap.** `computeFreshness` (`src/app/lib/freshness.ts`) only reaches `expired` (value suppressed) via `age > ttlHours × 3`. A `cached` (failing) block is exempted from that check — it renders `failing` (red, "N days ago", value still shown) no matter how long it's been broken, so the ceiling that actually matters for a long-TTL target is `3 × ttlHours` of elapsed _time_, not of _failure_. At `bluecore-form-d`'s `ttlHours: 2160`, that's 270 days before a permanently-broken selector's stale value would even be suppressed — the exact "six-weeks-broken" failure Q4 asked about, just with a bigger number (`eia-ca-industrial-price` at `ttlHours: 1440` is 180 days). Separately, `schedule.staleCeilingHours` and `environment.staleCeilingMultiplier` already validate in the config schema (`src/config/schema.ts:29,44`) but are never published to `TargetFile`, so every target silently uses the 3× default regardless of what's configured — the same class of no-op field ADR-018 closed for `assert`.

**Prerequisites:** none from M3a/M3b (independent), but sequenced after them so the health-entry shape is stable.

Summary of what ships:

- `Block.failingSince` (`src/contract/block.ts`) — the ISO instant a block first turned `cached`, carried forward unchanged on every subsequent failing run, reset to `null` on recovery. Stamped in `src/ingest/process-extractor.ts`'s `cachedBlock`/`failureResult`/`publish` and mirrored in `src/ingest/orchestrate.ts`'s whole-target-fetch-failure path. Optional on the schema (ADR-019 `rejectedContentHash` precedent) so a block committed before this field existed still validates.
- `TargetFile.staleCeilingHours` (`src/contract/target-file.ts`) — resolved once in `runOneTarget` from `schedule.staleCeilingHours ?? schedule.ttlHours × environment.staleCeilingMultiplier` and published, so those two previously-validated-but-unconsumed config fields actually take effect. Added to `computeFingerprint` (`src/ingest/persist.ts`) so a config-only change to either still produces a commit.
- `computeFreshness` (`src/app/lib/freshness.ts`) gains a second, independent path to `expired`: a `cached` block whose `failingSince` is older than `failingCeilingDays` (default 14, a code constant — no target has needed to override it yet) is `expired` regardless of `ttlHours`. `staleCeilingHours` (the resolved absolute value) takes precedence over the pre-existing `staleCeilingMultiplier` input when both are given, so the existing multiplier-based test cases keep passing unchanged. Threaded through `useFreshness` and all four block components (`MetricBlock`/`MarkdownBlock`/`ListBlock`/`StatusBlock`) via `TargetCard`.
- `01-DATA-CONTRACT.md` §3/§4/§5, `02-CONFIG-SCHEMA.md`, `04-FRONTEND.md` §3, and ADR-020 (`00-DECISIONS.md`) document the above; `docs/plans/m3-operability.md`'s "Deferred: analyst-facing health UX" appendix preserves the moved-out design.
- Tests: `tests/app/freshness.test.ts` (failure-age boundary, `staleCeilingHours`/`staleCeilingMultiplier` precedence, backward compat with no `failingSince`), `tests/process-extractor.test.ts` (new — the ingest-side `failingSince` lifecycle against the real `HtmlHandler`), `tests/orchestrate-fetch-failure.test.ts` (new — the same lifecycle via the whole-target fetch-failure path), `tests/orchestrate.integration.test.ts` (extended — `staleCeilingHours` resolution end to end), `tests/app/section-panel.test.tsx` (extended — the gate risk: a suppressed long-failing block still renders its `data-block-key` node).

**Decided during implementation, not in the original design above:** the design considered threading the health entry's `firstSeenAt` through the same path `servingCachedFrom` uses, to avoid a new field. Implementation instead put `failingSince` directly on `Block` — the client already receives blocks without needing to join `health.json`, so this is one less cross-file dependency for the exact same information, and it makes `computeFreshness` a pure function of the block it's given (matching every other input it already takes) rather than needing a second, health-derived argument.

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
- Analyst-facing health UX (Q4 SLA/UX half) — moved out of M3c 2026-09-14, see below and `07-ROADMAP.md` Deferred.

---

## Deferred: analyst-facing health UX (Q4 SLA/UX half)

**Moved out of M3c on 2026-09-14** — not dropped, just not part of M3. Pick this up once M4 auth has shipped and there's an actual analyst audience to design copy and disclosure tiers for; see `07-ROADMAP.md`'s Deferred table entry. This is the original M3c design verbatim, preserved so a future conversation can start here cold rather than re-deriving it. It assumes the M3c safety half above (failure-age ceiling, published `staleCeiling*`) is already merged.

**Prerequisites:** M3c (failing-data safety) merged, so the health-entry shape and the failure-age `expired` path are stable. M4 auth shipped, so there's a real analyst audience. Read `01-DATA-CONTRACT.md` §5 (freshness) and §7 (`health.json`) before starting.

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
  - Blocks: at the `prolonged` tier, suppress the value behind the same disclosure `expired` already uses (by M3c, this disclosure already fires for the failure-age case — this tier is about _copy_, not a new suppression mechanism).
  - Precedence: `prolonged` > `expired` > `failing` > `flagged` > `stale` > `fresh`.
- **`HealthModal.tsx`:** group by target label (from the manifest); use block labels, not keys; one analyst sentence per entry with dates, a text tier badge, and the outage note; put errorClass/selector/HTTP status/stack behind a "Technical details" disclosure. `HeaderBar` needs to pass the manifest and target files. Review `HealthPill` copy too.
- **Gate risk to verify:** the smoke render counts rendered blocks (`src/gate/smoke-render.ts`) — a suppressed prolonged-outage block must still count, the same way `expired` does today.
- **Tests:** `tests/app/outage.test.ts` (tier boundaries), `tests/app/health-modal.test.tsx` (analyst copy visible, technical details collapsed); extend `tests/app/section-panel.test.tsx` and `tests/smoke-render.test.ts` for a prolonged block.
- **Docs:** `04-FRONTEND.md` §3/§6, `01-DATA-CONTRACT.md`/`02-CONFIG-SCHEMA.md` for `outage`, a new ADR resolving Q4's remaining SLA/UX half.
- **Verify:** `npm run dev` with a hand-edited, **uncommitted** `health.json` whose `firstSeenAt` values straddle 3 and 14 days — check the banner, the suppressed value, and the modal copy; `npm run gate` still passes against a local build.
