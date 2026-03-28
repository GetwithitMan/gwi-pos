import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { advanceDeliveryStatus, type DeliveryOrderStatus } from '@/lib/delivery/state-machine'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err } from '@/lib/api-response'

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
      return err('No location found')
    }

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    // Auth check — POS_ACCESS allows KDS devices (device-token auth) and employees
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return err(auth.error, auth.status)

    const body = await request.json()
    const { status, cancelReason } = body

    if (!status || typeof status !== 'string') {
      return err('status is required')
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
      return err(result.error)
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
    return err('Failed to update delivery order status', 500)
  }
})
