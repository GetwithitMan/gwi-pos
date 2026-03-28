import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getActorFromRequest } from '@/lib/api-auth'
import { dispatchShiftRequestUpdate } from '@/lib/socket-dispatch'
import { Prisma } from '@/generated/prisma/client'
import type { ShiftRequestType, ShiftSwapRequestStatus } from '@/generated/prisma/client'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { created, err, forbidden, notFound, ok, unauthorized } from '@/lib/api-response'
const log = createChildLogger('shift-requests')

// GET - List shift requests for a location
// Unified endpoint for managers and employees.
// Query params: locationId (required), status?, type? (swap|cover|drop),
//   employeeId? (filter by requestedByEmployeeId OR requestedToEmployeeId)
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status')
    const type = searchParams.get('type')
    const employeeId = searchParams.get('employeeId')

    if (!locationId) {
      return err('Location ID is required')
    }

    const where: Prisma.ShiftSwapRequestWhereInput = {
      locationId,
      deletedAt: null,
    }

    if (status) {
      where.status = status as ShiftSwapRequestStatus
    }

    if (type) {
      where.type = type as ShiftRequestType
    }

    if (employeeId) {
      where.OR = [
        { requestedByEmployeeId: employeeId },
        { requestedToEmployeeId: employeeId },
      ]
    }

    const requests = await db.shiftSwapRequest.findMany({
      where,
      include: {
        shift: {
          select: {
            id: true,
            date: true,
            startTime: true,
            endTime: true,
            status: true,
            schedule: {
              select: {
                id: true,
                weekStart: true,
                status: true,
              },
            },
          },
        },
        requestedByEmployee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
        requestedToEmployee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
        approvedByEmployee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return ok({ requests })
  } catch (error) {
    console.error('Failed to fetch shift requests:', error)
    return err('Failed to fetch shift requests', 500)
  }
})

// POST - Create a new shift request (swap, cover, or drop)
// Body: { locationId, shiftId, type, requestedByEmployeeId, requestedToEmployeeId?, reason?, notes?, expiresInDays? }
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      shiftId,
      type = 'swap',
      requestedByEmployeeId: bodyEmployeeId,
      requestedToEmployeeId,
      reason,
      notes,
      expiresInDays = 7,
    } = body as {
      locationId: string
      shiftId: string
      type?: ShiftRequestType
      requestedByEmployeeId?: string
      requestedToEmployeeId?: string
      reason?: string
      notes?: string
      expiresInDays?: number
    }

    if (!locationId) {
      return err('Location ID is required')
    }
    if (!shiftId) {
      return err('shiftId is required')
    }

    // Resolve actor
    const actor = await getActorFromRequest(request)
    const requestedByEmployeeId = bodyEmployeeId ?? actor.employeeId
    if (!requestedByEmployeeId) {
      return unauthorized('Employee ID is required')
    }

    // Validate type
    if (!['swap', 'cover', 'drop'].includes(type)) {
      return err('type must be swap, cover, or drop')
    }

    if (type === 'drop' && requestedToEmployeeId) {
      return err('Drop requests cannot have a target employee')
    }

    // Validate shift
    const shift = await db.scheduledShift.findUnique({ where: { id: shiftId } })
    if (!shift) {
      return notFound('Shift not found')
    }
    if (shift.locationId !== locationId) {
      return forbidden('Shift does not belong to this location')
    }
    if (shift.deletedAt !== null) {
      return notFound('Shift has been deleted')
    }

    // Check no active request already exists for this shift
    const existing = await db.shiftSwapRequest.findFirst({
      where: {
        shiftId,
        locationId,
        status: { in: ['pending', 'accepted'] },
        deletedAt: null,
      },
    })
    if (existing) {
      return err('An active request already exists for this shift', 409)
    }

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + expiresInDays)

    const created = await db.shiftSwapRequest.create({
      data: {
        locationId,
        shiftId,
        requestedByEmployeeId,
        requestedToEmployeeId: requestedToEmployeeId || null,
        type,
        reason: reason || null,
        notes: notes || null,
        status: 'pending',
        expiresAt,
        lastMutatedBy: 'cloud',
      },
      include: {
        shift: {
          select: {
            id: true,
            date: true,
            startTime: true,
            endTime: true,
            status: true,
          },
        },
        requestedByEmployee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
        requestedToEmployee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
      },
    })

    pushUpstream()

    // Socket event
    void dispatchShiftRequestUpdate(locationId, {
      action: 'created',
      requestId: created.id,
      type,
      requestedByEmployeeId,
      requestedToEmployeeId: requestedToEmployeeId || null,
      shiftId,
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

    return created({ request: created })
  } catch (error) {
    console.error('Failed to create shift request:', error)
    return err('Failed to create shift request', 500)
  }
})
