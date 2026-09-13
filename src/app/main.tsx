import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./components/AppShell.js";
// Self-hosted rather than a Google Fonts <link>: the smoke gate
// (src/gate/smoke-render.ts) waits on networkidle and fails on any
// console error, so a third-party font request is an avoidable extra
// failure mode. Cloudflare Static Assets serves these same-origin.
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
