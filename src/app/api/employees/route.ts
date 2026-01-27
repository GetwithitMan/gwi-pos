import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPin } from '@/lib/auth'

// GET - List all employees for a location
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const includeInactive = searchParams.get('includeInactive') === 'true'

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const employees = await db.employee.findMany({
      where: {
        locationId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      include: {
        role: {
          select: {
            id: true,
            name: true,
            permissions: true,
          },
        },
      },
      orderBy: [
        { isActive: 'desc' },
        { firstName: 'asc' },
      ],
    })

    return NextResponse.json({
      employees: employees.map(emp => ({
        id: emp.id,
        firstName: emp.firstName,
        lastName: emp.lastName,
        displayName: emp.displayName || `${emp.firstName} ${emp.lastName.charAt(0)}.`,
        email: emp.email,
        phone: emp.phone,
        role: {
          id: emp.role.id,
          name: emp.role.name,
          permissions: emp.role.permissions as string[],
        },
        hourlyRate: emp.hourlyRate ? Number(emp.hourlyRate) : null,
        hireDate: emp.hireDate?.toISOString() || null,
        isActive: emp.isActive,
        color: emp.color,
        avatarUrl: emp.avatarUrl,
        createdAt: emp.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('Failed to fetch employees:', error)
    return NextResponse.json(
      { error: 'Failed to fetch employees' },
      { status: 500 }
    )
  }
}

// POST - Create a new employee
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
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
    } = body as {
      locationId: string
      firstName: string
      lastName: string
      displayName?: string
      email?: string
      phone?: string
      pin: string
      roleId: string
      hourlyRate?: number
      hireDate?: string
      color?: string
    }

    // Validate required fields
    if (!locationId || !firstName || !lastName || !pin || !roleId) {
      return NextResponse.json(
        { error: 'Location ID, first name, last name, PIN, and role are required' },
        { status: 400 }
      )
    }

    // Validate PIN format (4-6 digits)
    if (!/^\d{4,6}$/.test(pin)) {
      return NextResponse.json(
        { error: 'PIN must be 4-6 digits' },
        { status: 400 }
      )
    }

    // Check if role exists and belongs to location
    const role = await db.role.findFirst({
      where: {
        id: roleId,
        locationId,
      },
    })

    if (!role) {
      return NextResponse.json(
        { error: 'Role not found' },
        { status: 404 }
      )
    }

    // Check for duplicate PIN at this location
    const existingEmployees = await db.employee.findMany({
      where: {
        locationId,
        isActive: true,
      },
    })

    // Hash the new PIN and check against existing
    const hashedPin = await hashPin(pin)

    // Create the employee
    const employee = await db.employee.create({
      data: {
        locationId,
        firstName,
        lastName,
        displayName: displayName || null,
        email: email || null,
        phone: phone || null,
        pin: hashedPin,
        roleId,
        hourlyRate: hourlyRate || null,
        hireDate: hireDate ? new Date(hireDate) : undefined,
        color: color || null,
        isActive: true,
      },
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

    return NextResponse.json({
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
      createdAt: employee.createdAt.toISOString(),
    })
  } catch (error) {
    console.error('Failed to create employee:', error)

    // Check for unique constraint violation
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'An employee with this PIN already exists at this location' },
        { status: 409 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to create employee' },
      { status: 500 }
    )
  }
}
