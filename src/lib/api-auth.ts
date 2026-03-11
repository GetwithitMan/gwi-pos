// Server-side API authentication and permission checking
// Uses the same hasPermission() logic as client-side, but validates against DB

import { db } from './db'
import { hasPermission } from './auth-utils'
import { getSessionFromCookie } from './auth-session'
import type { NextRequest } from 'next/server'

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
    } catch { /* no cookie or invalid — fall through to 401 */ }
  }

  if (!employeeId) {
    return {
      authorized: false,
      error: 'Employee ID is required',
      status: 401,
    }
  }

  const employee = await db.employee.findUnique({
    where: { id: employeeId, deletedAt: null },
    include: { role: true },
  })

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

  if (!employeeId) {
    return {
      authorized: false,
      error: 'Employee ID is required',
      status: 401,
    }
  }

  const employee = await db.employee.findUnique({
    where: { id: employeeId, deletedAt: null },
    include: { role: true },
  })

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
 * Derive actor (employeeId, locationId) from the pos-session cookie if present.
 * Falls through to null if no valid cookie (Android/API clients use param-provided identity).
 */
export async function getActorFromRequest(
  request: NextRequest
): Promise<{ employeeId: string | null; locationId: string | null; fromSession: boolean }> {
  try {
    const session = await getSessionFromCookie()
    if (session) {
      return { employeeId: session.employeeId, locationId: session.locationId, fromSession: true }
    }
  } catch { /* no cookie or invalid */ }
  return { employeeId: null, locationId: null, fromSession: false }
}
