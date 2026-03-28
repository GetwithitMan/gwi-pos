import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { dispatchShiftRequestUpdate } from '@/lib/socket-dispatch'
import { queueIfOutageOrFail, OutageQueueFullError, pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, forbidden, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('shift-swap-requests')

// DELETE - Employee cancels their own pending request (soft delete)
export const DELETE = withVenue(withAuth(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('Location ID is required')
    }

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
      return notFound('Request already cancelled')
    }

    if (swapRequest.status !== 'pending') {
      return err(`Cannot cancel a request with status '${swapRequest.status}'`)
    }

    const requestType = swapRequest.type || 'swap'

    // Soft delete
    await db.shiftSwapRequest.update({
      where: { id: requestId },
      data: { deletedAt: new Date(), status: 'cancelled', lastMutatedBy: 'cloud' },
    })

    // ── Outage queue protection ────────────────────────────────────────────
    try {
      await queueIfOutageOrFail('ShiftSwapRequest', locationId, requestId, 'UPDATE')
    } catch (caughtErr) {
      if (err instanceof OutageQueueFullError) {
        return err('Service temporarily unavailable — outage queue full', 507)
      }
      throw err
    }

    pushUpstream()

    // Socket event
    void dispatchShiftRequestUpdate(locationId, {
      action: 'cancelled',
      requestId,
      type: requestType as 'swap' | 'cover' | 'drop',
      requestedByEmployeeId: swapRequest.requestedByEmployeeId,
      requestedToEmployeeId: swapRequest.requestedToEmployeeId,
      shiftId: swapRequest.shiftId,
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({ message: 'Request cancelled' })
  } catch (error) {
    console.error('Failed to cancel request:', error)
    return err('Failed to cancel request', 500)
  }
}))
