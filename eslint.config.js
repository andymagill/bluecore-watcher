// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

// Import-direction rules enforcing the contract boundary from a single
// package (docs/00-DECISIONS.md ADR-010 area; see the M0.5 plan's Phase 2).
// A monorepo would get this from package boundaries; here it's linted.
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**", "public/**"],
  },
  {
    files: ["src/contract/**/*.ts"],
    rules: {
      // The contract is the keystone (01-DATA-CONTRACT.md §0): it may depend
      // on nothing internal, so neither side can extend it privately.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/ingest/*", "**/config/*", "**/gate/*", "**/app/*"],
              message:
                "src/contract must not depend on any other module — it is the shared keystone (01-DATA-CONTRACT.md).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/ingest/*", "**/gate/*", "**/alerts/*", "**/repair/*"],
              message:
                "The frontend renders committed data files; it must not import ingestion, gate, alerts, or repair code (04-FRONTEND.md).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/ingest/**/*.ts", "src/gate/**/*.ts", "src/alerts/**/*.ts", "src/repair/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/app/*"],
              message: "Ingestion, the gate, alerts, and repair must not depend on the frontend.",
            },
          ],
        },
      ],
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  // Must stay last: disables ESLint stylistic rules that would otherwise
  // fight Prettier (which owns formatting as of the Prettier ADR).
  eslintConfigPrettier,
);
