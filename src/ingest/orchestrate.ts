// 03-INGESTION.md §1. M0.5 scope: every configured target is processed each
// run (no cron/manifest due-date filtering yet — that's `plan`, an M1/M2
// concern once real schedules exist). fetch -> parse -> per-extractor
// process -> assemble target files -> persist (or report, in --dry mode).
import { IngestError, toErrorClass } from "./errors.js";
import type { CmieConfig, TargetDef } from "../config/schema.js";
import type { TargetFile, RunStatus } from "../contract/target-file.js";
import type { Block } from "../contract/block.js";
import { FixtureFetcher } from "./fetch/fixture-fetcher.js";
import type { Fetcher, RunContext } from "./fetch/types.js";
import { getHandler } from "./extract/registry.js";
import { processExtractor, type HealthEntryDraft } from "./process-extractor.js";
import { AcknowledgementStore } from "./acknowledgements.js";
import { buildHealth, buildManifest, computeFingerprint, loadPreviousState, writeAll } from "./persist.js";
import type { Manifest } from "../contract/manifest.js";
import type { Health } from "../contract/health.js";
import { runGate, type GateReport } from "../gate/index.js";

export interface RunOptions {
  config: CmieConfig;
  dataDir: string;
  fixturesDir: string;
  acknowledgementsPath: string;
  runId: string;
  now: () => Date;
  commit?: string;
  fetcher?: Fetcher; // defaults to FixtureFetcher — production wires a real one in M1
}

export interface RunResult {
  changed: boolean;
  manifest: Manifest;
  health: Health;
  targetFiles: TargetFile[];
  consumedAcknowledgements: number;
  /** Not written by runIngestion (which never writes) — runAndPersist saves it when !dryRun and something was consumed. */
  acknowledgementStore: AcknowledgementStore;
  previousTargetFiles: ReadonlyMap<string, TargetFile>;
}

async function runOneTarget(
  target: TargetDef,
  fetcher: Fetcher,
  ctx: RunContext,
  previousTargetFile: TargetFile | undefined,
  acknowledgements: AcknowledgementStore,
): Promise<{ targetFile: TargetFile; healthDrafts: HealthEntryDraft[]; consumedCount: number }> {
  const nowIso = ctx.now().toISOString();
  const previousBlocks = new Map<string, Block>((previousTargetFile?.blocks ?? []).map((b) => [b.key, b]));
  const handler = getHandler(target.kind);

  let doc: unknown;
  let httpStatus: number;
  let fetchError: IngestError | null = null;
  try {
    const fetched = await fetcher.fetch(target, ctx);
    httpStatus = fetched.httpStatus;
    doc = await handler.parse(fetched);
  } catch (err) {
    fetchError = err instanceof IngestError ? err : new IngestError("UNKNOWN", String(err));
    httpStatus = fetchError.httpStatus ?? 0;
    doc = null;
  }

  const blocks: Block[] = [];
  const healthDrafts: HealthEntryDraft[] = [];
  let anyRequiredFailed = false;
  let anyFailed = false;
  let consumedCount = 0;

  if (fetchError) {
    // Whole-target fetch failure: every extractor is "cached" (or "missing"
    // on first run) — the file is untouched except run (01-DATA-CONTRACT.md
    // run.status "failed_cached").
    for (const extractor of target.extractors) {
      const prev = previousBlocks.get(extractor.key);
      blocks.push(
        prev
          ? { ...prev, status: "cached" }
          : ({ key: extractor.key, label: extractor.label, type: extractor.type, presenter: extractor.presenter, unit: extractor.unit, status: "missing", value: null, displayValue: null, provenance: null, delta: null, validation: { passed: false, warnings: [] } } as Block),
      );
      healthDrafts.push({
        targetId: target.id,
        extractorKey: extractor.key,
        status: "failed",
        errorClass: toErrorClass(fetchError),
        message: fetchError.message,
        failingSelector: null,
        httpStatus: fetchError.httpStatus,
      });
      if (extractor.required) anyRequiredFailed = true;
    }
    anyFailed = true;
  } else {
    for (const extractor of target.extractors) {
      const result = await processExtractor({
        handler,
        doc,
        extractor,
        target,
        previousBlock: previousBlocks.get(extractor.key) ?? null,
        acknowledgements,
        now: ctx.now(),
        httpStatus,
      });
      blocks.push(result.block);
      if (result.healthEntryDraft) {
        healthDrafts.push(result.healthEntryDraft);
        anyFailed = true;
        if (extractor.required && result.healthEntryDraft.status === "failed") anyRequiredFailed = true;
      }
      if (result.consumedAcknowledgement) {
        acknowledgements.consume(result.consumedAcknowledgement);
        consumedCount++;
      }
    }
  }

  const status: RunStatus = anyRequiredFailed ? "failed_cached" : anyFailed ? "partial" : "ok";
  const startedAt = previousTargetFile?.run.completedAt ?? nowIso;

  // failed_cached retains the ENTIRE previous file unchanged except `run`
  // (01-DATA-CONTRACT.md §3) — a required extractor's failure must not let
  // a *different*, successfully re-extracted block overwrite good data with
  // a value the run as a whole didn't earn.
  const finalBlocks = status === "failed_cached" && previousTargetFile ? previousTargetFile.blocks : blocks;

  const targetFile: TargetFile = {
    schemaVersion: 1,
    targetId: target.id,
    entityId: target.entityId,
    sectionId: target.sectionId,
    label: target.label,
    sourceUrl: target.url,
    ttlHours: target.schedule.ttlHours,
    run: {
      runId: ctx.runId,
      startedAt,
      completedAt: nowIso,
      durationMs: 0,
      status,
      renderer: target.renderer,
      httpStatus: fetchError ? fetchError.httpStatus : httpStatus,
    },
    blocks: finalBlocks,
  };

  return { targetFile, healthDrafts, consumedCount };
}

export async function runIngestion(opts: RunOptions): Promise<RunResult> {
  const fetcher = opts.fetcher ?? new FixtureFetcher(opts.fixturesDir);
  const ctx: RunContext = { runId: opts.runId, now: opts.now };
  const previous = await loadPreviousState(opts.dataDir);
  const acknowledgements = await AcknowledgementStore.load(opts.acknowledgementsPath);

  const targetFiles: TargetFile[] = [];
  const allHealthDrafts: HealthEntryDraft[] = [];
  let consumedCount = 0;

  for (const target of opts.config.targets) {
    const { targetFile, healthDrafts, consumedCount: c } = await runOneTarget(
      target,
      fetcher,
      ctx,
      previous.targetFiles.get(target.id),
      acknowledgements,
    );
    targetFiles.push(targetFile);
    allHealthDrafts.push(...healthDrafts);
    consumedCount += c;
  }

  const nowIso = ctx.now().toISOString();
  const manifest = buildManifest(opts.config, targetFiles, opts.runId, nowIso, opts.commit ?? "dry-run");
  const health = buildHealth(previous.health, allHealthDrafts, targetFiles, opts.runId, nowIso);

  const newFingerprint = computeFingerprint(manifest, targetFiles, health);
  const oldFingerprint =
    previous.manifest && previous.health
      ? computeFingerprint(previous.manifest, [...previous.targetFiles.values()], previous.health)
      : null;
  const changed = newFingerprint !== oldFingerprint;

  return {
    changed,
    manifest,
    health,
    targetFiles,
    consumedAcknowledgements: consumedCount,
    acknowledgementStore: acknowledgements,
    previousTargetFiles: previous.targetFiles,
  };
}

export interface RunAndPersistResult extends RunResult {
  gate: GateReport | null; // null when there was nothing to gate (unchanged, or dry run)
}

// M0.5 stand-in for ADR-005's real sequencing (commit to branch -> preview
// -> gate -> merge): with no branch/CI yet, the gate runs synchronously
// before the write it would otherwise guard. "The gate must actually gate"
// — a failing gate leaves public/data untouched, same as a failed merge
// leaves `main` untouched. M1 moves the gate to run against the real
// branch/preview per doc 03 §3's staged plan.
export async function runAndPersist(opts: RunOptions, dryRun: boolean, schemasDir: string): Promise<RunAndPersistResult> {
  const result = await runIngestion(opts);
  if (dryRun || !result.changed) return { ...result, gate: null };

  const gate = await runGate({
    schemasDir,
    manifest: result.manifest,
    health: result.health,
    targetFiles: result.targetFiles,
    previousTargetFiles: result.previousTargetFiles,
  });
  if (!gate.passed) return { ...result, gate };

  await writeAll(opts.dataDir, result.manifest, result.health, result.targetFiles);
  if (result.consumedAcknowledgements > 0) await result.acknowledgementStore.save();
  return { ...result, gate };
}
