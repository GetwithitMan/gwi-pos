import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless'
import { PrismaNeon } from '@prisma/adapter-neon'
import ws from 'ws'
import { orderWriteGuardExtension } from './order-write-guard'
import { getRequestPrisma, getRequestLocationId } from './request-context'
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

const isVercel = !!process.env.VERCEL

// Neon serverless requires WebSocket in Node.js — must set before any Pool creation.
// ws, @neondatabase/serverless, and @prisma/adapter-neon are in serverExternalPackages
// so Turbopack doesn't bundle them (bundling breaks the ws WebSocket constructor).
if (isVercel) {
  neonConfig.webSocketConstructor = ws
}

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

  // On Vercel: Neon serverless (HTTP/WebSocket — instant, no TCP cold start)
  // On NUC: PrismaPg (TCP to local PostgreSQL — fast, reliable)
  let adapter: any
  if (isVercel) {
    const pool = new NeonPool({ connectionString })
    adapter = new PrismaNeon(pool)
  } else {
    adapter = new PrismaPg({
      connectionString,
      max: 25,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    })
  }

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
 * Wrap a $transaction callback to auto-inject the RLS GUC.
 *
 * When a locationId is available from the request context, the wrapper
 * calls `SET LOCAL app.current_tenant = locationId` at the start of each
 * transaction. This enables PostgreSQL RLS policies (migration 078) as a
 * defense-in-depth layer on top of the app-layer tenant scoping.
 *
 * Safe for startup/sync/cron: if no locationId is in context, the GUC
 * is not set and RLS policies return zero rows (fail-closed). These paths
 * use `adminDb` or `masterClient` which don't go through this proxy.
 */
function wrapTransactionWithRLS(client: PrismaClient) {
  const original = (client as any).$transaction.bind(client)
  return function rlsTransaction(...args: any[]) {
    // Only intercept callback-style: $transaction(async (tx) => { ... })
    // Array-style: $transaction([query1, query2]) — pass through as-is
    const [firstArg, ...rest] = args
    if (typeof firstArg !== 'function') {
      return original(firstArg, ...rest)
    }

    const locationId = getRequestLocationId()
    if (!locationId) {
      // No tenant context — pass through without RLS
      return original(firstArg, ...rest)
    }

    // Wrap the callback to inject SET LOCAL at the start
    const wrappedFn = async (tx: any) => {
      await tx.$queryRawUnsafe(
        `SELECT set_config('app.current_tenant', $1, true)`,
        locationId
      )
      return firstArg(tx)
    }
    return original(wrappedFn, ...rest)
  }
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
 *
 * $transaction calls are wrapped to automatically inject the RLS GUC
 * (SET LOCAL app.current_tenant) when a locationId is in the request context.
 */
export const db: PrismaClient = new Proxy(masterClient, {
  get(_target, prop) {
    const client = resolveClient()
    // Intercept $transaction to inject RLS GUC
    if (prop === '$transaction') {
      return wrapTransactionWithRLS(client)
    }
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
  let adapter: any
  if (isVercel) {
    const pool = new NeonPool({ connectionString })
    adapter = new PrismaNeon(pool)
  } else {
    adapter = new PrismaPg({ connectionString, max: 5, connectionTimeoutMillis: 10000 })
  }
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
