// Pure logic behind scripts/resolve-preview-url.ts. The network
// orchestration it wraps (GitHub Check Runs -> Cloudflare version lookup ->
// subdomain) was proven live against the real bluecore-watcher repo/Worker
// during M1 build (2026-09-12) -- see the script's own header comment for
// the recipe. These tests cover the parsing/construction logic in isolation
// rather than mocking three chained network calls.
import { describe, expect, it } from "vitest";
import { buildPreviewUrl, parseVersionId } from "../scripts/resolve-preview-url.js";

describe("parseVersionId", () => {
  it("extracts the Version ID from a real Workers Builds check summary", () => {
    const summary =
      "\nBuild ID: [d3449823-a4ee-4488-82d0-335e802cbddf](https://dash.cloudflare.com/...)\nScript: [bluecore-watcher](...)\nVersion ID: 25e0b07c-3a58-4293-ba78-a75e61b9ce86\n";
    expect(parseVersionId(summary)).toBe("25e0b07c-3a58-4293-ba78-a75e61b9ce86");
  });

  it("is case-insensitive on the label", () => {
    expect(parseVersionId("version id: abc-123")).toBe("abc-123");
  });

  it("throws when no Version ID is present", () => {
    expect(() => parseVersionId("Build ID: abc, no version here")).toThrow(
      /Could not find a Version ID/,
    );
  });

  it("throws when the summary is null", () => {
    expect(() => parseVersionId(null)).toThrow(/Could not find a Version ID/);
  });
});

describe("buildPreviewUrl", () => {
  it("matches the real URL confirmed live for this repo's Worker", () => {
    expect(buildPreviewUrl("feature-m1-walking-skeleton", "bluecore-watcher", "andymagill")).toBe(
      "https://feature-m1-walking-skeleton-bluecore-watcher.andymagill.workers.dev",
    );
  });

  it("uses whatever alias/name/subdomain it's given, generically", () => {
    expect(
      buildPreviewUrl("ingest-2026-09-12t18-00-00-000z-abc1234", "my-worker", "my-subdomain"),
    ).toBe("https://ingest-2026-09-12t18-00-00-000z-abc1234-my-worker.my-subdomain.workers.dev");
  });
});
