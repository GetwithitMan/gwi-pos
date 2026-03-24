/**
 * Venue Client Cache — Multi-tenant PrismaClient pool with LRU eviction.
 *
 * All venue databases share the same Neon project endpoint.
 * Only the database name differs:
 *   Master: postgresql://user:pass@host/gwi_pos?sslmode=require
 *   Venue:  postgresql://user:pass@host/gwi_pos_joes_bar?sslmode=require
 *
 * VENUE_DB_ID support (immutable database identifiers):
 *   When VENUE_DB_ID is set (NUC single-venue mode), the DB name becomes
 *   `gwi_pos_{uuid}` instead of `gwi_pos_{slug}`. This decouples the database
 *   identity from the mutable slug, preventing rename pain and collision risk.
 *   On Vercel (multi-tenant), venueDbId is not used — slug-derived names remain
 *   until MC sends venueDbId per-request in a future phase.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { CONNECTION_BUDGET } from './db-connection-budget'

// ---------------------------------------------------------------------------
// Types + globalThis cache
// ---------------------------------------------------------------------------

const globalForPrisma = globalThis as unknown as {
  venueClients: Map<string, { client: PrismaClient; lastAccessed: number }> | undefined
  _venueDbCollisionChecked?: boolean
}

if (!globalForPrisma.venueClients) {
  globalForPrisma.venueClients = new Map()
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// See CONNECTION_BUDGET — env override available, defaults to budgeted max
const MAX_VENUE_CLIENTS = parseInt(process.env.MAX_VENUE_CLIENTS || '', 10) || CONNECTION_BUDGET.VENUE_CACHE_MAX

/** Idle venue clients are disconnected after 30 minutes of inactivity (configurable via env) */
const VENUE_CLIENT_TTL_MS = parseInt(process.env.VENUE_CLIENT_TTL_MS || '', 10) || 30 * 60 * 1000

// ---------------------------------------------------------------------------
// Periodic cleanup: disconnect idle venue clients every 5 minutes
// ---------------------------------------------------------------------------

// NOTE: On Vercel serverless, setInterval does NOT tick reliably between requests.
// TTL-based eviction is effectively dead code on Vercel. The LRU size-based eviction
// (MAX_VENUE_CLIENTS check in getDbForVenue) is the real protection on serverless.
// This interval only works on NUC (long-running process).
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const clients = globalForPrisma.venueClients
    if (!clients) return
    const now = Date.now()
    for (const [slug, entry] of clients) {
      if (now - entry.lastAccessed > VENUE_CLIENT_TTL_MS) {
        entry.client.$disconnect().catch(() => {})
        clients.delete(slug)
      }
    }
  }, 5 * 60 * 1000)
}

// ---------------------------------------------------------------------------
// Immutable venue DB ID support
// ---------------------------------------------------------------------------

/**
 * Read VENUE_DB_ID from env at module load. This is a validated UUID or null.
 * On NUC (single-venue), this overrides slug-based DB naming.
 * On Vercel (multi-tenant), this is null — slug-derived names are used.
 */
function getVenueDbIdFromEnv(): string | null {
  const raw = process.env.VENUE_DB_ID || null
  if (!raw) return null
  const normalized = raw.trim().toLowerCase()
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) {
    return normalized
  }
  return null
}

const ENV_VENUE_DB_ID = getVenueDbIdFromEnv()

// ---------------------------------------------------------------------------
// Slug → Database Name Registry (populated by MC sync)
// ---------------------------------------------------------------------------

/**
 * Runtime registry mapping venue slugs to their actual Neon database names.
 * Populated by MC via POST /api/internal/online-ordering/enabled.
 *
 * This solves the problem where a venue's actual database name doesn't match
 * the slug-derived convention (e.g., venue provisioned before naming convention,
 * or renamed slug). MC is the source of truth for database names.
 *
 * On Vercel serverless: this Map is per-instance and populated on first sync.
 * On NUC: VENUE_DB_ID env var takes precedence (single-venue mode).
 */
const globalForRegistry = globalThis as unknown as {
  venueDbNameRegistry: Map<string, string> | undefined
}
if (!globalForRegistry.venueDbNameRegistry) {
  globalForRegistry.venueDbNameRegistry = new Map()
}

/** Register a slug → databaseName mapping (called by MC sync endpoint) */
export function registerVenueDbName(slug: string, databaseName: string): void {
  globalForRegistry.venueDbNameRegistry!.set(slug, databaseName)
}

/** Get all registered mappings (for debugging) */
export function getVenueDbNameRegistry(): Map<string, string> {
  return globalForRegistry.venueDbNameRegistry!
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/**
 * Convert venue slug to PostgreSQL database name.
 *
 * Resolution order:
 *   1. If VENUE_DB_ID env var is set (NUC single-venue), use `gwi_pos_{uuid_underscored}`
 *   2. If slug is in the MC-synced registry, use the registered databaseName
 *   3. Otherwise, fall back to slug-derived: `gwi_pos_{slug_underscored}`
 *
 * The venueDbId uses underscores in place of hyphens because PostgreSQL identifiers
 * with hyphens require quoting. The UUID format (8-4-4-4-12 hex) is safe after
 * hyphen-to-underscore conversion.
 */
export function venueDbName(slug: string): string {
  // VENUE_DB_ID takes precedence (NUC mode: single immutable DB identifier)
  if (ENV_VENUE_DB_ID) {
    return `gwi_pos_${ENV_VENUE_DB_ID.replace(/-/g, '_')}`
  }
  // Check MC-synced registry for explicit database name
  const registered = globalForRegistry.venueDbNameRegistry!.get(slug)
  if (registered) {
    return registered
  }
  // Fall back to slug-derived convention
  return `gwi_pos_${slug.replace(/-/g, '_')}`
}

/** Replace the database name in a PostgreSQL connection URL */
function replaceDbNameInUrl(url: string, dbName: string): string {
  // Matches /database_name at end of path (before ? or end of string)
  return url.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`)
}

/**
 * Construct the DATABASE_URL for a venue by replacing the database name
 * in the master URL. Converts slug hyphens to underscores for valid
 * PostgreSQL database names.
 *
 * "joes-bar" → gwi_pos_joes_bar
 */
export function buildVenueDatabaseUrl(slug: string): string {
  const masterUrl = process.env.DATABASE_URL
  if (!masterUrl) throw new Error('DATABASE_URL environment variable is required')
  const dbName = venueDbName(slug)
  return replaceDbNameInUrl(masterUrl, dbName)
}

/**
 * Build the DIRECT_URL (non-pooler) for a venue.
 * Used for schema migrations and provisioning.
 */
export function buildVenueDirectUrl(slug: string): string {
  const directUrl = process.env.DIRECT_URL
  if (!directUrl) throw new Error('DIRECT_URL environment variable is required')
  const dbName = venueDbName(slug)
  return replaceDbNameInUrl(directUrl, dbName)
}

// ---------------------------------------------------------------------------
// Collision detection (one-time check on Vercel multi-tenant)
// ---------------------------------------------------------------------------

/**
 * Check for slug-to-DB-name collisions in the venue client cache.
 *
 * Two different slugs can map to the same DB name after the slug-to-underscore
 * transform (e.g., "joes-bar" and "joes_bar" both become "gwi_pos_joes_bar",
 * though the slug regex rejects underscores so this is currently theoretical).
 *
 * This function checks all slugs in the active client cache. It runs once
 * after the cache grows beyond 1 entry and logs an error for any collisions.
 *
 * On NUC (single-venue), this is a no-op since there's only one slug.
 * On Vercel, this checks accumulated venue connections for collisions.
 */
export function checkSlugCollisions(): { collisions: Array<{ slugA: string; slugB: string; dbName: string }> } {
  const clients = globalForPrisma.venueClients
  if (!clients || clients.size < 2) return { collisions: [] }

  const dbNameToSlug = new Map<string, string>()
  const collisions: Array<{ slugA: string; slugB: string; dbName: string }> = []

  for (const [slug] of clients) {
    const dbName = `gwi_pos_${slug.replace(/-/g, '_')}`
    const existing = dbNameToSlug.get(dbName)
    if (existing && existing !== slug) {
      collisions.push({ slugA: existing, slugB: slug, dbName })
    } else {
      dbNameToSlug.set(dbName, slug)
    }
  }

  if (collisions.length > 0) {
    console.error(
      `[db-venue-cache] COLLISION DETECTED: ${collisions.length} slug pair(s) map to the same database name:`,
      collisions.map(c => `"${c.slugA}" + "${c.slugB}" -> ${c.dbName}`).join('; ')
    )
  }

  return { collisions }
}

// ---------------------------------------------------------------------------
// Venue client lifecycle
// ---------------------------------------------------------------------------

/**
 * Get a PrismaClient for a specific venue database.
 * Clients are cached in globalThis to survive across requests
 * in the same serverless function instance.
 *
 * Requires `createPrismaClient` to be injected to avoid a circular
 * dependency (this module cannot import db.ts).
 *
 * @throws Error if slug is invalid (non-alphanumeric-hyphen)
 */
export async function getDbForVenue(
  slug: string,
  createPrismaClient: (url?: string) => PrismaClient
): Promise<PrismaClient> {
  // Guard: reject anything that isn't a valid slug
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`[db] Invalid venue slug: "${slug}"`)
  }

  const clients = globalForPrisma.venueClients!

  const entry = clients.get(slug)
  if (entry) {
    entry.lastAccessed = Date.now()
    return entry.client
  }

  // Evict least-recently-used client if at capacity
  if (clients.size >= MAX_VENUE_CLIENTS) {
    let oldestSlug: string | null = null
    let oldestTime = Infinity
    for (const [key, val] of clients) {
      if (val.lastAccessed < oldestTime) {
        oldestTime = val.lastAccessed
        oldestSlug = key
      }
    }
    if (oldestSlug) {
      const evicted = clients.get(oldestSlug)
      clients.delete(oldestSlug)
      void evicted?.client.$disconnect().catch(() => {})
    }
  }

  let venueUrl = buildVenueDatabaseUrl(slug)
  let client = createPrismaClient(venueUrl)

  // Connectivity test: verify the venue database exists before caching.
  // Only runs on first connection (not cached hits). If the DB doesn't exist,
  // fall back to MC lookup for the actual database name.
  try {
    await client.$queryRawUnsafe('SELECT 1')
  } catch (connErr: any) {
    // Disconnect the failed client immediately
    void client.$disconnect().catch(() => {})
    const msg = connErr?.message || ''
    const isDbNotFound = msg.includes('does not exist') || msg.includes('FATAL') || msg.includes('3D000')

    if (isDbNotFound) {
      // ── MC Fallback: resolve actual database name from Mission Control ──
      // The slug-derived name didn't match. Ask MC for the real database name.
      // This handles venues provisioned before the naming convention was established.
      const mcDbName = await resolveDbNameFromMC(slug)
      if (mcDbName && mcDbName !== venueDbName(slug)) {
        // Register the mapping so future calls skip the MC lookup
        registerVenueDbName(slug, mcDbName)
        // Rebuild URL with the correct database name
        const masterUrl = process.env.DATABASE_URL
        if (masterUrl) {
          venueUrl = masterUrl.replace(/\/[^/?]+(\?|$)/, `/${mcDbName}$1`)
          client = createPrismaClient(venueUrl)
          try {
            await client.$queryRawUnsafe('SELECT 1')
          } catch (retryErr: any) {
            void client.$disconnect().catch(() => {})
            throw new Error(`Venue database not found for slug "${slug}" (MC resolved: ${mcDbName}): ${retryErr?.message || ''}`)
          }
          // Success with MC-resolved name — fall through to cache below
        } else {
          throw new Error(`Venue database not found for slug "${slug}" and DATABASE_URL not set`)
        }
      } else {
        throw new Error(`Venue database not found for slug "${slug}"`)
      }
    } else {
      throw new Error(`Venue database connection failed for slug "${slug}": ${msg}`)
    }
  }

  clients.set(slug, { client, lastAccessed: Date.now() })

  // Run collision check once after the cache grows beyond 1 entry (multi-tenant only).
  // This is a lightweight in-memory check, not a DB query.
  if (!globalForPrisma._venueDbCollisionChecked && clients.size > 1) {
    globalForPrisma._venueDbCollisionChecked = true
    checkSlugCollisions()
  }

  return client
}

/**
 * Resolve venue database name from Mission Control.
 * Called as a fallback when the slug-derived database name doesn't exist.
 * MC stores the actual database name in CloudLocation.databaseName.
 *
 * Returns the database name or null if MC is unreachable or venue not found.
 * Timeout: 5 seconds (don't block customer requests for too long).
 */
async function resolveDbNameFromMC(slug: string): Promise<string | null> {
  const mcUrl = process.env.MC_BASE_URL || process.env.NEXT_PUBLIC_MC_URL || 'https://gwi-mission-control.vercel.app'
  const apiKey = process.env.PROVISION_API_KEY
  if (!apiKey) return null

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(`${mcUrl}/api/fleet/resolve-venue?slug=${encodeURIComponent(slug)}`, {
      headers: { 'x-api-key': apiKey },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) return null
    const data = await res.json()
    return data.databaseName || null
  } catch {
    // MC unreachable — don't block the request
    return null
  }
}

/**
 * Disconnect and remove a venue client from the cache.
 * Call when a venue is no longer needed (e.g., admin session ends).
 */
export async function disconnectVenue(slug: string): Promise<void> {
  const clients = globalForPrisma.venueClients!
  const entry = clients.get(slug)
  if (entry) {
    await entry.client.$disconnect()
    clients.delete(slug)
  }
}

/**
 * Get the number of cached venue clients (for monitoring).
 */
export function getVenueClientCount(): number {
  return globalForPrisma.venueClients?.size ?? 0
}
