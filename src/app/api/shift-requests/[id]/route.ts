import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { dispatchShiftRequestUpdate } from '@/lib/socket-dispatch'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, forbidden, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('shift-requests')

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
      return err('Location ID is required')
    }
    if (!action || !['approve', 'reject', 'accept', 'decline'].includes(action)) {
      return err('action must be approve, reject, accept, or decline')
    }

    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = bodyEmployeeId ?? actor.employeeId

    // Manager actions require SCHEDULING_MANAGE permission
    if (action === 'approve' || action === 'reject') {
      const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.SCHEDULING_MANAGE)
      if (!auth.authorized) return err(auth.error, auth.status)
    }

    const swapRequest = await db.shiftSwapRequest.findUnique({ where: { id: requestId } })
    if (!swapRequest) {
      return notFound('Request not found')
    }
    if (swapRequest.locationId !== locationId) {
      return forbidden('Request does not belong to this location')
    }
    if (swapRequest.deletedAt !== null) {
      return notFound('Request has been cancelled')
    }

    const requestType = (swapRequest.type || 'swap') as 'swap' | 'cover' | 'drop'
    const now = new Date()

    // ── Accept ──
    if (action === 'accept') {
      if (swapRequest.status !== 'pending') {
        return err(`Cannot accept a request with status '${swapRequest.status}'`)
      }
      const updateData: Record<string, unknown> = {
        status: 'accepted',
        respondedAt: now,
      }
      // For cover with no target, the accepting employee becomes the target
      if (requestType === 'cover' && !swapRequest.requestedToEmployeeId && resolvedEmployeeId) {
        updateData.requestedToEmployeeId = resolvedEmployeeId
      }
      const updated = await db.shiftSwapRequest.update({ where: { id: requestId }, data: { ...updateData, lastMutatedBy: 'cloud' } })
      pushUpstream()
      void dispatchShiftRequestUpdate(locationId, {
        action: 'accepted', requestId, type: requestType,
        requestedByEmployeeId: swapRequest.requestedByEmployeeId,
        requestedToEmployeeId: (updated.requestedToEmployeeId as string) || null,
        shiftId: swapRequest.shiftId,
      }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
      return ok({ request: updated })
    }

    // ── Decline ──
    if (action === 'decline') {
      if (swapRequest.status !== 'pending') {
        return err(`Cannot decline a request with status '${swapRequest.status}'`)
      }
      // Only the target employee can decline a swap request
      if (swapRequest.requestedToEmployeeId && resolvedEmployeeId !== swapRequest.requestedToEmployeeId) {
        return forbidden('Only the target employee can decline this request')
      }
      const updated = await db.shiftSwapRequest.update({
        where: { id: requestId },
        data: { status: 'rejected', respondedAt: now, declineReason: reason || null, lastMutatedBy: 'cloud' },
      })
      pushUpstream()
      void dispatchShiftRequestUpdate(locationId, {
        action: 'declined', requestId, type: requestType,
        requestedByEmployeeId: swapRequest.requestedByEmployeeId,
        requestedToEmployeeId: swapRequest.requestedToEmployeeId,
        shiftId: swapRequest.shiftId,
      }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
      return ok({ request: updated })
    }

    // ── Approve ──
    if (action === 'approve') {
      if (requestType === 'drop') {
        if (!['pending', 'accepted'].includes(swapRequest.status)) {
          return err(`Cannot approve a request with status '${swapRequest.status}'`)
        }
        const [updatedReq, updatedShift] = await db.$transaction([
          db.shiftSwapRequest.update({
            where: { id: requestId },
            data: { status: 'approved', approvedAt: now, approvedByEmployeeId: resolvedEmployeeId, managerNote: managerNote || null, lastMutatedBy: 'cloud' },
          }),
          db.scheduledShift.update({
            where: { id: swapRequest.shiftId },
            data: { status: 'called_off' },
          }),
        ])
        await db.shiftSwapRequest.updateMany({
          where: { shiftId: swapRequest.shiftId, status: 'pending', id: { not: requestId }, deletedAt: null },
          data: { status: 'cancelled', lastMutatedBy: 'cloud' },
        })
        pushUpstream()
        void dispatchShiftRequestUpdate(locationId, {
          action: 'approved', requestId, type: 'drop',
          requestedByEmployeeId: swapRequest.requestedByEmployeeId,
          shiftId: swapRequest.shiftId,
        }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
        return ok({ request: updatedReq, shift: updatedShift })
      }

      // Swap or Cover
      if (swapRequest.status !== 'accepted') {
        return err(`Cannot approve: employee must accept first (current status: '${swapRequest.status}')`)
      }
      if (!swapRequest.requestedToEmployeeId) {
        return err('Cannot approve: no target employee')
      }
      const [updatedReq, updatedShift] = await db.$transaction([
        db.shiftSwapRequest.update({
          where: { id: requestId },
          data: { status: 'approved', approvedAt: now, approvedByEmployeeId: resolvedEmployeeId, managerNote: managerNote || null, lastMutatedBy: 'cloud' },
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
        data: { status: 'cancelled', lastMutatedBy: 'cloud' },
      })
      pushUpstream()
      void dispatchShiftRequestUpdate(locationId, {
        action: 'approved', requestId, type: requestType,
        requestedByEmployeeId: swapRequest.requestedByEmployeeId,
        requestedToEmployeeId: swapRequest.requestedToEmployeeId,
        shiftId: swapRequest.shiftId,
      }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
      return ok({ request: updatedReq, shift: updatedShift })
    }

    // ── Reject ──
    if (!['pending', 'accepted'].includes(swapRequest.status)) {
      return err(`Cannot reject a request with status '${swapRequest.status}'`)
    }
    const updated = await db.shiftSwapRequest.update({
      where: { id: requestId },
      data: {
        status: 'rejected',
        declineReason: reason || null,
        managerNote: managerNote || null,
        approvedAt: now,
        lastMutatedBy: 'cloud',
      },
    })
    pushUpstream()
    void dispatchShiftRequestUpdate(locationId, {
      action: 'rejected', requestId, type: requestType,
      requestedByEmployeeId: swapRequest.requestedByEmployeeId,
      requestedToEmployeeId: swapRequest.requestedToEmployeeId,
      shiftId: swapRequest.shiftId,
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
    return ok({ request: updated })
  } catch (error) {
    console.error('Failed to update shift request:', error)
    return err('Failed to update shift request', 500)
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
      return err('Location ID is required')
    }

    const swapRequest = await db.shiftSwapRequest.findUnique({ where: { id: requestId } })
    if (!swapRequest) {
      return notFound('Request not found')
    }
    if (swapRequest.locationId !== locationId) {
      return forbidden('Request does not belong to this location')
    }
    if (swapRequest.deletedAt !== null) {
      return notFound('Request already cancelled')
    }
    if (swapRequest.status !== 'pending') {
      return err(`Cannot cancel a request with status '${swapRequest.status}'`)
    }

    const requestType = (swapRequest.type || 'swap') as 'swap' | 'cover' | 'drop'

    await db.shiftSwapRequest.update({
      where: { id: requestId },
      data: { deletedAt: new Date(), status: 'cancelled', lastMutatedBy: 'cloud' },
    })

    pushUpstream()

    void dispatchShiftRequestUpdate(locationId, {
      action: 'cancelled', requestId, type: requestType,
      requestedByEmployeeId: swapRequest.requestedByEmployeeId,
      requestedToEmployeeId: swapRequest.requestedToEmployeeId,
      shiftId: swapRequest.shiftId,
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({ message: 'Request cancelled' })
  } catch (error) {
    console.error('Failed to cancel request:', error)
    return err('Failed to cancel request', 500)
  }
})
