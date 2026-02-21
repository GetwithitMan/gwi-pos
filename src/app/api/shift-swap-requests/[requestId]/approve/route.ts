import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// POST - Manager approves swap (EXECUTES the swap)
// Body: { locationId: string, approvedByEmployeeId: string }
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params
    const body = await request.json()
    const { locationId, approvedByEmployeeId } = body as {
      locationId: string
      approvedByEmployeeId: string
    }

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    if (!approvedByEmployeeId) {
      return NextResponse.json({ error: 'approvedByEmployeeId is required' }, { status: 400 })
    }

    const swapRequest = await db.shiftSwapRequest.findUnique({
      where: { id: requestId },
    })

    if (!swapRequest) {
      return NextResponse.json({ error: 'Swap request not found' }, { status: 404 })
    }

    if (swapRequest.locationId !== locationId) {
      return NextResponse.json({ error: 'Swap request does not belong to this location' }, { status: 403 })
    }

    if (swapRequest.deletedAt !== null) {
      return NextResponse.json({ error: 'Swap request has been cancelled' }, { status: 404 })
    }

    if (swapRequest.status !== 'accepted') {
      return NextResponse.json(
        { error: `Cannot approve a swap request with status '${swapRequest.status}'. Employee must accept first.` },
        { status: 400 }
      )
    }

    if (!swapRequest.requestedToEmployeeId) {
      return NextResponse.json(
        { error: 'Cannot approve: no target employee assigned to this swap request' },
        { status: 400 }
      )
    }

    const now = new Date()

    // Execute the swap in a transaction
    const [updatedRequest, updatedShift] = await db.$transaction([
      // 1. Mark the swap request as approved
      db.shiftSwapRequest.update({
        where: { id: requestId },
        data: {
          status: 'approved',
          approvedAt: now,
          approvedByEmployeeId,
        },
      }),
      // 2. Reassign the shift to the new employee
      db.scheduledShift.update({
        where: { id: swapRequest.shiftId },
        data: {
          employeeId: swapRequest.requestedToEmployeeId!,
          originalEmployeeId: swapRequest.requestedByEmployeeId,
          swappedAt: now,
          swapApprovedBy: approvedByEmployeeId,
        },
      }),
    ])

    // 3. Cancel any other pending requests for the same shift (fire after transaction)
    await db.shiftSwapRequest.updateMany({
      where: {
        shiftId: swapRequest.shiftId,
        status: { in: ['pending'] },
        id: { not: requestId },
        deletedAt: null,
      },
      data: { status: 'cancelled' },
    })

    return NextResponse.json({ data: { request: updatedRequest, shift: updatedShift } })
  } catch (error) {
    console.error('Failed to approve swap request:', error)
    return NextResponse.json({ error: 'Failed to approve swap request' }, { status: 500 })
  }
})
