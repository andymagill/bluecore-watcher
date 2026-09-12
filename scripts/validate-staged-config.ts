#!/usr/bin/env tsx
// Wired into lint-staged (package.json "lint-staged"."config/*.config.ts").
// lint-staged passes staged file paths as argv; validate-config.ts (see
// docs/02-CONFIG-SCHEMA.md §5) instead wants a bare environment id via
// `--env <id>` and resolves `config/<id>.config.ts` itself. This maps one to
// the other so each staged config gets validated before commit -- making
// docs/02-CONFIG-SCHEMA.md:221's "runs ... as a pre-commit hook" true.
//
// Safe to run with no secrets present: validate-config.ts checks only that
// each secretEnv/*Env *name* is a non-empty string, never the value
// (02-CONFIG-SCHEMA.md §9 rule 9's config-time/run-time split).
import { spawnSync } from "node:child_process";
import { basename } from "node:path";

const staged = process.argv.slice(2);
const envIds = staged
  .map((path) => basename(path))
  .filter((name) => name.endsWith(".config.ts"))
  .map((name) => name.slice(0, -".config.ts".length));

let failed = false;
for (const envId of envIds) {
  const result = spawnSync("npx", ["tsx", "scripts/validate-config.ts", "--env", envId], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
