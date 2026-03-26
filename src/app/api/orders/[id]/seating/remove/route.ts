import { db } from '@/lib/db'
import { OrderRepository, OrderItemRepository } from '@/lib/repositories'
import { NextResponse } from 'next/server'
import { dispatchOrderUpdated, dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { getRequestLocationId } from '@/lib/request-context'
import { recalculateOrderTotals } from '@/lib/domain/order-items/order-totals'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('orders-seating-remove')

export const POST = withVenue(withAuth({ allowCellular: true }, async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
      // 1. Lock the order row and check status
      const [lockedOrder] = await (tx as any).$queryRaw`
        SELECT "id", "status", "locationId", "tableId", "baseSeatCount", "extraSeatCount",
               "tipTotal", "isTaxExempt"
        FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
      ` as Array<{ id: string; status: string; locationId: string; tableId: string | null; baseSeatCount: number; extraSeatCount: number; tipTotal: any; isTaxExempt: boolean }>

      if (!lockedOrder) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }

      // Status guard: cannot remove seats from settled orders
      const blockedStatuses = ['paid', 'closed', 'voided', 'cancelled']
      if (blockedStatuses.includes(lockedOrder.status)) {
        return NextResponse.json(
          { error: `Cannot remove seat from ${lockedOrder.status} order` },
          { status: 400 }
        )
      }

      // 2. Soft-delete items assigned to the seat being removed (preserve audit trail)
      await OrderItemRepository.updateItemsWhere(
        orderId, locationId,
        { seatNumber: removeAtSeatNumber },
        { deletedAt: new Date(), status: 'voided' },
        tx,
      )

      // 3. Shift all active items ABOVE the removed seat DOWN by 1
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

      // 4. Recalculate order totals from remaining active items
      const location = await tx.location.findUnique({
        where: { id: locationId },
        select: { settings: true },
      })
      const tipTotal = Number(lockedOrder.tipTotal ?? 0)
      const totals = await recalculateOrderTotals(
        tx, orderId, location?.settings, tipTotal, lockedOrder.isTaxExempt
      )

      // 5. Update Order with recalculated totals + seat metadata
      await OrderRepository.updateOrder(orderId, locationId, {
        extraSeatCount: { decrement: 1 },
        seatVersion: { increment: 1 },
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        taxFromInclusive: totals.taxFromInclusive,
        taxFromExclusive: totals.taxFromExclusive,
        total: totals.total,
        commissionTotal: totals.commissionTotal,
        itemCount: totals.itemCount,
      }, tx)

      // 6. Event emission
      void emitOrderEvent(locationId, orderId, 'GUEST_COUNT_CHANGED', {
        count: lockedOrder.baseSeatCount + lockedOrder.extraSeatCount - 1,
      }).catch(err => log.warn({ err }, 'Background task failed'))
      void dispatchOrderUpdated(locationId, { orderId, changes: ['seats', 'totals'] }).catch(err => log.warn({ err }, 'order updated dispatch failed'))
      if (lockedOrder.tableId) {
        void dispatchFloorPlanUpdate(locationId, { async: true }).catch(err => log.warn({ err }, 'floor plan dispatch failed'))
      }

      pushUpstream()

      return NextResponse.json({ data: { success: true } })
    })
  } catch (error) {
    console.error('[seating/remove] Failed:', error)
    return NextResponse.json({ error: 'SEAT_REMOVE_FAILED' }, { status: 500 })
  }
}))
