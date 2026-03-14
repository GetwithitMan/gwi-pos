import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId, getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_DELIVERY } from '@/lib/settings'
import { emitToLocation } from '@/lib/socket-server'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

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
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

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

    return NextResponse.json({ data: enriched })
  } catch (error) {
    console.error('[Delivery] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch delivery orders' }, { status: 500 })
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
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const deliveryConfig = settings.delivery ?? DEFAULT_DELIVERY

    if (!deliveryConfig.enabled) {
      return NextResponse.json({ error: 'Delivery is not enabled' }, { status: 400 })
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
    } = body

    // Validate required fields
    if (!customerName || typeof customerName !== 'string' || customerName.trim().length === 0) {
      return NextResponse.json({ error: 'Customer name is required' }, { status: 400 })
    }

    if (deliveryConfig.requirePhone && (!phone || typeof phone !== 'string' || phone.trim().length === 0)) {
      return NextResponse.json({ error: 'Phone number is required for delivery orders' }, { status: 400 })
    }

    if (deliveryConfig.requireAddress && (!address || typeof address !== 'string' || address.trim().length === 0)) {
      return NextResponse.json({ error: 'Address is required for delivery orders' }, { status: 400 })
    }

    // Check max active deliveries
    const activeCount: any[] = await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int as count
      FROM "DeliveryOrder"
      WHERE "locationId" = $1
        AND status IN ('pending', 'preparing', 'ready_for_pickup', 'out_for_delivery')
    `, locationId)

    if ((activeCount[0]?.count ?? 0) >= deliveryConfig.maxActiveDeliveries) {
      return NextResponse.json(
        { error: `Maximum active deliveries reached (${deliveryConfig.maxActiveDeliveries})` },
        { status: 409 }
      )
    }

    // Calculate delivery fee
    let deliveryFee = deliveryConfig.deliveryFee

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
        "locationId", "orderId", "employeeId", "driverId",
        "customerName", "phone", "address", "addressLine2", "city", "state", "zipCode",
        "notes", "status", "deliveryFee", "estimatedMinutes", "scheduledFor"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', $13, $14, $15)
      RETURNING *
    `,
      locationId,
      orderId || null,
      employeeId || null,
      driverId || null,
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
      void db.order.updateMany({
        where: { id: orderId, locationId },
        data: { orderType: 'delivery' },
      }).catch(console.error)
    }

    // Fire-and-forget socket dispatch
    void emitToLocation(locationId, 'delivery:updated', {
      action: 'created',
      deliveryId: delivery.id,
    }).catch(console.error)

    return NextResponse.json({
      data: {
        ...delivery,
        deliveryFee: Number(delivery.deliveryFee),
      },
      message: `Delivery order created. Estimated delivery: ${deliveryConfig.estimatedDeliveryMinutes} minutes.`,
    }, { status: 201 })
  } catch (error) {
    console.error('[Delivery] POST error:', error)
    return NextResponse.json({ error: 'Failed to create delivery order' }, { status: 500 })
  }
})
