import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderRouter } from '@/lib/order-router'
import { dispatchNewOrder, dispatchEntertainmentUpdate, dispatchEntertainmentStatusChanged, dispatchOpenOrdersChanged, dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { deductPrepStockForOrder } from '@/lib/inventory-calculations'
import { startEntertainmentSession, batchUpdateOrderItemStatus } from '@/lib/batch-updates'
import { getEligibleKitchenItems } from '@/lib/kitchen-item-filter'

// POST /api/orders/[id]/send - Send order items to kitchen
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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

    // Get the order with items
    const order = await db.order.findFirst({
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
    // ALWAYS run this regardless of filterItemIds — when a mix of immediate + delayed items
    // are sent, filterItemIds targets the immediate ones, but delayed items still need
    // their delayStartedAt stamped so the client can show countdown timers.
    const delayedItems = order.items.filter(item =>
      item.delayMinutes && item.delayMinutes > 0 && !item.isHeld && !item.delayStartedAt
    )

    const now = new Date()

    // Stamp delayStartedAt on delayed items so countdown survives page reload
    if (delayedItems.length > 0) {
      await db.orderItem.updateMany({
        where: { id: { in: delayedItems.map(i => i.id) } },
        data: { delayStartedAt: now },
      })
    }

    console.log('[API /orders/[id]/send] Order has', order.items.length, 'pending items,',
      'held:', order.items.filter(i => i.isHeld).length, ',',
      'delayed:', delayedItems.length, ',',
      'sending:', itemsToProcess.length)

    // Short-circuit: if no items to process, return early without dispatching events
    if (itemsToProcess.length === 0) {
      return NextResponse.json({
        success: true,
        sentItemCount: 0,
        sentItemIds: [],
        delayedItemCount: delayedItems.length,
        routing: { stations: [], unroutedCount: 0 },
      })
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

    // Batch update regular items (single query)
    if (regularItemIds.length > 0) {
      await batchUpdateOrderItemStatus(regularItemIds, 'sent', now)
    }

    // Batch update entertainment items with sessions in a single transaction
    if (entertainmentUpdates.length > 0) {
      await db.$transaction(async (tx) => {
        for (const { itemId, menuItemId, sessionEnd } of entertainmentUpdates) {
          await tx.orderItem.update({
            where: { id: itemId },
            data: {
              kitchenStatus: 'sent',
              firedAt: now,
              blockTimeStartedAt: now,
              blockTimeExpiresAt: sessionEnd,
            },
          })
        }
      })
      // Start entertainment sessions outside transaction (touches menu items + floor plan)
      for (const { itemId, menuItemId, sessionEnd } of entertainmentUpdates) {
        await startEntertainmentSession(menuItemId, order.id, itemId, now, sessionEnd)
      }
    }

    // Route order to stations using tag-based routing engine
    const routingResult = await OrderRouter.resolveRouting(order.id, updatedItemIds)

    console.log('[API /orders/[id]/send] Routing result:', {
      stations: routingResult.manifests.map(m => m.stationName),
      itemCount: routingResult.routingStats.totalItems,
      unrouted: routingResult.unroutedItems.length,
    })

    // Dispatch real-time socket events to KDS screens (fire and forget)
    dispatchNewOrder(order.locationId, routingResult, { async: true }).catch((err) => {
      console.error('[API /orders/[id]/send] Socket dispatch failed:', err)
    })

    // For entertainment items, dispatch session updates and status changes
    for (const item of itemsToProcess) {
      if (item.menuItem?.itemType === 'timed_rental' && item.blockTimeMinutes) {
        const sessionExpiresAt = new Date(now.getTime() + item.blockTimeMinutes * 60 * 1000).toISOString()

        dispatchEntertainmentUpdate(order.locationId, {
          sessionId: item.id,
          tableId: order.tableId || '',
          tableName: order.tabName || `Order #${order.orderNumber}`,
          action: 'started',
          expiresAt: sessionExpiresAt,
        }, { async: true }).catch((err) => {
          console.error('[API /orders/[id]/send] Entertainment dispatch failed:', err)
        })

        dispatchEntertainmentStatusChanged(order.locationId, {
          itemId: item.menuItem.id,
          entertainmentStatus: 'in_use',
          currentOrderId: order.id,
          expiresAt: sessionExpiresAt,
        }, { async: true }).catch(() => {})
      }
    }

    // TODO: Trigger kitchen print job for PRINTER type stations
    // For each manifest where type === 'PRINTER':
    //   await PrintTemplateFactory.buildBuffer(manifest.template, ...)
    //   await sendToPrinter(manifest.ipAddress, manifest.port, buffer)

    // Deduct prep stock for sent items (fire and forget)
    deductPrepStockForOrder(order.id, updatedItemIds).catch((err) => {
      console.error('[API /orders/[id]/send] Prep stock deduction failed:', err)
    })

    // Audit log: sent to kitchen
    await db.auditLog.create({
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
    })

    // Dispatch open orders + floor plan update so all terminals refresh table status instantly
    dispatchOpenOrdersChanged(order.locationId, { trigger: 'created', orderId: order.id }, { async: true }).catch(() => {})
    dispatchFloorPlanUpdate(order.locationId, { async: true }).catch(() => {})

    return NextResponse.json({
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
    })
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
}
