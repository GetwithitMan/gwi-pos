import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { evaluateAutoDiscounts } from '@/lib/auto-discount-engine'
import {
  dispatchOrderTotalsUpdate,
  dispatchOpenOrdersChanged,
  dispatchOrderSummaryUpdated,
  buildOrderSummary,
} from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { OrderRepository } from '@/lib/repositories'
import { getRequestLocationId } from '@/lib/request-context'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('orders-auto-discounts')

/**
 * POST /api/orders/[id]/auto-discounts
 *
 * Manually trigger auto-discount evaluation for an order.
 * Useful for re-evaluating after manual changes or debugging.
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params

    // TODO: Initial fetch uses raw db because locationId is unknown until fetch.
    // Once withVenue injects locationId, replace with OrderRepository.getOrderByIdWithSelect.
    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: { id: true, locationId: true, status: true },
    })

    if (!order) {
      return notFound('Order not found')
    }

    const locationId = order.locationId

    // Permission check: POS_ACCESS required to trigger auto-discount evaluation
    const actor = await getActorFromRequest(request)
    const autoDiscountAuth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!autoDiscountAuth.authorized) return err(autoDiscountAuth.error, autoDiscountAuth.status)

    if (order.status !== 'open' && order.status !== 'draft' && order.status !== 'in_progress') {
      return err('Cannot evaluate discounts on a closed order')
    }

    const result = await evaluateAutoDiscounts(orderId, locationId)

    // Emit order events for event sourcing
    for (const applied of result.applied) {
      void emitOrderEvent(locationId, orderId, 'DISCOUNT_APPLIED', {
        discountId: applied.id,
        type: 'auto',
        value: applied.percent ?? 0,
        amountCents: Math.round((applied.amount ?? 0) * 100),
        reason: applied.name ?? 'Auto-discount',
        lineItemId: null,
      }).catch(err => console.error('[auto-discounts] Failed to emit DISCOUNT_APPLIED event:', err))
    }
    for (const discountId of result.removed) {
      void emitOrderEvent(locationId, orderId, 'DISCOUNT_REMOVED', {
        discountId,
        lineItemId: null,
      }).catch(err => console.error('[auto-discounts] Failed to emit DISCOUNT_REMOVED event:', err))
    }

    // Fire-and-forget socket dispatches for cross-terminal sync
    if (result.applied.length > 0 || result.removed.length > 0) {
      const updatedOrder = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
        table: { select: { name: true } },
      })

      if (updatedOrder) {
        void dispatchOrderTotalsUpdate(order.locationId, orderId, {
          subtotal: Number(updatedOrder.subtotal),
          taxTotal: Number(updatedOrder.taxTotal),
          tipTotal: Number(updatedOrder.tipTotal),
          discountTotal: Number(updatedOrder.discountTotal),
          total: Number(updatedOrder.total),
          commissionTotal: Number(updatedOrder.commissionTotal || 0),
        }).catch(err => log.warn({ err }, 'Background task failed'))

        void dispatchOpenOrdersChanged(order.locationId, {
          trigger: 'item_updated',
          orderId,
        }).catch(err => log.warn({ err }, 'Background task failed'))

        void dispatchOrderSummaryUpdated(
          order.locationId,
          buildOrderSummary(updatedOrder),
        ).catch(err => log.warn({ err }, 'Background task failed'))
      }
    }

    if (result.applied.length > 0 || result.removed.length > 0) {
      pushUpstream()
    }

    return ok({
        applied: result.applied,
        removed: result.removed,
        appliedCount: result.applied.length,
        removedCount: result.removed.length,
      })
  } catch (error) {
    console.error('Failed to evaluate auto-discounts:', error)
    return err('Failed to evaluate auto-discounts', 500)
  }
})

/**
 * GET /api/orders/[id]/auto-discounts
 *
 * Return currently applied auto-discounts for an order.
 */
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let orderLocationId = getRequestLocationId()
    if (!orderLocationId) {
      // TODO: Initial fetch uses raw db because locationId is unknown until fetch.
      // Once withVenue injects locationId, replace with OrderRepository.getOrderByIdWithSelect.
      const order = await db.order.findFirst({
        where: { id: orderId, deletedAt: null },
        select: { id: true, locationId: true },
      })

      if (!order) {
        return notFound('Order not found')
      }
      orderLocationId = order.locationId
    }

    // TODO: No OrderDiscountRepository -- raw db with locationId guard
    const autoDiscounts = await db.orderDiscount.findMany({
      where: {
        orderId,
        locationId: orderLocationId,
        isAutomatic: true,
        deletedAt: null,
      },
      include: {
        discountRule: {
          select: {
            id: true,
            name: true,
            displayText: true,
            discountType: true,
            isStackable: true,
            priority: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    return ok({
        discounts: autoDiscounts.map(d => ({
          id: d.id,
          name: d.name,
          amount: Number(d.amount),
          percent: d.percent ? Number(d.percent) : null,
          discountRuleId: d.discountRuleId,
          rule: d.discountRule ? {
            id: d.discountRule.id,
            name: d.discountRule.name,
            displayText: d.discountRule.displayText,
            discountType: d.discountRule.discountType,
            isStackable: d.discountRule.isStackable,
            priority: d.discountRule.priority,
          } : null,
          reason: d.reason,
          createdAt: d.createdAt.toISOString(),
        })),
        count: autoDiscounts.length,
      })
  } catch (error) {
    console.error('Failed to fetch auto-discounts:', error)
    return err('Failed to fetch auto-discounts', 500)
  }
})
