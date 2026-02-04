import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderRouter } from '@/lib/order-router'
import { dispatchNewOrder, dispatchEntertainmentUpdate } from '@/lib/socket-dispatch'
import { deductPrepStockForOrder } from '@/lib/inventory-calculations'

// POST /api/orders/[id]/send - Send order items to kitchen
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

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

    console.log('[API /orders/[id]/send] Order found with', order.items.length, 'pending items')

    const now = new Date()
    const updatedItemIds: string[] = []

    // Update all pending items to 'sent' status
    for (const item of order.items) {
      // Skip held items
      if (item.isHeld) continue

      const updateData: {
        kitchenStatus: string
        firedAt: Date
        blockTimeStartedAt?: Date
        blockTimeExpiresAt?: Date
      } = {
        kitchenStatus: 'sent',
        firedAt: now, // Use firedAt to track when item was sent to kitchen
      }

      // For timed rental items, start the timer
      if (item.menuItem?.itemType === 'timed_rental' && item.blockTimeMinutes) {
        updateData.blockTimeStartedAt = now
        updateData.blockTimeExpiresAt = new Date(now.getTime() + item.blockTimeMinutes * 60 * 1000)

        // Update the menu item status to in_use
        await db.menuItem.update({
          where: { id: item.menuItem.id },
          data: {
            entertainmentStatus: 'in_use',
            currentOrderId: order.id,
            currentOrderItemId: item.id,
          }
        })
      }

      await db.orderItem.update({
        where: { id: item.id },
        data: updateData,
      })

      updatedItemIds.push(item.id)
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
    for (const item of order.items) {
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
