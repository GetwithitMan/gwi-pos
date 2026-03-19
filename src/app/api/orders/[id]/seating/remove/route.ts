import { db } from '@/lib/db'
import { OrderRepository, OrderItemRepository } from '@/lib/repositories'
import { NextResponse } from 'next/server'
import { dispatchOrderUpdated, dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { getRequestLocationId } from '@/lib/request-context'

export const POST = withVenue(async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { removeAtSeatNumber } = await req.json()
  const { id: orderId } = await params

  // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
  let locationId = getRequestLocationId()
  if (!locationId) {
    const orderCheck = await db.order.findUnique({
      where: { id: orderId },
      select: { id: true, locationId: true },
    })
    if (!orderCheck) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }
    locationId = orderCheck.locationId
  }

  try {
    return await db.$transaction(async (tx) => {
      // 1. Lock the order row
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`

      // 2. Soft-delete items assigned to the seat being removed (preserve audit trail)
      await OrderItemRepository.updateItemsWhere(
        orderId, locationId,
        { seatNumber: removeAtSeatNumber },
        { deletedAt: new Date(), status: 'voided' },
        tx,
      )

      // 3. Shift all active items ABOVE the removed seat DOWN by 1
      // We sort ASCENDING to fill the gap sequentially
      const itemsToShift = await OrderItemRepository.getItemsForOrderWhere(
        orderId, locationId,
        { seatNumber: { gt: removeAtSeatNumber }, deletedAt: null },
        tx,
      )
      const sortedItems = [...itemsToShift].sort(
        (a, b) => (a.seatNumber || 0) - (b.seatNumber || 0)
      )

      for (const item of sortedItems) {
        await OrderItemRepository.updateItem(
          item.id, locationId,
          { seatNumber: item.seatNumber! - 1 },
          tx,
        )
      }

      // 4. Recalculate itemCount from remaining active items
      const remainingItems = await OrderItemRepository.getItemsForOrderWhere(
        orderId, locationId,
        { deletedAt: null, status: 'active' },
        tx,
      )
      const newItemCount = remainingItems.reduce((sum, i) => sum + i.quantity, 0)

      // 5. Update Order Metadata
      await OrderRepository.updateOrder(orderId, locationId, {
        extraSeatCount: { decrement: 1 },
        seatVersion: { increment: 1 },
        itemCount: newItemCount,
      }, tx)

      // Get order for tableId and seat counts (needed for socket dispatch + events)
      const orderData = await OrderRepository.getOrderByIdWithSelect(
        orderId, locationId,
        { locationId: true, tableId: true, baseSeatCount: true, extraSeatCount: true },
        tx,
      )

      if (orderData) {
        // Event emission: seat removed — guest count decreased
        void emitOrderEvent(orderData.locationId, orderId, 'GUEST_COUNT_CHANGED', {
          count: orderData.baseSeatCount + orderData.extraSeatCount,
        }).catch(console.error)

        // Dispatch socket events (fire-and-forget, outside transaction)
        void dispatchOrderUpdated(orderData.locationId, { orderId, changes: ['seats'] }).catch(() => {})
        if (orderData.tableId) {
          void dispatchFloorPlanUpdate(orderData.locationId, { async: true }).catch(() => {})
        }
      }

      return NextResponse.json({ data: { success: true } })
    })
  } catch (error) {
    console.error('[seating/remove] Shift-down failed:', error)
    return NextResponse.json({ error: 'SHIFT_DOWN_FAILED' }, { status: 500 })
  }
})
