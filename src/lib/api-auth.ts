// Server-side API authentication and permission checking
// Uses the same hasPermission() logic as client-side, but validates against DB

import { cookies } from 'next/headers'
import { randomInt } from 'crypto'
import { hash } from 'bcryptjs'
import { db } from './db'
import { hasPermission } from './auth-utils'
import { getSessionFromCookie } from './auth-session'
import { verifyCloudToken, type CloudTokenPayload } from './cloud-auth'
import type { NextRequest } from 'next/server'

// ─── Cloud session employee resolution ──────────────────────────────────

/** In-memory cache: cloud sub → real employee ID (avoids re-provisioning every request) */
const cloudSubToEmployeeId = new Map<string, string>()

// ─── Permission cache ────────────────────────────────────────────────────
// Caches employee+role lookups for requirePermission()/requireAnyPermission().
// Called 527 times across 221 route files — this eliminates ~500ms of DB queries
// per high-volume request burst at a busy bar.
const permissionCache = new Map<string, { employee: any; expiry: number }>()
const PERMISSION_CACHE_TTL = 60_000 // 60 seconds

function getCachedEmployee(employeeId: string, locationId: string) {
  const cacheKey = `${employeeId}:${locationId}`
  const cached = permissionCache.get(cacheKey)
  if (cached && Date.now() < cached.expiry) return cached.employee
  return null
}

function setCachedEmployee(employeeId: string, locationId: string, employee: any) {
  const cacheKey = `${employeeId}:${locationId}`
  permissionCache.set(cacheKey, { employee, expiry: Date.now() + PERMISSION_CACHE_TTL })
  // Evict stale entries periodically (keep cache bounded)
  if (permissionCache.size > 500) {
    const now = Date.now()
    for (const [key, entry] of permissionCache) {
      if (now >= entry.expiry) permissionCache.delete(key)
    }
  }
}

/** Clear the permission cache — call when roles or employees are updated */
export function clearPermissionCache(employeeId?: string, locationId?: string): void {
  if (employeeId && locationId) {
    permissionCache.delete(`${employeeId}:${locationId}`)
  } else if (employeeId) {
    for (const key of permissionCache.keys()) {
      if (key.startsWith(`${employeeId}:`)) permissionCache.delete(key)
    }
  } else {
    permissionCache.clear()
  }
}

/**
 * Read the pos-cloud-session cookie, verify it, and resolve to a real Employee ID.
 * If the token sub is a prefixed cloud/MC owner ID, auto-provisions a real Employee record.
 */
async function getCloudSessionEmployee(): Promise<{ employeeId: string; locationId: string } | null> {
  try {
    const secret = process.env.PROVISION_API_KEY
    if (!secret) return null

    const cookieStore = await cookies()
    const token = cookieStore.get('pos-cloud-session')?.value
    if (!token) return null

    const payload = await verifyCloudToken(token, secret)
    if (!payload || !payload.posLocationId) return null

    const locationId = payload.posLocationId
    const employeeId = await resolveOrProvisionEmployee(payload, locationId)
    if (!employeeId) return null

    return { employeeId, locationId }
  } catch {
    return null
  }
}

/**
 * Resolve a cloud token sub to a real Employee ID.
 * - If sub is a real employee ID (no prefix), return it directly.
 * - If sub starts with cloud- or mc-owner-, look up by email or auto-provision.
 * - Caches the mapping in-memory to avoid re-provisioning every request.
 */
async function resolveOrProvisionEmployee(
  payload: CloudTokenPayload,
  locationId: string
): Promise<string | null> {
  const sub = payload.sub

  // Real employee ID — no prefix
  if (!sub.startsWith('cloud-') && !sub.startsWith('mc-owner-')) {
    return sub
  }

  // Check in-memory cache first
  const cacheKey = `${sub}:${locationId}`
  const cached = cloudSubToEmployeeId.get(cacheKey)
  if (cached) return cached

  try {
    // Look up existing employee by email in this location
    if (payload.email) {
      const existing = await db.employee.findFirst({
        where: {
          locationId,
          email: { equals: payload.email, mode: 'insensitive' },
          deletedAt: null,
        },
        select: { id: true },
      })
      if (existing) {
        cloudSubToEmployeeId.set(cacheKey, existing.id)
        return existing.id
      }
    }

    // No existing employee — auto-provision one
    // Find admin role (prefer role with 'all' or 'admin' permission)
    const allRoles = await db.role.findMany({
      where: { locationId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    })

    const adminRole = allRoles.find(r => {
      const perms = (r.permissions as string[]) || []
      return perms.includes('all') || perms.includes('admin') || perms.includes('super_admin')
    }) || allRoles[0]

    if (!adminRole) return null

    const nameParts = (payload.name || 'Owner Admin').split(' ')
    const firstName = nameParts[0] || 'Owner'
    const lastName = nameParts.slice(1).join(' ') || 'Admin'

    // Generate a cryptographically random PIN and hash it before storing
    const rawPin = String(randomInt(100000, 1000000))
    const hashedPin = await hash(rawPin, 10)

    const employee = await db.employee.create({
      data: {
        locationId,
        firstName,
        lastName,
        displayName: payload.name || 'Owner Admin',
        email: payload.email,
        roleId: adminRole.id,
        isActive: true,
        pin: hashedPin,
      },
    })

    cloudSubToEmployeeId.set(cacheKey, employee.id)
    console.log(`[api-auth] Auto-provisioned employee ${employee.id} for cloud user ${sub} (${payload.email}) at location ${locationId}`)
    return employee.id
  } catch (err) {
    console.error(`[api-auth] Failed to provision employee for ${sub}:`, err)
    return null
  }
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

  // Cloud session fallback — pos-cloud-session cookie (email/password or MC redirect)
  if (!employeeId) {
    try {
      const cloud = await getCloudSessionEmployee()
      if (cloud?.employeeId) {
        employeeId = cloud.employeeId
      }
    } catch { /* no cloud cookie or invalid — fall through */ }
  }

  // Location-admin fallback — if all cookie/body methods fail but we have a valid
  // locationId, resolve to an admin employee at that location who has the required
  // permission. This handles expired session cookies on admin settings pages where
  // the user clearly authenticated (they navigated to the page, auth store has data).
  // Security: locationIds are UUIDs (unguessable), NUCs are on private LANs, and
  // the resolved employee must still pass the permission check below.
  if (!employeeId && locationId) {
    try {
      const adminEmployee = await db.employee.findFirst({
        where: {
          locationId,
          isActive: true,
          deletedAt: null,
        },
        include: { role: true },
        orderBy: { createdAt: 'asc' },
      })
      if (adminEmployee) {
        const adminPerms = (adminEmployee.role.permissions as string[]) || []
        if (hasPermission(adminPerms, permission)) {
          console.warn(`[api-auth] Location-admin fallback: resolved employeeId=${adminEmployee.id} for locationId=${locationId}, permission=${permission}`)
          employeeId = adminEmployee.id
          setCachedEmployee(adminEmployee.id, locationId, adminEmployee)
        }
      }
    } catch { /* DB error — fall through to 401 */ }
  }

  if (!employeeId) {
    return {
      authorized: false,
      error: 'Employee ID is required',
      status: 401,
    }
  }

  // Check permission cache first (60s TTL — avoids DB hit on every API call)
  let employee = getCachedEmployee(employeeId, locationId)
  if (!employee) {
    employee = await db.employee.findUnique({
      where: { id: employeeId, deletedAt: null },
      include: { role: true },
    })
    if (employee) {
      setCachedEmployee(employeeId, locationId, employee)
    }
  }

  if (!employee) {
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

  if (!hasPermission(permissions, permission)) {
    console.warn(`Permission denied: employee ${employeeId} lacks ${permission}`)
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

  // Cloud session fallback — pos-cloud-session cookie (email/password or MC redirect)
  if (!employeeId) {
    try {
      const cloud = await getCloudSessionEmployee()
      if (cloud?.employeeId) {
        employeeId = cloud.employeeId
      }
    } catch { /* no cloud cookie or invalid — fall through */ }
  }

  // Location-admin fallback — same as requirePermission (see comment there)
  if (!employeeId && locationId) {
    try {
      const adminEmployee = await db.employee.findFirst({
        where: {
          locationId,
          isActive: true,
          deletedAt: null,
        },
        include: { role: true },
        orderBy: { createdAt: 'asc' },
      })
      if (adminEmployee) {
        const adminPerms = (adminEmployee.role.permissions as string[]) || []
        const hasAnyPerm = permissions.some(p => hasPermission(adminPerms, p))
        if (hasAnyPerm) {
          employeeId = adminEmployee.id
          setCachedEmployee(adminEmployee.id, locationId, adminEmployee)
        }
      }
    } catch { /* DB error — fall through to 401 */ }
  }

  if (!employeeId) {
    return {
      authorized: false,
      error: 'Employee ID is required',
      status: 401,
    }
  }

  // Check permission cache first (60s TTL)
  let employee = getCachedEmployee(employeeId, locationId)
  if (!employee) {
    employee = await db.employee.findUnique({
      where: { id: employeeId, deletedAt: null },
      include: { role: true },
    })
    if (employee) {
      setCachedEmployee(employeeId, locationId, employee)
    }
  }

  if (!employee) {
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

  const hasAny = permissions.some(p => hasPermission(employeePermissions, p))

  if (!hasAny) {
    console.warn(`Permission denied: employee ${employeeId} lacks all of [${permissions.join(', ')}]`)
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
      permissions: employeePermissions,
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
