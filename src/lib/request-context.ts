/**
 * Per-request context using AsyncLocalStorage.
 *
 * Provides tenant isolation: every incoming request gets its own
 * Prisma client pointing at the correct venue Neon database.
 *
 * Two consumers:
 *   1. server.ts (NUC) — wraps every HTTP request with .run()
 *   2. db.ts Proxy    — reads getRequestPrisma() on every DB call
 *
 * On Vercel (no custom server), db.ts falls back to reading
 * the x-venue-slug header via Next.js headers().
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { PrismaClient } from '@/generated/prisma/client'

export interface RequestContext {
  slug: string
  prisma: PrismaClient
  locationId?: string
  /** Unique ID for this HTTP request (for structured logging / trace correlation). */
  requestId?: string
  /** Guard against infinite recursion in tenant location resolution (db.ts). */
  _resolvingLocationId?: boolean
}

export const requestStore = new AsyncLocalStorage<RequestContext>()

/** Get the PrismaClient for the current request (from AsyncLocalStorage). */
export function getRequestPrisma(): PrismaClient | undefined {
  return requestStore.getStore()?.prisma
}

/** Get the venue slug for the current request. */
export function getRequestSlug(): string | undefined {
  return requestStore.getStore()?.slug
}

/** Get the locationId stored in the current request context (synchronous). */
export function getRequestLocationId(): string | undefined {
  return requestStore.getStore()?.locationId
}

/** Store the locationId in the current request context for synchronous access by Prisma extensions. */
export function setRequestLocationId(id: string): void {
  const store = requestStore.getStore()
  if (store) {
    store.locationId = id
  }
}

/** Get the request ID for the current request (for structured logging). */
export function getRequestId(): string | undefined {
  return requestStore.getStore()?.requestId
}

/** Store a request ID in the current request context. */
export function setRequestId(id: string): void {
  const store = requestStore.getStore()
  if (store) {
    store.requestId = id
  }
}
