import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { OrderRepository } from '@/lib/repositories'
import { mapOrderForResponse, mapOrderItemForResponse } from '@/lib/api/order-response-mapper'
import { recalculateOrderTotals } from '@/lib/domain/order-items'
import { dispatchOrderTotalsUpdate, dispatchOpenOrdersChanged, dispatchOrderSummaryUpdated, buildOrderSummary } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, ok, notFound } from '@/lib/api-response'

const log = createChildLogger('orders-repeat-round')

/**
 * POST /api/orders/[id]/repeat-round
 *
 * Duplicates all items from the most recent send (kitchenStatus IN sent/cooking/ready/delivered)
 * as new pending items. Bartender must send them separately.
 */
export const POST = withVenue(async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params

    const locationId = await getLocationId()
    if (!locationId) {
      return err('Location not found', 400)
    }

    // Fetch the order with its sent items and location settings
    const order = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
      location: { select: { settings: true } },
      items: {
        where: {
          deletedAt: null,
          kitchenStatus: { in: ['sent', 'cooking', 'ready', 'delivered'] },
        },
        include: {
          modifiers: { where: { deletedAt: null } },
          ingredientModifications: true,
        },
      },
    })

    if (!order) {
      return notFound('Order not found')
    }

    if (order.items.length === 0) {
      return err('No sent items to repeat')
    }

    // Create duplicate items inside a transaction
    const result = await db.$transaction(async (tx) => {
      const newItems: any[] = []

      for (const item of order.items) {
        // Create the new OrderItem with a fresh auto-generated ID
        const newItem = await tx.orderItem.create({
          data: {
            orderId,
            locationId: order.locationId,
            menuItemId: item.menuItemId,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            seatNumber: item.seatNumber,
            courseNumber: item.courseNumber,
            kitchenStatus: 'pending',
            status: 'active',
            itemTotal: item.itemTotal,
            isTaxInclusive: item.isTaxInclusive ?? false,
            cardPrice: item.cardPrice,
            pourSize: item.pourSize,
            pourMultiplier: item.pourMultiplier,
            specialNotes: item.specialNotes,
            modifiers: {
              create: item.modifiers.map((mod: any) => ({
                locationId: order.locationId,
                modifierId: mod.modifierId,
                name: mod.name,
                price: mod.price,
                quantity: mod.quantity ?? 1,
                preModifier: mod.preModifier,
                depth: mod.depth ?? 0,
                spiritTier: mod.spiritTier,
                linkedBottleProductId: mod.linkedBottleProductId,
                isCustomEntry: mod.isCustomEntry ?? false,
                isNoneSelection: mod.isNoneSelection ?? false,
                customEntryName: mod.customEntryName,
                customEntryPrice: mod.customEntryPrice,
                noneShowOnReceipt: mod.noneShowOnReceipt ?? false,
                swapTargetName: mod.swapTargetName,
                swapTargetItemId: mod.swapTargetItemId,
                swapPricingMode: mod.swapPricingMode,
                swapEffectivePrice: mod.swapEffectivePrice,
              })),
            },
          },
          include: {
            modifiers: true,
            ingredientModifications: true,
          },
        })
        newItems.push(newItem)
      }

      // Recalculate order totals
      const totals = await recalculateOrderTotals(
        tx,
        orderId,
        order.location.settings,
        Number(order.tipTotal) || 0,
        order.isTaxExempt
      )

      // Update order totals + bump version
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          ...totals,
          version: { increment: 1 },
        },
        include: {
          employee: {
            select: { id: true, displayName: true, firstName: true, lastName: true },
          },
          items: {
            where: { deletedAt: null },
            include: {
              modifiers: { where: { deletedAt: null } },
              ingredientModifications: true,
              pizzaData: true,
            },
          },
        },
      })

      return { updatedOrder, newItems }
    })

    const { updatedOrder, newItems } = result

    // Fire-and-forget: socket events
    void dispatchOrderTotalsUpdate(updatedOrder.locationId, updatedOrder.id, {
      subtotal: Number(updatedOrder.subtotal),
      taxTotal: Number(updatedOrder.taxTotal),
      tipTotal: Number(updatedOrder.tipTotal),
      discountTotal: Number(updatedOrder.discountTotal),
      total: Number(updatedOrder.total),
      commissionTotal: Number(updatedOrder.commissionTotal || 0),
    }, { async: true }).catch(e => log.warn({ err: e }, 'totals dispatch failed'))

    void dispatchOpenOrdersChanged(updatedOrder.locationId, {
      trigger: 'item_updated',
      orderId: updatedOrder.id,
    }, { async: true }).catch(e => log.warn({ err: e }, 'open orders dispatch failed'))

    void dispatchOrderSummaryUpdated(updatedOrder.locationId, buildOrderSummary(updatedOrder), { async: true })
      .catch(e => log.warn({ err: e }, 'order summary dispatch failed'))

    // Fire-and-forget: emit ITEM_ADDED events for each new item
    for (const item of newItems) {
      void emitOrderEvent(updatedOrder.locationId, orderId, 'ITEM_ADDED', {
        lineItemId: item.id,
        menuItemId: item.menuItemId,
        name: item.name,
        priceCents: Math.round(Number(item.price) * 100),
        quantity: item.quantity,
        seatNumber: item.seatNumber ?? null,
        courseNumber: item.courseNumber ?? null,
        source: 'repeat_round',
      })
    }

    // Trigger upstream sync
    pushUpstream()

    // Build response
    const response = {
      ...mapOrderForResponse(updatedOrder),
      items: updatedOrder.items.map((item: any) => mapOrderItemForResponse(item)),
    }

    return ok(response)
  } catch (error) {
    log.error({ err: error }, 'Failed to repeat round')
    const message = error instanceof Error ? error.message : 'Unknown error'
    return err('Failed to repeat round', 500, message)
  }
})
