#!/usr/bin/env tsx
// npm run drift -- --env <id> [--only <id[,id...]>] [--issues]
// 03-INGESTION.md §5 "weekly drift check" / docs/07-ROADMAP.md M2b. Fetches
// each target's live response with the same HttpFetcher a real ingestion
// run uses (politeness/robots/auth honoured identically — this is
// deliberately not a second, gentler fetch path) and compares it against
// the committed fixture via src/drift/check.ts. A page that has drifted
// structurally is a warning, not a failure: this script's own exit code
// only ever reflects whether the check *ran*, never what it found — a
// drifting source should never turn the weekly workflow red.
//
// --issues opens/updates/closes one GitHub Issue per drifting target
// (label "drift", title "Drift: <targetId>" — src/drift/issues.ts owns the
// dedup logic). Omit it for a local run: no `gh` calls, just the report.
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appendFile } from "node:fs/promises";
import { CmieConfig, type TargetDef } from "../src/config/index.js";
import { HttpFetcher } from "../src/ingest/fetch/http-fetcher.js";
import { FixtureFetcher } from "../src/ingest/fetch/fixture-fetcher.js";
import type { FetchResult } from "../src/ingest/fetch/types.js";
import { IngestError } from "../src/ingest/errors.js";
import { collectActiveSecretValues, scrubSecrets } from "../src/ingest/scrub.js";
import {
  checkTargetDrift,
  fetchFailedResult,
  isDrifting,
  type TargetDriftResult,
} from "../src/drift/check.js";
import { planIssueSync, issueTitle, type OpenDriftIssue } from "../src/drift/issues.js";
import {
  ensureLabel,
  listIssuesByLabel,
  createIssue,
  commentOnIssue,
  closeIssue,
} from "./lib/gh-issues.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const ISSUE_LABEL = "drift";

function usage(): never {
  console.error("Usage: npm run drift -- --env <environmentId> [--only <id[,id...]>] [--issues]");
  process.exit(2);
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function getOnlyIds(): string[] | null {
  const value = getArg("--only");
  if (!value) return null;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function scrubResult(
  result: TargetDriftResult,
  secretValues: readonly string[],
): TargetDriftResult {
  return {
    ...result,
    signals: result.signals.map((s) => ({ ...s, message: scrubSecrets(s.message, secretValues) })),
  };
}

async function fetchOne(
  fetcher: {
    fetch(target: TargetDef, ctx: { runId: string; now: () => Date }): Promise<FetchResult>;
  },
  target: TargetDef,
  runId: string,
): Promise<FetchResult> {
  return fetcher.fetch(target, { runId, now: () => new Date() });
}

function formatTable(results: readonly TargetDriftResult[]): string {
  const rows = results.map((r) => {
    const status = !isDrifting(r)
      ? r.signals.length > 0
        ? "⚠️ fetch failed"
        : "✅ clean"
      : "🟡 drift";
    const signalList = r.signals
      .map((s) => s.code + (s.extractorKey ? `(${s.extractorKey})` : ""))
      .join(", ");
    return `| ${r.targetId} | ${status} | ${signalList || "—"} |`;
  });
  return ["| Target | Status | Signals |", "| --- | --- | --- |", ...rows].join("\n");
}

async function listOpenDriftIssues(): Promise<OpenDriftIssue[]> {
  const issues = await listIssuesByLabel(ISSUE_LABEL, "open");
  const open: OpenDriftIssue[] = [];
  for (const issue of issues) {
    const match = /^Drift: (.+)$/.exec(issue.title);
    if (match) open.push({ targetId: match[1]!, number: issue.number });
  }
  return open;
}

async function syncIssues(results: readonly TargetDriftResult[]): Promise<void> {
  await ensureLabel(ISSUE_LABEL, { description: "Weekly drift check (03-INGESTION.md §5)" });

  const openIssues = await listOpenDriftIssues();
  const actions = planIssueSync(results, openIssues);

  for (const action of actions) {
    if (action.type === "create") {
      await createIssue(issueTitle(action.targetId), action.body, [ISSUE_LABEL]);
      console.log(`  created issue for ${action.targetId}`);
    } else if (action.type === "comment") {
      await commentOnIssue(action.number, action.body);
      console.log(`  commented on issue #${action.number} (${action.targetId})`);
    } else {
      await closeIssue(action.number, action.body);
      console.log(`  closed issue #${action.number} (${action.targetId})`);
    }
  }
  if (actions.length === 0) console.log("  no issue changes needed.");
}

async function main() {
  const envId = getArg("--env");
  if (!envId) usage();
  const withIssues = process.argv.includes("--issues");
  const onlyIds = getOnlyIds();

  const mod = await import(pathToFileURL(join(root, "config", `${envId}.config.ts`)).href);
  const config = CmieConfig.parse(mod.config ?? mod.default);

  let targets = config.targets;
  if (onlyIds) {
    const known = new Set(targets.map((t) => t.id));
    const unknown = onlyIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      console.error(`--only referenced unknown target id(s): ${unknown.join(", ")}`);
      process.exit(2);
    }
    targets = targets.filter((t) => onlyIds.includes(t.id));
  }

  const fixtureFetcher = new FixtureFetcher(join(root, "fixtures"));
  const liveFetcher = new HttpFetcher(config.defaults);
  const secretValues = collectActiveSecretValues(config);
  const runId = "drift-check";

  const results: TargetDriftResult[] = [];
  for (const target of targets) {
    let baseline: FetchResult;
    try {
      baseline = await fetchOne(fixtureFetcher, target, runId);
    } catch (err) {
      console.error(`${target.id}: no usable fixture, skipping (${(err as Error).message})`);
      continue;
    }

    let live: FetchResult;
    try {
      live = await fetchOne(liveFetcher, target, runId);
    } catch (err) {
      const detail = err instanceof IngestError ? `${err.errorClass}: ${err.message}` : String(err);
      results.push(scrubResult(fetchFailedResult(target.id, detail), secretValues));
      continue;
    }

    const result = await checkTargetDrift(target, baseline, live);
    results.push(scrubResult(result, secretValues));
  }

  const table = formatTable(results);
  console.log(`\nDrift check — ${targets.length} target(s):\n`);
  console.log(table);

  const drifting = results.filter(isDrifting);
  console.log(`\n${drifting.length} of ${results.length} target(s) drifting.`);

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    await appendFile(
      summaryPath,
      `## Drift check\n\n${table}\n\n${drifting.length} of ${results.length} target(s) drifting.\n`,
    );
  }

  if (withIssues) {
    console.log("\nSyncing GitHub Issues...");
    await syncIssues(results);
  }

  // This script reports; it never fails the workflow on drift alone (see
  // header comment) — only an actual crash (caught below) exits non-zero.
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
