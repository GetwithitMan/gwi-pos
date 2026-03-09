import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { getLocationSettings } from '@/lib/location-cache'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { routeOrderFulfillment, type FulfillmentItem, type FulfillmentStationConfig, type OriginDevice } from '@/lib/fulfillment-router'

// ─── Types ──────────────────────────────────────────────────────────────

type CartEventType = 'ORDER_STARTED' | 'ITEM_ADDED' | 'ITEM_REMOVED' | 'ORDER_SENT'

interface CartEvent {
  eventId: string
  orderId: string
  sequence: number
  eventType: CartEventType
  payload: string // JSON string
  timestamp: number // epoch ms
}

interface ReplayError {
  eventId: string
  error: string
}

// ─── In-memory idempotency cache (per-process) ─────────────────────────
// Tracks recently processed eventIds to skip duplicates.
// Bounded to prevent memory leaks — evicts oldest entries past limit.
const processedEventIds = new Map<string, number>() // eventId → timestamp
const MAX_CACHE_SIZE = 10_000

function markProcessed(eventId: string): void {
  if (processedEventIds.size >= MAX_CACHE_SIZE) {
    // Evict oldest 20%
    const entries = [...processedEventIds.entries()]
      .sort((a, b) => a[1] - b[1])
    const evictCount = Math.floor(MAX_CACHE_SIZE * 0.2)
    for (let i = 0; i < evictCount; i++) {
      processedEventIds.delete(entries[i][0])
    }
  }
  processedEventIds.set(eventId, Date.now())
}

function wasProcessed(eventId: string): boolean {
  return processedEventIds.has(eventId)
}

// ─── POST /api/orders/replay-cart-events ────────────────────────────────

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const events: CartEvent[] = body?.events

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json(
        { error: 'Request body must contain a non-empty "events" array' },
        { status: 400 }
      )
    }

    // Validate each event has required fields
    for (const evt of events) {
      if (!evt.eventId || !evt.orderId || evt.sequence == null || !evt.eventType || !evt.payload) {
        return NextResponse.json(
          { error: `Event missing required fields: eventId, orderId, sequence, eventType, payload`, details: { eventId: evt.eventId } },
          { status: 400 }
        )
      }
    }

    // ── Auth: require valid employee session OR cellular token ──────────
    const isCellularOrigin = request.headers.get('x-cellular-authenticated') === '1'
    const originTerminalId = request.headers.get('x-terminal-id') || null

    // For cellular tokens the employeeId comes from the first ORDER_STARTED payload.
    // For session auth we pull it from the body or header.
    let authEmployeeId: string | null = null
    let authLocationId: string | null = null

    if (isCellularOrigin) {
      // Cellular path: extract employeeId + locationId from the first ORDER_STARTED event
      const firstStart = events.find(e => e.eventType === 'ORDER_STARTED')
      if (firstStart) {
        try {
          const startPayload = JSON.parse(firstStart.payload)
          authEmployeeId = startPayload.employeeId || null
          authLocationId = startPayload.locationId || null
        } catch { /* parsed below per-event */ }
      }
    }

    // Fall back to body-level identifiers (Android sends these)
    if (!authEmployeeId) authEmployeeId = body.employeeId || request.headers.get('x-employee-id') || null
    if (!authLocationId) authLocationId = body.locationId || request.headers.get('x-location-id') || null

    if (!authEmployeeId || !authLocationId) {
      return NextResponse.json(
        { error: 'Could not determine employeeId and locationId from request' },
        { status: 401 }
      )
    }

    // Permission check
    const auth = await requirePermission(authEmployeeId, authLocationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    const locationId = authLocationId

    // Cellular mutation fields
    const cellularMutationFields = isCellularOrigin
      ? { lastMutatedBy: 'cloud', originTerminalId }
      : { lastMutatedBy: 'local', originTerminalId: null as string | null }

    // Business day
    const locSettings = await getLocationSettings(locationId) as Record<string, unknown> | null
    const dayStartTime = (locSettings?.businessDay as Record<string, unknown> | null)?.dayStartTime as string | undefined ?? '04:00'
    const businessDayStart = getCurrentBusinessDay(dayStartTime).start

    // ── Sort + group events by orderId, then by sequence ────────────────
    const sorted = [...events].sort((a, b) => {
      if (a.orderId !== b.orderId) return a.orderId.localeCompare(b.orderId)
      return a.sequence - b.sequence
    })

    const groups = new Map<string, CartEvent[]>()
    for (const evt of sorted) {
      const list = groups.get(evt.orderId) || []
      list.push(evt)
      groups.set(evt.orderId, list)
    }

    // ── Replay each order group ─────────────────────────────────────────
    let processed = 0
    let skipped = 0
    const errors: ReplayError[] = []

    for (const [clientOrderId, orderEvents] of groups) {
      try {
        await db.$transaction(async (tx) => {
          // Track the server-side order ID (may differ from clientOrderId)
          let serverOrderId: string | null = null

          for (const evt of orderEvents) {
            // Idempotency: skip already-processed events
            if (wasProcessed(evt.eventId)) {
              skipped++
              continue
            }

            let payload: any
            try {
              payload = JSON.parse(evt.payload)
            } catch {
              errors.push({ eventId: evt.eventId, error: 'Invalid JSON in payload' })
              continue
            }

            switch (evt.eventType) {
              case 'ORDER_STARTED': {
                // Check if order already exists (idempotency for ORDER_STARTED)
                const existing = await tx.order.findFirst({
                  where: {
                    locationId,
                    // Match by clientOrderId stored in customFields or by looking up
                    // the order with same employee + tabName created in this business day
                    id: clientOrderId,
                  },
                  select: { id: true },
                })

                if (existing) {
                  serverOrderId = existing.id
                  skipped++
                  markProcessed(evt.eventId)
                  continue
                }

                // Get next order number atomically
                const lastOrderRows = await tx.$queryRawUnsafe<{ orderNumber: number }[]>(
                  `SELECT "orderNumber" FROM "Order" WHERE "locationId" = $1 AND "parentOrderId" IS NULL ORDER BY "orderNumber" DESC LIMIT 1 FOR UPDATE`,
                  locationId
                )
                const orderNumber = ((lastOrderRows as any[])[0]?.orderNumber ?? 0) + 1

                const initialSeatCount = payload.guestCount || 1
                const now = new Date().toISOString()
                const seatTimestamps: Record<string, string> = {}
                for (let i = 1; i <= initialSeatCount; i++) {
                  seatTimestamps[i.toString()] = now
                }

                const order = await tx.order.create({
                  data: {
                    id: clientOrderId, // Use client-provided ID for correlation
                    locationId,
                    employeeId: payload.employeeId || authEmployeeId,
                    orderNumber,
                    orderType: payload.orderType || 'dine_in',
                    tableId: payload.tableId || null,
                    tabName: payload.tabName || null,
                    guestCount: initialSeatCount,
                    baseSeatCount: initialSeatCount,
                    extraSeatCount: 0,
                    seatVersion: 0,
                    seatTimestamps,
                    status: 'draft',
                    subtotal: 0,
                    discountTotal: 0,
                    taxTotal: 0,
                    taxFromInclusive: 0,
                    taxFromExclusive: 0,
                    tipTotal: 0,
                    total: 0,
                    commissionTotal: 0,
                    businessDayDate: businessDayStart,
                    ...cellularMutationFields,
                  },
                })

                serverOrderId = order.id

                // Fire-and-forget audit log
                void db.auditLog.create({
                  data: {
                    locationId,
                    employeeId: payload.employeeId || authEmployeeId,
                    action: 'order_replay_created',
                    entityType: 'order',
                    entityId: order.id,
                    details: { orderNumber, orderType: payload.orderType, source: isCellularOrigin ? 'cellular' : 'offline' },
                  },
                }).catch(() => {})

                // Emit event (fire-and-forget)
                void emitOrderEvent(locationId, order.id, 'ORDER_CREATED', {
                  locationId,
                  employeeId: payload.employeeId || authEmployeeId,
                  orderType: payload.orderType || 'dine_in',
                  tableId: payload.tableId || null,
                  guestCount: initialSeatCount,
                  orderNumber,
                  displayNumber: null,
                })

                processed++
                markProcessed(evt.eventId)
                break
              }

              case 'ITEM_ADDED': {
                const targetOrderId = serverOrderId || clientOrderId

                // Validate menu item exists
                const menuItem = await tx.menuItem.findUnique({
                  where: { id: payload.menuItemId },
                  select: { id: true, name: true, price: true, fulfillmentType: true, fulfillmentStationId: true },
                })

                if (!menuItem) {
                  errors.push({ eventId: evt.eventId, error: `MenuItem ${payload.menuItemId} not found` })
                  continue
                }

                const quantity = payload.quantity || 1
                const price = payload.price ?? Number(menuItem.price)
                const itemTotal = price * quantity

                const modifierData = Array.isArray(payload.modifiers)
                  ? payload.modifiers.map((mod: any) => ({
                      locationId,
                      modifierId: mod.modifierId || null,
                      name: mod.name,
                      price: mod.price || 0,
                      quantity: 1,
                    }))
                  : []

                await tx.orderItem.create({
                  data: {
                    locationId,
                    orderId: targetOrderId,
                    menuItemId: payload.menuItemId,
                    name: menuItem.name,
                    price,
                    quantity,
                    itemTotal,
                    specialNotes: payload.notes || null,
                    seatNumber: payload.seatNumber || null,
                    ...(modifierData.length > 0 ? {
                      modifiers: { create: modifierData },
                    } : {}),
                    ...cellularMutationFields,
                  },
                })

                // Update order subtotal and total
                await tx.order.update({
                  where: { id: targetOrderId },
                  data: {
                    subtotal: { increment: itemTotal },
                    total: { increment: itemTotal },
                    itemCount: { increment: quantity },
                    version: { increment: 1 },
                  },
                })

                processed++
                markProcessed(evt.eventId)
                break
              }

              case 'ITEM_REMOVED': {
                const targetOrderId = serverOrderId || clientOrderId

                if (!payload.orderItemId) {
                  errors.push({ eventId: evt.eventId, error: 'orderItemId required for ITEM_REMOVED' })
                  continue
                }

                const item = await tx.orderItem.findUnique({
                  where: { id: payload.orderItemId },
                  select: { id: true, orderId: true, itemTotal: true, quantity: true, deletedAt: true },
                })

                if (!item || item.orderId !== targetOrderId) {
                  errors.push({ eventId: evt.eventId, error: `OrderItem ${payload.orderItemId} not found on this order` })
                  continue
                }

                if (item.deletedAt) {
                  // Already deleted — idempotent
                  skipped++
                  markProcessed(evt.eventId)
                  continue
                }

                // Soft delete
                await tx.orderItem.update({
                  where: { id: payload.orderItemId },
                  data: { deletedAt: new Date() },
                })

                // Decrement order totals
                await tx.order.update({
                  where: { id: targetOrderId },
                  data: {
                    subtotal: { decrement: Number(item.itemTotal) },
                    total: { decrement: Number(item.itemTotal) },
                    itemCount: { decrement: item.quantity },
                    version: { increment: 1 },
                  },
                })

                processed++
                markProcessed(evt.eventId)
                break
              }

              case 'ORDER_SENT': {
                const targetOrderId = serverOrderId || clientOrderId

                // Transition to open + mark items as sent
                await tx.order.update({
                  where: { id: targetOrderId },
                  data: {
                    status: 'open',
                    version: { increment: 1 },
                  },
                })

                const now = new Date()
                await tx.orderItem.updateMany({
                  where: {
                    orderId: targetOrderId,
                    kitchenStatus: 'pending',
                    isHeld: false,
                    deletedAt: null,
                  },
                  data: {
                    kitchenStatus: 'sent',
                    firedAt: now,
                  },
                })

                // Fire-and-forget fulfillment routing
                void (async () => {
                  try {
                    const sentItems = await db.orderItem.findMany({
                      where: { orderId: targetOrderId, kitchenStatus: 'sent', deletedAt: null },
                      include: { menuItem: { select: { id: true, name: true, fulfillmentType: true, fulfillmentStationId: true } } },
                    })

                    const fulfillmentItems: FulfillmentItem[] = sentItems.map(item => ({
                      id: item.id,
                      menuItemId: item.menuItem?.id || item.menuItemId,
                      name: item.name,
                      quantity: item.quantity,
                      modifiers: [],
                      fulfillmentType: (item.menuItem as any)?.fulfillmentType ?? 'KITCHEN_STATION',
                      fulfillmentStationId: (item.menuItem as any)?.fulfillmentStationId ?? null,
                    }))

                    const stations = await db.station.findMany({
                      where: { locationId, isActive: true, deletedAt: null },
                      select: { id: true, name: true, type: true, tags: true, isDefault: true, isActive: true },
                    })
                    const stationConfigs: FulfillmentStationConfig[] = stations.map(s => ({
                      id: s.id,
                      name: s.name,
                      type: s.type as 'PRINTER' | 'KDS',
                      tags: Array.isArray(s.tags) ? (s.tags as string[]) : [],
                      isDefault: s.isDefault,
                      isActive: s.isActive,
                    }))

                    const originDevice: OriginDevice | undefined = isCellularOrigin
                      ? { terminalId: originTerminalId || undefined, type: 'cellular' }
                      : undefined

                    await routeOrderFulfillment(
                      { id: targetOrderId, locationId },
                      fulfillmentItems,
                      stationConfigs,
                      new Date().toISOString(),
                      originDevice,
                    )
                  } catch (err) {
                    console.error('[replay-cart-events] Fulfillment routing failed:', err)
                  }
                })()

                // Emit ORDER_SENT event (fire-and-forget)
                void emitOrderEvent(locationId, targetOrderId, 'ORDER_SENT', {
                  sentItemIds: [],
                })

                // Dispatch open orders update (fire-and-forget)
                void dispatchOpenOrdersChanged(locationId, { trigger: 'sent', orderId: targetOrderId }, { async: true }).catch(() => {})

                processed++
                markProcessed(evt.eventId)
                break
              }

              default:
                errors.push({ eventId: evt.eventId, error: `Unknown eventType: ${evt.eventType}` })
            }
          }
        })
      } catch (txErr) {
        // Transaction failed for this order group — record errors for all events in the group
        const errMsg = txErr instanceof Error ? txErr.message : 'Transaction failed'
        for (const evt of orderEvents) {
          if (!wasProcessed(evt.eventId)) {
            errors.push({ eventId: evt.eventId, error: errMsg })
          }
        }
      }
    }

    return NextResponse.json({
      data: {
        processed,
        skipped,
        errors,
      },
    })
  } catch (error) {
    console.error('[replay-cart-events] Failed to replay cart events:', error)
    return NextResponse.json(
      { error: 'Failed to replay cart events' },
      { status: 500 }
    )
  }
})
