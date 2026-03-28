import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { dispatchShiftRequestUpdate } from '@/lib/socket-dispatch'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { queueIfOutageOrFail, OutageQueueFullError, pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, forbidden, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('shift-swap-requests-approve')

// POST - Manager approves a shift request (swap, cover, or drop)
// For swaps: reassigns shift to target employee
// For covers: reassigns shift to target employee (who claimed the open request)
// For drops: marks shift as called_off
// Body: { locationId: string, approvedByEmployeeId: string, managerNote?: string }
export const POST = withVenue(withAuth(async function POST(
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
      return err('Location ID is required')
    }

    if (!approvedByEmployeeId) {
      return err('approvedByEmployeeId is required')
    }

    // Auth check — require staff scheduling permission to approve shift requests
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? approvedByEmployeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.STAFF_SCHEDULING)
    if (!auth.authorized) return err(auth.error, auth.status)

    const swapRequest = await db.shiftSwapRequest.findUnique({
      where: { id: requestId },
    })

    if (!swapRequest) {
      return notFound('Request not found')
    }

    if (swapRequest.locationId !== locationId) {
      return forbidden('Request does not belong to this location')
    }

    if (swapRequest.deletedAt !== null) {
      return notFound('Request has been cancelled')
    }

    const requestType = swapRequest.type || 'swap'

    // For drop requests, manager can approve directly from pending
    // For swap/cover, employee must accept first (status === 'accepted')
    if (requestType === 'drop') {
      if (!['pending', 'accepted'].includes(swapRequest.status)) {
        return err(`Cannot approve a request with status '${swapRequest.status}'`)
      }
    } else {
      if (swapRequest.status !== 'accepted') {
        return err(`Cannot approve a ${requestType} request with status '${swapRequest.status}'. Employee must accept first.`)
      }

      if (!swapRequest.requestedToEmployeeId) {
        return err(`Cannot approve: no target employee assigned to this ${requestType} request`)
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
            lastMutatedBy: 'cloud',
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
        data: { status: 'cancelled', lastMutatedBy: 'cloud' },
      })

      // ── Outage queue protection ────────────────────────────────────────────
      try {
        await queueIfOutageOrFail('ShiftSwapRequest', locationId, requestId, 'UPDATE')
      } catch (err) {
        if (err instanceof OutageQueueFullError) {
          return err('Service temporarily unavailable — outage queue full', 507)
        }
        throw err
      }

      pushUpstream()

      // Socket event
      void dispatchShiftRequestUpdate(locationId, {
        action: 'approved',
        requestId,
        type: 'drop',
        requestedByEmployeeId: swapRequest.requestedByEmployeeId,
        shiftId: swapRequest.shiftId,
      }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

      return ok({ request: updatedRequest, shift: updatedShift })
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
          lastMutatedBy: 'cloud',
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
      data: { status: 'cancelled', lastMutatedBy: 'cloud' },
    })

    // ── Outage queue protection ────────────────────────────────────────────
    try {
      await queueIfOutageOrFail('ShiftSwapRequest', locationId, requestId, 'UPDATE')
    } catch (err) {
      if (err instanceof OutageQueueFullError) {
        return err('Service temporarily unavailable — outage queue full', 507)
      }
      throw err
    }

    pushUpstream()

    // Socket event
    void dispatchShiftRequestUpdate(locationId, {
      action: 'approved',
      requestId,
      type: requestType as 'swap' | 'cover' | 'drop',
      requestedByEmployeeId: swapRequest.requestedByEmployeeId,
      requestedToEmployeeId: swapRequest.requestedToEmployeeId,
      shiftId: swapRequest.shiftId,
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({ request: updatedRequest, shift: updatedShift })
  } catch (error) {
    console.error('Failed to approve request:', error)
    return err('Failed to approve request', 500)
  }
}))
