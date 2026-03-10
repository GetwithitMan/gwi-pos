import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { emitToLocation } from '@/lib/socket-server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/delivery/drivers — List available drivers
 *
 * Returns employees who have the 'driver' permission or role,
 * with their current delivery count and status.
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Get all active employees who could be drivers
    // A "driver" is any active employee (the host/manager assigns them)
    // In practice, filter to employees clocked in or with driver-related roles
    const drivers = await db.employee.findMany({
      where: {
        locationId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: { select: { name: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    })

    // Get active delivery counts per driver
    const activeCounts: any[] = await db.$queryRawUnsafe(`
      SELECT "driverId", COUNT(*)::int as "activeCount"
      FROM "DeliveryOrder"
      WHERE "locationId" = $1
        AND "driverId" IS NOT NULL
        AND status IN ('out_for_delivery')
      GROUP BY "driverId"
    `, locationId)

    const countMap = new Map(activeCounts.map(c => [c.driverId, c.activeCount]))

    // Get last delivery time per driver
    const lastDeliveries: any[] = await db.$queryRawUnsafe(`
      SELECT DISTINCT ON ("driverId") "driverId", "deliveredAt"
      FROM "DeliveryOrder"
      WHERE "locationId" = $1
        AND "driverId" IS NOT NULL
        AND status = 'delivered'
      ORDER BY "driverId", "deliveredAt" DESC
    `, locationId)

    const lastDeliveryMap = new Map(
      lastDeliveries.map(d => [d.driverId, d.deliveredAt?.toISOString() ?? null])
    )

    const enriched = drivers.map(d => {
      const activeCount = countMap.get(d.id) ?? 0
      return {
        id: d.id,
        name: `${d.firstName} ${d.lastName}`.trim(),
        phone: d.phone,
        role: d.role.name,
        activeDeliveryCount: activeCount,
        status: activeCount > 0 ? 'on_delivery' : 'available',
        lastDeliveryAt: lastDeliveryMap.get(d.id) ?? null,
      }
    })

    return NextResponse.json({ data: enriched })
  } catch (error) {
    console.error('[Delivery/Drivers] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch drivers' }, { status: 500 })
  }
})

/**
 * POST /api/delivery/drivers — Assign delivery to driver
 *
 * Payload: { deliveryId, driverId }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const body = await request.json()
    const { deliveryId, driverId } = body

    if (!deliveryId || !driverId) {
      return NextResponse.json({ error: 'deliveryId and driverId are required' }, { status: 400 })
    }

    // Verify delivery exists
    const delivery: any[] = await db.$queryRawUnsafe(`
      SELECT id, status FROM "DeliveryOrder"
      WHERE id = $1 AND "locationId" = $2
    `, deliveryId, locationId)

    if (!delivery.length) {
      return NextResponse.json({ error: 'Delivery order not found' }, { status: 404 })
    }

    if (delivery[0].status === 'delivered' || delivery[0].status === 'cancelled') {
      return NextResponse.json({ error: 'Cannot assign driver to a completed or cancelled delivery' }, { status: 400 })
    }

    // Verify driver exists
    const driver = await db.employee.findFirst({
      where: { id: driverId, locationId, isActive: true, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    })

    if (!driver) {
      return NextResponse.json({ error: 'Driver not found' }, { status: 404 })
    }

    // Assign driver
    const updated: any[] = await db.$queryRawUnsafe(`
      UPDATE "DeliveryOrder"
      SET "driverId" = $1, "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = $2 AND "locationId" = $3
      RETURNING *
    `, driverId, deliveryId, locationId)

    // Fire-and-forget socket dispatch
    void emitToLocation(locationId, 'delivery:updated', {
      action: 'driver_assigned',
      deliveryId,
      driverId,
      driverName: `${driver.firstName} ${driver.lastName}`.trim(),
    }).catch(console.error)

    return NextResponse.json({
      data: {
        ...updated[0],
        deliveryFee: Number(updated[0]?.deliveryFee ?? 0),
        driverName: `${driver.firstName} ${driver.lastName}`.trim(),
      },
      message: `Assigned to ${driver.firstName} ${driver.lastName}`,
    })
  } catch (error) {
    console.error('[Delivery/Drivers] POST error:', error)
    return NextResponse.json({ error: 'Failed to assign driver' }, { status: 500 })
  }
})
