// 04-FRONTEND.md §2: "Entity names, global health pill, last-run timestamp."
import { useState } from "react";
import type { Manifest } from "../../contract/manifest.js";
import type { Health } from "../../contract/health.js";
import { HealthPill } from "./HealthPill.js";
import { HealthModal } from "./HealthModal.js";

export function HeaderBar({ manifest, health }: { manifest: Manifest; health: Health | null }) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 pb-4">
      <div>
        <h1 className="text-xl font-semibold">{manifest.displayName}</h1>
        <p className="text-sm text-neutral-500">
          {manifest.entities.map((e) => e.name).join(", ")}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-neutral-500">
          Last run {new Date(manifest.generatedAt).toLocaleString()}
        </span>
        <HealthPill overall={manifest.health.overall} onClick={() => setModalOpen(true)} />
      </div>
      <HealthModal health={health} open={modalOpen} onOpenChange={setModalOpen} />
    </header>
  );
}
