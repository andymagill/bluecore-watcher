// Vite config for src/app/ (04-FRONTEND.md: React + Vite + Tailwind, static
// SPA). `public/` stays Vite's default publicDir -- ingestion's existing
// public/data/** output ships verbatim into dist/data/** with no custom
// copy step, matching the fetch paths the frontend doc specifies.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: ".",
  build: {
    outDir: "dist",
  },
});
