/**
 * Typed Runtime Configuration
 *
 * Parse and validate environment variables at module load.
 * All other files import from here instead of reading process.env directly.
 *
 * Hard boot failure in production if required keys are missing.
 * Dev fallbacks where safe (ephemeral signing key with loud warning).
 */

import { randomBytes } from 'node:crypto'
import { parseNodeEnv, parseBool, parseStationRole, parsePort } from './env-parse'
import type { NodeEnv, StationRole } from './env-parse'

// Re-export types so existing imports keep working
export type { NodeEnv, StationRole }

// ── Types ────────────────────────────────────────────────────────────────────

export interface SystemConfig {
  readonly nodeEnv: NodeEnv
  readonly isProduction: boolean
  readonly syncEnabled: boolean
  readonly posLocationId: string | undefined
  readonly stationRole: StationRole
  readonly tenantJwtEnabled: boolean
  readonly tenantSigningKey: string
  readonly neonDatabaseUrl: string | undefined
  readonly provisionApiKey: string
  readonly port: number
}

// ── Build config ─────────────────────────────────────────────────────────────

function buildConfig(): SystemConfig {
  const nodeEnv = parseNodeEnv(process.env.NODE_ENV)
  const isProduction = nodeEnv === 'production'
  const isStaging = parseBool(process.env.STAGING, false)
  const requireProdKeys = isProduction || isStaging

  // Tenant signing key — required in prod/staging
  let tenantSigningKey = process.env.TENANT_SIGNING_KEY || ''
  if (!tenantSigningKey) {
    if (requireProdKeys) {
      throw new Error(
        '[config] TENANT_SIGNING_KEY is required in production/staging. ' +
        'Generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
      )
    }
    // Dev fallback: ephemeral key
    tenantSigningKey = randomBytes(32).toString('hex')
    console.warn('[config] Using ephemeral tenant signing key — set TENANT_SIGNING_KEY in .env for persistence')
  }

  // Provision API key — required in prod (non-NUC)
  const provisionApiKey = process.env.PROVISION_API_KEY || ''
  // Note: proxy.ts already throws at boot if missing in prod non-NUC.
  // We don't duplicate that check here — just provide the value.

  return Object.freeze({
    nodeEnv,
    isProduction,
    syncEnabled: parseBool(process.env.SYNC_ENABLED, false),
    posLocationId: process.env.POS_LOCATION_ID || undefined,
    stationRole: parseStationRole(process.env.STATION_ROLE),
    tenantJwtEnabled: parseBool(process.env.TENANT_JWT_ENABLED, false),
    tenantSigningKey,
    neonDatabaseUrl: process.env.NEON_DATABASE_URL || undefined,
    provisionApiKey,
    port: parsePort(process.env.PORT, 3005),
  })
}

// ── Export ────────────────────────────────────────────────────────────────────

export const config: SystemConfig = buildConfig()
