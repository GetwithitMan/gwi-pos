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

// ── Types ────────────────────────────────────────────────────────────────────

export type NodeEnv = 'development' | 'production' | 'test'
export type StationRole = 'primary' | 'backup' | 'fenced' | undefined

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
  readonly allowSyncAutoRegister: boolean
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

function parseNodeEnv(raw: string | undefined): NodeEnv {
  if (raw === 'production' || raw === 'test') return raw
  return 'development'
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback
  return raw === 'true' || raw === '1'
}

function parseStationRole(raw: string | undefined): StationRole {
  if (raw === 'primary' || raw === 'backup' || raw === 'fenced') return raw
  return undefined
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = parseInt(raw, 10)
  if (isNaN(n) || n < 1 || n > 65535) return fallback
  return n
}

// ── Build config ─────────────────────────────────────────────────────────────

function buildConfig(): SystemConfig {
  const nodeEnv = parseNodeEnv(process.env.NODE_ENV)
  const isProduction = nodeEnv === 'production'
  const isStaging = parseBool(process.env.STAGING, false)

  // Tenant signing key — required in prod/staging
  let tenantSigningKey = process.env.TENANT_SIGNING_KEY || ''
  if (!tenantSigningKey) {
    if (isProduction || isStaging) {
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
    allowSyncAutoRegister: parseBool(process.env.ALLOW_SYNC_AUTO_REGISTER, false),
  })
}

// ── Export ────────────────────────────────────────────────────────────────────

export const config: SystemConfig = buildConfig()
