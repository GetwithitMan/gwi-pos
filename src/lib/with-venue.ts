/**
 * Route handler wrapper for multi-tenant venue isolation.
 *
 * Wraps a Next.js API route handler so that `import { db } from '@/lib/db'`
 * automatically routes to the correct venue Neon database.
 *
 * How it works:
 *   1. Reads x-venue-slug from request headers (set by middleware.ts)
 *   2. Resolves the correct PrismaClient via getDbForVenue(slug)
 *   3. Runs the handler inside AsyncLocalStorage.run({ slug, prisma })
 *   4. db.ts Proxy reads from AsyncLocalStorage on every DB call
 *
 * Usage:
 *   import { withVenue } from '@/lib/with-venue'
 *
 *   export const GET = withVenue(async (request) => {
 *     const items = await db.menuItem.findMany()  // routes to venue DB
 *     return NextResponse.json({ data: items })
 *   })
 */

import { headers } from 'next/headers'
import { requestStore, getRequestPrisma } from './request-context'
import { getDbForVenue, masterClient } from './db'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler = (request: any, context?: any) => Promise<Response> | Response

export function withVenue(handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    // Fast path: if already inside a request context (NUC server.ts wraps
    // every request in requestStore.run()), skip the headers() lookup entirely.
    // This avoids the async overhead of await headers() on local POS.
    if (getRequestPrisma()) {
      return handler(request, context)
    }

    const headersList = await headers()
    const slug = headersList.get('x-venue-slug')

    if (slug) {
      // Safety rail: if slug is present but DB resolution fails, return 500
      // instead of silently falling back to master DB
      let prisma
      try {
        prisma = getDbForVenue(slug)
      } catch (err) {
        console.error(`[withVenue] DB routing error for slug "${slug}":`, err)
        return new Response(
          JSON.stringify({ error: `Invalid venue slug or DB routing error: ${slug}` }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return requestStore.run({ slug, prisma }, () => handler(request, context))
    }

    // No slug (main domain, local dev via `next dev`) — use master client
    return requestStore.run(
      { slug: '', prisma: masterClient },
      () => handler(request, context)
    )
  }
}
