/**
 * Authoritative order payable — single source of truth.
 *
 * WHY THIS MODULE EXISTS
 *
 * The server never published a computed payable on order reads (`remainingBalance`
 * existed only on the payment *response*, after the fact). So the Android register
 * derived money itself, from subtotal + its own device-side tax config. Every
 * client/server disagreement observed at Monument on 2026-08-14 traced back to that:
 *
 *   - tax rate drift (device bootstrapped 8% while the venue had moved to 10%)
 *   - split rejected: register offered $21.00, server demanded $23.20
 *   - split rejected: register rounded per-child (24+24), server per-family (24+23)
 *   - ambiguity over whether Order.total already includes tax
 *
 * The fix is architectural: the SERVER computes the payable once, and the client
 * renders it. This module is that computation. It is pure and has no DB access so
 * it can be called from the payment path and from read paths alike, guaranteeing
 * they can never drift apart.
 *
 * MONEY RULES ENCODED HERE
 *
 * 1. `Order.total` ALREADY INCLUDES TAX when tax has been persisted.
 *    See order-calculations.ts calculateOrderTotals():
 *      totalBeforeRounding = inclusiveSubtotal + exclusiveSubtotal + taxFromExclusive
 *                            - discount + tip + convenienceFee
 *    Adding taxTotal on top of that double-counts and overcharges by the full tax.
 *
 * 2. An ALLOCATION split child's total is likewise already tax-inclusive —
 *    even-split.ts builds it as (splitSubtotal + splitTax - splitDiscount). The
 *    register enforces the same contract in DefaultCheckoutEvaluationEngine.kt:
 *    "Allocation split children carry server-set proportional totals that already
 *     include tax, discounts, and surcharge. The engine must NOT recompute these
 *     or it will double-count tax."
 *
 * 3. Tax ALWAYS comes from the individual venue. The authoritative figure is
 *    Order.taxTotal, computed by the item-level engine from that venue's TaxRule
 *    rows (honouring appliesTo / categoryIds / itemIds). The rate fallback below
 *    reads the same venue's derived rate. Nothing here is hardcoded or global.
 *
 * 4. Cash rounding NEVER reduces tax. It is applied to the tax-inclusive total as
 *    the final step, and the difference is booked separately as
 *    Payment.roundingAdjustment — i.e. it comes out of product revenue.
 */

import { applyPriceRounding, roundToCents, toNumber } from '@/lib/pricing'

export interface PayableSettings {
  tax?: { defaultRate?: number } | null
  priceRounding?: {
    enabled: boolean
    increment: 'none' | '0.05' | '0.10' | '0.25' | '0.50' | '1.00'
    direction: 'nearest' | 'up' | 'down'
    applyToCash: boolean
    applyToCard: boolean
  } | null
}

export interface PayableInput {
  /** Order.total — tax-inclusive whenever taxTotal has been persisted. */
  total: unknown
  /** Order.taxTotal — authoritative, from the venue's TaxRule rows. */
  taxTotal: unknown
  /** True for even / custom_amount split children (amount-only, no items). */
  isAllocationChild: boolean
}

/**
 * Tax-inclusive amount owed on an order, BEFORE cash rounding.
 * Exposed separately so callers can show tax-inclusive vs rounded figures.
 */
export function computeTaxInclusiveTotal(input: PayableInput, settings: PayableSettings): number {
  const rawTotal = toNumber(input.total ?? 0)
  const storedTax = toNumber(input.taxTotal ?? 0)

  // Allocation children and any order with persisted tax already carry it in total.
  if (input.isAllocationChild || storedTax > 0) return rawTotal

  // Fallback: this venue's own derived rate, for orders whose tax was never
  // persisted (legacy rows). Exact for single-rate venues; approximate for a
  // venue that scopes different rates per category or item — those should be
  // relying on Order.taxTotal above.
  const taxRate = settings.tax?.defaultRate ?? 0
  if (taxRate > 0) {
    return roundToCents(rawTotal + roundToCents((rawTotal * taxRate) / 100))
  }
  return rawTotal
}

/**
 * The amount a guest actually pays, for a given tender type.
 *
 * Cash rounding is applied per the venue's priceRounding setting (Settings →
 * Payments). Card is normally left unrounded (applyToCard defaults false).
 */
export function computePayable(
  input: PayableInput,
  settings: PayableSettings,
  method: 'cash' | 'card' = 'cash',
): number {
  const taxInclusive = computeTaxInclusiveTotal(input, settings)
  if (settings.priceRounding?.enabled) {
    return applyPriceRounding(taxInclusive, settings.priceRounding, method)
  }
  return taxInclusive
}

/** True when an order is an amount-only (even / custom_amount) split child. */
export function isAllocationSplitChild(order: {
  parentOrderId?: string | null
  splitClass?: string | null
}): boolean {
  return !!order.parentOrderId && order.splitClass === 'allocation'
}
