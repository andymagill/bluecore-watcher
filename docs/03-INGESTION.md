# 03 — Ingestion Pipeline

Implements ADR-005. Supersedes SPEC Part 3 §5 and Part 5.

The central property: **`main` only ever contains data that has been proven to render.** Everything below exists to preserve that.

---

## 1. Run lifecycle

```
 cron ──► plan ──► fetch ──► extract ──► validate ──► diff ──► persist
                                                                 │
                                                                 ▼
                                                      branch + push
                                                                 │
                                                                 ▼
                                              Cloudflare Workers preview deploy
                                                                 │
                                                                 ▼
                                          ┌──────── GATE ────────┐
                                          │ schema validation    │
                                          │ smoke render         │
                                          └──────────┬───────────┘
                                              pass   │   fail
                                                     │
                                        squash-merge │ leave branch,
                                         → main      │ open issue,
                                                     │ main untouched
                                                     ▼
                                            production rebuild
```

### plan

Read config. For each target compute `dueAt` from `schedule.cron` and `manifest.targets[].lastSuccessAt` / `.lastRunStatus` — **not** `health.json`, which has no entry for a target that has only ever succeeded and so cannot answer "when did this last run" (see `01-DATA-CONTRACT.md` §2). Build the queue from targets that are due, plus any whose data age exceeds `ttlHours` regardless of cron — a target that has been failing should be retried even between scheduled slots.

Apply `jitterSeconds`. Group by host so `politeness.minIntervalMs` can be enforced per host rather than globally.

Emit the plan to the run log before fetching. A run that fetched nothing should say why.

### fetch

- `renderer: "static"` → `undici` + Cheerio. Default, and should stay the overwhelming majority.
- `renderer: "browser"` → Playwright Chromium, one shared browser instance per run, one context per target. Browser targets are ~20× the cost of static ones in CI minutes; treat each one as a decision, not a default.
- `proxy: "edge"` → route through the relay with the PSK header (ADR-006).
- Timeouts and retries from `defaults`. Retry only on `NETWORK_ERROR`, `TIMEOUT`, and 5xx. **Never retry a 403 or 429** — that converts a `BLOCKED` signal into a ban.
- Honour `respectRobotsTxt`, cached per host per run.

Store the raw response body as a run artifact (not committed) so a failed extraction can be diagnosed without re-fetching a page that may have already changed.

### extract

Per extractor, in config order:

1. Locate (`selector` / `jsonPath` / `pageRange` + `textAnchor`).
2. **Count matches.** More than one without `multiple: true` → `SELECTOR_AMBIGUOUS`, stop. This check is not optional; it is the cheapest silent-wrong defence in the system.
3. Capture `rawText` before any transformation.
4. Apply `regex` / `regexGroup`, then `trim`.
5. Coerce to `type`. Failure → `PARSE_ERROR`.
6. Format `displayValue` using `locale`, `unit`, `currency`.
7. Record `provenance`, including the **resolved** anchor and `contentHash` of `rawText`.

Extractor failures are isolated. One broken extractor among ten produces `run.status: partial`, not a lost target — unless it is `required: true`.

### validate

Per `01-DATA-CONTRACT.md` §6:

- Shape assertions (`min`, `max`, `pattern`, `maxLength`, `notEmpty`, `enumValues`, `minItems`/`maxItems` for `list`). Failure → `ASSERTION_FAILED`, retain cached value, block `status: cached`.
- Change-magnitude guards (`maxChangePct`, `maxChangeAbs`, `expectMonotonic`; for `list`, applied to item count per `01-DATA-CONTRACT.md` §4.1) against the previous committed value. Before quarantining, check the committed acknowledgements file (ADR-012) for an entry matching `targetId.extractorKey` + this candidate's `contentHash` — a match publishes the value and consumes the entry. Otherwise, trip → `CHANGE_GUARD_TRIPPED`, **do not publish**, block `status: flagged`, health entry carries both figures for adjudication.

The asymmetry is deliberate: a hard assertion rejects, a change guard quarantines (subject to acknowledgement).

### diff

Compare `contentHash` against the previous committed file.

- Unchanged → carry `delta` and `changedAt` forward untouched. This is what makes "unchanged for 34 days" possible.
- Changed → compute `delta`, set `changedAt` to this extraction time.
- First extraction → `delta: null`.

Then evaluate `alert`. Alerts are computed here, written to a run artifact, and dispatched **after** a successful merge — never before. Alerting on data that then fails its gate and never reaches production would be worse than not alerting.

### persist

Compute a **semantic fingerprint** for the run (ADR-011): per block, `key` + `status` + `contentHash` + typed `value`; per target, `label`/`sourceUrl`/`ttlHours`; plus the health entry set including `consecutiveFailures` — explicitly excluding `runId` and every timestamp. Compare against the fingerprint of the previous committed state.

- **No fingerprint changed** → write nothing, exit 0, no branch (§2 step 4). This is the common case on a slow-moving source set.
- **Something changed** → write `manifest.json`, `health.json`, and each changed `sections/<sectionId>/<targetId>.json`. Serialization is stable: sorted keys, 2-space indent, trailing newline. `firstSeenAt`/`consecutiveFailures` in the new `health.json` are computed from the **previous committed** health plus this run's artifact, so a run that never reaches `main` (gate failure) cannot erase the backlog it was reporting.

Per invariant 7 (`01-DATA-CONTRACT.md` §8, restated under ADR-011), determinism means _no semantic change → no commit_ — not that timestamps never move within a commit that does happen. `provenance.extractedAt` on every fetched target advances honestly; that is expected content in a run that does write.

Targets not in this run's queue are left byte-identical.

---

## 2. Git write protocol

```yaml
concurrency:
  group: ingest
  cancel-in-progress: false
```

Serialized. Two overlapping runs both forking from `main` is a merge conflict in files nobody wants to hand-resolve at 06:00.

1. Checkout `main` (shallow, `--depth=1`).
2. Create `ingest/<runId>`.
3. Run the orchestrator.
4. **If no fingerprint changed (ADR-011), exit 0 with no branch.** Most runs on a slow-moving source set should end here.
5. Commit with a message summarising the run: `data: 3 targets updated, 1 failed (runId)`.
6. Push the branch. Cloudflare Workers builds a preview.
7. Run the gate (§3).
8. Pass → squash-merge into `main`, delete branch, dispatch alerts for the merged diff (§4). Fail → leave the branch, dispatch (or update) the single deduped pipeline-failure issue (§4), exit non-zero.

A failed gate leaves production serving the last good data. That is the correct failure mode and it is strictly better than the SPEC's original design, where bad data reached the origin with nothing standing in between.

---

## 3. The gate

A preview deploy that nothing checks is ceremony. Three checks, all blocking — **built in two stages** (amended ADR-005). Checks 1–2 are offline and ship with the engine spine, before any real target or Cloudflare Workers deployment exists. Check 3 needs an actual preview URL and a SPA to render, so it ships alongside the first real target. "`main` only contains data proven to render" holds at both stages; check 3 is what extends the proof to the real deployed artifact.

**1. Schema validation (offline).** Every written file validates against the generated JSON Schema. A failure here is `SCHEMA_INVALID` and always an engine defect, never a source problem.

**2. Contract assertions (offline).** The invariants from `01-DATA-CONTRACT.md` §8 as executable tests. Chiefly: no previously-good value was blanked, and every published block has complete provenance.

**3. Smoke render (against the preview URL).** Load the preview in headless Chromium. Assert:

- `manifest.json` returns 200 and validates.
- Every `target.path` in the manifest returns 200.
- The dashboard mounts without hitting an error boundary.
- The count of rendered blocks matches the count of published blocks. _This catches the failure where data is schema-valid but the UI silently drops it._
- No console errors.

Check 3 is the one worth the complexity. It is a real integration test of the exact artifact, for free, on every run.

---

## 4. Alerting

**Dispatched post-merge, from a diff of two committed states — not the run artifact** (ADR-019, M3a; amends the original wording here, which predated the implementation). `scripts/alert-dispatch.ts --env <id> --from <sha> --to <sha> --issues` runs inside the same ingest job, right after the squash-merge (§2 step 8): it loads `public/data` as committed at `--from` (the job's base commit) and `--to` (the merge it just made) via two `git show`-backed readers into `src/ingest/persist.ts`'s `loadPreviousState`, and hands both states to `src/alerts/plan.ts`'s `planAlerts()` — a pure function, evaluated against the _current_ config's alert rules, not whatever was configured historically at either commit. Running after the merge, never before, is deliberate: alerting on data that then fails its gate and never reaches `main` would be worse than not alerting at all. The same invocation is safe to replay offline against any two historical shas for testing.

v1 channel is `github-issue` (ADR-004, Q5): zero cost, zero new infrastructure, GitHub handles delivery and threading. Health alerts are one issue per `targetId` (`Health: <targetId>`); value alerts are one issue per `targetId.extractorKey` (`Alert: <targetId>.<extractorKey>`) — reopened rather than duplicated, labelled `alert` plus `severity:<level>`.

Operator-only in v1. Client-facing alerting waits on auth, because an alert containing a value is a data disclosure through an unauthenticated channel.

Noise controls, in order of importance:

- `alert.on` defaults to `never`. Alerting is opt-in per extractor. This is the main control and it should stay conservative.
- `alerting.minSeverity` filters out anything below it (default `warn`) — both value and health alerts.
- `quietHours` suppresses a value alert's repeats for the same key, measured against GitHub's own `updatedAt` on that key's issue.
- Health-derived alerts fire on the _transition_ to failing and again at 3 and 7 consecutive failures — not every run. A source that fails 30 times should generate 3 notifications, not 30.
- A value alert only ever fires on a block actually published this run (`status: "ok"`) — anything else (`cached`/`flagged`/`missing`) already has a health alert covering it, and a value that didn't actually get republished has nothing to alert about.

**Pipeline-gate failures are a separate, single deduped issue**, not a value/health alert: `alert-dispatch.ts --pipeline-failure <offline|gate> --run-url <url> --issues` keeps exactly one `Pipeline: ingestion gate failed` issue, commenting on repeats rather than opening a new one per failing run (§2 steps 4 and 7's failure paths both call this), and closing itself the next time a merge succeeds.

A `CHANGE_GUARD_TRIPPED` health alert's body includes a ready-to-paste ADR-012 acknowledgement entry, built from the quarantined candidate's `contentHash` (`validation.warnings[].rejectedContentHash`, `01-DATA-CONTRACT.md` §4) — the operator can paste it straight into `config/acknowledgements.json` without re-running ingestion locally to find the hash.

---

## 5. Testing

Scrapers cannot be tested against live sites — it's slow, rude, and non-deterministic.

**Fixtures.** Every target keeps a captured response under `fixtures/<targetId>/`. Extractor unit tests run against fixtures, offline, in milliseconds. A repaired selector must pass against a _newly captured_ fixture, and the old one is kept — that pair is the regression test.

**Golden files.** Each fixture has an expected output file. Extraction changes show as a reviewable diff.

**Contract tests.** The invariants in §8 of the data contract, run in the gate.

**Weekly drift check (M2b, `src/drift/`, `scripts/drift-check.ts`, `.github/workflows/drift.yml`).** A Monday cron job fetches each target's live response with the same `HttpFetcher` a real ingestion run uses and compares it against the committed fixture, per extractor and for the response as a whole — even when extraction still succeeds. This is the early-warning system for silent-wrong: it catches the redesign _before_ the selector starts matching the wrong node. It deliberately reruns the real `extractOne` against both documents rather than parsing independently, so a finding here means the real pipeline would see the same thing.

Five signals, none of them a run failure:

- `EXTRACTION_BROKEN` — an extractor that succeeds against the fixture throws against the live response.
- `ANCHOR_MOVED` (`html` only) — the selector still matches, but the resolved node's position (`01-DATA-CONTRACT.md` §4's anchor) shifted, meaning the page structure around it changed even though the match survived.
- `TYPE_CHANGED` (`api` only) — the extractor's `jsonPath` resolves to a different raw JS type live than in the fixture (checked before `coerce.ts` normalizes it to the extractor's declared `type`, which would otherwise mask the change).
- `STRUCTURE_CHANGED` — the whole response's structural fingerprint (`src/drift/structure.ts`: HTML tag/class parent-child pairs, or JSON key paths with array indices collapsed) drops below 80% similarity to the fixture, independent of any single extractor.
- `FETCH_FAILED` — the live fetch itself failed. Informational only, and never treated as drift — real ingestion's health log already owns fetch failures (§1 "fetch").

A changed **value** is never drift by itself; only these five signals are. One GitHub Issue per drifting target (label `drift`, title `Drift: <targetId>`), created/updated/auto-closed by `src/drift/issues.ts`'s pure `planIssueSync` — never duplicated, and closed automatically once a target comes back clean.

The drift check is the highest-leverage test in this list and the one easiest to skip. Don't.

---

## 6. Secrets

- Stored as GitHub Actions repository secrets, referenced by name from config.
- Injected as env vars; `${ENV_VAR}` in `headers`/`url` is interpolated at run time only.
- Never written to any committed file. `rawText` and error messages are scrubbed against the active secret values before being written to any committed file — a bearer token echoed in an error response would otherwise be committed to a Git history that is the audit trail.
- A missing secret skips its target with `AUTH_ERROR`. It does not fail the run.

---

## 7. Cost and scale

| Dimension       | Estimate                                        | Pressure point                                                                                |
| --------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| CI minutes      | ~2 min/run static-only; +40s per browser target | GitHub free tier is 2,000 min/month — one daily run with a few browser targets is comfortable |
| Commits         | 1 squashed commit per run with changes          | ~365/year daily; revisit at ~2,000 (Q7)                                                       |
| Repo size       | JSON only, kilobytes per run                    | Fixtures dominate — keep them trimmed, not whole-page dumps                                   |
| Preview deploys | 1 per run with changes                          | Within Cloudflare Workers free-tier limits at daily cadence                                   |

Hourly cadence changes this picture materially — ~8,760 commits/year and 8,760 preview builds. If a source genuinely needs hourly polling, that is the moment to reconsider whether the gate should run on every cycle or on a batched one.
