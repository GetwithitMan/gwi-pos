import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { dispatchShiftRequestUpdate } from '@/lib/socket-dispatch'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { queueIfOutageOrFail, OutageQueueFullError } from '@/lib/sync/outage-safe-write'

// POST - Manager approves a shift request (swap, cover, or drop)
// For swaps: reassigns shift to target employee
// For covers: reassigns shift to target employee (who claimed the open request)
// For drops: marks shift as called_off
// Body: { locationId: string, approvedByEmployeeId: string, managerNote?: string }
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params
    const body = await request.json()
    const { locationId, approvedByEmployeeId, managerNote } = body as {
      locationId: string
      approvedByEmployeeId: string
      managerNote?: string
    }

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    if (!approvedByEmployeeId) {
      return NextResponse.json({ error: 'approvedByEmployeeId is required' }, { status: 400 })
    }

    // Auth check — require staff scheduling permission to approve shift requests
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? approvedByEmployeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.STAFF_SCHEDULING)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const swapRequest = await db.shiftSwapRequest.findUnique({
      where: { id: requestId },
    })

    if (!swapRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    if (swapRequest.locationId !== locationId) {
      return NextResponse.json({ error: 'Request does not belong to this location' }, { status: 403 })
    }

    if (swapRequest.deletedAt !== null) {
      return NextResponse.json({ error: 'Request has been cancelled' }, { status: 404 })
    }

    const requestType = swapRequest.type || 'swap'

    // For drop requests, manager can approve directly from pending
    // For swap/cover, employee must accept first (status === 'accepted')
    if (requestType === 'drop') {
      if (!['pending', 'accepted'].includes(swapRequest.status)) {
        return NextResponse.json(
          { error: `Cannot approve a request with status '${swapRequest.status}'` },
          { status: 400 }
        )
      }
    } else {
      if (swapRequest.status !== 'accepted') {
        return NextResponse.json(
          { error: `Cannot approve a ${requestType} request with status '${swapRequest.status}'. Employee must accept first.` },
          { status: 400 }
        )
      }

      if (!swapRequest.requestedToEmployeeId) {
        return NextResponse.json(
          { error: `Cannot approve: no target employee assigned to this ${requestType} request` },
          { status: 400 }
        )
      }
    }

    const now = new Date()

    if (requestType === 'drop') {
      // Drop: mark the shift as called_off, no reassignment
      const [updatedRequest, updatedShift] = await db.$transaction([
        db.shiftSwapRequest.update({
          where: { id: requestId },
          data: {
            status: 'approved',
            approvedAt: now,
            approvedByEmployeeId,
            managerNote: managerNote || null,
          },
        }),
        db.scheduledShift.update({
          where: { id: swapRequest.shiftId },
          data: {
            status: 'called_off',
          },
        }),
      ])

      // Cancel other pending requests for the same shift
      await db.shiftSwapRequest.updateMany({
        where: {
          shiftId: swapRequest.shiftId,
          status: { in: ['pending'] },
          id: { not: requestId },
          deletedAt: null,
        },
        data: { status: 'cancelled' },
      })

      // ── Outage queue protection ────────────────────────────────────────────
      try {
        await queueIfOutageOrFail('ShiftSwapRequest', locationId, requestId, 'UPDATE')
      } catch (err) {
        if (err instanceof OutageQueueFullError) {
          return NextResponse.json({ error: 'Service temporarily unavailable — outage queue full' }, { status: 507 })
        }
        throw err
      }

      // Socket event
      void dispatchShiftRequestUpdate(locationId, {
        action: 'approved',
        requestId,
        type: 'drop',
        requestedByEmployeeId: swapRequest.requestedByEmployeeId,
        shiftId: swapRequest.shiftId,
      }, { async: true }).catch(console.error)

      return NextResponse.json({ data: { request: updatedRequest, shift: updatedShift } })
    }

    // Swap or Cover: reassign the shift to the new employee
    const [updatedRequest, updatedShift] = await db.$transaction([
      db.shiftSwapRequest.update({
        where: { id: requestId },
        data: {
          status: 'approved',
          approvedAt: now,
          approvedByEmployeeId,
          managerNote: managerNote || null,
        },
      }),
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

    // Cancel other pending requests for the same shift
    await db.shiftSwapRequest.updateMany({
      where: {
        shiftId: swapRequest.shiftId,
        status: { in: ['pending'] },
        id: { not: requestId },
        deletedAt: null,
      },
      data: { status: 'cancelled' },
    })

    // ── Outage queue protection ────────────────────────────────────────────
    try {
      await queueIfOutageOrFail('ShiftSwapRequest', locationId, requestId, 'UPDATE')
    } catch (err) {
      if (err instanceof OutageQueueFullError) {
        return NextResponse.json({ error: 'Service temporarily unavailable — outage queue full' }, { status: 507 })
      }
      throw err
    }

    // Socket event
    void dispatchShiftRequestUpdate(locationId, {
      action: 'approved',
      requestId,
      type: requestType as 'swap' | 'cover' | 'drop',
      requestedByEmployeeId: swapRequest.requestedByEmployeeId,
      requestedToEmployeeId: swapRequest.requestedToEmployeeId,
      shiftId: swapRequest.shiftId,
    }, { async: true }).catch(console.error)

    return NextResponse.json({ data: { request: updatedRequest, shift: updatedShift } })
  } catch (error) {
    console.error('Failed to approve request:', error)
    return NextResponse.json({ error: 'Failed to approve request' }, { status: 500 })
  }
})
