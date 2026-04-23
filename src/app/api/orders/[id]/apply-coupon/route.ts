import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { calculateOrderTotals } from '@/lib/order-calculations'
import type { OrderItemForCalculation } from '@/lib/order-calculations'
import { withVenue } from '@/lib/with-venue'
import { dispatchOrderTotalsUpdate, dispatchOpenOrdersChanged, dispatchOrderSummaryUpdated } from '@/lib/socket-dispatch'
import { dispatchCFDOrderUpdated } from '@/lib/socket-dispatch/cfd-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { OrderRepository } from '@/lib/repositories'
import { roundToCents } from '@/lib/pricing'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'

const log = createChildLogger('orders.id.apply-coupon')

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
      return err('Coupon code and employee ID are required')
    }

    // Permission check: MGR_DISCOUNTS required to apply coupons
    const couponOrderCheck = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: { locationId: true },
    })
    if (!couponOrderCheck) {
      return notFound('Order not found')
    }
    const auth = await requirePermission(employeeId, couponOrderCheck.locationId, PERMISSIONS.MGR_DISCOUNTS)
    if (!auth.authorized) return err(auth.error, auth.status)

    // --- All validation + application in a single transaction with FOR UPDATE lock ---
    const result = await db.$transaction(async (tx) => {
      // Pessimistic lock: prevent concurrent coupon applications from racing
      await tx.$queryRaw`SELECT id FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`

      // Get the order with current totals and discounts (under lock)
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          location: true,
          discounts: { where: { deletedAt: null } },
          items: {
            where: { status: { not: 'voided' }, deletedAt: null },
            include: {
              modifiers: true,
              menuItem: { select: { categoryId: true } },
            },
          },
        },
      })

      if (!order) {
        throw Object.assign(new Error('Order not found'), { statusCode: 404 })
      }

      if (order.status !== 'open' && order.status !== 'in_progress') {
        throw Object.assign(new Error('Cannot apply coupon to a closed order'), { statusCode: 400 })
      }

      // Look up coupon by code + locationId
      const coupon = await tx.coupon.findFirst({
        where: {
          locationId: order.locationId,
          code: code.toUpperCase(),
          deletedAt: null,
        },
      })

      if (!coupon) {
        throw Object.assign(new Error('Invalid coupon code'), { statusCode: 404 })
      }

      // Lock the Coupon row to prevent cross-order double-use of single-use/limited coupons.
      // Two terminals applying the same coupon on different orders will serialize here.
      await tx.$queryRaw`SELECT id FROM "Coupon" WHERE "id" = ${coupon.id} FOR UPDATE`

      // Re-read mutable fields under lock (may have been changed by a concurrent request)
      const freshCoupon = await tx.coupon.findUnique({
        where: { id: coupon.id },
        select: { usageCount: true, isActive: true },
      })
      if (freshCoupon) {
        coupon.usageCount = freshCoupon.usageCount
        coupon.isActive = freshCoupon.isActive
      }

      // --- Validation ---

      // 1. Active check
      if (!coupon.isActive) {
        throw Object.assign(new Error('This coupon is no longer active'), { statusCode: 400 })
      }

      // 2. Date range
      const now = new Date()
      if (coupon.validFrom && now < coupon.validFrom) {
        throw Object.assign(new Error('This coupon is not yet valid'), { statusCode: 400 })
      }
      if (coupon.validUntil && now > coupon.validUntil) {
        throw Object.assign(new Error('This coupon has expired'), { statusCode: 400 })
      }

      // 3. Usage limit
      if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
        throw Object.assign(new Error('This coupon has reached its usage limit'), { statusCode: 400 })
      }

      // 4. Per-customer limit — require a linked customer (prevents anonymous bypass)
      const customerId = (order as any).customerId as string | null
      if (coupon.perCustomerLimit && coupon.perCustomerLimit > 0 && !customerId) {
        throw Object.assign(new Error('A customer must be linked to this order to use this coupon'), { statusCode: 400 })
      }
      if (customerId && coupon.perCustomerLimit) {
        const customerRedemptions = await tx.couponRedemption.count({
          where: {
            couponId: coupon.id,
            customerId,
          },
        })
        if (customerRedemptions >= coupon.perCustomerLimit) {
          throw Object.assign(new Error('You have exceeded the usage limit for this coupon'), { statusCode: 400 })
        }
      }

      // 5. Single-use check — require a linked customer (prevents anonymous bypass)
      if (coupon.singleUse && !customerId) {
        throw Object.assign(new Error('A customer must be linked to this order to use this coupon'), { statusCode: 400 })
      }
      if (customerId && coupon.singleUse) {
        const previousUse = await tx.couponRedemption.findFirst({
          where: {
            couponId: coupon.id,
            customerId,
          },
        })
        if (previousUse) {
          throw Object.assign(new Error('This coupon can only be used once'), { statusCode: 400 })
        }
      }

      // 6. Check if this coupon was already applied to this order
      const alreadyApplied = order.discounts.find(
        (d: any) => d.couponId === coupon.id
      )
      if (alreadyApplied) {
        throw Object.assign(new Error('This coupon has already been applied to this order'), { statusCode: 400 })
      }

      // 7. Minimum order amount
      const subtotal = Number(order.subtotal)
      if (!isFinite(subtotal) || subtotal < 0) {
        throw Object.assign(new Error('Invalid order subtotal'), { statusCode: 400 })
      }
      if (coupon.minimumOrder && subtotal < Number(coupon.minimumOrder)) {
        throw Object.assign(new Error(`Minimum order of $${Number(coupon.minimumOrder).toFixed(2)} required for this coupon`), { statusCode: 400 })
      }

      // 8. Stacking check: if coupon is NOT stackable, order must have no existing discounts
      if (!coupon.isStackable && order.discounts.length > 0) {
        throw Object.assign(new Error('Cannot apply coupon — order already has a discount. This coupon cannot be combined with other discounts.'), { statusCode: 400 })
      }

      // If coupon IS stackable but existing discounts came from a non-stackable source,
      // also check the reverse: existing non-stackable discounts block new coupons
      if (order.discounts.length > 0) {
        // Check if any existing discount is from a non-stackable discount rule
        for (const d of order.discounts) {
          if ((d as any).discountRuleId) {
            const existingRule = await tx.discountRule.findUnique({
              where: { id: (d as any).discountRuleId },
              select: { isStackable: true },
            })
            if (existingRule && !existingRule.isStackable) {
              throw Object.assign(new Error('Cannot apply coupon — order has a non-stackable discount'), { statusCode: 400 })
            }
          }
        }
      }

      // --- Determine eligible subtotal based on appliesTo scope ---
      let eligibleSubtotal = subtotal
      const appliesToScope = coupon.appliesTo || 'order'

      if (appliesToScope === 'category' && Array.isArray(coupon.categoryIds) && coupon.categoryIds.length > 0) {
        const eligibleCategoryIds = coupon.categoryIds as string[]
        const eligibleItems = order.items.filter(
          (i: any) => i.menuItem?.categoryId && eligibleCategoryIds.includes(i.menuItem.categoryId)
        )
        if (eligibleItems.length === 0) {
          throw Object.assign(new Error('No items in this order match the coupon\'s eligible categories'), { statusCode: 400 })
        }
        eligibleSubtotal = eligibleItems.reduce(
          (sum: number, i: any) => sum + Number(i.itemTotal),
          0
        )
      } else if (appliesToScope === 'item' && Array.isArray(coupon.itemIds) && coupon.itemIds.length > 0) {
        const eligibleItemIds = coupon.itemIds as string[]
        const eligibleItems = order.items.filter(
          (i: any) => eligibleItemIds.includes(i.menuItemId)
        )
        if (eligibleItems.length === 0) {
          throw Object.assign(new Error('No items in this order match the coupon\'s eligible items'), { statusCode: 400 })
        }
        eligibleSubtotal = eligibleItems.reduce(
          (sum: number, i: any) => sum + Number(i.itemTotal),
          0
        )
      }

      // --- Calculate discount amount ---
      const discountType = coupon.discountType // 'percent' | 'fixed' | 'free_item'
      const discountValue = Number(coupon.discountValue)
      let discountAmount: number
      let discountPercent: number | null = null
      let discountName: string

      if (discountType === 'percent') {
        discountPercent = discountValue
        discountAmount = Math.round(eligibleSubtotal * (discountValue / 100) * 100) / 100
        discountName = `Coupon: ${coupon.code} (${discountValue}% off)`
      } else if (discountType === 'fixed') {
        // For scoped coupons, cap fixed discount at eligible subtotal
        discountAmount = Math.min(discountValue, eligibleSubtotal)
        discountName = `Coupon: ${coupon.code} ($${discountValue.toFixed(2)} off)`
      } else {
        // free_item — not supported in this endpoint (requires adding item to order)
        throw Object.assign(new Error('Free item coupons must be applied at the menu level'), { statusCode: 400 })
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
        throw Object.assign(new Error('No discount amount to apply (order may already be fully discounted)'), { statusCode: 400 })
      }

      // --- Apply: create OrderDiscount + CouponRedemption + increment usageCount ---

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
        newDiscountTotal, Number(order.tipTotal || 0), undefined, 'card', order.isTaxExempt,
        Number(order.inclusiveTaxRate) || undefined, 0,
        (order as any).exclusiveTaxRate != null ? Number((order as any).exclusiveTaxRate) : undefined
      )

      const couponDonation = Number(order.donationAmount || 0)
      const couponConvFee = Number(order.convenienceFee || 0)
      const couponFinalTotal = couponDonation > 0 || couponConvFee > 0
        ? roundToCents(totals.total + couponDonation + couponConvFee)
        : totals.total

      await OrderRepository.updateOrder(orderId, order.locationId, {
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        taxFromInclusive: totals.taxFromInclusive,
        taxFromExclusive: totals.taxFromExclusive,
        total: couponFinalTotal,
        version: { increment: 1 },
      }, tx)

      return { order, coupon, discount, totals, couponFinalTotal, customerId, discountAmount, discountPercent }
    })

    const { order, coupon, discountPercent, discountAmount } = result

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
      total: result.couponFinalTotal,
      commissionTotal: Number((order as any).commissionTotal || 0),
    }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.apply-coupon'))
    void dispatchOpenOrdersChanged(order.locationId, {
      trigger: 'item_updated',
      orderId,
    }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.apply-coupon'))
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
      totalCents: Math.round(result.couponFinalTotal * 100),
      itemCount: order.itemCount ?? 0,
      updatedAt: new Date().toISOString(),
      locationId: order.locationId,
    }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.apply-coupon'))

    const cfdOrder = await OrderRepository.getOrderByIdWithInclude(orderId, order.locationId, {
      items: { include: { modifiers: true } },
      discounts: true,
    })
    if (cfdOrder) {
      dispatchCFDOrderUpdated(order.locationId, {
        orderId: cfdOrder.id,
        orderNumber: cfdOrder.orderNumber,
        items: cfdOrder.items
          .filter(i => i.status === 'active')
          .map(i => ({
            name: i.name,
            quantity: i.quantity,
            price: Number(i.itemTotal),
            modifiers: i.modifiers.map(m => m.name),
            status: i.status,
          })),
        subtotal: Number(cfdOrder.subtotal),
        tax: Number(cfdOrder.taxTotal),
        total: Number(cfdOrder.total),
        discountTotal: Number(cfdOrder.discountTotal),
        taxFromInclusive: Number(cfdOrder.taxFromInclusive ?? 0),
        taxFromExclusive: Number(cfdOrder.taxFromExclusive ?? 0),
      })
    }

    pushUpstream()

    return ok({
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
        total: result.couponFinalTotal,
      },
    })
  } catch (error: any) {
    // Handle validation errors thrown from inside the transaction
    if (error?.statusCode) {
      return err(error.message, error.statusCode)
    }
    console.error('Failed to apply coupon:', error)
    return err('Failed to apply coupon', 500)
  }
})
