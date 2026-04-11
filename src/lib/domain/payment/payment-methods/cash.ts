/**
 * Cash Payment Processing
 *
 * Handles rounding, amount tendered, change calculation, and dual pricing fields.
 */

import {
  calculateRoundingAdjustment,
  roundAmount,
} from '@/lib/payment'
import { createChildLogger } from '@/lib/logger'
import { calculateCardPrice, calculateCashDiscount, applyPriceRounding, roundToCents } from '@/lib/pricing'
import type { PricingProgram } from '@/lib/settings'
import type { PaymentInput, PaymentRecord } from '../types'

const log = createChildLogger('payment')

/**
 * Process a cash payment — applies rounding, calculates change, and sets dual pricing fields.
 *
 * `settings` must be the parsed location settings (from `parseSettings()`).
 * `pricingProgram` is the resolved PricingProgram from `getPricingProgram(settings)`.
 */
export function processCashPayment(
  payment: PaymentInput,
  record: PaymentRecord,
  remaining: number,
  alreadyPaidInLoop: number,
  settings: {
    priceRounding?: { enabled: boolean; applyToCash: boolean; increment: string; direction: string; applyToCard: boolean }
    payments: { cashRounding?: string; roundingDirection?: string }
  },
  pricingProgram: PricingProgram | undefined,
  orderId: string,
  orderTotal: number,
): PaymentRecord {
  // Apply rounding if enabled (priceRounding takes precedence over legacy cashRounding)
  let finalAmount = payment.amount
  let roundingAdjustment = 0

  // The client already sends the rounded amount (e.g. $3.25 from $3.29).
  // To compute the adjustment, compare against the raw remaining balance.
  const rawRemaining = roundToCents(remaining - alreadyPaidInLoop)
  if (settings.priceRounding?.enabled && settings.priceRounding.applyToCash) {
    const rounded = applyPriceRounding(rawRemaining, settings.priceRounding as any, 'cash')
    roundingAdjustment = Math.round((rounded - rawRemaining) * 100) / 100
    finalAmount = payment.amount // already rounded by client
  } else if (settings.payments?.cashRounding && settings.payments.cashRounding !== 'none') {
    // Legacy fallback — only for older NUC builds without priceRounding
    roundingAdjustment = calculateRoundingAdjustment(
      rawRemaining,
      settings.payments.cashRounding as any,
      (settings.payments.roundingDirection ?? 'nearest') as any
    )
    finalAmount = roundAmount(
      rawRemaining,
      settings.payments.cashRounding as any,
      (settings.payments.roundingDirection ?? 'nearest') as any
    )
  }

  const amountTendered = payment.amountTendered || finalAmount + (payment.tipAmount || 0)
  const changeGiven = Math.max(0, amountTendered - finalAmount - (payment.tipAmount || 0))

  // Dual pricing: calculate from post-rounding amount
  if (pricingProgram?.enabled && record.pricingMode === 'cash') {
    const markupPct = pricingProgram.creditMarkupPercent ?? pricingProgram.cashDiscountPercent ?? 0
    const cardPrice = calculateCardPrice(finalAmount, markupPct)
    const discountAmount = calculateCashDiscount(cardPrice, markupPct)
    record.priceBeforeDiscount = cardPrice
    record.cashDiscountAmount = discountAmount

    // Validate: cash amount should match expected cash price (warn, don't reject)
    const expectedCashAmount = orderTotal
    const roundingTolerance = (settings.priceRounding?.enabled && settings.priceRounding.applyToCash) ? 0.50 : 0.01
    if (Math.abs(finalAmount - expectedCashAmount) > roundingTolerance) {
      log.warn({ orderId, finalAmount, expectedCashAmount, roundingTolerance }, 'Cash payment amount differs from order total')
    }
  }

  return {
    ...record,
    amount: finalAmount,
    totalAmount: finalAmount + (payment.tipAmount || 0),
    amountTendered,
    changeGiven,
    roundingAdjustment: roundingAdjustment !== 0 ? roundingAdjustment : undefined,
  }
}
