// ADR-001: "Nothing entity-specific may be hardcoded in application or
// ingestion code." The concrete, checkable version of that claim: no
// engine source file may reference "bluecore" (case-insensitive) — every
// entity name belongs in config, never in code.
//
// ADR-021 extends the same rule to tests/: no test file may depend on the
// real config/bluecore.config.ts or its fixtures either. Engine concerns
// (extraction, drift detection, repair scoring, selector-failure handling)
// are proven generically against synthetic config/fixtures; real-config
// validation lives in the ops layer (npm run validate:config / drift /
// fixture:verify / ingest -- --dry), not in vitest.
//
// tests/resolve-preview-url.test.ts is the one documented exception
// (ADR-021): it asserts against this repo's own committed wrangler.jsonc
// and hardcodes the Worker/repo name "bluecore-watcher" — deployment
// identity for this repo, not multi-tenant source configuration.
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const srcDir = join(root, "src");
const testsDir = join(root, "tests");

const SELF = fileURLToPath(import.meta.url);
const TESTS_ALLOWLIST = new Set(["resolve-preview-url.test.ts"]);

async function findOffenders(dirs: string[], skip: (path: string) => boolean): Promise<string[]> {
  const offenders: string[] = [];
  for await (const path of glob(dirs.map((d) => join(d, "**", "*.{ts,tsx}")))) {
    if (skip(path)) continue;
    const content = await readFile(path, "utf-8");
    if (/bluecore/i.test(content)) offenders.push(path);
  }
  return offenders;
}

describe("ADR-001 — engine code is entity-agnostic", () => {
  it('no file under src/ mentions "bluecore" (case-insensitive)', async () => {
    const offenders = await findOffenders([srcDir], () => false);
    expect(offenders).toEqual([]);
  });

  it('no test under tests/ mentions "bluecore" (case-insensitive), except the documented allowlist (ADR-021)', async () => {
    const offenders = await findOffenders([testsDir], (path) => {
      if (path === SELF) return true;
      const rel = relative(testsDir, path).split("\\").join("/");
      return TESTS_ALLOWLIST.has(rel);
    });
    expect(offenders).toEqual([]);
  });
});
