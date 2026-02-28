import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'

// PUT - Update modifiers on an existing order item
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id: orderId, itemId } = await params
    const body = await request.json()
    const { modifiers } = body as {
      modifiers: Array<{
        id: string
        name: string
        price: number
      }>
    }

    // Verify order exists
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { id: true, locationId: true },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Verify order item exists and belongs to this order
    const orderItem = await db.orderItem.findUnique({
      where: { id: itemId },
      select: { id: true, orderId: true },
    })

    if (!orderItem || orderItem.orderId !== orderId) {
      return NextResponse.json(
        { error: 'Order item not found' },
        { status: 404 }
      )
    }

    // Delete existing modifiers and create new ones in a transaction
    await db.$transaction(async (tx) => {
      // Delete existing modifiers
      await tx.orderItemModifier.deleteMany({
        where: { orderItemId: itemId },
      })

      // Create new modifiers
      if (modifiers && modifiers.length > 0) {
        await tx.orderItemModifier.createMany({
          data: modifiers.map((mod) => ({
            locationId: order.locationId,
            orderItemId: itemId,
            modifierId: mod.id,
            name: mod.name,
            price: mod.price,
          })),
        })
      }

      // Increment resendCount on the order item
      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          resendCount: {
            increment: 1,
          },
        },
      })
    })

    // Fire-and-forget event emission
    void emitOrderEvent(order.locationId, orderId, 'ITEM_UPDATED', {
      lineItemId: itemId,
      modifiersJson: JSON.stringify(modifiers || []),
    }).catch(console.error)

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to update modifiers:', error)
    return NextResponse.json(
      { error: 'Failed to update modifiers' },
      { status: 500 }
    )
  }
})
