#!/usr/bin/env tsx
// Generates schemas/*.json from the Zod schemas in src/contract. This is
// the JSON Schema derived from the TypeScript source of truth
// (01-DATA-CONTRACT.md, 02-CONFIG-SCHEMA.md §0). `npm run schema:check`
// fails CI if committed output has drifted from the Zod source.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Manifest, TargetFile, Health, AcknowledgementsFile } from "../src/contract/index.js";
import { CmieConfig } from "../src/config/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(__dirname, "..", "schemas");

const targets: Record<string, z.ZodType> = {
  "manifest.schema.json": Manifest,
  "target-file.schema.json": TargetFile,
  "health.schema.json": Health,
  "acknowledgements.schema.json": AcknowledgementsFile,
  "config.schema.json": CmieConfig,
};

function generate(): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [filename, schema] of Object.entries(targets)) {
    const jsonSchema = z.toJSONSchema(schema, { target: "draft-7", io: "output" });
    output[filename] = JSON.stringify(jsonSchema, null, 2) + "\n";
  }
  return output;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const generated = generate();

  if (checkOnly) {
    let drifted = false;
    for (const [filename, content] of Object.entries(generated)) {
      const path = join(schemasDir, filename);
      const existing = existsSync(path) ? readFileSync(path, "utf-8") : null;
      if (existing !== content) {
        console.error(`DRIFT: ${filename} does not match its Zod source. Run "npm run schema:gen".`);
        drifted = true;
      }
    }
    if (drifted) process.exit(1);
    console.log("schemas/ is up to date with src/contract and src/config.");
    return;
  }

  mkdirSync(schemasDir, { recursive: true });
  for (const [filename, content] of Object.entries(generated)) {
    writeFileSync(join(schemasDir, filename), content, "utf-8");
  }
  console.log(`Wrote ${Object.keys(generated).length} schema file(s) to ${schemasDir}`);
}

main();
