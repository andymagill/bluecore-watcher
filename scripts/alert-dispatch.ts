#!/usr/bin/env tsx
// npm run alert:dispatch -- --env <id> --from <sha> --to <sha> [--issues]
// npm run alert:dispatch -- --pipeline-failure <offline|gate> --run-url <url> [--issues]
//
// M3a/ADR-019. Two independent modes, both writing to the "alert" label:
//
// Normal mode diffs public/data as committed at two git shas (--from, the
// ingest job's base commit; --to, its post-merge HEAD) via src/alerts/plan.ts's
// planAlerts(), against the *current* config/<env>.config.ts — today's alert
// rules, not whatever was configured historically at either sha (see
// docs/plans/m3-operability.md's "Other decisions"). This is what
// .github/workflows/ingest.yml runs after every squash-merge; it's also
// safe to replay offline against real history for testing (any two shas on
// main, `--from <older> --to <newer>`, without --issues just prints the
// plan).
//
// --pipeline-failure mode is unrelated to any commit diff — it's what
// ingest.yml runs when the *offline* gate (schema/contract, before any
// write) or the *live* gate (the Workers Builds preview smoke render,
// before a merge) fails. It keeps exactly one deduped issue,
// "Pipeline: ingestion gate failed", commenting on repeats rather than
// opening a new one per run — before this, ingest.yml opened one issue per
// failing run, so a week-long outage produced 7 separate issues. It closes
// itself the next time normal mode runs after a successful merge.
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CmieConfig } from "../src/config/index.js";
import { loadPreviousState, type StateReader } from "../src/ingest/persist.js";
import { planAlerts, type AlertAction, type ExistingAlertIssue } from "../src/alerts/plan.js";
import { collectActiveSecretValues, scrubSecrets } from "../src/ingest/scrub.js";
import {
  ensureLabel,
  listIssuesByLabel,
  createIssue,
  commentOnIssue,
  reopenIssue,
  closeIssue,
} from "./lib/gh-issues.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const ALERT_LABEL = "alert";
const SEVERITY_LABELS = ["severity:info", "severity:warn", "severity:critical"];
const PIPELINE_ISSUE_TITLE = "Pipeline: ingestion gate failed";

function usage(): never {
  console.error(
    "Usage: npm run alert:dispatch -- --env <environmentId> --from <sha> --to <sha> [--issues]\n" +
      "       npm run alert:dispatch -- --pipeline-failure <offline|gate> --run-url <url> [--issues]",
  );
  process.exit(2);
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

// A StateReader backed by `git show <sha>:public/data/<relPath>` — lets
// loadPreviousState (src/ingest/persist.ts) diff two *committed* states
// without touching the filesystem or requiring either sha to be checked out.
function gitShowReader(sha: string): StateReader {
  return async (relPath) => {
    try {
      const { stdout } = await execFileAsync("git", ["show", `${sha}:public/data/${relPath}`], {
        cwd: root,
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout;
    } catch (err) {
      // git show's exit code and stderr text are the only signal execFile
      // gives us to tell "path doesn't exist at that commit" (expected — a
      // target added or retired between --from and --to) from a real error
      // (bad sha, corrupt object, wrong cwd).
      const message = (err as { stderr?: string }).stderr ?? (err as Error).message ?? "";
      if (/does not exist|exists on disk, but not in/.test(message)) return null;
      throw err;
    }
  };
}

async function loadConfig(envId: string): Promise<CmieConfig> {
  const mod = await import(pathToFileURL(join(root, "config", `${envId}.config.ts`)).href);
  return CmieConfig.parse(mod.config ?? mod.default);
}

// Deriving `key` from the title we ourselves wrote (src/alerts/plan.ts's
// `Alert: <targetId>.<extractorKey>` / `Health: <targetId>`) rather than
// from the hidden marker: the marker only ever reflects the issue *body*
// text (set once, at creation) — it can't see a later comment, so it can't
// tell a months-old alert from one that fired again yesterday. GitHub's own
// `updatedAt`, which every action this script takes (create/reopen/comment)
// naturally advances, stands in for lastFiredAt instead. Documented tradeoff
// in docs/plans/m3-operability.md.
function keyFromTitle(title: string): string | null {
  const valueMatch = /^Alert: (.+)$/.exec(title);
  if (valueMatch) return `value:${valueMatch[1]}`;
  const healthMatch = /^Health: (.+)$/.exec(title);
  if (healthMatch) return `health:${healthMatch[1]}`;
  return null;
}

async function loadExistingAlertIssues(): Promise<ExistingAlertIssue[]> {
  const issues = await listIssuesByLabel(ALERT_LABEL, "all");
  const existing: ExistingAlertIssue[] = [];
  for (const issue of issues) {
    const key = keyFromTitle(issue.title);
    if (!key) continue; // not one of ours (e.g. the pipeline-failure issue)
    existing.push({
      key,
      number: issue.number,
      state: issue.state === "OPEN" ? "open" : "closed",
      lastFiredAt: issue.updatedAt,
    });
  }
  return existing;
}

async function applyAction(action: AlertAction): Promise<void> {
  const labels = [ALERT_LABEL, `severity:${action.severity}`];
  if (action.type === "create") {
    const number = await createIssue(action.title, action.body, labels);
    console.log(`  created issue #${number} (${action.key})`);
  } else if (action.type === "reopen") {
    await reopenIssue(action.number!);
    await commentOnIssue(action.number!, action.body);
    console.log(`  reopened issue #${action.number} (${action.key})`);
  } else if (action.type === "comment") {
    await commentOnIssue(action.number!, action.body);
    console.log(`  commented on issue #${action.number} (${action.key})`);
  } else {
    await closeIssue(action.number!, action.body);
    console.log(`  closed issue #${action.number} (${action.key})`);
  }
}

async function ensureAlertLabels(): Promise<void> {
  await ensureLabel(ALERT_LABEL, {
    description: "Operator-facing pipeline alert (03-INGESTION.md §4)",
  });
  for (const label of SEVERITY_LABELS) await ensureLabel(label);
}

async function runNormalMode(withIssues: boolean): Promise<void> {
  const envId = getArg("--env");
  const from = getArg("--from");
  const to = getArg("--to");
  if (!envId || !from || !to) usage();

  const config = await loadConfig(envId);
  const prev = await loadPreviousState(gitShowReader(from));
  const next = await loadPreviousState(gitShowReader(to));

  if (!next.manifest || !next.health) {
    console.log(`No data committed at ${to} — nothing to dispatch.`);
    return;
  }

  const existingIssues = withIssues ? await loadExistingAlertIssues() : [];
  const actions = planAlerts({ prev, next, config, existingIssues, now: new Date() });
  const secretValues = collectActiveSecretValues(config);

  console.log(`${actions.length} alert action(s) for ${from}..${to}:`);
  for (const action of actions)
    console.log(`  [${action.type}] ${action.key} (${action.severity})`);

  if (!withIssues) return;

  await ensureAlertLabels();
  for (const action of actions) {
    await applyAction({ ...action, body: scrubSecrets(action.body, secretValues) });
  }

  // A clean merge is this script's own signal that the pipeline is healthy
  // again — close the deduped pipeline-failure issue if one is open, so a
  // real repair doesn't need a human to remember to close it by hand.
  const openIssues = await listIssuesByLabel(ALERT_LABEL, "open");
  const openPipelineIssue = openIssues.find((i) => i.title === PIPELINE_ISSUE_TITLE);
  if (openPipelineIssue) {
    await closeIssue(
      openPipelineIssue.number,
      `Ingestion succeeded (${to}) — closing.\n\n<!-- bw-alert key=pipeline firedAt=${new Date().toISOString()} -->`,
    );
    console.log(`  closed pipeline-failure issue #${openPipelineIssue.number} (recovered)`);
  }
}

async function runPipelineFailureMode(kind: string, withIssues: boolean): Promise<void> {
  if (kind !== "offline" && kind !== "gate") usage();
  const runUrl = getArg("--run-url");
  if (!runUrl) usage();

  const body =
    kind === "offline"
      ? `Schema validation or contract assertions failed during ingestion — an engine defect (03-INGESTION.md §3), not a source problem. Run: ${runUrl}`
      : `The gate (schema/contract/smoke-render against the preview) failed and the branch was left unmerged — \`main\` is untouched, still serving the last good data. Run: ${runUrl}`;
  const marked = `${body}\n\n<!-- bw-alert key=pipeline firedAt=${new Date().toISOString()} -->`;

  console.log(`Pipeline failure (${kind}): ${runUrl}`);
  if (!withIssues) return;

  await ensureAlertLabels();
  const openIssues = await listIssuesByLabel(ALERT_LABEL, "open");
  const existing = openIssues.find((i) => i.title === PIPELINE_ISSUE_TITLE);
  if (existing) {
    await commentOnIssue(existing.number, marked);
    console.log(`  commented on existing pipeline-failure issue #${existing.number}`);
  } else {
    const number = await createIssue(PIPELINE_ISSUE_TITLE, marked, [
      ALERT_LABEL,
      "severity:critical",
    ]);
    console.log(`  created pipeline-failure issue #${number}`);
  }
}

async function main() {
  const withIssues = process.argv.includes("--issues");
  const pipelineKind = getArg("--pipeline-failure");
  if (pipelineKind) await runPipelineFailureMode(pipelineKind, withIssues);
  else await runNormalMode(withIssues);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
