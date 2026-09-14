# Copilot instructions

This repo is `bluecore-watcher`, an unattended data-ingestion pipeline.
`docs/00-DECISIONS.md` records the accepted architecture decisions (ADRs);
`docs/01-DATA-CONTRACT.md` through `docs/03-INGESTION.md` describe the
engine. Standard verification: `npm run format:check && npm run lint &&
npm run typecheck && npm run schema:check && npm run validate:config --
--env bluecore && npm test`.

## Repairing a broken selector

If you were assigned an issue titled `Health: <targetId>` (a selector or
parse-error health alert), follow
[`.claude/skills/repair-selector/SKILL.md`](../.claude/skills/repair-selector/SKILL.md)
exactly. In short:

- Never edit anything under `src/` or `public/data/` — a repair is a
  `config/*.config.ts` + `fixtures/**` change only.
- Never loosen an `assert` or change-guard field to make a candidate pass.
- Use `npm run repair:diff` / `npm run repair:verify` to find and verify a
  replacement selector before touching config — don't guess by hand.
- Open a PR; never push directly to `main`.

For anything else, `docs/06-OPS-RUNBOOK.md` is the operator's reference.
