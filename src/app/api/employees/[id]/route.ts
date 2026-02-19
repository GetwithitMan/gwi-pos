import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPin, PERMISSIONS } from '@/lib/auth'
import { requirePermission } from '@/lib/api-auth'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { emitToLocation } from '@/lib/socket-server'
import { withVenue } from '@/lib/with-venue'

// GET - Get employee details
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const employee = await db.employee.findUnique({
      where: { id },
      include: {
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
      },
    })

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      )
    }

    // Get summary stats
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

    // Auth check — require staff.edit_profile permission
    const auth = await requirePermission(body.requestingEmployeeId, body.locationId, PERMISSIONS.STAFF_EDIT_PROFILE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

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

    // Check employee exists
    const existing = await db.employee.findUnique({
      where: { id },
    })

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

    const employee = await db.employee.update({
      where: { id },
      data: updateData,
      include: {
        role: {
          select: {
            id: true,
            name: true,
            permissions: true,
          },
        },
      },
    })

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

    // Auth check — require staff.edit_profile permission
    const { searchParams } = new URL(request.url)
    const requestingEmployeeId = searchParams.get('requestingEmployeeId')
    const locationId = searchParams.get('locationId')
    if (locationId) {
      const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.STAFF_EDIT_PROFILE)
      if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const employee = await db.employee.findUnique({
      where: { id },
    })

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      )
    }

    // Check for open orders
    const openOrders = await db.order.count({
      where: {
        employeeId: id,
        status: { in: ['open', 'pending'] },
      },
    })

    if (openOrders > 0) {
      return NextResponse.json(
        { error: `Cannot deactivate employee with ${openOrders} open order(s). Close or transfer orders first.` },
        { status: 400 }
      )
    }

    // Soft delete - just deactivate
    await db.employee.update({
      where: { id },
      data: { isActive: false },
    })

    // Notify cloud → NUC sync
    void notifyDataChanged({ locationId: employee.locationId, domain: 'employees', action: 'deleted', entityId: id })

    // Real-time cross-terminal update
    void emitToLocation(employee.locationId, 'employees:changed', { action: 'deleted', employeeId: id }).catch(() => {})

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to deactivate employee:', error)
    return NextResponse.json(
      { error: 'Failed to deactivate employee' },
      { status: 500 }
    )
  }
})
