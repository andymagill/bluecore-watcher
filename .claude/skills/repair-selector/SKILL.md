---
name: repair-selector
description: Repairs a broken HTML selector or API jsonPath on a bluecore-watcher extraction target, from a "Health: <targetId>" GitHub alert issue through to an open PR. Use when assigned an issue with a SELECTOR_NO_MATCH, SELECTOR_AMBIGUOUS, or PARSE_ERROR health alert, or when asked to fix a broken source selector.
---

# Repair a broken selector

Automates `06-OPS-RUNBOOK.md` §3 ("a selector broke") for
`bluecore-watcher`. Given a health alert naming a broken extractor,
produce a reviewed PR that fixes it — never a direct commit, never a
change to the engine itself.

## Steps

1. **Read the alert issue.** Note the `targetId`, `extractorKey`, and
   `errorClass` from the issue's per-extractor heading. Read that target's
   `notes` field in `config/bluecore.config.ts` — past-you may have
   already predicted this exact failure mode and left guidance about
   which classes/attributes are stable vs. churn.

2. **Get a fresh document.** If `.runs/live/<targetId>/` already has a
   capture (the `copilot-setup-steps` workflow puts one there before you
   start — this is how you see the live page without touching the network
   or any secret yourself), use it. Otherwise:

   ```
   npm run fixture:capture -- --env bluecore <targetId>
   ```

3. **Diff.** Run:

   ```
   npm run repair:diff -- --env bluecore <targetId>
   ```

   This writes `.runs/repair/<targetId>/context.md` — per extractor,
   whether it still extracts, and a ranked table of relocation candidates
   (`src/repair/relocate.ts` finds them; `src/repair/score.ts` ranks them
   by running the real extraction pipeline and the target's own shape
   assertions/change guards). It also seeds
   `.runs/repair/<targetId>/candidates.<extractorKey>.json` with every
   candidate found. Read `context.md` before doing anything else.

4. **Propose candidates.** The seed file already has deterministic
   candidates. Add up to 5 total, preferring — in this order — a class or
   `data-*` attribute selector, a label-text anchor, a JSONPath keyed on
   the same field name at its new location. Never propose `nth-child`,
   `nth-of-type`, `:eq`, `:nth`, `:lt`, or `:gt` yourself; the seed file's
   own positional fallback is there only as a last resort and already
   ranks below anything else that passes.

5. **Verify.**

   ```
   npm run repair:verify -- --env bluecore <targetId> --extractor <extractorKey> --candidates .runs/repair/<targetId>/candidates.<extractorKey>.json
   ```

   (Add any hand-proposed candidates to that JSON file first, or pass a
   single one directly with `--selector`/`--json-path`.) A nonzero exit
   means nothing passed — go back to step 4, don't force a failing
   candidate through.

6. **Apply the best passing candidate** to `config/bluecore.config.ts` —
   only the `selector`/`jsonPath` (and `attr` if relevant) field on that
   one extractor. Update the target's `notes` if this failure mode is
   worth predicting next time.

7. **Update the fixture.** Copy the live capture over the committed
   fixture: `.runs/live/<targetId>/response.<ext>` →
   `fixtures/<targetId>/response.<ext>` (or re-run `fixture:capture`
   without `--out` if no live capture exists). Then:

   ```
   npm run fixture:bless -- --env bluecore <targetId>
   npm run validate:config -- --env bluecore
   npm test
   ```

8. **Open a PR** titled `repair(<targetId>): <short description>`, body
   containing the verify table from step 5, `Fixes #<issue number>`, and a
   `Time spent: <estimate>` line (feeds the ops report, M3d).

## Hard rules

- **A composite/indexed `api` location (ADR-022 — `fields`+`template`, optionally `index`) can't be auto-repaired.** `repair:diff`/`repair:verify` will report `status: "unsupported"` for one of these instead of proposing candidates — there's no single locator to relocate a value to. Read the target's `notes` for the source's known shape (e.g. which field holds which array), find the new jsonPaths by hand, and edit `fields`/`index`/`template` on that extractor directly in `config/*.config.ts`, then verify with `npm run fixture:verify` per step 7 below.
- **Never edit anything under `src/` or `public/data/`.** A selector fix
  is a config-and-fixture change only. If the failure can't be fixed that
  way, it's an engine defect (ADR-001) — stop, explain why in the PR (or a
  comment on the issue if you can't safely open one), and do not attempt
  an engine change yourself.
- **Never loosen an `assert` or change-guard field to make a candidate
  pass.** A widened tolerance that lets a wrong value through is a
  silent-wrong, exactly what those guards exist to prevent (ADR-008).
  If every candidate fails assertions, the assertions found something
  real — investigate the value, don't relax the check.
- **Never fetch a page yourself** beyond `npm run fixture:capture`. You
  have no network access in the cloud agent's sandbox regardless; this
  rule matters for the local-Claude-Code case too, where fetching the
  live page directly (rather than through the fixture pipeline) would
  produce content that was never scrubbed of secrets before landing on
  disk.
- **The fixture pair is git history, not two files.** `repair:diff` reads
  the prior fixture with `git show`; don't keep an old-fixture copy
  around on disk as a second regression fixture unless the runbook or the
  target's `notes` specifically ask for one.
