// ADR-010: kind -> handler. Adding a kind is one new entry here plus a
// LocationDef union member in src/config/schema.ts — no other file changes.
import type { TargetDef } from "../../config/schema.js";
import { ApiHandler } from "./api-handler.js";
import { HtmlHandler } from "./html-handler.js";
import type { ExtractHandler } from "./types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handlerRegistry: Record<TargetDef["kind"], ExtractHandler<any>> = {
  html: new HtmlHandler(),
  api: new ApiHandler(),
};

export function getHandler(kind: TargetDef["kind"]) {
  const handler = handlerRegistry[kind];
  if (!handler) {
    throw new Error(`No extraction handler registered for kind "${kind}"`);
  }
  return handler;
}
