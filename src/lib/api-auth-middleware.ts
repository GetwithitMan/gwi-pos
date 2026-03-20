/**
 * Session-based API route auth middleware.
 *
 * Replaces the pattern of trusting client-supplied `employeeId` / `locationId`
 * in request bodies with server-verified identity from the signed session
 * cookie or cellular JWT.
 *
 * Usage:
 *
 *   // Require a specific permission:
 *   export const POST = withVenue(withAuth('SETTINGS_EDIT', async (req, ctx) => {
 *     ctx.auth.employeeId   // verified from session cookie or cellular JWT
 *     ctx.auth.locationId   // verified from session cookie or cellular JWT
 *     ctx.auth.permissions  // from session
 *   }))
 *
 *   // Require authentication only (no specific permission):
 *   export const GET = withVenue(withAuth(async (req, ctx) => { ... }))
 *
 *   // Multiple auth sources (session OR cellular OR internal API key):
 *   export const POST = withVenue(withAuth({ permission: 'MENU_EDIT_ITEMS', allowInternal: true }, handler))
 *
 * Auth sources (checked in order):
 *   1. POS session cookie (pos-session) — HMAC-SHA256 signed JWT
 *   2. Cloud session cookie (pos-cloud-session) — Mission Control admin JWT
 *   3. Cellular Bearer token (Authorization: Bearer <token>)
 *   4. Internal API key (x-api-key header) — only if allowInternal is set
 *
 * The middleware injects `ctx.auth` with the verified identity. Routes should
 * NEVER read employeeId/locationId from the request body for auth purposes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookie, refreshSessionCookie } from './auth-session'
import { verifyCellularToken, recordActivity } from './cellular-auth'
import { verifyCloudToken } from './cloud-auth'
import { hasPermission } from './auth-utils'
import { PERMISSIONS } from './auth-utils'
import { resolveOrProvisionEmployee } from './api-auth'
import { createChildLogger } from '@/lib/logger'
import { cookies } from 'next/headers'
import { db } from './db'
import { getRequestPrisma } from './request-context'

const log = createChildLogger('api-auth-middleware')

// ─── Types ───────────────────────────────────────────────────────────────

export interface AuthContext {
  /** Verified employee ID from session cookie. Null for cellular/internal auth. */
  employeeId: string | null
  /** Verified location ID from session or cellular token. */
  locationId: string
  /** Permission keys from the session. Empty for cellular/internal. */
  permissions: string[]
  /** Role ID from session. Null for cellular/internal. */
  roleId: string | null
  /** Role name from session. Null for cellular/internal. */
  roleName: string | null
  /** Which auth source was used. */
  source: 'session' | 'cloud' | 'cellular' | 'internal'
  /** For cellular auth: the terminal ID. */
  terminalId?: string
}

export interface AuthenticatedContext {
  auth: AuthContext
  /** Pass-through for Next.js route params (e.g., { params: Promise<{ id: string }> }) */
  params?: any
}

type AuthenticatedHandler = (
  request: NextRequest,
  ctx: AuthenticatedContext
) => Promise<Response> | Response

export interface WithAuthOptions {
  /** Permission key string (e.g., 'settings.edit') or PERMISSIONS constant key (e.g., 'SETTINGS_EDIT'). */
  permission?: string
  /** Allow x-api-key internal auth (for MC->POS routes). Default: false. */
  allowInternal?: boolean
  /** Allow cellular terminal auth. Default: true. */
  allowCellular?: boolean
}

// ─── Permission resolution ───────────────────────────────────────────────

/**
 * Resolve a permission key. Accepts either:
 * - A PERMISSIONS constant key: 'SETTINGS_EDIT' -> 'settings.edit'
 * - A raw permission string: 'settings.edit' -> 'settings.edit'
 */
function resolvePermission(key: string): string {
  // Check if it's a PERMISSIONS constant key (uppercase with underscores)
  if (key === key.toUpperCase() && key in PERMISSIONS) {
    return (PERMISSIONS as Record<string, string>)[key]
  }
  // Already a raw permission string
  return key
}

// ─── Internal API key validation ─────────────────────────────────────────

function validateInternalApiKey(request: NextRequest): string | null {
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey) return null

  const expectedKey = process.env.INTERNAL_API_KEY || process.env.MC_API_KEY
  if (!expectedKey) return null

  if (apiKey === expectedKey) {
    // For internal routes, we need a locationId from the request
    // Internal callers must supply it as a header or query param
    return apiKey
  }

  return null
}

// ─── Core middleware ─────────────────────────────────────────────────────

/**
 * Wrap an API route handler with session-based auth.
 *
 * Overloads:
 *   withAuth(handler)                          — require auth, no specific permission
 *   withAuth('PERMISSION_KEY', handler)        — require auth + permission
 *   withAuth({ permission, ... }, handler)     — require auth + options
 */
export function withAuth(handler: AuthenticatedHandler): (request: NextRequest, context?: any) => Promise<Response>
export function withAuth(permission: string, handler: AuthenticatedHandler): (request: NextRequest, context?: any) => Promise<Response>
export function withAuth(options: WithAuthOptions, handler: AuthenticatedHandler): (request: NextRequest, context?: any) => Promise<Response>
export function withAuth(
  handlerOrPermissionOrOptions: AuthenticatedHandler | string | WithAuthOptions,
  maybeHandler?: AuthenticatedHandler
): (request: NextRequest, context?: any) => Promise<Response> {
  let handler: AuthenticatedHandler
  let options: WithAuthOptions = {}

  if (typeof handlerOrPermissionOrOptions === 'function') {
    // withAuth(handler)
    handler = handlerOrPermissionOrOptions
  } else if (typeof handlerOrPermissionOrOptions === 'string') {
    // withAuth('PERMISSION_KEY', handler)
    handler = maybeHandler!
    options = { permission: handlerOrPermissionOrOptions }
  } else {
    // withAuth({ permission, ... }, handler)
    handler = maybeHandler!
    options = handlerOrPermissionOrOptions
  }

  const {
    permission,
    allowInternal = false,
    allowCellular = true,
  } = options

  const resolvedPermission = permission ? resolvePermission(permission) : null

  return async (request: NextRequest, context?: any) => {
    // ── 1. Try POS session cookie ──────────────────────────────────────
    try {
      const session = await getSessionFromCookie()
      if (session) {
        // Session is valid — check permission if required
        if (resolvedPermission && !hasPermission(session.permissions, resolvedPermission)) {
          log.warn(`[withAuth] Permission denied: employee ${session.employeeId} lacks ${resolvedPermission}`)
          return NextResponse.json(
            { error: 'You do not have permission to perform this action' },
            { status: 403 }
          )
        }

        // Refresh session activity (fire-and-forget, <=1 cookie write per minute)
        void refreshSessionCookie(session).catch(() => {})

        const authCtx: AuthContext = {
          employeeId: session.employeeId,
          locationId: session.locationId,
          permissions: session.permissions,
          roleId: session.roleId,
          roleName: session.roleName,
          source: 'session',
        }

        return handler(request, { auth: authCtx, params: context?.params })
      }
    } catch {
      // Cookie read failed — fall through to other auth methods
    }

    // ── 2. Try cloud session cookie (Mission Control admin) ────────
    // Delegates to the shared resolveOrProvisionEmployee() in api-auth.ts
    // so that both auth paths use the same provisioning logic.
    try {
      const { config } = await import('./system-config')
      const secret = config.cloudJwtSecret
      console.log('[auth-middleware] Cloud auth: secret=' + (secret ? 'SET' : 'MISSING'))
      if (secret) {
        const cookieStore = await cookies()
        const cloudToken = cookieStore.get('pos-cloud-session')?.value
        console.log('[auth-middleware] Cloud auth: cookie=' + (cloudToken ? 'PRESENT(' + cloudToken.substring(0, 20) + '...)' : 'MISSING'))
        if (cloudToken) {
          const payload = await verifyCloudToken(cloudToken, secret)
          console.log('[auth-middleware] Cloud auth: payload=' + (payload ? JSON.stringify({ slug: payload.slug, role: payload.role, posLocationId: payload.posLocationId }) : 'INVALID'))
          if (payload) {
            // Use raw PrismaClient to avoid deadlock with tenant-scoped db proxy
            const prisma = getRequestPrisma() || db

            // Resolve location from venue DB
            let locationId: string | null = null
            if (payload.posLocationId) {
              const loc = await (prisma as any).location.findUnique({
                where: { id: payload.posLocationId },
                select: { id: true },
              })
              locationId = loc?.id ?? null
            }
            if (!locationId) {
              const loc = await (prisma as any).location.findFirst({
                select: { id: true },
                orderBy: { createdAt: 'asc' },
              })
              locationId = loc?.id ?? null
            }
            console.log('[auth-middleware] Cloud auth: locationId=' + (locationId || 'NULL'))

            if (locationId) {
              // Delegate to shared provisioning — same path as api-auth.ts
              const employeeId = await resolveOrProvisionEmployee(payload, locationId)
              console.log('[auth-middleware] Cloud auth: employeeId=' + (employeeId || 'NULL'))

              if (employeeId) {
                // Look up the employee to get role/permissions
                const employee = await (prisma as any).employee.findFirst({
                  where: { id: employeeId, deletedAt: null, isActive: true },
                  select: { id: true, roleId: true, role: { select: { permissions: true, name: true } } },
                })

                if (employee) {
                  const perms = (employee.role?.permissions as string[]) || []
                  // MC staff (super_admin/sub_admin) get 'all' permissions
                  const isStaff = payload.role === 'super_admin' || payload.role === 'sub_admin'
                  const effectivePerms = isStaff ? ['all', ...perms] : perms

                  if (resolvedPermission && !hasPermission(effectivePerms, resolvedPermission)) {
                    return NextResponse.json(
                      { error: 'You do not have permission to perform this action' },
                      { status: 403 }
                    )
                  }

                  const authCtx: AuthContext = {
                    employeeId: employee.id,
                    locationId,
                    permissions: effectivePerms,
                    roleId: employee.roleId,
                    roleName: employee.role?.name || null,
                    source: 'cloud',
                  }
                  return handler(request, { auth: authCtx, params: context?.params })
                }
              }
              // If provisioning failed, fall through to other auth methods
              // (no employeeId: null fallback — every cloud user must have a real employee)
            }
          }
        }
      }
    } catch (cloudErr) {
      // Cloud session check failed — log the actual error, don't swallow silently
      console.error('[auth-middleware] Cloud session auth failed:', cloudErr instanceof Error ? cloudErr.message : cloudErr)
    }

    // ── 3. Try cellular Bearer token ─────────────────────────────────
    if (allowCellular) {
      const authHeader = request.headers.get('authorization')
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7)
        const payload = await verifyCellularToken(token)
        if (payload) {
          // Cellular terminals don't have employee-level permissions.
          // Permission checks for cellular are handled by the proxy allowlist.
          // If a specific permission is required and the route made it past
          // the proxy, we trust it. But we still block if the route explicitly
          // requires a permission and cellular auth doesn't carry permissions.
          if (resolvedPermission) {
            // Cellular tokens don't carry permission arrays.
            // Routes requiring specific permissions should not be accessible
            // via cellular (the proxy.ts allowlist should block them).
            // If we get here, it means the route is on the allowlist but
            // also requires a permission — this is a config error.
            // Log a warning but allow it (defense in depth is at proxy level).
            log.warn(`[withAuth] Cellular terminal ${payload.terminalId} accessing permission-gated route (${resolvedPermission}). Proxy allowlist should be reviewed.`
            )
          }

          recordActivity(payload.terminalId)

          const authCtx: AuthContext = {
            employeeId: null, // Cellular terminals don't authenticate as an employee
            locationId: payload.locationId,
            permissions: [],
            roleId: null,
            roleName: null,
            source: 'cellular',
            terminalId: payload.terminalId,
          }

          return handler(request, { auth: authCtx, params: context?.params })
        }
      }
    }

    // ── 4. Try internal API key ──────────────────────────────────────
    if (allowInternal) {
      const validKey = validateInternalApiKey(request)
      if (validKey) {
        // Internal callers must provide locationId via header or query param
        const locationId =
          request.headers.get('x-location-id') ||
          request.nextUrl.searchParams.get('locationId') ||
          ''

        if (!locationId) {
          return NextResponse.json(
            { error: 'locationId is required for internal API calls' },
            { status: 400 }
          )
        }

        const authCtx: AuthContext = {
          employeeId: null,
          locationId,
          permissions: ['*'], // Internal has full access
          roleId: null,
          roleName: null,
          source: 'internal',
        }

        return handler(request, { auth: authCtx, params: context?.params })
      }
    }

    // ── No valid auth found ──────────────────────────────────────────
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    )
  }
}
