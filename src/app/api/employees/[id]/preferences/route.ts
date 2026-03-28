import { NextRequest } from 'next/server'
import * as EmployeeRepository from '@/lib/repositories/employee-repository'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { err, forbidden, notFound, ok } from '@/lib/api-response'

// GET - Get employee's preferences including room order
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return err('Location required')
    }

    const employee = await EmployeeRepository.getEmployeeByIdWithSelect(id, locationId, {
      id: true,
      preferredRoomOrder: true,
    })

    if (!employee) {
      return notFound('Employee not found')
    }

    // Parse room order JSON
    let roomOrder: string[] = []
    if (employee.preferredRoomOrder) {
      try {
        roomOrder = JSON.parse(employee.preferredRoomOrder)
      } catch {
        roomOrder = []
      }
    }

    return ok({
      preferences: {
        preferredRoomOrder: roomOrder,
      },
    })
  } catch (error) {
    console.error('Failed to get employee preferences:', error)
    return err('Failed to get preferences', 500)
  }
})

// PUT - Update employee's room order preference
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { preferredRoomOrder } = body as { preferredRoomOrder: string[] }

    const locationId = await getLocationId()
    if (!locationId) {
      return err('Location required')
    }

    // Auth check — require POS access and verify employee is editing their own record
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? id
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return err(auth.error, auth.status)
    if (auth.employee.id !== id) {
      return forbidden('You can only edit your own preferences')
    }

    // Verify employee exists (tenant-scoped)
    const employee = await EmployeeRepository.checkEmployeeExists(id, locationId)

    if (!employee) {
      return notFound('Employee not found')
    }

    // Validate input
    if (!Array.isArray(preferredRoomOrder)) {
      return err('preferredRoomOrder must be an array of room IDs')
    }

    // Update employee (tenant-scoped)
    await EmployeeRepository.updateEmployee(id, locationId, {
      preferredRoomOrder: JSON.stringify(preferredRoomOrder),
    })

    return ok({
      success: true,
      preferences: {
        preferredRoomOrder,
      },
    })
  } catch (error) {
    console.error('Failed to update employee preferences:', error)
    return err('Failed to update preferences', 500)
  }
})

// DELETE - Reset employee's room order preference
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return err('Location required')
    }

    await EmployeeRepository.updateEmployee(id, locationId, {
      preferredRoomOrder: null,
    })

    return ok({
      success: true,
      preferences: {
        preferredRoomOrder: [],
      },
    })
  } catch (error) {
    console.error('Failed to reset employee preferences:', error)
    return err('Failed to reset preferences', 500)
  }
})
