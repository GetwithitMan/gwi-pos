import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderRouter } from '@/lib/order-router'
import { dispatchNewOrder, dispatchEntertainmentUpdate, dispatchEntertainmentStatusChanged, dispatchOpenOrdersChanged } from '@/lib/socket-dispatch'
import { deductPrepStockForOrder } from '@/lib/inventory-calculations'
import { startEntertainmentSession, batchUpdateOrderItemStatus } from '@/lib/batch-updates'
import { getEligibleKitchenItems } from '@/lib/kitchen-item-filter'
import { printKitchenTicketsForManifests } from '@/lib/print-template-factory'
import { withVenue } from '@/lib/with-venue'
import { withTiming, getTimingFromRequest } from '@/lib/with-timing'

// POST /api/orders/[id]/send - Send order items to kitchen
export const POST = withVenue(withTiming(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const timing = getTimingFromRequest(request)
    const { id } = await params

    // Parse optional itemIds from body for selective firing (per-item delays)
    let filterItemIds: string[] | null = null
    try {
      const body = await request.json()
      if (body.itemIds && Array.isArray(body.itemIds) && body.itemIds.length > 0) {
        filterItemIds = body.itemIds
      }
    } catch {
      // No body or invalid JSON — send all pending items
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
          items: {
            where: { deletedAt: null, kitchenStatus: 'pending', isHeld: false },
            include: {
              menuItem: {
                select: { id: true, name: true, itemType: true, blockTimeMinutes: true }
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

    // Filter: only non-held, pending items. isHeld is a hard gate — held items never send.
    // When filterItemIds is provided: only process those specific items (for selective firing)
    // When no filterItemIds: process all eligible items EXCEPT those with active delays
    // Uses shared getEligibleKitchenItems to stay aligned with kitchen print route
    const itemsToProcess = getEligibleKitchenItems(order.items, {
      filterItemIds,
      expectedStatus: 'pending',
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
    timing.start('db-update')
    const orderUpdateData: Record<string, unknown> = { version: { increment: 1 } }
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

    // Route order to stations using tag-based routing engine
    const routingResult = await OrderRouter.resolveRouting(order.id, updatedItemIds)

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

    // Fire kitchen print jobs for PRINTER-type stations (fire and forget)
    void printKitchenTicketsForManifests(routingResult).catch(err => {
      console.error('[API /orders/[id]/send] Kitchen print failed:', err)
    })

    // Deduct prep stock for sent items (fire and forget)
    void deductPrepStockForOrder(order.id, updatedItemIds).catch((err) => {
      console.error('[API /orders/[id]/send] Prep stock deduction failed:', err)
    })

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

    // Dispatch open orders update with 'sent' trigger — delta-only, no full snapshot reload
    void dispatchOpenOrdersChanged(order.locationId, { trigger: 'sent', orderId: order.id, tableId: order.tableId || undefined, orderNumber: order.orderNumber, status: 'occupied' }, { async: true }).catch(() => {})

    return NextResponse.json({ data: {
      success: true,
      sentItemCount: updatedItemIds.length,
      sentItemIds: updatedItemIds,
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
