// Pure decision logic for the drift check's GitHub Issue lifecycle — kept
// separate from scripts/drift-check.ts's actual `gh` calls so the create/
// comment/close/leave-alone decision is unit-testable without a network or
// a `gh` binary. One issue per target, deduped by title.
import type { TargetDriftResult } from "./check.js";
import { isDrifting } from "./check.js";

export interface OpenDriftIssue {
  targetId: string;
  number: number;
}

export type IssueAction =
  | { type: "create"; targetId: string; body: string }
  | { type: "comment"; targetId: string; number: number; body: string }
  | { type: "close"; targetId: string; number: number; body: string };

// scripts/drift-check.ts matches open issues back to a target by this exact
// title — keep the two in sync if this format ever changes.
export function issueTitle(targetId: string): string {
  return `Drift: ${targetId}`;
}

export function formatSignals(result: TargetDriftResult): string {
  const lines = result.signals.map(
    (s) => `- **${s.code}**${s.extractorKey ? ` (\`${s.extractorKey}\`)` : ""}: ${s.message}`,
  );
  return [`Drift detected on \`${result.targetId}\`:`, "", ...lines].join("\n");
}

// A signal set that is FETCH_FAILED-only means the check never actually
// ran for this target this time (03-INGESTION.md §1 "fetch" already owns
// real fetch failures via the health log) — leave whatever issue state
// already exists untouched rather than let a transient network blip close
// a real open drift issue or spam a new one.
function isFetchFailedOnly(result: TargetDriftResult): boolean {
  return result.signals.length > 0 && result.signals.every((s) => s.code === "FETCH_FAILED");
}

export function planIssueSync(
  results: readonly TargetDriftResult[],
  openIssues: readonly OpenDriftIssue[],
): IssueAction[] {
  const openByTarget = new Map(openIssues.map((issue) => [issue.targetId, issue]));
  const actions: IssueAction[] = [];

  for (const result of results) {
    if (isFetchFailedOnly(result)) continue;

    const open = openByTarget.get(result.targetId);
    const drifting = isDrifting(result);

    if (drifting && !open) {
      actions.push({ type: "create", targetId: result.targetId, body: formatSignals(result) });
    } else if (drifting && open) {
      actions.push({
        type: "comment",
        targetId: result.targetId,
        number: open.number,
        body: formatSignals(result),
      });
    } else if (!drifting && open) {
      actions.push({
        type: "close",
        targetId: result.targetId,
        number: open.number,
        body: "Clean on the latest weekly drift check — closing. Reopen if this recurs.",
      });
    }
    // !drifting && !open: nothing to do.
  }

  return actions;
}
