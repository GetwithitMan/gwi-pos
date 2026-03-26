import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId, getLocationSettings } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { advanceDeliveryStatus } from '@/lib/delivery/state-machine'
import { canMarkDelivered } from '@/lib/delivery/dispatch-policy'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

export const dynamic = 'force-dynamic'

/**
 * PUT /api/delivery/driver/order-status — Mark order arrived/delivered/attempted/failed
 *
 * Body: { deliveryOrderId, status: 'arrived' | 'delivered' | 'attempted' | 'failed_delivery', reason? }
 *
 * Uses the delivery state machine for all transitions. If marking 'delivered',
 * checks proof requirements via dispatch policy. If all orders in the run
 * are delivered, auto-completes the run.
 */
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_CREATE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId, { subfeature: 'driverAppProvisioned' })
    if (featureGate) return featureGate

    const body = await request.json()
    const { deliveryOrderId, status, reason } = body

    if (!deliveryOrderId || typeof deliveryOrderId !== 'string') {
      return NextResponse.json({ error: 'deliveryOrderId is required' }, { status: 400 })
    }

    const validStatuses = ['arrived', 'delivered', 'attempted', 'failed_delivery']
    if (!status || !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${validStatuses.join(', ')}` },
        { status: 400 },
      )
    }

    // Find the driver for this employee
    const drivers: any[] = await db.$queryRawUnsafe(`
      SELECT id FROM "DeliveryDriver"
      WHERE "employeeId" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, actor.employeeId, locationId)

    if (!drivers.length) {
      return NextResponse.json({ error: 'No driver profile found' }, { status: 404 })
    }

    const driverId = drivers[0].id

    // Validate the order belongs to the driver's active run
    const orderRows: any[] = await db.$queryRawUnsafe(`
      SELECT do_.*, dr."driverId" as "runDriverId", dr."status" as "runStatus"
      FROM "DeliveryOrder" do_
      JOIN "DeliveryRun" dr ON dr.id = do_."runId"
      WHERE do_.id = $1
        AND do_."locationId" = $2
        AND dr."driverId" = $3
        AND dr."status" IN ('assigned', 'handoff_ready', 'dispatched', 'in_progress')
      LIMIT 1
    `, deliveryOrderId, locationId, driverId)

    if (!orderRows.length) {
      return NextResponse.json(
        { error: 'Order not found or not assigned to your active run' },
        { status: 404 },
      )
    }

    const deliveryOrder = orderRows[0]

    // If marking 'delivered', check proof requirements
    if (status === 'delivered' && deliveryOrder.proofMode && deliveryOrder.proofMode !== 'none') {
      const settings = await getLocationSettings(locationId)
      const dispatchPolicy = (settings as any)?.deliveryDispatchPolicy

      if (dispatchPolicy) {
        // Check uploaded proofs
        const proofs: any[] = await db.$queryRawUnsafe(`
          SELECT "type" FROM "DeliveryProofOfDelivery"
          WHERE "deliveryOrderId" = $1
        `, deliveryOrderId)

        const policyCheck = await canMarkDelivered(
          dispatchPolicy,
          deliveryOrder.proofMode,
          proofs.map(p => ({ type: p.type })),
        )

        if (!policyCheck.allowed) {
          return NextResponse.json(
            { error: policyCheck.reason, requiresOverride: policyCheck.requiresOverride },
            { status: 403 },
          )
        }
      }
    }

    // Advance status via state machine
    const result = await advanceDeliveryStatus({
      deliveryOrderId,
      locationId,
      newStatus: status,
      employeeId: actor.employeeId ?? 'unknown',
      reason,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    pushUpstream()

    // Auto-complete of the run is now handled inside advanceDeliveryStatus()
    // when an order reaches a terminal state (delivered, cancelled_before_dispatch,
    // cancelled_after_dispatch). No need for a separate call here.

    return NextResponse.json({
      deliveryOrder: {
        ...result.deliveryOrder,
        deliveryFee: Number(result.deliveryOrder.deliveryFee),
      },
    })
  } catch (error) {
    console.error('[Delivery/Driver/OrderStatus] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update order status' }, { status: 500 })
  }
})

