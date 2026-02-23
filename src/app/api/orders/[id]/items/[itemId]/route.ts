import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchOpenOrdersChanged } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

// PUT - Update an order item (seat, course, hold status, kitchen status, etc.)
export const PUT = withVenue(async function PUT(
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
      include: {
        payments: {
          where: { deletedAt: null },
          select: { id: true, status: true },
        },
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Block modifications if any completed payment exists
    const hasCompletedPayment = order.payments?.some(p => p.status === 'completed') || false
    if (hasCompletedPayment) {
      return NextResponse.json(
        { error: 'Cannot modify an order with existing payments. Void the payment first.' },
        { status: 400 }
      )
    }

    // Validate quantity if provided (Bug 18)
    if (body.quantity !== undefined && body.quantity < 1) {
      return NextResponse.json({ error: 'Quantity must be at least 1' }, { status: 400 })
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
          await db.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } })
          return NextResponse.json({ data: { success: true, item: seatUpdated } })

        // Course Firing (Skill 12)
        case 'assign_course':
          const courseUpdated = await db.orderItem.update({
            where: { id: itemId },
            data: {
              courseNumber: updateData.courseNumber,
              courseStatus: 'pending',
            },
          })
          await db.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } })
          return NextResponse.json({ data: { success: true, item: courseUpdated } })

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

          await db.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } })
          return NextResponse.json({ data: { success: true, item: fired } })

        case 'mark_ready':
          // Kitchen marks item as ready
          const ready = await db.orderItem.update({
            where: { id: itemId },
            data: {
              courseStatus: 'ready',
              kitchenStatus: 'ready',
            },
          })
          await db.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } })
          return NextResponse.json({ data: { success: true, item: ready } })

        case 'mark_served':
          // Server marks item as served
          const served = await db.orderItem.update({
            where: { id: itemId },
            data: {
              courseStatus: 'served',
              kitchenStatus: 'delivered',
            },
          })
          await db.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } })
          return NextResponse.json({ data: { success: true, item: served } })

        // Hold & Fire (Skill 13)
        case 'hold':
          const held = await db.orderItem.update({
            where: { id: itemId },
            data: {
              isHeld: true,
              holdUntil: updateData.holdUntil ? new Date(updateData.holdUntil) : null,
            },
          })
          await db.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } })
          return NextResponse.json({ data: { success: true, item: held } })

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
          await db.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } })
          return NextResponse.json({ data: { success: true, item: firedItem } })

        case 'release':
          // Release hold without firing (item goes back to pending)
          const released = await db.orderItem.update({
            where: { id: itemId },
            data: {
              isHeld: false,
              holdUntil: null,
            },
          })
          await db.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } })
          return NextResponse.json({ data: { success: true, item: released } })

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

    await db.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } })

    return NextResponse.json({ data: {
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
    } })
  } catch (error) {
    console.error('Failed to update order item:', error)
    return NextResponse.json(
      { error: 'Failed to update order item' },
      { status: 500 }
    )
  }
})

// DELETE - Remove an order item (only if not yet sent to kitchen)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id: orderId, itemId } = await params

    // Verify order exists and is in a deletable state
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        locationId: true,
        payments: {
          where: { deletedAt: null },
          select: { id: true, status: true },
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Only allow item deletion on open/draft/sent orders (not paid/closed/voided/cancelled)
    const deletableStatuses = ['open', 'sent', 'draft']
    if (!deletableStatuses.includes(order.status)) {
      return NextResponse.json(
        { error: `Cannot delete items on a ${order.status} order` },
        { status: 400 }
      )
    }

    // Block deletion if any completed payment exists
    const hasCompletedPaymentDel = order.payments?.some(p => p.status === 'completed') || false
    if (hasCompletedPaymentDel) {
      return NextResponse.json(
        { error: 'Cannot modify an order with existing payments. Void the payment first.' },
        { status: 400 }
      )
    }

    // Verify item exists and belongs to this order
    const item = await db.orderItem.findFirst({
      where: { id: itemId, orderId },
    })

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    // Don't allow deleting items already sent to kitchen — use comp/void
    if (item.kitchenStatus !== 'pending') {
      return NextResponse.json(
        { error: 'Cannot delete an item that has been sent to the kitchen. Use comp/void instead.' },
        { status: 400 }
      )
    }

    // Don't allow deleting voided/comped items
    if (item.status !== 'active') {
      return NextResponse.json(
        { error: `Cannot delete a ${item.status} item` },
        { status: 400 }
      )
    }

    // Soft delete modifiers and the item (preserve audit trail)
    const now = new Date()
    await db.orderItemModifier.updateMany({
      where: { orderItemId: itemId },
      data: { deletedAt: now },
    })
    await db.orderItem.update({
      where: { id: itemId },
      data: { deletedAt: now, status: 'removed' },
    })

    await db.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } })

    // Dispatch socket event so other terminals see the removal (Bug 11)
    void dispatchOpenOrdersChanged(order.locationId, {
      trigger: 'voided',
      orderId: order.id,
    }).catch(() => {})

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete order item:', error)
    return NextResponse.json(
      { error: 'Failed to delete order item' },
      { status: 500 }
    )
  }
})
