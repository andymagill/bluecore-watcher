#!/usr/bin/env tsx
// npm run ingest -- --env <id> [--dry] [--live] [--only <id[,id...]>]
// 06-OPS-RUNBOOK.md §8 step 5: --dry writes nothing, prints what it would
// extract. Without --dry, runs the offline gate before writing (M0.5 stand-in
// for ADR-005 — see src/ingest/orchestrate.ts).
//
// --live and --only are M1 additions (docs/07-ROADMAP.md M1):
//   --live  swaps the default FixtureFetcher for the real HttpFetcher. Kept
//           opt-in so every existing test/CI call (which never passes
//           `fetcher`) keeps hitting fixtures, never the network, by default.
//   --only  filters config.targets to the given id(s) *after* Zod validation
//           (safe -- filtering an array of already-valid targets can't
//           reintroduce a config invariant violation). This is how a single
//           real config file serves both M1's one-target scope discipline
//           and M2's eventual full-breadth run, with no config duplication.
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { CmieConfig } from "../src/config/index.js";
import { runAndPersist } from "../src/ingest/orchestrate.js";
import { HttpFetcher } from "../src/ingest/fetch/http-fetcher.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function getEnvArg(): string {
  const idx = process.argv.indexOf("--env");
  const env = idx !== -1 ? process.argv[idx + 1] : undefined;
  if (!env) {
    console.error("Usage: npm run ingest -- --env <environmentId> [--dry] [--live] [--only <id[,id...]>]");
    process.exit(2);
  }
  return env;
}

function getOnlyArg(): string[] | null {
  const idx = process.argv.indexOf("--only");
  const value = idx !== -1 ? process.argv[idx + 1] : undefined;
  if (!value) return null;
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

async function main() {
  const envId = getEnvArg();
  const dryRun = process.argv.includes("--dry");
  const live = process.argv.includes("--live");
  const onlyIds = getOnlyArg();

  const mod = await import(pathToFileURL(join(root, "config", `${envId}.config.ts`)).href);
  let config = CmieConfig.parse(mod.config ?? mod.default);

  if (onlyIds) {
    const known = new Set(config.targets.map((t) => t.id));
    const unknown = onlyIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      console.error(`--only referenced unknown target id(s): ${unknown.join(", ")}`);
      process.exit(2);
    }
    config = { ...config, targets: config.targets.filter((t) => onlyIds.includes(t.id)) };
  }

  const result = await runAndPersist(
    {
      config,
      dataDir: join(root, "public", "data"),
      fixturesDir: join(root, "fixtures"),
      acknowledgementsPath: join(root, "config", "acknowledgements.json"),
      runId: `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 7)}`,
      now: () => new Date(),
      fetcher: live ? new HttpFetcher(config.defaults) : undefined,
    },
    dryRun,
    join(root, "schemas"),
  );

  const totalBlocks = result.targetFiles.reduce((n, t) => n + t.blocks.length, 0);
  console.log(`\n${dryRun ? "[dry run] " : ""}${result.targetFiles.length} target(s), ${totalBlocks} block(s).`);
  console.log(`Semantic change vs. previous state: ${result.changed}`);
  if (result.consumedAcknowledgements > 0) console.log(`Consumed ${result.consumedAcknowledgements} acknowledgement(s).`);

  for (const tf of result.targetFiles) {
    console.log(`  ${tf.targetId}: run.status=${tf.run.status}`);
    for (const b of tf.blocks) {
      console.log(`    ${b.key}: status=${b.status} value=${JSON.stringify(b.value)}`);
    }
  }

  if (result.gate) {
    console.log(`\nGate: ${result.gate.passed ? "PASSED" : "FAILED"}`);
    for (const e of result.gate.schemaErrors) console.log(`  schema: ${e}`);
    for (const v of result.gate.contractViolations) console.log(`  invariant ${v.invariant} [${v.targetId}.${v.extractorKey}]: ${v.message}`);
    if (!result.gate.passed) process.exit(1);
  } else if (!dryRun && !result.changed) {
    console.log("\nNo semantic change — no branch, no write (ADR-011).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
