// Fails if a Zod schema changed without regenerating schemas/*.json —
// keeps "TypeScript is the source of truth, JSON Schema is derived" true
// rather than aspirational (02-CONFIG-SCHEMA.md §0).
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Manifest, TargetFile, Health, AcknowledgementsFile } from "../src/contract/index.js";
import { CmieConfig } from "../src/config/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(__dirname, "..", "schemas");

const schemasByFile: Record<string, z.ZodType> = {
  "manifest.schema.json": Manifest,
  "target-file.schema.json": TargetFile,
  "health.schema.json": Health,
  "acknowledgements.schema.json": AcknowledgementsFile,
  "config.schema.json": CmieConfig,
};

describe("schemas/ matches src/contract and src/config (run `npm run schema:gen` if this fails)", () => {
  for (const [filename, schema] of Object.entries(schemasByFile)) {
    it(filename, async () => {
      const committed = await readFile(join(schemasDir, filename), "utf-8");
      const regenerated = JSON.stringify(z.toJSONSchema(schema, { target: "draft-7", io: "output" }), null, 2) + "\n";
      expect(committed).toBe(regenerated);
    });
  }
});
