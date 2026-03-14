/**
 * Revenue Calculations — PURE functions
 *
 * Single source of truth for revenue status filtering, surcharge math,
 * and tax breakdown across all 51 report routes.
 *
 * NO DB access, NO side effects, NO framework imports.
 */

import type { TaxBreakdown } from './types'

/**
 * Order statuses that count toward revenue.
 *
 * Re-exported from @/lib/constants for convenience within report domain code.
 * The canonical constant lives in constants.ts; this re-export avoids
 * report files needing two imports.
 */
export { REVENUE_ORDER_STATUSES } from '@/lib/constants'

/**
 * Type guard: does this order status count toward revenue?
 */
export function isRevenueOrder(status: string): boolean {
  return status === 'completed' || status === 'closed' || status === 'paid'
}

/**
 * Calculate surcharge amount for a card-paid order.
 *
 * Formula: Math.round(subtotal * surchargePercent) / 100
 * This matches the inline pattern used in sales, daily, and legacy daily routes.
 *
 * @param subtotal  Order subtotal in dollars (e.g. 49.99)
 * @param surchargePercent  Fractional percent from pricing program (e.g. 0.035 = 3.5%)
 * @returns Surcharge amount in dollars, rounded to nearest cent
 */
export function calculateSurchargeAmount(subtotal: number, surchargePercent: number): number {
  return Math.round(subtotal * surchargePercent) / 100
}

/**
 * Aggregate tax breakdown across a set of orders.
 *
 * Handles nullable inclusive/exclusive fields and coerces Decimal strings.
 */
export function calculateTaxBreakdown(
  orders: Array<{
    taxTotal: number | string
    taxFromInclusive?: number | string | null
    taxFromExclusive?: number | string | null
  }>
): TaxBreakdown {
  let totalTax = 0
  let taxFromInclusive = 0
  let taxFromExclusive = 0

  for (const order of orders) {
    totalTax += Number(order.taxTotal) || 0
    taxFromInclusive += Number(order.taxFromInclusive) || 0
    taxFromExclusive += Number(order.taxFromExclusive) || 0
  }

  return {
    totalTax: roundMoney(totalTax),
    taxFromInclusive: roundMoney(taxFromInclusive),
    taxFromExclusive: roundMoney(taxFromExclusive),
  }
}

/**
 * Round a monetary amount to 2 decimal places.
 *
 * Replaces 241+ inline occurrences of `Math.round(x * 100) / 100`
 * across 33 report files.
 */
export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100
}
