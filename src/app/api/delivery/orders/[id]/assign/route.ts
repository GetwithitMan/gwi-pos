import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId, getLocationSettings } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { advanceDeliveryStatus, writeDeliveryAuditLog } from '@/lib/delivery/state-machine'
import { dispatchDriverAssigned } from '@/lib/delivery/dispatch-events'
import { mergeWithDefaults, DEFAULT_DELIVERY } from '@/lib/settings'
import { getMaxOrdersPerDriver } from '@/lib/delivery/dispatch-policy'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound } from '@/lib/api-response'
const log = createChildLogger('delivery-orders-assign')

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/delivery/orders/[id]/assign — Assign a driver to a delivery order
 *
 * Body: { driverId: string }
 *
 * 1. Validates the driver exists and is not suspended
 * 2. Checks driver capacity (maxOrdersPerDriver)
 * 3. Sets driverId on the DeliveryOrder
 * 4. Advances status to "assigned" via the state machine
 * 5. Fires delivery:driver_assigned socket event
 *
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

    // Auth check — dispatch permission required for driver assignment
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_DISPATCH)
    if (!auth.authorized) return err(auth.error, auth.status)

    const body = await request.json()
    const { driverId } = body

    if (!driverId || typeof driverId !== 'string') {
      return err('driverId is required')
    }

    // Validate the delivery order exists
    const orders: any[] = await db.$queryRaw`SELECT * FROM "DeliveryOrder" WHERE id = ${id} AND "locationId" = ${locationId}`

    if (!orders.length) {
      return notFound('Delivery order not found')
    }

    const order = orders[0]

    // Validate the driver exists and is not suspended
    const driverRows: any[] = await db.$queryRaw`SELECT dd.*, e."firstName" as "driverFirstName", e."lastName" as "driverLastName"
       FROM "DeliveryDriver" dd
       LEFT JOIN "Employee" e ON e.id = dd."employeeId"
       WHERE dd.id = ${driverId} AND dd."locationId" = ${locationId} AND dd."deletedAt" IS NULL
       FOR UPDATE`

    if (!driverRows.length) {
      return notFound('Driver not found')
    }

    const driver = driverRows[0]

    if (driver.isSuspended) {
      return err('Driver is suspended', 409)
    }

    // Check driver capacity
    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const deliveryConfig = settings.delivery ?? DEFAULT_DELIVERY
    const policy = deliveryConfig.dispatchPolicy

    const loc = await db.$queryRaw<{ timezone: string }[]>`SELECT "timezone" FROM "Location" WHERE "id" = ${locationId}`
    const timezone = loc[0]?.timezone ?? 'America/New_York'
    const maxPerDriver = getMaxOrdersPerDriver(policy, deliveryConfig.peakHours ?? [], timezone)

    const activeCount: any[] = await db.$queryRaw`SELECT COUNT(*)::int as count FROM "DeliveryOrder"
       WHERE "driverId" = ${driverId} AND "locationId" = ${locationId}
         AND status NOT IN ('delivered', 'cancelled_before_dispatch', 'cancelled_after_dispatch', 'failed_delivery', 'returned_to_store')
         AND id != ${id}`
    const currentDriverOrders = activeCount[0]?.count ?? 0
    if (currentDriverOrders >= maxPerDriver) {
      return err(`Driver at capacity (${currentDriverOrders}/${maxPerDriver} active orders)`, 409)
    }

    // Set driverId on the delivery order
    await db.$queryRaw`UPDATE "DeliveryOrder" SET "driverId" = ${driverId}, "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = ${id} AND "locationId" = ${locationId}`

    // Advance status to "assigned" via state machine (validates transition, sets timestamps, audit, socket)
    const result = await advanceDeliveryStatus({
      deliveryOrderId: id,
      locationId,
      newStatus: 'assigned',
      employeeId: auth.employee.id,
    })

    if (!result.success) {
      return err(result.error!)
    }

    const deliveryOrder = result.deliveryOrder
    pushUpstream()

    // Audit log for driver assignment
    void writeDeliveryAuditLog({
      locationId,
      action: 'driver_assigned',
      deliveryOrderId: id,
      driverId,
      employeeId: auth.employee.id,
      previousValue: { driverId: order.driverId },
      newValue: { driverId },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    // Fire delivery:driver_assigned socket event
    const driverName = driver.driverFirstName
      ? `${driver.driverFirstName} ${driver.driverLastName}`.trim()
      : null
    void dispatchDriverAssigned(locationId, {
      deliveryOrderId: id,
      orderId: deliveryOrder.orderId,
      driverId,
      driverName,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return NextResponse.json({
      data: {
        ...deliveryOrder,
        deliveryFee: Number(deliveryOrder.deliveryFee),
        driverName,
      },
      message: `Driver assigned to delivery order`,
    })
  } catch (error) {
    console.error('[Delivery/Orders/Assign] PATCH error:', error)
    return err('Failed to assign driver', 500)
  }
})
