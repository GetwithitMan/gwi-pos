// Pricing Utilities
// Skill 31: Dual Pricing & Skill 29: Commissions

import { DualPricingSettings } from './settings'

/**
 * Calculate the card price from cash price with surcharge
 */
export function calculateCardPrice(cashPrice: number, surchargePercent: number): number {
  return Math.round(cashPrice * (1 + surchargePercent / 100) * 100) / 100
}

/**
 * Calculate the cash price from card price (reverse calculation)
 */
export function calculateCashPrice(cardPrice: number, surchargePercent: number): number {
  return Math.round((cardPrice / (1 + surchargePercent / 100)) * 100) / 100
}

/**
 * Get both prices for an item
 */
export function getDualPrices(
  basePrice: number,
  settings: DualPricingSettings
): { cashPrice: number; cardPrice: number } {
  if (!settings.enabled) {
    return { cashPrice: basePrice, cardPrice: basePrice }
  }

  // In our model, the stored price is the cash (lower) price
  const cashPrice = basePrice
  const cardPrice = calculateCardPrice(basePrice, settings.cardSurchargePercent)

  return { cashPrice, cardPrice }
}

/**
 * Calculate the surcharge amount for a given total
 */
export function calculateSurchargeAmount(cashTotal: number, surchargePercent: number): number {
  return Math.round(cashTotal * (surchargePercent / 100) * 100) / 100
}

/**
 * Calculate commission amount based on type and value
 */
export function calculateCommission(
  salePrice: number,
  commissionType: 'fixed' | 'percent' | null | undefined,
  commissionValue: number | null | undefined
): number {
  if (!commissionType || commissionValue === null || commissionValue === undefined) {
    return 0
  }

  if (commissionType === 'fixed') {
    return commissionValue
  }

  if (commissionType === 'percent') {
    return Math.round(salePrice * (commissionValue / 100) * 100) / 100
  }

  return 0
}

/**
 * Format currency display
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

/**
 * Format dual price display string
 */
export function formatDualPriceDisplay(
  basePrice: number,
  settings: DualPricingSettings
): string {
  if (!settings.enabled) {
    return formatCurrency(basePrice)
  }

  const { cashPrice, cardPrice } = getDualPrices(basePrice, settings)
  return `${formatCurrency(cashPrice)} / ${formatCurrency(cardPrice)}`
}

/**
 * Format the savings message for dual pricing
 */
export function formatSavingsMessage(cashTotal: number, cardTotal: number): string {
  const savings = cardTotal - cashTotal
  if (savings <= 0) return ''
  return `Save ${formatCurrency(savings)} by paying with cash!`
}
