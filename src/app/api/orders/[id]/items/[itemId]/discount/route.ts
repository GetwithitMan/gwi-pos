import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { calculateOrderTotals } from '@/lib/order-calculations'
import type { OrderItemForCalculation } from '@/lib/order-calculations'
import { withVenue } from '@/lib/with-venue'
import { dispatchOpenOrdersChanged, dispatchOrderTotalsUpdate } from '@/lib/socket-dispatch'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { OrderRepository, OrderItemRepository } from '@/lib/repositories'
import { roundToCents } from '@/lib/pricing'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('orders.id.items.itemId.discount')

interface ApplyItemDiscountRequest {
  type: 'percent' | 'fixed'
  value: number
  reason?: string
  employeeId: string
  discountRuleId?: string
  approvedById?: string  // Manager ID if approval required
}

// POST — Apply item-level discount
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id: orderId, itemId } = await params
    const body = await request.json() as ApplyItemDiscountRequest

    // Validate required fields
    if (!body.type || body.value === undefined || body.value === null || !body.employeeId) {
      return NextResponse.json(
        { error: 'type, value, and employeeId are required' },
        { status: 400 }
      )
    }

    if (body.value <= 0) {
      return NextResponse.json(
        { error: 'Discount value must be greater than 0' },
        { status: 400 }
      )
    }

    if (body.type === 'percent' && body.value > 100) {
      return NextResponse.json(
        { error: 'Percentage cannot exceed 100%' },
        { status: 400 }
      )
    }

    const result = await db.$transaction(async (tx) => {
      // Lock the Order row to prevent concurrent discount applications from producing incorrect totals
      await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId)

      // Fetch order with items for split-aware tax (tenant-safe via OrderRepository)
      const [lockedDisc] = await tx.$queryRawUnsafe<Array<{ locationId: string }>>(
        'SELECT "locationId" FROM "Order" WHERE id = $1', orderId
      )
      if (!lockedDisc) {
        return NextResponse.json(
          { error: 'Order not found' },
          { status: 404 }
        )
      }
      const order = await OrderRepository.getOrderByIdWithInclude(orderId, lockedDisc.locationId, {
        location: true,
        items: { where: { deletedAt: null, status: 'active' }, include: { modifiers: true } },
      }, tx)

      if (!order) {
        return NextResponse.json(
          { error: 'Order not found' },
          { status: 404 }
        )
      }

      // Auth check — require manager.discounts permission
      const auth = await requirePermission(body.employeeId, order.locationId, PERMISSIONS.MGR_DISCOUNTS)
      if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

      if (order.status === 'paid' || order.status === 'closed') {
        return NextResponse.json(
          { error: 'Cannot apply discount to a paid or closed order' },
          { status: 409 }
        )
      }

      // Fetch item (tenant-safe via OrderItemRepository)
      const item = await OrderItemRepository.getItemByIdWithInclude(itemId, order.locationId, {
        menuItem: { select: { itemType: true } },
      }, tx)

      if (!item) {
        return NextResponse.json(
          { error: 'Order item not found' },
          { status: 404 }
        )
      }

      // Block item-level discounts on timed_rental items (dynamic pricing makes fixed discounts unreliable)
      if (item.menuItem?.itemType === 'timed_rental') {
        return NextResponse.json(
          { error: 'Cannot apply item-level discounts to timed rental items. Use order-level discounts instead.' },
          { status: 400 }
        )
      }

      // Toggle prevention: if this discountRuleId is already applied to this item, remove it
      if (body.discountRuleId) {
        const alreadyApplied = await tx.orderItemDiscount.findFirst({
          where: { orderItemId: itemId, discountRuleId: body.discountRuleId, deletedAt: null },
        })
        if (alreadyApplied) {
          const removedAmount = Number(alreadyApplied.amount)
          await tx.orderItemDiscount.update({
            where: { id: alreadyApplied.id },
            data: { deletedAt: new Date() },
          })
          const newDiscountTotal = Math.max(0, Number(order.discountTotal) - removedAmount)
          const calcItems: OrderItemForCalculation[] = order.items.map(i => ({
            price: Number(i.price), quantity: i.quantity, status: i.status,
            itemTotal: Number(i.itemTotal), isTaxInclusive: i.isTaxInclusive ?? false,
            modifiers: i.modifiers.map(m => ({ price: Number(m.price), quantity: m.quantity ?? 1 })),
          }))
          const totals = calculateOrderTotals(
            calcItems, order.location.settings as { tax?: { defaultRate?: number; inclusiveTaxRate?: number } },
            newDiscountTotal, Number(order.tipTotal || 0), undefined, 'card', order.isTaxExempt,
            Number(order.inclusiveTaxRate) || undefined
          )
          const toggleDonation = Number(order.donationAmount || 0)
          const toggleConvFee = Number(order.convenienceFee || 0)
          const toggleFinalTotal = toggleDonation > 0 || toggleConvFee > 0
            ? roundToCents(totals.total + toggleDonation + toggleConvFee)
            : totals.total
          await OrderRepository.updateOrder(orderId, order.locationId, { discountTotal: totals.discountTotal, taxTotal: totals.taxTotal, taxFromInclusive: totals.taxFromInclusive, taxFromExclusive: totals.taxFromExclusive, total: toggleFinalTotal }, tx)
          const updatedOrder = await OrderRepository.getOrderByIdWithSelect(orderId, order.locationId, { subtotal: true, discountTotal: true, taxTotal: true, tipTotal: true, total: true }, tx)
          if (!updatedOrder) throw new Error(`Order ${orderId} not found after update`)
          void dispatchOpenOrdersChanged(order.locationId, { trigger: 'created', orderId }, { async: true }).catch(err => log.warn({ err }, 'open orders dispatch failed'))
          void dispatchOrderTotalsUpdate(order.locationId, orderId, {
            subtotal: Number(updatedOrder.subtotal),
            taxTotal: Number(updatedOrder.taxTotal),
            tipTotal: Number(updatedOrder.tipTotal),
            discountTotal: Number(updatedOrder.discountTotal),
            total: Number(updatedOrder.total),
          }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.items.itemId.discount'))
          void emitOrderEvent(order.locationId, orderId, 'DISCOUNT_REMOVED', {
            discountId: alreadyApplied.id,
            lineItemId: itemId,
          })

          return NextResponse.json({
            data: {
              toggled: 'off',
              removedDiscountId: alreadyApplied.id,
              orderTotals: {
                subtotal: Number(updatedOrder.subtotal),
                discountTotal: Number(updatedOrder.discountTotal),
                taxTotal: Number(updatedOrder.taxTotal),
                total: Number(updatedOrder.total),
              },
            },
          })
        }
      }

      // Calculate discount amount
      let discountAmount: number
      let discountPercent: number | null = null

      if (body.type === 'fixed') {
        discountAmount = Math.min(body.value, Number(item.itemTotal))
      } else {
        discountPercent = body.value
        discountAmount = Math.round(Number(item.itemTotal) * (body.value / 100) * 100) / 100
      }

      // Cap the new discount so total item-level discounts never exceed the item price
      const existingItemDiscounts = await tx.orderItemDiscount.aggregate({
        where: { orderItemId: itemId, deletedAt: null },
        _sum: { amount: true },
      })
      const existingDiscountSum = Number(existingItemDiscounts._sum.amount || 0)
      const maxNewDiscount = Math.max(0, Number(item.itemTotal) - existingDiscountSum)
      discountAmount = Math.min(discountAmount, maxNewDiscount)
      if (discountAmount <= 0) {
        return NextResponse.json(
          { error: 'Item is already fully discounted' },
          { status: 400 }
        )
      }

      // Create the OrderItemDiscount record
      const itemDiscount = await tx.orderItemDiscount.create({
        data: {
          locationId: order.locationId,
          orderId,
          orderItemId: itemId,
          discountRuleId: body.discountRuleId ?? null,
          amount: discountAmount,
          percent: discountPercent,
          appliedById: body.employeeId,
          reason: body.reason ?? null,
        },
      })

      // Update Order.discountTotal (increment) and recalculate total via calculateOrderTotals
      const newDiscountTotal = Number(order.discountTotal) + discountAmount
      const applyCalcItems: OrderItemForCalculation[] = order.items.map(i => ({
        price: Number(i.price), quantity: i.quantity, status: i.status,
        itemTotal: Number(i.itemTotal), isTaxInclusive: i.isTaxInclusive ?? false,
        modifiers: i.modifiers.map(m => ({ price: Number(m.price), quantity: m.quantity ?? 1 })),
      }))
      const totals = calculateOrderTotals(
        applyCalcItems, order.location.settings as { tax?: { defaultRate?: number; inclusiveTaxRate?: number } },
        newDiscountTotal, Number(order.tipTotal || 0), undefined, 'card', order.isTaxExempt,
        Number(order.inclusiveTaxRate) || undefined
      )

      const applyDonation = Number(order.donationAmount || 0)
      const applyConvFee = Number(order.convenienceFee || 0)
      const applyFinalTotal = applyDonation > 0 || applyConvFee > 0
        ? roundToCents(totals.total + applyDonation + applyConvFee)
        : totals.total

      await OrderRepository.updateOrder(orderId, order.locationId, {
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        taxFromInclusive: totals.taxFromInclusive,
        taxFromExclusive: totals.taxFromExclusive,
        total: applyFinalTotal,
      }, tx)
      const updatedOrder = await OrderRepository.getOrderByIdWithSelect(orderId, order.locationId, { subtotal: true, discountTotal: true, taxTotal: true, tipTotal: true, total: true }, tx)
      if (!updatedOrder) throw new Error(`Order ${orderId} not found after update`)

      // Emit order event for item discount applied (fire-and-forget)
      void emitOrderEvent(order.locationId, orderId, 'DISCOUNT_APPLIED', {
        discountId: itemDiscount.id,
        type: body.type,
        value: body.value,
        amountCents: Math.round(Number(itemDiscount.amount) * 100),
        reason: body.reason || null,
        lineItemId: itemId,
      })

      // Fire-and-forget socket dispatch
      void dispatchOpenOrdersChanged(order.locationId, {
        trigger: 'created',
        orderId,
      }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.items.itemId.discount'))
      void dispatchOrderTotalsUpdate(order.locationId, orderId, {
        subtotal: Number(updatedOrder.subtotal),
        taxTotal: Number(updatedOrder.taxTotal),
        tipTotal: Number(updatedOrder.tipTotal),
        discountTotal: Number(updatedOrder.discountTotal),
        total: Number(updatedOrder.total),
      }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.items.itemId.discount'))
      if (body.approvedById) {
        await tx.auditLog.create({
          data: {
            locationId: order.locationId,
            action: 'item_discount_override',
            employeeId: body.approvedById,
            details: JSON.stringify({ orderId, itemId, type: body.type, value: body.value, reason: body.reason }),
          },
        })
      }

      return NextResponse.json({
        data: {
          discount: {
            id: itemDiscount.id,
            amount: Number(itemDiscount.amount),
            percent: itemDiscount.percent !== null ? Number(itemDiscount.percent) : null,
            reason: itemDiscount.reason,
            appliedById: itemDiscount.appliedById,
            createdAt: itemDiscount.createdAt.toISOString(),
          },
          newItemTotal: Number(item.itemTotal) - discountAmount,
          newOrderTotal: Number(updatedOrder.total),
          orderTotals: {
            subtotal: Number(updatedOrder.subtotal),
            discountTotal: Number(updatedOrder.discountTotal),
            taxTotal: Number(updatedOrder.taxTotal),
            total: Number(updatedOrder.total),
          },
        },
      })
    })

    return result
  } catch (error) {
    console.error('Failed to apply item discount:', error)
    return NextResponse.json(
      { error: 'Failed to apply item discount' },
      { status: 500 }
    )
  }
})

// DELETE — Remove an item discount
// Query: ?discountId={id}
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id: orderId, itemId } = await params
    const discountId = request.nextUrl.searchParams.get('discountId')
    const employeeId = request.nextUrl.searchParams.get('employeeId')

    if (!discountId) {
      return NextResponse.json(
        { error: 'discountId query parameter is required' },
        { status: 400 }
      )
    }

    if (!employeeId) {
      return NextResponse.json(
        { error: 'employeeId query parameter is required' },
        { status: 400 }
      )
    }

    const result = await db.$transaction(async (tx) => {
      // Lock the Order row to prevent concurrent discount removals from producing incorrect totals
      await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId)

      // Fetch the discount and verify it belongs to this order/item
      const existingDiscount = await tx.orderItemDiscount.findFirst({
        where: {
          id: discountId,
          orderId,
          orderItemId: itemId,
          deletedAt: null,
        },
      })

      if (!existingDiscount) {
        return NextResponse.json(
          { error: 'Discount not found on this item' },
          { status: 404 }
        )
      }

      // Fetch order with items for split-aware tax recalculation (tenant-safe via OrderRepository)
      const [lockedDiscDel] = await tx.$queryRawUnsafe<Array<{ locationId: string }>>(
        'SELECT "locationId" FROM "Order" WHERE id = $1', orderId
      )
      if (!lockedDiscDel) {
        return NextResponse.json(
          { error: 'Order not found' },
          { status: 404 }
        )
      }
      const order = await OrderRepository.getOrderByIdWithInclude(orderId, lockedDiscDel.locationId, {
        location: true,
        items: { where: { deletedAt: null, status: 'active' }, include: { modifiers: true } },
      }, tx)

      if (!order) {
        return NextResponse.json(
          { error: 'Order not found' },
          { status: 404 }
        )
      }

      // Auth check — require manager.discounts permission
      const authResult = await requirePermission(employeeId, order.locationId, PERMISSIONS.MGR_DISCOUNTS)
      if (!authResult.authorized) return NextResponse.json({ error: authResult.error }, { status: authResult.status ?? 403 })

      const discountAmount = Number(existingDiscount.amount)

      // Soft delete the discount
      await tx.orderItemDiscount.update({
        where: { id: discountId },
        data: {
          updatedAt: new Date(),
          deletedAt: new Date(),
        },
      })

      // Update Order.discountTotal (decrement) and recalculate total via calculateOrderTotals
      const newDiscountTotal = Math.max(0, Number(order.discountTotal) - discountAmount)
      const delCalcItems: OrderItemForCalculation[] = order.items.map(i => ({
        price: Number(i.price), quantity: i.quantity, status: i.status,
        itemTotal: Number(i.itemTotal), isTaxInclusive: i.isTaxInclusive ?? false,
        modifiers: i.modifiers.map(m => ({ price: Number(m.price), quantity: m.quantity ?? 1 })),
      }))
      const totals = calculateOrderTotals(
        delCalcItems, order.location.settings as { tax?: { defaultRate?: number; inclusiveTaxRate?: number } },
        newDiscountTotal, Number(order.tipTotal || 0), undefined, 'card', order.isTaxExempt,
        Number(order.inclusiveTaxRate) || undefined
      )

      const delDonation = Number(order.donationAmount || 0)
      const delConvFee = Number(order.convenienceFee || 0)
      const delFinalTotal = delDonation > 0 || delConvFee > 0
        ? roundToCents(totals.total + delDonation + delConvFee)
        : totals.total

      await OrderRepository.updateOrder(orderId, order.locationId, {
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        taxFromInclusive: totals.taxFromInclusive,
        taxFromExclusive: totals.taxFromExclusive,
        total: delFinalTotal,
      }, tx)
      const updatedOrder = await OrderRepository.getOrderByIdWithSelect(orderId, order.locationId, { subtotal: true, discountTotal: true, taxTotal: true, tipTotal: true, total: true }, tx)
      if (!updatedOrder) throw new Error(`Order ${orderId} not found after update`)

      // Emit order event for item discount removed (fire-and-forget)
      void emitOrderEvent(order.locationId, orderId, 'DISCOUNT_REMOVED', {
        discountId,
        lineItemId: itemId,
      })

      // Fire-and-forget socket dispatch
      void dispatchOpenOrdersChanged(order.locationId, {
        trigger: 'created',
        orderId,
      }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.items.itemId.discount'))
      void dispatchOrderTotalsUpdate(order.locationId, orderId, {
        subtotal: Number(updatedOrder.subtotal),
        taxTotal: Number(updatedOrder.taxTotal),
        tipTotal: Number(updatedOrder.tipTotal),
        discountTotal: Number(updatedOrder.discountTotal),
        total: Number(updatedOrder.total),
      }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.items.itemId.discount'))

      return NextResponse.json({
        data: {
          success: true,
          orderTotals: {
            subtotal: Number(updatedOrder.subtotal),
            discountTotal: Number(updatedOrder.discountTotal),
            taxTotal: Number(updatedOrder.taxTotal),
            total: Number(updatedOrder.total),
          },
        },
      })
    })

    return result
  } catch (error) {
    console.error('Failed to remove item discount:', error)
    return NextResponse.json(
      { error: 'Failed to remove item discount' },
      { status: 500 }
    )
  }
})
