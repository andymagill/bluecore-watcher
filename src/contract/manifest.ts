// manifest.json — 01-DATA-CONTRACT.md §2. Fetched first by the SPA;
// manifest.targets[] is the scheduling source of truth for `plan`
// (see the note added to §2 and 03-INGESTION.md §1 "plan").
import { z } from "zod";
import { RunStatus } from "./target-file.js";

export const EntityRole = z.enum(["primary", "competitor", "parent", "counterparty", "regulator"]);
export type EntityRole = z.infer<typeof EntityRole>;

export const ManifestEntity = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: EntityRole,
});
export type ManifestEntity = z.infer<typeof ManifestEntity>;

export const ManifestSection = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  order: z.int(),
});
export type ManifestSection = z.infer<typeof ManifestSection>;

export const ManifestTarget = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  sectionId: z.string().min(1),
  entityId: z.string().min(1),
  label: z.string().min(1),
  path: z.string().min(1),
  ttlHours: z.number().positive(),
  lastRunStatus: RunStatus,
  lastSuccessAt: z.iso.datetime().nullable(),
});
export type ManifestTarget = z.infer<typeof ManifestTarget>;

export const HealthSummaryOverall = z.enum(["ok", "degraded", "failed"]);
export type HealthSummaryOverall = z.infer<typeof HealthSummaryOverall>;

export const Manifest = z.object({
  schemaVersion: z.literal(1),
  environmentId: z.string().min(1),
  displayName: z.string().min(1),
  generatedAt: z.iso.datetime(),
  runId: z.string().min(1),
  commit: z.string().min(1),
  entities: z.array(ManifestEntity),
  sections: z.array(ManifestSection),
  targets: z.array(ManifestTarget),
  health: z.object({
    overall: HealthSummaryOverall,
    ok: z.int().nonnegative(),
    degraded: z.int().nonnegative(),
    failed: z.int().nonnegative(),
  }),
});
export type Manifest = z.infer<typeof Manifest>;
