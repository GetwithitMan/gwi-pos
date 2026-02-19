import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPin, PERMISSIONS } from '@/lib/auth'
import { requirePermission } from '@/lib/api-auth'
import { createEmployeeSchema, validateRequest } from '@/lib/validations'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { emitToLocation } from '@/lib/socket-server'
import { withVenue } from '@/lib/with-venue'

// GET - List employees for a location with pagination
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const includeInactive = searchParams.get('includeInactive') === 'true'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')))
    const skip = (page - 1) * limit

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const where = {
      locationId,
      ...(includeInactive ? {} : { isActive: true }),
    }

    // Get total count for pagination
    const total = await db.employee.count({ where })

    const employees = await db.employee.findMany({
      where,
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
      skip,
      take: limit,
    })

    return NextResponse.json({ data: {
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
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    } })
  } catch (error) {
    console.error('Failed to fetch employees:', error)
    return NextResponse.json(
      { error: 'Failed to fetch employees' },
      { status: 500 }
    )
  }
})

// POST - Create a new employee
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Auth check — require staff.edit_profile permission
    const auth = await requirePermission(body.requestingEmployeeId, body.locationId, PERMISSIONS.STAFF_EDIT_PROFILE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Validate request body
    const validation = validateRequest(createEmployeeSchema, body)
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      )
    }

    const { locationId, firstName, lastName, displayName, email, phone, pin, roleId, hourlyRate, hireDate, color } = validation.data

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

    // Notify cloud → NUC sync
    void notifyDataChanged({ locationId, domain: 'employees', action: 'created', entityId: employee.id })

    // Real-time cross-terminal update
    void emitToLocation(locationId, 'employees:changed', { action: 'created', employeeId: employee.id }).catch(() => {})

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
      createdAt: employee.createdAt.toISOString(),
    } })
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
})
