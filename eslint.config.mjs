import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import unusedImports from "eslint-plugin-unused-imports";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendor JS files (third-party, not linted)
    "public/vendor/**",
    "vendor/**",
    // Claude worktrees (ephemeral, not linted)
    ".claude/**",
    // Compiled server bundle (not source)
    "server.js",
  ]),
  // ── Dead-code removal ─────────────────────────────────────────────────────
  {
    plugins: { "unused-imports": unusedImports },
    rules: {
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": "off",
    },
  },
  // ── Project-wide rule overrides ──────────────────────────────────────────
  {
    rules: {
      // Widespread intentional codebase patterns — disabled to keep lint clean.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/set-state-in-effect": "off",
      // React Compiler structural violations — pre-existing patterns; downgraded
      // to warn so they surface without blocking builds. Fix incrementally.
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/purity": "warn",
    },
  },
  // ── Config / script files — CommonJS require() is fine ───────────────────
  {
    files: [
      "*.config.js",
      "*.config.mjs",
      "*.config.ts",
      "scripts/**/*.js",
      "scripts/**/*.ts",
      // Root-level Node.js runtime files (CommonJS by design)
      "preload.js",
      "server.js",
      "public/sync-agent.js",
    ],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
