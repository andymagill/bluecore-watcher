// M3c — failingSince on the whole-target fetch-failure path in
// orchestrate.ts's runOneTarget, distinct from the per-extractor path
// covered by tests/process-extractor.test.ts. A network-level failure (the
// page itself is unreachable, not just one selector) marks every extractor
// "cached" via a different code path that duplicates cachedBlock's
// failingSince logic -- this proves that duplication stays correct.
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { CmieConfig, type TargetDef } from "../src/config/schema.js";
import { runAndPersist } from "../src/ingest/orchestrate.js";
import { IngestError } from "../src/ingest/errors.js";
import type { Fetcher, FetchResult, RunContext } from "../src/ingest/fetch/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(__dirname, "..", "schemas");

function singleTargetConfig() {
  return CmieConfig.parse({
    schemaVersion: 1,
    environment: {
      id: "t",
      displayName: "T",
      entities: [{ id: "p", name: "P", role: "primary" }],
    },
    sections: [{ id: "s", label: "S", order: 1 }],
    targets: [
      {
        id: "target-1",
        label: "Target 1",
        entityId: "p",
        sectionId: "s",
        kind: "html",
        url: "https://example.test/page",
        // Long TTL -- the exact shape where the ttl-based ceiling alone
        // would take far too long to ever suppress a permanently broken
        // target (the M3c gap); not required so a fetch failure here
        // produces "partial", not "failed_cached" (which would retain the
        // whole prior file, including its blocks, unchanged).
        schedule: { cron: "0 6 * * *", ttlHours: 2160 },
        extractors: [
          {
            key: "ex1",
            label: "Ex 1",
            presenter: "markdown",
            kind: "html",
            selector: "#value",
            type: "string",
            required: false,
          },
        ],
      },
    ],
  });
}

class ToggleFetcher implements Fetcher {
  constructor(
    private readonly bodies: Record<string, string | null>, // null = throw for this runId
  ) {}
  async fetch(_target: TargetDef, ctx: RunContext): Promise<FetchResult> {
    const body = this.bodies[ctx.runId];
    if (body === null || body === undefined) {
      throw new IngestError("NETWORK_ERROR", "connection reset");
    }
    return { body, httpStatus: 200, fetchedAt: ctx.now().toISOString() };
  }
}

describe("runOneTarget's whole-target fetch-failure path -- M3c failingSince", () => {
  it("stamps failingSince on the first fetch failure, carries it forward on the next, and clears it on recovery", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "cmie-fetch-fail-"));
    try {
      const config = singleTargetConfig();
      const fetcher = new ToggleFetcher({
        r1: '<div id="value">hello</div>',
        // r2, r3 absent -> throw
        r4: '<div id="value">hello</div>',
      });
      const baseOpts = {
        config,
        dataDir,
        fixturesDir: join(dataDir, "unused-fixtures"),
        acknowledgementsPath: join(dataDir, "acknowledgements.json"),
        fetcher,
      };

      const r1 = await runAndPersist(
        { ...baseOpts, runId: "r1", now: () => new Date("2026-01-01T00:00:00Z") },
        false,
        schemasDir,
      );
      expect(r1.targetFiles[0]!.blocks[0]!.status).toBe("ok");
      expect(r1.targetFiles[0]!.blocks[0]!.failingSince).toBeNull();

      const r2 = await runAndPersist(
        { ...baseOpts, runId: "r2", now: () => new Date("2026-01-02T00:00:00Z") },
        false,
        schemasDir,
      );
      expect(r2.targetFiles[0]!.run.status).toBe("partial");
      expect(r2.targetFiles[0]!.blocks[0]!.status).toBe("cached");
      expect(r2.targetFiles[0]!.blocks[0]!.failingSince).toBe("2026-01-02T00:00:00.000Z");

      const r3 = await runAndPersist(
        { ...baseOpts, runId: "r3", now: () => new Date("2026-01-20T00:00:00Z") },
        false,
        schemasDir,
      );
      expect(r3.targetFiles[0]!.blocks[0]!.status).toBe("cached");
      // Carried forward from r2, not bumped to r3's time.
      expect(r3.targetFiles[0]!.blocks[0]!.failingSince).toBe("2026-01-02T00:00:00.000Z");

      const r4 = await runAndPersist(
        { ...baseOpts, runId: "r4", now: () => new Date("2026-01-21T00:00:00Z") },
        false,
        schemasDir,
      );
      expect(r4.targetFiles[0]!.blocks[0]!.status).toBe("ok");
      expect(r4.targetFiles[0]!.blocks[0]!.failingSince).toBeNull();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
