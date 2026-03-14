/**
 * Order Finalization
 *
 * PURE functions that determine order status and build the update data object
 * after payment processing.
 */

import type { PaymentMethod } from '@prisma/client'
import { roundToCents } from '@/lib/pricing'
import type { OrderUpdateData } from './types'

/**
 * Determine if the order is fully paid, partially paid, or unchanged.
 * Returns the new status, or null if no change needed.
 */
export function determineOrderStatus(
  newPaidTotal: number,
  effectiveTotal: number,
  paidTolerance: number,
  currentStatus: string,
  currentPaidAt: Date | null,
): { status: 'paid' | 'in_progress' | null; paidAt: Date | null; closedAt: Date | null } {
  if (newPaidTotal >= effectiveTotal - paidTolerance) {
    return {
      status: 'paid',
      paidAt: new Date(),
      closedAt: new Date(),
    }
  }

  if (newPaidTotal > 0) {
    // H8: Partial payment received — lock order from silent abandonment.
    const newStatus = (currentStatus === 'open' || currentStatus === 'draft')
      ? 'in_progress' as const
      : null
    return {
      status: newStatus,
      paidAt: currentPaidAt || new Date(),
      closedAt: null,
    }
  }

  return { status: null, paidAt: null, closedAt: null }
}

/**
 * Build the order update data object with tip total, primary payment method, and status.
 */
export function buildOrderUpdate(
  existingTipTotal: number,
  totalTips: number,
  businessDayStart: Date,
  payments: Array<{ method: string; amount: number }>,
  currentPrimaryPaymentMethod: string | null,
  statusResult: { status: 'paid' | 'in_progress' | null; paidAt: Date | null; closedAt: Date | null },
): OrderUpdateData {
  const updateData: OrderUpdateData = {
    tipTotal: existingTipTotal + totalTips,
    businessDayDate: businessDayStart,
  }

  // Set primary payment method based on the payment with the largest amount.
  if (!currentPrimaryPaymentMethod) {
    const largestPayment = payments.reduce((max, p) =>
      (p.amount || 0) > (max.amount || 0) ? p : max
    , payments[0])
    const primaryMethod = largestPayment.method
    updateData.primaryPaymentMethod = (primaryMethod === 'cash' ? 'cash' : 'card') as PaymentMethod
  }

  if (statusResult.status) {
    updateData.status = statusResult.status
  }
  if (statusResult.paidAt) {
    updateData.paidAt = statusResult.paidAt
  }
  if (statusResult.closedAt) {
    updateData.closedAt = statusResult.closedAt
  }

  return updateData
}

/**
 * Calculate the paid tolerance for cash rounding scenarios.
 * When price rounding is active for cash, the paid amount may be less than orderTotal
 * by up to the rounding increment.
 */
export function calculatePaidTolerance(
  hasCashPayment: boolean,
  priceRounding?: { enabled: boolean; applyToCash: boolean; increment: string },
): number {
  if (hasCashPayment && priceRounding?.enabled && priceRounding.applyToCash) {
    return roundToCents(parseFloat(priceRounding.increment) / 2)
  }
  return 0.01
}
