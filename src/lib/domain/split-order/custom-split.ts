/**
 * Custom Amount Split — Split Order Domain
 *
 * Returns split info for paying a specific dollar amount toward an order.
 * No DB writes — the actual payment happens in the /pay endpoint.
 */

import type { SplitSourceOrder, CustomSplitResult } from './types'

/**
 * Calculate custom amount split info. Pure function — no DB writes.
 * The route validates amount > 0 and amount <= remaining before calling.
 */
export function calculateCustomSplit(
  order: SplitSourceOrder,
  amount: number,
  paidAmount: number,
): CustomSplitResult {
  const remaining = Number(order.total) - paidAmount

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    displayNumber: order.displayNumber || String(order.orderNumber),
    originalTotal: Number(order.total),
    paidAmount,
    remainingBalance: remaining,
    splitAmount: Math.min(amount, remaining),
    newRemaining: Math.max(0, remaining - amount),
  }
}
