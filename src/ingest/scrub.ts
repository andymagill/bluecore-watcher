// 03-INGESTION.md §6 / 06-OPS-RUNBOOK.md §2: "Error text and rawText are
// scrubbed against active secret values before being written to health.json
// -- a token echoed in a 401 body would otherwise land permanently in the
// Git history that serves as the audit trail." Collects every secretEnv
// referenced by the config's targets and redacts occurrences of their live
// values out of anything about to be persisted.
import type { CmieConfig } from "../config/schema.js";

export function collectActiveSecretValues(config: CmieConfig): string[] {
  const values: string[] = [];
  for (const target of config.targets) {
    const envName = target.auth?.secretEnv;
    const value = envName ? process.env[envName] : undefined;
    if (value) values.push(value);
  }
  return values;
}

export function scrubSecrets(text: string, secretValues: readonly string[]): string {
  let scrubbed = text;
  for (const value of secretValues) {
    if (!value) continue;
    scrubbed = scrubbed.split(value).join("[REDACTED]");
  }
  return scrubbed;
}
