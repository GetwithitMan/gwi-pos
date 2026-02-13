import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { compare } from 'bcryptjs'
import { withVenue } from '@/lib/with-venue'

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const { pin, locationId } = await request.json()

    if (!pin || pin.length < 4) {
      return NextResponse.json(
        { error: 'PIN must be at least 4 digits' },
        { status: 400 }
      )
    }

    // Build query filter - scope by location if provided for better performance
    // Note: PINs are hashed so we must compare each one (can't query directly)
    const whereClause: { isActive: boolean; locationId?: string } = { isActive: true }
    if (locationId) {
      whereClause.locationId = locationId
    }

    // Get active employees (scoped by location if provided)
    const employees = await db.employee.findMany({
      where: whereClause,
      include: {
        role: true,
        location: true,
      }
    })

    // Find employee with matching PIN
    let matchedEmployee = null
    for (const employee of employees) {
      const pinMatch = await compare(pin, employee.pin)
      if (pinMatch) {
        matchedEmployee = employee
        break
      }
    }

    if (!matchedEmployee) {
      return NextResponse.json(
        { error: 'Invalid PIN' },
        { status: 401 }
      )
    }

    // Fetch available roles from EmployeeRole junction table
    const employeeRoles = await db.employeeRole.findMany({
      where: {
        employeeId: matchedEmployee.id,
        deletedAt: null,
      },
      include: {
        role: {
          select: {
            id: true,
            name: true,
            cashHandlingMode: true,
          },
        },
      },
      orderBy: { isPrimary: 'desc' }, // Primary role first
    })

    const availableRoles = employeeRoles.map(er => ({
      id: er.role.id,
      name: er.role.name,
      cashHandlingMode: er.role.cashHandlingMode,
      isPrimary: er.isPrimary,
    }))

    // Log the login
    await db.auditLog.create({
      data: {
        locationId: matchedEmployee.locationId,
        employeeId: matchedEmployee.id,
        action: 'login',
        entityType: 'employee',
        entityId: matchedEmployee.id,
      },
    })

    // Handle permissions - convert old object format to array if needed
    let permissions: string[] = []
    const rawPermissions = matchedEmployee.role.permissions

    if (Array.isArray(rawPermissions)) {
      // New format: already an array of permission strings
      permissions = rawPermissions as string[]
    } else if (rawPermissions && typeof rawPermissions === 'object') {
      // Old format: object like {orders: ['create', 'read'], menu: ['read']}
      // Convert to flat array for backwards compatibility, but also grant admin access for managers
      if (matchedEmployee.role.name === 'Manager' || matchedEmployee.role.name === 'Owner') {
        permissions = ['admin'] // Give full access to old manager roles
      }
    }

    // Check for dev access (Super Admin or has dev.access permission)
    const isDevAccess = permissions.includes('all') || permissions.includes('dev.access')

    return NextResponse.json({
      employee: {
        id: matchedEmployee.id,
        firstName: matchedEmployee.firstName,
        lastName: matchedEmployee.lastName,
        displayName: matchedEmployee.displayName || `${matchedEmployee.firstName} ${matchedEmployee.lastName.charAt(0)}.`,
        role: {
          id: matchedEmployee.role.id,
          name: matchedEmployee.role.name,
        },
        location: {
          id: matchedEmployee.location.id,
          name: matchedEmployee.location.name,
        },
        defaultScreen: matchedEmployee.defaultScreen || null,
        permissions,
        isDevAccess,
        availableRoles,
      },
    })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
})
