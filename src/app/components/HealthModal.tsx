// 04-FRONTEND.md §6: "Reads health.json. Grouped by status, sorted by
// consecutiveFailures descending." Copy is developer-facing in M1 (the
// analyst-friendly rewrite is explicitly M3, "Health modal copy rewritten
// for analysts" -- 07-ROADMAP.md) -- this ships the mechanism, not the copy.
import * as Dialog from "@radix-ui/react-dialog";
import type { Health } from "../../contract/health.js";

export function HealthModal({
  health,
  open,
  onOpenChange,
}: {
  health: Health | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const entries = health
    ? [...health.entries].sort((a, b) => b.consecutiveFailures - a.consecutiveFailures)
    : [];
  const failed = entries.filter((e) => e.status === "failed");
  const flagged = entries.filter((e) => e.status === "flagged");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 max-h-[80vh] w-[90vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded border border-neutral-700 bg-neutral-900 p-5 text-sm">
          <Dialog.Title className="text-lg font-semibold">Health</Dialog.Title>
          <Dialog.Description className="mb-4 text-neutral-500">
            {entries.length === 0
              ? "Everything is healthy."
              : `${failed.length} failed, ${flagged.length} flagged.`}
          </Dialog.Description>

          {entries.length === 0 ? null : (
            <ul className="space-y-3">
              {entries.map((e) => (
                <li
                  key={`${e.targetId}.${e.extractorKey}`}
                  className="rounded border border-neutral-800 p-3"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">
                      {e.targetId}.{e.extractorKey}
                    </span>
                    <span className={e.status === "failed" ? "text-red-400" : "text-yellow-400"}>
                      {e.errorClass}
                    </span>
                  </div>
                  <p className="mt-1 text-neutral-400">{e.message}</p>
                  {e.failingSelector && (
                    <p className="mt-1 font-mono text-xs text-neutral-500">{e.failingSelector}</p>
                  )}
                  <p className="mt-1 text-xs text-neutral-500">
                    First seen {new Date(e.firstSeenAt).toLocaleDateString()} -{" "}
                    {e.consecutiveFailures} consecutive run{e.consecutiveFailures === 1 ? "" : "s"}
                    {e.servingCachedFrom
                      ? ` - serving cached value from ${new Date(e.servingCachedFrom).toLocaleDateString()}`
                      : ""}
                  </p>
                  {e.stack && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-neutral-600">
                        Stack trace
                      </summary>
                      <pre className="mt-1 overflow-x-auto text-xs text-neutral-500">{e.stack}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}

          <Dialog.Close asChild>
            <button
              type="button"
              className="mt-4 rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
            >
              Close
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
