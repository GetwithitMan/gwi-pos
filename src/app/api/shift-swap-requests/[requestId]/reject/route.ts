import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { dispatchShiftRequestUpdate } from '@/lib/socket-dispatch'
import { queueIfOutageOrFail, OutageQueueFullError, pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, forbidden, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('shift-swap-requests-reject')

// POST - Manager rejects a shift request
// Body: { locationId: string, reason?: string, managerNote?: string }
export const POST = withVenue(withAuth(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params
    const body = await request.json()
    const { locationId, reason, managerNote } = body as {
      locationId: string
      reason?: string
      managerNote?: string
    }

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
      return notFound('Request has been cancelled')
    }

    if (!['pending', 'accepted'].includes(swapRequest.status)) {
      return err(`Cannot reject a request with status '${swapRequest.status}'`)
    }

    const requestType = swapRequest.type || 'swap'

    const updated = await db.shiftSwapRequest.update({
      where: { id: requestId },
      data: {
        status: 'rejected',
        declineReason: reason || null,
        managerNote: managerNote || null,
        approvedAt: new Date(),
        lastMutatedBy: 'cloud',
      },
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
      action: 'rejected',
      requestId,
      type: requestType as 'swap' | 'cover' | 'drop',
      requestedByEmployeeId: swapRequest.requestedByEmployeeId,
      requestedToEmployeeId: swapRequest.requestedToEmployeeId,
      shiftId: swapRequest.shiftId,
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({ request: updated })
  } catch (error) {
    console.error('Failed to reject request:', error)
    return err('Failed to reject request', 500)
  }
}))
