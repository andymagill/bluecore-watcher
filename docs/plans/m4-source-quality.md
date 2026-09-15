# M4 — Source quality: content-depth — plan

Implements the milestone in `07-ROADMAP.md` M4: three existing source types gain substantive content alongside their existing volume/scalar metrics, and one dashboard-occupying target is retired. Exit test: Company, Competitive, and Regulatory sections show substantive (non-numeric) content; standard verification passes.

## How to use this doc

Only the workstream marked **Next** below gets implemented in a given conversation — the others are design only, for a future conversation to pick up cold. Each workstream:

1. Confirms its own prerequisites checklist below.
2. Branches off `main` (`origin/main`, not a stale local branch).
3. Commits per verified phase, not once at the end.
4. Runs the standard verification (format/lint/typecheck/schema/validate-config/test) plus `npm run fixture:verify -- --env bluecore`.
5. Updates the status table below and the M4 section of `07-ROADMAP.md` on completion.

## Status

| Workstream                                     | Status      | PR  |
| ---------------------------------------------- | ----------- | --- |
| M4a — Composite/indexed api location (ADR-022) | Delivered   | —   |
| M4b — FR + SEC extractor upgrades              | Not started | —   |
| M4c — Retire `bluecore-form-d`, close out M4   | Not started | —   |

## Context / findings (all of M4)

- **FR fixtures are already newest-first, single-record.** `fr-nrc-smr`/`fr-doe-nuclear`/`fr-smr-mentions` fetch `per_page=1&order=newest`, so `$.results[0].title`/`.type`/`.publication_date`/`.html_url`/`.agencies[0].name` resolve directly with the existing simple `jsonPath` shape — no engine change needed for FR. (Verified against the live fixtures during M4a's exploration: `results[0]` carries `title`, `type`, `abstract`, `document_number`, `html_url`, `pdf_url`, `publication_date`, `agencies[]`.)
- **SEC's `filings.recent` is parallel arrays, not per-filing objects**, and the row of interest isn't at a fixed index — Oklo's `form[0]` is a `424B5`; its most recent `8-K` is at `form[1]`. JSONPath can find the matching index (`$.filings.recent.form[?(@ === "8-K")]~` → array of matching indices, confirmed live) but can't join that index into a sibling array by position — a filter predicate referencing `@root` throws in jsonpath-plus's safe-eval sandbox (confirmed live, jsonpath-plus 10.4.0). This is why M4a exists: the engine needed a real feature (ADR-022), not just new config.
- **SEC item codes are bare** (`"1.01,1.02,9.01"`, comma-joined, no labels) — a human-readable rendering needs a code→label vocabulary, which belongs in config (`valueMap`), not code (ADR-001).
- **`bluecore-form-d`'s URL is pinned to one immutable accession number.** It can never observe BlueCore's next Form D on its own (that's what M2b's `bluecore-sec-filings` companion target exists to catch) — a value alert on it essentially cannot fire. Retiring it (M4c) rather than adding a "hidden" display concept keeps the engine surface smaller; `writeAll` (`src/ingest/persist.ts`) never deletes orphaned target files, so removing the target from config needs a manual delete of its committed data file too.
- **`config/example.config.ts` was deliberately not extended with a composite target in M4a.** `tests/orchestrate.integration.test.ts` hardcodes target/block counts (`toHaveLength(3)`, `toBe(5)`) against it; adding a synthetic composite target there would mean bumping those counts for coverage `tests/api-composite.test.ts` (15 cases, including a full `processExtractor` → contract `Block` schema round trip) already provides more precisely. `example-sec-submissions`/`example-regulatory-api` (named in `07-ROADMAP.md`'s M4 testing-approach line) are M4b's fixtures, built alongside the real FR/SEC config they test.

## Decisions

| Topic                      | Decision                                                                                                                                                                                                                                                                                                                                                      | Workstream      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| SEC depth                  | Full composite feature: row-binding (`index`), template composition, and config-level code→label vocabularies (`valueMap`). Chosen over a config-only or row-bind-only approach because the join-across-arrays problem is real and belongs in the engine (ADR-001), and item codes are unreadable without labels.                                             | M4a             |
| Form D                     | Retire the target entirely (not a "hidden from dashboard, still ingested" flag). Its only remaining job — noticing a new Form D exists — is already `bluecore-sec-filings`'s job, and M4b's SEC upgrade absorbs the primary-document link. A hidden-display concept is real engine surface for a target that has no remaining reason to run.                  | M4c             |
| M4 exit scope              | Amended from "all four sections" to Company/Competitive/Regulatory. M4 never touches Market Conditions (EIA price + period only); M5's SAM.gov work is what gives Market its substantive-content source, and M5 already carries the four-section exit criterion.                                                                                              | — (roadmap doc) |
| Workstream split           | Engine first: M4a ships the composite-location capability and proves it generically (synthetic fixtures + the real bluecore config's `fixture:verify` staying green) before any FR/SEC config uses it. M4b then spends the feature on real targets; M4c is cleanup + close-out, split out because it touches ops docs/data files rather than extractor logic. | —               |
| `config/example.config.ts` | Not extended with a composite target in M4a (see Context above) — `tests/api-composite.test.ts` is the engine proof; M4b's `example-sec-submissions` fixture is the "real shape, entity-agnostic" proof once FR/SEC configs exist to test.                                                                                                                    | M4a             |

---

## M4a — Composite/indexed api location (ADR-022)

**Delivered.** See ADR-022 in `00-DECISIONS.md`, `02-CONFIG-SCHEMA.md` §3/rule 13, and `03-INGESTION.md`/`01-DATA-CONTRACT.md`'s composite-location notes for the full design.

**Summary of what shipped:**

- `src/config/schema.ts`: `ApiFieldDef`, `ApiIndexDef`, `ApiLocation` grows `index`/`fields`/`template` alongside `jsonPath` (mutually exclusive, rule 13).
- `src/ingest/extract/compose.ts` (new): pure strip → split → valueMap → join → escape per field, then template fill.
- `src/ingest/extract/api-handler.ts`: `locateComposite`, `resolveApiPaths` (drift support).
- `src/ingest/extract/types.ts`: `LocateResult.texts` (optional) — what regex/coercion narrows, when it differs from what's hashed/stored.
- `src/ingest/extract/locator.ts` (new): `extractorLocatorOf`, replacing the `kind === "html" ? selector : jsonPath` ternary at three call sites.
- `src/drift/check.ts`: `TYPE_CHANGED` iterates `resolveApiPaths`.
- `src/repair/relocate.ts`/`score.ts`: composite/indexed extractors are explicitly unsupported for auto-repair (new `"unsupported"` `CandidateStatus`).
- Tests: `tests/api-composite.test.ts` (15 cases), plus additions to `tests/config-schema.test.ts` (13 rule-13 cases), `tests/drift.test.ts` (2 cases), `tests/repair.test.ts` (2 cases). Full suite 205/205.
- Verified additive: `npm run fixture:verify -- --env bluecore` reports all 10 real targets unchanged (zero golden drift).

**Prerequisites for M4b:** this workstream merged to `main`.

---

## M4b — FR + SEC extractor upgrades

**Not started.** Design below; the implementer should re-verify every live shape against the actual API before writing config, the way M4a's exploration did.

### Federal Register (`fr-nrc-smr`, `fr-doe-nuclear`, `fr-smr-mentions`)

No engine feature needed — `results[0]` already resolves directly. Add per target, alongside the existing count extractor:

- `latest_document_title` — `presenter: "markdown"`, `type: "string"`, `jsonPath: "$.results[0].title"`, `assert: { notEmpty: true, maxLength: 300 }`. Consider composing a link (`[title](html_url)`) — if so, this becomes a **simple two-field composite** (`fields: { title, url }`, `template: "[{title}]({url})"`, no `index` needed since there's only one row) rather than plain markdown text, so the dashboard links straight to the document.
- `latest_document_type` — `presenter: "status"`, `type: "enum"`, `enumValues` drawn from FR's own documented type vocabulary (`Rule`, `Proposed Rule`, `Notice`, `Presidential Document` — confirm the live set isn't larger before finalizing), `jsonPath: "$.results[0].type"`.
- `latest_document_date` — `presenter: "metric"`, `type: "date"`, `jsonPath: "$.results[0].publication_date"`, `assert: { notEmpty: true, maxFutureDays: 1, notBefore: <plausible floor> }`. **No `expectMonotonic`** — a document can be added to the index out of strict date order (revisions, corrections), and `fr-smr-mentions`'s own `notes` already documents that the index isn't a hard monotonic invariant.
- `fr-smr-mentions` only: also extract `latest_document_agency` (`$.results[0].agencies[0].name`) — the other two targets already filter to one agency, so it'd be a constant.

**Testing:** `fixtures/example-regulatory-api/response.json` — a synthetic single-result envelope shaped like the real one (`results[0]` with `title`/`type`/`publication_date`/`agencies`), used in a vitest suite exercising the new extractors' assertions generically (ADR-001/021 — no "NRC"/"DOE"/"small modular reactor" in test code).

### SEC (`oklo-sec-filings`, `nuscale-sec-filings`)

Uses M4a's composite location. Add one new extractor per target, alongside the existing `latest_filing_form`/`latest_filing_date`:

```ts
{
  key: "latest_8k",
  label: "Latest 8-K",
  presenter: "markdown",
  kind: "api",
  type: "markdown",
  index: { jsonPath: '$.filings.recent.form[?(@ === "8-K")]~', pick: "first" },
  fields: {
    items: {
      jsonPath: "$.filings.recent.items[{index}]",
      split: ",",
      valueMap: SEC_8K_ITEMS, // shared const, see below
      join: "; ",
    },
    date: { jsonPath: "$.filings.recent.filingDate[{index}]" },
    acc: { jsonPath: "$.filings.recent.accessionNumber[{index}]", strip: "-", escape: "none" },
    doc: { jsonPath: "$.filings.recent.primaryDocument[{index}]", escape: "url" },
  },
  template:
    "**{items}** filed {date} — [primary document](https://www.sec.gov/Archives/edgar/data/<CIK>/{acc}/{doc})",
  assert: { notEmpty: true, maxLength: 500 },
}
```

- `SEC_8K_ITEMS`: a `Record<string,string>` mapping SEC's documented Item numbers (1.01, 2.02, 5.02, 9.01, ...) to plain-English labels — lives in `config/bluecore.config.ts` as a shared const (both SEC targets use the same vocabulary), not in `src/`. Populate it from SEC's own Item-number schedule (Form 8-K instructions), not guessed — an unmapped code is `PARSE_ERROR` at runtime (compose.ts's strictness), so the map needs to cover every Item number that's realistically shown up across both fixtures' history, same spirit as M2b's form-code pattern regex being "verified against all 52 distinct historical values across both fixtures."
- `<CIK>` in the template is the entity's own CIK, hardcoded per-target the same way `bluecore-form-d`'s URL already is — not extracted, since it's a config fact, not a scraped one.
- Decide (at implementation time) whether this warrants its own `alert` — an `any-change` on `latest_filing_form`/`.filingDate` already fires when any new filing appears (including this one), so a second alert on `latest_8k` specifically would likely be redundant noise; probably `alert` stays unset here, mirroring `latest_filing_date`'s existing pattern of "no alert, the sibling field alerts."
- If a competitor genuinely has no 8-K in the fetched `filings.recent` window (`index` resolves to zero matches), this extractor fails `SELECTOR_NO_MATCH`. Since it's not `required: true`, the target still reports `run.status: partial` — the same tolerance the two existing scalar extractors already rely on. Confirm this is the desired behavior (vs. omitting the block from the dashboard some other way) before shipping.

**Testing:** `fixtures/example-sec-submissions/response.json` — a synthetic `filings.recent`-shaped envelope with the target row not at index 0 (mirroring the real Oklo case), a multi-code `items` entry, and a dashed accession number. Exercises the real `oklo-sec-filings`/`nuscale-sec-filings` extractor shape generically.

### Re-fixturing

FR fixtures currently hold `results.length === 20` (captured before `per_page=1` was confirmed as the live query param) — recapture (`npm run fixture:capture -- --env bluecore <targetId>`) before blessing the new title/type/date extractors, so the golden file matches what the live query actually returns. Re-bless all five touched targets (`fr-nrc-smr`, `fr-doe-nuclear`, `fr-smr-mentions`, `oklo-sec-filings`, `nuscale-sec-filings`) and review each diff — a new extractor showing up should be the only change, not a structural shift.

---

## M4c — Retire `bluecore-form-d`, close out M4

**Not started.**

1. Remove the `bluecore-form-d` target from `config/bluecore.config.ts`.
2. Delete its committed data file: `public/data/sections/company/bluecore-form-d.json`. `writeAll` (`src/ingest/persist.ts`) only ever writes targets that are still in the run's queue — it never deletes a file for a target removed from config, so this needs a manual `git rm`.
3. Delete `fixtures/bluecore-form-d/` (both `response.html` and `expected.json`) — `fixture:verify` would otherwise fail looking for a target that no longer exists in config... actually check: `fixture:verify` iterates `config.targets`, so a removed target is simply never checked; the fixture directory becomes dead weight, not a failure. Delete it anyway for hygiene.
4. Close any open GitHub alert/health issues referencing `bluecore-form-d` (`gh issue list --search "bluecore-form-d"` or similar) — they'll never auto-close since the target no longer runs to report health on it.
5. Rewrite `06-OPS-RUNBOOK.md` §4 ("a new Form D filing appeared") — it currently describes repointing `bluecore-form-d.url` to a new accession number, which no longer applies. Replace with: `bluecore-sec-filings`'s `any-change` alert (and, after M4b, its `latest_8k` extractor if the new filing happens to be an 8-K) is now the whole story for "a new SEC filing appeared."
6. Update `05-SOURCES.md`'s Company Performance table and §4 summary counts (currently "10 sources... 2 static-html" — becomes 9 sources, 1 static-html) and its Company Performance narrative (the "Latest funding milestone" fact in §6 item 3 was `bluecore-form-d`'s dollar amounts — note it's now a one-time historical fact rather than a live target, or drop the claim).
7. Update `07-ROADMAP.md` M4's status/exit-criteria table, and this doc's status table.

**Verification (M4c specifically, beyond the standard set):** `npm run fixture:verify -- --env bluecore` reports 9 targets, not 10; `npm run validate:config -- --env bluecore` still passes with the target removed; a fresh `npm run ingest -- --dry` run doesn't reference `bluecore-form-d` anywhere in its output.
