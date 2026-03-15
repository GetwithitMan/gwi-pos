import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { calculateOrderTotals } from '@/lib/order-calculations'
import type { OrderItemForCalculation } from '@/lib/order-calculations'
import { withVenue } from '@/lib/with-venue'
import { dispatchOrderTotalsUpdate, dispatchOpenOrdersChanged, dispatchOrderSummaryUpdated } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'

interface ApplyCouponRequest {
  code: string
  employeeId: string
}

// POST - Apply a coupon code to an order
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json() as ApplyCouponRequest
    const { code, employeeId } = body

    if (!code || !employeeId) {
      return NextResponse.json(
        { error: 'Coupon code and employee ID are required' },
        { status: 400 }
      )
    }

    // Get the order with current totals and discounts
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        location: true,
        discounts: { where: { deletedAt: null } },
        items: {
          where: { status: { not: 'voided' }, deletedAt: null },
          include: { modifiers: true },
        },
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
        { error: 'Cannot apply coupon to a closed order' },
        { status: 400 }
      )
    }

    // Look up coupon by code + locationId
    const coupon = await db.coupon.findFirst({
      where: {
        locationId: order.locationId,
        code: code.toUpperCase(),
      },
    })

    if (!coupon) {
      return NextResponse.json(
        { error: 'Invalid coupon code' },
        { status: 404 }
      )
    }

    // --- Validation ---

    // 1. Active check
    if (!coupon.isActive) {
      return NextResponse.json(
        { error: 'This coupon is no longer active' },
        { status: 400 }
      )
    }

    // 2. Date range
    const now = new Date()
    if (coupon.validFrom && now < coupon.validFrom) {
      return NextResponse.json(
        { error: 'This coupon is not yet valid' },
        { status: 400 }
      )
    }
    if (coupon.validUntil && now > coupon.validUntil) {
      return NextResponse.json(
        { error: 'This coupon has expired' },
        { status: 400 }
      )
    }

    // 3. Usage limit
    if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
      return NextResponse.json(
        { error: 'This coupon has reached its usage limit' },
        { status: 400 }
      )
    }

    // 4. Per-customer limit (if order has a customer)
    const customerId = (order as any).customerId as string | null
    if (customerId && coupon.perCustomerLimit) {
      const customerRedemptions = await db.couponRedemption.count({
        where: {
          couponId: coupon.id,
          customerId,
        },
      })
      if (customerRedemptions >= coupon.perCustomerLimit) {
        return NextResponse.json(
          { error: 'You have exceeded the usage limit for this coupon' },
          { status: 400 }
        )
      }
    }

    // 5. Single-use check
    if (customerId && coupon.singleUse) {
      const previousUse = await db.couponRedemption.findFirst({
        where: {
          couponId: coupon.id,
          customerId,
        },
      })
      if (previousUse) {
        return NextResponse.json(
          { error: 'This coupon can only be used once' },
          { status: 400 }
        )
      }
    }

    // 6. Check if this coupon was already applied to this order
    const alreadyApplied = order.discounts.find(
      (d: any) => d.couponId === coupon.id
    )
    if (alreadyApplied) {
      return NextResponse.json(
        { error: 'This coupon has already been applied to this order' },
        { status: 400 }
      )
    }

    // 7. Minimum order amount
    const subtotal = Number(order.subtotal)
    if (!isFinite(subtotal) || subtotal < 0) {
      return NextResponse.json({ error: 'Invalid order subtotal' }, { status: 400 })
    }
    if (coupon.minimumOrder && subtotal < Number(coupon.minimumOrder)) {
      return NextResponse.json(
        { error: `Minimum order of $${Number(coupon.minimumOrder).toFixed(2)} required for this coupon` },
        { status: 400 }
      )
    }

    // 8. Stacking check: if coupon is NOT stackable, order must have no existing discounts
    if (!coupon.isStackable && order.discounts.length > 0) {
      return NextResponse.json(
        { error: 'Cannot apply coupon — order already has a discount. This coupon cannot be combined with other discounts.' },
        { status: 400 }
      )
    }

    // If coupon IS stackable but existing discounts came from a non-stackable source,
    // also check the reverse: existing non-stackable discounts block new coupons
    if (order.discounts.length > 0) {
      // Check if any existing discount is from a non-stackable discount rule
      for (const d of order.discounts) {
        if ((d as any).discountRuleId) {
          const existingRule = await db.discountRule.findUnique({
            where: { id: (d as any).discountRuleId },
            select: { isStackable: true },
          })
          if (existingRule && !existingRule.isStackable) {
            return NextResponse.json(
              { error: 'Cannot apply coupon — order has a non-stackable discount' },
              { status: 400 }
            )
          }
        }
      }
    }

    // --- Calculate discount amount ---
    const discountType = coupon.discountType // 'percent' | 'fixed' | 'free_item'
    const discountValue = Number(coupon.discountValue)
    let discountAmount: number
    let discountPercent: number | null = null
    let discountName: string

    if (discountType === 'percent') {
      discountPercent = discountValue
      discountAmount = Math.round(subtotal * (discountValue / 100) * 100) / 100
      discountName = `Coupon: ${coupon.code} (${discountValue}% off)`
    } else if (discountType === 'fixed') {
      discountAmount = discountValue
      discountName = `Coupon: ${coupon.code} ($${discountValue.toFixed(2)} off)`
    } else {
      // free_item — not supported in this endpoint (requires adding item to order)
      return NextResponse.json(
        { error: 'Free item coupons must be applied at the menu level' },
        { status: 400 }
      )
    }

    // Apply maximum discount cap
    if (coupon.maximumDiscount && discountAmount > Number(coupon.maximumDiscount)) {
      discountAmount = Number(coupon.maximumDiscount)
    }

    // Ensure discount doesn't exceed remaining subtotal
    const currentDiscountTotal = order.discounts.reduce(
      (sum: number, d: any) => sum + Number(d.amount),
      0
    )
    const maxAllowedDiscount = subtotal - currentDiscountTotal
    if (discountAmount > maxAllowedDiscount) {
      discountAmount = maxAllowedDiscount
    }

    if (discountAmount <= 0) {
      return NextResponse.json(
        { error: 'No discount amount to apply (order may already be fully discounted)' },
        { status: 400 }
      )
    }

    // --- Apply in a transaction: create OrderDiscount + CouponRedemption + increment usageCount ---
    const result = await db.$transaction(async (tx) => {
      // Create OrderDiscount record (goes through standard discount reporting)
      const discount = await tx.orderDiscount.create({
        data: {
          locationId: order.locationId,
          orderId,
          couponId: coupon.id,
          couponCode: coupon.code,
          name: discountName,
          amount: discountAmount,
          percent: discountPercent,
          appliedBy: employeeId,
          isAutomatic: false,
          reason: `Coupon: ${coupon.code}`,
        },
      })

      // Create CouponRedemption record
      await tx.couponRedemption.create({
        data: {
          locationId: order.locationId,
          couponId: coupon.id,
          orderId,
          customerId: customerId || null,
          discountAmount,
          redeemedBy: employeeId,
        },
      })

      // Atomically increment coupon usage count
      await tx.coupon.update({
        where: { id: coupon.id },
        data: { usageCount: { increment: 1 } },
      })

      // Recalculate order totals with split-aware tax
      const newDiscountTotal = currentDiscountTotal + discountAmount
      const couponCalcItems: OrderItemForCalculation[] = order.items.map(i => ({
        price: Number(i.price), quantity: i.quantity, status: i.status,
        itemTotal: Number(i.itemTotal), isTaxInclusive: i.isTaxInclusive ?? false,
        modifiers: i.modifiers.map(m => ({ price: Number(m.price), quantity: m.quantity ?? 1 })),
      }))
      const totals = calculateOrderTotals(
        couponCalcItems, order.location.settings as { tax?: { defaultRate?: number; inclusiveTaxRate?: number } },
        newDiscountTotal, 0, undefined, 'card', order.isTaxExempt
      )

      await tx.order.update({
        where: { id: orderId },
        data: {
          discountTotal: totals.discountTotal,
          taxTotal: totals.taxTotal,
          taxFromInclusive: totals.taxFromInclusive,
          taxFromExclusive: totals.taxFromExclusive,
          total: totals.total,
          version: { increment: 1 },
        },
      })

      return { discount, totals }
    })

    // Emit order event for discount applied (fire-and-forget)
    void emitOrderEvent(order.locationId, orderId, 'DISCOUNT_APPLIED', {
      discountId: result.discount.id,
      type: discountPercent != null ? 'percent' : 'fixed',
      value: discountPercent ?? discountAmount,
      amountCents: Math.round(discountAmount * 100),
      reason: `Coupon: ${coupon.code}`,
      couponId: coupon.id,
      couponCode: coupon.code,
    })

    // Fire-and-forget socket dispatches for cross-terminal sync
    void dispatchOrderTotalsUpdate(order.locationId, orderId, {
      subtotal: result.totals.subtotal,
      taxTotal: result.totals.taxTotal,
      tipTotal: Number(order.tipTotal),
      discountTotal: result.totals.discountTotal,
      total: result.totals.total,
      commissionTotal: Number((order as any).commissionTotal || 0),
    }, { async: true }).catch(() => {})
    void dispatchOpenOrdersChanged(order.locationId, {
      trigger: 'item_updated',
      orderId,
    }, { async: true }).catch(() => {})

    // Dispatch order:summary-updated for Android cross-terminal sync (fire-and-forget)
    void dispatchOrderSummaryUpdated(order.locationId, {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      tableId: order.tableId || null,
      tableName: null,
      tabName: order.tabName || null,
      guestCount: order.guestCount ?? 0,
      employeeId: order.employeeId || null,
      subtotalCents: Math.round(result.totals.subtotal * 100),
      taxTotalCents: Math.round(result.totals.taxTotal * 100),
      discountTotalCents: Math.round(result.totals.discountTotal * 100),
      tipTotalCents: Math.round(Number(order.tipTotal) * 100),
      totalCents: Math.round(result.totals.total * 100),
      itemCount: order.itemCount ?? 0,
      updatedAt: new Date().toISOString(),
      locationId: order.locationId,
    }, { async: true }).catch(() => {})

    return NextResponse.json({ data: {
      discount: {
        id: result.discount.id,
        name: result.discount.name,
        amount: Number(result.discount.amount),
        percent: result.discount.percent ? Number(result.discount.percent) : null,
        couponCode: coupon.code,
      },
      orderTotals: {
        subtotal: result.totals.subtotal,
        discountTotal: result.totals.discountTotal,
        taxTotal: result.totals.taxTotal,
        total: result.totals.total,
      },
    } })
  } catch (error) {
    console.error('Failed to apply coupon:', error)
    return NextResponse.json(
      { error: 'Failed to apply coupon' },
      { status: 500 }
    )
  }
})
