// 03-INGESTION.md §6 / 06-OPS-RUNBOOK.md §2: "Error text and rawText are
// scrubbed against active secret values before being written to any
// committed file -- a token echoed in a 401 body would otherwise land
// permanently in the Git history that serves as the audit trail." Collects
// every secretEnv referenced by the config's targets and redacts occurrences
// of their live values out of anything about to be persisted. Applied to
// health entry messages in persist.ts's buildHealth, and to block
// provenance/value/displayValue via scrubBlockProvenance below, called from
// orchestrate.ts before persisting.
import type { CmieConfig } from "../config/schema.js";
import type { Block } from "../contract/block.js";

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

// provenance.rawText is the pre-parse text captured straight off the page
// (03-INGESTION.md §1 "extract") and is committed verbatim in target files --
// it must be scrubbed exactly like health's error messages. For a
// string/markdown/enum extractor, coerce() is the identity function
// (extract/coerce.ts), so `value`/`displayValue` carry that same text
// forward -- scrubbing only rawText would leave an unredacted copy sitting
// right next to it in the same committed file, so both are scrubbed here
// too. contentHash is left untouched: it is a non-reversible fingerprint of
// the pre-scrub text, and it (not rawText) feeds the ADR-011 fingerprint, so
// none of this can cause a spurious commit.
export function scrubBlockProvenance(block: Block, secretValues: readonly string[]): Block {
  if (!block.provenance) return block;
  if (block.presenter === "list") {
    return {
      ...block,
      value: block.value?.map((v) => scrubSecrets(v, secretValues)) ?? block.value,
      displayValue:
        block.displayValue?.map((v) => scrubSecrets(v, secretValues)) ?? block.displayValue,
      provenance: {
        ...block.provenance,
        rawText: block.provenance.rawText.map((t) => scrubSecrets(t, secretValues)),
      },
    };
  }
  return {
    ...block,
    value: typeof block.value === "string" ? scrubSecrets(block.value, secretValues) : block.value,
    displayValue:
      block.displayValue !== null
        ? scrubSecrets(block.displayValue, secretValues)
        : block.displayValue,
    provenance: {
      ...block.provenance,
      rawText: scrubSecrets(block.provenance.rawText, secretValues),
    },
  };
}
