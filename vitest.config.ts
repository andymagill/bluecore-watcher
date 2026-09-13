// No test-behavior config existed before this — vitest was implicitly
// falling back to vite.config.ts (React + Tailwind plugins, needed for
// tests/app/*.test.tsx's jsdom + JSX). A standalone vitest.config.ts is NOT
// auto-merged with vite.config.ts, so this explicitly re-imports it via
// mergeConfig rather than silently dropping those plugins. The only new
// behavior added on top is pinning TZ=UTC for the test run itself.
//
// The TZ pin is belt-and-braces, not the fix for the coerce.ts timezone bug
// (see src/ingest/extract/coerce.ts and docs/00-DECISIONS.md) — the actual
// fix makes date coercion/formatting independent of the host's timezone.
// This just keeps CI and a non-UTC dev machine agreeing on every OTHER
// timezone-sensitive thing (e.g. `new Date()` in a test's own assertions)
// so a local `npm test` run matches CI without each test having to pin TZ
// itself.
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.js";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      env: { TZ: "UTC" },
    },
  }),
);
