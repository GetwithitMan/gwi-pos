import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { OrderRouter } from '@/lib/order-router'
import { dispatchNewOrder, dispatchEntertainmentUpdate, dispatchEntertainmentStatusChanged } from '@/lib/socket-dispatch'
import { deductPrepStockForOrder } from '@/lib/inventory-calculations'
import { startEntertainmentSession } from '@/lib/batch-updates'
import { getEligibleKitchenItems } from '@/lib/kitchen-item-filter'
import { printKitchenTicketsForManifests } from '@/lib/print-template-factory'
import { withVenue } from '@/lib/with-venue'
import { withTiming, getTimingFromRequest } from '@/lib/with-timing'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { routeOrderFulfillment, type FulfillmentItem, type FulfillmentStationConfig, type OriginDevice } from '@/lib/fulfillment-router'
import { isInOutageMode, queueOutageWrite } from '@/lib/sync/upstream-sync-worker'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { evaluateAutoDiscounts } from '@/lib/auto-discount-engine'
import { checkOrderClaim } from '@/lib/order-claim'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { isModifiable } from '@/lib/domain/order-status'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import type { OrdersListChangedPayload, OrderSummaryUpdatedPayload, OrderCreatedPayload } from '@/lib/socket-events'
import { queueSocketEvent, flushOutboxSafe } from '@/lib/socket-outbox'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('orders-send')

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

    // HA cellular sync — detect mutation origin for downstream sync
    const isCellularSend = request.headers.get('x-cellular-authenticated') === '1'
    const mutationOrigin = isCellularSend ? 'cloud' : 'local'

    // Cellular ownership gating — block send on locally-owned orders
    if (isCellularSend) {
      const { validateCellularOrderAccess, CellularAuthError } = await import('@/lib/cellular-validation')
      try {
        await validateCellularOrderAccess(true, id, 'mutate', db)
      } catch (caughtErr) {
        if (err instanceof CellularAuthError) {
          return err(err.message, err.status)
        }
        throw err
      }
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

    // R2 FIX: Unified atomic transaction — SELECT FOR UPDATE lock on the Order row
    // is held from item fetch through status update. This prevents items added by
    // Terminal A between the read and write from being missed (the lock serialises
    // all concurrent sends AND item additions that also lock the Order row).
    timing.start('db-fetch')

    // Phase 1: Lock + fetch inside transaction. We need the order data for guards
    // that may cause early return, so we split into: (1) lock+fetch, (2) guards,
    // (3) write — but (1) and (3) share the same transaction.
    //
    // To achieve this without holding a long-lived transaction across permission
    // checks, we perform the lock+fetch+write atomically: fetch items, filter,
    // and mark as sent all within a single transaction scope.
    const sendResult = await db.$transaction(async (tx) => {
      // Lock the order row — any concurrent send will block here until we commit
      const [locked] = await tx.$queryRaw<Array<{ id: string; locationId: string }>>`SELECT id, "locationId" FROM "Order" WHERE id = ${id} AND "deletedAt" IS NULL FOR UPDATE`
      if (!locked) return { type: 'not_found' as const }

      const order = await OrderRepository.getOrderByIdWithInclude(id, locked.locationId, {
        table: { select: { id: true, name: true, abbreviation: true } },
        employee: { select: { id: true, displayName: true, firstName: true, lastName: true } },
        items: {
          // Fetch pending items including held (OPT 4: in-memory held count replaces separate COUNT query)
          // Also include routing-specific fields (OPT 1: pass to resolveRouting to skip redundant items fetch)
          where: { deletedAt: null, kitchenStatus: 'pending' },
          include: {
            menuItem: {
              select: {
                id: true, name: true, itemType: true, blockTimeMinutes: true,
                fulfillmentType: true, fulfillmentStationId: true,
                categoryId: true, routeTags: true,
                category: { select: { id: true, routeTags: true, categoryType: true } },
              }
            },
            modifiers: {
              select: { id: true, name: true, preModifier: true, depth: true, quantity: true },
            },
            ingredientModifications: {
              select: { ingredientName: true, modificationType: true, swappedToModifierName: true },
            },
            sourceTable: {
              select: { id: true, name: true, abbreviation: true },
            },
            pizzaData: {
              include: {
                size: { select: { name: true, inches: true } },
                crust: { select: { name: true } },
                sauce: { select: { name: true } },
                cheese: { select: { name: true } },
              },
            },
          }
        }
      }, tx)

      if (!order) return { type: 'not_found' as const }

      // Status guard: only modifiable statuses allowed
      if (!isModifiable(order.status)) {
        return { type: 'status_error' as const, status: order.status }
      }

      // Guard: sending another employee's order requires pos.edit_others_orders
      if (sendEmployeeId && order.employeeId && order.employeeId !== sendEmployeeId) {
        const auth = await requirePermission(sendEmployeeId, order.locationId, PERMISSIONS.POS_EDIT_OTHERS_ORDERS)
        if (!auth.authorized) {
          return { type: 'auth_error' as const, error: auth.error, authStatus: auth.status }
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
      // OPT 4: In-memory count from already-fetched items (-5ms, eliminates separate COUNT query)
      const heldItemCount = order.items.filter(
        (i: any) => i.isHeld === true && i.status !== 'voided'
      ).length

      // Identify delayed items that need their timer started.
      // Bug 19 fix: Only stamp delayStartedAt on items that are part of this send request.
      const delayedItems = order.items.filter(item => {
        if (!item.delayMinutes || item.delayMinutes <= 0 || item.isHeld || item.delayStartedAt) return false
        if (filterItemIds && !filterItemIds.includes(item.id)) return false
        return true
      })

      // Clock discipline: use DB-generated NOW() for all timestamps written to the database.
      // `jsNow` is used ONLY for in-memory calculations (entertainment session end, socket payloads)
      const jsNow = new Date()

      // Stamp delayStartedAt on delayed items so countdown survives page reload
      if (delayedItems.length > 0) {
        const delayedIds = delayedItems.map(i => i.id)
        await tx.$executeRaw`UPDATE "OrderItem" SET "delayStartedAt" = NOW(), "updatedAt" = NOW()
           WHERE id = ANY(${delayedIds}::text[])`
      }

      // Short-circuit: if no items to process, return early
      if (itemsToProcess.length === 0) {
        return {
          type: 'empty' as const,
          delayedItemCount: delayedItems.length,
          heldItemCount,
        }
      }

      const updatedItemIds: string[] = []
      const regularItemIds: string[] = []
      const entertainmentUpdates: Array<{
        itemId: string
        menuItemId: string
        sessionEnd: Date
      }> = []

      for (const item of itemsToProcess) {
        updatedItemIds.push(item.id)
        if (item.menuItem?.itemType === 'timed_rental' && item.blockTimeMinutes) {
          const sessionEnd = new Date(jsNow.getTime() + item.blockTimeMinutes * 60 * 1000)
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
      const newStatus = order.status === 'draft' ? 'open' : order.status

      // Update order: increment version, set sentAt = NOW(), optionally transition draft → open
      if (order.status === 'draft') {
        await tx.$executeRaw`UPDATE "Order" SET version = version + 1, "sentAt" = NOW(), status = 'open', "lastMutatedBy" = ${mutationOrigin}, "updatedAt" = NOW()
           WHERE id = ${id} AND "locationId" = ${order.locationId}`
      } else {
        await tx.$executeRaw`UPDATE "Order" SET version = version + 1, "sentAt" = NOW(), "lastMutatedBy" = ${mutationOrigin}, "updatedAt" = NOW()
           WHERE id = ${id} AND "locationId" = ${order.locationId}`
      }

      // Batch update regular items: kitchenStatus = 'sent', firedAt = NOW(), kitchenSentAt = NOW()
      if (regularItemIds.length > 0) {
        await tx.$executeRaw`UPDATE "OrderItem" SET "kitchenStatus" = 'sent', "firedAt" = NOW(), "kitchenSentAt" = NOW(), "updatedAt" = NOW()
           WHERE id = ANY(${regularItemIds}::text[]) AND "locationId" = ${order.locationId}`
      }

      // Batch update entertainment items with sessions: firedAt + blockTime timestamps = NOW()
      // Uses CASE/WHEN to set per-item blockTimeExpiresAt in a SINGLE query (N+1 fix)
      if (entertainmentUpdates.length > 0) {
        const entertainmentIds = entertainmentUpdates.map(u => u.itemId)
        const caseClauses = entertainmentUpdates.map((u, i) =>
          `WHEN id = $${i + 2} THEN $${i + 2 + entertainmentUpdates.length}::timestamptz`
        ).join(' ')
        const params: Array<string | string[] | Date> = [
          entertainmentIds,
          ...entertainmentUpdates.map(u => u.itemId),
          ...entertainmentUpdates.map(u => u.sessionEnd),
          order.locationId,
        ]

        // eslint-disable-next-line -- dynamic CASE clauses + spread params require $executeRawUnsafe; all values are parameterized
        await tx.$executeRawUnsafe(
          `UPDATE "OrderItem"
           SET "kitchenStatus" = 'sent', "firedAt" = NOW(), "kitchenSentAt" = NOW(), "blockTimeStartedAt" = NOW(),
               "blockTimeExpiresAt" = CASE ${caseClauses} END,
               "updatedAt" = NOW()
           WHERE id = ANY($1::text[]) AND "locationId" = $${params.length}`,
          ...params,
        )
      }

      // Queue critical socket events in the outbox (atomic with business writes)
      const listChangedPayload: OrdersListChangedPayload = {
        trigger: 'sent',
        orderId: order.id,
        tableId: order.tableId || undefined,
        orderNumber: order.orderNumber,
        status: 'occupied',
      }
      await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDERS_LIST_CHANGED, listChangedPayload)

      const summaryPayload: OrderSummaryUpdatedPayload = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: newStatus,
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
      }
      await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDER_SUMMARY_UPDATED, summaryPayload)

      // Queue ORDER_CREATED for crash-durable delivery to the location channel.
      // dispatchNewOrder() (after commit) handles real-time per-station KDS routing
      // via emitToTags, which the outbox doesn't support. This outbox event is the
      // safety net: if the server crashes between commit and dispatchNewOrder(), the
      // catch-up protocol delivers ORDER_CREATED to all location subscribers (including
      // KDS screens), which triggers a re-fetch so no order is silently lost.
      const orderCreatedPayload: OrderCreatedPayload = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType || 'dine_in',
        tableName: order.table?.name || order.tabName || null,
        tabName: order.tabName || null,
        employeeName: order.employee?.displayName || order.employee?.firstName || null,
        createdAt: order.createdAt.toISOString(),
        stations: [],  // Routing not yet resolved; real-time dispatch fills this
      }
      await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDER_CREATED, orderCreatedPayload)

      return {
        type: 'success' as const,
        order,
        itemsToProcess,
        updatedItemIds,
        regularItemIds,
        entertainmentUpdates,
        heldItemCount,
        newStatus,
        jsNow,
      }
    })

    timing.end('db-fetch', 'Atomic lock + fetch + update (R2 fix)')

    // Handle early-return cases from the unified transaction
    if (sendResult.type === 'not_found') {
      return notFound('Order not found')
    }
    if (sendResult.type === 'status_error') {
      return err(`Cannot send order in '${sendResult.status}' status`)
    }
    if (sendResult.type === 'auth_error') {
      return err(sendResult.error, sendResult.authStatus)
    }
    if (sendResult.type === 'empty') {
      return ok({
        success: true,
        sentItemCount: 0,
        sentItemIds: [],
        alreadySent: true,
        delayedItemCount: sendResult.delayedItemCount,
        heldItemCount: sendResult.heldItemCount,
        routing: { stations: [], unroutedCount: 0 },
      })
    }

    // Destructure successful result for the rest of the route
    const {
      order, itemsToProcess, updatedItemIds, regularItemIds,
      entertainmentUpdates, heldItemCount, newStatus, jsNow,
    } = sendResult

    timing.start('post-commit')

    // Transaction committed — flush outbox (fire-and-forget, catch-up handles failures)
    flushOutboxSafe(order.locationId)

    timing.end('post-commit', 'Post-commit: outbox flush')

    // Queue for Neon replay if in outage mode — read back full row to
    // avoid NOT NULL constraint violations on replay (partial payloads are unsafe)
    if (isInOutageMode()) {
      const fullOrder = await OrderRepository.getOrderById(order.id, order.locationId)
      if (fullOrder) {
        void queueOutageWrite('Order', fullOrder.id, 'UPDATE', fullOrder as unknown as Record<string, unknown>, order.locationId).catch(err => log.warn({ err }, 'Background task failed'))
      }
    }

    // Trigger upstream sync (fire-and-forget, debounced)
    pushUpstream()

    // Fetch delivery info for kitchen tickets (DeliveryOrder is raw SQL, not in Prisma schema)
    let deliveryCustomerName: string | null = null
    let deliveryPhone: string | null = null
    let deliveryAddr: string | null = null
    let deliveryNotes: string | null = null
    if (order.orderType?.startsWith('delivery')) {
      try {
        const rows: Array<{ customerName: string | null; phone: string | null; address: string | null; addressLine2: string | null; city: string | null; state: string | null; zipCode: string | null; notes: string | null }> = await db.$queryRaw`SELECT "customerName", "phone", "address", "addressLine2", "city", "state", "zipCode", "notes"
           FROM "DeliveryOrder" WHERE "orderId" = ${id} LIMIT 1`
        if (rows.length > 0) {
          const row = rows[0]
          deliveryCustomerName = row.customerName
          deliveryPhone = row.phone
          const addrParts = [row.address, row.addressLine2, row.city, row.state, row.zipCode].filter(Boolean)
          deliveryAddr = addrParts.length > 0 ? addrParts.join(', ') : null
          deliveryNotes = row.notes
        }
      } catch {
        // Non-fatal: delivery info is supplementary for ticket printing
      }
    }

    // OPT 2: Fetch stations ONCE — shared by routing, K9 validation, and fulfillment (-25ms)
    const locationStations = await db.station.findMany({
      where: { locationId: order.locationId, isActive: true, deletedAt: null },
    })

    // OPT 1: Items were already fetched in the transaction with routing-specific includes.
    // Filter to only the items that were actually sent (updatedItemIds) and pass to
    // resolveRouting() to skip the redundant orderItem.findMany inside the router (-40ms).
    const routingItems = order.items.filter((i: any) => updatedItemIds.includes(i.id))

    // Route order to stations using tag-based routing engine
    // Pass pre-fetched order data, items, AND stations to avoid 3 redundant DB fetches
    const routingResult = await OrderRouter.resolveRouting(order.id, updatedItemIds, {
      id: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      locationId: order.locationId,
      tabName: order.tabName,
      createdAt: order.createdAt,
      table: order.table,
      employee: order.employee,
      // Delivery customer info for kitchen ticket printing
      customerName: deliveryCustomerName,
      customerPhone: deliveryPhone,
      deliveryAddress: deliveryAddr,
      deliveryInstructions: deliveryNotes,
      source: order.source,
    }, routingItems, locationStations)

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

        // OPT 2: Reuse pre-fetched stations instead of re-querying (-25ms saved above)
        const stationConfigs: FulfillmentStationConfig[] = locationStations.map(s => ({
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
      } catch (caughtErr) {
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

    // Dispatch real-time socket events to KDS screens (fire-and-forget)
    // KDS uses tag-based routing (emitToTags) which the outbox doesn't support,
    // so per-station dispatch remains fire-and-forget here. The outbox handles
    // ORDERS_LIST_CHANGED, ORDER_SUMMARY_UPDATED, and ORDER_CREATED above for
    // crash-safe delivery. ORDER_CREATED is the safety net — if the server crashes
    // before this line, KDS clients receive it via catch-up and trigger a re-fetch.
    void dispatchNewOrder(order.locationId, routingResult, { async: true }).catch((err) => {
      console.error('[API /orders/[id]/send] Socket dispatch failed:', err)
    })

    // OPT 3: Start entertainment sessions fire-and-forget AFTER socket dispatch (-30ms)
    // Moved from awaited post-commit phase to non-blocking — touches menu items + floor plan
    if (entertainmentUpdates.length > 0) {
      void Promise.all(
        entertainmentUpdates.map(({ itemId, menuItemId, sessionEnd }) =>
          startEntertainmentSession(menuItemId, order.id, itemId, jsNow, sessionEnd)
        )
      ).catch(err => log.warn({ err }, 'Entertainment session start failed (fire-and-forget)'))
    }

    // For entertainment items, dispatch session updates and status changes (non-critical UI)
    for (const item of itemsToProcess) {
      if (item.menuItem?.itemType === 'timed_rental' && item.blockTimeMinutes) {
        const sessionExpiresAt = new Date(jsNow.getTime() + item.blockTimeMinutes * 60 * 1000).toISOString()

        void dispatchEntertainmentUpdate(order.locationId, {
          sessionId: item.id,
          tableId: order.tableId || '',
          tableName: order.tabName || `Order #${order.orderNumber}`,
          action: 'started',
          expiresAt: sessionExpiresAt,
          startedAt: jsNow.toISOString(),
        }, { async: true }).catch((err) => {
          console.error('[API /orders/[id]/send] Entertainment dispatch failed:', err)
        })

        void dispatchEntertainmentStatusChanged(order.locationId, {
          itemId: item.menuItem.id,
          entertainmentStatus: 'in_use',
          currentOrderId: order.id,
          expiresAt: sessionExpiresAt,
        }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.send'))
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

    // Evaluate auto-discount rules after items are sent (fire-and-forget)
    void evaluateAutoDiscounts(order.id, order.locationId).catch(err => log.warn({ err }, 'Background task failed'))
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
    return err('Failed to send order to kitchen', 500, errorMessage)
  }
}, 'orders-send'))
