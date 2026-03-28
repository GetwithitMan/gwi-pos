import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { dispatchShiftRequestUpdate } from '@/lib/socket-dispatch'
import type { ShiftRequestType } from '@/generated/prisma/client'
import { createChildLogger } from '@/lib/logger'
import { created, err, forbidden, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('schedules-swap-requests')

// GET - List swap/cover/drop requests for a specific shift
export const GET = withVenue(withAuth('ADMIN', async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; shiftId: string }> }
) {
  try {
    const { shiftId } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('Location ID is required')
    }

    const requests = await db.shiftSwapRequest.findMany({
      where: {
        shiftId,
        locationId,
        deletedAt: null,
      },
      include: {
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
      orderBy: { createdAt: 'desc' },
    })

    return ok({ requests })
  } catch (error) {
    console.error('Failed to fetch swap requests:', error)
    return err('Failed to fetch swap requests', 500)
  }
}))

// POST - Create a new shift request (swap, cover, or drop)
export const POST = withVenue(withAuth('ADMIN', async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; shiftId: string }> }
) {
  try {
    const { id: scheduleId, shiftId } = await params
    const body = await request.json()
    const {
      locationId,
      requestedByEmployeeId,
      requestedToEmployeeId,
      type = 'swap',
      reason,
      notes,
      expiresInDays = 7,
    } = body as {
      locationId: string
      requestedByEmployeeId: string
      requestedToEmployeeId?: string
      type?: ShiftRequestType
      reason?: string
      notes?: string
      expiresInDays?: number
    }

    if (!locationId) {
      return err('Location ID is required')
    }

    if (!requestedByEmployeeId) {
      return err('requestedByEmployeeId is required')
    }

    // Validate type
    if (!['swap', 'cover', 'drop'].includes(type)) {
      return err('type must be swap, cover, or drop')
    }

    // Drop requests can't have a target employee
    if (type === 'drop' && requestedToEmployeeId) {
      return err('Drop requests cannot have a target employee')
    }

    // Validate shift exists, belongs to this location and schedule, and is not deleted
    const shift = await db.scheduledShift.findUnique({ where: { id: shiftId } })
    if (!shift) {
      return notFound('Shift not found')
    }
    if (shift.locationId !== locationId) {
      return forbidden('Shift does not belong to this location')
    }
    if (shift.scheduleId !== scheduleId) {
      return err('Shift does not belong to this schedule')
    }
    if (shift.deletedAt !== null) {
      return notFound('Shift has been deleted')
    }

    // Validate no active request already exists for this shift
    const existingRequest = await db.shiftSwapRequest.findFirst({
      where: {
        shiftId,
        locationId,
        status: { in: ['pending', 'accepted'] },
        deletedAt: null,
      },
    })
    if (existingRequest) {
      return err('An active request already exists for this shift', 409)
    }

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + expiresInDays)

    const swapRequest = await db.shiftSwapRequest.create({
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

    // Dispatch socket event for real-time updates
    void dispatchShiftRequestUpdate(locationId, {
      action: 'created',
      requestId: swapRequest.id,
      type,
      requestedByEmployeeId,
      requestedToEmployeeId: requestedToEmployeeId || null,
      shiftId,
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

    return created({ request: swapRequest })
  } catch (error) {
    console.error('Failed to create shift request:', error)
    return err('Failed to create shift request', 500)
  }
}))
