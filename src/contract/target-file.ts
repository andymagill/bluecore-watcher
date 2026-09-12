// Target file — 01-DATA-CONTRACT.md §3. One file per target, written to
// public/data/sections/<sectionId>/<targetId>.json.
import { z } from "zod";
import { Block } from "./block.js";

export const RunStatus = z.enum(["ok", "partial", "failed_cached"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunInfo = z.object({
  runId: z.string().min(1),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  durationMs: z.int().nonnegative(),
  status: RunStatus,
  renderer: z.enum(["static", "browser"]),
  httpStatus: z.int().nullable(),
});
export type RunInfo = z.infer<typeof RunInfo>;

export const TargetFile = z.object({
  schemaVersion: z.literal(1),
  targetId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  entityId: z.string().min(1),
  sectionId: z.string().min(1),
  label: z.string().min(1),
  sourceUrl: z.url(),
  ttlHours: z.number().positive(),
  run: RunInfo,
  blocks: z.array(Block),
});
export type TargetFile = z.infer<typeof TargetFile>;
