import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { KitchenStatus, CourseStatus } from '@prisma/client'
import { OrderRouter } from '@/lib/order-router'
import { dispatchNewOrder, dispatchEntertainmentUpdate, dispatchOrderUpdated } from '@/lib/socket-dispatch'
import { deductPrepStockForOrder } from '@/lib/inventory-calculations'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvents } from '@/lib/order-events/emitter'

// POST /api/orders/[id]/fire-course - Fire items for a specific course
// Used by coursing system to send delayed courses to kitchen
export const POST = withVenue(async function POST(
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

    // Validate course ordering: prior courses should be fired first
    if (courseNumber > 1 && !body.force) {
      const priorUnfiredItems = await db.orderItem.findMany({
        where: {
          orderId: id,
          courseNumber: { lt: courseNumber },
          kitchenStatus: 'pending',
          isHeld: false,
          deletedAt: null,
          status: 'active',
        },
      })
      if (priorUnfiredItems.length > 0) {
        return NextResponse.json({
          error: `Course ${courseNumber - 1} has unfired items. Fire it first or pass force: true to override.`,
          unfiredCourseItems: priorUnfiredItems.length,
          requiresForce: true,
        }, { status: 400 })
      }
    }

    // Get the order with items for this course that haven't been sent yet
    // Bug 3 fix: When courseNumber === 1, also include items with null courseNumber
    // (unassigned items default to course 1 on the client: item.courseNumber ?? 1)
    const order = await db.order.findFirst({
      where: { id, deletedAt: null },
      include: {
        items: {
          where: {
            deletedAt: null,
            courseNumber: courseNumber === 1 ? { in: [1, null] } : courseNumber,
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

    // Bug 18 fix: Validate order status — don't fire courses on completed orders
    if (['paid', 'closed', 'voided', 'cancelled'].includes(order.status)) {
      return NextResponse.json(
        { error: `Cannot fire course on ${order.status} order` },
        { status: 400 }
      )
    }

    if (order.items.length === 0) {
      return NextResponse.json({ data: {
        success: true,
        sentItemCount: 0,
        sentItemIds: [],
        message: 'No pending items for this course',
      } })
    }

    const now = new Date()
    const updatedItemIds: string[] = order.items.map(i => i.id)

    // Separate timed rental items from regular items
    const timedItems = order.items.filter(i => i.menuItem?.itemType === 'timed_rental' && i.blockTimeMinutes)
    const regularItemIds = order.items.filter(i => !(i.menuItem?.itemType === 'timed_rental' && i.blockTimeMinutes)).map(i => i.id)

    // Batch update regular items in one query
    if (regularItemIds.length > 0) {
      await db.orderItem.updateMany({
        where: { id: { in: regularItemIds } },
        data: {
          kitchenStatus: 'sent',
          courseStatus: 'fired',
          firedAt: now,
        },
      })
    }

    // Process timed rental items in parallel (each needs unique expiry + linked entity updates)
    if (timedItems.length > 0) {
      await Promise.all(timedItems.map(item => {
        const expiresAt = new Date(now.getTime() + item.blockTimeMinutes! * 60 * 1000)
        return Promise.all([
          db.orderItem.update({
            where: { id: item.id },
            data: {
              kitchenStatus: 'sent',
              courseStatus: 'fired',
              firedAt: now,
              blockTimeStartedAt: now,
              blockTimeExpiresAt: expiresAt,
            },
          }),
          db.menuItem.update({
            where: { id: item.menuItem!.id },
            data: {
              entertainmentStatus: 'in_use',
              currentOrderId: order.id,
              currentOrderItemId: item.id,
            },
          }),
          db.floorPlanElement.updateMany({
            where: {
              linkedMenuItemId: item.menuItem!.id,
              deletedAt: null,
            },
            data: {
              status: 'in_use',
              currentOrderId: order.id,
              sessionStartedAt: now,
              sessionExpiresAt: expiresAt,
            },
          }),
        ])
      }))
    }

    // Update current course on the order
    await db.order.update({
      where: { id },
      data: { currentCourse: courseNumber, version: { increment: 1 } },
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

    // Fire-and-forget socket dispatch for order update
    void dispatchOrderUpdated(order.locationId, {
      orderId: order.id,
      changes: ['course-fired', `course-${courseNumber}`],
    }).catch(() => {})

    // Emit event-sourced domain events (fire-and-forget)
    void emitOrderEvents(order.locationId, id, [
      ...order.items.map(item => ({
        type: 'ITEM_UPDATED' as const,
        payload: {
          lineItemId: item.id,
          kitchenStatus: 'sent',
          courseStatus: 'fired',
          ...(item.menuItem?.itemType === 'timed_rental' && item.blockTimeMinutes ? {
            blockTimeMinutes: item.blockTimeMinutes,
            blockTimeStartedAt: now.toISOString(),
            blockTimeExpiresAt: new Date(now.getTime() + item.blockTimeMinutes * 60 * 1000).toISOString(),
          } : {}),
        },
      })),
      { type: 'ORDER_SENT' as const, payload: { sentItemIds: updatedItemIds } },
    ])

    // Deduct prep stock for fired items (fire and forget)
    deductPrepStockForOrder(order.id, updatedItemIds).catch((err) => {
      console.error('[API /fire-course] Prep stock deduction failed:', err)
    })

    return NextResponse.json({ data: {
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
    } })
  } catch (error) {
    console.error('Failed to fire course:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to fire course', details: errorMessage },
      { status: 500 }
    )
  }
})
