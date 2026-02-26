import { PrismaClient } from '@prisma/client'
import { headers } from 'next/headers'
import { getRequestPrisma } from './request-context'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required')
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  venueClients: Map<string, { client: PrismaClient; lastAccessed: number }> | undefined
}

/**
 * Models that do NOT have a `deletedAt` column — skip soft-delete filtering.
 */
const NO_SOFT_DELETE_MODELS = new Set(['Organization', 'Location', 'SyncAuditEntry', 'HardwareCommand'])

function createPrismaClient(url?: string) {
  const baseUrl = url || process.env.DATABASE_URL || ''
  const pooledUrl = appendPoolParams(baseUrl)

  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    datasources: { db: { url: pooledUrl } },
    transactionOptions: {
      maxWait: 10000,
      timeout: 15000,
    },
  })

  // ---------------------------------------------------------------------------
  // Soft-delete query middleware
  //
  // Automatically adds `deletedAt: null` to all read queries so that
  // soft-deleted rows are excluded by default. This fixes 288+ places in the
  // codebase that would otherwise need manual `deletedAt: null` filters.
  //
  // To query deleted rows intentionally (e.g. admin / audit), explicitly set
  // `deletedAt` to any non-undefined value in the where clause:
  //   db.menuItem.findMany({ where: { deletedAt: { not: null } } })
  //   db.menuItem.findMany({ where: { deletedAt: { gte: someDate } } })
  // ---------------------------------------------------------------------------
  const extended = client.$extends({
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          if (!NO_SOFT_DELETE_MODELS.has(model)) {
            args.where = args.where ?? {}
            if ((args.where as any).deletedAt === undefined) {
              (args.where as any).deletedAt = null
            }
          }
          return query(args)
        },
        async findFirst({ model, args, query }) {
          if (!NO_SOFT_DELETE_MODELS.has(model)) {
            args.where = args.where ?? {}
            if ((args.where as any).deletedAt === undefined) {
              (args.where as any).deletedAt = null
            }
          }
          return query(args)
        },
        async findFirstOrThrow({ model, args, query }) {
          if (!NO_SOFT_DELETE_MODELS.has(model)) {
            args.where = args.where ?? {}
            if ((args.where as any).deletedAt === undefined) {
              (args.where as any).deletedAt = null
            }
          }
          return query(args)
        },
        async findUnique({ model, args, query }) {
          if (!NO_SOFT_DELETE_MODELS.has(model)) {
            args.where = args.where ?? {}
            if ((args.where as any).deletedAt === undefined) {
              (args.where as any).deletedAt = null
            }
          }
          return query(args)
        },
        async findUniqueOrThrow({ model, args, query }) {
          if (!NO_SOFT_DELETE_MODELS.has(model)) {
            args.where = args.where ?? {}
            if ((args.where as any).deletedAt === undefined) {
              (args.where as any).deletedAt = null
            }
          }
          return query(args)
        },
        async count({ model, args, query }) {
          if (!NO_SOFT_DELETE_MODELS.has(model)) {
            args.where = args.where ?? {}
            if ((args.where as any).deletedAt === undefined) {
              (args.where as any).deletedAt = null
            }
          }
          return query(args)
        },
        async aggregate({ model, args, query }) {
          if (!NO_SOFT_DELETE_MODELS.has(model)) {
            args.where = args.where ?? {}
            if ((args.where as any).deletedAt === undefined) {
              (args.where as any).deletedAt = null
            }
          }
          return query(args)
        },
        async groupBy({ model, args, query }) {
          if (!NO_SOFT_DELETE_MODELS.has(model)) {
            args.where = args.where ?? {}
            if ((args.where as any).deletedAt === undefined) {
              (args.where as any).deletedAt = null
            }
          }
          return query(args)
        },
      },
    },
  })

  return extended as unknown as PrismaClient
}

/**
 * Append connection pool parameters to a PostgreSQL URL.
 * - connection_limit: Max connections per client (default 25 — at 5, system saturates at ~7 concurrent requests)
 * - pool_timeout: Seconds to wait for a connection before erroring (default 10)
 */
function appendPoolParams(url: string): string {
  if (!url) return url

  const limit = parseInt(process.env.DB_POOL_SIZE || process.env.DATABASE_CONNECTION_LIMIT || '25', 10)
  const timeout = parseInt(process.env.DATABASE_POOL_TIMEOUT || '10', 10)
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}connection_limit=${limit}&pool_timeout=${timeout}`
}

// ============================================================================
// Master database client (gwi_pos — default/fallback)
// ============================================================================

export const masterClient = globalForPrisma.prisma ?? createPrismaClient()
// Cache in globalThis to survive HMR (dev) and avoid duplicate clients (prod)
globalForPrisma.prisma = masterClient

// ============================================================================
// Multi-tenant venue clients (cached per slug)
// ============================================================================

if (!globalForPrisma.venueClients) {
  globalForPrisma.venueClients = new Map()
}

const MAX_VENUE_CLIENTS = 50

/**
 * Resolve the active PrismaClient for the current request.
 *
 * Resolution order:
 *   1. AsyncLocalStorage (set by server.ts on the NUC)
 *   2. Next.js headers() — reads x-venue-slug (set by proxy.ts on Vercel)
 *   3. Master client (local dev, or NUC with DATABASE_URL already correct)
 *
 * On the NUC:
 *   server.ts wraps every request in requestStore.run({ slug, prisma })
 *   so Priority 1 fires.  Also DATABASE_URL already points to the venue DB.
 *
 * On Vercel (cloud / subdomains):
 *   No custom server → Priority 1 is undefined → falls through to Priority 2.
 *   proxy.ts sets x-venue-slug → headers().get('x-venue-slug') returns slug.
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
 * based on the x-venue-slug header set by proxy.ts.
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
