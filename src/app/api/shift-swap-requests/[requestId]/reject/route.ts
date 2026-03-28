import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { dispatchShiftRequestUpdate } from '@/lib/socket-dispatch'
import { queueIfOutageOrFail, OutageQueueFullError, pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
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
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

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

    if (!['pending', 'accepted'].includes(swapRequest.status)) {
      return NextResponse.json(
        { error: `Cannot reject a request with status '${swapRequest.status}'` },
        { status: 400 }
      )
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
        return NextResponse.json({ error: 'Service temporarily unavailable — outage queue full' }, { status: 507 })
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

    return NextResponse.json({ data: { request: updated } })
  } catch (error) {
    console.error('Failed to reject request:', error)
    return NextResponse.json({ error: 'Failed to reject request' }, { status: 500 })
  }
}))
