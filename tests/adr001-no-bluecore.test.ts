// ADR-001: "Nothing entity-specific may be hardcoded in application or
// ingestion code." The concrete, checkable version of that claim: no
// engine source file may reference "bluecore" (case-insensitive) — every
// entity name belongs in config, never in code.
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, "..", "src");

describe("ADR-001 — engine code is entity-agnostic", () => {
  it('no file under src/ mentions "bluecore" (case-insensitive)', async () => {
    const offenders: string[] = [];
    for await (const path of glob([join(srcDir, "**", "*.ts"), join(srcDir, "**", "*.tsx")])) {
      const content = await readFile(path, "utf-8");
      if (/bluecore/i.test(content)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});
