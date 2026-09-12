// 03-INGESTION.md §1 "persist". Builds manifest/health/target files, decides
// whether anything changed semantically (ADR-011), and writes only when it
// did. Health's firstSeenAt/consecutiveFailures survive across runs from the
// previously *committed* health, independent of whether this run's gate
// passes (Invariant 8).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Block } from "../contract/block.js";
import { Health, type HealthEntry } from "../contract/health.js";
import { Manifest, type ManifestTarget } from "../contract/manifest.js";
import { TargetFile } from "../contract/target-file.js";
import type { CmieConfig } from "../config/schema.js";
import type { HealthEntryDraft } from "./process-extractor.js";

// ---- Stable serialization — sorted keys, 2-space indent, trailing newline
// (03-INGESTION.md §1 persist; Invariant 7). Array order is preserved:
// only object key order is normalized. ----
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value), null, 2) + "\n";
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

// ---- Manifest ----

export function buildManifest(
  config: CmieConfig,
  targetFiles: TargetFile[],
  runId: string,
  generatedAt: string,
  commit: string,
): Manifest {
  const targets: ManifestTarget[] = targetFiles.map((tf) => ({
    id: tf.targetId,
    sectionId: tf.sectionId,
    entityId: tf.entityId,
    label: tf.label,
    path: `sections/${tf.sectionId}/${tf.targetId}.json`,
    ttlHours: tf.ttlHours,
    lastRunStatus: tf.run.status,
    lastSuccessAt: tf.run.status === "failed_cached" ? null : tf.run.completedAt,
  }));

  const ok = targetFiles.filter((t) => t.run.status === "ok").length;
  const failed = targetFiles.filter((t) => t.run.status === "failed_cached").length;
  const degraded = targetFiles.length - ok - failed;

  return Manifest.parse({
    schemaVersion: 1,
    environmentId: config.environment.id,
    displayName: config.environment.displayName,
    generatedAt,
    runId,
    commit,
    entities: config.environment.entities,
    sections: config.sections,
    targets,
    health: {
      overall: failed > 0 ? "failed" : degraded > 0 ? "degraded" : "ok",
      ok,
      degraded,
      failed,
    },
  });
}

// ---- Health — Invariant 8: firstSeenAt/consecutiveFailures persist across
// runs, computed from the previously *committed* health, not reset by a run
// whose gate later fails. ----

export function buildHealth(
  previousHealth: Health | null,
  drafts: HealthEntryDraft[],
  targetFiles: TargetFile[],
  runId: string,
  generatedAt: string,
): Health {
  const blockByKey = new Map<string, Block>();
  for (const tf of targetFiles) {
    for (const b of tf.blocks) blockByKey.set(`${tf.targetId}::${b.key}`, b);
  }

  const entries: HealthEntry[] = drafts.map((d) => {
    const compositeKey = `${d.targetId}::${d.extractorKey}`;
    const prior = previousHealth?.entries.find((e) => e.targetId === d.targetId && e.extractorKey === d.extractorKey);
    const block = blockByKey.get(compositeKey);
    return {
      targetId: d.targetId,
      extractorKey: d.extractorKey,
      status: d.status,
      errorClass: d.errorClass,
      message: d.message,
      failingSelector: d.failingSelector,
      httpStatus: d.httpStatus,
      firstSeenAt: prior?.firstSeenAt ?? generatedAt,
      consecutiveFailures: (prior?.consecutiveFailures ?? 0) + 1,
      servingCachedFrom: block?.provenance?.extractedAt ?? prior?.servingCachedFrom ?? null,
      stack: null,
    };
  });

  const oldestAgeHours = targetFiles.length
    ? Math.max(
        0,
        ...targetFiles.map((tf) => (new Date(generatedAt).getTime() - new Date(tf.run.completedAt).getTime()) / 3_600_000),
      )
    : 0;

  return Health.parse({
    schemaVersion: 1,
    generatedAt,
    runId,
    summary: {
      targets: targetFiles.length,
      ok: targetFiles.filter((t) => t.run.status === "ok").length,
      degraded: entries.filter((e) => e.status === "flagged").length,
      failed: entries.filter((e) => e.status === "failed").length,
      oldestDataAgeHours: Math.round(oldestAgeHours * 100) / 100,
      targetsPastCeiling: 0, // computed client-side at render time, per 01-DATA-CONTRACT.md §5 — not known here
    },
    entries,
  });
}

// ---- Semantic fingerprint (ADR-011) ----

export function computeFingerprint(manifest: Manifest, targetFiles: TargetFile[], health: Health): string {
  const targetFp = targetFiles
    .map((tf) => ({
      targetId: tf.targetId,
      label: tf.label,
      sourceUrl: tf.sourceUrl,
      ttlHours: tf.ttlHours,
      runStatus: tf.run.status,
      blocks: tf.blocks.map((b) => ({ key: b.key, status: b.status, contentHash: b.provenance?.contentHash ?? null, value: b.value })),
    }))
    .sort((a, b) => a.targetId.localeCompare(b.targetId));

  const healthFp = health.entries
    .map((e) => ({ targetId: e.targetId, extractorKey: e.extractorKey, status: e.status, errorClass: e.errorClass, consecutiveFailures: e.consecutiveFailures }))
    .sort((a, b) => (a.targetId + a.extractorKey).localeCompare(b.targetId + b.extractorKey));

  return stableStringify({
    environmentId: manifest.environmentId,
    targets: targetFp,
    health: healthFp,
  });
}

// ---- Loading previous state, for diffing against ----

export async function loadPreviousState(
  dataDir: string,
): Promise<{ manifest: Manifest | null; health: Health | null; targetFiles: Map<string, TargetFile> }> {
  const manifest = await readJsonOrNull(join(dataDir, "manifest.json"), Manifest);
  const health = await readJsonOrNull(join(dataDir, "health.json"), Health);
  const targetFiles = new Map<string, TargetFile>();
  if (manifest) {
    for (const t of manifest.targets) {
      const tf = await readJsonOrNull(join(dataDir, t.path), TargetFile);
      if (tf) targetFiles.set(t.id, tf);
    }
  }
  return { manifest, health, targetFiles };
}

async function readJsonOrNull<T>(path: string, schema: { parse: (v: unknown) => T }): Promise<T | null> {
  try {
    return schema.parse(JSON.parse(await readFile(path, "utf-8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

// ---- Writing ----

export async function writeAll(dataDir: string, manifest: Manifest, health: Health, targetFiles: TargetFile[]): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeJson(join(dataDir, "manifest.json"), manifest);
  await writeJson(join(dataDir, "health.json"), health);
  for (const tf of targetFiles) {
    const path = join(dataDir, "sections", tf.sectionId, `${tf.targetId}.json`);
    await writeJson(path, tf);
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stableStringify(value), "utf-8");
}
