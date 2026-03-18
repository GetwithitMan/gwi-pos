/**
 * Venue Client Cache — Multi-tenant PrismaClient pool with LRU eviction.
 *
 * All venue databases share the same Neon project endpoint.
 * Only the database name differs:
 *   Master: postgresql://user:pass@host/gwi_pos?sslmode=require
 *   Venue:  postgresql://user:pass@host/gwi_pos_joes_bar?sslmode=require
 */

import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// Types + globalThis cache
// ---------------------------------------------------------------------------

const globalForPrisma = globalThis as unknown as {
  venueClients: Map<string, { client: PrismaClient; lastAccessed: number }> | undefined
}

if (!globalForPrisma.venueClients) {
  globalForPrisma.venueClients = new Map()
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_VENUE_CLIENTS = 50

/** Idle venue clients are disconnected after 30 minutes of inactivity */
const VENUE_CLIENT_TTL_MS = 30 * 60 * 1000

// ---------------------------------------------------------------------------
// Periodic cleanup: disconnect idle venue clients every 5 minutes
// ---------------------------------------------------------------------------

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
// URL helpers
// ---------------------------------------------------------------------------

/** Convert venue slug to PostgreSQL database name */
export function venueDbName(slug: string): string {
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
export function getDbForVenue(
  slug: string,
  createPrismaClient: (url?: string) => PrismaClient
): PrismaClient {
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

  const venueUrl = buildVenueDatabaseUrl(slug)
  const client = createPrismaClient(venueUrl)
  clients.set(slug, { client, lastAccessed: Date.now() })
  return client
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
