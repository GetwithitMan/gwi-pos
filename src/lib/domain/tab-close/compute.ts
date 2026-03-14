/**
 * Tab Close Computations
 *
 * PURE functions — no DB calls, no side effects.
 * Amount calculation, tip suggestions, card resolution, and auto-gratuity.
 */

import type { TabCloseOrder, TabCloseCard, CardResolutionResult, BottleServiceTier } from './types'
import { calculateCardPrice } from '@/lib/pricing'
import { calculateAutoGratuity } from '@/lib/domain/payment'

interface DualPricingSettings {
  enabled: boolean
  cashDiscountPercent?: number
}

interface LocationSettings {
  tipBank?: { tipGuide?: { percentages?: number[] } }
  dualPricing?: DualPricingSettings
  autoGratuity?: { enabled: boolean; percent: number; minimumPartySize: number }
}

/**
 * Parse tip suggestions from location settings.
 * PURE — no side effects.
 */
export function parseTipSuggestions(settings: LocationSettings): number[] {
  const rawSuggestions = settings.tipBank?.tipGuide?.percentages ?? [15, 18, 20, 25]
  const tipSuggestions = rawSuggestions
    .map(Number)
    .filter(pct => Number.isFinite(pct) && pct > 0 && pct <= 100)
    .slice(0, 4)
  if (tipSuggestions.length === 0) tipSuggestions.push(15, 18, 20, 25)
  return tipSuggestions
}

/**
 * Compute the purchase amount, handling dual pricing (card vs cash price).
 *
 * Tab closes are always card payments (pre-auth capture), so if dual pricing is
 * enabled we must capture the card price, not the stored cash price.
 * Pricing model: stored order.total = cash price; card price = cash price * (1 + cashDiscountPercent/100)
 *
 * PURE — no side effects.
 */
export function computePurchaseAmount(
  order: TabCloseOrder,
  dualPricing?: DualPricingSettings,
): { purchaseAmount: number; cashBaseAmount: number } {
  const cashBaseAmount = Number(order.total) - Number(order.tipTotal)
  const purchaseAmount = dualPricing?.enabled
    ? calculateCardPrice(cashBaseAmount, dualPricing.cashDiscountPercent ?? 4.0)
    : cashBaseAmount
  return { purchaseAmount, cashBaseAmount }
}

/**
 * Resolve which cards to charge and validate card selection.
 * PURE — no side effects.
 */
export function resolveCardsToCharge(
  allCards: TabCloseCard[],
  orderCardId?: string,
): CardResolutionResult {
  if (orderCardId) {
    const filtered = allCards.filter(c => c.id === orderCardId)
    if (filtered.length === 0) {
      return { valid: false, error: 'Specified card not found or not authorized' }
    }
    return { valid: true, cards: filtered }
  }

  if (allCards.length > 1) {
    return {
      valid: false,
      error: 'Multiple cards on tab. Please specify which card to charge.',
      code: 'CARD_SELECTION_REQUIRED',
      cards: allCards.map(c => ({ id: c.id, last4: c.cardLast4, cardType: c.cardType })),
    }
  }

  return { valid: true, cards: allCards }
}

/**
 * Resolve auto-gratuity for tab close.
 *
 * Two paths:
 * 1. Bottle service auto-gratuity: applies tier-based percentage if no explicit tip
 * 2. Party-size auto-gratuity: applies location setting if guest count meets threshold
 *    (delegates to calculateAutoGratuity from payment domain module)
 *
 * PURE — no side effects.
 */
export function resolveAutoGratuity(params: {
  isBottleService: boolean
  bottleServiceTier: BottleServiceTier | null
  guestCount: number
  purchaseAmount: number
  tipMode: string
  existingGratuity: number | undefined
  autoGratuitySettings?: { enabled: boolean; percent: number; minimumPartySize: number }
}): { gratuityAmount: number | undefined; isAutoGratuity: boolean } {
  let gratuityAmount = params.existingGratuity
  let isAutoGratuity = false

  // Bottle service auto-gratuity: apply if no explicit tip was provided
  if (
    params.isBottleService &&
    params.bottleServiceTier &&
    gratuityAmount == null &&
    params.tipMode !== 'device'
  ) {
    const autoGratPct = Number(params.bottleServiceTier.autoGratuityPercent) || 0
    const minSpend = Number(params.bottleServiceTier.minimumSpend) || 0

    if (autoGratPct > 0 && (minSpend <= 0 || params.purchaseAmount >= minSpend)) {
      gratuityAmount = Math.round(params.purchaseAmount * (autoGratPct / 100) * 100) / 100
      isAutoGratuity = true
    }
  }

  // Party-size auto-gratuity: apply if no explicit tip and bottle service didn't set one
  if (
    !params.isBottleService &&
    gratuityAmount == null &&
    params.tipMode !== 'device'
  ) {
    const result = calculateAutoGratuity(params.autoGratuitySettings, {
      guestCount: params.guestCount,
      existingTipTotal: 0,
      orderSubtotal: params.purchaseAmount,
      payments: [{ method: 'credit' }],
    })
    if (result.applied) {
      gratuityAmount = result.amount
      isAutoGratuity = true
    }
  }

  return { gratuityAmount, isAutoGratuity }
}
