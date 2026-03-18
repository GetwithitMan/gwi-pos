import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { orderWriteGuardExtension } from './order-write-guard'
import { getRequestPrisma } from './request-context'
import { applySoftDeleteFilter } from './db-soft-delete'
import { createTenantScopedExtension } from './db-tenant-scope'
import {
  getDbForVenue as _getDbForVenue,
  disconnectVenue,
  getVenueClientCount,
  buildVenueDatabaseUrl,
  buildVenueDirectUrl,
  venueDbName,
} from './db-venue-cache'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required')
}

// ============================================================================
// PrismaClient factory — shared by master, admin, and venue clients
// ============================================================================

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export function createPrismaClient(url?: string) {
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

  // Chain: soft-delete guard → legacy write guard → tenant scoping
  const extended = client.$extends({
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          applySoftDeleteFilter(model, args)
          return query(args)
        },
        async findFirst({ model, args, query }) {
          applySoftDeleteFilter(model, args)
          return query(args)
        },
        async findFirstOrThrow({ model, args, query }) {
          applySoftDeleteFilter(model, args)
          return query(args)
        },
        async findUnique({ model, args, query }) {
          applySoftDeleteFilter(model, args)
          return query(args)
        },
        async findUniqueOrThrow({ model, args, query }) {
          applySoftDeleteFilter(model, args)
          return query(args)
        },
        async count({ model, args, query }) {
          applySoftDeleteFilter(model, args)
          return query(args)
        },
        async aggregate({ model, args, query }) {
          applySoftDeleteFilter(model, args)
          return query(args)
        },
        async groupBy({ model, args, query }) {
          applySoftDeleteFilter(model, args)
          return query(args)
        },
      },
    },
  })

  const guarded = extended.$extends(orderWriteGuardExtension)
  const tenantScoped = guarded.$extends(createTenantScopedExtension())

  return tenantScoped as unknown as PrismaClient
}

// ============================================================================
// Master database client (gwi_pos — default/fallback)
// ============================================================================

export const masterClient = globalForPrisma.prisma ?? createPrismaClient()
globalForPrisma.prisma = masterClient

// ============================================================================
// Tenant-aware proxy
// ============================================================================

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
          applySoftDeleteFilter(model, args)
          return query(args)
        },
        async findFirst({ model, args, query }) {
          applySoftDeleteFilter(model, args)
          return query(args)
        },
        async findUnique({ model, args, query }) {
          applySoftDeleteFilter(model, args)
          return query(args)
        },
        async count({ model, args, query }) {
          applySoftDeleteFilter(model, args)
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

// ============================================================================
// Multi-tenant venue clients — delegate to db-venue-cache.ts
// ============================================================================

/**
 * Get a PrismaClient for a specific venue database.
 * Wraps the venue cache's getDbForVenue with the local createPrismaClient.
 */
export function getDbForVenue(slug: string): PrismaClient {
  return _getDbForVenue(slug, createPrismaClient)
}

// Re-export venue utilities so the public API of '@/lib/db' is unchanged
export { disconnectVenue, getVenueClientCount, buildVenueDatabaseUrl, buildVenueDirectUrl, venueDbName }

export default db
