/**
 * Route handler wrapper for multi-tenant venue isolation.
 *
 * Wraps a Next.js API route handler so that `import { db } from '@/lib/db'`
 * automatically routes to the correct venue Neon database.
 *
 * How it works:
 *   1. Reads x-venue-slug from request headers (set by proxy.ts)
 *   2. Resolves the correct PrismaClient via getDbForVenue(slug)
 *   3. Runs the handler inside AsyncLocalStorage.run({ slug, prisma })
 *   4. db.ts Proxy reads from AsyncLocalStorage on every DB call
 *
 * SECURITY NOTE: When no x-venue-slug header is present, requests run against
 * the master/local DB (NUC mode). This is safe for NUC deployments where there
 * is only one venue per server. On Vercel (multi-tenant), missing slug means
 * the request hit the main domain — master DB context is intentional for
 * public routes (online ordering, etc.). Tenant-bound admin routes should
 * validate locationId explicitly, not rely solely on DB routing.
 *
 * Usage:
 *   import { withVenue } from '@/lib/with-venue'
 *
 *   export const GET = withVenue(async (request) => {
 *     const items = await db.menuItem.findMany()  // routes to venue DB
 *     return NextResponse.json({ data: items })
 *   })
 */

import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { requestStore, getRequestPrisma } from './request-context'
import { getDbForVenue, masterClient } from './db'
import { verifyTenantContext, type VerifyOptions } from './tenant-context-signer'
import { config } from './system-config'
import { logger } from './logger'
import { getSchemaVerificationResult } from './schema-verify'

/**
 * Routes explicitly allowed to run without a venue slug.
 * These are public routes (online ordering, payment links), internal endpoints,
 * and NUC-local routes where there's only one venue per server.
 */
const SLUGLESS_ALLOWED_PATTERNS = [
  '/api/internal/',      // Internal provisioning/readiness endpoints
  '/api/public/',        // Public-facing (online ordering, gift card balance)
  '/api/auth/',          // Auth endpoints (login, session)
  '/api/health',         // Health checks
  '/api/session/',       // Session bootstrap
  '/api/setup/',         // Initial setup
  '/api/sync/',          // Sync endpoints (NUC-local)
  '/api/order-events/',  // Order event batch (NUC-local)
  '/api/fleet/',         // Fleet endpoints (NUC heartbeat)
  '/api/cron/',          // Vercel cron jobs (authed via CRON_SECRET, not slug)
  '/api/dashboard/',     // NUC Dashboard app (local monitoring)
  '/api/hardware/terminals/pair-native',  // Native app pairing (device doesn't know slug yet)
  '/api/hardware/terminals/pair',         // Browser pairing
  '/pay/',               // Payment links
  '/approve-void/',      // Void approval links
]

type RouteHandler = (request: any, context?: any) => Promise<Response> | Response

export function withVenue(handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    try {
      // ── Fail-closed 503 gate ──────────────────────────────────────────
      // When schema verification has explicitly failed in production, return
      // 503 for sync-critical routes. This prevents devices from appearing
      // "online" while data is silently diverging.
      //
      // IMPORTANT: Only fires when verification has RUN and FAILED (result
      // is non-null with passed === false). Does NOT fire during dev, or
      // when verification hasn't run yet (e.g., server still booting).
      if (process.env.NODE_ENV === 'production') {
        const schemaResult = getSchemaVerificationResult()
        if (schemaResult !== null && !schemaResult.passed) {
          // Allow health, auth, internal, and recovery endpoints through
          const pathname = request?.nextUrl?.pathname || request?.url?.split('?')[0] || ''
          const isExempt = SLUGLESS_ALLOWED_PATTERNS.some(p => pathname.startsWith(p))
          if (!isExempt) {
            return new Response(
              JSON.stringify({
                error: 'Service unavailable — schema verification failed',
                code: 'SCHEMA_NOT_VERIFIED',
              }),
              { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '30' } }
            )
          }
        }
      }

      // ── Readiness gate ──────────────────────────────────────────────────
      // On NUC production, block mutating requests until readiness >= ORDERS.
      // This prevents pairing, order creation, and payments from running
      // against an empty local DB before the first downstream sync completes.
      if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
        const method = request?.method?.toUpperCase?.() || ''
        if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
          const pathname = request?.nextUrl?.pathname || request?.url?.split('?')[0] || ''
          const isExempt = SLUGLESS_ALLOWED_PATTERNS.some(p => pathname.startsWith(p))
          if (!isExempt) {
            const { isReadyForOrders } = await import('./readiness')
            if (!isReadyForOrders()) {
              return new Response(
                JSON.stringify({
                  error: 'Server initializing — not ready for operations. Try again in 10 seconds.',
                  code: 'NOT_READY_FOR_ORDERS',
                }),
                { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '10' } }
              )
            }
          }
        }
      }

      // Fast path: if already inside a request context (NUC server.ts wraps
      // every request in requestStore.run()), skip the headers() lookup entirely.
      // This avoids the async overhead of await headers() on local POS.
      if (getRequestPrisma()) {
        return handler(request, context)
      }

      const headersList = await headers()
      const slug = headersList.get('x-venue-slug')

      // Hoisted so locationId from verified JWT is available to requestStore below
      let verifiedLocationId: string | undefined

      // ── Tenant JWT verification (when enabled) ──────────────────────
      // Cellular terminals authenticate via Bearer token (cellular JWT) which already
      // carries verified venue identity (locationId, venueSlug). They don't have
      // the x-tenant-context proxy JWT — skip the gate for Bearer-authenticated requests.
      const authHeader = headersList.get('authorization')
      const hasBearerToken = authHeader?.startsWith('Bearer ')

      if (config.tenantJwtEnabled && config.tenantSigningKey && slug && !hasBearerToken) {
        const tenantJwt = headersList.get('x-tenant-context')
        if (!tenantJwt) {
          logger.error('[withVenue] Missing x-tenant-context JWT for slug:', slug)
          return new Response(
            JSON.stringify({ error: 'Missing tenant context' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          )
        }

        // Build verify options from request
        const method = (request as any)?.method || 'GET'
        const pathname = headersList.get('x-original-path') || '/'
        const verifyOpts: VerifyOptions = { method, path: pathname }

        // For mutating methods, read the trusted body hash header set by proxy.ts
        // instead of re-reading the request body (which is not safe to double-read).
        if (method !== 'GET' && method !== 'HEAD') {
          const bodyHash = headersList.get('x-tenant-body-hash')
          if (bodyHash) {
            verifyOpts.bodySha256 = bodyHash
          }
        }

        const payload = await verifyTenantContext(tenantJwt, config.tenantSigningKey, verifyOpts)
        if (!payload) {
          logger.error('[withVenue] Invalid tenant context JWT for slug:', slug)
          return new Response(
            JSON.stringify({ error: 'Invalid tenant context' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          )
        }

        // Verify slug matches
        if (payload.venueSlug !== slug) {
          logger.error('[withVenue] Tenant JWT slug mismatch:', { jwt: payload.venueSlug, header: slug })
          return new Response(
            JSON.stringify({ error: 'Tenant context mismatch' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          )
        }

        // Capture verified locationId from JWT (cryptographically trusted).
        //
        // DESIGN NOTE: Venue routing is done by slug (database-level isolation).
        // Each slug maps to a separate Neon database, so cross-venue writes are
        // prevented by the database-per-venue model, not by locationId validation.
        // The locationId from the JWT is used for app-layer tenant scoping within
        // the venue DB (e.g., Prisma extension WHERE clause injection). It is NOT
        // validated against the venue's actual Location row here — the DB routing
        // via slug is the security boundary.
        if (payload.locationId) {
          verifiedLocationId = payload.locationId
        }
      }

      if (slug) {
        // Safety rail: if slug is present but DB resolution fails, return 500
        // instead of silently falling back to master DB
        let prisma
        try {
          prisma = await getDbForVenue(slug)
        } catch (err) {
          logger.error(`[withVenue] DB routing error for slug "${slug}":`, err)
          return new Response(
            JSON.stringify({ error: 'DB routing error' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          )
        }

        // Thread locationId into request context so route handlers can access it
        // without a bootstrap query. Sources (in priority order):
        //   1. Signed tenant JWT payload (cryptographically verified above)
        //   2. x-location-id header (set by proxy for cellular terminals)
        //   3. undefined (route must bootstrap from entity ID — legacy path)
        const locationId = verifiedLocationId
          || headersList.get('x-location-id')
          || undefined

        const requestId = headersList.get('x-request-id') || undefined
        return requestStore.run({ slug, prisma, locationId, requestId }, () => handler(request, context))
      }

      // No slug (main domain, local dev via `next dev`) — use master client
      const pathname = request.nextUrl.pathname
      // NUC mode: single venue, no slug needed. NUCs have NEON for sync but are still single-venue.
      // Detect NUC by POS_LOCATION_ID or STATION_ROLE (set during installer registration).
      // Only Vercel multi-tenant (no POS_LOCATION_ID, no STATION_ROLE) should enforce slug.
      const isNucLocal = !!(process.env.POS_LOCATION_ID || process.env.STATION_ROLE || process.env.LOCATION_ID)
      const isAllowedSlugless = SLUGLESS_ALLOWED_PATTERNS.some(p => pathname.startsWith(p))

      if (!isNucLocal && !isAllowedSlugless && process.env.NODE_ENV === 'production') {
        console.error(`[with-venue] BLOCKED: tenant-bound route ${pathname} hit without x-venue-slug in multi-tenant mode`)
        return NextResponse.json({ error: 'Venue context required' }, { status: 400 })
      }

      if (process.env.NODE_ENV === 'production') {
        logger.warn({ pathname }, '[withVenue] Slugless request running in master DB context (allowed slugless route)')
      }
      return requestStore.run(
        { slug: '', prisma: masterClient },
        () => handler(request, context)
      )
    } catch (error) {
      logger.error('[withVenue] Unhandled error:', error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
}
