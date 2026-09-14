// M3a/ADR-019 — the alert planner. Pure: no network, no `gh` calls, no
// filesystem. Diffs two *committed* states (before/after a squash-merge —
// see scripts/alert-dispatch.ts, which supplies both via
// src/ingest/persist.ts's StateReader) against `config.targets[].extractors[].alert`
// and `config.alerting`, and returns the GitHub Issue actions a dispatcher
// should take. This is what "alerts come from the committed-state diff after
// merge, not a run artifact" (docs/plans/m3-operability.md) means in code:
// the same function runs inside the ingest job and can be replayed offline
// against real git history for testing.
import type { CmieConfig, AlertDef } from "../config/schema.js";
import type { Manifest } from "../contract/manifest.js";
import type { Health, HealthEntry } from "../contract/health.js";
import type { TargetFile } from "../contract/target-file.js";
import type { Block } from "../contract/block.js";

export interface CommittedState {
  manifest: Manifest | null;
  health: Health | null;
  targetFiles: ReadonlyMap<string, TargetFile>;
}

export type AlertSeverity = "info" | "warn" | "critical";

// What the caller (alert-dispatch.ts) already knows about a currently-open
// or previously-closed alert issue, parsed from the `alert`-labelled issues
// it lists via `gh`. `lastFiredAt` comes from the hidden
// `<!-- bw-alert key=<key> firedAt=<iso> -->` marker this module embeds in
// every body/comment it writes — the caller is responsible for finding the
// most recent one across the issue body and its comments.
export interface ExistingAlertIssue {
  key: string;
  number: number;
  state: "open" | "closed";
  lastFiredAt: string | null;
}

export type AlertActionType = "create" | "reopen" | "comment" | "close";

export interface AlertAction {
  type: AlertActionType;
  key: string;
  /** Present for reopen/comment/close — the existing issue's number. */
  number?: number;
  title: string;
  body: string;
  severity: AlertSeverity;
}

export interface PlanAlertsInput {
  prev: CommittedState;
  next: CommittedState;
  config: CmieConfig;
  existingIssues: readonly ExistingAlertIssue[];
  now: Date;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 0, warn: 1, critical: 2 };

export function planAlerts(input: PlanAlertsInput): AlertAction[] {
  return [...planValueAlerts(input), ...planHealthAlerts(input)];
}

function marker(key: string, firedAt: string): string {
  return `<!-- bw-alert key=${key} firedAt=${firedAt} -->`;
}

function minSeverityRank(config: CmieConfig): number {
  return SEVERITY_RANK[config.alerting?.minSeverity ?? "warn"];
}

function suppressedByQuietHours(
  existing: ExistingAlertIssue | undefined,
  quietHours: number | undefined,
  now: Date,
): boolean {
  if (!existing?.lastFiredAt || !quietHours) return false;
  const elapsedHours = (now.getTime() - new Date(existing.lastFiredAt).getTime()) / 3_600_000;
  return elapsedHours < quietHours;
}

function actionTypeFor(existing: ExistingAlertIssue | undefined): AlertActionType {
  if (!existing) return "create";
  return existing.state === "closed" ? "reopen" : "comment";
}

// ---- Value alerts — one issue per targetId.extractorKey ----

function findExtractorAlert(
  config: CmieConfig,
  targetId: string,
  extractorKey: string,
): AlertDef | undefined {
  return config.targets
    .find((t) => t.id === targetId)
    ?.extractors.find((e) => e.key === extractorKey)?.alert;
}

// Only a successfully-published block (status "ok") can trigger a value
// alert — a "cached"/"flagged"/"missing" block already has a health alert
// covering it (planHealthAlerts below), and alerting on a value that didn't
// actually get republished this run would be alerting on stale data.
function valueAlertFires(alertDef: AlertDef, block: Block, prevBlock: Block | undefined): boolean {
  if (alertDef.on === "any-change") {
    if (!prevBlock?.provenance || !block.provenance) return false; // no prior value to have "changed" from
    return prevBlock.provenance.contentHash !== block.provenance.contentHash;
  }
  if (alertDef.on === "threshold") {
    if (alertDef.thresholdPct === undefined || !block.delta) return false;
    if (block.delta.kind === "scalar")
      return Math.abs(block.delta.percent) >= alertDef.thresholdPct;
    // SetDelta (presenter "list") — percent change in item count, per
    // 01-DATA-CONTRACT.md §4.1 ("there is no meaningful percent change of a
    // set of strings" beyond count).
    const { count, previousCount } = block.delta;
    if (previousCount === 0) return count > 0;
    return (Math.abs(count - previousCount) / previousCount) * 100 >= alertDef.thresholdPct;
  }
  return false; // "never" (or unrecognized) — the caller already skips "never" before calling this
}

function formatValueAlertBody(
  tf: TargetFile,
  block: Block,
  prevBlock: Block | undefined,
  key: string,
  firedAt: string,
): string {
  const lines = [`**${tf.label} — ${block.label}** changed.`, ""];
  lines.push(`- New value: \`${JSON.stringify(block.displayValue ?? block.value)}\``);
  if (prevBlock) {
    lines.push(
      `- Previous value: \`${JSON.stringify(prevBlock.displayValue ?? prevBlock.value)}\``,
    );
  }
  if (block.provenance) lines.push(`- Source: ${block.provenance.sourceUrl}`);
  lines.push("", marker(key, firedAt));
  return lines.join("\n");
}

function planValueAlerts(input: PlanAlertsInput): AlertAction[] {
  const { prev, next, config, existingIssues, now } = input;
  const minRank = minSeverityRank(config);
  const nowIso = now.toISOString();
  const actions: AlertAction[] = [];

  for (const tf of next.targetFiles.values()) {
    for (const block of tf.blocks) {
      const alertDef = findExtractorAlert(config, tf.targetId, block.key);
      if (!alertDef || alertDef.on === "never") continue;
      if (block.status !== "ok") continue;

      const prevBlock = prev.targetFiles.get(tf.targetId)?.blocks.find((b) => b.key === block.key);
      if (!valueAlertFires(alertDef, block, prevBlock)) continue;

      const severity: AlertSeverity = alertDef.severity ?? "warn";
      if (SEVERITY_RANK[severity] < minRank) continue;

      const key = `value:${tf.targetId}.${block.key}`;
      const existing = existingIssues.find((i) => i.key === key);
      if (suppressedByQuietHours(existing, alertDef.quietHours, now)) continue;

      actions.push({
        type: actionTypeFor(existing),
        key,
        number: existing?.number,
        title: `Alert: ${tf.targetId}.${block.key}`,
        body: formatValueAlertBody(tf, block, prevBlock, key, nowIso),
        severity,
      });
    }
  }
  return actions;
}

// ---- Health alerts — one issue per targetId ----

// 03-INGESTION.md §4: "Health-derived alerts fire on the transition to
// failing and again at 3 and 7 consecutive failures — not every run." An
// entry "triggers" only when its consecutiveFailures both lands on one of
// these milestones *and* differs from what it was in `prev` — so a target
// sitting at 4 consecutive failures for several runs in a row (nothing
// crossed a milestone) produces no repeat noise.
const HEALTH_MILESTONES = [1, 3, 7] as const;

function findAckSnippet(tf: TargetFile | undefined, entry: HealthEntry): string | null {
  if (entry.errorClass !== "CHANGE_GUARD_TRIPPED") return null;
  const block = tf?.blocks.find((b) => b.key === entry.extractorKey);
  const warning = block?.validation.warnings.find((w) => w.rejectedContentHash);
  if (!warning?.rejectedContentHash) return null;
  const snippet = {
    targetId: entry.targetId,
    extractorKey: entry.extractorKey,
    contentHash: warning.rejectedContentHash,
    reason: "<why this move is genuine>",
    acknowledgedBy: "<you>",
    acknowledgedAt: new Date().toISOString(),
  };
  return [
    "To release this value (ADR-012), add this entry to `config/acknowledgements.json`:",
    "",
    "```json",
    JSON.stringify(snippet, null, 2),
    "```",
  ].join("\n");
}

function formatHealthAlertBody(
  targetId: string,
  tf: TargetFile | undefined,
  entries: readonly HealthEntry[],
  key: string,
  firedAt: string,
): string {
  const lines = [
    `**${tf?.label ?? targetId}** has ${entries.length} failing/flagged extractor(s).`,
    "",
  ];
  for (const e of entries) {
    const runWord = e.consecutiveFailures === 1 ? "run" : "runs";
    lines.push(
      `### \`${e.extractorKey}\` — ${e.errorClass} (${e.consecutiveFailures} consecutive ${runWord})`,
    );
    lines.push(e.message);
    if (e.failingSelector) lines.push(`Selector: \`${e.failingSelector}\``);
    if (e.servingCachedFrom) lines.push(`Serving cached value from ${e.servingCachedFrom}.`);
    const ack = findAckSnippet(tf, e);
    if (ack) lines.push("", ack);
    lines.push("");
  }
  lines.push("See `06-OPS-RUNBOOK.md` §3/§5/§6/§7 for the matching runbook entry.");
  lines.push("", marker(key, firedAt));
  return lines.join("\n");
}

function planHealthAlerts(input: PlanAlertsInput): AlertAction[] {
  const { prev, next, config, existingIssues, now } = input;
  const minRank = minSeverityRank(config);
  const nowIso = now.toISOString();
  const actions: AlertAction[] = [];

  const targetIds = new Set<string>([
    ...(prev.health?.entries.map((e) => e.targetId) ?? []),
    ...(next.health?.entries.map((e) => e.targetId) ?? []),
  ]);

  for (const targetId of targetIds) {
    const nextEntries = next.health?.entries.filter((e) => e.targetId === targetId) ?? [];
    const prevEntries = prev.health?.entries.filter((e) => e.targetId === targetId) ?? [];
    const key = `health:${targetId}`;
    const existing = existingIssues.find((i) => i.key === key);

    if (nextEntries.length === 0) {
      if (existing?.state === "open") {
        actions.push({
          type: "close",
          key,
          number: existing.number,
          title: `Health: ${targetId}`,
          body: `All extractors on \`${targetId}\` recovered — closing.\n\n${marker(key, nowIso)}`,
          severity: "info",
        });
      }
      continue;
    }

    const triggering = nextEntries.filter((e) => {
      const prevCount =
        prevEntries.find((p) => p.extractorKey === e.extractorKey)?.consecutiveFailures ?? 0;
      return (
        (HEALTH_MILESTONES as readonly number[]).includes(e.consecutiveFailures) &&
        e.consecutiveFailures !== prevCount
      );
    });
    if (triggering.length === 0) continue;

    const severity: AlertSeverity = triggering.some((e) => e.consecutiveFailures >= 7)
      ? "critical"
      : "warn";
    if (SEVERITY_RANK[severity] < minRank) continue;

    const tf = next.targetFiles.get(targetId);
    actions.push({
      type: actionTypeFor(existing),
      key,
      number: existing?.number,
      title: `Health: ${targetId}`,
      body: formatHealthAlertBody(targetId, tf, nextEntries, key, nowIso),
      severity,
    });
  }
  return actions;
}
