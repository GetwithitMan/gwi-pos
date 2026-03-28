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
    const orders: any[] = await db.$queryRawUnsafe(
      `SELECT * FROM "DeliveryOrder" WHERE id = $1 AND "locationId" = $2`,
      id, locationId,
    )

    if (!orders.length) {
      return notFound('Delivery order not found')
    }

    const order = orders[0]

    // Validate the driver exists and is not suspended
    const driverRows: any[] = await db.$queryRawUnsafe(
      `SELECT dd.*, e."firstName" as "driverFirstName", e."lastName" as "driverLastName"
       FROM "DeliveryDriver" dd
       LEFT JOIN "Employee" e ON e.id = dd."employeeId"
       WHERE dd.id = $1 AND dd."locationId" = $2 AND dd."deletedAt" IS NULL
       FOR UPDATE`,
      driverId, locationId,
    )

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

    const loc = await db.$queryRawUnsafe<{ timezone: string }[]>(
      'SELECT "timezone" FROM "Location" WHERE "id" = $1',
      locationId,
    )
    const timezone = loc[0]?.timezone ?? 'America/New_York'
    const maxPerDriver = getMaxOrdersPerDriver(policy, deliveryConfig.peakHours ?? [], timezone)

    const activeCount: any[] = await db.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "DeliveryOrder"
       WHERE "driverId" = $1 AND "locationId" = $2
         AND status NOT IN ('delivered', 'cancelled_before_dispatch', 'cancelled_after_dispatch', 'failed_delivery', 'returned_to_store')
         AND id != $3`,
      driverId, locationId, id,
    )
    const currentDriverOrders = activeCount[0]?.count ?? 0
    if (currentDriverOrders >= maxPerDriver) {
      return err(`Driver at capacity (${currentDriverOrders}/${maxPerDriver} active orders)`, 409)
    }

    // Set driverId on the delivery order
    await db.$queryRawUnsafe(
      `UPDATE "DeliveryOrder" SET "driverId" = $1, "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $2 AND "locationId" = $3`,
      driverId, id, locationId,
    )

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
