/**
 * Version Contract — expected schema/seed/provisioner versions.
 *
 * Generated at build time by scripts/generate-version-contract.mjs.
 * Used by bootstrap, readiness checks, and heartbeat reporting.
 *
 * Phase 1A additions: schema contract hash, contract version, risk classification.
 */

import contract from '@/generated/version-contract.json'

export const EXPECTED_SCHEMA_VERSION = contract.schemaVersion
export const EXPECTED_SEED_VERSION = contract.seedVersion
export const PROVISIONER_VERSION = contract.provisionerVersion
// Read from package.json at startup — npm_package_version is only set during `npm run` scripts,
// not at runtime when the process is started via PM2/node directly.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _pkg = require('../../package.json') as { version: string }
export const APP_VERSION = _pkg.version

// ── Phase 1A: Schema contract fields ──────────────────────────────────────
// Prefer the live DB-introspected contract hash; fall back to Prisma schema hash
export const SCHEMA_CONTRACT_HASH: string | null =
  (contract as Record<string, unknown>).schemaContractHash as string | null ??
  contract.schemaSha256

export const CONTRACT_VERSION: number =
  ((contract as Record<string, unknown>).contractVersion as number) ?? 1

export const RISK_CLASSIFICATION: string =
  ((contract as Record<string, unknown>).riskClassification as string) ?? 'low'

export const COMPATIBILITY_CLASS: string =
  ((contract as Record<string, unknown>).compatibilityClass as string) ?? 'forward_compatible'

export const PREVIOUS_CONTRACT_HASH: string | null =
  ((contract as Record<string, unknown>).previousContractHash as string | null) ?? null

export const COMPATIBLE_WITH: string[] =
  ((contract as Record<string, unknown>).compatibleWith as string[]) ?? []

export const CONTRACT_SIGNATURE: string | null =
  ((contract as Record<string, unknown>).contractSignature as string | null) ?? null
