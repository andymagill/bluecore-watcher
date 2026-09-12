// 03-INGESTION.md §3 check 2 (contract assertions) — the invariants from
// 01-DATA-CONTRACT.md §8 as executable tests over a before/after file pair.
// Chiefly: no previously-good value blanked, and every published block has
// complete provenance.
import type { TargetFile } from "../contract/target-file.js";
import type { Block } from "../contract/block.js";

export interface ContractViolation {
  invariant: string;
  targetId: string;
  extractorKey: string;
  message: string;
}

export interface ContractCheckResult {
  passed: boolean;
  violations: ContractViolation[];
}

export function checkContractInvariants(
  previousTargetFiles: ReadonlyMap<string, TargetFile>,
  newTargetFiles: readonly TargetFile[],
): ContractCheckResult {
  const violations: ContractViolation[] = [];

  for (const tf of newTargetFiles) {
    const previous = previousTargetFiles.get(tf.targetId);
    const previousBlocks = new Map<string, Block>((previous?.blocks ?? []).map((b) => [b.key, b]));

    for (const block of tf.blocks) {
      const prevBlock = previousBlocks.get(block.key);

      // Invariant 1 — a failed run never deletes or blanks a previously good value.
      if (prevBlock && prevBlock.value !== null && block.value === null) {
        violations.push({
          invariant: "1 (no blanking)",
          targetId: tf.targetId,
          extractorKey: block.key,
          message: `previously had value ${JSON.stringify(prevBlock.value)}, now null`,
        });
      }

      // Invariant 2 — every rendered value has sourceUrl, anchor, extractedAt, rawText.
      // "Rendered" means status ok/cached/flagged; "missing" is the documented
      // exception (01-DATA-CONTRACT.md §4, "missing is the one status where
      // provenance ... [is] null").
      if (block.status !== "missing") {
        if (!block.provenance) {
          violations.push({
            invariant: "2 (complete provenance)",
            targetId: tf.targetId,
            extractorKey: block.key,
            message: `status "${block.status}" but provenance is null`,
          });
        } else {
          const p = block.provenance;
          const rawTextEmpty = Array.isArray(p.rawText) ? p.rawText.length === 0 : p.rawText === "";
          if (
            !p.sourceUrl ||
            !p.anchor ||
            (Array.isArray(p.anchor) && p.anchor.length === 0) ||
            !p.extractedAt ||
            rawTextEmpty
          ) {
            violations.push({
              invariant: "2 (complete provenance)",
              targetId: tf.targetId,
              extractorKey: block.key,
              message: "provenance is missing sourceUrl, anchor, extractedAt, or rawText",
            });
          }
        }
      }

      // Invariant 6 — no block published with a value that failed a hard
      // assertion. Enforced upstream (src/ingest/validate.ts); this re-checks
      // the written artifact independently: an "ok" block's validation must
      // report passed: true.
      if (block.status === "ok" && !block.validation.passed) {
        violations.push({
          invariant: "6 (no failed-assertion publish)",
          targetId: tf.targetId,
          extractorKey: block.key,
          message: `status "ok" but validation.passed is false`,
        });
      }
    }
  }

  return { passed: violations.length === 0, violations };
}
