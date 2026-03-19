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
import { createChildLogger } from '@/lib/logger'
import { cookies } from 'next/headers'
import { db } from './db'

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
    try {
      const secret = process.env.PROVISION_API_KEY
      if (secret) {
        const cookieStore = await cookies()
        const cloudToken = cookieStore.get('pos-cloud-session')?.value
        if (cloudToken) {
          const payload = await verifyCloudToken(cloudToken, secret)
          if (payload) {
            // Resolve location from venue DB
            let locationId: string | null = null
            if (payload.posLocationId) {
              const loc = await db.location.findUnique({
                where: { id: payload.posLocationId },
                select: { id: true },
              })
              locationId = loc?.id ?? null
            }
            if (!locationId) {
              const loc = await db.location.findFirst({
                select: { id: true },
                orderBy: { id: 'asc' },
              })
              locationId = loc?.id ?? null
            }

            if (locationId) {
              // Find or provision the cloud admin employee
              const sub = payload.sub
              const isCloudSub = sub.startsWith('cloud-') || sub.startsWith('mc-owner-')

              let employee: { id: string; roleId: string; role: { permissions: unknown; name: string } | null } | null = null

              if (!isCloudSub) {
                // Real employee ID in sub
                employee = await db.employee.findFirst({
                  where: { id: sub, locationId, deletedAt: null, isActive: true },
                  select: { id: true, roleId: true, role: { select: { permissions: true, name: true } } },
                })
              } else if (payload.email) {
                // Look up by email
                employee = await db.employee.findFirst({
                  where: { locationId, email: { equals: payload.email, mode: 'insensitive' }, deletedAt: null, isActive: true },
                  select: { id: true, roleId: true, role: { select: { permissions: true, name: true } } },
                })
              }

              // MC role mapping: cloud role → local MC employee type
              const MC_ROLE_MAP: Record<string, string> = {
                super_admin: 'MC Admin',
                sub_admin: 'MC Admin',
                enterprise_admin: 'MC Enterprise',
                org_admin: 'MC Manager',
                agent: 'MC Agent',
                dealer: 'MC Dealer',
                tech_support: 'MC Tech Support',
              }
              const isStaff = payload.role === 'super_admin' || payload.role === 'sub_admin'
              const mcRoleName = MC_ROLE_MAP[payload.role] || 'MC Access'

              // Auto-provision a trackable MC employee if none exists
              if (!employee && isCloudSub) {
                try {
                  // FIRST: check for existing MC employee by email (prevents duplicates on cold starts)
                  if (payload.email) {
                    employee = await db.employee.findFirst({
                      where: { locationId, email: { equals: payload.email, mode: 'insensitive' }, deletedAt: null },
                      select: { id: true, roleId: true, role: { select: { permissions: true, name: true } } },
                    })
                    if (employee) {
                      log.info(`[withAuth] Found existing MC employee by email: ${employee.id} (${payload.email})`)
                    }
                  }

                  // Only create if truly no employee found
                  if (!employee) {
                    // Find or create an MC admin role with full permissions
                    let mcRole = await db.role.findFirst({
                      where: { locationId, name: mcRoleName, deletedAt: null },
                      select: { id: true, permissions: true, name: true },
                    })
                    if (!mcRole) {
                      mcRole = await db.role.create({
                        data: {
                          locationId,
                          name: mcRoleName,
                          permissions: ['all'],
                          roleType: 'ADMIN',
                          accessLevel: 'OWNER_ADMIN',
                        },
                        select: { id: true, permissions: true, name: true },
                      }) as any
                    }

                    if (mcRole) {
                      const nameParts = (payload.name || 'MC Admin').split(' ')
                      const { hash } = await import('bcryptjs')
                      const { randomInt } = await import('crypto')
                      const rawPin = String(randomInt(100000, 1000000))
                      const hashedPin = await hash(rawPin, 10)

                      const created = await db.employee.create({
                        data: {
                          locationId,
                          firstName: nameParts[0] || 'MC',
                          lastName: nameParts.slice(1).join(' ') || 'Admin',
                          displayName: payload.name || mcRoleName,
                          email: payload.email || null,
                          pin: hashedPin,
                          roleId: mcRole.id,
                          isActive: true,
                        },
                        select: { id: true, roleId: true, role: { select: { permissions: true, name: true } } },
                      })
                      employee = created
                      log.info(`[withAuth] Auto-provisioned ${mcRoleName} employee: ${created.id} (${payload.email || payload.name})`)
                    }
                  }
                } catch (provisionErr) {
                  log.error('[withAuth] Failed to auto-provision MC employee:', provisionErr)
                }
              }

              if (employee) {
                const perms = (employee.role?.permissions as string[]) || []
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
              } else if (isStaff) {
                // Last resort: MC staff without provisioned employee — grant access
                const authCtx: AuthContext = {
                  employeeId: null,
                  locationId,
                  permissions: ['all'],
                  roleId: null,
                  roleName: mcRoleName,
                  source: 'cloud',
                }
                return handler(request, { auth: authCtx, params: context?.params })
              }
            }
          }
        }
      }
    } catch {
      // Cloud session check failed — fall through
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
