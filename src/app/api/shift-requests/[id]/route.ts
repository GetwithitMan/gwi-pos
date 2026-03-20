import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { dispatchShiftRequestUpdate } from '@/lib/socket-dispatch'

// PUT - Update a shift request
// Actions: approve, reject (manager), accept, decline (employee)
// Body: { locationId, action, employeeId?, managerNote?, reason? }
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: requestId } = await params
    const body = await request.json()
    const { locationId, action, employeeId: bodyEmployeeId, managerNote, reason } = body as {
      locationId: string
      action: 'approve' | 'reject' | 'accept' | 'decline'
      employeeId?: string
      managerNote?: string
      reason?: string
    }

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }
    if (!action || !['approve', 'reject', 'accept', 'decline'].includes(action)) {
      return NextResponse.json({ error: 'action must be approve, reject, accept, or decline' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = bodyEmployeeId ?? actor.employeeId

    // Manager actions require SCHEDULING_MANAGE permission
    if (action === 'approve' || action === 'reject') {
      const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.SCHEDULING_MANAGE)
      if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const swapRequest = await db.shiftSwapRequest.findUnique({ where: { id: requestId } })
    if (!swapRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }
    if (swapRequest.locationId !== locationId) {
      return NextResponse.json({ error: 'Request does not belong to this location' }, { status: 403 })
    }
    if (swapRequest.deletedAt !== null) {
      return NextResponse.json({ error: 'Request has been cancelled' }, { status: 404 })
    }

    const requestType = (swapRequest.type || 'swap') as 'swap' | 'cover' | 'drop'
    const now = new Date()

    // ── Accept ──
    if (action === 'accept') {
      if (swapRequest.status !== 'pending') {
        return NextResponse.json(
          { error: `Cannot accept a request with status '${swapRequest.status}'` },
          { status: 400 }
        )
      }
      const updateData: Record<string, unknown> = {
        status: 'accepted',
        respondedAt: now,
      }
      // For cover with no target, the accepting employee becomes the target
      if (requestType === 'cover' && !swapRequest.requestedToEmployeeId && resolvedEmployeeId) {
        updateData.requestedToEmployeeId = resolvedEmployeeId
      }
      const updated = await db.shiftSwapRequest.update({ where: { id: requestId }, data: updateData })
      void dispatchShiftRequestUpdate(locationId, {
        action: 'accepted', requestId, type: requestType,
        requestedByEmployeeId: swapRequest.requestedByEmployeeId,
        requestedToEmployeeId: (updated.requestedToEmployeeId as string) || null,
        shiftId: swapRequest.shiftId,
      }, { async: true }).catch(console.error)
      return NextResponse.json({ data: { request: updated } })
    }

    // ── Decline ──
    if (action === 'decline') {
      if (swapRequest.status !== 'pending') {
        return NextResponse.json(
          { error: `Cannot decline a request with status '${swapRequest.status}'` },
          { status: 400 }
        )
      }
      // Only the target employee can decline a swap request
      if (swapRequest.requestedToEmployeeId && resolvedEmployeeId !== swapRequest.requestedToEmployeeId) {
        return NextResponse.json(
          { error: 'Only the target employee can decline this request' },
          { status: 403 }
        )
      }
      const updated = await db.shiftSwapRequest.update({
        where: { id: requestId },
        data: { status: 'rejected', respondedAt: now, declineReason: reason || null },
      })
      void dispatchShiftRequestUpdate(locationId, {
        action: 'declined', requestId, type: requestType,
        requestedByEmployeeId: swapRequest.requestedByEmployeeId,
        requestedToEmployeeId: swapRequest.requestedToEmployeeId,
        shiftId: swapRequest.shiftId,
      }, { async: true }).catch(console.error)
      return NextResponse.json({ data: { request: updated } })
    }

    // ── Approve ──
    if (action === 'approve') {
      if (requestType === 'drop') {
        if (!['pending', 'accepted'].includes(swapRequest.status)) {
          return NextResponse.json(
            { error: `Cannot approve a request with status '${swapRequest.status}'` },
            { status: 400 }
          )
        }
        const [updatedReq, updatedShift] = await db.$transaction([
          db.shiftSwapRequest.update({
            where: { id: requestId },
            data: { status: 'approved', approvedAt: now, approvedByEmployeeId: resolvedEmployeeId, managerNote: managerNote || null },
          }),
          db.scheduledShift.update({
            where: { id: swapRequest.shiftId },
            data: { status: 'called_off' },
          }),
        ])
        await db.shiftSwapRequest.updateMany({
          where: { shiftId: swapRequest.shiftId, status: 'pending', id: { not: requestId }, deletedAt: null },
          data: { status: 'cancelled' },
        })
        void dispatchShiftRequestUpdate(locationId, {
          action: 'approved', requestId, type: 'drop',
          requestedByEmployeeId: swapRequest.requestedByEmployeeId,
          shiftId: swapRequest.shiftId,
        }, { async: true }).catch(console.error)
        return NextResponse.json({ data: { request: updatedReq, shift: updatedShift } })
      }

      // Swap or Cover
      if (swapRequest.status !== 'accepted') {
        return NextResponse.json(
          { error: `Cannot approve: employee must accept first (current status: '${swapRequest.status}')` },
          { status: 400 }
        )
      }
      if (!swapRequest.requestedToEmployeeId) {
        return NextResponse.json(
          { error: 'Cannot approve: no target employee' },
          { status: 400 }
        )
      }
      const [updatedReq, updatedShift] = await db.$transaction([
        db.shiftSwapRequest.update({
          where: { id: requestId },
          data: { status: 'approved', approvedAt: now, approvedByEmployeeId: resolvedEmployeeId, managerNote: managerNote || null },
        }),
        db.scheduledShift.update({
          where: { id: swapRequest.shiftId },
          data: {
            employeeId: swapRequest.requestedToEmployeeId!,
            originalEmployeeId: swapRequest.requestedByEmployeeId,
            swappedAt: now,
            swapApprovedBy: resolvedEmployeeId,
          },
        }),
      ])
      await db.shiftSwapRequest.updateMany({
        where: { shiftId: swapRequest.shiftId, status: 'pending', id: { not: requestId }, deletedAt: null },
        data: { status: 'cancelled' },
      })
      void dispatchShiftRequestUpdate(locationId, {
        action: 'approved', requestId, type: requestType,
        requestedByEmployeeId: swapRequest.requestedByEmployeeId,
        requestedToEmployeeId: swapRequest.requestedToEmployeeId,
        shiftId: swapRequest.shiftId,
      }, { async: true }).catch(console.error)
      return NextResponse.json({ data: { request: updatedReq, shift: updatedShift } })
    }

    // ── Reject ──
    if (!['pending', 'accepted'].includes(swapRequest.status)) {
      return NextResponse.json(
        { error: `Cannot reject a request with status '${swapRequest.status}'` },
        { status: 400 }
      )
    }
    const updated = await db.shiftSwapRequest.update({
      where: { id: requestId },
      data: {
        status: 'rejected',
        declineReason: reason || null,
        managerNote: managerNote || null,
        approvedAt: now,
      },
    })
    void dispatchShiftRequestUpdate(locationId, {
      action: 'rejected', requestId, type: requestType,
      requestedByEmployeeId: swapRequest.requestedByEmployeeId,
      requestedToEmployeeId: swapRequest.requestedToEmployeeId,
      shiftId: swapRequest.shiftId,
    }, { async: true }).catch(console.error)
    return NextResponse.json({ data: { request: updated } })
  } catch (error) {
    console.error('Failed to update shift request:', error)
    return NextResponse.json({ error: 'Failed to update shift request' }, { status: 500 })
  }
})

// DELETE - Cancel a pending request (requestor only)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: requestId } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const swapRequest = await db.shiftSwapRequest.findUnique({ where: { id: requestId } })
    if (!swapRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }
    if (swapRequest.locationId !== locationId) {
      return NextResponse.json({ error: 'Request does not belong to this location' }, { status: 403 })
    }
    if (swapRequest.deletedAt !== null) {
      return NextResponse.json({ error: 'Request already cancelled' }, { status: 404 })
    }
    if (swapRequest.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot cancel a request with status '${swapRequest.status}'` },
        { status: 400 }
      )
    }

    const requestType = (swapRequest.type || 'swap') as 'swap' | 'cover' | 'drop'

    await db.shiftSwapRequest.update({
      where: { id: requestId },
      data: { deletedAt: new Date(), status: 'cancelled' },
    })

    void dispatchShiftRequestUpdate(locationId, {
      action: 'cancelled', requestId, type: requestType,
      requestedByEmployeeId: swapRequest.requestedByEmployeeId,
      requestedToEmployeeId: swapRequest.requestedToEmployeeId,
      shiftId: swapRequest.shiftId,
    }, { async: true }).catch(console.error)

    return NextResponse.json({ data: { message: 'Request cancelled' } })
  } catch (error) {
    console.error('Failed to cancel request:', error)
    return NextResponse.json({ error: 'Failed to cancel request' }, { status: 500 })
  }
})
