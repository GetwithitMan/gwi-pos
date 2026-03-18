import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { dispatchShiftRequestUpdate } from '@/lib/socket-dispatch'
import { Prisma } from '@/generated/prisma/client'
import type { ShiftRequestType, ShiftSwapRequestStatus } from '@/generated/prisma/client'

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
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
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

    return NextResponse.json({ data: { requests } })
  } catch (error) {
    console.error('Failed to fetch shift requests:', error)
    return NextResponse.json({ error: 'Failed to fetch shift requests' }, { status: 500 })
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
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }
    if (!shiftId) {
      return NextResponse.json({ error: 'shiftId is required' }, { status: 400 })
    }

    // Resolve actor
    const actor = await getActorFromRequest(request)
    const requestedByEmployeeId = bodyEmployeeId ?? actor.employeeId
    if (!requestedByEmployeeId) {
      return NextResponse.json({ error: 'Employee ID is required' }, { status: 401 })
    }

    // Validate type
    if (!['swap', 'cover', 'drop'].includes(type)) {
      return NextResponse.json({ error: 'type must be swap, cover, or drop' }, { status: 400 })
    }

    if (type === 'drop' && requestedToEmployeeId) {
      return NextResponse.json({ error: 'Drop requests cannot have a target employee' }, { status: 400 })
    }

    // Validate shift
    const shift = await db.scheduledShift.findUnique({ where: { id: shiftId } })
    if (!shift) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
    }
    if (shift.locationId !== locationId) {
      return NextResponse.json({ error: 'Shift does not belong to this location' }, { status: 403 })
    }
    if (shift.deletedAt !== null) {
      return NextResponse.json({ error: 'Shift has been deleted' }, { status: 404 })
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
      return NextResponse.json(
        { error: 'An active request already exists for this shift' },
        { status: 409 }
      )
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

    // Socket event
    void dispatchShiftRequestUpdate(locationId, {
      action: 'created',
      requestId: created.id,
      type,
      requestedByEmployeeId,
      requestedToEmployeeId: requestedToEmployeeId || null,
      shiftId,
    }, { async: true }).catch(console.error)

    return NextResponse.json({ data: { request: created } }, { status: 201 })
  } catch (error) {
    console.error('Failed to create shift request:', error)
    return NextResponse.json({ error: 'Failed to create shift request' }, { status: 500 })
  }
})
