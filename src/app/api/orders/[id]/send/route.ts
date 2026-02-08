import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderRouter } from '@/lib/order-router'
import { dispatchNewOrder, dispatchEntertainmentUpdate } from '@/lib/socket-dispatch'
import { deductPrepStockForOrder } from '@/lib/inventory-calculations'
import { startEntertainmentSession, batchUpdateOrderItemStatus } from '@/lib/batch-updates'

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
          where: { deletedAt: null, kitchenStatus: 'pending' },
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

    // When itemIds filter is provided, only process those specific items
    const itemsToProcess = filterItemIds
      ? order.items.filter(item => filterItemIds!.includes(item.id))
      : order.items

    console.log('[API /orders/[id]/send] Order found with', order.items.length, 'pending items,',
      filterItemIds ? `filtering to ${itemsToProcess.length} specific items` : 'sending all')

    const now = new Date()
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
      // Skip held items
      if (item.isHeld) continue

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

    // Batch update entertainment items with sessions
    for (const { itemId, menuItemId, sessionEnd } of entertainmentUpdates) {
      // Update order item
      await db.orderItem.update({
        where: { id: itemId },
        data: {
          kitchenStatus: 'sent',
          firedAt: now,
          blockTimeStartedAt: now,
          blockTimeExpiresAt: sessionEnd,
        },
      })

      // Update menu item + floor plan element in single transaction (FIX-010)
      await startEntertainmentSession(menuItemId, order.id, itemId, now, sessionEnd)
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

    // For entertainment items, dispatch session updates
    for (const item of itemsToProcess) {
      if (item.menuItem?.itemType === 'timed_rental' && item.blockTimeMinutes) {
        dispatchEntertainmentUpdate(order.locationId, {
          sessionId: item.id,
          tableId: order.tableId || '',
          tableName: order.tabName || `Order #${order.orderNumber}`,
          action: 'started',
          expiresAt: new Date(now.getTime() + item.blockTimeMinutes * 60 * 1000).toISOString(),
        }, { async: true }).catch((err) => {
          console.error('[API /orders/[id]/send] Entertainment dispatch failed:', err)
        })
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
