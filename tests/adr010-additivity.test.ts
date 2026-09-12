// ADR-010: a new source kind is a handler module plus a registry entry —
// it must not require editing HtmlHandler, ApiHandler, or the shared
// pipeline. This test proves additivity by registering a third, throwaway
// kind entirely from within the test and running it through the real
// shared pipeline unmodified.
import { describe, expect, it } from "vitest";
import { handlerRegistry } from "../src/ingest/extract/registry.js";
import { extractOne } from "../src/ingest/extract/pipeline.js";
import type { ExtractHandler, LocateResult } from "../src/ingest/extract/types.js";
import { CmieConfig, type TargetDef } from "../src/config/schema.js";

// A minimal third handler, written entirely in the test — stands in for a
// future `pdf` or `xlsx` handler. Its existence and use below touch zero
// lines of html-handler.ts, api-handler.ts, or pipeline.ts.
class StubUpperCaseHandler implements ExtractHandler<string> {
  parse(fetchResult: { body: string }): string {
    return fetchResult.body;
  }
  locate(doc: string): LocateResult {
    return { rawTexts: [doc.toUpperCase()], resolvedAnchors: ["stub://anchor"], matchCount: 1 };
  }
}

describe("ADR-010 — extraction handlers are additive", () => {
  it("registering a new kind requires no change to existing handlers", async () => {
    // Extend the real registry locally — production code (registry.ts)
    // is untouched by this test.
    const extendedRegistry = { ...handlerRegistry, stub: new StubUpperCaseHandler() };
    expect(handlerRegistry).not.toHaveProperty("stub"); // the real module is unaffected

    const cfg = CmieConfig.parse({
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
          kind: "html", // schema validation isn't the point here — see note below
          url: "https://example.test/page",
          schedule: { cron: "0 6 * * *", ttlHours: 72 },
          extractors: [
            {
              key: "ex1",
              label: "Ex 1",
              presenter: "markdown",
              kind: "html",
              selector: "#x",
              type: "string",
            },
          ],
        },
      ],
    });
    const target: TargetDef = { ...cfg.targets[0]!, kind: "stub" as TargetDef["kind"] };

    // The stub handler and the shared pipeline (regex/coerce/format/hash)
    // cooperate exactly like any built-in handler would.
    const candidate = await extractOne(
      extendedRegistry.stub,
      "hello world",
      target.extractors[0]!,
      target,
    );
    expect(candidate.value).toBe("HELLO WORLD");
    expect(candidate.contentHash).toMatch(/^sha256:/);
  });
});
