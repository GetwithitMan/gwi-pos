import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderRouter } from '@/lib/order-router'
import { dispatchNewOrder, dispatchEntertainmentUpdate } from '@/lib/socket-dispatch'
import { deductPrepStockForOrder } from '@/lib/inventory-calculations'

// POST /api/orders/[id]/fire-course - Fire items for a specific course
// Used by coursing system to send delayed courses to kitchen
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { courseNumber, employeeId } = body

    if (courseNumber === undefined || courseNumber === null) {
      return NextResponse.json(
        { error: 'courseNumber is required' },
        { status: 400 }
      )
    }

    // Get the order with items for this course that haven't been sent yet
    const order = await db.order.findFirst({
      where: { id, deletedAt: null },
      include: {
        items: {
          where: {
            deletedAt: null,
            courseNumber: courseNumber,
            kitchenStatus: 'pending',
            isHeld: false,
          },
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

    if (order.items.length === 0) {
      return NextResponse.json({
        success: true,
        sentItemCount: 0,
        sentItemIds: [],
        message: 'No pending items for this course',
      })
    }

    const now = new Date()
    const updatedItemIds: string[] = []

    // Update items to 'sent' status + mark courseStatus as 'fired'
    for (const item of order.items) {
      const updateData: {
        kitchenStatus: string
        courseStatus: string
        firedAt: Date
        blockTimeStartedAt?: Date
        blockTimeExpiresAt?: Date
      } = {
        kitchenStatus: 'sent',
        courseStatus: 'fired',
        firedAt: now,
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

        // Update linked FloorPlanElement
        await db.floorPlanElement.updateMany({
          where: {
            linkedMenuItemId: item.menuItem.id,
            deletedAt: null,
          },
          data: {
            status: 'in_use',
            currentOrderId: order.id,
            sessionStartedAt: now,
            sessionExpiresAt: updateData.blockTimeExpiresAt,
          },
        })
      }

      await db.orderItem.update({
        where: { id: item.id },
        data: updateData,
      })

      updatedItemIds.push(item.id)
    }

    // Update current course on the order
    await db.order.update({
      where: { id },
      data: { currentCourse: courseNumber },
    })

    // Route order items to stations using tag-based routing engine
    const routingResult = await OrderRouter.resolveRouting(order.id, updatedItemIds)

    // Dispatch real-time socket events to KDS screens (fire and forget)
    dispatchNewOrder(order.locationId, routingResult, { async: true }).catch((err) => {
      console.error('[API /fire-course] Socket dispatch failed:', err)
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
          console.error('[API /fire-course] Entertainment dispatch failed:', err)
        })
      }
    }

    // Deduct prep stock for fired items (fire and forget)
    deductPrepStockForOrder(order.id, updatedItemIds).catch((err) => {
      console.error('[API /fire-course] Prep stock deduction failed:', err)
    })

    return NextResponse.json({
      success: true,
      courseNumber,
      sentItemCount: updatedItemIds.length,
      sentItemIds: updatedItemIds,
      routing: {
        stations: routingResult.manifests.map(m => ({
          id: m.stationId,
          name: m.stationName,
          type: m.type,
          itemCount: m.primaryItems.length,
        })),
      },
    })
  } catch (error) {
    console.error('Failed to fire course:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to fire course', details: errorMessage },
      { status: 500 }
    )
  }
}
