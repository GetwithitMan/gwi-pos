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

  /**
   * Immutable venue database identifier (UUID).
   *
   * When set, the venue database name becomes `gwi_pos_{venueDbId}` instead of
   * the slug-derived `gwi_pos_{slug}`. This decouples the database identity from
   * the mutable venue slug, preventing rename pain and collision risk at scale.
   *
   * Set via VENUE_DB_ID env var. Null means slug-derived naming (backward compatible).
   *
   * MIGRATION PATH (1,000+ venues):
   *   1. MC generates immutable UUID for each venue at creation time
   *   2. UUID stored as venueDbId in CloudLocation
   *   3. Registration response includes venueDbId
   *   4. Installer writes VENUE_DB_ID to .env
   *   5. DB name becomes gwi_pos_{uuid} instead of gwi_pos_{slug}
   *   6. Existing venues continue using slug-derived names (backward compatible)
   *   7. New venues use UUID-derived names
   */
  readonly venueDbId: string | null
}

// ── Build config ─────────────────────────────────────────────────────────────

function buildConfig(): SystemConfig {
  const nodeEnv = parseNodeEnv(process.env.NODE_ENV)
  const isProduction = nodeEnv === 'production'
  const isStaging = parseBool(process.env.STAGING, false)
  // Skip secret enforcement during Next.js build phase (NEXT_PHASE='phase-production-build').
  // Secrets are only needed at runtime, not during static page collection.
  const isBuildPhase = !!process.env.NEXT_PHASE
  const requireProdKeys = (isProduction || isStaging) && !isBuildPhase

  // Tenant signing key — used by proxy JWT signing when TENANT_JWT_ENABLED=true.
  // In production, this must be explicitly configured to prevent ephemeral trust roots.
  // In dev/test, an ephemeral key is auto-generated for convenience (same-process proxy).
  let tenantSigningKey = process.env.TENANT_SIGNING_KEY || ''
  if (!tenantSigningKey) {
    if (requireProdKeys) {
      throw new Error(
        'FATAL: TENANT_SIGNING_KEY is not configured. ' +
        'In production/staging, this secret must be explicitly set via environment. ' +
        'Auto-generation is disabled to prevent unauthorized trust roots.'
      )
    }
    tenantSigningKey = randomBytes(32).toString('hex')
    log.warn('TENANT_SIGNING_KEY not set — auto-generating ephemeral key for development (will not survive restarts)')
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

  // Venue DB ID — immutable UUID that decouples DB name from slug.
  // Validated as UUID-like (lowercase hex + hyphens, 8-4-4-4-12 format).
  const rawVenueDbId = process.env.VENUE_DB_ID || null
  let venueDbId: string | null = null
  if (rawVenueDbId) {
    const normalized = rawVenueDbId.trim().toLowerCase()
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) {
      venueDbId = normalized
    } else {
      log.error(`VENUE_DB_ID is not a valid UUID: "${rawVenueDbId}" — falling back to slug-derived DB name`)
    }
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
    venueDbId,
  })
}

// ── Export ────────────────────────────────────────────────────────────────────

export const config: SystemConfig = buildConfig()
