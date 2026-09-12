// 04-FRONTEND.md §1: mount -> fetch manifest.json?r=<cachebust> -> fetch
// every sections/<id>/<target>.json in parallel -> fetch health.json ->
// render. "Each section file loads independently. One 404 renders that
// target's zero-state; it does not blank the dashboard" -- a missing/failed
// target file becomes an absent Map entry, not a thrown error.
import { Manifest } from "../../contract/manifest.js";
import { Health } from "../../contract/health.js";
import { TargetFile } from "../../contract/target-file.js";

export interface LoadedData {
  manifest: Manifest;
  health: Health | null;
  targetFiles: Map<string, TargetFile>;
}

async function fetchTargetFile(baseUrl: string, path: string, runId: string, id: string): Promise<readonly [string, TargetFile] | null> {
  try {
    const res = await fetch(`${baseUrl}/data/${path}?r=${runId}`);
    if (!res.ok) return null;
    return [id, TargetFile.parse(await res.json())] as const;
  } catch {
    return null;
  }
}

async function fetchHealth(baseUrl: string, runId: string): Promise<Health | null> {
  try {
    const res = await fetch(`${baseUrl}/data/health.json?r=${runId}`);
    if (!res.ok) return null;
    return Health.parse(await res.json());
  } catch {
    return null;
  }
}

export async function loadDashboardData(baseUrl = ""): Promise<LoadedData> {
  const manifestRes = await fetch(`${baseUrl}/data/manifest.json?r=${Date.now()}`);
  if (!manifestRes.ok) throw new Error(`manifest.json returned ${manifestRes.status}`);
  const manifest = Manifest.parse(await manifestRes.json());

  const [health, targetEntries] = await Promise.all([
    fetchHealth(baseUrl, manifest.runId),
    Promise.all(manifest.targets.map((t) => fetchTargetFile(baseUrl, t.path, manifest.runId, t.id))),
  ]);

  const targetFiles = new Map<string, TargetFile>();
  for (const entry of targetEntries) {
    if (entry) targetFiles.set(entry[0], entry[1]);
  }

  return { manifest, health, targetFiles };
}
