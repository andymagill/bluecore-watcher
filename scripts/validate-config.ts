#!/usr/bin/env tsx
// npm run validate:config -- --env <id>
// Loads config/<id>.config.ts, validates it against src/config/schema.ts,
// and reports every failure with its config path (02-CONFIG-SCHEMA.md §5).
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CmieConfig } from "../src/config/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getEnvArg(): string {
  const idx = process.argv.indexOf("--env");
  const env = idx !== -1 ? process.argv[idx + 1] : undefined;
  if (!env) {
    console.error('Usage: npm run validate:config -- --env <environmentId>');
    process.exit(2);
  }
  return env;
}

async function main() {
  const envId = getEnvArg();
  const configPath = join(__dirname, "..", "config", `${envId}.config.ts`);
  const mod = await import(pathToFileURL(configPath).href);
  const raw = mod.config ?? mod.default;
  if (!raw) {
    console.error(`config/${envId}.config.ts must export "config" (or a default export).`);
    process.exit(2);
  }

  const result = CmieConfig.safeParse(raw);
  if (result.success) {
    console.log(`config/${envId}.config.ts is valid — ${result.data.targets.length} target(s), ${result.data.targets.reduce((n, t) => n + t.extractors.length, 0)} extractor(s).`);
    return;
  }

  console.error(`config/${envId}.config.ts failed validation:\n`);
  for (const issue of result.error.issues) {
    const path = issue.path.length ? issue.path.join(".") : "(root)";
    console.error(`  [${path}] ${issue.message}`);
  }
  console.error(`\n${result.error.issues.length} error(s).`);
  process.exit(1);
}

main();
