import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { dispatchOpenOrdersChanged, dispatchItemStatus } from '@/lib/socket-dispatch'
import { OrderRepository, OrderItemRepository } from '@/lib/repositories'
import { getRequestLocationId } from '@/lib/request-context'

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

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let locationId = getRequestLocationId()
    if (!locationId) {
      const order = await adminDb.order.findFirst({
        where: { id: orderId, deletedAt: null },
        select: { id: true, locationId: true },
      })
      if (!order) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }
      locationId = order.locationId
    }

    // Verify item exists on this order
    const item = await OrderItemRepository.getItemById(itemId, locationId)
    if (!item || item.orderId !== orderId) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    // Update the special notes
    const updated = await OrderItemRepository.updateItemAndReturn(itemId, locationId, { specialNotes: note || null })

    // Emit order event for sync
    void emitOrderEvent(locationId, orderId, 'ITEM_UPDATED', {
      lineItemId: itemId,
      specialNotes: note || null,
    }).catch(console.error)

    // Notify other terminals so order lists, KDS, and prints reflect the updated note
    void dispatchOpenOrdersChanged(locationId, { trigger: 'item_updated', orderId }).catch(console.error)

    // If item has already been sent to kitchen, notify KDS so it refetches
    if (updated.kitchenStatus && updated.kitchenStatus !== 'pending') {
      void dispatchItemStatus(locationId, {
        orderId,
        itemId,
        status: updated.kitchenStatus,
        stationId: '',
        updatedBy: 'system',
      }, { async: true }).catch(console.error)
    }

    return NextResponse.json({ data: { item: updated } })
  } catch (error) {
    console.error('Failed to update item note:', error)
    return NextResponse.json({ error: 'Failed to update item note' }, { status: 500 })
  }
})
