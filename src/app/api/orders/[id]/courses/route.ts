import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { dispatchOrderUpdated } from '@/lib/socket-dispatch'
import { emitOrderEvent, emitOrderEvents } from '@/lib/order-events/emitter'

// Default course names for display
const DEFAULT_COURSE_NAMES: Record<number, { name: string; color: string }> = {
  0: { name: 'ASAP', color: '#EF4444' },
  1: { name: 'Appetizers', color: '#3B82F6' },
  2: { name: 'Soup/Salad', color: '#10B981' },
  3: { name: 'Entrees', color: '#F59E0B' },
  4: { name: 'Dessert', color: '#EC4899' },
  5: { name: 'After-Dinner', color: '#8B5CF6' },
}

// GET - Get course status for an order
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          where: { status: 'active', deletedAt: null },
          orderBy: [
            { courseNumber: 'asc' },
            { seatNumber: 'asc' },
          ],
        },
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Get course configuration for this location
    const courseConfigs = await db.courseConfig.findMany({
      where: {
        locationId: order.locationId,
        deletedAt: null,
        isActive: true,
      },
      orderBy: { sortOrder: 'asc' },
    })

    // Build course name/color lookup
    const courseInfo: Record<number, { name: string; displayName?: string; color: string }> = { ...DEFAULT_COURSE_NAMES }
    for (const config of courseConfigs) {
      courseInfo[config.courseNumber] = {
        name: config.name,
        displayName: config.displayName || undefined,
        color: config.color || DEFAULT_COURSE_NAMES[config.courseNumber]?.color || '#6B7280',
      }
    }

    // Group items by course
    const courses: Record<number, {
      courseNumber: number
      name: string
      displayName?: string
      color: string
      status: string
      itemCount: number
      firedCount: number
      readyCount: number
      servedCount: number
      heldCount: number
      items: Array<{
        id: string
        name: string
        seatNumber: number | null
        courseStatus: string
        isHeld: boolean
        firedAt: string | null
      }>
    }> = {}

    for (const item of order.items) {
      const courseNum = item.courseNumber || 0
      const info = courseInfo[courseNum] || { name: `Course ${courseNum}`, color: '#6B7280' }

      if (!courses[courseNum]) {
        courses[courseNum] = {
          courseNumber: courseNum,
          name: info.name,
          displayName: info.displayName,
          color: info.color,
          status: 'pending',
          itemCount: 0,
          firedCount: 0,
          readyCount: 0,
          servedCount: 0,
          heldCount: 0,
          items: [],
        }
      }

      courses[courseNum].itemCount++
      if (item.courseStatus === 'fired') courses[courseNum].firedCount++
      if (item.courseStatus === 'ready') courses[courseNum].readyCount++
      if (item.courseStatus === 'served') courses[courseNum].servedCount++
      if (item.isHeld) courses[courseNum].heldCount++

      courses[courseNum].items.push({
        id: item.id,
        name: item.name,
        seatNumber: item.seatNumber,
        courseStatus: item.courseStatus,
        isHeld: item.isHeld,
        firedAt: item.firedAt?.toISOString() || null,
      })
    }

    // Determine course status
    for (const course of Object.values(courses)) {
      if (course.servedCount === course.itemCount) {
        course.status = 'served'
      } else if (course.readyCount === course.itemCount) {
        course.status = 'ready'
      } else if (course.firedCount > 0 || course.items.some(i => i.courseStatus === 'fired')) {
        course.status = 'fired'
      } else if (course.heldCount === course.itemCount) {
        course.status = 'held'
      } else {
        course.status = 'pending'
      }
    }

    return NextResponse.json({ data: {
      orderId,
      currentCourse: order.currentCourse,
      courseMode: order.courseMode,
      courses: Object.values(courses).sort((a, b) => a.courseNumber - b.courseNumber),
    } })
  } catch (error) {
    console.error('Failed to get courses:', error)
    return NextResponse.json(
      { error: 'Failed to get courses' },
      { status: 500 }
    )
  }
})

// POST - Fire a course or update course settings
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { courseNumber, action, courseMode } = body

    const order = await db.order.findUnique({
      where: { id: orderId },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Handle course mode update
    if (action === 'set_mode' && courseMode) {
      if (!['off', 'manual', 'auto'].includes(courseMode)) {
        return NextResponse.json(
          { error: 'Invalid course mode. Use: off, manual, auto' },
          { status: 400 }
        )
      }

      const updated = await db.order.update({
        where: { id: orderId },
        data: { courseMode },
      })

      void dispatchOrderUpdated(order.locationId, { orderId, changes: ['courseMode'] }).catch(() => {})
      void emitOrderEvent(order.locationId, orderId, 'ORDER_METADATA_UPDATED', { courseMode })

      return NextResponse.json({ data: {
        success: true,
        courseMode: updated.courseMode,
      } })
    }

    // Handle set current course
    if (action === 'set_current' && courseNumber !== undefined) {
      const updated = await db.order.update({
        where: { id: orderId },
        data: { currentCourse: courseNumber },
      })

      void dispatchOrderUpdated(order.locationId, { orderId, changes: ['currentCourse'] }).catch(() => {})
      void emitOrderEvent(order.locationId, orderId, 'ORDER_METADATA_UPDATED', { currentCourse: courseNumber })

      return NextResponse.json({ data: {
        success: true,
        currentCourse: updated.currentCourse,
      } })
    }

    // For other actions, courseNumber is required
    if (courseNumber === undefined) {
      return NextResponse.json(
        { error: 'Course number is required' },
        { status: 400 }
      )
    }

    switch (action) {
      case 'fire': {
        // Query item IDs before batch update for event emission
        const fireItemIds = (await db.orderItem.findMany({
          where: { orderId, courseNumber, status: 'active', deletedAt: null, courseStatus: 'pending', isHeld: false },
          select: { id: true },
        })).map(i => i.id)

        // Fire all items in this course (excluding held items unless explicitly including them)
        const firedItems = await db.orderItem.updateMany({
          where: {
            orderId,
            courseNumber,
            status: 'active',
            deletedAt: null,
            courseStatus: 'pending',
            isHeld: false,
          },
          data: {
            courseStatus: 'fired',
            firedAt: new Date(),
          },
        })

        // Update current course if this course is higher
        if (courseNumber > order.currentCourse) {
          await db.order.update({
            where: { id: orderId },
            data: { currentCourse: courseNumber },
          })
        }

        void dispatchOrderUpdated(order.locationId, { orderId, changes: ['course-fired'] }).catch(() => {})

        // Emit event-sourced events for fired items
        if (fireItemIds.length > 0) {
          void emitOrderEvents(order.locationId, orderId, fireItemIds.map(id => ({
            type: 'ITEM_UPDATED' as const,
            payload: { lineItemId: id, courseStatus: 'fired' },
          })))
        }

        return NextResponse.json({ data: {
          success: true,
          courseNumber,
          itemsFired: firedItems.count,
        } })
      }

      case 'fire_all': {
        // Query item IDs before batch update for event emission
        const fireAllItemIds = (await db.orderItem.findMany({
          where: { orderId, courseNumber, status: 'active', deletedAt: null, courseStatus: { in: ['pending'] } },
          select: { id: true },
        })).map(i => i.id)

        // Fire all items in this course including held items
        const allFiredItems = await db.orderItem.updateMany({
          where: {
            orderId,
            courseNumber,
            status: 'active',
            deletedAt: null,
            courseStatus: { in: ['pending'] },
          },
          data: {
            courseStatus: 'fired',
            firedAt: new Date(),
            isHeld: false,
          },
        })

        // Update current course
        if (courseNumber > order.currentCourse) {
          await db.order.update({
            where: { id: orderId },
            data: { currentCourse: courseNumber },
          })
        }

        void dispatchOrderUpdated(order.locationId, { orderId, changes: ['course-fired-all'] }).catch(() => {})

        // Emit event-sourced events for fired items
        if (fireAllItemIds.length > 0) {
          void emitOrderEvents(order.locationId, orderId, fireAllItemIds.map(id => ({
            type: 'ITEM_UPDATED' as const,
            payload: { lineItemId: id, courseStatus: 'fired', isHeld: false },
          })))
        }

        return NextResponse.json({ data: {
          success: true,
          courseNumber,
          itemsFired: allFiredItems.count,
        } })
      }

      case 'hold': {
        // Query item IDs before batch update for event emission
        const holdItemIds = (await db.orderItem.findMany({
          where: { orderId, courseNumber, status: 'active', deletedAt: null, courseStatus: 'pending' },
          select: { id: true },
        })).map(i => i.id)

        // Hold all pending items in this course
        const heldItems = await db.orderItem.updateMany({
          where: {
            orderId,
            courseNumber,
            status: 'active',
            deletedAt: null,
            courseStatus: 'pending',
          },
          data: {
            isHeld: true,
          },
        })

        void dispatchOrderUpdated(order.locationId, { orderId, changes: ['course-held'] }).catch(() => {})

        // Emit event-sourced events for held items
        if (holdItemIds.length > 0) {
          void emitOrderEvents(order.locationId, orderId, holdItemIds.map(id => ({
            type: 'ITEM_UPDATED' as const,
            payload: { lineItemId: id, isHeld: true },
          })))
        }

        return NextResponse.json({ data: {
          success: true,
          courseNumber,
          itemsHeld: heldItems.count,
        } })
      }

      case 'release': {
        // Query item IDs before batch update for event emission
        const releaseItemIds = (await db.orderItem.findMany({
          where: { orderId, courseNumber, status: 'active', deletedAt: null, isHeld: true },
          select: { id: true },
        })).map(i => i.id)

        // Release hold on all items in this course
        const releasedItems = await db.orderItem.updateMany({
          where: {
            orderId,
            courseNumber,
            status: 'active',
            deletedAt: null,
            isHeld: true,
          },
          data: {
            isHeld: false,
          },
        })

        void dispatchOrderUpdated(order.locationId, { orderId, changes: ['course-released'] }).catch(() => {})

        // Emit event-sourced events for released items
        if (releaseItemIds.length > 0) {
          void emitOrderEvents(order.locationId, orderId, releaseItemIds.map(id => ({
            type: 'ITEM_UPDATED' as const,
            payload: { lineItemId: id, isHeld: false },
          })))
        }

        return NextResponse.json({ data: {
          success: true,
          courseNumber,
          itemsReleased: releasedItems.count,
        } })
      }

      case 'mark_ready': {
        // Query item IDs before batch update for event emission
        const readyItemIds = (await db.orderItem.findMany({
          where: { orderId, courseNumber, status: 'active', deletedAt: null, courseStatus: 'fired' },
          select: { id: true },
        })).map(i => i.id)

        // Mark all fired items in course as ready
        const readyItems = await db.orderItem.updateMany({
          where: {
            orderId,
            courseNumber,
            status: 'active',
            deletedAt: null,
            courseStatus: 'fired',
          },
          data: {
            courseStatus: 'ready',
            kitchenStatus: 'ready',
          },
        })

        void dispatchOrderUpdated(order.locationId, { orderId, changes: ['course-ready'] }).catch(() => {})

        // Emit event-sourced events for ready items
        if (readyItemIds.length > 0) {
          void emitOrderEvents(order.locationId, orderId, readyItemIds.map(id => ({
            type: 'ITEM_UPDATED' as const,
            payload: { lineItemId: id, courseStatus: 'ready', kitchenStatus: 'ready' },
          })))
        }

        return NextResponse.json({ data: {
          success: true,
          courseNumber,
          itemsReady: readyItems.count,
        } })
      }

      case 'mark_served': {
        // Query item IDs before batch update for event emission
        const servedItemIds = (await db.orderItem.findMany({
          where: { orderId, courseNumber, status: 'active', deletedAt: null, courseStatus: { in: ['fired', 'ready'] } },
          select: { id: true },
        })).map(i => i.id)

        // Mark all ready items in course as served
        const servedItems = await db.orderItem.updateMany({
          where: {
            orderId,
            courseNumber,
            status: 'active',
            deletedAt: null,
            courseStatus: { in: ['fired', 'ready'] },
          },
          data: {
            courseStatus: 'served',
            kitchenStatus: 'delivered',
          },
        })

        void dispatchOrderUpdated(order.locationId, { orderId, changes: ['course-served'] }).catch(() => {})

        // Emit event-sourced events for served items
        if (servedItemIds.length > 0) {
          void emitOrderEvents(order.locationId, orderId, servedItemIds.map(id => ({
            type: 'ITEM_UPDATED' as const,
            payload: { lineItemId: id, courseStatus: 'served', kitchenStatus: 'delivered' },
          })))
        }

        return NextResponse.json({ data: {
          success: true,
          courseNumber,
          itemsServed: servedItems.count,
        } })
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: fire, fire_all, hold, release, mark_ready, mark_served, set_mode, set_current' },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error('Failed to update course:', error)
    return NextResponse.json(
      { error: 'Failed to update course' },
      { status: 500 }
    )
  }
})
