// docs/plans/m3-operability.md M3b — pure markdown rendering shared by
// scripts/repair-diff.ts and scripts/repair-verify.ts, so both scripts stay
// thin and the table format is defined once.
import { locatorOf } from "./relocate.js";
import type { ScoredCandidate } from "./score.js";

function renderValue(value: string | string[] | null): string {
  if (value === null) return "—";
  return Array.isArray(value) ? value.join(", ") : value;
}

export function formatVerifyTable(scored: readonly ScoredCandidate[]): string {
  const header = "| # | Locator | Status | Matches | Value | Basis | Detail |";
  const divider = "|---|---|---|---|---|---|---|";
  const rows = scored.map((s, i) => {
    const locator = locatorOf(s.patch);
    return (
      `| ${i + 1} | \`${locator}\` | ${s.status} | ${s.matchCount ?? "—"} | ` +
      `${renderValue(s.displayValue)} | ${s.basis} | ${s.detail || "—"} |`
    );
  });
  return [header, divider, ...rows].join("\n");
}

export interface ExtractorDiffEntry {
  key: string;
  label: string;
  oldLocator: string;
  previousValue: string | number | readonly string[] | null;
  stillExtracts: boolean;
  errorDetail: string | null;
  candidates: readonly ScoredCandidate[];
}

export interface ContextMarkdownParams {
  targetId: string;
  structureAdded: readonly string[];
  structureRemoved: readonly string[];
  extractors: readonly ExtractorDiffEntry[];
}

export function formatContextMarkdown(params: ContextMarkdownParams): string {
  const { targetId, structureAdded, structureRemoved, extractors } = params;
  const lines: string[] = [`# Repair context — ${targetId}`, ""];

  lines.push("## Structure diff", "");
  lines.push(`Added: ${structureAdded.slice(0, 10).join(", ") || "none"}`);
  lines.push(`Removed: ${structureRemoved.slice(0, 10).join(", ") || "none"}`);
  lines.push("");

  for (const ex of extractors) {
    lines.push(`## \`${ex.key}\` — ${ex.label}`, "");
    lines.push(`Old locator: \`${ex.oldLocator}\``);
    lines.push(`Previous value: \`${JSON.stringify(ex.previousValue)}\``);
    lines.push(
      ex.stillExtracts
        ? "Still extracts against the new document."
        : `Fails against the new document: ${ex.errorDetail}`,
    );
    lines.push("");
    lines.push(
      ex.candidates.length > 0
        ? formatVerifyTable(ex.candidates)
        : "_No relocation candidates found._",
    );
    lines.push("");
  }

  return lines.join("\n");
}
