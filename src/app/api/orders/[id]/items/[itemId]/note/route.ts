import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { dispatchOpenOrdersChanged, dispatchItemStatus } from '@/lib/socket-dispatch'
import { OrderItemRepository } from '@/lib/repositories'
import { getRequestLocationId } from '@/lib/request-context'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('orders-note')

// POST — update an order item's special notes
export const POST = withVenue(withAuth({ allowCellular: true }, async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id: orderId, itemId } = await params
    const body = await request.json()
    const { note } = body

    if (typeof note !== 'string') {
      return err('note must be a string')
    }

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let locationId = getRequestLocationId()
    if (!locationId) {
      const order = await db.order.findFirst({
        where: { id: orderId, deletedAt: null },
        select: { id: true, locationId: true },
      })
      if (!order) {
        return notFound('Order not found')
      }
      locationId = order.locationId
    }

    // Verify item exists on this order
    const item = await OrderItemRepository.getItemById(itemId, locationId)
    if (!item || item.orderId !== orderId) {
      return notFound('Item not found')
    }

    // Update the special notes
    const updated = await OrderItemRepository.updateItemAndReturn(itemId, locationId, { specialNotes: note || null })

    // Emit order event for sync
    void emitOrderEvent(locationId, orderId, 'ITEM_UPDATED', {
      lineItemId: itemId,
      specialNotes: note || null,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    // Notify other terminals so order lists, KDS, and prints reflect the updated note
    void dispatchOpenOrdersChanged(locationId, { trigger: 'item_updated', orderId }).catch(err => log.warn({ err }, 'Background task failed'))

    // If item has already been sent to kitchen, notify KDS so it refetches
    if (updated && updated.kitchenStatus && updated.kitchenStatus !== 'pending') {
      void dispatchItemStatus(locationId, {
        orderId,
        itemId,
        status: updated.kitchenStatus,
        stationId: '',
        updatedBy: 'system',
      }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    pushUpstream()

    return ok({ item: updated })
  } catch (error) {
    console.error('Failed to update item note:', error)
    return err('Failed to update item note', 500)
  }
}))
