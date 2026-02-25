import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { dispatchOpenOrdersChanged } from '@/lib/socket-dispatch'

interface ApplyItemDiscountRequest {
  type: 'percent' | 'fixed'
  value: number
  reason?: string
  employeeId: string
  discountRuleId?: string
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

    // Fetch order
    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: { location: true },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    if (order.status === 'paid' || order.status === 'closed') {
      return NextResponse.json(
        { error: 'Cannot apply discount to a paid or closed order' },
        { status: 409 }
      )
    }

    // Fetch item
    const item = await db.orderItem.findFirst({
      where: { id: itemId, orderId, deletedAt: null },
    })

    if (!item) {
      return NextResponse.json(
        { error: 'Order item not found' },
        { status: 404 }
      )
    }

    // Toggle prevention: if this discountRuleId is already applied to this item, remove it
    if (body.discountRuleId) {
      const alreadyApplied = await db.orderItemDiscount.findFirst({
        where: { orderItemId: itemId, discountRuleId: body.discountRuleId, deletedAt: null },
      })
      if (alreadyApplied) {
        const removedAmount = Number(alreadyApplied.amount)
        await db.orderItemDiscount.update({
          where: { id: alreadyApplied.id },
          data: { deletedAt: new Date() },
        })
        const newDiscountTotal = Math.max(0, Number(order.discountTotal) - removedAmount)
        const newTotal = Number(order.subtotal) + Number(order.taxTotal) - newDiscountTotal + Number(order.tipTotal)
        const updatedOrder = await db.order.update({
          where: { id: orderId },
          data: { discountTotal: newDiscountTotal, total: newTotal },
          select: { subtotal: true, discountTotal: true, taxTotal: true, tipTotal: true, total: true },
        })
        void dispatchOpenOrdersChanged(order.locationId, { trigger: 'created', orderId }, { async: true }).catch(() => {})
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

    // Create the OrderItemDiscount record
    const itemDiscount = await db.orderItemDiscount.create({
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

    // Update Order.discountTotal (increment) and recalculate total
    const newDiscountTotal = Number(order.discountTotal) + discountAmount
    const newTotal = Number(order.subtotal) + Number(order.taxTotal) - newDiscountTotal + Number(order.tipTotal)

    const updatedOrder = await db.order.update({
      where: { id: orderId },
      data: {
        discountTotal: newDiscountTotal,
        total: newTotal,
      },
      select: { subtotal: true, discountTotal: true, taxTotal: true, tipTotal: true, total: true },
    })

    // Fire-and-forget socket dispatch
    void dispatchOpenOrdersChanged(order.locationId, {
      trigger: 'created',
      orderId,
    }, { async: true }).catch(() => {})

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

    if (!discountId) {
      return NextResponse.json(
        { error: 'discountId query parameter is required' },
        { status: 400 }
      )
    }

    // Fetch the discount and verify it belongs to this order/item
    const existingDiscount = await db.orderItemDiscount.findFirst({
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

    // Fetch order for total recalculation
    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    const discountAmount = Number(existingDiscount.amount)

    // Soft delete the discount
    await db.orderItemDiscount.update({
      where: { id: discountId },
      data: {
        updatedAt: new Date(),
        deletedAt: new Date(),
      },
    })

    // Update Order.discountTotal (decrement) and recalculate total
    const newDiscountTotal = Math.max(0, Number(order.discountTotal) - discountAmount)
    const newTotal = Number(order.subtotal) + Number(order.taxTotal) - newDiscountTotal + Number(order.tipTotal)

    const updatedOrder = await db.order.update({
      where: { id: orderId },
      data: {
        discountTotal: newDiscountTotal,
        total: newTotal,
      },
      select: { subtotal: true, discountTotal: true, taxTotal: true, tipTotal: true, total: true },
    })

    // Fire-and-forget socket dispatch
    void dispatchOpenOrdersChanged(order.locationId, {
      trigger: 'created',
      orderId,
    }, { async: true }).catch(() => {})

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
  } catch (error) {
    console.error('Failed to remove item discount:', error)
    return NextResponse.json(
      { error: 'Failed to remove item discount' },
      { status: 500 }
    )
  }
})
