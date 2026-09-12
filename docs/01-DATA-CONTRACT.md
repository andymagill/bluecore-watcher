# 01 — Data Contract

The keystone document. This contract constrains the ingestion engine's output and the React application's props simultaneously. Both sides are generated from these types; neither side may extend them privately.

`schemaVersion` is present on every file. Any breaking change increments it and requires a coordinated release of both sides.

---

## 1. Directory layout

```
public/data/
  manifest.json                    # environment metadata + target index
  health.json                      # pipeline health log
  sections/
    target/
      <targetId>.json
    segment/
      <targetId>.json
    regulatory/
      <targetId>.json
    climate/
      <targetId>.json
```

One file per target. This is deliberate:

- **Clean diffs.** A commit touching one source changes one file. Reviewing an ingestion PR shows exactly what moved.
- **Granular fetch.** The SPA loads `manifest.json`, then fetches only the section files it renders.
- **Blast radius.** A malformed write corrupts one target, not the dashboard.

Section directories are named by `sectionId` from config, not hardcoded. The four above are Bluecore's; another environment may define different ones.

---

## 2. `manifest.json`

Fetched first. Everything else is discovered from it.

```json
{
  "schemaVersion": 1,
  "environmentId": "bluecore",
  "displayName": "Bluecore Watcher",
  "generatedAt": "2026-09-11T06:04:12Z",
  "runId": "2026-09-11T06-00-00Z-a1b2c3d",
  "commit": "a1b2c3d",
  "entities": [
    { "id": "bluecore-energy", "name": "Bluecore Energy", "role": "primary" },
    { "id": "competitor-x", "name": "Competitor X", "role": "competitor" }
  ],
  "sections": [
    { "id": "target", "label": "Target Company State", "order": 1 },
    { "id": "segment", "label": "Industry Segment", "order": 2 },
    { "id": "regulatory", "label": "Regulatory Landscape", "order": 3 },
    { "id": "climate", "label": "Market Climate", "order": 4 }
  ],
  "targets": [
    {
      "id": "port-albany-capacity",
      "sectionId": "target",
      "entityId": "bluecore-energy",
      "label": "Port of Albany — Berth Capacity",
      "path": "sections/target/port-albany-capacity.json",
      "ttlHours": 24,
      "lastRunStatus": "ok",
      "lastSuccessAt": "2026-09-11T06:00:09Z"
    }
  ],
  "health": {
    "overall": "degraded",
    "ok": 19,
    "degraded": 2,
    "failed": 1
  }
}
```

`runId` doubles as the cache-buster: the SPA appends `?r=<runId>` to every data fetch, so a fresh `main` build never serves stale JSON from a CDN edge.

---

## 3. Target file

```json
{
  "schemaVersion": 1,
  "targetId": "port-albany-capacity",
  "entityId": "bluecore-energy",
  "sectionId": "target",
  "label": "Port of Albany — Berth Capacity",
  "sourceUrl": "https://example.gov/port/capacity",
  "ttlHours": 24,
  "run": {
    "runId": "2026-09-11T06-00-00Z-a1b2c3d",
    "startedAt": "2026-09-11T06:00:04Z",
    "completedAt": "2026-09-11T06:00:09Z",
    "durationMs": 5120,
    "status": "ok",
    "renderer": "static",
    "httpStatus": 200
  },
  "blocks": [ /* see §4 */ ]
}
```

### `run.status`

| Value | Meaning |
|---|---|
| `ok` | Fetched and every required extractor produced a validated value. |
| `partial` | Fetched, but one or more non-required extractors failed. Successful blocks are fresh; failed blocks carry cached values. |
| `failed_cached` | The run did not produce usable data. **The entire previous file is retained unchanged except `run`**, which records the failure. |

A `failed_cached` run never destroys data. That is the single most important invariant in this contract.

---

## 4. Block envelope

A block is one rendered fact. Every block carries its own provenance — not inherited from the target — because one page may yield values from different DOM regions with different meanings.

```json
{
  "key": "berth_capacity_teu",
  "label": "Berth Capacity",
  "presenter": "metric",
  "type": "number",
  "unit": "TEU",
  "status": "ok",
  "value": 48200,
  "displayValue": "48,200",
  "provenance": {
    "sourceUrl": "https://example.gov/port/capacity#capacity-table",
    "anchor": "#capacity-table tbody tr:nth-child(3) td:nth-child(2)",
    "extractedAt": "2026-09-11T06:00:08Z",
    "rawText": "48,200 TEU",
    "contentHash": "sha256:9f2a…"
  },
  "delta": {
    "previousValue": 46800,
    "previousExtractedAt": "2026-09-04T06:00:07Z",
    "changedAt": "2026-09-11T06:00:08Z",
    "direction": "up",
    "absolute": 1400,
    "percent": 2.99
  },
  "validation": {
    "passed": true,
    "warnings": []
  }
}
```

### Field notes

**`value` / `displayValue`.** `value` is machine-typed (number, ISO date string, markdown source). `displayValue` is the formatted string the UI renders. Formatting happens at ingestion, once, so the client does no locale work and two clients cannot disagree about how a number looks.

**`provenance.rawText`** is the extracted text *before* regex and coercion. When a value looks wrong, this is the first thing anyone reads. Non-optional.

**`provenance.contentHash`** hashes `rawText`. Diffing hashes rather than parsed values catches changes that coercion would flatten (e.g. `"approx. 48,200"` → `"48,200"` both parse to `48200`).

**`provenance.anchor`** is the resolved selector path, not the configured one. If config says `.capacity-table td` and it matched, the anchor records which node — so a future ambiguity failure is diagnosable.

**`delta`** is `null` on first extraction and when `contentHash` is unchanged. `changedAt` is the extraction time at which the value *became* this value, and it survives runs where nothing changed — this is what powers "unchanged for 34 days."

**`validation.warnings`** is non-empty when a change guard quarantined a candidate value. Each warning records the rejected candidate, the guard that rejected it, and the retained value — everything a human needs to adjudicate without re-fetching. See §6.

### `status` (block level)

| Value | Meaning | Renders as |
|---|---|---|
| `ok` | Extracted and validated this run. | Normal |
| `cached` | This run failed; value is from a prior successful run. | Value + failure marker |
| `flagged` | A new value was extracted but quarantined by a change guard. **The displayed value is the prior one**; the candidate is recorded in `validation.warnings` and in the health log for adjudication. | Prior value + caution marker |
| `missing` | Configured but never successfully extracted. | Zero-state |

---

## 5. Freshness state machine (client-side)

Computed in browser memory at render time from `T_now`. Never baked into the data files — a cached build would otherwise lie about age.

**Inputs:** `T_now`, `block.provenance.extractedAt`, `target.ttlHours`, `run.status`, `block.status`, `health.consecutiveFailures`.

Let `age = T_now − extractedAt`, `ttl = ttlHours`, and `ceiling = ttl × 3` (overridable per target).

| State | Condition | UI |
|---|---|---|
| `never` | No block, or `status: missing` | Zero-state placeholder. No value shown. |
| `fresh` | `age ≤ ttl` and `run.status = ok` | Value, neutral badge with relative age. |
| `stale` | `ttl < age ≤ ceiling` | Value, amber badge: "Updated 3 days ago". |
| `expired` | `age > ceiling` | **Value suppressed.** Shows "Last known value from 4 Aug" behind a disclosure. |
| `failing` | `block.status = cached` | Value, red badge, links to Health Modal. Age still shown. |
| `flagged` | `block.status = flagged` | Value, caution marker, links to the warning text. |

`expired` is the answer to a specific failure: a source breaks quietly, nobody fixes it, and six weeks later an analyst reads a number as current. Past the ceiling the dashboard stops asserting the value and starts reporting a historical observation. The distinction matters legally as much as operationally.

`failing` and `stale` can co-occur; `failing` takes display precedence.

---

## 6. Validation and the silent-wrong problem

A selector that throws is caught by the health log. A selector that still matches but now resolves to the **wrong node** publishes a confident, sourced, wrong number. For a product whose entire pitch is determinism, this is the only defect class that actually threatens the business.

Three layers, all configured per extractor (see `02-CONFIG-SCHEMA.md`):

1. **Shape assertions** — `min`, `max`, `pattern`, `maxLength`, `notEmpty`, `enumValues`. A capacity figure that arrives as `0` or `1.2e9` is rejected before it is written.
2. **Ambiguity detection** — if a selector matches more than one node and the config did not declare `multiple: true`, that is `SELECTOR_AMBIGUOUS`, not a silent first-match. A page redesign that duplicates a class name is caught the day it happens.
3. **Change-magnitude guards** — `maxChangePct`, `maxChangeAbs`, `expectMonotonic`. A value that moves more than the configured tolerance is **not published**. The prior value is retained, the block is marked `flagged`, and a health entry records both figures for human adjudication.

Guard failures write `validation.warnings`; hard assertion failures produce `ASSERTION_FAILED` and retain cache. The difference: a warning still publishes, a failure does not.

Tuning is expected to be iterative — start permissive, tighten as you learn each source's real volatility. A guard that fires constantly is worse than no guard, because people learn to ignore it.

---

## 7. `health.json`

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-11T06:04:12Z",
  "runId": "2026-09-11T06-00-00Z-a1b2c3d",
  "summary": {
    "targets": 22,
    "ok": 19,
    "degraded": 2,
    "failed": 1,
    "oldestDataAgeHours": 73,
    "targetsPastCeiling": 0
  },
  "entries": [
    {
      "targetId": "port-albany-capacity",
      "extractorKey": "berth_capacity_teu",
      "status": "failed",
      "errorClass": "SELECTOR_NO_MATCH",
      "message": "Selector matched 0 nodes",
      "failingSelector": "#capacity-table tbody tr:nth-child(3) td:nth-child(2)",
      "httpStatus": 200,
      "firstSeenAt": "2026-09-04T06:00:07Z",
      "consecutiveFailures": 7,
      "servingCachedFrom": "2026-09-03T06:00:07Z",
      "stack": "Error: …"
    }
  ]
}
```

`firstSeenAt` and `consecutiveFailures` persist across runs — they are the maintenance backlog. A failure at 7 consecutive runs is a different conversation from one at 1.

### Error taxonomy

Fixed set. Anything not classifiable is `UNKNOWN`, and an `UNKNOWN` appearing in production is itself a defect to be triaged into the list.

| Code | Cause | Typical fix |
|---|---|---|
| `NETWORK_ERROR` | DNS, TLS, connection reset | Retry; investigate if persistent |
| `TIMEOUT` | Exceeded per-target budget | Raise budget or switch renderer |
| `HTTP_ERROR` | Non-2xx that isn't a block signal | Check URL drift |
| `BLOCKED` | 403, 429, or captcha heuristic | Evidence for the proxy decision (ADR-006) |
| `AUTH_ERROR` | 401, or missing secret env var | Rotate or set credential |
| `SELECTOR_NO_MATCH` | Matched 0 nodes | Repair selector |
| `SELECTOR_AMBIGUOUS` | Matched >1 without `multiple: true` | Tighten selector |
| `PARSE_ERROR` | Regex missed, or coercion failed | Fix regex or `type` |
| `ASSERTION_FAILED` | Shape assertion rejected the value | Investigate source, then retune |
| `CHANGE_GUARD_TRIPPED` | Moved beyond tolerance | Human adjudication |
| `SCHEMA_INVALID` | Output failed its own JSON Schema | Engine defect — always a bug |
| `UNKNOWN` | Unclassified | Triage into this table |

`BLOCKED` is separated from `HTTP_ERROR` on purpose: it is the evidence base for whether the edge proxy solves a real problem.

---

## 8. Invariants

Non-negotiable properties. Each should have a test.

1. A failed run never deletes or blanks a previously good value.
2. Every rendered value has a `sourceUrl`, an `anchor`, an `extractedAt`, and a `rawText`.
3. Freshness is computed at render time, never at build time.
4. Data files validate against their JSON Schema before merge, and an invalid file blocks the merge.
5. `main` only ever contains data that has been proven to render.
6. No block is published with a value that failed a hard assertion.
7. Every file is deterministic given the same input: key order stable, timestamps the only expected churn. A run that changes nothing produces a zero-line diff.

Invariant 7 matters more than it looks. Non-deterministic serialization produces noisy diffs, noisy diffs make ingestion PRs unreviewable, and unreviewable PRs quietly become auto-merged — at which point the audit trail is decorative.
