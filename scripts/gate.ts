#!/usr/bin/env tsx
// npm run gate
// Standalone check of whatever is currently in public/data/ against the
// generated schemas and the provenance-completeness half of the contract
// invariants (03-INGESTION.md §3). `npm run ingest` already runs this gate
// in-line before writing a changed run; this script re-validates the
// resting state on disk — useful in CI as an independent check, or after
// manual edits to public/data/.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runGate } from "../src/gate/index.js";
import { loadPreviousState } from "../src/ingest/persist.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

async function main() {
  const dataDir = join(root, "public", "data");
  const state = await loadPreviousState(dataDir);

  if (!state.manifest || !state.health) {
    console.log(`No data at ${dataDir} yet — nothing to gate. Run "npm run ingest -- --env <id>" first.`);
    return;
  }

  // No prior-state pair to diff against here (this validates a resting
  // state, not a candidate run) — the blanking check (Invariant 1) is
  // inapplicable; provenance-completeness and schema validation still run.
  const report = await runGate({
    schemasDir: join(root, "schemas"),
    manifest: state.manifest,
    health: state.health,
    targetFiles: [...state.targetFiles.values()],
    previousTargetFiles: new Map(),
  });

  console.log(`Gate: ${report.passed ? "PASSED" : "FAILED"}`);
  for (const e of report.schemaErrors) console.log(`  schema: ${e}`);
  for (const v of report.contractViolations) console.log(`  invariant ${v.invariant} [${v.targetId}.${v.extractorKey}]: ${v.message}`);

  if (!report.passed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
