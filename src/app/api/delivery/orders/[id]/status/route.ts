import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { advanceDeliveryStatus, type DeliveryOrderStatus } from '@/lib/delivery/state-machine'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/delivery/orders/[id]/status — Advance delivery order status
 *
 * Body: { status: DeliveryOrderStatus, cancelReason?: string }
 *
 * Uses the delivery state machine (advanceDeliveryStatus) for validated
 * transitions, audit logging, tip hooks, and socket events.
 * Designed for the Delivery KDS Android app.
 */
export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    // Auth check — POS_ACCESS allows KDS devices (device-token auth) and employees
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json()
    const { status, cancelReason } = body

    if (!status || typeof status !== 'string') {
      return NextResponse.json({ error: 'status is required' }, { status: 400 })
    }

    // Advance through state machine (validates transition, sets timestamps, audit logs, socket events)
    const result = await advanceDeliveryStatus({
      deliveryOrderId: id,
      locationId,
      newStatus: status as DeliveryOrderStatus,
      employeeId: auth.employee.id,
      cancelReason,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    pushUpstream()

    return NextResponse.json({
      data: {
        ...result.deliveryOrder,
        deliveryFee: Number(result.deliveryOrder.deliveryFee),
      },
      message: `Delivery status updated to ${status}`,
    })
  } catch (error) {
    console.error('[Delivery/Orders/Status] PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update delivery order status' }, { status: 500 })
  }
})
