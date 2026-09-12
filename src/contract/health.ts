// health.json — 01-DATA-CONTRACT.md §7. `firstSeenAt`/`consecutiveFailures`
// persist across runs and are computed from the previous *committed* health
// plus the current run artifact (Invariant 8, added under ADR-011) — a run
// whose gate fails must not reset this backlog.
import { z } from "zod";

// Fixed set — 01-DATA-CONTRACT.md §7. Anything unclassifiable is UNKNOWN,
// and an UNKNOWN in production is itself a defect to triage into this list.
export const ErrorClass = z.enum([
  "NETWORK_ERROR",
  "TIMEOUT",
  "HTTP_ERROR",
  "BLOCKED",
  "AUTH_ERROR",
  "SELECTOR_NO_MATCH",
  "SELECTOR_AMBIGUOUS",
  "PARSE_ERROR",
  "ASSERTION_FAILED",
  "CHANGE_GUARD_TRIPPED",
  "SCHEMA_INVALID",
  "UNKNOWN",
]);
export type ErrorClass = z.infer<typeof ErrorClass>;

export const HealthEntry = z.object({
  targetId: z.string().min(1),
  extractorKey: z.string().min(1),
  status: z.enum(["failed", "flagged"]),
  errorClass: ErrorClass,
  message: z.string().min(1),
  failingSelector: z.string().nullable(),
  httpStatus: z.int().nullable(),
  firstSeenAt: z.iso.datetime(),
  consecutiveFailures: z.int().positive(),
  servingCachedFrom: z.iso.datetime().nullable(),
  stack: z.string().nullable(),
});
export type HealthEntry = z.infer<typeof HealthEntry>;

export const Health = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime(),
  runId: z.string().min(1),
  summary: z.object({
    targets: z.int().nonnegative(),
    ok: z.int().nonnegative(),
    degraded: z.int().nonnegative(),
    failed: z.int().nonnegative(),
    oldestDataAgeHours: z.number().nonnegative(),
    targetsPastCeiling: z.int().nonnegative(),
  }),
  entries: z.array(HealthEntry),
});
export type Health = z.infer<typeof Health>;
