import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderRepository } from '@/lib/repositories'
import { withVenue } from '@/lib/with-venue'
import { getLocationId, getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_DELIVERY } from '@/lib/settings'
import { emitToLocation } from '@/lib/socket-server'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'
const log = createChildLogger('delivery')

export const dynamic = 'force-dynamic'

/**
 * GET /api/delivery — List delivery orders with filters
 *
 * Query params: status, driverId, dateFrom, dateTo
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const driverId = searchParams.get('driverId')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    let whereClause = `WHERE d."locationId" = $1`
    const params: any[] = [locationId]
    let paramIdx = 2

    if (status) {
      whereClause += ` AND d."status" = $${paramIdx}`
      params.push(status)
      paramIdx++
    }

    if (driverId) {
      whereClause += ` AND d."driverId" = $${paramIdx}`
      params.push(driverId)
      paramIdx++
    }

    if (dateFrom) {
      whereClause += ` AND d."createdAt" >= $${paramIdx}`
      params.push(new Date(dateFrom))
      paramIdx++
    }

    if (dateTo) {
      whereClause += ` AND d."createdAt" <= $${paramIdx}`
      params.push(new Date(dateTo))
      paramIdx++
    }

    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT d.*,
             o."orderNumber", o."guestCount", o."status" as "orderStatus",
             e."firstName" as "driverFirstName", e."lastName" as "driverLastName",
             ce."firstName" as "creatorFirstName", ce."lastName" as "creatorLastName"
      FROM "DeliveryOrder" d
      LEFT JOIN "Order" o ON o.id = d."orderId"
      LEFT JOIN "Employee" e ON e.id = d."driverId"
      LEFT JOIN "Employee" ce ON ce.id = d."employeeId"
      ${whereClause}
      ORDER BY
        CASE d."status"
          WHEN 'pending' THEN 1
          WHEN 'preparing' THEN 2
          WHEN 'ready_for_pickup' THEN 3
          WHEN 'out_for_delivery' THEN 4
          WHEN 'delivered' THEN 5
          WHEN 'cancelled' THEN 6
        END,
        d."createdAt" DESC
    `, ...params)

    const enriched = rows.map(row => ({
      ...row,
      driverName: row.driverFirstName ? `${row.driverFirstName} ${row.driverLastName}`.trim() : null,
      creatorName: row.creatorFirstName ? `${row.creatorFirstName} ${row.creatorLastName}`.trim() : null,
      deliveryFee: Number(row.deliveryFee),
    }))

    return ok(enriched)
  } catch (error) {
    console.error('[Delivery] GET error:', error)
    return err('Failed to fetch delivery orders', 500)
  }
})

/**
 * POST /api/delivery — Create a new delivery order
 *
 * Payload: { customerName, phone, address, items, notes?, scheduledFor?, driverId?, employeeId? }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_CREATE)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const deliveryConfig = settings.delivery ?? DEFAULT_DELIVERY

    if (!deliveryConfig.enabled) {
      return err('Delivery is not enabled')
    }

    const body = await request.json()
    const {
      customerName,
      phone,
      address,
      addressLine2,
      city,
      state,
      zipCode,
      notes,
      scheduledFor,
      driverId,
      employeeId,
      orderId,
      zoneId,
    } = body

    // Validate required fields
    if (!customerName || typeof customerName !== 'string' || customerName.trim().length === 0) {
      return err('Customer name is required')
    }

    if (deliveryConfig.requirePhone && (!phone || typeof phone !== 'string' || phone.trim().length === 0)) {
      return err('Phone number is required for delivery orders')
    }

    if (deliveryConfig.requireAddress && (!address || typeof address !== 'string' || address.trim().length === 0)) {
      return err('Address is required for delivery orders')
    }

    // Check max active deliveries
    const activeCount: any[] = await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int as count
      FROM "DeliveryOrder"
      WHERE "locationId" = $1
        AND status IN ('pending', 'preparing', 'ready_for_pickup', 'out_for_delivery')
    `, locationId)

    if ((activeCount[0]?.count ?? 0) >= deliveryConfig.maxActiveDeliveries) {
      return err(`Maximum active deliveries reached (${deliveryConfig.maxActiveDeliveries})`, 409)
    }

    // Calculate delivery fee — zone fee takes priority over flat config fee
    let deliveryFee = deliveryConfig.deliveryFee
    const resolvedZoneId = zoneId || null

    if (resolvedZoneId) {
      // Look up zone-specific delivery fee
      const zoneRows: any[] = await db.$queryRawUnsafe(
        `SELECT "deliveryFee", "estimatedMinutes" FROM "DeliveryZone"
         WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL AND "isActive" = true
         LIMIT 1`,
        resolvedZoneId,
        locationId,
      )
      if (zoneRows.length) {
        const zoneFee = Number(zoneRows[0].deliveryFee)
        if (!isNaN(zoneFee)) {
          deliveryFee = zoneFee
        }
      }
    }

    // If there's an associated order, check if it qualifies for free delivery
    if (orderId && deliveryConfig.freeDeliveryMinimum > 0) {
      const orderTotal: any[] = await db.$queryRawUnsafe(`
        SELECT COALESCE(SUM(oi.price * oi.quantity), 0)::float as subtotal
        FROM "OrderItem" oi
        WHERE oi."orderId" = $1 AND oi."deletedAt" IS NULL AND oi."voidedAt" IS NULL
      `, orderId)

      if ((orderTotal[0]?.subtotal ?? 0) >= deliveryConfig.freeDeliveryMinimum) {
        deliveryFee = 0
      }
    }

    // Create delivery order
    const inserted: any[] = await db.$queryRawUnsafe(`
      INSERT INTO "DeliveryOrder" (
        "locationId", "orderId", "employeeId", "driverId", "zoneId",
        "customerName", "phone", "address", "addressLine2", "city", "state", "zipCode",
        "notes", "status", "deliveryFee", "estimatedMinutes", "scheduledFor",
        "trackingToken"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, 'pending', $14, $15, $16,
        gen_random_uuid()::text)
      RETURNING *
    `,
      locationId,
      orderId || null,
      employeeId || null,
      driverId || null,
      resolvedZoneId,
      customerName.trim(),
      phone?.trim() || null,
      address?.trim() || null,
      addressLine2?.trim() || null,
      city?.trim() || null,
      state?.trim() || null,
      zipCode?.trim() || null,
      notes?.trim() || null,
      deliveryFee,
      deliveryConfig.estimatedDeliveryMinutes,
      scheduledFor ? new Date(scheduledFor) : null,
    )

    const delivery = inserted[0]

    // If there's an orderId, update the order type to delivery
    if (orderId) {
      void OrderRepository.updateOrder(orderId, locationId, { orderType: 'delivery' }).catch(err => log.warn({ err }, 'Background task failed'))

      // Emit ORDER_METADATA_UPDATED for the order type change
      void emitOrderEvent(locationId, orderId, 'ORDER_METADATA_UPDATED', {
        orderType: 'delivery',
        deliveryOrderId: delivery.id,
        customerName: customerName.trim(),
        address: address?.trim() || null,
      }).catch(err => console.error('[delivery] Failed to emit ORDER_METADATA_UPDATED:', err))
    }

    pushUpstream()

    // Fire-and-forget socket dispatch
    void emitToLocation(locationId, 'delivery:updated', {
      action: 'created',
      deliveryId: delivery.id,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return NextResponse.json({
      data: {
        ...delivery,
        deliveryFee: Number(delivery.deliveryFee),
      },
      message: `Delivery order created. Estimated delivery: ${deliveryConfig.estimatedDeliveryMinutes} minutes.`,
    }, { status: 201 })
  } catch (error) {
    console.error('[Delivery] POST error:', error)
    return err('Failed to create delivery order', 500)
  }
})
