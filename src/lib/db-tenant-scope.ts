/**
 * Tenant-Scoping — Prisma Extension
 *
 * Auto-injects `locationId` into WHERE clauses for tenant-scoped models.
 * Only active when a locationId is available from the request context.
 * Safe for startup/migrations/cron: if no locationId, does nothing.
 */

import { TENANT_SCOPED_MODELS } from './tenant-validation'
import { requestStore, getRequestLocationId, setRequestLocationId } from './request-context'

/**
 * Resolve the locationId for tenant scoping.
 * First checks the synchronous request context cache, then falls back to the
 * async getLocationId() (which itself is cached per-venue with 5min TTL).
 * Returns undefined during startup/migrations/cron — caller must skip scoping.
 */
// Module-level fallback guard for contexts without AsyncLocalStorage
// (RSC rendering, server components outside server.ts request wrapper).
// Not concurrency-safe across multiple requests, but prevents the Map
// overflow crash that kills the dev server entirely.
let _globalResolving = false

export async function resolveTenantLocationId(): Promise<string | undefined> {
  // Guard against infinite recursion: tenant extension intercepts findFirst →
  // calls resolveTenantLocationId → getLocationId → findFirst → loop.
  // Uses per-request AsyncLocalStorage flag when available (concurrency-safe),
  // falls back to module-level flag for RSC/no-store contexts.
  const store = requestStore.getStore()
  if (store) {
    if (store._resolvingLocationId) return undefined
  } else {
    if (_globalResolving) return undefined
  }

  // Fast path: already cached in this request's AsyncLocalStorage
  const cached = getRequestLocationId()
  if (cached) return cached

  // Slow path: async lookup (DB-backed, but cached per venue slug)
  // Lazy import to avoid circular dependency (location-cache.ts imports db.ts)
  if (store) {
    store._resolvingLocationId = true
  } else {
    _globalResolving = true
  }
  try {
    const { getLocationId } = await import('./location-cache')
    const id = await getLocationId()
    if (id) {
      setRequestLocationId(id)
      return id
    }
    return undefined
  } finally {
    if (store) {
      store._resolvingLocationId = false
    } else {
      _globalResolving = false
    }
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
              console.error(JSON.stringify({
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
              console.error(JSON.stringify({
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
