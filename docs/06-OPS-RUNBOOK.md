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

| Name                   | Purpose                                   |
| ---------------------- | ----------------------------------------- |
| `CLOUDFLARE_API_TOKEN` | Preview URL resolution in the gate        |
| `INGEST_PSK`           | Edge relay authentication                 |
| `<SOURCE>_API_KEY`     | Per authenticated source, named in config |

All GitHub Actions repository secrets. Never in config — config is committed, and a literal-secret pattern scan runs in CI (validation rule 11).

Error text and `rawText` are scrubbed against active secret values before being written to `health.json`. A token echoed in a 401 body would otherwise land permanently in the Git history that serves as the audit trail.

---

## 3. Runbook: a selector broke

The routine failure. Expect these weekly.

**Symptom.** Health entry with `SELECTOR_NO_MATCH` or `SELECTOR_AMBIGUOUS`; block serving `cached`.

1. **Triage by age.** `consecutiveFailures` ≤ 2 on a flaky source may self-resolve. Above 3, fix it.
2. **Read `notes`** on the target config. Past-you may have already predicted this.
3. **Capture a fresh fixture.** `npm run fixture:capture <targetId>` — do not fix a selector against the live page.
4. **Diff old fixture against new.** This shows what actually changed.
5. **Repair.** Hand-write the selector, or run the LLM repair tool (ADR-003) to propose candidates. Either way it arrives as a PR.
6. **Test.** Unit test against both fixtures — the new one must pass, the old one is kept as a regression case.
7. **Merge.** The next scheduled run picks it up; force one with `workflow_dispatch` if it matters.

**Prefer resilient selectors.** Match on a label cell, a `data-` attribute, or text content rather than `nth-child`. Positional selectors are the ones that break.

---

## 4. Runbook: a change guard tripped

**Symptom.** `CHANGE_GUARD_TRIPPED`; block `flagged`; value withheld.

This is the system working. A number moved more than its configured tolerance and is waiting for a human.

1. Open the source page. Is the new value real?
2. **Real, and a one-off** (ADR-012) → add an entry to the committed acknowledgements file, keyed by `targetId.extractorKey` and the candidate's `contentHash`. Merge; the next run publishes that exact candidate and consumes the entry. The guard's tolerance is untouched, so it still catches the _next_ anomalous move at the same target.
3. **Real, and the source's normal volatility has changed** → widen `maxChangePct`, merge, re-run. Reserve this for when the guard was tuned too tight for how this source actually behaves, not for a single legitimate spike — widening on every real move ratchets the guard toward meaningless over time.
4. **Wrong** → you just caught a silent-wrong before it published. Repair the selector per §3.

If a guard trips repeatedly on legitimate movement, retune it (step 3) immediately. A guard people learn to dismiss is worse than no guard at all, because it launders real failures into routine noise.

---

## 5. Runbook: a source started blocking

**Symptom.** `BLOCKED` — 403, 429, or a captcha heuristic.

1. **Do not retry.** The pipeline already knows not to; don't do it by hand either.
2. Check `robots.txt` — did the source's policy change?
3. Lower the cadence and raise `politeness.minIntervalMs`. Most blocks are rate-based and this alone fixes them.
4. Confirm the User-Agent is identifying and carries a contact URL.
5. If it persists, set `proxy: "edge"` on that target and measure. **This is the evidence ADR-006 is waiting for** — record whether it actually helped, per source. Two or three data points settle the question.
6. If the relay does not help, the source is doing real bot detection. At the near-zero-cost constraint, the honest answers are: negotiate access, find an alternative source, or drop it. Do not escalate into an arms race.

---

## 6. Runbook: the gate failed

**Symptom.** Ingestion run exits non-zero, branch left open, production untouched.

Correct behaviour — production is serving the last good data. No urgency beyond data ageing.

- `SCHEMA_INVALID` → engine defect. Always a bug, never a source problem.
- **Contract assertion failed** → likely a value was blanked that shouldn't have been. Serious; investigate before merging anything.
- **Smoke render failed** → either the app cannot render valid data (frontend bug) or block counts disagree (the UI is silently dropping data). The second is the dangerous one.

The branch is a complete reproduction. Check it out, run locally, fix forward. Never merge past a failed gate to "unblock" — that discards the only guarantee the architecture makes.

---

## 7. Maintenance expectations

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

## 8. Onboarding a new environment

The ADR-001 test. Target: one afternoon (open question Q8).

1. `config/<envId>.config.ts` — entities, sections, targets, extractors.
2. Capture a fixture per target; write extractor unit tests.
3. Set secrets for authenticated sources.
4. `npm run validate:config`.
5. Dry run: `npm run ingest -- --env <envId> --dry` — writes nothing, prints what it would extract.
6. Tune assertions from the dry run's real values rather than guesses.
7. Enable the cron; watch the first three runs.

If any step requires touching application code, ADR-001 is violated and the schema needs to absorb the difference.

---

## 9. Unresolved operational risks

| Risk                                                                                                                    | Status                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No authentication — deployment is public (ADR-004)                                                                      | **Open.** Do not ingest anything damaging if crawled, until auth ships.                                                                                                                           |
| robots.txt / ToS posture unwritten (Q6)                                                                                 | **Deferred to M3/M4 by decision.** `respectRobotsTxt` defaults to `true` until then. Needed before any client deliverable.                                                                        |
| Git retention past ~2,000 commits (Q7)                                                                                  | Deferred.                                                                                                                                                                                         |
| Single operator — no coverage                                                                                           | Accepted for now. The `notes` field and this runbook are the mitigation.                                                                                                                          |
| Edge relay unvalidated (ADR-006)                                                                                        | Gathering evidence via §5.                                                                                                                                                                        |
| Cloudflare's actual free-tier terms for this usage pattern haven't been re-verified since the host correction (ADR-013) | **Open.** The retired Vercel-specific finding (Hobby tier prohibits commercial use, forcing Pro at M4) does not necessarily transfer to Cloudflare Pages. Verify before treating M4 as cost-free. |
