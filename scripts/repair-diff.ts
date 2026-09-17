#!/usr/bin/env tsx
// npm run repair:diff -- --env <id> <targetId> [--live-dir .runs/live] [--baseline HEAD]
//
// docs/plans/m3-operability.md M3b, automating 06-OPS-RUNBOOK.md §3 steps
// 3-4 ("capture a fresh fixture" / "diff old fixture against new"). Diffs
// the git-historical fixture (read via `git show`, not a second file kept
// on disk -- see scripts/lib/git.ts) against a freshly captured one, per
// extractor: whether it still extracts, and src/repair/relocate.ts's
// candidates, scored by src/repair/score.ts exactly as a live run's
// validation would. Writes .runs/repair/<targetId>/context.md (for a human
// or an agent to read) and one candidates.<extractorKey>.json seed file per
// extractor (consumable directly by `npm run repair:verify -- --candidates`).
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { extractOne } from "../src/ingest/extract/pipeline.js";
import { extractorLocatorOf } from "../src/ingest/extract/locator.js";
import { IngestError } from "../src/ingest/errors.js";
import { htmlSkeleton, xmlSkeleton, jsonShape, setDiff } from "../src/drift/structure.js";
import { relocate, type RelocationCandidate } from "../src/repair/relocate.js";
import { scoreCandidates } from "../src/repair/score.js";
import { formatContextMarkdown, type ExtractorDiffEntry } from "../src/repair/report.js";
import { repoRoot } from "./lib/git.js";
import { loadRepairInputs } from "./lib/repair-inputs.js";

function usage(): never {
  console.error(
    "Usage: npm run repair:diff -- --env <environmentId> <targetId> " +
      "[--live-dir .runs/live] [--baseline HEAD]",
  );
  process.exit(2);
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function getPositional(): string | undefined {
  const args = process.argv.slice(2);
  const flags = new Set(["--env", "--live-dir", "--baseline"]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (flags.has(a)) {
      i++;
      continue;
    }
    if (!a.startsWith("--")) return a;
  }
  return undefined;
}

async function main() {
  const envId = getArg("--env");
  const targetId = getPositional();
  if (!envId || !targetId) usage();

  const liveDir = getArg("--live-dir") ?? ".runs/live";
  const baseline = getArg("--baseline") ?? "HEAD";

  const { target, handler, newBody, newDoc, newSource, oldBody, oldDoc, previousTargetFile } =
    await loadRepairInputs({ envId, targetId, liveDir, baseline });

  console.log(
    `New document: ${newSource === "live" ? `${liveDir}/${targetId}/` : "working-tree fixture"} (${newBody.length} bytes)`,
  );

  if (oldBody === null) {
    console.log(`No fixture for "${targetId}" at ${baseline} — nothing to diff structurally.`);
  } else if (oldBody === newBody) {
    console.log(`Warning: the old and new documents are byte-identical — nothing changed.`);
  }

  let structureAdded: string[] = [];
  let structureRemoved: string[] = [];
  if (oldBody !== null) {
    const oldShape =
      target.kind === "html" || target.kind === "xml"
        ? target.kind === "html"
          ? htmlSkeleton(oldBody)
          : xmlSkeleton(oldBody)
        : jsonShape(JSON.parse(oldBody));
    const newShape =
      target.kind === "html" || target.kind === "xml"
        ? target.kind === "html"
          ? htmlSkeleton(newBody)
          : xmlSkeleton(newBody)
        : jsonShape(JSON.parse(newBody));
    const diff = setDiff(oldShape, newShape);
    structureAdded = diff.added;
    structureRemoved = diff.removed;
  }

  const now = new Date();
  const outDir = join(repoRoot, ".runs", "repair", targetId);
  await mkdir(outDir, { recursive: true });

  const entries: ExtractorDiffEntry[] = [];

  for (const extractor of target.extractors) {
    const previousBlock = previousTargetFile?.blocks.find((b) => b.key === extractor.key) ?? null;
    const oldLocator = extractorLocatorOf(extractor);

    let stillExtracts = true;
    let errorDetail: string | null = null;
    try {
      await extractOne(handler, newDoc, extractor, target);
    } catch (err) {
      stillExtracts = false;
      errorDetail = err instanceof IngestError ? `${err.errorClass}: ${err.message}` : String(err);
    }

    // Old evidence: the previously committed block's provenance if we have
    // it, else re-extract from the git-historical fixture directly.
    let oldRawText: string | string[] | null = previousBlock?.provenance?.rawText ?? null;
    if (oldRawText === null && oldDoc !== null) {
      try {
        const oldCandidate = await extractOne(handler, oldDoc, extractor, target);
        oldRawText = oldCandidate.rawText;
      } catch {
        // The old fixture doesn't extract cleanly either -- no evidence to relocate from.
      }
    }

    const candidates: RelocationCandidate[] =
      !stillExtracts && oldRawText !== null ? relocate(extractor, newDoc, oldRawText) : [];

    const scored = await scoreCandidates({
      target,
      extractor,
      handler,
      newDoc,
      candidates,
      previousBlock,
      now,
    });

    await writeFile(
      join(outDir, `candidates.${extractor.key}.json`),
      JSON.stringify(
        candidates.map((c) => c.patch),
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    entries.push({
      key: extractor.key,
      label: extractor.label,
      oldLocator,
      previousValue: (previousBlock?.value as string | number | readonly string[] | null) ?? null,
      stillExtracts,
      errorDetail,
      candidates: scored,
    });

    console.log(
      `${extractor.key}: ${stillExtracts ? "still extracts" : `broken (${errorDetail})`}` +
        (candidates.length > 0 ? ` — ${candidates.length} relocation candidate(s)` : ""),
    );
  }

  const contextMd = formatContextMarkdown({
    targetId,
    structureAdded,
    structureRemoved,
    extractors: entries,
  });
  const contextPath = join(outDir, "context.md");
  await writeFile(contextPath, contextMd, "utf-8");
  console.log(`Wrote ${contextPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
