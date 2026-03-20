// Server-side API authentication and permission checking
// Uses the same hasPermission() logic as client-side, but validates against DB

import { cookies } from 'next/headers'
import { db } from './db'
import { getRequestPrisma } from './request-context'
import * as EmployeeRepository from '@/lib/repositories/employee-repository'
import { createChildLogger } from '@/lib/logger'
import { hasPermission } from './auth-utils'
import { getSessionFromCookie } from './auth-session'
import { verifyCloudToken, type CloudTokenPayload } from './cloud-auth'
import type { NextRequest } from 'next/server'

const log = createChildLogger('api-auth')

// ─── Cloud session employee resolution ──────────────────────────────────

/** In-memory cache: cloud sub → real employee ID (avoids re-provisioning every request) */
const cloudSubToEmployeeId = new Map<string, string>()

// ─── Permission cache ────────────────────────────────────────────────────
// Caches employee+role lookups for requirePermission()/requireAnyPermission().
// Called 527 times across 221 route files — this eliminates ~500ms of DB queries
// per high-volume request burst at a busy bar.
const permissionCache = new Map<string, { employee: any; expiry: number }>()
const PERMISSION_CACHE_TTL = 15_000 // 15 seconds

function getCachedEmployee(employeeId: string, locationId: string) {
  const cacheKey = `${employeeId}:${locationId}`
  const cached = permissionCache.get(cacheKey)
  if (cached && Date.now() < cached.expiry) return cached.employee
  return null
}

function setCachedEmployee(employeeId: string, locationId: string, employee: any) {
  const cacheKey = `${employeeId}:${locationId}`
  permissionCache.set(cacheKey, { employee, expiry: Date.now() + PERMISSION_CACHE_TTL })
  // Evict oldest entry when cache exceeds capacity (O(1) instead of O(N) scan).
  // Map iteration order is insertion order, so keys().next() is the oldest entry.
  if (permissionCache.size > 500) {
    const firstKey = permissionCache.keys().next().value
    if (firstKey) permissionCache.delete(firstKey)
  }
}

// ─── Permission override cache ──────────────────────────────────────────
// Caches per-employee permission overrides (same TTL as employee cache).
// Map<"employeeId:locationId", { overrides: Map<permissionKey, allowed>, expiry }>
const overrideCache = new Map<string, { overrides: Map<string, boolean>; expiry: number }>()

function getCachedOverrides(employeeId: string, locationId: string): Map<string, boolean> | null {
  const cacheKey = `${employeeId}:${locationId}`
  const cached = overrideCache.get(cacheKey)
  if (cached && Date.now() < cached.expiry) return cached.overrides
  return null
}

function setCachedOverrides(employeeId: string, locationId: string, overrides: Map<string, boolean>) {
  const cacheKey = `${employeeId}:${locationId}`
  overrideCache.set(cacheKey, { overrides, expiry: Date.now() + PERMISSION_CACHE_TTL })
  // Evict oldest entry when cache exceeds capacity (O(1) instead of O(N) scan).
  // Map iteration order is insertion order, so keys().next() is the oldest entry.
  if (overrideCache.size > 500) {
    const firstKey = overrideCache.keys().next().value
    if (firstKey) overrideCache.delete(firstKey)
  }
}

async function getOverrides(employeeId: string, locationId: string): Promise<Map<string, boolean>> {
  let overrides = getCachedOverrides(employeeId, locationId)
  if (overrides) return overrides

  overrides = new Map<string, boolean>()
  try {
    const prisma = getRequestPrisma() || db
    const rows = await (prisma as any).employeePermissionOverride.findMany({
      where: { employeeId, locationId },
      select: { permissionKey: true, allowed: true },
    })
    for (const row of rows) {
      overrides.set(row.permissionKey, row.allowed)
    }
  } catch {
    // Table may not exist yet on older DBs — treat as no overrides
  }
  setCachedOverrides(employeeId, locationId, overrides)
  return overrides
}

/**
 * Check a single permission against overrides.
 * Returns true (granted), false (denied), or null (no override — fall through to role).
 */
function checkOverride(overrides: Map<string, boolean>, permission: string): boolean | null {
  const exact = overrides.get(permission)
  if (exact !== undefined) return exact
  return null
}

/** Clear the permission cache — call when roles or employees are updated */
export function clearPermissionCache(employeeId?: string, locationId?: string): void {
  if (employeeId && locationId) {
    permissionCache.delete(`${employeeId}:${locationId}`)
    overrideCache.delete(`${employeeId}:${locationId}`)
  } else if (employeeId) {
    for (const key of permissionCache.keys()) {
      if (key.startsWith(`${employeeId}:`)) permissionCache.delete(key)
    }
    for (const key of overrideCache.keys()) {
      if (key.startsWith(`${employeeId}:`)) overrideCache.delete(key)
    }
  } else {
    permissionCache.clear()
    overrideCache.clear()
  }
}

/**
 * Read the pos-cloud-session cookie and resolve identity.
 * Returns employeeId (real employee for venue-login) or null (shadow MC admin).
 * locationId and cloudRole are always returned when the cookie is valid.
 */
async function getCloudSessionEmployee(): Promise<{ employeeId: string | null; locationId: string; cloudRole?: string } | null> {
  try {
    const { config } = await import('./system-config')
    const secret = config.cloudJwtSecret
    if (!secret) { log.info('[cloud-auth] No CLOUD_JWT_SECRET or PROVISION_API_KEY'); return null }

    const cookieStore = await cookies()
    const token = cookieStore.get('pos-cloud-session')?.value
    if (!token) { log.info('[cloud-auth] No pos-cloud-session cookie'); return null }

    const payload = await verifyCloudToken(token, secret)
    if (!payload) { log.warn('[cloud-auth] Token verification failed'); return null }

    log.info({ sub: payload.sub, slug: payload.slug, posLocationId: payload.posLocationId }, '[cloud-auth] Token OK')

    // posLocationId may be missing if MC didn't have it when creating the session.
    // Fall back to querying the venue DB (each venue has exactly one Location row).
    let locationId = payload.posLocationId
    if (!locationId) {
      log.info('[cloud-auth] posLocationId missing, querying DB...')
      // Use request context PrismaClient directly — NOT the db proxy.
      // The db proxy triggers tenant scope extension which can deadlock.
      const prisma = getRequestPrisma() || db
      if (prisma) {
        const rows = await (prisma as any).$queryRawUnsafe(
          'SELECT id FROM "Location" WHERE "deletedAt" IS NULL ORDER BY "createdAt" ASC LIMIT 1'
        ) as Array<{ id: string }>
        locationId = rows[0]?.id
      }
      log.info({ locationId }, '[cloud-auth] DB locationId resolved')
      if (!locationId) return null
    }
    const employeeId = await resolveOrProvisionEmployee(payload, locationId)
    log.info({ employeeId: employeeId || '(shadow admin)' }, '[cloud-auth] Resolved identity')

    // employeeId is null for shadow MC admins — still return locationId + cloudRole
    return { employeeId, locationId, cloudRole: payload.role }
  } catch (err) {
    log.error({ err }, '[cloud-auth] Error')
    return null
  }
}

/**
 * Resolve a cloud token sub to a real Employee ID.
 * - If sub is a real employee ID (no prefix), return it directly.
 * - If sub starts with cloud- or mc-owner-, look up by email or auto-provision.
 * - Caches the mapping in-memory to avoid re-provisioning every request.
 *
 * Exported so that api-auth-middleware.ts can delegate to the same provisioning path.
 */
export async function resolveOrProvisionEmployee(
  payload: CloudTokenPayload,
  locationId: string
): Promise<string | null> {
  const sub = payload.sub

  // Real employee ID — no prefix (cuid/uuid from venue-login).
  // Anything else is a cloud/MC identity that operates in shadow mode.
  if (!sub.startsWith('cloud-') && !sub.startsWith('mc-owner-') && !sub.startsWith('user_')) {
    return sub
  }

  // ── Shadow MC Admin Mode ──────────────────────────────────────────────
  // MC/cloud users (Clerk user_*, cloud-*, mc-owner-*) do NOT get a real
  // Employee record. They operate as invisible shadow admins — full access,
  // zero footprint in staff lists, time clock, tips, shifts, reports.
  // Return null to tell the middleware to use the JWT-only bypass path.
  return null
}

interface AuthSuccess {
  authorized: true
  employee: {
    id: string
    firstName: string
    lastName: string
    displayName: string | null
    locationId: string
    permissions: string[]
  }
}

interface AuthFailure {
  authorized: false
  error: string
  status: number
}

type AuthResult = AuthSuccess | AuthFailure

/**
 * Validate that an employee exists, belongs to the given location,
 * and has the required permission.
 */
export async function requirePermission(
  employeeId: string | undefined | null,
  locationId: string,
  permission: string
): Promise<AuthResult> {
  // Session cookie fallback — if no employeeId was provided (browser admin pages),
  // try to resolve it from the pos-session cookie before failing
  if (!employeeId) {
    try {
      const session = await getSessionFromCookie()
      if (session?.employeeId) {
        employeeId = session.employeeId
      }
    } catch { /* no cookie or invalid — fall through */ }
  }

  // Cloud session — pos-cloud-session cookie (email/password or MC redirect)
  // Always check cloud session to override locationId, even when employeeId
  // was already resolved by getActorFromRequest(). Routes pass body.locationId
  // which may not match the MC employee's locationId → "Employee not found".
  let cloudRole: string | undefined
  try {
    const cloud = await getCloudSessionEmployee()
    if (cloud) {
      // Override locationId from cloud session (prevents "Employee not found")
      locationId = cloud.locationId
      cloudRole = cloud.cloudRole

      if (cloud.employeeId) {
        if (!employeeId) employeeId = cloud.employeeId
      } else {
        // Shadow MC admin — no local Employee record, full god-mode access
        log.info(`[api-auth] Shadow MC admin bypass: cloudRole=${cloudRole}, permission=${permission}, locationId=${locationId}`)
        return {
          authorized: true,
          employee: {
            id: 'shadow-mc-admin',
            firstName: 'MC',
            lastName: 'Admin',
            displayName: 'MC Shadow Admin',
            locationId,
            permissions: ['all'],
          },
        }
      }
    }
  } catch { /* no cloud cookie or invalid — fall through */ }

  if (!employeeId) {
    log.warn(`[api-auth] Authentication required: no employeeId resolved for locationId=${locationId}, permission=${permission}`)
    return {
      authorized: false,
      error: 'Authentication required',
      status: 401,
    }
  }

  // Check permission cache first (15s TTL — avoids DB hit on every API call)
  let employee = getCachedEmployee(employeeId, locationId)
  if (!employee) {
    // Try with the provided locationId first
    employee = await EmployeeRepository.getEmployeeByIdWithInclude(
      employeeId,
      locationId,
      { role: true },
    )
    // If not found, try without locationId constraint (MC employees may have different locationId)
    if (!employee) {
      const prismaFallback = getRequestPrisma() || db
      employee = await (prismaFallback as any).employee.findFirst({
        where: { id: employeeId, deletedAt: null, isActive: true },
        include: { role: true },
      }) as typeof employee
    }
    if (employee) {
      setCachedEmployee(employeeId, employee.locationId, employee)
    }
  }

  if (!employee) {
    // Cloud super-admin bypass — MC super_admin/sub_admin users are god-mode
    // even if no local Employee record exists (e.g., fresh venue with no provisioned employee)
    if (cloudRole && ['super_admin', 'sub_admin'].includes(cloudRole)) {
      log.info(`[api-auth] Cloud super-admin bypass: role=${cloudRole}, permission=${permission}, locationId=${locationId}`)
      return {
        authorized: true,
        employee: {
          id: employeeId,
          firstName: 'Cloud',
          lastName: 'Admin',
          displayName: 'Cloud Admin',
          locationId,
          permissions: ['all'],
        },
      }
    }
    return {
      authorized: false,
      error: 'Employee not found',
      status: 401,
    }
  }

  if (!employee.isActive) {
    return {
      authorized: false,
      error: 'Employee account is inactive',
      status: 403,
    }
  }

  if (employee.locationId !== locationId) {
    return {
      authorized: false,
      error: 'Employee does not belong to this location',
      status: 403,
    }
  }

  const permissions = (employee.role.permissions as string[]) || []

  // Check per-employee permission overrides (deny overrides role grant, grant overrides role lack)
  const overrides = await getOverrides(employeeId, locationId)
  const overrideResult = checkOverride(overrides, permission)

  if (overrideResult === false) {
    // Explicit deny — even if role has it
    log.warn(`Permission denied by override: employee ${employeeId} denied ${permission}`)
    return {
      authorized: false,
      error: 'You do not have permission to perform this action',
      status: 403,
    }
  }

  if (overrideResult === true) {
    // Explicit grant — even if role doesn't have it
    return {
      authorized: true,
      employee: {
        id: employee.id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        displayName: employee.displayName,
        locationId: employee.locationId,
        permissions: [...permissions, permission],
      },
    }
  }

  // No override — fall through to role-based check
  if (!hasPermission(permissions, permission)) {
    log.warn(`Permission denied: employee ${employeeId} lacks ${permission}`)
    return {
      authorized: false,
      error: 'You do not have permission to perform this action',
      status: 403,
    }
  }

  return {
    authorized: true,
    employee: {
      id: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      displayName: employee.displayName,
      locationId: employee.locationId,
      permissions,
    },
  }
}

/**
 * Validate that an employee has ANY of the given permissions.
 * Useful when an action can be authorized by multiple permission keys.
 */
export async function requireAnyPermission(
  employeeId: string | undefined | null,
  locationId: string,
  permissions: string[]
): Promise<AuthResult> {
  // Session cookie fallback — same as requirePermission
  if (!employeeId) {
    try {
      const session = await getSessionFromCookie()
      if (session?.employeeId) {
        employeeId = session.employeeId
      }
    } catch { /* no cookie or invalid */ }
  }

  // Cloud session — pos-cloud-session cookie (email/password or MC redirect)
  // Always check cloud session to override locationId. Matches requirePermission().
  let cloudRoleAny: string | undefined
  try {
    const cloud = await getCloudSessionEmployee()
    if (cloud) {
      locationId = cloud.locationId
      cloudRoleAny = cloud.cloudRole

      if (cloud.employeeId) {
        if (!employeeId) employeeId = cloud.employeeId
      } else {
        // Shadow MC admin — no local Employee record, full god-mode access
        log.info(`[api-auth] Shadow MC admin bypass: cloudRole=${cloudRoleAny}, permissions=[${permissions.join(', ')}], locationId=${locationId}`)
        return {
          authorized: true,
          employee: {
            id: 'shadow-mc-admin',
            firstName: 'MC',
            lastName: 'Admin',
            displayName: 'MC Shadow Admin',
            locationId,
            permissions: ['all'],
          },
        }
      }
    }
  } catch { /* no cloud cookie or invalid — fall through */ }

  if (!employeeId) {
    log.warn(`[api-auth] Authentication required: no employeeId resolved for locationId=${locationId}, permissions=[${permissions.join(', ')}]`)
    return {
      authorized: false,
      error: 'Authentication required',
      status: 401,
    }
  }

  // Check permission cache first (15s TTL — avoids DB hit on every API call)
  let employee = getCachedEmployee(employeeId, locationId)
  if (!employee) {
    // Try with the provided locationId first
    employee = await EmployeeRepository.getEmployeeByIdWithInclude(
      employeeId,
      locationId,
      { role: true },
    )
    // If not found, try without locationId constraint (MC employees may have different locationId)
    if (!employee) {
      const prismaFallback = getRequestPrisma() || db
      employee = await (prismaFallback as any).employee.findFirst({
        where: { id: employeeId, deletedAt: null, isActive: true },
        include: { role: true },
      }) as typeof employee
    }
    if (employee) {
      setCachedEmployee(employeeId, employee.locationId, employee)
    }
  }

  if (!employee) {
    // Cloud super-admin bypass — MC super_admin/sub_admin users are god-mode
    if (cloudRoleAny && ['super_admin', 'sub_admin'].includes(cloudRoleAny)) {
      log.info(`[api-auth] Cloud super-admin bypass: role=${cloudRoleAny}, permissions=[${permissions.join(', ')}], locationId=${locationId}`)
      return {
        authorized: true,
        employee: {
          id: employeeId,
          firstName: 'Cloud',
          lastName: 'Admin',
          displayName: 'Cloud Admin',
          locationId,
          permissions: ['all'],
        },
      }
    }
    return {
      authorized: false,
      error: 'Employee not found',
      status: 401,
    }
  }

  if (!employee.isActive) {
    return {
      authorized: false,
      error: 'Employee account is inactive',
      status: 403,
    }
  }

  if (employee.locationId !== locationId) {
    return {
      authorized: false,
      error: 'Employee does not belong to this location',
      status: 403,
    }
  }

  const employeePermissions = (employee.role.permissions as string[]) || []

  // Check per-employee permission overrides
  const overrides = await getOverrides(employeeId, locationId)

  // Check each requested permission against overrides first, then role
  const grantedPermissions = [...employeePermissions]
  let hasAny = false

  for (const p of permissions) {
    const overrideResult = checkOverride(overrides, p)
    if (overrideResult === true) {
      hasAny = true
      if (!grantedPermissions.includes(p)) grantedPermissions.push(p)
      break
    }
    if (overrideResult === false) {
      // Explicit deny — skip this permission even if role has it
      continue
    }
    // No override — check role
    if (hasPermission(employeePermissions, p)) {
      hasAny = true
      break
    }
  }

  if (!hasAny) {
    log.warn(`Permission denied: employee ${employeeId} lacks all of [${permissions.join(', ')}]`)
    return {
      authorized: false,
      error: 'You do not have permission to perform this action',
      status: 403,
    }
  }

  return {
    authorized: true,
    employee: {
      id: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      displayName: employee.displayName,
      locationId: employee.locationId,
      permissions: grantedPermissions,
    },
  }
}

/**
 * Derive actor (employeeId, locationId) from session cookies if present.
 * Priority: pos-session (PIN login) > pos-cloud-session (email/MC redirect).
 * Falls through to null if no valid cookie (Android/API clients use param-provided identity).
 */
export async function getActorFromRequest(
  request: NextRequest
): Promise<{ employeeId: string | null; locationId: string | null; fromSession: boolean }> {
  // Priority 1: pos-session (PIN login)
  try {
    const session = await getSessionFromCookie()
    if (session) {
      return { employeeId: session.employeeId, locationId: session.locationId, fromSession: true }
    }
  } catch { /* no cookie or invalid */ }

  // Priority 2: pos-cloud-session (email/password or MC redirect)
  try {
    const cloud = await getCloudSessionEmployee()
    if (cloud) {
      return { employeeId: cloud.employeeId, locationId: cloud.locationId, fromSession: true }
    }
  } catch { /* no cloud cookie or invalid */ }

  return { employeeId: null, locationId: null, fromSession: false }
}
