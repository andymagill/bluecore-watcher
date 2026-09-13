// Cheap, mechanical guards for docs/07-ROADMAP.md M2's exit criteria
// ("all four sections populated", "a fixture and unit test per target").
// tests/config-schema.test.ts already exercises the Zod validation rules in
// the abstract; this file asserts facts about the REAL config specifically,
// so a future PR that quietly drops a target or forgets a fixture fails CI
// immediately instead of only being caught by human review.
import { describe, expect, it } from "vitest";
import { access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CmieConfig } from "../src/config/schema.js";
import { config as bluecoreConfig } from "../config/bluecore.config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const fixturesDir = join(root, "fixtures");

const config = CmieConfig.parse(bluecoreConfig);

const EXTENSION_BY_KIND: Record<string, string> = { html: "html", api: "json" };

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("real config coverage — docs/07-ROADMAP.md M2 exit criteria", () => {
  it("every declared section has at least one target ('all four sections populated')", () => {
    const sectionIdsWithTargets = new Set(config.targets.map((t) => t.sectionId));
    const emptySections = config.sections.filter((s) => !sectionIdsWithTargets.has(s.id));
    expect(emptySections.map((s) => s.id)).toEqual([]);
  });

  it("every entity referenced by a target is declared in environment.entities", () => {
    const entityIds = new Set(config.environment.entities.map((e) => e.id));
    const unknown = config.targets.filter((t) => !entityIds.has(t.entityId));
    expect(unknown.map((t) => t.id)).toEqual([]);
  });

  for (const target of config.targets) {
    it(`${target.id} has both a captured fixture and a golden file`, async () => {
      const ext = EXTENSION_BY_KIND[target.kind];
      const responsePath = join(fixturesDir, target.id, `response.${ext}`);
      const goldenPath = join(fixturesDir, target.id, "expected.json");
      expect(await exists(responsePath), `missing ${responsePath}`).toBe(true);
      expect(await exists(goldenPath), `missing ${goldenPath}`).toBe(true);
    });
  }
});
