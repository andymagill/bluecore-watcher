// Committed acknowledgements file — 00-DECISIONS.md ADR-012. Releases a
// single change-guard trip for one candidate value without loosening the
// guard's configured tolerance. Consumed (removed) once the candidate
// publishes — see 03-INGESTION.md §1 "validate".
import { z } from "zod";

export const Acknowledgement = z.object({
  targetId: z.string().min(1),
  extractorKey: z.string().min(1),
  contentHash: z.string().min(1), // must match the quarantined candidate's contentHash
  reason: z.string().min(1),
  acknowledgedBy: z.string().min(1),
  acknowledgedAt: z.iso.datetime(),
});
export type Acknowledgement = z.infer<typeof Acknowledgement>;

export const AcknowledgementsFile = z.object({
  schemaVersion: z.literal(1),
  acknowledgements: z.array(Acknowledgement),
});
export type AcknowledgementsFile = z.infer<typeof AcknowledgementsFile>;
