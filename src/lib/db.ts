import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { orderWriteGuardExtension } from './order-write-guard'
import { getRequestPrisma } from './request-context'
import { applySoftDeleteFilter } from './db-soft-delete'
import { createTenantScopedExtension } from './db-tenant-scope'
import { CONNECTION_BUDGET } from './db-connection-budget'
import {
  getDbForVenue as _getDbForVenue,
  disconnectVenue,
  getVenueClientCount,
  buildVenueDatabaseUrl,
  buildVenueDirectUrl,
  venueDbName,
  checkSlugCollisions,
} from './db-venue-cache'

const isVercel = !!process.env.VERCEL

// Re-export so existing `import { CONNECTION_BUDGET } from '@/lib/db'` works
export { CONNECTION_BUDGET } from './db-connection-budget'

// Build-time safety: during `next build`, API route modules are imported for static
// analysis. DATABASE_URL may not be set in preview deployments (PR branches).
// Defer the hard check to runtime so builds can complete without a database.
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'
if (!process.env.DATABASE_URL && !isBuildPhase) {
  throw new Error('DATABASE_URL environment variable is required')
}

// SAFETY: Prevent NUC from accidentally connecting to Neon as its primary DB.
// If DATABASE_URL points to neon.tech, the entire offline-first architecture breaks —
// every POS API route would depend on internet connectivity.
if (!isVercel && process.env.DATABASE_URL?.includes('neon.tech')) {
  throw new Error(
    'FATAL: DATABASE_URL must NOT point to neon.tech on NUC. ' +
    'Use local PostgreSQL (e.g., postgres://user:pass@localhost:5432/thepasspos). ' +
    'Neon should only be in NEON_DATABASE_URL for sync workers.'
  )
}

// ============================================================================
// PrismaClient factory — shared by master, admin, and venue clients
// ============================================================================

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export function createPrismaClient(url?: string) {
  const connectionString = url || process.env.DATABASE_URL || ''

  // PrismaPg for all environments — see CONNECTION_BUDGET above.
  // Vercel: 1 conn per function, long timeout for Neon cold starts.
  // NUC: budget-allocated pool, short timeout for local PostgreSQL.
  const poolSize = isVercel ? CONNECTION_BUDGET.VERCEL_PER_FUNCTION : CONNECTION_BUDGET.LOCAL_APP_POOL
  const timeoutMs = isVercel ? 60000 : 10000
  const adapter: any = new PrismaPg({
    connectionString,
    max: poolSize,
    connectionTimeoutMillis: timeoutMs,
    idleTimeoutMillis: isVercel ? 0 : 30000,
  })

  const client = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    transactionOptions: {
      maxWait: 10000,
      timeout: 30000, // 30s — extra headroom for payment transactions
    },
  })

  // Chain: soft-delete guard → legacy write guard → tenant scoping
  const extended = client.$extends({
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          applySoftDeleteFilter(model, args)
          // Safety cap: prevent unbounded queries from returning millions of rows
          // Pass take: -1 to explicitly opt out (e.g., reports, data exports)
          if (!args.take) {
            args.take = 5000
            if (process.env.NODE_ENV !== 'production') {
              console.debug(`[DB] findMany on ${model} capped at 5000 rows (no take specified)`)
            }
          } else if ((args.take as number) === -1) {
            delete args.take
          }
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

// Lazy init: skip client creation during next build when DATABASE_URL is absent.
// The proxy (db) will throw at runtime if someone calls a query without DATABASE_URL.
export const masterClient: PrismaClient = globalForPrisma.prisma ?? (
  process.env.DATABASE_URL
    ? createPrismaClient()
    : new Proxy({} as PrismaClient, {
        get(_, prop) {
          throw new Error(`DATABASE_URL not set — cannot access db.${String(prop)} at runtime`)
        },
      })
)
if (process.env.DATABASE_URL) {
  globalForPrisma.prisma = masterClient
}

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
  // See CONNECTION_BUDGET — admin pool is sized for cross-tenant ops, MC sync, cron
  const adminPoolSize = isVercel ? CONNECTION_BUDGET.VERCEL_PER_FUNCTION : CONNECTION_BUDGET.LOCAL_ADMIN_POOL
  const adapter: any = new PrismaPg({ connectionString, max: adminPoolSize, connectionTimeoutMillis: isVercel ? 60000 : 10000, idleTimeoutMillis: isVercel ? 0 : 30000 })
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
          // No safety cap on adminDb — internal/cross-tenant queries need full datasets
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
export async function getDbForVenue(slug: string): Promise<PrismaClient> {
  return _getDbForVenue(slug, createPrismaClient)
}

// Re-export venue utilities so the public API of '@/lib/db' is unchanged
export { disconnectVenue, getVenueClientCount, buildVenueDatabaseUrl, buildVenueDirectUrl, venueDbName, checkSlugCollisions }

// ============================================================================
// Transaction retry helper — retries on deadlock (P2034) or timeout (P2028)
// ============================================================================

/**
 * Retry a function that may fail due to transient database errors.
 * Handles Prisma P2034 (deadlock) and P2028 (transaction timeout) with
 * exponential backoff. Usable by any route wrapping `db.$transaction()`.
 *
 * @example
 *   const result = await withRetry(() =>
 *     db.$transaction(async (tx) => { ... })
 *   )
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 100
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      const isDeadlock = err?.code === 'P2034' || err?.message?.includes('deadlock')
      const isTimeout = err?.code === 'P2028'
      if ((isDeadlock || isTimeout) && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, delayMs * Math.pow(2, attempt - 1)))
        continue
      }
      throw err
    }
  }
  throw new Error('withRetry exhausted')
}

export default db
