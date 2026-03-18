import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { headers } from 'next/headers'
import { orderWriteGuardExtension } from './order-write-guard'
import { getRequestPrisma, getRequestLocationId, setRequestLocationId, requestStore } from './request-context'
import { TENANT_SCOPED_MODELS, NO_SOFT_DELETE_MODELS } from './tenant-validation'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required')
}

/**
 * Resolve the locationId for tenant scoping.
 * First checks the synchronous request context cache, then falls back to the
 * async getLocationId() (which itself is cached per-venue with 5min TTL).
 * Returns undefined during startup/migrations/cron — caller must skip scoping.
 */
async function resolveTenantLocationId(): Promise<string | undefined> {
  // Guard against infinite recursion: tenant extension intercepts findFirst →
  // calls resolveTenantLocationId → getLocationId → findFirst → loop.
  // Uses per-request AsyncLocalStorage flag (concurrency-safe) instead of
  // module-level `let` which was shared across concurrent requests.
  const store = requestStore.getStore()
  if (store && store._resolvingLocationId) return undefined

  // Fast path: already cached in this request's AsyncLocalStorage
  const cached = getRequestLocationId()
  if (cached) return cached

  // Slow path: async lookup (DB-backed, but cached per venue slug)
  // Lazy import to avoid circular dependency (location-cache.ts imports db.ts)
  if (store) store._resolvingLocationId = true
  try {
    const { getLocationId } = await import('./location-cache')
    const id = await getLocationId()
    if (id) {
      setRequestLocationId(id)
      return id
    }
    return undefined
  } finally {
    if (store) store._resolvingLocationId = false
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  venueClients: Map<string, { client: PrismaClient; lastAccessed: number }> | undefined
}

function createPrismaClient(url?: string) {
  const connectionString = url || process.env.DATABASE_URL || ''
  const rawPoolSize = parseInt(process.env.DB_POOL_SIZE || process.env.DATABASE_CONNECTION_LIMIT || '25', 10)
  const poolSize = Number.isNaN(rawPoolSize) || rawPoolSize < 1 ? 25 : rawPoolSize
  const rawPoolTimeout = parseInt(process.env.DATABASE_POOL_TIMEOUT || '10', 10)
  const poolTimeout = Number.isNaN(rawPoolTimeout) || rawPoolTimeout < 1 ? 10 : rawPoolTimeout

  const adapter = new PrismaPg({
    connectionString,
    max: poolSize,
    connectionTimeoutMillis: poolTimeout * 1000,
  })

  const client = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
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

  // Chain: soft-delete guard (reads) → legacy write guard (Order/OrderItem writes)
  const guarded = extended.$extends(orderWriteGuardExtension)

  // ---------------------------------------------------------------------------
  // Tenant-scoping extension
  //
  // Auto-injects `locationId` into WHERE clauses for tenant-scoped models.
  // Only active when a locationId is available from the request context.
  // Safe for startup/migrations/cron: if no locationId, does nothing.
  // ---------------------------------------------------------------------------
  const tenantScoped = guarded.$extends({
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          const lid = await resolveTenantLocationId()
          if (lid && TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, locationId: lid }
          }
          return query(args)
        },
        async findFirst({ model, args, query }) {
          const lid = await resolveTenantLocationId()
          if (lid && TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, locationId: lid }
          }
          return query(args)
        },
        async findFirstOrThrow({ model, args, query }) {
          const lid = await resolveTenantLocationId()
          if (lid && TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, locationId: lid }
          }
          return query(args)
        },
        async findUnique({ model, args, query }) {
          // Defense-in-depth: post-read check for tenant models.
          // Primary enforcement should be in repository/service methods
          // with explicit tenant-scoped queries. This interceptor catches
          // any unscoped findUnique that slips through.
          const result = await query(args)
          if (result && TENANT_SCOPED_MODELS.has(model)) {
            const lid = await resolveTenantLocationId()
            const resultLocationId = (result as Record<string, unknown>).locationId as string | undefined
            if (lid && resultLocationId && resultLocationId !== lid) {
              console.error(JSON.stringify({
                event: 'tenant_breach_detected', model, operation: 'findUnique',
                expected: lid, actual: resultLocationId,
              }))
              return null
            }
          }
          return result
        },
        async findUniqueOrThrow({ model, args, query }) {
          const result = await query(args)
          if (result && TENANT_SCOPED_MODELS.has(model)) {
            const lid = await resolveTenantLocationId()
            const resultLocationId = (result as Record<string, unknown>).locationId as string | undefined
            if (lid && resultLocationId && resultLocationId !== lid) {
              console.error(JSON.stringify({
                event: 'tenant_breach_detected', model, operation: 'findUniqueOrThrow',
                expected: lid, actual: resultLocationId,
              }))
              throw new Error(`[tenant-scope] ${model} record belongs to a different location`)
            }
          }
          return result
        },
        async count({ model, args, query }) {
          const lid = await resolveTenantLocationId()
          if (lid && TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, locationId: lid }
          }
          return query(args)
        },
        async aggregate({ model, args, query }) {
          const lid = await resolveTenantLocationId()
          if (lid && TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, locationId: lid }
          }
          return query(args)
        },
        async groupBy({ model, args, query }) {
          const lid = await resolveTenantLocationId()
          if (lid && TENANT_SCOPED_MODELS.has(model)) {
            const existing = (args as Record<string, unknown>).where as Record<string, unknown> | undefined
            ;(args as Record<string, unknown>).where = { ...existing, locationId: lid }
          }
          return query(args)
        },
        async update({ model, args, query }) {
          // Defense-in-depth: inject locationId into update WHERE.
          // Primary enforcement should be in repository methods that
          // use composite where clauses (e.g., { id, locationId }).
          const lid = await resolveTenantLocationId()
          if (lid && TENANT_SCOPED_MODELS.has(model)) {
            const existing = args.where as Record<string, unknown>
            args.where = { ...existing, locationId: lid } as typeof args.where
          }
          return query(args)
        },
        async updateMany({ model, args, query }) {
          const lid = await resolveTenantLocationId()
          if (lid && TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, locationId: lid }
          }
          return query(args)
        },
        async delete({ model, args, query }) {
          const lid = await resolveTenantLocationId()
          if (lid && TENANT_SCOPED_MODELS.has(model)) {
            const existing = args.where as Record<string, unknown>
            args.where = { ...existing, locationId: lid } as typeof args.where
          }
          return query(args)
        },
        async deleteMany({ model, args, query }) {
          const lid = await resolveTenantLocationId()
          if (lid && TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, locationId: lid }
          }
          return query(args)
        },
      },
    },
  })

  return tenantScoped as unknown as PrismaClient
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

/** Idle venue clients are disconnected after 30 minutes of inactivity */
const VENUE_CLIENT_TTL_MS = 30 * 60 * 1000

// Periodic cleanup: disconnect idle venue clients every 5 minutes
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

/**
 * Resolve the active PrismaClient for the current request.
 *
 * Resolution:
 *   1. AsyncLocalStorage — set by server.ts (NUC) or withVenue() (Vercel).
 *      Both paths use requestStore.run() before route handlers execute.
 *   2. Fallback: master client (local dev without custom server).
 *
 * On Vercel, withVenue() reads x-venue-slug from headers, resolves the
 * venue PrismaClient, and wraps the handler in requestStore.run().
 * By the time any route code calls `db.someModel.findMany()`, the
 * correct client is always in AsyncLocalStorage — no header reads here.
 */
function resolveClient(): PrismaClient {
  const contextPrisma = getRequestPrisma()
  if (contextPrisma) return contextPrisma
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
  get(_target, prop) {
    const client = resolveClient()
    const value = (client as any)[prop]
    if (typeof value === 'function') {
      return value.bind(client)
    }
    return value
  },
})

// ============================================================================
// Admin database client — soft-delete only, NO tenant scoping.
// Use for cross-tenant operations: MC sync, migrations, cron jobs.
// ============================================================================

function createAdminClient(url?: string): PrismaClient {
  const connectionString = url || process.env.DATABASE_URL || ''
  const adapter = new PrismaPg({ connectionString, max: 5 })
  const client = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

  // Only soft-delete extension — no tenant scoping, no write guard
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
        async findUnique({ model, args, query }) {
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
      },
    },
  })

  return extended as unknown as PrismaClient
}

const globalForAdminDb = globalThis as unknown as { adminDb: PrismaClient | undefined }
export const adminDb: PrismaClient = globalForAdminDb.adminDb ?? createAdminClient()
globalForAdminDb.adminDb = adminDb

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
