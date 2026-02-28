import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { dispatchOrderUpdated } from '@/lib/socket-dispatch'
import { emitOrderEvent, emitOrderEvents } from '@/lib/order-events/emitter'

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

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          where: { status: 'active', deletedAt: null },
          orderBy: { courseNumber: 'asc' },
        },
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
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
      // Fire next course items
      const firedItems = await db.orderItem.updateMany({
        where: {
          orderId,
          courseNumber: nextCourse,
          status: 'active',
          courseStatus: { in: ['pending'] },
          isHeld: false,
        },
        data: {
          courseStatus: 'fired',
          firedAt: new Date(),
        },
      })

      // Update order's current course
      await db.order.update({
        where: { id: orderId },
        data: { currentCourse: nextCourse, version: { increment: 1 } },
      })

      // Fire-and-forget socket dispatch for cross-terminal sync
      void dispatchOrderUpdated(order.locationId, {
        orderId,
        changes: ['course-advanced', `course-${nextCourse}`],
      }).catch(() => {})

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

    // Fire-and-forget socket dispatch for cross-terminal sync
    void dispatchOrderUpdated(order.locationId, {
      orderId,
      changes: ['courses-complete'],
    }).catch(() => {})

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
