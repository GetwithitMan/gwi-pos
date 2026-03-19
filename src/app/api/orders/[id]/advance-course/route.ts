import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import * as OrderItemRepository from '@/lib/repositories/order-item-repository'
import { OrderRouter } from '@/lib/order-router'
import { withVenue } from '@/lib/with-venue'
import { dispatchNewOrder, dispatchItemStatus } from '@/lib/socket-dispatch'
import { emitOrderEvents } from '@/lib/order-events/emitter'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import type { OrderUpdatedPayload } from '@/lib/socket-events'
import { queueSocketEvent, flushSocketOutbox } from '@/lib/socket-outbox'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getRequestLocationId } from '@/lib/request-context'

// POST - Advance to next course
// Marks current course as served and fires the next course
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json().catch(() => ({}))
    const { markServed = true } = body

    // Resolve employeeId from body or session
    const employeeId = body.employeeId || (await getActorFromRequest(request)).employeeId

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let locationId = getRequestLocationId()
    if (!locationId) {
      // Bootstrap: lightweight fetch for locationId, then tenant-safe fetch with include
      const orderCheck = await db.order.findFirst({
        where: { id: orderId },
        select: { id: true, locationId: true },
      })

      if (!orderCheck) {
        return NextResponse.json(
          { error: 'Order not found' },
          { status: 404 }
        )
      }
      locationId = orderCheck.locationId
    }

    const order = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
      items: {
        where: { status: 'active', deletedAt: null },
        orderBy: { courseNumber: 'asc' },
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Auth check
    const auth = await requirePermission(employeeId, order.locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Get unique course numbers from items
    const courseNumbers = [...new Set(
      order.items
        .filter(item => item.courseNumber != null && item.courseNumber > 0)
        .map(item => item.courseNumber as number)
    )].sort((a, b) => a - b)

    if (courseNumbers.length === 0) {
      return NextResponse.json(
        { error: 'No courses assigned to items' },
        { status: 400 }
      )
    }

    // Find current course items
    const currentCourse = order.currentCourse
    const currentCourseItems = order.items.filter(
      item => item.courseNumber === currentCourse
    )

    // Find next course
    const currentIndex = courseNumbers.indexOf(currentCourse)
    const nextCourse = currentIndex >= 0 && currentIndex < courseNumbers.length - 1
      ? courseNumbers[currentIndex + 1]
      : null

    // Mark current course items as served (if requested)
    if (markServed && currentCourseItems.length > 0) {
      await db.orderItem.updateMany({
        where: {
          orderId,
          courseNumber: currentCourse,
          status: 'active',
        },
        data: {
          courseStatus: 'served',
          kitchenStatus: 'delivered',
        },
      })
    }

    // If there's a next course, fire it
    if (nextCourse) {
      // Fire next course items + update order + queue socket events atomically
      const firedItems = await db.$transaction(async (tx) => {
        const fired = await OrderItemRepository.updateItemsWhere(orderId, order.locationId, {
          courseNumber: nextCourse,
          status: 'active',
          courseStatus: { in: ['pending'] },
          isHeld: false,
        }, {
          courseStatus: 'fired',
          firedAt: new Date(),
        }, tx)

        // Update order's current course
        await OrderRepository.updateOrder(orderId, order.locationId, { currentCourse: nextCourse, version: { increment: 1 } }, tx)

        // Queue order:updated inside transaction for crash safety
        const updatedPayload: OrderUpdatedPayload = {
          orderId,
          changes: ['course-advanced', `course-${nextCourse}`],
        }
        await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDER_UPDATED, updatedPayload)

        return fired
      })

      // Flush outbox after commit
      void flushSocketOutbox(order.locationId).catch((err) => {
        console.warn('[advance-course] Outbox flush failed, catch-up will deliver:', err)
      })

      // Dispatch kds:item-status for current course items marked as served/delivered
      if (markServed && currentCourseItems.length > 0) {
        for (const item of currentCourseItems) {
          void dispatchItemStatus(order.locationId, {
            orderId,
            itemId: item.id,
            status: 'delivered',
            stationId: '',
            updatedBy: 'system',
          }, { async: true }).catch(console.error)
        }
      }

      // Route fired course items to KDS stations (same pattern as fire-course)
      const firedItemIds = order.items
        .filter(item => item.courseNumber === nextCourse && item.courseStatus === 'pending' && !item.isHeld)
        .map(item => item.id)
      if (firedItemIds.length > 0) {
        void (async () => {
          try {
            const routingResult = await OrderRouter.resolveRouting(orderId, firedItemIds)
            await dispatchNewOrder(order.locationId, routingResult, { async: true })
          } catch (err) {
            console.error('[API /advance-course] KDS routing dispatch failed:', err)
          }
        })()
      }

      // Emit event-sourced domain events (fire-and-forget)
      const advanceEvents: Array<{ type: 'ITEM_UPDATED' | 'ORDER_METADATA_UPDATED'; payload: Record<string, unknown> }> = []
      if (markServed) {
        for (const item of currentCourseItems) {
          advanceEvents.push({ type: 'ITEM_UPDATED', payload: { lineItemId: item.id, courseStatus: 'served', kitchenStatus: 'delivered' } })
        }
      }
      const nextCourseFireIds = order.items
        .filter(item => item.courseNumber === nextCourse && item.courseStatus === 'pending' && !item.isHeld)
        .map(item => item.id)
      for (const itemId of nextCourseFireIds) {
        advanceEvents.push({ type: 'ITEM_UPDATED', payload: { lineItemId: itemId, courseStatus: 'fired' } })
      }
      advanceEvents.push({ type: 'ORDER_METADATA_UPDATED', payload: { currentCourse: nextCourse } })
      if (advanceEvents.length > 0) {
        void emitOrderEvents(order.locationId, orderId, advanceEvents)
      }

      return NextResponse.json({ data: {
        success: true,
        previousCourse: currentCourse,
        currentCourse: nextCourse,
        itemsFired: firedItems.count,
        hasMoreCourses: courseNumbers.indexOf(nextCourse) < courseNumbers.length - 1,
      } })
    }

    // Queue order:updated inside transaction for crash safety
    await db.$transaction(async (tx) => {
      const completedPayload: OrderUpdatedPayload = {
        orderId,
        changes: ['courses-complete'],
      }
      await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDER_UPDATED, completedPayload)
    })

    // Flush outbox after commit
    void flushSocketOutbox(order.locationId).catch((err) => {
      console.warn('[advance-course] Outbox flush failed, catch-up will deliver:', err)
    })

    // Dispatch kds:item-status for current course items marked as served/delivered
    if (markServed && currentCourseItems.length > 0) {
      for (const item of currentCourseItems) {
        void dispatchItemStatus(order.locationId, {
          orderId,
          itemId: item.id,
          status: 'delivered',
          stationId: '',
          updatedBy: 'system',
        }, { async: true }).catch(console.error)
      }
    }

    // Emit event-sourced events for served items (fire-and-forget)
    if (markServed && currentCourseItems.length > 0) {
      void emitOrderEvents(order.locationId, orderId, currentCourseItems.map(item => ({
        type: 'ITEM_UPDATED' as const,
        payload: { lineItemId: item.id, courseStatus: 'served', kitchenStatus: 'delivered' },
      })))
    }

    // No more courses
    return NextResponse.json({ data: {
      success: true,
      previousCourse: currentCourse,
      currentCourse: currentCourse,
      itemsFired: 0,
      hasMoreCourses: false,
      message: 'All courses have been served',
    } })
  } catch (error) {
    console.error('Failed to advance course:', error)
    return NextResponse.json(
      { error: 'Failed to advance course' },
      { status: 500 }
    )
  }
})
