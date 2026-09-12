// 03-INGESTION.md §6 / 06-OPS-RUNBOOK.md §2: secrets scrubbed out of
// anything committed. Covers scrub.ts's pure functions directly, and proves
// end-to-end (through the real orchestrator) that provenance.rawText is
// scrubbed before a target file is persisted -- not just health messages.
import { afterEach, describe, expect, it } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { CmieConfig } from "../src/config/schema.js";
import type { ScalarBlock, ListBlock } from "../src/contract/block.js";
import {
  collectActiveSecretValues,
  scrubBlockProvenance,
  scrubSecrets,
} from "../src/ingest/scrub.js";
import { runIngestion } from "../src/ingest/orchestrate.js";
import type { Fetcher } from "../src/ingest/fetch/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("scrubSecrets", () => {
  it("redacts every occurrence of a secret value", () => {
    expect(scrubSecrets("token=abc123 abc123", ["abc123"])).toBe("token=[REDACTED] [REDACTED]");
  });

  it("is a no-op with no secret values", () => {
    expect(scrubSecrets("hello world", [])).toBe("hello world");
  });

  it("skips empty/falsy secret values rather than redacting everything", () => {
    expect(scrubSecrets("hello world", ["", undefined as unknown as string])).toBe("hello world");
  });
});

describe("collectActiveSecretValues", () => {
  const ENV_NAME = "TEST_SCRUB_COLLECT_SECRET";

  afterEach(() => {
    delete process.env[ENV_NAME];
  });

  it("collects the live env value for each target's auth.secretEnv", () => {
    process.env[ENV_NAME] = "live-secret-value";
    const config = CmieConfig.parse({
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
          auth: { type: "header", name: "X-Test", secretEnv: ENV_NAME },
          schedule: { cron: "0 6 * * *", ttlHours: 72 },
          extractors: [
            {
              key: "k",
              label: "K",
              presenter: "markdown",
              kind: "html",
              selector: "p",
              type: "markdown",
            },
          ],
        },
      ],
    });
    expect(collectActiveSecretValues(config)).toEqual(["live-secret-value"]);
  });

  it("omits targets whose secretEnv isn't set in the environment", () => {
    const config = CmieConfig.parse({
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
          schedule: { cron: "0 6 * * *", ttlHours: 72 },
          extractors: [
            {
              key: "k",
              label: "K",
              presenter: "markdown",
              kind: "html",
              selector: "p",
              type: "markdown",
            },
          ],
        },
      ],
    });
    expect(collectActiveSecretValues(config)).toEqual([]);
  });
});

function scalarBlock(overrides: Partial<ScalarBlock> = {}): ScalarBlock {
  return {
    key: "k",
    label: "K",
    type: "string",
    presenter: "markdown",
    status: "ok",
    value: "parsed value",
    displayValue: "parsed value",
    provenance: {
      sourceUrl: "https://example.test/page",
      anchor: "p",
      extractedAt: "2026-09-12T00:00:00.000Z",
      rawText: "prefix secret-abc123 suffix",
      contentHash: "sha256:aaaa",
    },
    delta: null,
    validation: { passed: true, warnings: [] },
    ...overrides,
  };
}

describe("scrubBlockProvenance", () => {
  it("redacts a secret out of a scalar block's rawText, leaving contentHash untouched", () => {
    const block = scalarBlock();
    const scrubbed = scrubBlockProvenance(block, ["secret-abc123"]);
    expect(scrubbed.provenance?.rawText).toBe("prefix [REDACTED] suffix");
    expect(scrubbed.provenance?.contentHash).toBe("sha256:aaaa");
    expect(scrubbed.value).toBe("parsed value"); // fixture's value doesn't contain the secret
  });

  it("also redacts a secret that made it into value/displayValue (string/markdown/enum's identity coercion)", () => {
    const block = scalarBlock({
      value: "prefix secret-abc123 suffix",
      displayValue: "prefix secret-abc123 suffix",
    });
    const scrubbed = scrubBlockProvenance(block, ["secret-abc123"]);
    expect(scrubbed.value).toBe("prefix [REDACTED] suffix");
    expect(scrubbed.displayValue).toBe("prefix [REDACTED] suffix");
  });

  it("leaves a numeric value untouched (never scrubbed as a string)", () => {
    const block = scalarBlock({ value: 48200, displayValue: "48,200 TEU" });
    const scrubbed = scrubBlockProvenance(block, ["secret-abc123"]);
    expect(scrubbed.value).toBe(48200);
  });

  it("redacts a secret out of every element of a list block's rawText array", () => {
    const block: ListBlock = {
      key: "k",
      label: "K",
      type: "string",
      presenter: "list",
      status: "ok",
      value: ["A", "B"],
      displayValue: ["A", "B"],
      provenance: {
        sourceUrl: "https://example.test/page",
        anchor: [".a", ".b"],
        extractedAt: "2026-09-12T00:00:00.000Z",
        rawText: ["has secret-xyz here", "clean"],
        contentHash: "sha256:bbbb",
      },
      delta: null,
      validation: { passed: true, warnings: [] },
    };
    const scrubbed = scrubBlockProvenance(block, ["secret-xyz"]);
    expect(scrubbed.provenance?.rawText).toEqual(["has [REDACTED] here", "clean"]);
  });

  it("passes a block with null provenance through unchanged", () => {
    const block = scalarBlock({ status: "missing", provenance: null, value: null });
    expect(scrubBlockProvenance(block, ["secret-abc123"])).toBe(block);
  });

  it("is a no-op when no secret values are active", () => {
    const block = scalarBlock();
    expect(scrubBlockProvenance(block, []).provenance?.rawText).toBe(block.provenance?.rawText);
  });
});

describe("scrubbing end-to-end through the orchestrator", () => {
  const ENV_NAME = "TEST_SCRUB_E2E_SECRET";
  const SECRET_VALUE = "sk-live-9f8e7d6c5b4a";

  afterEach(() => {
    delete process.env[ENV_NAME];
  });

  it("a secret echoed into extracted rawText never reaches the returned target file", async () => {
    process.env[ENV_NAME] = SECRET_VALUE;

    const config = CmieConfig.parse({
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
          auth: { type: "header", name: "X-Test", secretEnv: ENV_NAME },
          schedule: { cron: "0 6 * * *", ttlHours: 72 },
          extractors: [
            {
              key: "summary",
              label: "Summary",
              presenter: "markdown",
              kind: "html",
              selector: "p",
              type: "markdown",
              assert: { notEmpty: true },
            },
          ],
        },
      ],
    });

    // The fetched body echoes the "secret" back verbatim (e.g. a debug
    // response or an error page reflecting a request header) -- exactly the
    // scenario the doc comments describe.
    const fetcher: Fetcher = {
      fetch: async () => ({
        body: `<p>status: ${SECRET_VALUE} ok</p>`,
        httpStatus: 200,
        fetchedAt: "2026-09-12T00:00:00.000Z",
      }),
    };

    const dataDir = await mkdtemp(join(tmpdir(), "cmie-scrub-"));
    try {
      const result = await runIngestion({
        config,
        dataDir,
        fixturesDir: join(__dirname, "..", "fixtures"),
        acknowledgementsPath: join(dataDir, "acknowledgements.json"),
        runId: "test-scrub-run",
        now: () => new Date("2026-09-12T06:00:00Z"),
        fetcher,
      });

      const block = result.targetFiles[0]!.blocks[0]! as ScalarBlock;
      expect(block.status).toBe("ok");
      expect(block.provenance?.rawText).not.toContain(SECRET_VALUE);
      expect(block.provenance?.rawText).toContain("[REDACTED]");
      // markdown's identity coercion means value/displayValue carry the same
      // text as rawText -- both must be scrubbed too, or the secret survives
      // in the same committed file it was just redacted from.
      expect(block.value).not.toContain(SECRET_VALUE);
      expect(block.displayValue).not.toContain(SECRET_VALUE);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
