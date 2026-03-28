import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { dispatchOpenOrdersChanged, dispatchOrderSummaryUpdated, buildOrderSummary } from '@/lib/socket-dispatch'
import { OrderRepository, OrderItemRepository } from '@/lib/repositories'
import { getRequestLocationId } from '@/lib/request-context'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('orders-modifiers')

// PUT - Update modifiers on an existing order item
export const PUT = withVenue(withAuth({ allowCellular: true }, async function PUT(
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
        spiritTier?: 'well' | 'call' | 'premium' | 'top_shelf' | null
        linkedBottleProductId?: string | null
      }>
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

    // Verify order item exists and belongs to this order
    const orderItem = await OrderItemRepository.getItemByIdWithSelect(itemId, locationId, {
      id: true,
      orderId: true,
    })

    if (!orderItem || orderItem.orderId !== orderId) {
      return notFound('Order item not found')
    }

    // Delete existing modifiers and create new ones in a transaction
    await db.$transaction(async (tx) => {
      // Delete existing modifiers (no repository for OrderItemModifier)
      await tx.orderItemModifier.deleteMany({
        where: { orderItemId: itemId },
      })

      // Create new modifiers
      if (modifiers && modifiers.length > 0) {
        await tx.orderItemModifier.createMany({
          data: modifiers.map((mod) => ({
            locationId,
            orderItemId: itemId,
            modifierId: mod.id,
            name: mod.name,
            price: mod.price,
            spiritTier: mod.spiritTier ?? null,
            linkedBottleProductId: mod.linkedBottleProductId ?? null,
          })),
        })
      }

      // Increment resendCount on the order item
      await OrderItemRepository.updateItem(itemId, locationId, {
        resendCount: { increment: 1 },
      }, tx)
    })

    // Fire-and-forget event emission
    void emitOrderEvent(locationId, orderId, 'ITEM_UPDATED', {
      lineItemId: itemId,
      modifiersJson: JSON.stringify(modifiers || []),
    }).catch(err => log.warn({ err }, 'Background task failed'))

    // Fire-and-forget socket dispatches so other terminals see updated modifiers/totals
    void dispatchOpenOrdersChanged(locationId, {
      trigger: 'item_updated',
      orderId,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    // Re-fetch order with totals for Android cross-terminal summary
    void (async () => {
      try {
        const freshOrder = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
          table: { select: { name: true } },
          _count: { select: { items: true } },
        })
        if (freshOrder) {
          const summary = buildOrderSummary({
            ...freshOrder,
            itemCount: freshOrder._count.items,
          })
          await dispatchOrderSummaryUpdated(locationId, summary)
        }
      } catch (err) {
        console.error('[modifiers/route] Failed to dispatch order summary:', err)
      }
    })()

    pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('Failed to update modifiers:', error)
    return err('Failed to update modifiers', 500)
  }
}))
