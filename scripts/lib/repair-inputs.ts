// Shared loader for scripts/repair-diff.ts and scripts/repair-verify.ts
// (M3b, docs/plans/m3-operability.md). Resolves one target's config entry,
// its freshly-fetched document (a live capture if present, else the
// working-tree fixture), its git-historical fixture (the "old" side of the
// pair -- no fixture pair is kept on disk, per that plan's "Other
// decisions"), and its previously-committed block. The three things every
// repair action needs, loaded the same way regardless of which script
// asked.
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { CmieConfig, type TargetDef } from "../../src/config/index.js";
import type { TargetFile } from "../../src/contract/target-file.js";
import { EXTENSION_BY_KIND } from "../../src/ingest/fetch/fixture-fetcher.js";
import { getHandler } from "../../src/ingest/extract/registry.js";
import { loadPreviousState } from "../../src/ingest/persist.js";
import { gitShowFile, gitShowStateReader, repoRoot } from "./git.js";

export interface RepairInputs {
  config: CmieConfig;
  target: TargetDef;
  handler: ReturnType<typeof getHandler>;
  newBody: string;
  newDoc: unknown;
  newSource: "live" | "fixture";
  /** The fixture's content at `baseline`, or null if it didn't exist there yet. */
  oldBody: string | null;
  oldDoc: unknown | null;
  previousTargetFile: TargetFile | null;
}

export interface LoadRepairInputsParams {
  envId: string;
  targetId: string;
  /** Repo-root-relative directory holding a live capture, per target id. Default ".runs/live". */
  liveDir?: string;
  /** The git commit whose fixture/target-file counts as "old". Default "HEAD". */
  baseline?: string;
}

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function loadConfig(envId: string): Promise<CmieConfig> {
  const mod = await import(pathToFileURL(join(repoRoot, "config", `${envId}.config.ts`)).href);
  return CmieConfig.parse(mod.config ?? mod.default);
}

export function resolveTarget(config: CmieConfig, targetId: string): TargetDef {
  const target = config.targets.find((t) => t.id === targetId);
  if (!target) {
    throw new Error(
      `Target "${targetId}" not found in config/${config.environment.id}.config.ts. ` +
        `Known ids: ${config.targets.map((t) => t.id).join(", ")}`,
    );
  }
  return target;
}

export async function loadRepairInputs(params: LoadRepairInputsParams): Promise<RepairInputs> {
  const { envId, targetId, liveDir = ".runs/live", baseline = "HEAD" } = params;
  const config = await loadConfig(envId);
  const target = resolveTarget(config, targetId);
  const handler = getHandler(target.kind);
  const ext = EXTENSION_BY_KIND[target.kind];
  const fixtureRelPath = `fixtures/${targetId}/response.${ext}`;
  const now = new Date().toISOString();

  // resolve, not join: an absolute liveDir must override repoRoot, not be
  // concatenated onto it (path.join treats a leading drive/slash as just
  // another segment).
  const liveBaseDir = resolve(repoRoot, liveDir);
  const liveBody = await readFileOrNull(join(liveBaseDir, targetId, `response.${ext}`));
  const newSource: "live" | "fixture" = liveBody !== null ? "live" : "fixture";
  const newBody = liveBody ?? (await readFileOrNull(join(repoRoot, fixtureRelPath)));
  if (newBody === null) {
    throw new Error(
      `No new document found for "${targetId}" — checked ${liveDir}/${targetId}/response.${ext} ` +
        `and the working-tree fixture. Run "npm run fixture:capture -- --env ${envId} ${targetId}" first.`,
    );
  }
  const newDoc = await handler.parse({ body: newBody, httpStatus: 200, fetchedAt: now });

  const oldBody = await gitShowFile(baseline, fixtureRelPath);
  const oldDoc =
    oldBody !== null
      ? await handler.parse({ body: oldBody, httpStatus: 200, fetchedAt: now })
      : null;

  const prevState = await loadPreviousState(gitShowStateReader(baseline));
  const previousTargetFile = prevState.targetFiles.get(targetId) ?? null;

  return {
    config,
    target,
    handler,
    newBody,
    newDoc,
    newSource,
    oldBody,
    oldDoc,
    previousTargetFile,
  };
}
