import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { err, notFound, ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * GET /api/delivery/driver/current-run — Driver's active run with expanded orders
 *
 * Returns the driver's active DeliveryRun (if any) with all associated
 * DeliveryOrders expanded with address, customer info, and order items.
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_VIEW)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId, { subfeature: 'driverAppProvisioned' })
    if (featureGate) return featureGate

    // Find the DeliveryDriver record for this employee
    const drivers: any[] = await db.$queryRaw`
      SELECT id FROM "DeliveryDriver"
      WHERE "employeeId" = ${actor.employeeId} AND "locationId" = ${locationId} AND "deletedAt" IS NULL
      LIMIT 1
    `

    if (!drivers.length) {
      return notFound('No driver profile found for this employee')
    }

    const driverId = drivers[0].id

    // Find active run (non-terminal states)
    const runs: any[] = await db.$queryRaw`
      SELECT * FROM "DeliveryRun"
      WHERE "driverId" = ${driverId}
        AND "locationId" = ${locationId}
        AND "status" IN ('assigned', 'handoff_ready', 'dispatched', 'in_progress')
      ORDER BY "createdAt" DESC
      LIMIT 1
    `

    if (!runs.length) {
      return ok({ run: null })
    }

    const run = runs[0]

    // Expand: get all DeliveryOrders for this run with address, customer, and order items
    const deliveryOrders: any[] = await db.$queryRaw`
      SELECT do_.*,
             o."orderNumber", o."status" as "orderStatus", o."subtotal" as "orderSubtotal",
             o."tax" as "orderTax", o."total" as "orderTotal",
             o."specialInstructions" as "orderNotes"
      FROM "DeliveryOrder" do_
      LEFT JOIN "Order" o ON o.id = do_."orderId"
      WHERE do_."runId" = ${run.id} AND do_."locationId" = ${locationId}
      ORDER BY do_."sequenceInRun" ASC NULLS LAST, do_."createdAt" ASC
    `

    // Fetch order items for all linked orders in a single query
    const orderIds = deliveryOrders
      .map(d => d.orderId)
      .filter(Boolean)

    const itemsByOrderId: Record<string, any[]> = {}
    if (orderIds.length > 0) {
      const placeholders = orderIds.map((_, i) => `$${i + 1}`).join(', ')
      const items: any[] = await db.$queryRaw`
        SELECT oi.id, oi."orderId", oi.name, oi.price, oi.quantity,
               oi."specialInstructions"
        FROM "OrderItem" oi
        WHERE oi."orderId" IN (${placeholders})
          AND oi."deletedAt" IS NULL AND oi."voidedAt" IS NULL
        ORDER BY oi."createdAt" ASC
      `

      for (const item of items) {
        if (!itemsByOrderId[item.orderId]) {
          itemsByOrderId[item.orderId] = []
        }
        itemsByOrderId[item.orderId].push({
          id: item.id,
          name: item.name,
          price: Number(item.price),
          quantity: item.quantity,
          specialInstructions: item.specialInstructions,
        })
      }
    }

    // Build enriched orders
    const orders = deliveryOrders.map(d => ({
      id: d.id,
      orderId: d.orderId,
      status: d.status,
      customerName: d.customerName,
      phone: d.phone,
      address: d.address,
      addressLine2: d.addressLine2,
      city: d.city,
      state: d.state,
      zipCode: d.zipCode,
      latitude: d.latitude != null ? Number(d.latitude) : null,
      longitude: d.longitude != null ? Number(d.longitude) : null,
      notes: d.notes,
      deliveryNotes: d.deliveryNotes,
      deliveryFee: Number(d.deliveryFee),
      estimatedMinutes: d.estimatedMinutes,
      estimatedDeliveryAt: d.estimatedDeliveryAt,
      promisedAt: d.promisedAt,
      proofMode: d.proofMode,
      sequenceInRun: d.sequenceInRun,
      orderNumber: d.orderNumber,
      orderStatus: d.orderStatus,
      orderSubtotal: d.orderSubtotal != null ? Number(d.orderSubtotal) : null,
      orderTax: d.orderTax != null ? Number(d.orderTax) : null,
      orderTotal: d.orderTotal != null ? Number(d.orderTotal) : null,
      orderNotes: d.orderNotes,
      items: d.orderId ? (itemsByOrderId[d.orderId] || []) : [],
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }))

    return ok({
      run: {
        id: run.id,
        driverId: run.driverId,
        status: run.status,
        orderSequence: run.orderSequence,
        dispatchedAt: run.dispatchedAt,
        startedAt: run.startedAt,
        estimatedReturnAt: run.estimatedReturnAt,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        orders,
      },
    })
  } catch (error) {
    console.error('[Delivery/Driver/CurrentRun] GET error:', error)
    return err('Failed to fetch current run', 500)
  }
})
