import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { dispatchFloorPlanUpdate, dispatchTableStatusChanged } from '@/lib/socket-dispatch'

export const dynamic = 'force-dynamic'

/**
 * GET /api/host/tables — All tables with real-time status for host view
 *
 * Includes: tableNumber, status, section, server, partySize, seatedAt,
 *           currentOrderTotal, estimatedTurnTime
 * Grouped by section.
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Fetch all active tables with their current order and server info
    const tables = await db.table.findMany({
      where: { locationId, isActive: true },
      include: {
        section: { select: { id: true, name: true, color: true, sortOrder: true } },
        _count: { select: { seats: true } },
      },
      orderBy: [{ section: { sortOrder: 'asc' } }, { name: 'asc' }],
    })

    // Get current open orders for each occupied table (batch query)
    const tableIds = tables.filter(t => t.status === 'occupied').map(t => t.id)

    let ordersByTable: Record<string, any> = {}
    if (tableIds.length > 0) {
      const orders = await db.order.findMany({
        where: {
          locationId,
          tableId: { in: tableIds },
          status: { in: ['open', 'pending', 'sent'] },
          deletedAt: null,
        },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true } },
        },
      })

      // Batch subtotal query — single query instead of N+1 per table
      const orderIds = orders.filter(o => o.tableId).map(o => o.id)
      const subtotalMap = new Map<string, number>()
      if (orderIds.length > 0) {
        const totals: { orderId: string; subtotal: number }[] = await db.$queryRawUnsafe(`
          SELECT oi."orderId", COALESCE(SUM(oi.price * oi.quantity), 0)::float as subtotal
          FROM "OrderItem" oi
          WHERE oi."orderId" = ANY($1::text[]) AND oi."deletedAt" IS NULL AND oi."voidedAt" IS NULL
          GROUP BY oi."orderId"
        `, orderIds)
        for (const row of totals) {
          subtotalMap.set(row.orderId, row.subtotal)
        }
      }

      for (const order of orders) {
        if (order.tableId) {
          ordersByTable[order.tableId] = {
            orderId: order.id,
            orderNumber: order.orderNumber,
            serverId: order.employeeId,
            serverName: order.employee ? `${order.employee.firstName} ${order.employee.lastName}`.trim() : null,
            guestCount: order.guestCount,
            subtotal: subtotalMap.get(order.id) ?? 0,
            seatedAt: order.createdAt,
          }
        }
      }
    }

    // Get average turn time from recent completed orders (last 7 days)
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const avgTurnResult: any[] = await db.$queryRawUnsafe(`
      SELECT AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt")) / 60)::float as avg_minutes
      FROM "Order"
      WHERE "locationId" = $1
        AND "tableId" IS NOT NULL
        AND status IN ('paid', 'closed', 'completed')
        AND "createdAt" >= $2
        AND "deletedAt" IS NULL
    `, locationId, sevenDaysAgo)

    const avgTurnMinutes = Math.round(avgTurnResult[0]?.avg_minutes ?? 45)

    // Build response grouped by section
    const sectionMap = new Map<string, {
      section: { id: string; name: string; color: string | null },
      tables: any[]
    }>()

    for (const table of tables) {
      const sectionId = table.sectionId || '__no_section__'
      const sectionName = table.section?.name || 'No Section'

      if (!sectionMap.has(sectionId)) {
        sectionMap.set(sectionId, {
          section: {
            id: sectionId,
            name: sectionName,
            color: table.section?.color ?? null,
          },
          tables: [],
        })
      }

      const orderInfo = ordersByTable[table.id]
      const seatedAt = orderInfo?.seatedAt ? new Date(orderInfo.seatedAt) : null
      let estimatedTurnMinutes: number | null = null

      if (seatedAt && table.status === 'occupied') {
        const elapsedMinutes = (Date.now() - seatedAt.getTime()) / 60000
        estimatedTurnMinutes = Math.max(0, Math.round(avgTurnMinutes - elapsedMinutes))
      }

      sectionMap.get(sectionId)!.tables.push({
        id: table.id,
        name: table.name,
        abbreviation: table.abbreviation,
        capacity: table._count.seats || table.capacity,
        status: table.status,
        sectionId: table.sectionId,
        shape: table.shape,
        // Current occupancy info
        orderId: orderInfo?.orderId ?? null,
        orderNumber: orderInfo?.orderNumber ?? null,
        serverId: orderInfo?.serverId ?? null,
        serverName: orderInfo?.serverName ?? null,
        partySize: orderInfo?.guestCount ?? null,
        seatedAt: seatedAt?.toISOString() ?? null,
        currentOrderTotal: orderInfo?.subtotal ?? null,
        estimatedTurnMinutes,
      })
    }

    // Get server rotation state for the host view
    const serverRotation: any[] = await db.$queryRawUnsafe(`
      SELECT sr."employeeId", e."firstName", e."lastName",
             sr."sectionId", s."name" as "sectionName",
             sr."tableCount", sr."lastSeatedAt", sr."isOnFloor"
      FROM "ServerRotationState" sr
      JOIN "Employee" e ON e.id = sr."employeeId"
      LEFT JOIN "Section" s ON s.id = sr."sectionId"
      WHERE sr."locationId" = $1 AND sr."isOnFloor" = true
        AND e."isActive" = true AND e."deletedAt" IS NULL
      ORDER BY sr."tableCount" ASC, sr."lastSeatedAt" ASC NULLS FIRST
    `, locationId)

    return NextResponse.json({
      data: {
        sections: Array.from(sectionMap.values()),
        avgTurnMinutes,
        serverRotation: serverRotation.map(sr => ({
          employeeId: sr.employeeId,
          name: `${sr.firstName} ${sr.lastName}`.trim(),
          sectionId: sr.sectionId,
          sectionName: sr.sectionName,
          tableCount: sr.tableCount,
          lastSeatedAt: sr.lastSeatedAt?.toISOString() ?? null,
          isOnFloor: sr.isOnFloor,
          isNextUp: false, // Populated below
        })),
        summary: {
          totalTables: tables.length,
          available: tables.filter(t => t.status === 'available').length,
          occupied: tables.filter(t => t.status === 'occupied').length,
          reserved: tables.filter(t => t.status === 'reserved').length,
          dirty: tables.filter(t => t.status === 'dirty').length,
        },
      },
    })
  } catch (error) {
    console.error('[Host/Tables] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch tables' }, { status: 500 })
  }
})

/**
 * PUT /api/host/tables — Update table status
 *
 * Payload: { tableId, status }
 * Valid statuses: available, dirty, reserved, in_use
 */
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const body = await request.json()
    const { tableId, status } = body

    if (!tableId || typeof tableId !== 'string') {
      return NextResponse.json({ error: 'tableId is required' }, { status: 400 })
    }

    const validStatuses = ['available', 'occupied', 'dirty', 'reserved', 'in_use']
    if (!status || !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      )
    }

    const table = await db.table.findFirst({
      where: { id: tableId, locationId, isActive: true },
    })

    if (!table) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }

    // If changing from occupied to available/dirty, decrement server table count
    if (table.status === 'occupied' && (status === 'available' || status === 'dirty')) {
      // Find the server for this table's order and decrement
      const activeOrder = await db.order.findFirst({
        where: {
          locationId,
          tableId,
          status: { in: ['open', 'pending', 'sent'] },
          deletedAt: null,
        },
        select: { employeeId: true },
      })

      if (activeOrder) {
        await db.$queryRawUnsafe(`
          UPDATE "ServerRotationState"
          SET "tableCount" = GREATEST("tableCount" - 1, 0), "updatedAt" = CURRENT_TIMESTAMP
          WHERE "locationId" = $1 AND "employeeId" = $2
        `, locationId, activeOrder.employeeId)
      }
    }

    await db.table.update({
      where: { id: tableId },
      data: { status },
    })

    // Fire-and-forget socket dispatches
    void dispatchFloorPlanUpdate(locationId, { async: true }).catch(console.error)
    void dispatchTableStatusChanged(locationId, { tableId, status }).catch(console.error)

    return NextResponse.json({
      data: { tableId, status },
      message: `Table status updated to ${status}`,
    })
  } catch (error) {
    console.error('[Host/Tables] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update table status' }, { status: 500 })
  }
})
