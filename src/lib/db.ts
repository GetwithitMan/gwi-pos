import { PrismaClient } from '@prisma/client'
import { headers } from 'next/headers'
import { getRequestPrisma } from './request-context'

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
// Master database client (gwi_pos — default/fallback)
// ============================================================================

export const masterClient = globalForPrisma.prisma ?? createPrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = masterClient

// ============================================================================
// Multi-tenant venue clients (cached per slug)
// ============================================================================

if (!globalForPrisma.venueClients) {
  globalForPrisma.venueClients = new Map()
}

/**
 * Resolve the active PrismaClient for the current request.
 *
 * Resolution order:
 *   1. AsyncLocalStorage (set by server.ts on the NUC)
 *   2. Next.js headers() — reads x-venue-slug (set by middleware.ts on Vercel)
 *   3. Master client (local dev, or NUC with DATABASE_URL already correct)
 *
 * On the NUC:
 *   server.ts wraps every request in requestStore.run({ slug, prisma })
 *   so Priority 1 fires.  Also DATABASE_URL already points to the venue DB.
 *
 * On Vercel (cloud / subdomains):
 *   No custom server → Priority 1 is undefined → falls through to Priority 2.
 *   middleware.ts sets x-venue-slug → headers().get('x-venue-slug') returns slug.
 */
function resolveClient(): PrismaClient {
  // Priority 1: AsyncLocalStorage (NUC custom server)
  const contextPrisma = getRequestPrisma()
  if (contextPrisma) return contextPrisma

  // Priority 2: Next.js headers() (Vercel serverless)
  // In Next.js 15+, headers() returns a Promise-like object that also
  // supports synchronous property access (backward-compat layer).
  try {
    const headersList = headers()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const slug = (headersList as any).get('x-venue-slug') as string | null
    if (slug) {
      return getDbForVenue(slug)
    }
  } catch {
    // Not in a request context (module init, standalone scripts) — fall through
  }

  // Priority 3: Master client
  return masterClient
}

/**
 * Tenant-aware Prisma client proxy.
 *
 * Every property access on `db` is forwarded to the PrismaClient
 * resolved from the current request context.  This means zero changes
 * needed in any of the 100+ API routes that do:
 *
 *   import { db } from '@/lib/db'
 *   const items = await db.menuItem.findMany(...)
 *
 * Under the hood, the proxy routes to the correct venue database
 * based on the x-venue-slug header set by middleware.ts.
 */
export const db: PrismaClient = new Proxy(masterClient, {
  get(_target, prop, receiver) {
    const client = resolveClient()
    const value = Reflect.get(client, prop, receiver)
    // Bind methods to the correct client instance
    if (typeof value === 'function') {
      return value.bind(client)
    }
    return value
  },
})

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

export default db
