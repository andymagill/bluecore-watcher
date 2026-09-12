# 04 — Frontend

React + Vite + Tailwind + Radix UI primitives, compiled to a static SPA. No runtime data fetching beyond same-origin JSON. No client-side routing in v1 — the dashboard is one view plus a modal.

---

## 1. Data loading

```
mount → fetch manifest.json?r=<cachebust>
      → fetch every sections/<id>/<target>.json in parallel
      → fetch health.json
      → render
```

The cache-buster is `manifest.runId`, which requires a two-step load: fetch the manifest with a short-cache header, then use its `runId` to query-bust every section file. Section files can then be served with long cache lifetimes and still never go stale — a CDN edge holding yesterday's JSON is otherwise a silent correctness bug that looks exactly like a scraper failure.

Each section file loads independently. One 404 renders that target's zero-state; it does not blank the dashboard.

No state library. `useState` in an app shell, passed down. The data is read-only and loaded once — anything more is overhead.

---

## 2. Component inventory

| Component           | Responsibility                                                       |
| ------------------- | -------------------------------------------------------------------- |
| `AppShell`          | Loads data, holds state, renders header + grid                       |
| `HeaderBar`         | Entity names, global health pill, last-run timestamp                 |
| `HealthPill`        | `ok` / `degraded` / `failed` from `manifest.health`; opens the modal |
| `SectionGrid`       | Renders sections by `order`                                          |
| `SectionPanel`      | Section label, description, target cards                             |
| `TargetCard`        | One target: label, source link, run status, its blocks               |
| `MetricBlock`       | Large value, unit, label, delta chip, freshness badge                |
| `MarkdownBlock`     | Narrative prose via markdown parser, sanitised                       |
| `ListBlock`         | Bulleted items, per-item anchors                                     |
| `StatusBlock`       | Enum rendered as a coloured pill                                     |
| `FreshnessBadge`    | Computes and renders the freshness state                             |
| `DeltaChip`         | Direction arrow, magnitude, "changed N days ago"                     |
| `ProvenancePopover` | Source URL, anchor, `extractedAt`, `rawText`                         |
| `ZeroState`         | Explicit placeholder for missing data                                |
| `HealthModal`       | Full health log: failing selectors, error classes, stacks            |
| `ErrorBoundary`     | Per-section, so one bad block cannot blank the board                 |

`ErrorBoundary` at section granularity matters: the smoke render gate asserts the app mounts without an error boundary trip, so a boundary wrapping the whole app would let a single malformed block fail the entire run.

---

## 3. Freshness rendering

Implements the state machine in `01-DATA-CONTRACT.md` §5. Computed at render from `Date.now()`, never precomputed.

| State     | Badge                            | Value                          |
| --------- | -------------------------------- | ------------------------------ |
| `fresh`   | Neutral, relative age            | Shown                          |
| `stale`   | Amber, "Updated 3 days ago"      | Shown                          |
| `expired` | Grey, "Last verified 4 Aug"      | **Hidden** behind a disclosure |
| `failing` | Red, links to Health Modal       | Shown, marked                  |
| `flagged` | Caution marker, links to warning | Shown, marked                  |
| `never`   | —                                | `ZeroState`                    |

`expired` is the important one. Past the stale ceiling the UI stops presenting the value as current and presents it as a historical observation with a date. An analyst should not be able to misread a six-week-old number as today's, and the interface — not a footnote — is what enforces that.

Recompute on an interval (60s) and on tab focus, so a dashboard left open overnight ages correctly rather than freezing at its load-time state.

---

## 4. Deltas

`DeltaChip` renders from `block.delta`:

- Changed recently: direction arrow, magnitude, "3 days ago".
- Unchanged: "unchanged for 34 days", from `delta.changedAt`.
- `delta: null`: nothing rendered. First observations get no chip.

The unchanged case is doing real work — for a docket status or a permit state, "nothing has moved in five weeks" is often the finding.

Colour encodes direction only, never sentiment. The engine has no idea whether a rising number is good news, and a green up-arrow on a competitor's capacity would assert a judgement the system cannot make.

---

## 5. Provenance

Every value is one interaction from its source. `ProvenancePopover` shows:

- `sourceUrl` as a live link (new tab, `rel="noopener"`).
- `anchor` — the resolved selector path.
- `extractedAt`, absolute and relative.
- `rawText` — the text before parsing.

`rawText` in the UI is worth the pixels. When an analyst doubts a number, "the page said `approx. 48,200 TEU` and we parsed 48200" resolves it immediately. Hiding it behind a support request does not.

---

## 6. Health Modal

Reads `health.json`. Grouped by status, sorted by `consecutiveFailures` descending.

Per entry: target label, extractor key, error class, message, failing selector, `firstSeenAt`, `consecutiveFailures`, and the age of the cached value being served. Stack traces behind a disclosure — useful to the operator, noise to the analyst.

This modal is client-facing. It is the mechanism by which the product admits what it does not know, and that admission is a large part of the trust proposition. Write the copy for an analyst, not for a developer: "Source page changed structure on 4 September; we're showing the last verified value" beats a raw `SELECTOR_NO_MATCH`.

Open question Q4 lives here: a source broken for six weeks needs to look different from one broken since this morning. `consecutiveFailures` gives the signal; the design needs to use it.

---

## 7. Accessibility and presentation

- Freshness and status never encoded by colour alone — always paired with text or an icon.
- Full keyboard navigation; the modal traps focus and restores it on close.
- Contrast ratios ≥ 4.5:1 in both themes.
- Dense by design, but numbers get a tabular-figures font so columns align.
- Print stylesheet: this will be screenshotted into diligence memos. Make that output not embarrassing — provenance visible, badges legible in greyscale.

---

## 8. What is deliberately absent

- **Time-series charts.** Deltas, not history. The data model supports adding them later; the v1 scope does not.
- **Filtering, search, sorting.** At ~20 targets the grid is scannable. Add when it isn't.
- **Editing anything.** The dashboard is read-only. Config changes are pull requests.
- **Client-side routing.** One view, one modal.
- **Any runtime LLM call.** ADR-003.
