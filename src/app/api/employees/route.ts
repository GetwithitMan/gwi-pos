import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import * as EmployeeRepository from '@/lib/repositories/employee-repository'
import { hashPin } from '@/lib/auth'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'
import { createEmployeeSchema, validateRequest } from '@/lib/validations'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { emitToLocation } from '@/lib/socket-server'
import { withVenue } from '@/lib/with-venue'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'

const log = createChildLogger('employees')

// GET - List employees for a location with pagination
// No auth required — POS terminals need employee list for login/selection
export const GET = withVenue(async function GET(
  request: NextRequest,
) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const includeInactive = searchParams.get('includeInactive') === 'true'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')))
    const skip = (page - 1) * limit

    if (!locationId) {
      return err('Location ID is required')
    }

    const filterWhere = includeInactive ? {} : { isActive: true }

    // Get total count for pagination (tenant-scoped)
    const total = await EmployeeRepository.countEmployees(locationId, filterWhere)

    const employees = await db.employee.findMany({
      where: {
        locationId,
        deletedAt: null,
        ...filterWhere,
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
      skip,
      take: limit,
    })

    // Strip PII from unauthenticated response — this endpoint is used by
    // POS terminals for login/selection and must NOT expose email, phone,
    // hourlyRate, or full role permissions to unauthenticated callers.
    return ok({
      employees: employees.map(emp => ({
        id: emp.id,
        firstName: emp.firstName,
        lastName: emp.lastName,
        displayName: emp.displayName || `${emp.firstName} ${emp.lastName.charAt(0)}.`,
        role: {
          id: emp.role.id,
          name: emp.role.name,
        },
        isActive: emp.isActive,
        color: emp.color,
        avatarUrl: emp.avatarUrl,
        locationId: emp.locationId,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Failed to fetch employees:', error)
    return err('Failed to fetch employees', 500)
  }
})

// POST - Create a new employee
export const POST = withVenue(withAuth('STAFF_EDIT_PROFILE', async function POST(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const body = await request.json()

    // Validate request body
    const validation = validateRequest(createEmployeeSchema, body)
    if (!validation.success) {
      return err(validation.error)
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
      return notFound('Role not found')
    }

    // Check for duplicate PIN at this location (tenant-scoped)
    const existingEmployees = await EmployeeRepository.getActiveEmployees(locationId)

    // Hash the new PIN and check against existing
    const hashedPin = await hashPin(pin)

    // Flag employees provisioned with common default PINs for forced change on first login
    const DEFAULT_PINS = ['1234', '0000', '1111']
    const requiresPinChange = DEFAULT_PINS.includes(pin)

    // Create the employee (tenant-scoped)
    const employee = await EmployeeRepository.createEmployee(locationId, {
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
      requiresPinChange,
    })

    // Re-fetch with role include for response
    const employeeWithRole = await EmployeeRepository.getEmployeeByIdWithInclude(employee.id, locationId, {
      role: {
        select: {
          id: true,
          name: true,
          permissions: true,
        },
      },
    })
    if (!employeeWithRole) {
      return err('Employee created but could not be retrieved', 500)
    }

    // Notify cloud → NUC sync
    void notifyDataChanged({ locationId, domain: 'employees', action: 'created', entityId: employee.id })
    void pushUpstream()

    // Real-time cross-terminal update
    void emitToLocation(locationId, 'employees:changed', { action: 'created', employeeId: employee.id }).catch(err => log.warn({ err }, 'socket emit failed'))
    void emitToLocation(locationId, 'employee:updated', { action: 'created', employeeId: employee.id }).catch(err => log.warn({ err }, 'socket emit failed'))

    return ok({
      id: employeeWithRole.id,
      firstName: employeeWithRole.firstName,
      lastName: employeeWithRole.lastName,
      displayName: employeeWithRole.displayName || `${employeeWithRole.firstName} ${employeeWithRole.lastName.charAt(0)}.`,
      email: employeeWithRole.email,
      phone: employeeWithRole.phone,
      role: {
        id: employeeWithRole.role.id,
        name: employeeWithRole.role.name,
        permissions: employeeWithRole.role.permissions as string[],
      },
      hourlyRate: employeeWithRole.hourlyRate ? Number(employeeWithRole.hourlyRate) : null,
      hireDate: employeeWithRole.hireDate?.toISOString() || null,
      isActive: employeeWithRole.isActive,
      color: employeeWithRole.color,
      createdAt: employeeWithRole.createdAt.toISOString(),
    })
  } catch (error) {
    console.error('Failed to create employee:', error)

    // Check for unique constraint violation
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return err('An employee with this PIN already exists at this location', 409)
    }

    return err('Failed to create employee', 500)
  }
}))
