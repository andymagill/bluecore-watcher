// Gate check 3 (src/gate/smoke-render.ts) proven against a minimal,
// hand-built static site -- not the real SPA, which doesn't exist until
// Phase 4. This proves the check's own mechanics (manifest/target-file
// reachability, error-boundary marker, block-count comparison, console
// errors) with a real headless-Chromium render against a real local server.
// The full real-SPA + real-Cloudflare-preview version of exit criterion 6
// is exercised again in Phase 6 against the actual built dashboard.
import { describe, expect, it, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { runSmokeRender } from "../src/gate/smoke-render.js";
import { Manifest } from "../src/contract/manifest.js";
import { TargetFile } from "../src/contract/target-file.js";

const RUN_ID = "2026-09-12T00-00-00Z-abc1234";

function makeManifest(): Manifest {
  return Manifest.parse({
    schemaVersion: 1,
    environmentId: "t",
    displayName: "T",
    generatedAt: "2026-09-12T00:00:00Z",
    runId: RUN_ID,
    commit: "abc1234",
    entities: [{ id: "p", name: "P", role: "primary" }],
    sections: [{ id: "target", label: "Target", order: 1 }],
    targets: [
      {
        id: "t1",
        sectionId: "target",
        entityId: "p",
        label: "T1",
        path: "sections/target/t1.json",
        ttlHours: 168,
        lastRunStatus: "ok",
        lastSuccessAt: "2026-09-12T00:00:00Z",
      },
    ],
    health: { overall: "ok", ok: 1, degraded: 0, failed: 0 },
  });
}

function makeTargetFile(blockCount: number): TargetFile {
  return TargetFile.parse({
    schemaVersion: 1,
    targetId: "t1",
    entityId: "p",
    sectionId: "target",
    label: "T1",
    sourceUrl: "https://example.test/page",
    ttlHours: 168,
    run: {
      runId: RUN_ID,
      startedAt: "2026-09-12T00:00:00Z",
      completedAt: "2026-09-12T00:00:00Z",
      durationMs: 100,
      status: "ok",
      renderer: "static",
      httpStatus: 200,
    },
    blocks: Array.from({ length: blockCount }, (_, i) => ({
      key: `block_${i}`,
      label: `Block ${i}`,
      type: "string",
      presenter: "markdown",
      status: "ok",
      value: "hello",
      displayValue: "hello",
      provenance: {
        sourceUrl: "https://example.test/page",
        anchor: "p",
        extractedAt: "2026-09-12T00:00:00Z",
        rawText: "hello",
        contentHash: "sha256:aabbcc",
      },
      delta: null,
      validation: { passed: true, warnings: [] },
    })),
  });
}

interface Site {
  html: string;
  manifest: Manifest;
  targetFile: TargetFile;
  consoleError?: boolean;
}

async function startSite(site: Site): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/" || path === "/index.html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(site.html);
    } else if (path === "/data/manifest.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(site.manifest));
    } else if (path === "/data/sections/target/t1.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(site.targetFile));
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server };
}

function pageWithBlocks(
  count: number,
  opts: { errorBoundaryTripped?: boolean; consoleError?: boolean } = {},
): string {
  const blocks = Array.from(
    { length: count },
    (_, i) => `<div data-block-key="t1.block_${i}">hello</div>`,
  ).join("\n");
  const boundaryMarker = opts.errorBoundaryTripped
    ? `<div data-error-boundary-tripped="true"></div>`
    : "";
  const script = opts.consoleError ? `<script>console.error("boom");</script>` : "";
  return `<!doctype html><html><body>${boundaryMarker}${blocks}${script}</body></html>`;
}

let openServer: Server | null = null;
afterEach(() => {
  openServer?.close();
  openServer = null;
});

describe("runSmokeRender", () => {
  it("passes when rendered block count matches published block count", async () => {
    const manifest = makeManifest();
    const targetFile = makeTargetFile(3);
    const { url, server } = await startSite({ html: pageWithBlocks(3), manifest, targetFile });
    openServer = server;

    const result = await runSmokeRender(url, manifest, [targetFile]);
    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("catches a case where data is schema-valid but the rendered block count disagrees with the published count (exit criterion 6)", async () => {
    const manifest = makeManifest();
    const targetFile = makeTargetFile(3); // 3 blocks published
    const { url, server } = await startSite({ html: pageWithBlocks(2), manifest, targetFile }); // only 2 rendered
    openServer = server;

    const result = await runSmokeRender(url, manifest, [targetFile]);
    expect(result.passed).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("rendered block count 2 disagrees with published block count 3"),
      ),
    ).toBe(true);
  });

  it("fails when a target.path 404s", async () => {
    const manifest = makeManifest();
    const targetFile = makeTargetFile(1);
    const { server } = await startSite({ html: pageWithBlocks(1), manifest, targetFile });
    server.close(); // torn down immediately -- replaced by the deliberately-broken server below

    await new Promise<void>((resolve) => {
      const brokenServer = createServer((req, res) => {
        const path = (req.url ?? "/").split("?")[0];
        if (path === "/data/manifest.json") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(manifest));
        } else if (path === "/" || path === "/index.html") {
          res.writeHead(200, { "content-type": "text/html" });
          res.end(pageWithBlocks(1));
        } else {
          res.writeHead(404);
          res.end("gone");
        }
      });
      brokenServer.listen(0, "127.0.0.1", () => {
        openServer = brokenServer;
        resolve();
      });
    });
    const port = (openServer!.address() as AddressInfo).port;

    const result = await runSmokeRender(`http://127.0.0.1:${port}`, manifest, [targetFile]);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("sections/target/t1.json returned 404"))).toBe(
      true,
    );
  });

  it("fails when an ErrorBoundary has tripped", async () => {
    const manifest = makeManifest();
    const targetFile = makeTargetFile(1);
    const { url, server } = await startSite({
      html: pageWithBlocks(1, { errorBoundaryTripped: true }),
      manifest,
      targetFile,
    });
    openServer = server;

    const result = await runSmokeRender(url, manifest, [targetFile]);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("error boundary tripped"))).toBe(true);
  });

  it("fails on a console error", async () => {
    const manifest = makeManifest();
    const targetFile = makeTargetFile(1);
    const { url, server } = await startSite({
      html: pageWithBlocks(1, { consoleError: true }),
      manifest,
      targetFile,
    });
    openServer = server;

    const result = await runSmokeRender(url, manifest, [targetFile]);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("console error"))).toBe(true);
  });
});
