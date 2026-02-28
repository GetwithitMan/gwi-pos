import { db } from '@/lib/db'
import { NextResponse } from 'next/server'
import { dispatchOrderUpdated, dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'

export const POST = withVenue(async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { removeAtSeatNumber } = await req.json()
  const { id: orderId } = await params

  try {
    return await db.$transaction(async (tx) => {
      // 1. Lock the order row
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`

      // 2. Delete items assigned to the seat being removed
      await tx.orderItem.deleteMany({
        where: { orderId, seatNumber: removeAtSeatNumber },
      })

      // 3. Shift all items ABOVE the removed seat DOWN by 1
      // We sort ASCENDING to fill the gap sequentially
      const itemsToShift = await tx.orderItem.findMany({
        where: { orderId, seatNumber: { gt: removeAtSeatNumber } },
        orderBy: { seatNumber: 'asc' },
      })

      for (const item of itemsToShift) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: { seatNumber: item.seatNumber! - 1 },
        })
      }

      // 4. Recalculate itemCount from remaining items
      const remainingItems = await tx.orderItem.findMany({
        where: { orderId },
        select: { quantity: true },
      })
      const newItemCount = remainingItems.reduce((sum, i) => sum + i.quantity, 0)

      // 5. Update Order Metadata
      await tx.order.update({
        where: { id: orderId },
        data: {
          extraSeatCount: { decrement: 1 },
          seatVersion: { increment: 1 },
          itemCount: newItemCount,
        },
      })

      // Get order for locationId, tableId, and seat counts (needed for socket dispatch + events)
      const orderData = await tx.order.findUnique({
        where: { id: orderId },
        select: { locationId: true, tableId: true, baseSeatCount: true, extraSeatCount: true },
      })

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
