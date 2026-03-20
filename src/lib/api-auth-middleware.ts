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
  /** Verified employee ID from session cookie. Null for cellular/internal/cloud-shadow auth. */
  employeeId: string | null
  /** Verified location ID from session or cellular token. */
  locationId: string
  /** Permission keys from the session. Empty for cellular/internal. */
  permissions: string[]
  /** Role ID from session. Null for cellular/internal/cloud-shadow. */
  roleId: string | null
  /** Role name from session. Null for cellular/internal/cloud-shadow. */
  roleName: string | null
  /** Which auth source was used. */
  source: 'session' | 'cloud' | 'cellular' | 'internal'
  /** For cellular auth: the terminal ID. */
  terminalId?: string
  /** True when caller is an MC/cloud admin operating in shadow mode (no local Employee record). */
  isCloudAdmin?: boolean
  /** For cellular auth: the bound employee ID from the token (for impersonation prevention). */
  cellularEmployeeId?: string | null
  /** For cellular auth: whether the terminal is authorized for refunds. */
  canRefund?: boolean
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
  /** Allow cellular terminal auth. Default: false — routes must explicitly opt in. */
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
    allowCellular = false,
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
      log.debug({ secretPresent: !!secret }, '[withAuth] Cloud auth: checking secret')
      if (secret) {
        const cookieStore = await cookies()
        const cloudToken = cookieStore.get('pos-cloud-session')?.value
        log.debug({ cookiePresent: !!cloudToken }, '[withAuth] Cloud auth: checking cookie')
        if (cloudToken) {
          const payload = await verifyCloudToken(cloudToken, secret)
          log.debug({ valid: !!payload, slug: payload?.slug, role: payload?.role }, '[withAuth] Cloud auth: token verification')
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
            log.debug({ locationId }, '[withAuth] Cloud auth: resolved locationId')

            if (locationId) {
              // Delegate to shared resolution — returns real employee ID or null (shadow admin)
              const employeeId = await resolveOrProvisionEmployee(payload, locationId)
              log.debug({ employeeId: employeeId || null, isShadow: !employeeId }, '[withAuth] Cloud auth: resolved employee')

              if (employeeId) {
                // Real employee (venue-login path) — look up role/permissions
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

              // ── Shadow MC Admin Mode ──────────────────────────────────────
              // MC/cloud users (Clerk user_*, cloud-*, mc-owner-*) get full
              // god-mode access WITHOUT a local Employee record. They are
              // invisible to staff lists, time clock, tips, shifts, reports.
              const isMcUser = payload.sub.startsWith('user_') || payload.sub.startsWith('cloud-') || payload.sub.startsWith('mc-owner-')
              if (isMcUser) {
                // 'all' passes every permission check
                if (resolvedPermission && !hasPermission(['all'], resolvedPermission)) {
                  return NextResponse.json(
                    { error: 'You do not have permission to perform this action' },
                    { status: 403 }
                  )
                }

                const authCtx: AuthContext = {
                  employeeId: null,
                  locationId,
                  permissions: ['all'],
                  roleId: null,
                  roleName: 'MC Shadow Admin',
                  source: 'cloud',
                  isCloudAdmin: true,
                }
                return handler(request, { auth: authCtx, params: context?.params })
              }
            }
          }
        }
      }
    } catch (cloudErr) {
      // Cloud session check failed — log the actual error, don't swallow silently
      log.warn({ err: cloudErr instanceof Error ? cloudErr.message : String(cloudErr) }, '[withAuth] Cloud session auth failed')
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
            // Cellular terminals are DENIED on permission-gated routes by default.
            // Routes that need cellular access must use allowCellular: true explicitly
            // AND perform route-level validation via cellular-validation.ts helpers.
            log.warn({ terminalId: payload.terminalId, permission: resolvedPermission }, `[withAuth] Cellular terminal ${payload.terminalId} DENIED on permission-gated route (${resolvedPermission}). Use allowCellular+route validation if this route needs cellular access.`)
            return NextResponse.json(
              { error: 'Cellular terminals cannot access this route. Use a LAN terminal.' },
              { status: 403 }
            )
          }

          recordActivity(payload.terminalId)

          const authCtx: AuthContext = {
            employeeId: payload.employeeId || null,  // Bound employee (if any)
            locationId: payload.locationId,
            permissions: [],
            roleId: null,
            roleName: null,
            source: 'cellular',
            terminalId: payload.terminalId,
            cellularEmployeeId: payload.employeeId || null,
            canRefund: payload.canRefund ?? false,
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
