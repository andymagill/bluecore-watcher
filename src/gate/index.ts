// 03-INGESTION.md §3, staged (amended ADR-005): checks 1-2 here, offline,
// ship with the engine spine. Check 3 (Cloudflare-Pages-preview smoke
// render — host per ADR-013) needs a SPA to render and lands in M1.
import type { Manifest } from "../contract/manifest.js";
import type { Health } from "../contract/health.js";
import type { TargetFile } from "../contract/target-file.js";
import { validateAgainstSchema } from "./schema-validate.js";
import { checkContractInvariants, type ContractViolation } from "./contract-assertions.js";

export interface GateInput {
  schemasDir: string;
  manifest: Manifest;
  health: Health;
  targetFiles: TargetFile[];
  previousTargetFiles: ReadonlyMap<string, TargetFile>;
}

export interface GateReport {
  passed: boolean;
  schemaErrors: string[];
  contractViolations: ContractViolation[];
}

export async function runGate(input: GateInput): Promise<GateReport> {
  const schemaErrors: string[] = [];

  const manifestResult = await validateAgainstSchema(input.schemasDir, "manifest.schema.json", input.manifest);
  schemaErrors.push(...manifestResult.errors);

  const healthResult = await validateAgainstSchema(input.schemasDir, "health.schema.json", input.health);
  schemaErrors.push(...healthResult.errors);

  for (const tf of input.targetFiles) {
    const result = await validateAgainstSchema(input.schemasDir, "target-file.schema.json", tf);
    schemaErrors.push(...result.errors.map((e) => `[${tf.targetId}] ${e}`));
  }

  const contractResult = checkContractInvariants(input.previousTargetFiles, input.targetFiles);

  return {
    passed: schemaErrors.length === 0 && contractResult.passed,
    schemaErrors,
    contractViolations: contractResult.violations,
  };
}
