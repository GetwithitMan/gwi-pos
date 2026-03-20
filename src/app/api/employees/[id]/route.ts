import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as EmployeeRepository from '@/lib/repositories/employee-repository'
import { hashPin, PERMISSIONS } from '@/lib/auth'
import { requirePermission, getActorFromRequest, clearPermissionCache } from '@/lib/api-auth'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { emitToLocation } from '@/lib/socket-server'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { removeMemberFromGroup } from '@/lib/domain/tips/tip-groups'

// GET - Get employee details
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = request.nextUrl.searchParams.get('locationId') || await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'Location required' }, { status: 400 })
    }

    const employee = await EmployeeRepository.getEmployeeByIdWithInclude(id, locationId, {
      role: {
        select: {
          id: true,
          name: true,
          permissions: true,
        },
      },
      location: {
        select: {
          id: true,
          name: true,
        },
      },
      employeeRoles: {
        where: { deletedAt: null },
        include: {
          role: { select: { id: true, name: true } },
        },
        orderBy: { isPrimary: 'desc' },
      },
    })

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      )
    }

    // Auth check — require staff.view permission
    const requestingEmployeeId = request.headers.get('x-employee-id') || request.nextUrl.searchParams.get('requestingEmployeeId')
    if (requestingEmployeeId) {
      const auth = await requirePermission(requestingEmployeeId, employee.locationId, PERMISSIONS.STAFF_VIEW)
      if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Get summary stats
    // TODO: Add EmployeeRepository.getEmployeeStats() for tenant-safe aggregate queries
    const [orderCount, totalSales, totalCommission] = await Promise.all([
      db.order.count({
        where: {
          employeeId: id,
          status: { in: ['paid', 'closed'] },
        },
      }),
      db.order.aggregate({
        where: {
          employeeId: id,
          status: { in: ['paid', 'closed'] },
        },
        _sum: { total: true },
      }),
      db.order.aggregate({
        where: {
          employeeId: id,
          status: { in: ['paid', 'closed'] },
        },
        _sum: { commissionTotal: true },
      }),
    ])

    return NextResponse.json({ data: {
      id: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      displayName: employee.displayName || `${employee.firstName} ${employee.lastName.charAt(0)}.`,
      email: employee.email,
      phone: employee.phone,
      role: {
        id: employee.role.id,
        name: employee.role.name,
        permissions: employee.role.permissions as string[],
      },
      location: employee.location,
      hourlyRate: employee.hourlyRate ? Number(employee.hourlyRate) : null,
      hireDate: employee.hireDate?.toISOString() || null,
      isActive: employee.isActive,
      color: employee.color,
      avatarUrl: employee.avatarUrl,
      defaultScreen: employee.defaultScreen,
      defaultOrderType: employee.defaultOrderType,
      additionalRoles: employee.employeeRoles
        .filter(er => !er.isPrimary)
        .map(er => ({ id: er.role.id, name: er.role.name })),
      createdAt: employee.createdAt.toISOString(),
      updatedAt: employee.updatedAt.toISOString(),
      // Stats
      stats: {
        orderCount,
        totalSales: totalSales._sum.total ? Number(totalSales._sum.total) : 0,
        totalCommission: totalCommission._sum.commissionTotal
          ? Number(totalCommission._sum.commissionTotal)
          : 0,
      },
    } })
  } catch (error) {
    console.error('Failed to fetch employee:', error)
    return NextResponse.json(
      { error: 'Failed to fetch employee' },
      { status: 500 }
    )
  }
})

// PUT - Update employee
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    // Resolve locationId — body → fallback to cached location
    const locationId = body.locationId || await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'Location required' }, { status: 400 })
    }

    // Auth check — require staff.edit_profile permission
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? body.requestingEmployeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.STAFF_EDIT_PROFILE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Sensitive field checks — require elevated permissions for wage and role assignment
    if (body.hourlyRate !== undefined || body.hireDate !== undefined) {
      const wageAuth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.STAFF_EDIT_WAGES)
      if (!wageAuth.authorized) return NextResponse.json({ error: wageAuth.error }, { status: wageAuth.status })
    }
    if (body.roleId !== undefined || body.additionalRoleIds !== undefined) {
      const roleAuth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.STAFF_ASSIGN_ROLES)
      if (!roleAuth.authorized) return NextResponse.json({ error: roleAuth.error }, { status: roleAuth.status })
    }

    const {
      firstName,
      lastName,
      displayName,
      email,
      phone,
      pin,
      roleId,
      hourlyRate,
      hireDate,
      color,
      isActive,
      defaultScreen,
      defaultOrderType,
      additionalRoleIds,
    } = body as {
      firstName?: string
      lastName?: string
      displayName?: string
      email?: string
      phone?: string
      pin?: string
      roleId?: string
      hourlyRate?: number
      hireDate?: string
      color?: string
      isActive?: boolean
      defaultScreen?: string
      defaultOrderType?: string
      additionalRoleIds?: string[]
    }

    // Check employee exists (tenant-scoped)
    const existing = await EmployeeRepository.getEmployeeById(id, locationId)

    if (!existing) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      )
    }

    // Build update data
    const updateData: Record<string, unknown> = {}

    if (firstName !== undefined) updateData.firstName = firstName
    if (lastName !== undefined) updateData.lastName = lastName
    if (displayName !== undefined) updateData.displayName = displayName || null
    if (email !== undefined) updateData.email = email || null
    if (phone !== undefined) updateData.phone = phone || null
    if (hourlyRate !== undefined) updateData.hourlyRate = hourlyRate
    if (hireDate !== undefined) updateData.hireDate = hireDate ? new Date(hireDate) : null
    if (color !== undefined) updateData.color = color || null
    if (isActive !== undefined) updateData.isActive = isActive
    if (defaultScreen !== undefined) updateData.defaultScreen = defaultScreen || null
    if (defaultOrderType !== undefined) updateData.defaultOrderType = defaultOrderType || null

    // Handle PIN change
    if (pin) {
      if (!/^\d{4,6}$/.test(pin)) {
        return NextResponse.json(
          { error: 'PIN must be 4-6 digits' },
          { status: 400 }
        )
      }
      updateData.pin = await hashPin(pin)
      updateData.requiresPinChange = false // Clear forced change after explicit update
    }

    // Handle role change
    if (roleId) {
      const role = await db.role.findFirst({
        where: {
          id: roleId,
          locationId: existing.locationId,
        },
      })

      if (!role) {
        return NextResponse.json(
          { error: 'Role not found' },
          { status: 404 }
        )
      }
      updateData.roleId = roleId
    }

    await EmployeeRepository.updateEmployee(id, locationId, updateData as any)

    // Clear permission cache if role changed — takes effect immediately
    if (roleId) {
      clearPermissionCache(id)
    }

    const employee = await EmployeeRepository.getEmployeeByIdWithInclude(id, locationId, {
      role: {
        select: {
          id: true,
          name: true,
          permissions: true,
        },
      },
    })

    if (!employee) {
      return NextResponse.json({ error: 'Employee not found after update' }, { status: 404 })
    }

    // Sync EmployeeRole junction table (multi-role support)
    if (additionalRoleIds !== undefined) {
      const effectiveRoleId = roleId || existing.roleId
      const allDesiredRoleIds = [...new Set([effectiveRoleId, ...additionalRoleIds])]

      // Soft-delete roles no longer assigned
      await db.employeeRole.updateMany({
        where: {
          employeeId: id,
          roleId: { notIn: allDesiredRoleIds },
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      })

      // Upsert desired roles (creates new or restores soft-deleted)
      for (const rId of allDesiredRoleIds) {
        await db.employeeRole.upsert({
          where: { employeeId_roleId: { employeeId: id, roleId: rId } },
          create: {
            locationId: existing.locationId,
            employeeId: id,
            roleId: rId,
            isPrimary: rId === effectiveRoleId,
          },
          update: {
            deletedAt: null,
            isPrimary: rId === effectiveRoleId,
          },
        })
      }
    }

    // Notify cloud → NUC sync
    void notifyDataChanged({ locationId: existing.locationId, domain: 'employees', action: 'updated', entityId: id })

    // Real-time cross-terminal update
    void emitToLocation(existing.locationId, 'employees:changed', { action: 'updated', employeeId: id }).catch(() => {})
    // Also emit employee:updated for Android/PAX devices
    void emitToLocation(existing.locationId, 'employee:updated', { action: 'updated', employeeId: id }).catch(() => {})
    // Force logout if employee was deactivated via PUT
    if (isActive === false) {
      void emitToLocation(existing.locationId, 'employee:deactivated', { employeeId: id }).catch(console.error)

      // Remove deactivated employee from any active tip groups so tips stop allocating to them
      try {
        const activeMemberships = await db.tipGroupMembership.findMany({
          where: { employeeId: id, status: 'active', group: { status: 'active' } },
          select: { groupId: true },
        })
        for (const mem of activeMemberships) {
          try {
            await removeMemberFromGroup({ groupId: mem.groupId, employeeId: id })
          } catch (e) {
            console.error(`[employee] Failed to remove from tip group ${mem.groupId}:`, e)
          }
        }
      } catch (e) {
        console.error('[employee] Failed to query tip group memberships:', e)
      }
    }

    return NextResponse.json({ data: {
      id: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      displayName: employee.displayName || `${employee.firstName} ${employee.lastName.charAt(0)}.`,
      email: employee.email,
      phone: employee.phone,
      role: {
        id: employee.role.id,
        name: employee.role.name,
        permissions: employee.role.permissions as string[],
      },
      hourlyRate: employee.hourlyRate ? Number(employee.hourlyRate) : null,
      hireDate: employee.hireDate?.toISOString() || null,
      isActive: employee.isActive,
      color: employee.color,
      defaultScreen: employee.defaultScreen,
      defaultOrderType: employee.defaultOrderType,
      updatedAt: employee.updatedAt.toISOString(),
    } })
  } catch (error) {
    console.error('Failed to update employee:', error)
    return NextResponse.json(
      { error: 'Failed to update employee' },
      { status: 500 }
    )
  }
})

// DELETE - Deactivate employee (soft delete)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Auth check — require staff.edit_profile permission (unconditional)
    const { searchParams } = new URL(request.url)
    const requestingEmployeeId = searchParams.get('requestingEmployeeId')
    const locationId = searchParams.get('locationId') || await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'Location required' }, { status: 400 })
    }
    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.STAFF_EDIT_PROFILE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const employee = await EmployeeRepository.getEmployeeById(id, locationId)

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      )
    }

    // Check for open orders (all active statuses, not just open/pending)
    // TODO: Add OrderRepository.countOpenOrdersForEmployee() for tenant-safe count
    const openOrders = await db.order.count({
      where: {
        employeeId: id,
        status: { in: ['draft', 'open', 'sent', 'in_progress', 'split', 'pending'] },
      },
    })

    if (openOrders > 0) {
      return NextResponse.json(
        { error: `Cannot deactivate employee with ${openOrders} open order(s). Close or transfer orders first.` },
        { status: 400 }
      )
    }

    // Soft delete - just deactivate (tenant-scoped)
    await EmployeeRepository.deactivateEmployee(id, locationId)

    // Notify cloud → NUC sync
    void notifyDataChanged({ locationId: employee.locationId, domain: 'employees', action: 'deleted', entityId: id })

    // Real-time cross-terminal update
    void emitToLocation(employee.locationId, 'employees:changed', { action: 'deleted', employeeId: id }).catch(() => {})
    // Also emit employee:updated for Android/PAX devices
    void emitToLocation(employee.locationId, 'employee:updated', { action: 'deleted', employeeId: id }).catch(() => {})
    // Force logout deactivated employee on all terminals
    void emitToLocation(employee.locationId, 'employee:deactivated', { employeeId: id }).catch(console.error)

    // Remove deactivated employee from any active tip groups so tips stop allocating to them
    try {
      const activeMemberships = await db.tipGroupMembership.findMany({
        where: { employeeId: id, status: 'active', group: { status: 'active' } },
        select: { groupId: true },
      })
      for (const mem of activeMemberships) {
        try {
          await removeMemberFromGroup({ groupId: mem.groupId, employeeId: id })
        } catch (e) {
          console.error(`[employee] Failed to remove from tip group ${mem.groupId}:`, e)
        }
      }
    } catch (e) {
      console.error('[employee] Failed to query tip group memberships:', e)
    }

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to deactivate employee:', error)
    return NextResponse.json(
      { error: 'Failed to deactivate employee' },
      { status: 500 }
    )
  }
})
