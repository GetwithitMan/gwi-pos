/**
 * Version Contract — expected schema/seed/provisioner versions.
 *
 * Generated at build time by scripts/generate-version-contract.mjs.
 * Used by bootstrap, readiness checks, and heartbeat reporting.
 */

import contract from '@/generated/version-contract.json'

export const EXPECTED_SCHEMA_VERSION = contract.schemaVersion
export const EXPECTED_SEED_VERSION = contract.seedVersion
export const PROVISIONER_VERSION = contract.provisionerVersion
export const APP_VERSION = process.env.npm_package_version || '0.0.0'
