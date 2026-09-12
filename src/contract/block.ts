// Block envelope — 01-DATA-CONTRACT.md §4 and §4.1.
//
// src/contract must depend on nothing internal (enforced by eslint.config.js)
// — it is the keystone both the ingestion engine and the frontend are
// generated from (01-DATA-CONTRACT.md line 1-5).
import { z } from "zod";

export const BlockStatus = z.enum(["ok", "cached", "flagged", "missing"]);
export type BlockStatus = z.infer<typeof BlockStatus>;

export const BlockType = z.enum([
  "number",
  "currency",
  "percent",
  "date",
  "string",
  "markdown",
  "enum",
]);
export type BlockType = z.infer<typeof BlockType>;

export const Presenter = z.enum(["metric", "markdown", "list", "status"]);
export type Presenter = z.infer<typeof Presenter>;

// ---- Delta union — 01-DATA-CONTRACT.md §4.1 ----
// `kind: "scalar"` for every non-list presenter, `kind: "set"` for `list`.
// A set has no single direction of movement, so ScalarDelta's `direction`
// must never appear on a SetDelta — this union makes that unrepresentable.

export const ScalarDelta = z.object({
  kind: z.literal("scalar"),
  previousValue: z.union([z.number(), z.string()]),
  previousExtractedAt: z.iso.datetime(),
  changedAt: z.iso.datetime(),
  direction: z.enum(["up", "down"]),
  absolute: z.number(),
  percent: z.number(),
});
export type ScalarDelta = z.infer<typeof ScalarDelta>;

export const SetDelta = z.object({
  kind: z.literal("set"),
  added: z.array(z.string()),
  removed: z.array(z.string()),
  count: z.int().nonnegative(),
  previousCount: z.int().nonnegative(),
  changedAt: z.iso.datetime(),
});
export type SetDelta = z.infer<typeof SetDelta>;

export const Delta = z.discriminatedUnion("kind", [ScalarDelta, SetDelta]);
export type Delta = z.infer<typeof Delta>;

// ---- Provenance — scalar and list shapes share a schema with array vs
// scalar fields, discriminated by whether the block is a list block. ----

const ProvenanceBase = z.object({
  sourceUrl: z.url(),
  extractedAt: z.iso.datetime(),
  contentHash: z.string().regex(/^sha256:[0-9a-f]{6,64}(?:…)?$/, {
    message: "contentHash must be of the form sha256:<hex or elided hex>",
  }),
});

export const ScalarProvenance = ProvenanceBase.extend({
  anchor: z.string(),
  rawText: z.string(),
});
export type ScalarProvenance = z.infer<typeof ScalarProvenance>;

export const ListProvenance = ProvenanceBase.extend({
  anchor: z.array(z.string()),
  rawText: z.array(z.string()),
});
export type ListProvenance = z.infer<typeof ListProvenance>;

export const Validation = z.object({
  passed: z.boolean(),
  warnings: z.array(
    z.object({
      guard: z.string(),
      rejectedCandidate: z.union([z.string(), z.number(), z.array(z.string())]),
      retainedValue: z.union([z.string(), z.number(), z.array(z.string())]),
    }),
  ),
});
export type Validation = z.infer<typeof Validation>;

// ---- Block — scalar vs list, discriminated by `presenter`. ----
// `list` carries array value/provenance/delta (§4.1); everything else is
// scalar. `delta` is null only on first extraction (§4); otherwise present
// and carried forward untouched on an unchanged run (ADR-011 restatement).

const BlockCommon = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: BlockType,
  status: BlockStatus,
  unit: z.string().optional(),
  validation: Validation,
});

export const ScalarBlock = BlockCommon.extend({
  presenter: z.enum(["metric", "markdown", "status"]),
  value: z.union([z.number(), z.string()]).nullable(),
  displayValue: z.string().nullable(),
  // Nullable only for status: "missing" — configured but never successfully
  // extracted, so there is no prior value to serve and nothing to attribute
  // (01-DATA-CONTRACT.md §4 status table). Every other status carries full
  // provenance, per Invariant 2.
  provenance: ScalarProvenance.nullable(),
  delta: ScalarDelta.nullable(),
});
export type ScalarBlock = z.infer<typeof ScalarBlock>;

export const ListBlock = BlockCommon.extend({
  presenter: z.literal("list"),
  value: z.array(z.string()).nullable(),
  displayValue: z.array(z.string()).nullable(),
  provenance: ListProvenance.nullable(), // see ScalarBlock.provenance note
  delta: SetDelta.nullable(),
});
export type ListBlock = z.infer<typeof ListBlock>;

export const Block = z.union([ScalarBlock, ListBlock]);
export type Block = z.infer<typeof Block>;
