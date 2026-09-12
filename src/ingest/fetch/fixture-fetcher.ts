// Satisfies Fetcher from fixtures/<targetId>/response.<ext> instead of the
// network. This is how the whole engine is exercised offline (03-INGESTION.md
// §5) — the weekly drift check reuses the same fixture directory later.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TargetDef } from "../../config/schema.js";
import { IngestError } from "../errors.js";
import type { Fetcher, FetchResult, RunContext } from "./types.js";

const EXTENSION_BY_KIND: Record<TargetDef["kind"], string> = {
  html: "html",
  api: "json",
};

export class FixtureFetcher implements Fetcher {
  constructor(private readonly fixturesDir: string) {}

  async fetch(target: TargetDef, ctx: RunContext): Promise<FetchResult> {
    const ext = EXTENSION_BY_KIND[target.kind];
    const path = join(this.fixturesDir, target.id, `response.${ext}`);
    let body: string;
    try {
      body = await readFile(path, "utf-8");
    } catch {
      throw new IngestError("NETWORK_ERROR", `No fixture at ${path} for target "${target.id}"`);
    }
    return { body, httpStatus: 200, fetchedAt: ctx.now().toISOString() };
  }
}
