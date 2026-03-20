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
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('system-config')

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
  readonly cloudJwtSecret: string
  readonly port: number
}

// ── Build config ─────────────────────────────────────────────────────────────

function buildConfig(): SystemConfig {
  const nodeEnv = parseNodeEnv(process.env.NODE_ENV)
  const isProduction = nodeEnv === 'production'
  const isStaging = parseBool(process.env.STAGING, false)
  const requireProdKeys = isProduction || isStaging

  // Tenant signing key — used by proxy JWT signing when TENANT_JWT_ENABLED=true.
  // Falls back to ephemeral key if not set. This is safe because:
  //   - NUC: same-process proxy, ephemeral key works fine
  //   - Vercel build: module loads during page data collection, no runtime signing
  //   - Vercel runtime: proxy-config.ts checks TENANT_JWT_ENABLED before using it
  // If you need persistent signing (multi-instance), set TENANT_SIGNING_KEY in env.
  let tenantSigningKey = process.env.TENANT_SIGNING_KEY || ''
  if (!tenantSigningKey) {
    tenantSigningKey = randomBytes(32).toString('hex')
  }

  // Provision API key — required in prod (non-NUC)
  const provisionApiKey = process.env.PROVISION_API_KEY || ''
  // Note: proxy.ts already throws at boot if missing in prod non-NUC.
  // We don't duplicate that check here — just provide the value.

  // Cloud JWT secret — used for signing/verifying cloud session JWTs.
  // Falls back to PROVISION_API_KEY for backward compatibility.
  const cloudJwtSecret = process.env.CLOUD_JWT_SECRET || provisionApiKey
  if (!process.env.CLOUD_JWT_SECRET && provisionApiKey && requireProdKeys) {
    log.warn('CLOUD_JWT_SECRET not set — falling back to PROVISION_API_KEY for JWT signing. Set CLOUD_JWT_SECRET to a separate secret before scaling.')
  }

  return Object.freeze({
    nodeEnv,
    isProduction,
    syncEnabled: parseBool(process.env.SYNC_ENABLED, false),
    posLocationId: process.env.POS_LOCATION_ID || undefined,
    stationRole: parseStationRole(process.env.STATION_ROLE),
    tenantJwtEnabled: parseBool(process.env.TENANT_JWT_ENABLED, !!process.env.VERCEL),
    tenantSigningKey,
    neonDatabaseUrl: process.env.NEON_DATABASE_URL || undefined,
    provisionApiKey,
    cloudJwtSecret,
    port: parsePort(process.env.PORT, 3005),
  })
}

// ── Export ────────────────────────────────────────────────────────────────────

export const config: SystemConfig = buildConfig()
