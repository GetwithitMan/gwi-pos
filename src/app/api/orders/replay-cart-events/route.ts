import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { OrderRepository, OrderItemRepository } from '@/lib/repositories'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { getLocationSettings, getLocationTimezone } from '@/lib/location-cache'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { routeOrderFulfillment, type FulfillmentItem, type FulfillmentStationConfig, type OriginDevice } from '@/lib/fulfillment-router'
import { getLocationTaxRate, calculateSplitTax, isItemTaxInclusive, type TaxInclusiveSettings } from '@/lib/order-calculations'
import { roundToCents } from '@/lib/pricing'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, ok, unauthorized } from '@/lib/api-response'

const log = createChildLogger('orders.replay-cart-events')

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

// ─── In-memory idempotency cache (per-process, L1) ──────────────────────
// Fast path — avoids DB round-trip for events already seen this process.
// L2 (DB-backed) catches duplicates after server restart / cold start.
const processedEventIds = new Map<string, number>() // eventId → timestamp
const MAX_CACHE_SIZE = 10_000
const EVENT_TTL_MS = 60 * 60 * 1000 // 1 hour

function markProcessedLocal(eventId: string): void {
  if (processedEventIds.size >= MAX_CACHE_SIZE) {
    const entries = [...processedEventIds.entries()]
      .sort((a, b) => a[1] - b[1])
    const evictCount = Math.floor(MAX_CACHE_SIZE * 0.2)
    for (let i = 0; i < evictCount; i++) {
      processedEventIds.delete(entries[i][0])
    }
  }
  processedEventIds.set(eventId, Date.now())
}

// Periodic TTL-based cleanup: remove entries older than 1 hour every 10 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, timestamp] of processedEventIds) {
      if (now - timestamp > EVENT_TTL_MS) {
        processedEventIds.delete(key)
      }
    }
  }, 10 * 60 * 1000)
}

let dedupTableReady = false

async function ensureDedupTable(): Promise<void> {
  if (dedupTableReady) return
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_processed_cart_events" (
      "eventId" TEXT PRIMARY KEY,
      "processedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  dedupTableReady = true
}

// wasProcessedInDb / markProcessedInDb removed — atomic claim in the tx loop handles both

// ─── POST /api/orders/replay-cart-events ────────────────────────────────

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const events: CartEvent[] = body?.events

    await ensureDedupTable()

    if (!Array.isArray(events) || events.length === 0) {
      return err('Request body must contain a non-empty "events" array')
    }

    // Validate each event has required fields
    for (const evt of events) {
      if (!evt.eventId || !evt.orderId || evt.sequence == null || !evt.eventType || !evt.payload) {
        return err(`Event missing required fields: eventId, orderId, sequence, eventType, payload`, 400, { eventId: evt.eventId })
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

    // Fall back to body-level identifiers (Android sends these).
    // For cellular requests, the proxy-verified x-location-id header (set from JWT)
    // MUST take priority over the untrusted body value.
    if (!authEmployeeId) authEmployeeId = body.employeeId || request.headers.get('x-employee-id') || null
    if (!authLocationId) {
      authLocationId = isCellularOrigin
        ? (request.headers.get('x-location-id') || body.locationId || null)
        : (body.locationId || request.headers.get('x-location-id') || null)
    }

    if (!authEmployeeId || !authLocationId) {
      return unauthorized('Could not determine employeeId and locationId from request')
    }

    // Permission check
    const auth = await requirePermission(authEmployeeId, authLocationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }
    const locationId = authLocationId

    // Cellular mutation fields
    const cellularMutationFields = isCellularOrigin
      ? { lastMutatedBy: 'cloud', originTerminalId }
      : { lastMutatedBy: 'local', originTerminalId: null as string | null }

    // Business day
    const locSettings = await getLocationSettings(locationId) as Record<string, unknown> | null
    const dayStartTime = (locSettings?.businessDay as Record<string, unknown> | null)?.dayStartTime as string | undefined ?? '04:00'
    // TZ-FIX: Pass venue timezone so Vercel (UTC) computes correct business day
    const replayTz = await getLocationTimezone(locationId)
    const businessDay = getCurrentBusinessDay(dayStartTime, replayTz)
    const businessDayStart = businessDay.start

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

    // ── Validate ORDER_STARTED precedes other events for each order ─────
    for (const [oid, grp] of groups) {
      const hasStart = grp.some(e => e.eventType === 'ORDER_STARTED')
      if (!hasStart) {
        const existingOrder = await OrderRepository.getOrderById(oid, locationId)
        if (!existingOrder) {
          return err(`ORDER_STARTED event missing for order ${oid}. Cannot process items without order creation.`)
        }
        // Block replaying events onto split orders
        if (existingOrder.status === 'split') {
          return err('Cannot apply cart events to split orders')
        }
      }
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

          // Fetch tax rate once per order group
          const location = await tx.location.findUnique({
            where: { id: locationId },
          })
          const taxRate = getLocationTaxRate(location?.settings as { tax?: { defaultRate?: number } })
          const locTaxSettings = location?.settings as { tax?: { defaultRate?: number; inclusiveTaxRate?: number; taxInclusiveLiquor?: boolean; taxInclusiveFood?: boolean } } | null
          const taxIncSettings: TaxInclusiveSettings = {
            taxInclusiveLiquor: locTaxSettings?.tax?.taxInclusiveLiquor ?? false,
            taxInclusiveFood: locTaxSettings?.tax?.taxInclusiveFood ?? false,
          }
          const inclusiveTaxRate = locTaxSettings?.tax?.inclusiveTaxRate != null
            ? locTaxSettings.tax.inclusiveTaxRate / 100 : taxRate

          for (const evt of orderEvents) {
            // Idempotency L1: in-memory fast path
            if (processedEventIds.has(evt.eventId)) {
              skipped++
              continue
            }
            // Idempotency L2: atomic claim via INSERT ... ON CONFLICT DO NOTHING RETURNING
            // This is race-safe — if two requests race, only one gets the RETURNING row.
            const [claimed] = await tx.$queryRawUnsafe<{eventId: string}[]>(
              `INSERT INTO "_processed_cart_events" ("eventId", "processedAt")
               VALUES ($1, NOW())
               ON CONFLICT ("eventId") DO NOTHING
               RETURNING "eventId"`,
              evt.eventId
            )
            if (!claimed) {
              // Already processed by another request
              markProcessedLocal(evt.eventId)
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

            // Use authenticated employeeId, not payload (payload could be spoofed)
            const payloadEmployeeId = payload.employeeId || null
            const trustedEmployeeId = authEmployeeId || payloadEmployeeId
            if (payloadEmployeeId && authEmployeeId && payloadEmployeeId !== authEmployeeId) {
              console.warn(`[replay] Payload employeeId ${payloadEmployeeId} differs from authenticated user ${authEmployeeId}`)
            }

            switch (evt.eventType) {
              case 'ORDER_STARTED': {
                // Check if order already exists (idempotency for ORDER_STARTED)
                const existing = await OrderRepository.getOrderByIdWithSelect(
                  clientOrderId, locationId, { id: true }, tx,
                )

                if (existing) {
                  serverOrderId = existing.id
                  skipped++
                  markProcessedLocal(evt.eventId)
                  continue
                }

                // Get next order number atomically (per business day)
                const lastOrderRows = await tx.$queryRawUnsafe<{ orderNumber: number }[]>(
                  `SELECT "orderNumber" FROM "Order" WHERE "locationId" = $1 AND "parentOrderId" IS NULL AND "createdAt" >= $2 AND "createdAt" < $3 ORDER BY "orderNumber" DESC LIMIT 1 FOR UPDATE`,
                  locationId, businessDay.start, businessDay.end
                )
                const orderNumber = ((lastOrderRows as any[])[0]?.orderNumber ?? 0) + 1

                const initialSeatCount = payload.guestCount || 1
                const now = new Date().toISOString()
                const seatTimestamps: Record<string, string> = {}
                for (let i = 1; i <= initialSeatCount; i++) {
                  seatTimestamps[i.toString()] = now
                }

                // TX-KEEP: CREATE — replay ORDER_STARTED creates order with client ID inside order-number lock; no repo create method
                const order = await tx.order.create({
                  data: {
                    id: clientOrderId, // Use client-provided ID for correlation
                    locationId,
                    employeeId: trustedEmployeeId,
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
                    idempotencyKey: evt.eventId || null,
                    ...cellularMutationFields,
                  },
                })

                serverOrderId = order.id

                // Fire-and-forget audit log
                void db.auditLog.create({
                  data: {
                    locationId,
                    employeeId: trustedEmployeeId,
                    action: 'order_replay_created',
                    entityType: 'order',
                    entityId: order.id,
                    details: { orderNumber, orderType: payload.orderType, source: isCellularOrigin ? 'cellular' : 'offline' },
                  },
                }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.replay-cart-events'))
                void emitOrderEvent(locationId, order.id, 'ORDER_CREATED', {
                  locationId,
                  employeeId: trustedEmployeeId,
                  orderType: payload.orderType || 'dine_in',
                  tableId: payload.tableId || null,
                  guestCount: initialSeatCount,
                  orderNumber,
                  displayNumber: null,
                })

                // Socket: notify terminals of new order + floor plan update
                void dispatchOpenOrdersChanged(locationId, { trigger: 'created', orderId: order.id }, { async: true }).catch(err => log.warn({ err }, 'open orders dispatch failed'))
                if (payload.tableId) {
                  void dispatchFloorPlanUpdate(locationId).catch(err => log.warn({ err }, 'floor plan dispatch failed'))
                }

                processed++
                markProcessedLocal(evt.eventId)
                break
              }

              case 'ITEM_ADDED': {
                const targetOrderId = serverOrderId || clientOrderId

                // Validate menu item exists
                const menuItem = await tx.menuItem.findUnique({
                  where: { id: payload.menuItemId },
                  select: { id: true, name: true, price: true, fulfillmentType: true, fulfillmentStationId: true, category: { select: { categoryType: true } } },
                })

                if (!menuItem) {
                  errors.push({ eventId: evt.eventId, error: `MenuItem ${payload.menuItemId} not found` })
                  continue
                }

                const quantity = payload.quantity || 1
                const serverPrice = Number(menuItem.price)
                if (payload.price !== undefined && payload.price !== null && Math.abs(payload.price - serverPrice) > 0.01) {
                  console.warn(`[REPLAY] Price mismatch for item ${menuItem.id}: client=$${payload.price}, server=$${serverPrice}. Using server price.`)
                }
                const price = serverPrice
                const itemTotal = price * quantity
                const catType = menuItem.category?.categoryType ?? null
                const itemTaxInclusive = isItemTaxInclusive(catType ?? undefined, taxIncSettings)

                const modifierData = Array.isArray(payload.modifiers)
                  ? payload.modifiers.map((mod: any) => ({
                      locationId,
                      modifierId: mod.modifierId || null,
                      name: mod.name,
                      price: mod.price || 0,
                      quantity: 1,
                    }))
                  : []

                // TX-KEEP: CREATE — replay ITEM_ADDED creates order item with nested modifiers; no repo create method
                await tx.orderItem.create({
                  data: {
                    locationId,
                    orderId: targetOrderId,
                    menuItemId: payload.menuItemId,
                    name: menuItem.name,
                    price,
                    quantity,
                    itemTotal,
                    isTaxInclusive: itemTaxInclusive,
                    categoryType: catType,
                    specialNotes: payload.notes || null,
                    seatNumber: payload.seatNumber || null,
                    ...(modifierData.length > 0 ? {
                      modifiers: { create: modifierData },
                    } : {}),
                    ...cellularMutationFields,
                  },
                })

                // Update order subtotal, tax, and total
                if (itemTaxInclusive) {
                  // Tax-inclusive: tax is backed out of itemTotal, total doesn't change by tax amount
                  const itemTax = roundToCents(itemTotal - (itemTotal / (1 + inclusiveTaxRate)))
                  await OrderRepository.updateOrder(targetOrderId, locationId, {
                    subtotal: { increment: itemTotal },
                    taxTotal: { increment: itemTax },
                    taxFromInclusive: { increment: itemTax },
                    total: { increment: itemTotal }, // Tax already included in price
                    itemCount: { increment: quantity },
                    version: { increment: 1 },
                  }, tx)
                } else {
                  // Tax-exclusive: tax added on top
                  const itemTax = roundToCents(itemTotal * taxRate)
                  await OrderRepository.updateOrder(targetOrderId, locationId, {
                    subtotal: { increment: itemTotal },
                    taxTotal: { increment: itemTax },
                    taxFromExclusive: { increment: itemTax },
                    total: { increment: itemTotal + itemTax },
                    itemCount: { increment: quantity },
                    version: { increment: 1 },
                  }, tx)
                }

                // Socket: notify terminals that order items/totals changed
                void dispatchOpenOrdersChanged(locationId, { trigger: 'item_updated', orderId: targetOrderId }, { async: true }).catch(err => log.warn({ err }, 'open orders dispatch failed'))

                processed++
                markProcessedLocal(evt.eventId)
                break
              }

              case 'ITEM_REMOVED': {
                const targetOrderId = serverOrderId || clientOrderId

                if (!payload.orderItemId) {
                  errors.push({ eventId: evt.eventId, error: 'orderItemId required for ITEM_REMOVED' })
                  continue
                }

                const item = await OrderItemRepository.getItemByIdWithSelect(
                  payload.orderItemId, locationId,
                  { id: true, orderId: true, itemTotal: true, quantity: true, deletedAt: true, isTaxInclusive: true },
                  tx,
                )

                if (!item || item.orderId !== targetOrderId) {
                  errors.push({ eventId: evt.eventId, error: `OrderItem ${payload.orderItemId} not found on this order` })
                  continue
                }

                if (item.deletedAt) {
                  // Already deleted — idempotent
                  skipped++
                  markProcessedLocal(evt.eventId)
                  continue
                }

                // Soft delete
                await OrderItemRepository.updateItem(
                  payload.orderItemId, locationId, { deletedAt: new Date() }, tx,
                )

                // Decrement order totals (including tax)
                const removedItemTotal = Number(item.itemTotal)
                if (item.isTaxInclusive) {
                  // Tax-inclusive: tax was backed out of itemTotal
                  const removedItemTax = roundToCents(removedItemTotal - (removedItemTotal / (1 + inclusiveTaxRate)))
                  await OrderRepository.updateOrder(targetOrderId, locationId, {
                    subtotal: { decrement: removedItemTotal },
                    taxTotal: { decrement: removedItemTax },
                    taxFromInclusive: { decrement: removedItemTax },
                    total: { decrement: removedItemTotal }, // Tax was included in price
                    itemCount: { decrement: item.quantity },
                    version: { increment: 1 },
                  }, tx)
                } else {
                  // Tax-exclusive: tax was added on top
                  const removedItemTax = roundToCents(removedItemTotal * taxRate)
                  await OrderRepository.updateOrder(targetOrderId, locationId, {
                    subtotal: { decrement: removedItemTotal },
                    taxTotal: { decrement: removedItemTax },
                    taxFromExclusive: { decrement: removedItemTax },
                    total: { decrement: removedItemTotal + removedItemTax },
                    itemCount: { decrement: item.quantity },
                    version: { increment: 1 },
                  }, tx)
                }

                // Socket: notify terminals that order items/totals changed
                void dispatchOpenOrdersChanged(locationId, { trigger: 'item_updated', orderId: targetOrderId }, { async: true }).catch(err => log.warn({ err }, 'open orders dispatch failed'))

                processed++
                markProcessedLocal(evt.eventId)
                break
              }

              case 'ORDER_SENT': {
                const targetOrderId = serverOrderId || clientOrderId

                // Transition to open + mark items as sent
                await OrderRepository.updateOrder(targetOrderId, locationId, {
                  status: 'open',
                  version: { increment: 1 },
                }, tx)

                const now = new Date()
                await OrderItemRepository.updateItemsWhere(
                  targetOrderId, locationId,
                  { kitchenStatus: 'pending', isHeld: false, deletedAt: null },
                  { kitchenStatus: 'sent', firedAt: now },
                  tx,
                )

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

                    const actions = await routeOrderFulfillment(
                      { id: targetOrderId, locationId },
                      fulfillmentItems,
                      stationConfigs,
                      new Date().toISOString(),
                      originDevice,
                    )

                    // Persist FulfillmentEvents so bridge worker dispatches to hardware (printers, KDS)
                    for (const action of actions) {
                      try {
                        await db.$executeRawUnsafe(
                          `INSERT INTO "FulfillmentEvent" (id, "locationId", "orderId", "stationId", type, status, payload, "retryCount", "createdAt", "updatedAt")
                           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'pending', $5::jsonb, 0, NOW(), NOW())`,
                          locationId, targetOrderId, action.stationId || null, action.type,
                          JSON.stringify({ items: action.items, stationName: action.stationName, idempotencyKey: action.idempotencyKey })
                        )
                      } catch (feErr) {
                        console.error(`[replay-cart-events] Failed to persist FulfillmentEvent:`, feErr)
                      }
                    }
                  } catch (err) {
                    console.error('[replay-cart-events] Fulfillment routing failed:', err)
                  }
                })()

                // Emit ORDER_SENT event (fire-and-forget)
                void emitOrderEvent(locationId, targetOrderId, 'ORDER_SENT', {
                  sentItemIds: [],
                })

                // Dispatch open orders update + floor plan (fire-and-forget)
                void dispatchOpenOrdersChanged(locationId, { trigger: 'sent', orderId: targetOrderId }, { async: true }).catch(err => log.warn({ err }, 'open orders dispatch failed'))
                void dispatchFloorPlanUpdate(locationId).catch(err => log.warn({ err }, 'floor plan dispatch failed'))

                processed++
                markProcessedLocal(evt.eventId)
                break
              }

              default:
                errors.push({ eventId: evt.eventId, error: `Unknown eventType: ${evt.eventType}` })
            }
          }

          // Recalculate order totals from actual DB state (accounts for discounts
          // applied by other terminals between replayed events)
          const targetOrderId = serverOrderId || clientOrderId
          const freshOrder = await OrderRepository.getOrderByIdWithInclude(
            targetOrderId, locationId,
            {
              items: { where: { deletedAt: null, status: 'active' } },
              discounts: true,
            },
            tx,
          )
          if (freshOrder) {
            let inclusiveSubtotal = 0
            let exclusiveSubtotal = 0
            for (const i of freshOrder.items) {
              const itemAmt = Number(i.itemTotal ?? 0)
              if ((i as any).isTaxInclusive) {
                inclusiveSubtotal += itemAmt
              } else {
                exclusiveSubtotal += itemAmt
              }
            }
            inclusiveSubtotal = roundToCents(inclusiveSubtotal)
            exclusiveSubtotal = roundToCents(exclusiveSubtotal)
            const subtotal = roundToCents(inclusiveSubtotal + exclusiveSubtotal)
            const splitTax = calculateSplitTax(inclusiveSubtotal, exclusiveSubtotal, taxRate, inclusiveTaxRate)
            const discountTotal = freshOrder.discounts.reduce((sum, d) => sum + Number(d.amount ?? 0), 0)
            const total = roundToCents(subtotal + splitTax.taxFromExclusive - discountTotal)
            const itemCount = freshOrder.items.reduce((sum, i) => sum + i.quantity, 0)
            await OrderRepository.updateOrder(targetOrderId, locationId, {
              subtotal,
              taxTotal: splitTax.totalTax,
              taxFromInclusive: splitTax.taxFromInclusive,
              taxFromExclusive: splitTax.taxFromExclusive,
              discountTotal: roundToCents(discountTotal),
              total: Math.max(0, total),
              itemCount,
            }, tx)
          }
        })
      } catch (txErr) {
        // Transaction failed for this order group — record errors for all events in the group
        const errMsg = txErr instanceof Error ? txErr.message : 'Transaction failed'
        for (const evt of orderEvents) {
          if (!processedEventIds.has(evt.eventId)) {
            errors.push({ eventId: evt.eventId, error: errMsg })
          }
        }
      }
    }

    if (processed > 0) {
      pushUpstream()
    }

    return ok({
        processed,
        skipped,
        errors,
      })
  } catch (error) {
    console.error('[replay-cart-events] Failed to replay cart events:', error)
    return err('Failed to replay cart events', 500)
  }
})
