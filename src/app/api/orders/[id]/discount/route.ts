import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { calculateSimpleOrderTotals as calculateOrderTotals } from '@/lib/order-calculations'
import { withVenue } from '@/lib/with-venue'
import { dispatchOrderTotalsUpdate, dispatchOpenOrdersChanged } from '@/lib/socket-dispatch'

interface ApplyDiscountRequest {
  // Either use a preset discount rule or custom values
  discountRuleId?: string
  // For custom/manual discounts
  type?: 'percent' | 'fixed'
  value?: number
  name?: string
  reason?: string
  employeeId?: string
}

// POST - Apply a discount to an order
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json() as ApplyDiscountRequest

    // Get the order with current totals
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        location: true,
        discounts: true,
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    if (order.status !== 'open' && order.status !== 'in_progress') {
      return NextResponse.json(
        { error: 'Cannot add discount to a closed order' },
        { status: 400 }
      )
    }

    let discountName: string
    let discountAmount: number
    let discountPercent: number | null = null
    let discountRuleId: string | null = null
    let requiresApproval = false

    if (body.discountRuleId) {
      // Using a preset discount rule
      const rule = await db.discountRule.findUnique({
        where: { id: body.discountRuleId },
      })

      if (!rule) {
        return NextResponse.json(
          { error: 'Discount rule not found' },
          { status: 404 }
        )
      }

      if (!rule.isActive) {
        return NextResponse.json(
          { error: 'This discount is not active' },
          { status: 400 }
        )
      }

      // Check max per order
      if (rule.maxPerOrder) {
        const existingCount = order.discounts.filter(
          d => d.discountRuleId === rule.id
        ).length
        if (existingCount >= rule.maxPerOrder) {
          return NextResponse.json(
            { error: `This discount can only be applied ${rule.maxPerOrder} time(s) per order` },
            { status: 400 }
          )
        }
      }

      // Check stackability
      if (!rule.isStackable && order.discounts.length > 0) {
        return NextResponse.json(
          { error: 'This discount cannot be combined with other discounts' },
          { status: 400 }
        )
      }

      const config = rule.discountConfig as { type: 'percent' | 'fixed'; value: number; maxAmount?: number }
      discountName = rule.displayText
      discountRuleId = rule.id
      requiresApproval = rule.requiresApproval

      if (config.type === 'percent') {
        discountPercent = config.value
        discountAmount = Math.round(Number(order.subtotal) * (config.value / 100) * 100) / 100
        // Apply max cap if specified
        if (config.maxAmount && discountAmount > config.maxAmount) {
          discountAmount = config.maxAmount
        }
      } else {
        discountAmount = config.value
      }
    } else {
      // Manual/custom discount
      if (!body.type || !body.value || body.value <= 0) {
        return NextResponse.json(
          { error: 'Discount type and value are required' },
          { status: 400 }
        )
      }

      discountName = body.name || (body.type === 'percent' ? `${body.value}% Off` : `$${body.value} Off`)

      if (body.type === 'percent') {
        if (body.value > 100) {
          return NextResponse.json(
            { error: 'Percentage cannot exceed 100%' },
            { status: 400 }
          )
        }
        discountPercent = body.value
        discountAmount = Math.round(Number(order.subtotal) * (body.value / 100) * 100) / 100
      } else {
        discountAmount = body.value
      }

      // Manual discounts over a threshold might require approval
      // This could be made configurable in location settings
      if (discountAmount > 50 || (discountPercent && discountPercent > 20)) {
        requiresApproval = true
      }
    }

    // Ensure discount doesn't exceed subtotal
    const currentDiscountTotal = order.discounts.reduce(
      (sum, d) => sum + Number(d.amount),
      0
    )
    const maxAllowedDiscount = Number(order.subtotal) - currentDiscountTotal

    if (discountAmount > maxAllowedDiscount) {
      discountAmount = maxAllowedDiscount
    }

    if (discountAmount <= 0) {
      return NextResponse.json(
        { error: 'No discount amount to apply' },
        { status: 400 }
      )
    }

    // Create the discount record
    const discount = await db.orderDiscount.create({
      data: {
        locationId: order.locationId,
        orderId,
        discountRuleId,
        name: discountName,
        amount: discountAmount,
        percent: discountPercent,
        appliedBy: body.employeeId || null,
        isAutomatic: false,
        reason: body.reason || null,
      },
    })

    // Update order totals
    const newDiscountTotal = currentDiscountTotal + discountAmount
    const totals = calculateOrderTotals(Number(order.subtotal), newDiscountTotal, order.location.settings as { tax?: { defaultRate?: number } })

    await db.order.update({
      where: { id: orderId },
      data: {
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
      },
    })

    // Fire-and-forget socket dispatches for cross-terminal sync
    void dispatchOrderTotalsUpdate(order.locationId, orderId, {
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      tipTotal: Number(order.tipTotal),
      discountTotal: totals.discountTotal,
      total: totals.total,
      commissionTotal: Number(order.commissionTotal || 0),
    }, { async: true }).catch(() => {})
    void dispatchOpenOrdersChanged(order.locationId, {
      trigger: 'created',
      orderId,
    }, { async: true }).catch(() => {})

    return NextResponse.json({ data: {
      discount: {
        id: discount.id,
        name: discount.name,
        amount: Number(discount.amount),
        percent: discount.percent ? Number(discount.percent) : null,
      },
      orderTotals: {
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
      },
      requiresApproval,
    } })
  } catch (error) {
    console.error('Failed to apply discount:', error)
    return NextResponse.json(
      { error: 'Failed to apply discount' },
      { status: 500 }
    )
  }
})

// GET - Get discounts applied to an order
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params

    const discounts = await db.orderDiscount.findMany({
      where: { orderId },
      include: {
        discountRule: {
          select: {
            name: true,
            displayText: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({ data: {
      discounts: discounts.map(d => ({
        id: d.id,
        name: d.name,
        amount: Number(d.amount),
        percent: d.percent ? Number(d.percent) : null,
        ruleName: d.discountRule?.name || null,
        appliedBy: d.appliedBy,
        isAutomatic: d.isAutomatic,
        reason: d.reason,
        createdAt: d.createdAt.toISOString(),
      })),
    } })
  } catch (error) {
    console.error('Failed to fetch order discounts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch discounts' },
      { status: 500 }
    )
  }
})

// DELETE - Remove a discount from an order
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const searchParams = request.nextUrl.searchParams
    const discountId = searchParams.get('discountId')

    if (!discountId) {
      return NextResponse.json(
        { error: 'Discount ID is required' },
        { status: 400 }
      )
    }

    // Get the order and discount
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        location: true,
        discounts: true,
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    const discountToRemove = order.discounts.find(d => d.id === discountId)
    if (!discountToRemove) {
      return NextResponse.json(
        { error: 'Discount not found on this order' },
        { status: 404 }
      )
    }

    // Soft delete the discount
    await db.orderDiscount.update({
      where: { id: discountId },
      data: { deletedAt: new Date() },
    })

    // Recalculate order totals
    const newDiscountTotal = order.discounts
      .filter(d => d.id !== discountId)
      .reduce((sum, d) => sum + Number(d.amount), 0)

    const totals = calculateOrderTotals(Number(order.subtotal), newDiscountTotal, order.location.settings as { tax?: { defaultRate?: number } })

    await db.order.update({
      where: { id: orderId },
      data: {
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
      },
    })

    // Fire-and-forget socket dispatches for cross-terminal sync
    void dispatchOrderTotalsUpdate(order.locationId, orderId, {
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      tipTotal: Number(order.tipTotal),
      discountTotal: totals.discountTotal,
      total: totals.total,
      commissionTotal: Number(order.commissionTotal || 0),
    }, { async: true }).catch(() => {})
    void dispatchOpenOrdersChanged(order.locationId, {
      trigger: 'created',
      orderId,
    }, { async: true }).catch(() => {})

    return NextResponse.json({ data: {
      success: true,
      orderTotals: {
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
      },
    } })
  } catch (error) {
    console.error('Failed to remove discount:', error)
    return NextResponse.json(
      { error: 'Failed to remove discount' },
      { status: 500 }
    )
  }
})
