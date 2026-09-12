// 03-INGESTION.md §3 check 1 (schema validation). Deliberately validates
// against the *generated* JSON Schema with Ajv, not by re-running the Zod
// parse — an independent validator on the serialized form means a bug on
// the Zod side can't wave its own output through (M0.5 plan, Phase 3).
import type { Ajv as AjvInstance, ErrorObject } from "ajv";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ajv's package "exports" map resolves to a .d.ts that TS's NodeNext
// moduleResolution reads as having no default export (a known ajv/TS
// interop issue) — createRequire sidesteps the ESM type resolution while
// keeping the import typed via `import type` above.
const require = createRequire(import.meta.url);
const Ajv = require("ajv") as new (opts?: object) => AjvInstance;
const addFormats = require("ajv-formats") as (ajv: AjvInstance) => void;

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[]; // "SCHEMA_INVALID" per 01-DATA-CONTRACT.md §7 — always an engine defect
}

async function loadSchema(schemasDir: string, filename: string): Promise<object> {
  return JSON.parse(await readFile(join(schemasDir, filename), "utf-8"));
}

// Matches scripts/schema-gen.ts's `target: "draft-7"` output. Without
// ajv-formats, "date-time"/"uri" in the generated schema are no-ops and a
// malformed timestamp or URL would pass silently — a real gap in what
// "schema validation" is supposed to catch (01-DATA-CONTRACT.md §7,
// SCHEMA_INVALID).
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

export async function validateAgainstSchema(
  schemasDir: string,
  filename: string,
  value: unknown,
): Promise<SchemaValidationResult> {
  const schema = await loadSchema(schemasDir, filename);
  const validateFn = ajv.compile(schema);
  const valid = validateFn(value);
  if (valid) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: (validateFn.errors ?? []).map(
      (e: ErrorObject) => `${filename}${e.instancePath || ""} ${e.message ?? "invalid"}`,
    ),
  };
}
