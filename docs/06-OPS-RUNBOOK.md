# 06 — Operations Runbook

Per ADR-001 the dashboards are operated as a service. This document is the operator's, and the operator is currently one person.

---

## 1. Deployment topology

| Piece        | Where                                                                                    | Notes                                                     |
| ------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| App + data   | One Cloudflare Worker (Static Assets), builds from `main` via Workers Builds             | Static Vite output; `public/data/**` ships with the build |
| Ingestion    | GitHub Actions, cron                                                                     | Concurrency group `ingest`, serialized                    |
| Preview gate | Workers Builds preview per `ingest/*` branch                                             | Blocks the merge                                          |
| Edge relay   | Cloudflare Worker, separate route (or route on the same Worker — undecided, see ADR-014) | Optional per target; PSK header (ADR-006)                 |
| Alerts       | GitHub Issues                                                                            | v1 channel                                                |

Host is Cloudflare per ADR-013 — this table previously named Vercel throughout, which was never an accepted decision. The SPA-hosting row is corrected again per **ADR-014**: Pages is being phased out in favor of Workers, so the static SPA and its preview deployments live on a Worker (Static Assets + Workers Builds), not Pages.

Same-origin is satisfied trivially: data files are part of the build output, served from the production domain. The SPEC's Part 5 branch-mapping problem does not arise under ADR-005.

---

## 2. Secrets

| Name                   | Purpose                                                                       |
| ---------------------- | ----------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN` | Preview URL resolution in the gate                                            |
| `INGEST_PSK`           | Edge relay authentication                                                     |
| `EIA_API_KEY`          | `eia-ca-industrial-price` target (`auth.type: "query"`) — first real use, M2a |
| `<SOURCE>_API_KEY`     | Per additional authenticated source, named in config                          |

All GitHub Actions repository secrets. Never in config — config is committed, and a literal-secret pattern scan runs in CI (validation rule 11).

**M3b addition — every authenticated source's key also exists as a repo-level _Agents_ secret** (`Settings → Secrets and variables → Agents`, a separate store from the Actions table above — or `gh secret set <NAME> --app agents`, §10), so `.github/workflows/copilot-setup-steps.yml` can capture a live snapshot for the Copilot cloud agent (see §3's one-time setup below). This is a real tradeoff, accepted deliberately: an Agents secret is exposed as an env var both to setup steps _and_ to the agent's own shell — masked in the agent's session logs, but visible to it in a way the Actions table above never is to ingestion's own agent-free jobs. Fine for a low-value key like `EIA_API_KEY`; reconsider before mirroring a genuinely sensitive one this way.

A captured fixture is not automatically safe from this either: an authenticated source can echo its own key back in the response body (confirmed live against EIA's v2 API, which returns `request.params.api_key` verbatim). `npm run fixture:capture` scrubs the captured body against every active `secretEnv` value before writing to disk (the same `src/ingest/scrub.ts` functions the persist layer uses) — but a fixture captured by any other means (hand-copied via `curl`, a browser devtools export) is not, so scrub it yourself before committing.

Error text and `rawText` are scrubbed against active secret values before being written to any committed file (`health.json` or a target file). A token echoed in a 401 body would otherwise land permanently in the Git history that serves as the audit trail.

---

## 3. Runbook: a selector broke

The routine failure. Expect these weekly.

**Symptom.** Health entry with `SELECTOR_NO_MATCH` or `SELECTOR_AMBIGUOUS`; block serving `cached`.

1. **Triage by age.** `consecutiveFailures` ≤ 2 on a flaky source may self-resolve. Above 3, fix it.
2. **Read `notes`** on the target config. Past-you may have already predicted this.
3. **Get a fresh document.** The alert itself is a plain notification — repair is always a decision you make, not something it triggers. Either assign the issue to Copilot (its `copilot-setup-steps.yml` job captures a live snapshot of every target into `.runs/live/<targetId>/` before the agent starts, so it never fetches the page itself), or capture locally: `npm run fixture:capture -- --env <envId> <targetId>` overwrites `fixtures/<targetId>/response.<ext>` in place — do not fix a selector against the live page by hand.
4. **Diff old against new.** `npm run repair:diff -- --env <envId> <targetId>` diffs the _git-historical_ fixture (read with `git show` — no second copy is kept on disk; git history is the old/new pair) against the fresh one, per extractor, and writes `.runs/repair/<targetId>/context.md` with a ranked table of candidate replacement selectors/jsonPaths (`src/repair/relocate.ts` + `src/repair/score.ts`, docs/plans/m3-operability.md M3b).
5. **Repair.** Either the `repair-selector` skill (`.claude/skills/repair-selector/SKILL.md`) does this end to end — via the Copilot cloud agent or locally in Claude Code — or hand-pick a selector from `context.md`'s table and confirm it with `npm run repair:verify -- --env <envId> <targetId> --extractor <key> --selector <v>` (nonzero exit means it doesn't pass). Either way it arrives as a PR, never a direct commit.
6. **Test.** Copy the live capture over the committed fixture, then re-bless the golden file (`npm run fixture:bless -- --env <envId> <targetId>`) and review the diff before committing — `npm run fixture:verify -- --env <envId>` (ADR-021, run in CI) then enforces it stays that way.
7. **Merge.** `ingest.yml`'s `config/**` push trigger (ADR-019) re-ingests immediately; the alert issue auto-closes on the next successful run rather than waiting for the next scheduled cron.

**Prefer resilient selectors.** Match on a label cell, a `data-` attribute, or text content rather than `nth-child`. Positional selectors are the ones that break.

**One-time operator setup (M3b) — not yet done as of this writing.** The repair tooling above needs, once per repo:

- The GitHub Copilot cloud agent enabled for this repository.
- `EIA_API_KEY` added as a repo-level **Agents** secret (§2) — not the older per-repo `copilot` Actions environment, which GitHub has replaced; any secret configured there previously would have been auto-migrated, but this repo never had one.
- Nothing to change on the agent firewall — leave it at its default (recommended) allowlist. The live-fetch step that needs `EIA_API_KEY` runs in `copilot-setup-steps.yml`, which the firewall doesn't apply to at all, not in the agent's own turn.
- "Approve and run workflows" still needs a manual click on any PR the agent opens, same as any other first-time contributor's PR, before CI will run on it.

---

## 4. Runbook: a new SEC filing appeared

**Symptom.** `bluecore-sec-filings.latest_filing_form`/`.latest_filing_date`/`.recent_filings` change (M2b `any-change` alert fires on the form field) — most likely the next real event, not a bug, since this target's whole purpose is catching the next filing.

Nothing further to do beyond the normal review: `bluecore-sec-filings` reads SEC's own submissions JSON directly, so a new filing shows up on its own — no pinned URL to repoint. (M6a retired `bluecore-form-d`, the one target that _was_ pinned to a single accession number's XML URL and needed manual repointing here; this target is now the whole story for "a new SEC filing appeared.")

1. Confirm via the new filing's accession number (`$.filings.recent.accessionNumber[0]` in the same submissions JSON) that it's a real new filing, not a form type you'd expect to ignore.
2. Check `health.json` after the next run — `maxChangePct`/guard settings on the affected extractors (`config/bluecore.config.ts`) determine whether it published automatically or needs a guard review (§5 below).

---

## 5. Runbook: a change guard tripped

**Symptom.** `CHANGE_GUARD_TRIPPED`; block `flagged`; value withheld.

This is the system working. A number moved more than its configured tolerance and is waiting for a human.

1. Open the source page. Is the new value real?
2. **Real, and a one-off** (ADR-012) → add an entry to the committed acknowledgements file, keyed by `targetId.extractorKey` and the candidate's `contentHash`. **(M3a)** The alert issue for this trip already carries a ready-to-paste JSON block with the right `contentHash` (from `validation.warnings[].rejectedContentHash`) — copy it in rather than hunting the value down by re-running ingestion locally. Merge; the next run publishes that exact candidate and consumes the entry. The guard's tolerance is untouched, so it still catches the _next_ anomalous move at the same target.
3. **Real, and the source's normal volatility has changed** → widen `maxChangePct`, merge, re-run. Reserve this for when the guard was tuned too tight for how this source actually behaves, not for a single legitimate spike — widening on every real move ratchets the guard toward meaningless over time.
4. **Wrong** → you just caught a silent-wrong before it published. Repair the selector per §3.

If a guard trips repeatedly on legitimate movement, retune it (step 3) immediately. A guard people learn to dismiss is worse than no guard at all, because it launders real failures into routine noise.

---

## 6. Runbook: a source started blocking

**Symptom.** `BLOCKED` — 403, 429, or a captcha heuristic.

1. **Do not retry.** The pipeline already knows not to; don't do it by hand either.
2. Check `robots.txt` — did the source's policy change?
3. Lower the cadence and raise `politeness.minIntervalMs`. Most blocks are rate-based and this alone fixes them.
4. Confirm the User-Agent is identifying and carries a contact URL.
5. If it persists, set `proxy: "edge"` on that target and measure. **This is the evidence ADR-006 is waiting for** — record whether it actually helped, per source. Two or three data points settle the question.
6. If the relay does not help, the source is doing real bot detection. At the near-zero-cost constraint, the honest answers are: negotiate access, find an alternative source, or drop it. Do not escalate into an arms race.

---

## 7. Runbook: the gate failed

**Symptom.** Ingestion run exits non-zero, branch left open, production untouched. **(M3a)** One GitHub Issue, `Pipeline: ingestion gate failed`, tracks this — a run of consecutive failures comments on the same issue rather than opening a new one each time, and it closes itself the next time a merge succeeds.

Correct behaviour — production is serving the last good data. No urgency beyond data ageing.

- `SCHEMA_INVALID` → engine defect. Always a bug, never a source problem.
- **Contract assertion failed** → likely a value was blanked that shouldn't have been. Serious; investigate before merging anything.
- **Smoke render failed** → either the app cannot render valid data (frontend bug) or block counts disagree (the UI is silently dropping data). The second is the dangerous one.

The branch is a complete reproduction. Check it out, run locally, fix forward. Never merge past a failed gate to "unblock" — that discards the only guarantee the architecture makes.

---

## 8. Runbook: a drift warning opened

**Symptom.** A GitHub Issue titled `Drift: <targetId>`, label `drift`. The Monday `Drift check` workflow (`.github/workflows/drift.yml`) opened it — never the daily ingest, and never a failed workflow run.

This is the early-warning system working (`03-INGESTION.md` §5): the page or API response changed shape, but extraction may still be succeeding. Treat it as lower urgency than a broken selector (§3) — nothing is `cached`/`flagged` in production because of this alone — but higher urgency than routine, because the next redesign might land on the exact node a selector depends on.

1. **Read the issue body.** Each signal names what changed: `EXTRACTION_BROKEN` (an extractor that works against the fixture now fails live — treat this one like §3, today), `ANCHOR_MOVED` (the selector still matches, but at a different position — the page shifted around it), `TYPE_CHANGED` (a `jsonPath` now resolves to a different JS type), `STRUCTURE_CHANGED` (the response's overall shape moved, independent of any one extractor).
2. **`EXTRACTION_BROKEN`** → this is really §3 wearing a different label; go there.
3. **`ANCHOR_MOVED` / `STRUCTURE_CHANGED` / `TYPE_CHANGED` with extraction still working** → capture a fresh fixture (`npm run fixture:capture -- --env bluecore <targetId>`) and diff it against the old one (still in Git history) to see what actually moved.
4. **Benign** (a new section added elsewhere on the page, a field gained that nothing extracts) → re-bless (`npm run fixture:bless -- --env bluecore <targetId>`) so the fixture matches the new normal, and comment on the issue saying so before closing it yourself, or just leave it — the next clean weekly run closes it automatically.
5. **Not benign** (the specific node an extractor depends on moved for a reason that will eventually break it) → treat as an early §3, before it actually breaks: tighten the selector or add resilience now, at your own pace rather than an operator's on a Saturday.

The issue closes itself, with a comment, the first time the target comes back clean — no manual close needed for the common case.

---

## 9. Maintenance expectations

Open question Q4 asks for an honest number. The shape, to be replaced with measurement:

| Activity                    | Cadence                 | Est.                |
| --------------------------- | ----------------------- | ------------------- |
| Triage health entries       | Weekly                  | 15–30 min           |
| Repair broken selectors     | ~1–2/week at 20 sources | 20–40 min each      |
| Review drift-check warnings | Weekly                  | 10 min              |
| Retune guards               | Monthly, front-loaded   | 30 min              |
| **Total**                   |                         | **~1.5–3 hrs/week** |

This is the number the competitive table's "Low maintenance" claim has to survive. It is low compared to running database infrastructure. It is not zero, and it scales with source count — 50 sources is not 1.5 hours a week. Price accordingly, and be straight about it with clients.

The drift check (`03-INGESTION.md` §5) is what keeps this number from growing: catching a redesign before extraction breaks converts an outage into a scheduled task.

---

## 10. Onboarding a new environment

The ADR-001 test. Target: one afternoon (open question Q8).

1. `config/<envId>.config.ts` — entities, sections, targets, extractors.
2. Capture a fixture per target (`npm run fixture:capture -- --env <envId> <targetId>`), then bless its golden file (`npm run fixture:bless -- --env <envId> <targetId>`). `npm run fixture:verify -- --env <envId>` (ADR-021) then enforces every target keeps a golden file and keeps matching it — parameterized by `--env`, so a genuinely new environment gets this check for free with no new test file to write.
3. Confirm every declared section has at least one target — `npm run validate:config` doesn't check this (an empty section is a legitimate zero-state, not an error — SPEC.md Part 4 §1), so it's a manual read of the config against `environment`/`sections` before calling an environment "done" (ADR-021; this used to be an automated `tests/config-coverage.test.ts` check, retired because it was a one-time-per-deployment fact, not a general invariant).
4. Set secrets for authenticated sources — **both** stores, one command each, so a future repair of this source works through the Copilot cloud agent too (§2, §3):
   ```
   gh secret set <SOURCE>_API_KEY --body "$VALUE"              # Actions: ingest.yml, drift.yml, CI
   gh secret set <SOURCE>_API_KEY --app agents --body "$VALUE" # Agents: copilot-setup-steps.yml
   ```
5. `npm run validate:config`.
6. Dry run: `npm run ingest -- --env <envId> --dry` — writes nothing, prints what it would extract.
7. Tune assertions from the dry run's real values rather than guesses.
8. Enable the cron; watch the first three runs.

If any step requires touching application code, ADR-001 is violated and the schema needs to absorb the difference.

---

## 11. Unresolved operational risks

| Risk                                                                                                                                           | Status                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| No authentication — deployment is public (ADR-004)                                                                                             | **Open.** Do not ingest anything damaging if crawled, until auth ships.                               |
| robots.txt / ToS posture unwritten (Q6)                                                                                                        | **Deferred.** `respectRobotsTxt` defaults to `true` until then. Needed before any client deliverable. |
| Git retention past ~2,000 commits (Q7)                                                                                                         | Deferred.                                                                                             |
| Single operator — no coverage                                                                                                                  | Accepted for now. The `notes` field and this runbook are the mitigation.                              |
| Edge relay unvalidated (ADR-006)                                                                                                               | Gathering evidence via §6.                                                                            |
| Cloudflare's actual free-tier terms for this usage pattern haven't been re-verified since the host correction (ADR-013, superseded by ADR-014) | **Open.** Verify before treating the first client deliverable as cost-free.                           |

---

## 12. Runbook: testing an ingestion change before it merges

**When.** A PR touches extraction code (`src/ingest/**`) or `config/*.config.ts` and you want a real, live-fetched, gate-checked run before it reaches `main` — not just `npm run ingest -- --dry` against fixtures, and not the risk of the `config/**` push trigger firing a live prod run the moment it merges.

1. Push the branch (or the PR's branch), then dispatch ingest.yml against it:
   ```
   gh workflow run ingest.yml --ref <branch-name>
   ```
   This is ADR-023's preview mode (`env.PREVIEW`, true whenever the dispatched ref isn't `main`): same fetch → extract → validate → diff → gate pipeline as prod, run against that branch's own tip, gated on a real Cloudflare preview — but it never touches `main` and never opens, comments on, or closes a GitHub Issue.
2. `gh run watch` (or the Actions tab) to follow it. The job's **step summary** carries a preview-mode-only "Ingestion preview" block: the pushed branch name, the resolved preview URL, the gate outcome, a `public/data` diffstat, and the alert plan that _would_ fire (printed only — nothing is dispatched).
3. Open the preview URL and eyeball the change. A failed gate leaves the `ingest-preview/<branch>/<run-id>` branch in place for inspection, exactly like a failed prod run leaves its `ingest/<run-id>` branch — check it out and run locally to reproduce.
4. Local-only alternative for quick iteration without CI: `npm run ingest -- --env bluecore --live --only <targetId>` runs the live fetch straight to your working tree (needs `EIA_API_KEY` locally for the one target that needs it, §2); `npm run gate` still needs an actual deployed preview to check against, so it doesn't substitute for step 1 when you need gate check 3.
5. **Clean up.** Preview branches are never deleted automatically (only a successful prod squash-merge deletes its `ingest/*` branch). Periodically sweep stale ones: `git branch -r --list 'origin/ingest-preview/*'` and delete what's no longer needed.

`workflow_dispatch` only ever runs the copy of `ingest.yml` that exists on the default branch, so a change to the workflow file itself (like ADR-023's own introduction of preview mode) has to merge to `main` before it can be dispatched against any other branch.
