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
import type { PrismaClient } from '@prisma/client'

export interface RequestContext {
  slug: string
  prisma: PrismaClient
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
