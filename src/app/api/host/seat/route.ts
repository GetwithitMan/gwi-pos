import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { EmployeeRepository, OrderRepository } from '@/lib/repositories'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { getLocationId, getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_HOST_VIEW } from '@/lib/settings'
import { getNextServer, buildServerInfoList } from '@/lib/host/server-rotation'
import { dispatchFloorPlanUpdate, dispatchWaitlistChanged, dispatchTableStatusChanged, dispatchReservationChanged } from '@/lib/socket-dispatch'
import { transition } from '@/lib/reservations/state-machine'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('host-seat')

export const dynamic = 'force-dynamic'

/**
 * POST /api/host/seat — Seat a party at a table
 *
 * Sets table status to 'occupied', updates waitlist/reservation,
 * auto-assigns server via rotation engine if no serverId provided,
 * creates or links an order for the table.
 */
export const POST = withVenue(withAuth(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const hostConfig = settings.hostView ?? DEFAULT_HOST_VIEW

    const body = await request.json()
    const { tableId, partySize, waitlistEntryId, reservationId, serverId, guestName } = body

    if (!tableId || typeof tableId !== 'string') {
      return NextResponse.json({ error: 'tableId is required' }, { status: 400 })
    }

    const size = Number(partySize) || 1

    // Verify the table exists and is available
    const table = await db.table.findFirst({
      where: { id: tableId, locationId, isActive: true },
      include: { section: { select: { id: true, name: true } } },
    })

    if (!table) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }

    if (table.status === 'occupied') {
      return NextResponse.json({ error: 'Table is already occupied' }, { status: 409 })
    }

    // Determine which server to assign
    let assignedServerId = serverId || null

    if (!assignedServerId && hostConfig.autoRotateServers) {
      // Fetch rotation state for eligible servers
      const rotationRows: any[] = await db.$queryRawUnsafe(`
        SELECT sr."employeeId", e."firstName", e."lastName",
               sr."sectionId", sr."tableCount", sr."lastSeatedAt", sr."isOnFloor"
        FROM "ServerRotationState" sr
        JOIN "Employee" e ON e.id = sr."employeeId"
        WHERE sr."locationId" = $1 AND sr."isOnFloor" = true
          AND e."isActive" = true AND e."deletedAt" IS NULL
        ORDER BY sr."tableCount" ASC, sr."lastSeatedAt" ASC NULLS FIRST
      `, locationId)

      if (rotationRows.length > 0) {
        const serverInfos = buildServerInfoList(rotationRows)
        const nextServer = getNextServer(serverInfos, table.sectionId, {
          sectionBased: hostConfig.sectionBased,
          autoRotate: hostConfig.autoRotateServers,
        })
        if (nextServer) {
          assignedServerId = nextServer.employeeId
        }
      }
    }

    // If still no server, try to find any active server/bartender
    if (!assignedServerId) {
      const fallbackServer = await db.employee.findFirst({
        where: {
          locationId,
          isActive: true,
          deletedAt: null,
          role: { name: { in: ['Server', 'Bartender', 'Manager', 'Super Admin'] } },
        },
        select: { id: true },
      })
      assignedServerId = fallbackServer?.id || null
    }

    // Update table status to occupied
    await db.table.update({
      where: { id: tableId },
      data: { status: 'occupied' },
    })

    // Update waitlist entry if provided
    if (waitlistEntryId) {
      await db.$queryRawUnsafe(`
        UPDATE "WaitlistEntry"
        SET status = 'seated', "seatedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1 AND "locationId" = $2 AND status IN ('waiting', 'notified')
      `, waitlistEntryId, locationId)

      // Recalculate positions
      await db.$queryRawUnsafe(`
        WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY position ASC, "createdAt" ASC) as new_pos
          FROM "WaitlistEntry"
          WHERE "locationId" = $1 AND status IN ('waiting', 'notified')
        )
        UPDATE "WaitlistEntry" w
        SET position = r.new_pos
        FROM ranked r
        WHERE w.id = r.id
      `, locationId)

      void dispatchWaitlistChanged(locationId, {
        action: 'seated',
        entryId: waitlistEntryId,
        customerName: guestName || 'Guest',
        partySize: size,
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Update reservation via state machine if provided
    if (reservationId) {
      // Verify reservation belongs to this location
      const resCheck = await db.reservation.findFirst({
        where: { id: reservationId, locationId },
        select: { id: true },
      })
      if (!resCheck) {
        return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
      }
      try {
        await db.$transaction(async (tx: any) => {
          // Update table assignment first
          await tx.reservation.update({
            where: { id: reservationId },
            data: { tableId },
          })
          // Transition status via state machine (handles audit events + socket)
          return transition({
            reservationId,
            to: 'seated',
            actor: { type: 'staff', id: assignedServerId || undefined },
            db: tx,
            locationId,
          })
        })
      } catch (err) {
        // Non-fatal — log but don't block seating
        console.warn('[Host/Seat] Reservation transition failed:', err)
      }
    }

    // Check for an existing open order on this table (tenant-scoped)
    const existingTableOrders = await OrderRepository.getActiveOrdersForTable(tableId, locationId)
    let order: { id: string; orderNumber: number } | null =
      existingTableOrders.length > 0
        ? { id: existingTableOrders[0].id, orderNumber: existingTableOrders[0].orderNumber }
        : null

    // Create a new order if none exists
    if (!order && assignedServerId) {
      // Get next order number
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const maxOrder: any[] = await db.$queryRawUnsafe(`
        SELECT COALESCE(MAX("orderNumber"), 0) + 1 as next_num
        FROM "Order"
        WHERE "locationId" = $1 AND "createdAt" >= $2
      `, locationId, todayStart)
      const nextNum = maxOrder[0]?.next_num ?? 1

      order = await db.order.create({
        data: {
          locationId,
          employeeId: assignedServerId,
          orderNumber: nextNum,
          orderType: 'dine_in',
          tableId,
          guestCount: size,
          status: 'open',
          lastMutatedBy: 'local',
        },
        select: { id: true, orderNumber: true },
      })

      // Emit ORDER_CREATED event for the new order
      void emitOrderEvent(locationId, order.id, 'ORDER_CREATED', {
        locationId,
        employeeId: assignedServerId,
        orderType: 'dine_in',
        tableId,
        tabName: null,
        guestCount: size,
        orderNumber: nextNum,
      }).catch(err => console.error('[host/seat] Failed to emit ORDER_CREATED event:', err))
    }

    // Update server rotation state (increment table count, update lastSeatedAt)
    if (assignedServerId) {
      await db.$queryRawUnsafe(`
        INSERT INTO "ServerRotationState" ("locationId", "employeeId", "sectionId", "tableCount", "lastSeatedAt", "isOnFloor")
        VALUES ($1, $2, $3, 1, CURRENT_TIMESTAMP, true)
        ON CONFLICT ("locationId", "employeeId")
        DO UPDATE SET
          "tableCount" = "ServerRotationState"."tableCount" + 1,
          "lastSeatedAt" = CURRENT_TIMESTAMP,
          "updatedAt" = CURRENT_TIMESTAMP
      `, locationId, assignedServerId, table.sectionId)
    }

    pushUpstream()

    // Fire-and-forget socket dispatches
    void dispatchFloorPlanUpdate(locationId, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
    void dispatchTableStatusChanged(locationId, { tableId, status: 'occupied' }).catch(err => log.warn({ err }, 'Background task failed'))
    if (reservationId) {
      void dispatchReservationChanged(locationId, {
        reservationId, action: 'seated',
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Fetch assigned server name for response
    let serverName: string | null = null
    if (assignedServerId) {
      const emp = await EmployeeRepository.getEmployeeByIdWithSelect(assignedServerId, locationId, {
        firstName: true, lastName: true,
      })
      if (emp) serverName = `${emp.firstName} ${emp.lastName}`.trim()
    }

    return NextResponse.json({
      data: {
        tableId,
        tableName: table.name,
        sectionName: table.section?.name ?? null,
        partySize: size,
        serverId: assignedServerId,
        serverName,
        orderId: order?.id ?? null,
        orderNumber: order?.orderNumber ?? null,
        waitlistEntryId: waitlistEntryId ?? null,
        reservationId: reservationId ?? null,
      },
      message: `Seated party of ${size} at ${table.name}${serverName ? ` (Server: ${serverName})` : ''}`,
    }, { status: 201 })
  } catch (error) {
    console.error('[Host/Seat] POST error:', error)
    return NextResponse.json({ error: 'Failed to seat party' }, { status: 500 })
  }
}))
