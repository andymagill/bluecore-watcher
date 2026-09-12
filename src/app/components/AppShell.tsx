// 04-FRONTEND.md §1/§2: "Loads data, holds state, renders header + grid."
// No state library -- useState in the app shell, passed down (the data is
// read-only and loaded once).
import { useEffect, useState } from "react";
import { loadDashboardData, type LoadedData } from "../lib/load-data.js";
import { HeaderBar } from "./HeaderBar.js";
import { SectionGrid } from "./SectionGrid.js";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: LoadedData };

export function AppShell() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadDashboardData()
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <p className="text-neutral-500">Loading...</p>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <p className="text-red-400">Failed to load dashboard data: {state.message}</p>
      </main>
    );
  }

  const { manifest, health, targetFiles } = state.data;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <HeaderBar manifest={manifest} health={health} />
      <SectionGrid manifest={manifest} targetFiles={targetFiles} />
    </main>
  );
}
