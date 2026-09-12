// 03-INGESTION.md §3 check 3 -- the smoke render. The only check that needs
// an actual deployed preview and a SPA to render against, which is why it
// ships in M1 alongside the first real target rather than with the M0.5
// spine (checks 1-2, schema-validate.ts / contract-assertions.ts).
//
// "Rendered block count" is not pinned down mechanically by any doc -- the
// convention this file relies on: every block-bearing component in the SPA
// (including the zero-state placeholder rendered for a `missing` block)
// carries `data-block-key="<targetId>.<key>"` (see src/app/components).
// Rendered count = number of such nodes; published count = the sum of
// `blocks.length` across the target files actually in the manifest.
import { chromium } from "playwright";
import type { Manifest } from "../contract/manifest.js";
import type { TargetFile } from "../contract/target-file.js";

export interface SmokeRenderResult {
  passed: boolean;
  errors: string[];
}

function publishedBlockCount(targetFiles: readonly TargetFile[]): number {
  return targetFiles.reduce((sum, tf) => sum + tf.blocks.length, 0);
}

export async function runSmokeRender(previewUrl: string, manifest: Manifest, targetFiles: readonly TargetFile[]): Promise<SmokeRenderResult> {
  const errors: string[] = [];
  const base = previewUrl.replace(/\/$/, "");

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err)));

    // "manifest.json returns 200 and validates" -- schema validity itself is
    // check 1's job (already run offline against the same manifest object
    // before this preview existed); here we only confirm the *served* file
    // is reachable and is the same manifest (by runId), not stale/cached.
    const manifestResp = await page.request.get(`${base}/data/manifest.json?r=${manifest.runId}`);
    if (!manifestResp.ok()) {
      errors.push(`manifest.json returned ${manifestResp.status()}`);
    } else {
      const served = await manifestResp.json();
      if (served.runId !== manifest.runId) {
        errors.push(`manifest.json runId mismatch: served "${served.runId}", expected "${manifest.runId}" (stale cache?)`);
      }
    }

    // "Every target.path in the manifest returns 200."
    for (const target of manifest.targets) {
      const resp = await page.request.get(`${base}/data/${target.path}?r=${manifest.runId}`);
      if (!resp.ok()) errors.push(`${target.path} returned ${resp.status()}`);
    }

    // "The dashboard mounts without hitting an error boundary."
    await page.goto(base, { waitUntil: "networkidle" });
    const boundaryTripped = await page.locator('[data-error-boundary-tripped="true"]').count();
    if (boundaryTripped > 0) errors.push(`error boundary tripped (${boundaryTripped} section(s))`);

    // "The count of rendered blocks matches the count of published blocks."
    // This is the check exit criterion 6 is specifically about: it catches
    // schema-valid data that the UI silently drops.
    const renderedCount = await page.locator("[data-block-key]").count();
    const expectedCount = publishedBlockCount(targetFiles);
    if (renderedCount !== expectedCount) {
      errors.push(`rendered block count ${renderedCount} disagrees with published block count ${expectedCount}`);
    }

    // "No console errors."
    if (consoleErrors.length > 0) {
      errors.push(`console error(s): ${consoleErrors.slice(0, 5).join(" | ")}`);
    }
  } finally {
    await browser.close();
  }

  return { passed: errors.length === 0, errors };
}
