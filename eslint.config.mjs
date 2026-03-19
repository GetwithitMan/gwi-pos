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
  // ── Tenant-safe DB access enforcement ────────────────────────────────────
  // Ban direct db.order/orderItem/payment/employee/menuItem access in route
  // handlers and most lib files. All access must go through repositories.
  // Approved infrastructure files are excluded.
  {
    files: [
      "src/app/api/**/*.ts",
      "src/lib/**/*.ts",
    ],
    ignores: [
      // Approved infrastructure — direct db access is expected here
      "src/lib/repositories/**",
      "src/lib/order-events/**",
      "src/lib/db.ts",
      "src/lib/db-*.ts",
      "src/lib/order-write-guard.ts",
      "src/lib/sync/**",
      "src/lib/auto-discount-engine.ts",
      "src/lib/domain/order-items/order-totals.ts",
      "src/lib/domain/split-order/discount-distribution.ts",
      "src/lib/domain/order-items/item-operations.ts",
      "src/lib/domain/tab-close/**",
      "src/lib/domain/shift-close/**",
      "src/lib/domain/entertainment/**",
      "src/lib/domain/cleanup/**",
      "src/lib/domain/datacap/**",
      // Approved exceptions — parameter-injected db or system-level routes
      "src/lib/order-claim.ts",
      "src/lib/accounting/daily-journal.ts",
      "src/lib/payroll/payroll-export.ts",
      "src/lib/api-auth.ts",
      "src/lib/query-services/**",
      "src/lib/snapshot.ts",
      "src/lib/socket-dispatch.ts",
      "src/lib/socket-server.ts",
      "src/lib/stock-status.ts",
      "src/lib/walkout-detector.ts",
      "src/app/api/system/batch-status/route.ts",
      "src/app/api/orders/route.ts",
    ],
    rules: {
      // ENFORCED — 383→16 violations burned down. Remaining 16 use eslint-disable.
      "no-restricted-syntax": ["error",
        {
          selector: "MemberExpression[object.name='db'][property.name='order']",
          message: "Direct db.order access is banned. Use OrderRepository from '@/lib/repositories'.",
        },
        {
          selector: "MemberExpression[object.name='db'][property.name='orderItem']",
          message: "Direct db.orderItem access is banned. Use OrderItemRepository from '@/lib/repositories'.",
        },
        {
          selector: "MemberExpression[object.name='db'][property.name='payment']",
          message: "Direct db.payment access is banned. Use PaymentRepository from '@/lib/repositories'.",
        },
        {
          selector: "MemberExpression[object.name='db'][property.name='employee']",
          message: "Direct db.employee access is banned. Use EmployeeRepository from '@/lib/repositories'.",
        },
        {
          selector: "MemberExpression[object.name='db'][property.name='menuItem']",
          message: "Direct db.menuItem access is banned. Use MenuItemRepository from '@/lib/repositories'.",
        },
      ],
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
