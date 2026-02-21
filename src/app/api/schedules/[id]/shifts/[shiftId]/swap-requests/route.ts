import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - List swap requests for a specific shift
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; shiftId: string }> }
) {
  try {
    const { shiftId } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
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

    return NextResponse.json({ data: { requests } })
  } catch (error) {
    console.error('Failed to fetch swap requests:', error)
    return NextResponse.json({ error: 'Failed to fetch swap requests' }, { status: 500 })
  }
})

// POST - Create a new swap request for a shift
export const POST = withVenue(async function POST(
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
      notes,
      expiresInDays = 7,
    } = body as {
      locationId: string
      requestedByEmployeeId: string
      requestedToEmployeeId?: string
      notes?: string
      expiresInDays?: number
    }

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    if (!requestedByEmployeeId) {
      return NextResponse.json({ error: 'requestedByEmployeeId is required' }, { status: 400 })
    }

    // Validate shift exists, belongs to this location and schedule, and is not deleted
    const shift = await db.scheduledShift.findUnique({ where: { id: shiftId } })
    if (!shift) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
    }
    if (shift.locationId !== locationId) {
      return NextResponse.json({ error: 'Shift does not belong to this location' }, { status: 403 })
    }
    if (shift.scheduleId !== scheduleId) {
      return NextResponse.json({ error: 'Shift does not belong to this schedule' }, { status: 400 })
    }
    if (shift.deletedAt !== null) {
      return NextResponse.json({ error: 'Shift has been deleted' }, { status: 404 })
    }

    // Validate no active swap request already exists for this shift
    const existingRequest = await db.shiftSwapRequest.findFirst({
      where: {
        shiftId,
        locationId,
        status: { in: ['pending', 'accepted'] },
        deletedAt: null,
      },
    })
    if (existingRequest) {
      return NextResponse.json(
        { error: 'An active swap request already exists for this shift' },
        { status: 409 }
      )
    }

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + expiresInDays)

    const swapRequest = await db.shiftSwapRequest.create({
      data: {
        locationId,
        shiftId,
        requestedByEmployeeId,
        requestedToEmployeeId: requestedToEmployeeId || null,
        notes: notes || null,
        status: 'pending',
        expiresAt,
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

    return NextResponse.json({ data: { request: swapRequest } }, { status: 201 })
  } catch (error) {
    console.error('Failed to create swap request:', error)
    return NextResponse.json({ error: 'Failed to create swap request' }, { status: 500 })
  }
})
