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
  // M3c — resolved server-side from schedule.staleCeilingHours (per-target
  // override) or environment.staleCeilingMultiplier × ttlHours (the default),
  // per 02-CONFIG-SCHEMA.md. Publishing the resolved number means the
  // freshness state machine (src/app/lib/freshness.ts) doesn't need to
  // re-derive it, and a config change to either input actually takes effect
  // instead of being validated but silently unused. Optional so a target
  // file committed before this field existed still validates; freshness.ts
  // falls back to the documented 3x default when absent.
  staleCeilingHours: z.number().positive().optional(),
  run: RunInfo,
  blocks: z.array(Block),
});
export type TargetFile = z.infer<typeof TargetFile>;
