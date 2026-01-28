import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - Get course status for an order
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          where: { status: 'active' },
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

    // Group items by course
    const courses: Record<number, {
      courseNumber: number
      status: string
      itemCount: number
      readyCount: number
      servedCount: number
      items: Array<{
        id: string
        name: string
        seatNumber: number | null
        courseStatus: string
        isHeld: boolean
      }>
    }> = {}

    for (const item of order.items) {
      const courseNum = item.courseNumber || 0

      if (!courses[courseNum]) {
        courses[courseNum] = {
          courseNumber: courseNum,
          status: 'pending',
          itemCount: 0,
          readyCount: 0,
          servedCount: 0,
          items: [],
        }
      }

      courses[courseNum].itemCount++
      if (item.courseStatus === 'ready') courses[courseNum].readyCount++
      if (item.courseStatus === 'served') courses[courseNum].servedCount++

      courses[courseNum].items.push({
        id: item.id,
        name: item.name,
        seatNumber: item.seatNumber,
        courseStatus: item.courseStatus,
        isHeld: item.isHeld,
      })
    }

    // Determine course status
    for (const course of Object.values(courses)) {
      if (course.servedCount === course.itemCount) {
        course.status = 'served'
      } else if (course.readyCount === course.itemCount) {
        course.status = 'ready'
      } else if (course.items.some(i => i.courseStatus === 'fired')) {
        course.status = 'fired'
      } else if (course.items.every(i => i.isHeld)) {
        course.status = 'held'
      } else {
        course.status = 'pending'
      }
    }

    return NextResponse.json({
      orderId,
      courses: Object.values(courses).sort((a, b) => a.courseNumber - b.courseNumber),
    })
  } catch (error) {
    console.error('Failed to get courses:', error)
    return NextResponse.json(
      { error: 'Failed to get courses' },
      { status: 500 }
    )
  }
}

// POST - Fire a course
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { courseNumber, action } = body

    if (courseNumber === undefined) {
      return NextResponse.json(
        { error: 'Course number is required' },
        { status: 400 }
      )
    }

    const order = await db.order.findUnique({
      where: { id: orderId },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    switch (action) {
      case 'fire':
        // Fire all items in this course
        const firedItems = await db.orderItem.updateMany({
          where: {
            orderId,
            courseNumber,
            status: 'active',
            courseStatus: { in: ['pending', 'held'] },
          },
          data: {
            courseStatus: 'fired',
            firedAt: new Date(),
            isHeld: false,
          },
        })

        return NextResponse.json({
          success: true,
          courseNumber,
          itemsFired: firedItems.count,
        })

      case 'hold':
        // Hold all items in this course
        const heldItems = await db.orderItem.updateMany({
          where: {
            orderId,
            courseNumber,
            status: 'active',
            courseStatus: 'pending',
          },
          data: {
            isHeld: true,
          },
        })

        return NextResponse.json({
          success: true,
          courseNumber,
          itemsHeld: heldItems.count,
        })

      case 'mark_ready':
        // Mark all items in course as ready
        const readyItems = await db.orderItem.updateMany({
          where: {
            orderId,
            courseNumber,
            status: 'active',
          },
          data: {
            courseStatus: 'ready',
            kitchenStatus: 'ready',
          },
        })

        return NextResponse.json({
          success: true,
          courseNumber,
          itemsReady: readyItems.count,
        })

      case 'mark_served':
        // Mark all items in course as served
        const servedItems = await db.orderItem.updateMany({
          where: {
            orderId,
            courseNumber,
            status: 'active',
          },
          data: {
            courseStatus: 'served',
            kitchenStatus: 'delivered',
          },
        })

        return NextResponse.json({
          success: true,
          courseNumber,
          itemsServed: servedItems.count,
        })

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: fire, hold, mark_ready, mark_served' },
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
}
