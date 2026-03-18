import { NextRequest, NextResponse } from 'next/server'
import { CashHandlingMode } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, clearPermissionCache } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth'
import { emitToLocation } from '@/lib/socket-server'

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

    const role = await db.role.findUnique({
      where: { id },
      include: {
        _count: {
          select: { employees: true },
        },
      },
    })

    if (!role) {
      return NextResponse.json(
        { error: 'Role not found' },
        { status: 404 }
      )
    }

    const auth = await requirePermission(requestingEmployeeId, role.locationId, PERMISSIONS.STAFF_MANAGE_ROLES)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    return NextResponse.json({ data: {
      role: {
        id: role.id,
        name: role.name,
        permissions: getPermissionsArray(role.permissions),
        roleType: role.roleType ?? 'FOH',
        accessLevel: role.accessLevel ?? 'STAFF',
        isTipped: role.isTipped,
        tipWeight: Number(role.tipWeight),
        cashHandlingMode: role.cashHandlingMode,
        trackLaborCost: role.trackLaborCost,
        employeeCount: role._count.employees,
        createdAt: role.createdAt.toISOString(),
        updatedAt: role.updatedAt.toISOString(),
      },
    } })
  } catch (error) {
    console.error('Failed to fetch role:', error)
    return NextResponse.json(
      { error: 'Failed to fetch role' },
      { status: 500 }
    )
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
    const { name, permissions, cashHandlingMode, trackLaborCost, isTipped, tipWeight, roleType, accessLevel, requestingEmployeeId } = body as {
      name?: string
      permissions?: string[]
      cashHandlingMode?: string
      trackLaborCost?: boolean
      isTipped?: boolean
      tipWeight?: number
      roleType?: string
      accessLevel?: string
      requestingEmployeeId?: string
    }

    // Check role exists
    const existing = await db.role.findUnique({
      where: { id },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Role not found' },
        { status: 404 }
      )
    }

    const auth = await requirePermission(requestingEmployeeId, existing.locationId, PERMISSIONS.STAFF_MANAGE_ROLES)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
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
        return NextResponse.json(
          { error: 'A role with this name already exists' },
          { status: 409 }
        )
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
      },
    })

    // Clear permission cache — role permissions may have changed
    if (permissions !== undefined) {
      clearPermissionCache()
    }

    // Emit employees:changed so all terminals refresh employee/permission data
    void emitToLocation(existing.locationId, 'employees:changed', { action: 'role_updated', roleId: id }).catch(console.error)

    return NextResponse.json({ data: {
      role: {
        id: role.id,
        name: role.name,
        permissions: getPermissionsArray(role.permissions),
        roleType: role.roleType ?? 'FOH',
        accessLevel: role.accessLevel ?? 'STAFF',
        isTipped: role.isTipped,
        tipWeight: Number(role.tipWeight),
        cashHandlingMode: role.cashHandlingMode,
        trackLaborCost: role.trackLaborCost,
        updatedAt: role.updatedAt.toISOString(),
      },
    } })
  } catch (error) {
    console.error('Failed to update role:', error)
    return NextResponse.json(
      { error: 'Failed to update role' },
      { status: 500 }
    )
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
      return NextResponse.json(
        { error: 'Role not found' },
        { status: 404 }
      )
    }

    const auth = await requirePermission(requestingEmployeeId, role.locationId, PERMISSIONS.STAFF_MANAGE_ROLES)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Prevent deletion if employees are assigned
    if (role._count.employees > 0) {
      return NextResponse.json(
        { error: `Cannot delete role with ${role._count.employees} assigned employee(s). Reassign them first.` },
        { status: 409 }
      )
    }

    await db.role.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete role:', error)
    return NextResponse.json(
      { error: 'Failed to delete role' },
      { status: 500 }
    )
  }
})
