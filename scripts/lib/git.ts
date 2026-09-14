// Shared `git show` helpers -- extracted from scripts/alert-dispatch.ts
// (M3a) so scripts/repair-diff.ts and scripts/repair-verify.ts (M3b) can
// read a file's content at a historical commit without a second, parallel
// execFile wrapper. docs/plans/m3-operability.md M3b's "fixture pairs are
// not kept on disk; repair:diff reads the prior fixture with `git show`,
// using git history as the pair."
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { StateReader } from "../../src/ingest/persist.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(__dirname, "..", "..");

// git show's exit code and stderr text are the only signal execFile gives
// us to tell "path doesn't exist at that commit" (expected -- a file added
// or retired between two shas) from a real error (bad sha, corrupt object,
// wrong cwd).
function isMissingPathError(err: unknown): boolean {
  const message = (err as { stderr?: string })?.stderr ?? (err as Error)?.message ?? "";
  return /does not exist|exists on disk, but not in/.test(message);
}

// Reads one repo-root-relative path's content at `sha`, or null if it
// doesn't exist there.
export async function gitShowFile(sha: string, relPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["show", `${sha}:${relPath}`], {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    if (isMissingPathError(err)) return null;
    throw err;
  }
}

// A StateReader (src/ingest/persist.ts) backed by `git show
// <sha>:public/data/<relPath>` -- lets loadPreviousState diff two
// *committed* states without touching the filesystem or requiring either
// sha to be checked out. M3a's own use case (scripts/alert-dispatch.ts).
export function gitShowStateReader(sha: string): StateReader {
  return (relPath) => gitShowFile(sha, `public/data/${relPath}`);
}
