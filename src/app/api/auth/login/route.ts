import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { compare } from 'bcryptjs'

export async function POST(request: NextRequest) {
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
        permissions: matchedEmployee.role.permissions as string[],
      },
    })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
