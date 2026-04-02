import { NextRequest } from 'next/server'
import { CashHandlingMode } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, clearPermissionCache } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth'
import { emitToLocation } from '@/lib/socket-server'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('roles')

// roleType/accessLevel: UX display metadata only — never used for authorization

// Helper to safely get permissions as an array
function getPermissionsArray(permissions: unknown): string[] {
  if (Array.isArray(permissions)) {
    return permissions
  }
  return []
}

// GET - Get a single role by ID
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const requestingEmployeeId = request.nextUrl.searchParams.get('requestingEmployeeId')
    const locationId = request.nextUrl.searchParams.get('locationId')

    if (!locationId) {
      return err('locationId is required')
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.STAFF_MANAGE_ROLES)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    const role = await db.role.findFirst({
      where: { id, locationId },
      include: {
        _count: {
          select: { employees: true },
        },
      },
    })

    if (!role) {
      return notFound('Role not found')
    }

    return ok({
      role: {
        id: role.id,
        name: role.name,
        permissions: getPermissionsArray(role.permissions),
        roleType: role.roleType ?? 'FOH',
        accessLevel: role.accessLevel ?? 'STAFF',
        sessionTimeoutMinutes: role.sessionTimeoutMinutes ?? null,
        isTipped: role.isTipped,
        tipWeight: Number(role.tipWeight),
        cashHandlingMode: role.cashHandlingMode,
        trackLaborCost: role.trackLaborCost,
        employeeCount: role._count.employees,
        createdAt: role.createdAt.toISOString(),
        updatedAt: role.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to fetch role:', error)
    return err('Failed to fetch role', 500)
  }
})

// PUT - Update a role
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, permissions, cashHandlingMode, trackLaborCost, isTipped, tipWeight, roleType, accessLevel, sessionTimeoutMinutes, requestingEmployeeId } = body as {
      name?: string
      permissions?: string[]
      cashHandlingMode?: string
      trackLaborCost?: boolean
      isTipped?: boolean
      tipWeight?: number
      roleType?: string
      accessLevel?: string
      sessionTimeoutMinutes?: number | null
      requestingEmployeeId?: string
    }

    // Validate sessionTimeoutMinutes: must be null, 0, or positive integer
    if (sessionTimeoutMinutes !== undefined && sessionTimeoutMinutes !== null) {
      if (!Number.isInteger(sessionTimeoutMinutes) || sessionTimeoutMinutes < 0) {
        return err('sessionTimeoutMinutes must be null, 0, or a positive integer')
      }
    }

    // Check role exists
    const existing = await db.role.findUnique({
      where: { id },
    })

    if (!existing) {
      return notFound('Role not found')
    }

    const auth = await requirePermission(requestingEmployeeId, existing.locationId, PERMISSIONS.STAFF_MANAGE_ROLES)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Check for duplicate name if changing
    if (name && name !== existing.name) {
      const duplicate = await db.role.findFirst({
        where: {
          locationId: existing.locationId,
          name: { equals: name },
          NOT: { id },
        },
      })

      if (duplicate) {
        return err('A role with this name already exists', 409)
      }
    }

    const role = await db.role.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(permissions !== undefined && { permissions }),
        ...(roleType !== undefined && { roleType }),
        ...(accessLevel !== undefined && { accessLevel }),
        ...(cashHandlingMode !== undefined && { cashHandlingMode: cashHandlingMode as CashHandlingMode }),
        ...(trackLaborCost !== undefined && { trackLaborCost }),
        ...(isTipped !== undefined && { isTipped }),
        ...(tipWeight !== undefined && { tipWeight: Number(tipWeight) }),
        ...(sessionTimeoutMinutes !== undefined && { sessionTimeoutMinutes }),
      },
    })

    // Clear permission cache — role permissions may have changed
    if (permissions !== undefined) {
      clearPermissionCache()

      // Audit log: track permission changes
      const oldPerms = new Set(getPermissionsArray(existing.permissions))
      const newPerms = new Set(permissions)
      const added = [...newPerms].filter(p => !oldPerms.has(p))
      const removed = [...oldPerms].filter(p => !newPerms.has(p))

      if (added.length > 0 || removed.length > 0) {
        void db.auditLog.create({
          data: {
            locationId: role.locationId,
            employeeId: requestingEmployeeId || 'unknown',
            action: 'role_permissions_changed',
            entityType: 'role',
            entityId: role.id,
            details: { roleName: role.name, added, removed },
          },
        }).catch(err => log.warn({ err }, 'Background task failed'))
      }
    }

    // Emit employees:changed so all terminals refresh employee/permission data
    void emitToLocation(existing.locationId, 'employees:changed', { action: 'role_updated', roleId: id }).catch(err => log.warn({ err }, 'Background task failed'))

    void notifyDataChanged({ locationId: existing.locationId, domain: 'roles', action: 'updated', entityId: id })
    void pushUpstream()

    return ok({
      role: {
        id: role.id,
        name: role.name,
        permissions: getPermissionsArray(role.permissions),
        roleType: role.roleType ?? 'FOH',
        accessLevel: role.accessLevel ?? 'STAFF',
        sessionTimeoutMinutes: role.sessionTimeoutMinutes ?? null,
        isTipped: role.isTipped,
        tipWeight: Number(role.tipWeight),
        cashHandlingMode: role.cashHandlingMode,
        trackLaborCost: role.trackLaborCost,
        updatedAt: role.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to update role:', error)
    return err('Failed to update role', 500)
  }
})

// DELETE - Delete a role
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const requestingEmployeeId = request.nextUrl.searchParams.get('requestingEmployeeId')

    // Check role exists and get employee count
    const role = await db.role.findUnique({
      where: { id },
      include: {
        _count: {
          select: { employees: true },
        },
      },
    })

    if (!role) {
      return notFound('Role not found')
    }

    const auth = await requirePermission(requestingEmployeeId, role.locationId, PERMISSIONS.STAFF_MANAGE_ROLES)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Prevent deletion if employees are assigned
    if (role._count.employees > 0) {
      return err(`Cannot delete role with ${role._count.employees} assigned employee(s). Reassign them first.`, 409)
    }

    await db.role.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    void notifyDataChanged({ locationId: role.locationId, domain: 'roles', action: 'deleted', entityId: id })
    void pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('Failed to delete role:', error)
    return err('Failed to delete role', 500)
  }
})
