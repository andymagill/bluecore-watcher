// 03-INGESTION.md §3, staged (amended ADR-005): checks 1-2 here, offline,
// shipped with the engine spine. Check 3 (the Cloudflare-Workers-preview
// smoke render, ADR-014) is M1: it only runs when a `previewUrl` is
// supplied, so every existing offline caller (scripts/gate.ts re-validating
// the resting public/data/ state, and every test that never had a preview
// to check against) is unaffected -- this is additive, not a breaking change.
import type { Manifest } from "../contract/manifest.js";
import type { Health } from "../contract/health.js";
import type { TargetFile } from "../contract/target-file.js";
import { validateAgainstSchema } from "./schema-validate.js";
import { checkContractInvariants, type ContractViolation } from "./contract-assertions.js";
import { runSmokeRender } from "./smoke-render.js";

export interface GateInput {
  schemasDir: string;
  manifest: Manifest;
  health: Health;
  targetFiles: TargetFile[];
  previousTargetFiles: ReadonlyMap<string, TargetFile>;
  /** When set, check 3 (smoke render) runs against this deployed preview URL. */
  previewUrl?: string;
}

export interface GateReport {
  passed: boolean;
  schemaErrors: string[];
  contractViolations: ContractViolation[];
  smokeRenderErrors: string[];
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

  const smokeRenderErrors = input.previewUrl
    ? (await runSmokeRender(input.previewUrl, input.manifest, input.targetFiles)).errors
    : [];

  return {
    passed: schemaErrors.length === 0 && contractResult.passed && smokeRenderErrors.length === 0,
    schemaErrors,
    contractViolations: contractResult.violations,
    smokeRenderErrors,
  };
}
