/**
 * Tenant-Scoping — Prisma Extension
 *
 * Auto-injects `locationId` into WHERE clauses for tenant-scoped models.
 * Only active when a locationId is available from the request context.
 * Safe for startup/migrations/cron: if no locationId, does nothing.
 */

import { TENANT_SCOPED_MODELS } from './tenant-validation'
import { requestStore, getRequestLocationId, setRequestLocationId } from './request-context'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('db-tenant-scope')

/**
 * Resolve the locationId for tenant scoping.
 * First checks the synchronous request context cache, then falls back to the
 * async getLocationId() (which itself is cached per-venue with 5min TTL).
 * Returns undefined during startup/migrations/cron — caller must skip scoping.
 */
export async function resolveTenantLocationId(): Promise<string | undefined> {
  // Guard against infinite recursion: tenant extension intercepts findFirst →
  // calls resolveTenantLocationId → getLocationId → findFirst → loop.
  // Uses per-request AsyncLocalStorage flag when available (concurrency-safe).
  const store = requestStore.getStore()
  if (store) {
    if (store._resolvingLocationId) return undefined
  } else {
    // No AsyncLocalStorage context (RSC rendering, server components outside
    // server.ts request wrapper). The old _globalResolving module-level flag
    // was NOT concurrency-safe — multiple concurrent requests sharing a single
    // boolean could corrupt each other's state. Fail closed: return undefined
    // (no tenant scoping) rather than risk cross-tenant data leakage. The
    // normal request path always has AsyncLocalStorage via withVenue/server.ts.
    return undefined
  }

  // Fast path: already cached in this request's AsyncLocalStorage
  const cached = getRequestLocationId()
  if (cached) return cached

  // Slow path: raw SQL query that bypasses Prisma extensions entirely.
  // MUST NOT call getLocationId() here — that triggers the tenant extension
  // again, and the inflight promise coalescing returns the same promise
  // that's currently executing, causing a deadlock (Promise waits for itself).
  store._resolvingLocationId = true
  try {
    const { getRequestPrisma } = await import('./request-context')
    const prisma = getRequestPrisma()
    if (!prisma) return undefined
    // CRITICAL: $queryRawUnsafe is MANDATORY here — see DATABASE-CONNECTION-RULES.md.
    // Using $queryRaw with Prisma.sql triggers Prisma extension interceptors,
    // which call resolveTenantLocationId() again, causing a deadlock via inflight promise coalescing.
    // eslint-disable-next-line -- $queryRawUnsafe required: deadlock prevention (see CLAUDE.md)
    const rows = await (prisma as any).$queryRawUnsafe(
      'SELECT id, COUNT(*) OVER() as total FROM "Location" WHERE "deletedAt" IS NULL ORDER BY "createdAt" ASC LIMIT 1'
    ) as Array<{ id: string; total: bigint | number }>
    const row = rows[0]
    if (row) {
      const total = Number(row.total)
      if (total > 1) {
        log.error(`[tenant-scope] CRITICAL: ${total} active locations found — single-location invariant violated. Using oldest location ${row.id}.`)
      }
      setRequestLocationId(row.id)
      return row.id
    }
    return undefined
  } finally {
    store._resolvingLocationId = false
  }
}

/**
 * Create the tenant-scoping Prisma extension configuration.
 * Chain this onto a PrismaClient via `client.$extends(createTenantScopedExtension())`.
 */
export function createTenantScopedExtension() {
  return {
    query: {
      $allModels: {
        async findMany({ model, args, query }: { model: string; args: { where?: Record<string, unknown> }; query: (args: any) => Promise<any> }) {
          const lid = await resolveTenantLocationId()
          if (lid && TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, locationId: lid }
          }
          return query(args)
        },
        async findFirst({ model, args, query }: { model: string; args: { where?: Record<string, unknown> }; query: (args: any) => Promise<any> }) {
          const lid = await resolveTenantLocationId()
          if (lid && TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, locationId: lid }
          }
          return query(args)
        },
        async findFirstOrThrow({ model, args, query }: { model: string; args: { where?: Record<string, unknown> }; query: (args: any) => Promise<any> }) {
          const lid = await resolveTenantLocationId()
          if (lid && TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, locationId: lid }
          }
          return query(args)
        },
        async findUnique({ model, args, query }: { model: string; args: { where?: Record<string, unknown> }; query: (args: any) => Promise<any> }) {
          // Defense-in-depth: post-read check for tenant models.
          // Primary enforcement should be in repository/service methods
          // with explicit tenant-scoped queries. This interceptor catches
          // any unscoped findUnique that slips through.
          const result = await query(args)
          if (result && TENANT_SCOPED_MODELS.has(model)) {
            const lid = await resolveTenantLocationId()
            const resultLocationId = (result as Record<string, unknown>).locationId as string | undefined
            if (lid && resultLocationId && resultLocationId !== lid) {
              log.error(JSON.stringify({
                event: 'tenant_breach_detected', model, operation: 'findUnique',
                expected: lid, actual: resultLocationId,
              }))
              return null
            }
          }
          return result
        },
        async findUniqueOrThrow({ model, args, query }: { model: string; args: { where?: Record<string, unknown> }; query: (args: any) => Promise<any> }) {
          const result = await query(args)
          if (result && TENANT_SCOPED_MODELS.has(model)) {
            const lid = await resolveTenantLocationId()
            const resultLocationId = (result as Record<string, unknown>).locationId as string | undefined
            if (lid && resultLocationId && resultLocationId !== lid) {
              log.error(JSON.stringify({
                event: 'tenant_breach_detected', model, operation: 'findUniqueOrThrow',
                expected: lid, actual: resultLocationId,
              }))
              throw new Error(`[tenant-scope] ${model} record belongs to a different location`)
            }
          }
          return result
        },
        async count({ model, args, query }: { model: string; args: { where?: Record<string, unknown> }; query: (args: any) => Promise<any> }) {
          const lid = await resolveTenantLocationId()
          if (lid && TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, locationId: lid }
          }
          return query(args)
        },
        async aggregate({ model, args, query }: { model: string; args: { where?: Record<string, unknown> }; query: (args: any) => Promise<any> }) {
          const lid = await resolveTenantLocationId()
          if (lid && TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, locationId: lid }
          }
          return query(args)
        },
        async groupBy({ model, args, query }: { model: string; args: Record<string, unknown>; query: (args: any) => Promise<any> }) {
          const lid = await resolveTenantLocationId()
          if (lid && TENANT_SCOPED_MODELS.has(model)) {
            const existing = (args as Record<string, unknown>).where as Record<string, unknown> | undefined
            ;(args as Record<string, unknown>).where = { ...existing, locationId: lid }
          }
          return query(args)
        },
        async update({ model, args, query }: { model: string; args: { where?: Record<string, unknown> }; query: (args: any) => Promise<any> }) {
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
        async updateMany({ model, args, query }: { model: string; args: { where?: Record<string, unknown> }; query: (args: any) => Promise<any> }) {
          const lid = await resolveTenantLocationId()
          if (lid && TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, locationId: lid }
          }
          return query(args)
        },
        async delete({ model, args, query }: { model: string; args: { where?: Record<string, unknown> }; query: (args: any) => Promise<any> }) {
          const lid = await resolveTenantLocationId()
          if (lid && TENANT_SCOPED_MODELS.has(model)) {
            const existing = args.where as Record<string, unknown>
            args.where = { ...existing, locationId: lid } as typeof args.where
          }
          return query(args)
        },
        async deleteMany({ model, args, query }: { model: string; args: { where?: Record<string, unknown> }; query: (args: any) => Promise<any> }) {
          const lid = await resolveTenantLocationId()
          if (lid && TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, locationId: lid }
          }
          return query(args)
        },
      },
    },
  }
}
