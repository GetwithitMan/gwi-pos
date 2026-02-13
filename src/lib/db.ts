import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  venueClients: Map<string, PrismaClient> | undefined
}

function createPrismaClient(url?: string) {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    ...(url ? { datasources: { db: { url } } } : {}),
  })
}

// ============================================================================
// Master database client (gwi_pos — demo/admin data)
// ============================================================================

export const db = globalForPrisma.prisma ?? createPrismaClient()

// ============================================================================
// Multi-tenant venue clients
// ============================================================================

if (!globalForPrisma.venueClients) {
  globalForPrisma.venueClients = new Map()
}

/**
 * Get a PrismaClient for a specific venue database.
 * Clients are cached in globalThis to survive across requests
 * in the same serverless function instance.
 *
 * All venue databases share the same Neon project endpoint.
 * Only the database name differs:
 *   Master: postgresql://user:pass@host/gwi_pos?sslmode=require
 *   Venue:  postgresql://user:pass@host/gwi_pos_joes_bar?sslmode=require
 *
 * @throws Error if slug is invalid (non-alphanumeric-hyphen)
 */
export function getDbForVenue(slug: string): PrismaClient {
  // Guard: reject anything that isn't a valid slug
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`[db] Invalid venue slug: "${slug}"`)
  }

  const clients = globalForPrisma.venueClients!

  let client = clients.get(slug)
  if (client) return client

  const venueUrl = buildVenueDatabaseUrl(slug)
  client = createPrismaClient(venueUrl)
  clients.set(slug, client)
  return client
}

/**
 * Construct the DATABASE_URL for a venue by replacing the database name
 * in the master URL. Converts slug hyphens to underscores for valid
 * PostgreSQL database names.
 *
 * "joes-bar" → gwi_pos_joes_bar
 */
export function buildVenueDatabaseUrl(slug: string): string {
  const masterUrl = process.env.DATABASE_URL!
  const dbName = venueDbName(slug)
  return replaceDbNameInUrl(masterUrl, dbName)
}

/**
 * Build the DIRECT_URL (non-pooler) for a venue.
 * Used for schema migrations and provisioning.
 */
export function buildVenueDirectUrl(slug: string): string {
  const directUrl = process.env.DIRECT_URL!
  const dbName = venueDbName(slug)
  return replaceDbNameInUrl(directUrl, dbName)
}

/** Convert venue slug to PostgreSQL database name */
export function venueDbName(slug: string): string {
  return `gwi_pos_${slug.replace(/-/g, '_')}`
}

/** Replace the database name in a PostgreSQL connection URL */
function replaceDbNameInUrl(url: string, dbName: string): string {
  // Matches /database_name at end of path (before ? or end of string)
  return url.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`)
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

export default db
