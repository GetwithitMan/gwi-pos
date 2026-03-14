/**
 * Auto-Gratuity Calculation
 *
 * PURE function — determines if auto-gratuity should apply and the amount.
 * Reusable by both pay and tab-close routes.
 */

import type { AutoGratuityResult } from './types'

interface AutoGratuitySettings {
  enabled: boolean
  percent: number
  minimumPartySize: number
}

interface AutoGratuityContext {
  guestCount: number
  existingTipTotal: number
  orderSubtotal: number
  payments: Array<{ method: string; tipAmount?: number }>
}

/**
 * Calculate auto-gratuity for a payment request.
 *
 * Applied as tipAmount on the first tippable payment. Does NOT apply if:
 * - Any payment already carries a tip (customer-provided tip takes precedence)
 * - Order already has a tip total (prior auto-grat)
 * - Guest count is below minimum party size
 */
export function calculateAutoGratuity(
  settings: AutoGratuitySettings | undefined,
  context: AutoGratuityContext,
): AutoGratuityResult {
  const noResult: AutoGratuityResult = { applied: false, note: null, tippableIndex: -1, amount: 0 }

  if (
    !settings?.enabled ||
    settings.percent <= 0 ||
    settings.minimumPartySize <= 0 ||
    context.guestCount < settings.minimumPartySize ||
    context.existingTipTotal !== 0
  ) {
    return noResult
  }

  // Only apply if no payment in this request already carries a tip
  const hasExistingTip = context.payments.some(p => (p.tipAmount ?? 0) > 0)
  if (hasExistingTip) {
    return noResult
  }

  const autoGratAmount = Math.round(context.orderSubtotal * (settings.percent / 100) * 100) / 100
  if (autoGratAmount <= 0) {
    return noResult
  }

  // Apply to the first payment that supports tips (not gift card)
  const tippableIdx = context.payments.findIndex(p => p.method !== 'gift_card')
  if (tippableIdx < 0) {
    return noResult
  }

  return {
    applied: true,
    note: `Auto-gratuity applied (${settings.percent}% for party of ${context.guestCount})`,
    tippableIndex: tippableIdx,
    amount: autoGratAmount,
  }
}
