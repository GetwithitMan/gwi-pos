import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'

// POST — update an order item's special notes
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id: orderId, itemId } = await params
    const body = await request.json()
    const { note } = body

    if (typeof note !== 'string') {
      return NextResponse.json({ error: 'note must be a string' }, { status: 400 })
    }

    // Verify order exists
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { id: true, locationId: true },
    })
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Verify item exists on this order
    const item = await db.orderItem.findFirst({
      where: { id: itemId, orderId },
    })
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    // Update the special notes
    const updated = await db.orderItem.update({
      where: { id: itemId },
      data: { specialNotes: note || null },
    })

    // Emit order event for sync
    void emitOrderEvent(order.locationId, orderId, 'ITEM_UPDATED', {
      lineItemId: itemId,
      specialNotes: note || null,
    }).catch(console.error)

    return NextResponse.json({ data: { item: updated } })
  } catch (error) {
    console.error('Failed to update item note:', error)
    return NextResponse.json({ error: 'Failed to update item note' }, { status: 500 })
  }
})
