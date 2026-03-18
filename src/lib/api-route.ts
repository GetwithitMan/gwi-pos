/**
 * Unified API Route Factory
 *
 * RULE: Every API route MUST use one of these factories.
 * They enforce auth + tenant binding. No route can accidentally skip auth.
 *
 * Four factory functions, covering every route category:
 *
 *   apiRoute('PERMISSION_KEY', handler)       — session auth + permission + tenant
 *   apiRoute({ permission, ... }, handler)    — session auth + options + tenant
 *   publicRoute(handler)                      — no auth, but still venue-scoped
 *   internalRoute(handler)                    — requires INTERNAL_API_KEY / PROVISION_API_KEY
 *   cronRoute(handler)                        — requires CRON_SECRET Bearer token
 *
 * Examples:
 *
 *   // Settings route — requires SETTINGS_EDIT permission
 *   export const PUT = apiRoute('SETTINGS_EDIT', async (req, ctx) => {
 *     ctx.auth.employeeId   // verified from session or cellular JWT
 *     ctx.auth.locationId   // verified from session or cellular JWT
 *     return NextResponse.json({ data: { ok: true } })
 *   })
 *
 *   // Auth-only route (no specific permission)
 *   export const GET = apiRoute(async (req, ctx) => { ... })
 *
 *   // Public route — no auth, venue-scoped
 *   export const GET = publicRoute(async (req) => { ... })
 *
 *   // Internal route — requires x-api-key header
 *   export const POST = internalRoute(async (req) => { ... })
 *
 *   // Cron route — requires Authorization: Bearer <CRON_SECRET>
 *   export const GET = cronRoute(async (req) => { ... })
 *
 * All factories wrap with withVenue() automatically — routes never need to
 * import withVenue themselves.
 *
 * Why this matters:
 *   Before: auth was convention-enforced. A dev could forget withAuth/withVenue
 *   and ship an unauthenticated, un-tenanted route. The CI lint script
 *   (scripts/check-route-factory.mjs) catches any route.ts that doesn't use
 *   one of these factories.
 *
 *   After: auth is framework-enforced. You literally cannot export a handler
 *   without choosing an auth policy.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from './with-venue'
import { withAuth, type AuthenticatedContext } from './api-auth-middleware'
import type { WithAuthOptions } from './api-auth-middleware'
import { verifyCronSecret } from './cron-auth'
import { timingSafeEqual } from 'crypto'

// ─── Re-export types for consumers ──────────────────────────────────────

export type { AuthenticatedContext, AuthContext } from './api-auth-middleware'

// ─── Types ──────────────────────────────────────────────────────────────

type AuthenticatedHandler = (
  request: NextRequest,
  ctx: AuthenticatedContext
) => Promise<Response> | Response

type Handler = (request: Request, context?: any) => Promise<Response> | Response

// ─── apiRoute ───────────────────────────────────────────────────────────
/**
 * Authenticated route — requires session + permission + tenant.
 *
 * Overloads:
 *   apiRoute(handler)                          — require auth, no specific permission
 *   apiRoute('PERMISSION_KEY', handler)        — require auth + permission
 *   apiRoute({ permission, ... }, handler)     — require auth + options
 */
export function apiRoute(handler: AuthenticatedHandler): (request: any, context?: any) => Promise<Response> | Response
export function apiRoute(permission: string, handler: AuthenticatedHandler): (request: any, context?: any) => Promise<Response> | Response
export function apiRoute(options: WithAuthOptions, handler: AuthenticatedHandler): (request: any, context?: any) => Promise<Response> | Response
export function apiRoute(
  handlerOrPermissionOrOptions: AuthenticatedHandler | string | WithAuthOptions,
  maybeHandler?: AuthenticatedHandler
): (request: any, context?: any) => Promise<Response> | Response {
  // Delegate to withAuth which already handles all three overloads
  if (typeof handlerOrPermissionOrOptions === 'function') {
    return withVenue(withAuth(handlerOrPermissionOrOptions))
  } else if (typeof handlerOrPermissionOrOptions === 'string') {
    return withVenue(withAuth(handlerOrPermissionOrOptions, maybeHandler!))
  } else {
    return withVenue(withAuth(handlerOrPermissionOrOptions, maybeHandler!))
  }
}

// ─── publicRoute ────────────────────────────────────────────────────────
/**
 * Public route — no auth, but still venue-scoped.
 *
 * Must be explicitly chosen — forces developers to consciously decide
 * "this route is intentionally public". The CI lint script flags any
 * route that doesn't use a factory, so a dev can't accidentally ship
 * an unprotected route; they must actively opt in with publicRoute().
 */
export function publicRoute(handler: Handler): Handler {
  return withVenue(handler)
}

// ─── internalRoute ──────────────────────────────────────────────────────
/**
 * Internal route — requires x-api-key header matching INTERNAL_API_KEY,
 * MC_API_KEY, or PROVISION_API_KEY.
 *
 * Used for machine-to-machine calls (Mission Control → NUC, cloud sync,
 * cache invalidation, provisioning).
 */
export function internalRoute(handler: Handler): Handler {
  return withVenue(async (request: Request, context?: any) => {
    const apiKey = request.headers.get('x-api-key')
    if (!apiKey) {
      return NextResponse.json({ error: 'API key required' }, { status: 401 })
    }

    // Check against all accepted internal keys
    const acceptedKeys = [
      process.env.INTERNAL_API_KEY,
      process.env.MC_API_KEY,
      process.env.PROVISION_API_KEY,
    ].filter(Boolean) as string[]

    if (acceptedKeys.length === 0) {
      console.error('[internalRoute] No internal API keys configured (INTERNAL_API_KEY / MC_API_KEY / PROVISION_API_KEY)')
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
    }

    // Constant-time comparison to prevent timing attacks
    const apiKeyBuf = Buffer.from(apiKey, 'utf8')
    let matched = false
    for (const expected of acceptedKeys) {
      const expectedBuf = Buffer.from(expected, 'utf8')
      if (apiKeyBuf.length === expectedBuf.length) {
        try {
          if (timingSafeEqual(apiKeyBuf, expectedBuf)) {
            matched = true
            break
          }
        } catch {
          // timingSafeEqual throws if lengths differ (shouldn't happen here)
        }
      }
    }

    if (!matched) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
    }

    return handler(request, context)
  })
}

// ─── cronRoute ──────────────────────────────────────────────────────────
/**
 * Cron route — requires Authorization: Bearer <CRON_SECRET>.
 *
 * Used for scheduled jobs (Vercel Cron, NUC crontab). Delegates to
 * verifyCronSecret() for constant-time token comparison.
 */
export function cronRoute(handler: Handler): Handler {
  return withVenue(async (request: Request, context?: any) => {
    const authHeader = request.headers.get('authorization')
    const cronAuthError = verifyCronSecret(authHeader)
    if (cronAuthError) return cronAuthError

    return handler(request, context)
  })
}
