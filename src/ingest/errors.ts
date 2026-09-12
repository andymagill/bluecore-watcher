// Maps every failure in the pipeline to the fixed taxonomy in
// 01-DATA-CONTRACT.md §7. Anything that doesn't fit is UNKNOWN, and an
// UNKNOWN reaching a health.json in production is itself a defect.
import type { ErrorClass } from "../contract/health.js";

export class IngestError extends Error {
  readonly errorClass: ErrorClass;
  readonly failingSelector: string | null;
  readonly httpStatus: number | null;

  constructor(
    errorClass: ErrorClass,
    message: string,
    opts: { failingSelector?: string; httpStatus?: number } = {},
  ) {
    super(message);
    this.name = "IngestError";
    this.errorClass = errorClass;
    this.failingSelector = opts.failingSelector ?? null;
    this.httpStatus = opts.httpStatus ?? null;
  }
}

export function toErrorClass(err: unknown): ErrorClass {
  if (err instanceof IngestError) return err.errorClass;
  return "UNKNOWN";
}
