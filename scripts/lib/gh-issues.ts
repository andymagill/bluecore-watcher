// Shared `gh issue` calls, extracted from scripts/drift-check.ts (M2b) so
// M3a's scripts/alert-dispatch.ts doesn't grow a second, parallel
// implementation of the same handful of gh invocations. Deliberately thin
// wrappers -- no retry/backoff, no caching -- callers own the decision
// logic (src/drift/issues.ts's planIssueSync, src/alerts/plan.ts's
// planAlerts); this module only ever executes the `gh` calls those plans
// describe.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GhIssueSummary {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  body: string;
  updatedAt: string;
}

export async function ensureLabel(
  name: string,
  opts: { description?: string; color?: string } = {},
): Promise<void> {
  const args = ["label", "create", name, "--force"];
  if (opts.description) args.push("--description", opts.description);
  if (opts.color) args.push("--color", opts.color);
  await execFileAsync("gh", args).catch(() => {
    // Label may already exist under different color/description text --
    // --force handles that; anything else surfaces via the next gh call.
  });
}

// `state` matches gh's own vocabulary ("open" | "closed" | "all") rather
// than GhIssueSummary.state's GraphQL-cased "OPEN"/"CLOSED" -- that's what
// `gh issue list --json state` actually returns, and callers that need to
// tell open from closed (M3a's reopen-vs-comment decision) compare against
// that verbatim.
export async function listIssuesByLabel(
  label: string,
  state: "open" | "closed" | "all" = "open",
): Promise<GhIssueSummary[]> {
  const { stdout } = await execFileAsync("gh", [
    "issue",
    "list",
    "--label",
    label,
    "--state",
    state,
    "--json",
    "number,title,state,body,updatedAt",
  ]);
  return JSON.parse(stdout) as GhIssueSummary[];
}

export async function createIssue(title: string, body: string, labels: string[]): Promise<number> {
  const args = ["issue", "create", "--title", title, "--body", body];
  for (const label of labels) args.push("--label", label);
  const { stdout } = await execFileAsync("gh", args);
  // gh issue create prints the new issue's URL on success; the number is
  // its last path segment.
  const match = /\/(\d+)\s*$/.exec(stdout.trim());
  return match ? Number(match[1]) : NaN;
}

export async function commentOnIssue(number: number, body: string): Promise<void> {
  await execFileAsync("gh", ["issue", "comment", String(number), "--body", body]);
}

export async function reopenIssue(number: number): Promise<void> {
  await execFileAsync("gh", ["issue", "reopen", String(number)]);
}

export async function closeIssue(number: number, closingComment?: string): Promise<void> {
  if (closingComment) await commentOnIssue(number, closingComment);
  await execFileAsync("gh", ["issue", "close", String(number)]);
}
