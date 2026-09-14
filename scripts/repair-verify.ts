#!/usr/bin/env tsx
// npm run repair:verify -- --env <id> <targetId> --extractor <key> \
//   (--selector <v> | --json-path <v> | --candidates <file>)
//
// docs/plans/m3-operability.md M3b, automating 06-OPS-RUNBOOK.md §3 step 5
// ("repair"). Runs one or more proposed locators through the same
// extraction/assertion/guard pipeline scripts/repair-diff.ts uses, prints a
// ranked table, and exits non-zero if nothing passes -- the gate a repair
// PR's chosen selector must clear before it's worth blessing.
import { readFile } from "node:fs/promises";
import { scoreCandidates } from "../src/repair/score.js";
import { formatVerifyTable } from "../src/repair/report.js";
import type { LocationPatch, RelocationCandidate } from "../src/repair/relocate.js";
import { loadRepairInputs } from "./lib/repair-inputs.js";

function usage(): never {
  console.error(
    "Usage: npm run repair:verify -- --env <environmentId> <targetId> --extractor <key> " +
      "(--selector <v> | --json-path <v> | --candidates <file>)",
  );
  process.exit(2);
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function getPositional(): string | undefined {
  const args = process.argv.slice(2);
  const flagsWithValue = new Set([
    "--env",
    "--extractor",
    "--selector",
    "--json-path",
    "--candidates",
  ]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (flagsWithValue.has(a)) {
      i++;
      continue;
    }
    if (!a.startsWith("--")) return a;
  }
  return undefined;
}

// The candidates file is a JSON array of either raw patch objects
// (`{"selector": "..."}` / `{"jsonPath": "..."}`, exactly what
// scripts/repair-diff.ts seeds) or plain strings, interpreted against the
// extractor's own kind.
async function loadCandidatesFile(
  path: string,
  kind: "html" | "api",
): Promise<RelocationCandidate[]> {
  const raw = JSON.parse(await readFile(path, "utf-8")) as unknown[];
  return raw.map((entry, i) => {
    const patch: LocationPatch =
      typeof entry === "string"
        ? kind === "html"
          ? { selector: entry }
          : { jsonPath: entry }
        : (entry as LocationPatch);
    return { patch, basis: `from ${path} [${i}]` };
  });
}

async function main() {
  const envId = getArg("--env");
  const targetId = getPositional();
  const extractorKey = getArg("--extractor");
  const selector = getArg("--selector");
  const jsonPath = getArg("--json-path");
  const candidatesFile = getArg("--candidates");

  if (!envId || !targetId || !extractorKey) usage();
  if (!selector && !jsonPath && !candidatesFile) usage();

  const { target, handler, newDoc, previousTargetFile } = await loadRepairInputs({
    envId,
    targetId,
  });

  const extractor = target.extractors.find((e) => e.key === extractorKey);
  if (!extractor) {
    console.error(
      `Extractor "${extractorKey}" not found on target "${targetId}". ` +
        `Known keys: ${target.extractors.map((e) => e.key).join(", ")}`,
    );
    process.exit(2);
  }

  let candidates: RelocationCandidate[];
  if (candidatesFile) {
    candidates = await loadCandidatesFile(candidatesFile, extractor.kind);
  } else if (selector) {
    candidates = [{ patch: { selector }, basis: "manual (--selector)" }];
  } else {
    candidates = [{ patch: { jsonPath: jsonPath! }, basis: "manual (--json-path)" }];
  }

  const previousBlock = previousTargetFile?.blocks.find((b) => b.key === extractorKey) ?? null;

  const scored = await scoreCandidates({
    target,
    extractor,
    handler,
    newDoc,
    candidates,
    previousBlock,
    now: new Date(),
  });

  console.log(formatVerifyTable(scored));

  const passed = scored.some((s) => s.status === "pass");
  if (!passed) {
    console.error(`\nNo candidate passed for "${targetId}.${extractorKey}".`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
