import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// PUT - Update an order item (seat, course, hold status, kitchen status, etc.)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id: orderId, itemId } = await params
    const body = await request.json()
    const { action, ...updateData } = body

    // Verify order exists
    const order = await db.order.findUnique({
      where: { id: orderId },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Verify item exists
    const item = await db.orderItem.findFirst({
      where: { id: itemId, orderId },
    })

    if (!item) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 }
      )
    }

    // Handle actions
    if (action) {
      switch (action) {
        // Seat Tracking (Skill 11)
        case 'assign_seat':
          const seatUpdated = await db.orderItem.update({
            where: { id: itemId },
            data: { seatNumber: updateData.seatNumber },
          })
          return NextResponse.json({ success: true, item: seatUpdated })

        // Course Firing (Skill 12)
        case 'assign_course':
          const courseUpdated = await db.orderItem.update({
            where: { id: itemId },
            data: {
              courseNumber: updateData.courseNumber,
              courseStatus: 'pending',
            },
          })
          return NextResponse.json({ success: true, item: courseUpdated })

        case 'fire_course':
          // Fire this item's course (mark as fired)
          const fired = await db.orderItem.update({
            where: { id: itemId },
            data: {
              courseStatus: 'fired',
              firedAt: new Date(),
              isHeld: false,
            },
          })

          // Also fire all other items with the same course number in this order
          if (updateData.fireAllInCourse && item.courseNumber) {
            await db.orderItem.updateMany({
              where: {
                orderId,
                courseNumber: item.courseNumber,
                id: { not: itemId },
              },
              data: {
                courseStatus: 'fired',
                firedAt: new Date(),
                isHeld: false,
              },
            })
          }

          return NextResponse.json({ success: true, item: fired })

        case 'mark_ready':
          // Kitchen marks item as ready
          const ready = await db.orderItem.update({
            where: { id: itemId },
            data: {
              courseStatus: 'ready',
              kitchenStatus: 'ready',
            },
          })
          return NextResponse.json({ success: true, item: ready })

        case 'mark_served':
          // Server marks item as served
          const served = await db.orderItem.update({
            where: { id: itemId },
            data: {
              courseStatus: 'served',
              kitchenStatus: 'delivered',
            },
          })
          return NextResponse.json({ success: true, item: served })

        // Hold & Fire (Skill 13)
        case 'hold':
          const held = await db.orderItem.update({
            where: { id: itemId },
            data: {
              isHeld: true,
              holdUntil: updateData.holdUntil ? new Date(updateData.holdUntil) : null,
            },
          })
          return NextResponse.json({ success: true, item: held })

        case 'fire':
          // Fire a held item immediately
          const firedItem = await db.orderItem.update({
            where: { id: itemId },
            data: {
              isHeld: false,
              holdUntil: null,
              firedAt: new Date(),
              courseStatus: item.courseNumber ? 'fired' : item.courseStatus,
            },
          })
          return NextResponse.json({ success: true, item: firedItem })

        case 'release':
          // Release hold without firing (item goes back to pending)
          const released = await db.orderItem.update({
            where: { id: itemId },
            data: {
              isHeld: false,
              holdUntil: null,
            },
          })
          return NextResponse.json({ success: true, item: released })

        default:
          return NextResponse.json(
            { error: 'Invalid action' },
            { status: 400 }
          )
      }
    }

    // Regular update (no action specified)
    const updated = await db.orderItem.update({
      where: { id: itemId },
      data: {
        seatNumber: updateData.seatNumber !== undefined ? updateData.seatNumber : undefined,
        courseNumber: updateData.courseNumber !== undefined ? updateData.courseNumber : undefined,
        courseStatus: updateData.courseStatus,
        isHeld: updateData.isHeld !== undefined ? updateData.isHeld : undefined,
        holdUntil: updateData.holdUntil ? new Date(updateData.holdUntil) : undefined,
        specialNotes: updateData.specialNotes,
      },
      include: { modifiers: true },
    })

    return NextResponse.json({
      success: true,
      item: {
        ...updated,
        price: Number(updated.price),
        modifierTotal: Number(updated.modifierTotal),
        itemTotal: Number(updated.itemTotal),
        modifiers: updated.modifiers.map(m => ({
          ...m,
          price: Number(m.price),
        })),
      },
    })
  } catch (error) {
    console.error('Failed to update order item:', error)
    return NextResponse.json(
      { error: 'Failed to update order item' },
      { status: 500 }
    )
  }
}
