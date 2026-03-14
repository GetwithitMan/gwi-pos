/**
 * Comp/Void Calculations — PURE
 *
 * Pure math functions for comp/void totals.
 * No DB, no side effects, no framework types.
 */

import type { Decimal } from '@prisma/client/runtime/library'
import { roundToCents } from '@/lib/pricing'

/** Accepts Prisma Decimal, number, or string for price fields */
type PriceValue = number | string | Decimal

// ─── Item Total ─────────────────────────────────────────────────────────────

/**
 * Calculate item total including modifier prices, multiplied by quantity.
 * All prices are in dollars (not cents).
 */
export function calculateItemTotal(
  itemPrice: PriceValue,
  modifiers: Array<{ price: PriceValue }>,
  quantity: number,
): number {
  const modifiersTotal = modifiers.reduce((sum, m) => sum + Number(m.price), 0)
  return (Number(itemPrice) + modifiersTotal) * quantity
}

// ─── Subtotal Split ─────────────────────────────────────────────────────────

export interface SubtotalSplit {
  inclusiveSubtotal: number
  exclusiveSubtotal: number
  subtotal: number
}

/**
 * Split active items into tax-inclusive vs tax-exclusive subtotals.
 * H-FIN-7: Tax-inclusive items already contain tax, exclusive items have tax added on top.
 */
export function calculateSubtotalSplit(
  items: Array<{
    price: PriceValue
    quantity: number
    isTaxInclusive?: boolean
    modifiers: Array<{ price: PriceValue }>
  }>,
): SubtotalSplit {
  let inclusiveSubtotal = 0
  let exclusiveSubtotal = 0

  items.forEach(item => {
    const mods = item.modifiers.reduce((sum, m) => sum + Number(m.price), 0)
    const itemTotal = (Number(item.price) + mods) * item.quantity
    if ((item as any).isTaxInclusive) {
      inclusiveSubtotal += itemTotal
    } else {
      exclusiveSubtotal += itemTotal
    }
  })

  inclusiveSubtotal = roundToCents(inclusiveSubtotal)
  exclusiveSubtotal = roundToCents(exclusiveSubtotal)
  const subtotal = roundToCents(inclusiveSubtotal + exclusiveSubtotal)

  return { inclusiveSubtotal, exclusiveSubtotal, subtotal }
}

// ─── Order Totals from Splits ───────────────────────────────────────────────

/**
 * Build final order totals from split subtotals, discount, and split tax.
 * Inclusive items already contain tax; exclusive items get taxFromExclusive added on top.
 */
export function buildOrderTotals(
  inclusiveSubtotal: number,
  exclusiveSubtotal: number,
  subtotal: number,
  discountTotal: number,
  splitTax: { totalTax: number; taxFromExclusive: number },
): { subtotal: number; discountTotal: number; taxTotal: number; total: number } {
  const effectiveDiscount = Math.min(discountTotal, subtotal)
  return {
    subtotal,
    discountTotal: effectiveDiscount,
    taxTotal: splitTax.totalTax,
    total: roundToCents(inclusiveSubtotal + exclusiveSubtotal + splitTax.taxFromExclusive - effectiveDiscount),
  }
}

// ─── Commission Recalculation ───────────────────────────────────────────────

export interface CommissionItem {
  quantity: number
  itemTotal: PriceValue | null
  menuItem: {
    commissionType: string | null
    commissionValue: PriceValue | null
  } | null
}

/**
 * Recalculate commission total from active items.
 * Voided/comped items must be excluded before calling this.
 */
export function calculateCommissionTotal(items: CommissionItem[]): number {
  let total = 0
  for (const ci of items) {
    if (!ci.menuItem?.commissionType || !ci.menuItem?.commissionValue) continue
    const val = Number(ci.menuItem.commissionValue)
    const qty = ci.quantity || 1
    const ciTotal = Number(ci.itemTotal ?? 0)
    total += ci.menuItem.commissionType === 'percent'
      ? roundToCents(ciTotal * (val / 100))
      : roundToCents(val * qty)
  }
  return total
}

// ─── Approval Threshold ─────────────────────────────────────────────────────

/**
 * Check if an item total exceeds an approval threshold.
 * Compares in integer cents to avoid float precision issues.
 * A threshold of 0 means ALL items require approval.
 */
export function exceedsThreshold(itemTotal: number, threshold: number): boolean {
  const itemCents = Math.round(itemTotal * 100)
  const thresholdCents = Math.round(threshold * 100)
  return thresholdCents === 0 || itemCents > thresholdCents
}

// ─── Employee Meal Detection ────────────────────────────────────────────────

/**
 * Determine if a comp reason indicates an employee meal.
 */
export function isEmployeeMealReason(reason: string): boolean {
  const normalized = reason.toLowerCase().replace(/[\s_-]+/g, '_')
  return normalized === 'employee_meal'
    || normalized === 'emp_meal'
    || reason.toLowerCase() === 'employee meal'
    || reason.toLowerCase() === 'emp meal'
}
