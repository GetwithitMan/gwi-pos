import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderRouter } from '@/lib/order-router'
import { dispatchNewOrder, dispatchEntertainmentUpdate, dispatchEntertainmentStatusChanged, dispatchOpenOrdersChanged, dispatchOrderSummaryUpdated } from '@/lib/socket-dispatch'
import { deductPrepStockForOrder } from '@/lib/inventory-calculations'
import { startEntertainmentSession, batchUpdateOrderItemStatus } from '@/lib/batch-updates'
import { getEligibleKitchenItems } from '@/lib/kitchen-item-filter'
import { printKitchenTicketsForManifests } from '@/lib/print-template-factory'
import { withVenue } from '@/lib/with-venue'
import { withTiming, getTimingFromRequest } from '@/lib/with-timing'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { routeOrderFulfillment, type FulfillmentItem, type FulfillmentStationConfig, type OriginDevice } from '@/lib/fulfillment-router'
import { isInOutageMode, queueOutageWrite } from '@/lib/sync/upstream-sync-worker'
import { evaluateAutoDiscounts } from '@/lib/auto-discount-engine'
import { checkOrderClaim } from '@/lib/order-claim'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { isModifiable } from '@/lib/domain/order-status'

// POST /api/orders/[id]/send - Send order items to kitchen
export const POST = withVenue(withTiming(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const timing = getTimingFromRequest(request)
    const { id } = await params

    // Parse optional itemIds and employeeId from body for selective firing (per-item delays)
    let filterItemIds: string[] | null = null
    let sendEmployeeId: string | null = null
    try {
      const body = await request.json()
      if (body.itemIds && Array.isArray(body.itemIds) && body.itemIds.length > 0) {
        filterItemIds = body.itemIds
      }
      if (body.employeeId) {
        sendEmployeeId = body.employeeId
      }
    } catch {
      // No body or invalid JSON — send all pending items
    }

    // Order claim check — block if another employee has an active claim
    if (sendEmployeeId) {
      const terminalId = request.headers.get('x-terminal-id')
      const claimBlock = await checkOrderClaim(db, id, sendEmployeeId, terminalId)
      if (claimBlock) {
        return NextResponse.json(
          { error: claimBlock.error, claimedBy: claimBlock.claimedBy },
          { status: claimBlock.status }
        )
      }
    }

    // Atomic fetch: use interactive transaction with row-level lock to prevent
    // two concurrent POST /send requests from processing the same pending items.
    // SELECT ... FOR UPDATE on the order row serialises concurrent sends.
    timing.start('db-fetch')
    const order = await db.$transaction(async (tx) => {
      // Lock the order row — any concurrent send will block here until we commit
      const [locked] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "Order" WHERE id = $1 AND "deletedAt" IS NULL FOR UPDATE`,
        id,
      )
      if (!locked) return null

      return tx.order.findFirst({
        where: { id, deletedAt: null },
        include: {
          table: { select: { id: true, name: true, abbreviation: true } },
          employee: { select: { id: true, displayName: true, firstName: true, lastName: true } },
          items: {
            where: { deletedAt: null, kitchenStatus: 'pending', isHeld: false },
            include: {
              menuItem: {
                select: { id: true, name: true, itemType: true, blockTimeMinutes: true, fulfillmentType: true, fulfillmentStationId: true }
              }
            }
          }
        }
      })
    })

    timing.end('db-fetch', 'Fetch order (locked)')

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Status guard: only modifiable statuses allowed
    if (!isModifiable(order.status)) {
      return NextResponse.json(
        { error: `Cannot send order in '${order.status}' status` },
        { status: 400 }
      );
    }

    // Guard: sending another employee's order requires pos.edit_others_orders
    if (sendEmployeeId && order.employeeId && order.employeeId !== sendEmployeeId) {
      const auth = await requirePermission(sendEmployeeId, order.locationId, PERMISSIONS.POS_EDIT_OTHERS_ORDERS)
      if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status })
      }
    }

    // Filter: only non-held, pending items. isHeld is a hard gate — held items never send.
    // When filterItemIds is provided: only process those specific items (for selective firing)
    // When no filterItemIds: process all eligible items EXCEPT those with active delays
    // Uses shared getEligibleKitchenItems to stay aligned with kitchen print route
    const itemsToProcess = getEligibleKitchenItems(order.items, {
      filterItemIds,
      expectedStatus: 'pending',
    })

    // M2: Count held items so the client can warn "X items held back"
    const heldItemCount = await db.orderItem.count({
      where: { orderId: id, isHeld: true, deletedAt: null, status: { not: 'voided' } },
    })

    // Identify delayed items that need their timer started.
    // Bug 19 fix: Only stamp delayStartedAt on items that are part of this send request.
    // When filterItemIds is provided, only those items are being sent — don't stamp unrelated
    // delayed items that belong to a different batch or course.
    const delayedItems = order.items.filter(item => {
      if (!item.delayMinutes || item.delayMinutes <= 0 || item.isHeld || item.delayStartedAt) return false
      // When filterItemIds is set, only stamp items in the current send scope
      if (filterItemIds && !filterItemIds.includes(item.id)) return false
      return true
    })

    const now = new Date()

    // Stamp delayStartedAt on delayed items so countdown survives page reload
    if (delayedItems.length > 0) {
      await db.orderItem.updateMany({
        where: { id: { in: delayedItems.map(i => i.id) } },
        data: { delayStartedAt: now },
      })
    }

    // Short-circuit: if no items to process, return early without dispatching events.
    // This is the natural idempotency guard — a second concurrent send finds 0 pending items.
    if (itemsToProcess.length === 0) {
      return NextResponse.json({ data: {
        success: true,
        sentItemCount: 0,
        sentItemIds: [],
        alreadySent: true,
        delayedItemCount: delayedItems.length,
        heldItemCount,
        routing: { stations: [], unroutedCount: 0 },
      } })
    }
    const updatedItemIds: string[] = []

    // FIX-010: Batch updates to avoid N+1 query problem
    // Separate regular items from entertainment items for efficient batch processing
    const regularItemIds: string[] = []
    const entertainmentUpdates: Array<{
      itemId: string
      menuItemId: string
      sessionEnd: Date
    }> = []

    // Collect items and prepare batch updates
    for (const item of itemsToProcess) {
      // Track for routing
      updatedItemIds.push(item.id)

      // Check if entertainment item with timer
      if (item.menuItem?.itemType === 'timed_rental' && item.blockTimeMinutes) {
        const sessionEnd = new Date(now.getTime() + item.blockTimeMinutes * 60 * 1000)
        entertainmentUpdates.push({
          itemId: item.id,
          menuItemId: item.menuItem.id,
          sessionEnd,
        })
      } else {
        regularItemIds.push(item.id)
      }
    }

    // Transition draft → open on first send (so Open Orders panel sees it)
    // Always increment version for optimistic concurrency control
    // Record sentAt for ghost order protection — the void route should check
    // if (order.sentAt && Date.now() - order.sentAt.getTime() < 30000) to require
    // manager approval for voids within 30 seconds of sending (prevents send→void→pocket-cash fraud).
    // TODO: Add the 30-second void-delay guard in comp-void/route.ts (requires manager approval
    // for voids within 30s of sentAt to prevent send→void→pocket-cash attacks).
    timing.start('db-update')
    const orderUpdateData: Record<string, unknown> = { version: { increment: 1 }, sentAt: now }
    if (order.status === 'draft') {
      orderUpdateData.status = 'open'
    }
    await db.order.update({
      where: { id },
      data: orderUpdateData,
    })

    // Batch update regular items (single query)
    if (regularItemIds.length > 0) {
      await batchUpdateOrderItemStatus(regularItemIds, 'sent', now)
    }

    // Batch update entertainment items with sessions in a single transaction
    if (entertainmentUpdates.length > 0) {
      await db.$transaction(
        entertainmentUpdates.map(({ itemId, sessionEnd }) =>
          db.orderItem.update({
            where: { id: itemId },
            data: {
              kitchenStatus: 'sent',
              firedAt: now,
              blockTimeStartedAt: now,
              blockTimeExpiresAt: sessionEnd,
            },
          })
        )
      )
      // Start entertainment sessions outside transaction (touches menu items + floor plan)
      await Promise.all(
        entertainmentUpdates.map(({ itemId, menuItemId, sessionEnd }) =>
          startEntertainmentSession(menuItemId, order.id, itemId, now, sessionEnd)
        )
      )
    }

    timing.end('db-update', 'Batch status updates')

    // Queue for Neon replay if in outage mode — read back full row to
    // avoid NOT NULL constraint violations on replay (partial payloads are unsafe)
    if (isInOutageMode()) {
      const fullOrder = await db.order.findUnique({ where: { id: order.id } })
      if (fullOrder) {
        void queueOutageWrite('Order', fullOrder.id, 'UPDATE', fullOrder as unknown as Record<string, unknown>, order.locationId).catch(console.error)
      }
    }

    // Route order to stations using tag-based routing engine
    // Pass pre-fetched order data to avoid redundant DB fetch inside resolveRouting
    const routingResult = await OrderRouter.resolveRouting(order.id, updatedItemIds, {
      id: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      locationId: order.locationId,
      tabName: order.tabName,
      createdAt: order.createdAt,
      table: order.table,
      employee: order.employee,
    })

    // Fulfillment routing — item-level station dispatch for HA cellular architecture (fire-and-forget)
    // The OrderRouter + dispatchNewOrder + printKitchenTicketsForManifests below handle the
    // actual real-time dispatch (KDS tags, socket, prints). FulfillmentEvents are persisted
    // as 'completed' (audit trail) when routing succeeds, or as 'pending' (bridge worker
    // fallback) when routing fails — this prevents duplicate printing.
    void (async () => {
      try {
        // Build FulfillmentItem[] from items that were just sent
        const fulfillmentItems: FulfillmentItem[] = itemsToProcess.map(item => ({
          id: item.id,
          menuItemId: item.menuItem?.id || item.menuItemId,
          name: item.name,
          quantity: item.quantity,
          modifiers: [],
          fulfillmentType: (item.menuItem as any)?.fulfillmentType ?? 'KITCHEN_STATION',
          fulfillmentStationId: (item.menuItem as any)?.fulfillmentStationId ?? null,
        }))

        // Build FulfillmentStationConfig[] from location's active stations
        const stations = await db.station.findMany({
          where: { locationId: order.locationId, isActive: true, deletedAt: null },
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

        // Determine origin device from cellular header
        const isCellular = request.headers.get('x-cellular-authenticated') === '1'
        const originDevice: OriginDevice | undefined = isCellular
          ? { terminalId: request.headers.get('x-terminal-id') || undefined, type: 'cellular' }
          : undefined

        const actions = await routeOrderFulfillment(
          { id: order.id, locationId: order.locationId },
          fulfillmentItems,
          stationConfigs,
          new Date().toISOString(),
          originDevice,
        )

        // Persist as 'completed' — real-time dispatch is handled by OrderRouter/dispatchNewOrder
        // below. Bridge worker only picks up 'pending' events, so this prevents double printing.
        if (actions.length > 0) {
          await db.fulfillmentEvent.createMany({
            data: actions.map(action => ({
              locationId: order.locationId,
              orderId: order.id,
              stationId: action.stationId || null,
              type: action.type,
              status: 'completed',
              completedAt: new Date(),
              payload: JSON.parse(JSON.stringify({
                items: action.items,
                stationName: action.stationName,
                idempotencyKey: action.idempotencyKey,
              })),
            }))
          })
        }
      } catch (err) {
        console.error('[API /orders/[id]/send] Fulfillment routing failed, persisting for bridge worker:', err)
        // Persist as 'pending' so bridge worker picks them up as fallback
        try {
          await db.fulfillmentEvent.createMany({
            data: [{
              locationId: order.locationId,
              orderId: order.id,
              type: 'print_kitchen',
              status: 'pending',
              payload: JSON.parse(JSON.stringify({
                items: itemsToProcess.map(item => ({
                  orderItemId: item.id,
                  menuItemId: item.menuItem?.id || item.menuItemId,
                  name: item.name,
                  quantity: item.quantity,
                })),
              })),
            }],
          })
        } catch (persistErr) {
          console.error('[API /orders/[id]/send] Failed to persist fallback fulfillment event:', persistErr)
        }
      }
    })()

    // Dispatch real-time socket events to KDS screens (fire and forget)
    void dispatchNewOrder(order.locationId, routingResult, { async: true }).catch((err) => {
      console.error('[API /orders/[id]/send] Socket dispatch failed:', err)
    })

    // For entertainment items, dispatch session updates and status changes
    for (const item of itemsToProcess) {
      if (item.menuItem?.itemType === 'timed_rental' && item.blockTimeMinutes) {
        const sessionExpiresAt = new Date(now.getTime() + item.blockTimeMinutes * 60 * 1000).toISOString()

        void dispatchEntertainmentUpdate(order.locationId, {
          sessionId: item.id,
          tableId: order.tableId || '',
          tableName: order.tabName || `Order #${order.orderNumber}`,
          action: 'started',
          expiresAt: sessionExpiresAt,
          startedAt: now.toISOString(),
        }, { async: true }).catch((err) => {
          console.error('[API /orders/[id]/send] Entertainment dispatch failed:', err)
        })

        void dispatchEntertainmentStatusChanged(order.locationId, {
          itemId: item.menuItem.id,
          entertainmentStatus: 'in_use',
          currentOrderId: order.id,
          expiresAt: sessionExpiresAt,
        }, { async: true }).catch(() => {})
      }
    }

    // Training mode: check if order is a training order
    const isTraining = order.isTraining === true
    let trainingSuppress = { printing: false, inventory: false }
    if (isTraining) {
      const locSettings = await getLocationSettings(order.locationId)
      const parsed = locSettings ? parseSettings(locSettings) : null
      trainingSuppress = {
        printing: parsed?.training?.suppressPrinting !== false,
        inventory: parsed?.training?.suppressInventory !== false,
      }
    }

    // Audit log: sent to kitchen (fire-and-forget — don't block response)
    void db.auditLog.create({
      data: {
        locationId: order.locationId,
        employeeId: order.employeeId,
        action: 'sent_to_kitchen',
        entityType: 'order',
        entityId: id,
        details: {
          regularItemCount: regularItemIds.length,
          entertainmentItemCount: entertainmentUpdates.length,
          itemNames: itemsToProcess.filter(i => !i.isHeld).map(i => i.name),
        },
      },
    }).catch(err => {
      console.error('[API /orders/[id]/send] Audit log failed:', err)
    })

    // Emit ORDER_SENT event (fire-and-forget)
    void emitOrderEvent(order.locationId, id, 'ORDER_SENT', {
      sentItemIds: updatedItemIds,
    })

    // Dispatch open orders update with 'sent' trigger — delta-only, no full snapshot reload
    void dispatchOpenOrdersChanged(order.locationId, { trigger: 'sent', orderId: order.id, tableId: order.tableId || undefined, orderNumber: order.orderNumber, status: 'occupied' }, { async: true }).catch(() => {})

    // Dispatch order:summary-updated for Android cross-terminal sync (fire-and-forget)
    // Send route transitions draft→open but doesn't change totals; emit status change
    void dispatchOrderSummaryUpdated(order.locationId, {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status === 'draft' ? 'open' : order.status,
      tableId: order.tableId || null,
      tableName: order.tabName || null,
      tabName: order.tabName || null,
      guestCount: order.guestCount ?? 0,
      employeeId: order.employeeId || null,
      subtotalCents: Math.round(Number(order.subtotal) * 100),
      taxTotalCents: Math.round(Number(order.taxTotal) * 100),
      discountTotalCents: Math.round(Number(order.discountTotal) * 100),
      tipTotalCents: Math.round(Number(order.tipTotal) * 100),
      totalCents: Math.round(Number(order.total) * 100),
      itemCount: order.itemCount ?? 0,
      updatedAt: new Date().toISOString(),
      locationId: order.locationId,
    }, { async: true }).catch(() => {})

    // Evaluate auto-discount rules after items are sent (fire-and-forget)
    void evaluateAutoDiscounts(order.id, order.locationId).catch(console.error)

    // Build response BEFORE firing kitchen print — print can hang 7s on TCP timeout
    // if printer is offline. DB writes + socket events are already done above.
    const response = NextResponse.json({ data: {
      success: true,
      sentItemCount: updatedItemIds.length,
      sentItemIds: updatedItemIds,
      heldItemCount,
      routing: {
        stations: routingResult.manifests.map(m => ({
          id: m.stationId,
          name: m.stationName,
          type: m.type,
          itemCount: m.primaryItems.length,
        })),
        unroutedCount: routingResult.unroutedItems.length,
      },
    } })

    // Fire kitchen print jobs AFTER response is built (fire-and-forget).
    // printKitchenTicketsForManifests handles per-station failover, backup routing,
    // socket emit (print:job-failed), and alert dispatch internally.
    // Training mode: skip printing if suppressPrinting is enabled
    if (!trainingSuppress.printing) {
      void printKitchenTicketsForManifests(routingResult, order.locationId).catch(err => {
        console.error('[API /orders/[id]/send] Kitchen print failed:', err)
      })
    }

    // Deduct prep stock for sent items (fire and forget)
    // Training mode: skip inventory deduction if suppressInventory is enabled
    if (!trainingSuppress.inventory) {
      void deductPrepStockForOrder(order.id, updatedItemIds).catch((err) => {
        console.error('[API /orders/[id]/send] Prep stock deduction failed:', err)
      })
    }

    return response
  } catch (error) {
    console.error('Failed to send order to kitchen:', error)
    if (error instanceof Error) {
      console.error('Error stack:', error.stack)
    }
    // Return more detailed error info for debugging
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to send order to kitchen', details: errorMessage },
      { status: 500 }
    )
  }
}, 'orders-send'))
