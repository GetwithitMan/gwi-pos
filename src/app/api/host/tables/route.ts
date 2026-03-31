import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { getLocationId } from '@/lib/location-cache'
import { dispatchFloorPlanUpdate, dispatchTableStatusChanged } from '@/lib/socket-dispatch'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('host-tables')

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
      return err('No location found')
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

    const ordersByTable: Record<string, any> = {}
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
        const totals: { orderId: string; subtotal: number }[] = await db.$queryRaw`
          SELECT oi."orderId", COALESCE(SUM(oi.price * oi.quantity), 0)::float as subtotal
          FROM "OrderItem" oi
          WHERE oi."orderId" = ANY(${orderIds}::text[]) AND oi."deletedAt" IS NULL AND oi."voidedAt" IS NULL
          GROUP BY oi."orderId"
        `
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

    const avgTurnResult: any[] = await db.$queryRaw`
      SELECT AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt")) / 60)::float as avg_minutes
      FROM "Order"
      WHERE "locationId" = ${locationId}
        AND "tableId" IS NOT NULL
        AND status IN ('paid', 'closed', 'completed')
        AND "createdAt" >= ${sevenDaysAgo}
        AND "deletedAt" IS NULL
    `

    const avgTurnMinutes = Math.round(avgTurnResult[0]?.avg_minutes ?? 45)

    // Fetch upcoming reservations for today (next 2 hours, assigned to a table)
    const now = new Date()
    const nowHH = String(now.getHours()).padStart(2, '0')
    const nowMM = String(now.getMinutes()).padStart(2, '0')
    const nowTimeStr = `${nowHH}:${nowMM}`
    const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000)
    const laterHH = String(twoHoursLater.getHours()).padStart(2, '0')
    const laterMM = String(twoHoursLater.getMinutes()).padStart(2, '0')
    const laterTimeStr = `${laterHH}:${laterMM}`

    const upcomingReservations = await db.reservation.findMany({
      where: {
        locationId,
        reservationDate: {
          gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
          lt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
        },
        status: { in: ['confirmed', 'checked_in', 'pending'] },
        tableId: { not: null },
        deletedAt: null,
        reservationTime: { gte: nowTimeStr, lte: laterTimeStr },
      },
      select: {
        id: true,
        guestName: true,
        partySize: true,
        reservationTime: true,
        status: true,
        tableId: true,
      },
      orderBy: { reservationTime: 'asc' },
    })

    // Build reservation-by-table map (first upcoming per table)
    const reservationByTable = new Map<string, { id: string; guestName: string; partySize: number; reservationTime: string; status: string }>()
    for (const r of upcomingReservations) {
      if (r.tableId && !reservationByTable.has(r.tableId)) {
        reservationByTable.set(r.tableId, {
          id: r.id,
          guestName: r.guestName,
          partySize: r.partySize,
          reservationTime: r.reservationTime,
          status: r.status,
        })
      }
    }

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
        upcomingReservation: reservationByTable.get(table.id) ?? null,
      })
    }

    // Get server rotation state for the host view
    const serverRotation: any[] = await db.$queryRaw`
      SELECT sr."employeeId", e."firstName", e."lastName",
             sr."sectionId", s."name" as "sectionName",
             sr."tableCount", sr."lastSeatedAt", sr."isOnFloor"
      FROM "ServerRotationState" sr
      JOIN "Employee" e ON e.id = sr."employeeId"
      LEFT JOIN "Section" s ON s.id = sr."sectionId"
      WHERE sr."locationId" = ${locationId} AND sr."isOnFloor" = true
        AND e."isActive" = true AND e."deletedAt" IS NULL
      ORDER BY sr."tableCount" ASC, sr."lastSeatedAt" ASC NULLS FIRST
    `

    return ok({
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
      })
  } catch (error) {
    console.error('[Host/Tables] GET error:', error)
    return err('Failed to fetch tables', 500)
  }
})

/**
 * PUT /api/host/tables — Update table status
 *
 * Payload: { tableId, status }
 * Valid statuses: available, dirty, reserved, in_use
 */
export const PUT = withVenue(withAuth(async function PUT(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const body = await request.json()
    const { tableId, status } = body

    if (!tableId || typeof tableId !== 'string') {
      return err('tableId is required')
    }

    const validStatuses = ['available', 'occupied', 'dirty', 'reserved', 'in_use']
    if (!status || !validStatuses.includes(status)) {
      return err(`Invalid status. Must be one of: ${validStatuses.join(', ')}`)
    }

    const table = await db.table.findFirst({
      where: { id: tableId, locationId, isActive: true },
    })

    if (!table) {
      return notFound('Table not found')
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
        await db.$queryRaw`
          UPDATE "ServerRotationState"
          SET "tableCount" = GREATEST("tableCount" - 1, 0), "updatedAt" = CURRENT_TIMESTAMP
          WHERE "locationId" = ${locationId} AND "employeeId" = ${activeOrder.employeeId}
        `
      }
    }

    await db.table.update({
      where: { id: tableId },
      data: { status },
    })

    pushUpstream()

    // Fire-and-forget socket dispatches
    void dispatchFloorPlanUpdate(locationId, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
    void dispatchTableStatusChanged(locationId, { tableId, status }).catch(err => log.warn({ err }, 'Background task failed'))

    return NextResponse.json({
      data: { tableId, status },
      message: `Table status updated to ${status}`,
    })
  } catch (error) {
    console.error('[Host/Tables] PUT error:', error)
    return err('Failed to update table status', 500)
  }
}))
