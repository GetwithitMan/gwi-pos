/**
 * Order Totals Recalculation — ORCHESTRATION
 *
 * Functions that fetch order items from DB and recalculate totals.
 * Takes TxClient or db — runs inside caller's transaction.
 */

import {
  calculateOrderTotals,
  calculateOrderSubtotal,
  recalculatePercentDiscounts,
  type LocationTaxSettings,
} from '@/lib/order-calculations'
import { parseSettings } from '@/lib/settings'
import { roundToCents } from '@/lib/pricing'
import type { TxClient, OrderTotalsUpdate } from './types'

// ─── Prisma Decimal → Number Mapping ────────────────────────────────────────

/**
 * Map Prisma Decimal types to numbers for calculation functions.
 * This pattern is repeated in multiple routes — centralized here.
 */
export function mapItemsForCalculation(items: Array<any>): Array<any> {
  return items.map(i => ({
    ...i,
    price: Number(i.price),
    itemTotal: Number(i.itemTotal),
    commissionAmount: i.commissionAmount ? Number(i.commissionAmount) : undefined,
    weight: i.weight ? Number(i.weight) : undefined,
    unitPrice: i.unitPrice ? Number(i.unitPrice) : undefined,
    soldByWeight: i.soldByWeight ?? false,
    isTaxInclusive: i.isTaxInclusive ?? false,
    modifiers: i.modifiers.map((m: any) => ({ ...m, price: Number(m.price) })),
    ingredientModifications: i.ingredientModifications.map((ing: any) => ({
      ...ing,
      priceAdjustment: Number(ing.priceAdjustment),
    })),
  }))
}

// ─── Full Order Totals Recalculation ────────────────────────────────────────

/**
 * Recalculate order totals from all active items in the database.
 * Handles percent-based discount recalculation and produces
 * the full OrderTotalsUpdate for writing back to the Order row.
 *
 * @param tx - Transaction client (or db)
 * @param orderId - The order to recalculate
 * @param locationSettings - Location settings object (raw, from Prisma)
 * @param tipTotal - Current tip total on the order
 * @param isTaxExempt - Whether the order is tax-exempt
 * @returns OrderTotalsUpdate ready to spread into db.order.update data
 */
export async function recalculateOrderTotals(
  tx: TxClient,
  orderId: string,
  locationSettings: unknown,
  tipTotal: number,
  isTaxExempt?: boolean
): Promise<OrderTotalsUpdate> {
  // Fetch the order's stored inclusive tax rate and donation amount (survives setting changes)
  const orderRow = await tx.order.findUnique({
    where: { id: orderId },
    select: { inclusiveTaxRate: true, donationAmount: true },
  })
  const orderInclRate = orderRow?.inclusiveTaxRate ? Number(orderRow.inclusiveTaxRate) : undefined
  const donationAmount = Number(orderRow?.donationAmount ?? 0)

  // Fetch all active items with modifiers and ingredient modifications
  const allItems = await tx.orderItem.findMany({
    where: { orderId, deletedAt: null, status: 'active' },
    include: {
      modifiers: { where: { deletedAt: null } },
      ingredientModifications: true,
    },
  })

  const itemsForCalc = mapItemsForCalculation(allItems)

  // Recalculate percent-based discounts against new subtotal
  const newSubtotalForDiscounts = calculateOrderSubtotal(itemsForCalc)
  const updatedDiscountTotal = await recalculatePercentDiscounts(tx, orderId, newSubtotalForDiscounts)

  // Parse location settings for price rounding
  const parsedSettings = locationSettings ? parseSettings(locationSettings) : null

  const totals = calculateOrderTotals(
    itemsForCalc,
    locationSettings as LocationTaxSettings | null,
    updatedDiscountTotal,
    tipTotal,
    parsedSettings?.priceRounding ?? undefined,
    'card',
    isTaxExempt,
    orderInclRate
  )

  // Add donation back to total — calculateOrderTotals doesn't know about donations
  const finalTotal = donationAmount > 0 ? roundToCents(totals.total + donationAmount) : totals.total

  return {
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    taxFromInclusive: totals.taxFromInclusive,
    taxFromExclusive: totals.taxFromExclusive,
    total: finalTotal,
    commissionTotal: totals.commissionTotal,
    itemCount: allItems.reduce((sum, i) => sum + i.quantity, 0),
  }
}

/**
 * Recalculate order totals for the POST (add items) path.
 * Similar to recalculateOrderTotals but uses all non-deleted items
 * (including non-active statuses) for the item query, matching the
 * original route's behavior, and accepts priceRounding settings explicitly.
 */
export async function recalculateOrderTotalsForAdd(
  tx: TxClient,
  orderId: string,
  locationSettings: unknown,
  tipTotal: number,
  isTaxExempt?: boolean
): Promise<OrderTotalsUpdate> {
  // Fetch the order's stored inclusive tax rate and donation amount (survives setting changes)
  const orderRow = await tx.order.findUnique({
    where: { id: orderId },
    select: { inclusiveTaxRate: true, donationAmount: true },
  })
  const orderInclRate = orderRow?.inclusiveTaxRate ? Number(orderRow.inclusiveTaxRate) : undefined
  const donationAmount = Number(orderRow?.donationAmount ?? 0)

  // For add-item, we query all non-deleted items (the original route used deletedAt: null without status filter)
  const allItems = await tx.orderItem.findMany({
    where: { orderId, deletedAt: null },
    include: {
      modifiers: { where: { deletedAt: null } },
      ingredientModifications: true,
    },
  })

  const itemsForCalc = mapItemsForCalculation(allItems)

  const newSubtotalForDiscounts = calculateOrderSubtotal(itemsForCalc)
  const updatedDiscountTotal = await recalculatePercentDiscounts(tx, orderId, newSubtotalForDiscounts)

  const parsedSettings = locationSettings ? parseSettings(locationSettings) : null

  const totals = calculateOrderTotals(
    itemsForCalc,
    locationSettings as LocationTaxSettings | null,
    updatedDiscountTotal,
    tipTotal,
    parsedSettings?.priceRounding ?? undefined,
    'card',
    isTaxExempt,
    orderInclRate
  )

  // Add donation back to total — calculateOrderTotals doesn't know about donations
  const finalTotal = donationAmount > 0 ? roundToCents(totals.total + donationAmount) : totals.total

  return {
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    taxFromInclusive: totals.taxFromInclusive,
    taxFromExclusive: totals.taxFromExclusive,
    total: finalTotal,
    commissionTotal: totals.commissionTotal,
    itemCount: allItems.reduce((sum, i) => sum + i.quantity, 0),
  }
}

// ─── Parent Order Totals (split children) ───────────────────────────────────

/**
 * Recalculate parent order totals from all non-voided child orders.
 * Used when items are added to a split child order.
 */
export async function recalculateParentOrderTotals(
  tx: TxClient,
  parentOrderId: string
): Promise<void> {
  const siblings = await tx.order.findMany({
    where: {
      parentOrderId,
      status: { not: 'voided' },
    },
    select: {
      subtotal: true,
      taxTotal: true,
      taxFromInclusive: true,
      taxFromExclusive: true,
      total: true,
      discountTotal: true,
      tipTotal: true,
      commissionTotal: true,
      itemCount: true,
    },
  })

  const parentSubtotal = siblings.reduce((sum, s) => sum + Number(s.subtotal), 0)
  const parentTax = siblings.reduce((sum, s) => sum + Number(s.taxTotal), 0)
  const parentTaxFromInclusive = siblings.reduce((sum, s) => sum + Number(s.taxFromInclusive || 0), 0)
  const parentTaxFromExclusive = siblings.reduce((sum, s) => sum + Number(s.taxFromExclusive || 0), 0)
  const parentTotal = siblings.reduce((sum, s) => sum + Number(s.total), 0)
  const parentDiscount = siblings.reduce((sum, s) => sum + Number(s.discountTotal), 0)
  const parentTip = siblings.reduce((sum, s) => sum + Number(s.tipTotal), 0)
  const parentCommission = siblings.reduce((sum, s) => sum + Number(s.commissionTotal || 0), 0)
  const parentItemCount = siblings.reduce((sum, s) => sum + (s.itemCount || 0), 0)

  await tx.order.update({
    where: { id: parentOrderId },
    data: {
      subtotal: parentSubtotal,
      taxTotal: parentTax,
      taxFromInclusive: parentTaxFromInclusive,
      taxFromExclusive: parentTaxFromExclusive,
      total: parentTotal,
      discountTotal: parentDiscount,
      tipTotal: parentTip,
      commissionTotal: parentCommission,
      itemCount: parentItemCount,
      version: { increment: 1 },
    },
  })
}
