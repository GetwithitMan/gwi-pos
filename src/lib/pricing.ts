// Pricing Utilities
// Skill 31: Cash Discount Program & Skill 29: Commissions

import { DualPricingSettings } from './settings'
import { formatCurrency } from './utils'

// Re-export for backwards compatibility
export { formatCurrency }

/**
 * Round a dollar value to exactly 2 decimal places using integer cents.
 * Prevents floating-point drift (e.g. 10.2 * 0.1 → 1.0200000000000002).
 * Use this everywhere money is rounded — never use ad-hoc Math.round(x*100)/100.
 */
export function roundToCents(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Calculate the card/display price from the stored cash price
 * IMPORTANT: Menu item prices are stored as CASH prices
 * Card price = cash price × (1 + discount%)
 *
 * Example: Cash price $10, 4% fee → Card price $10.40
 */
export function calculateCardPrice(cashPrice: number, discountPercent: number): number {
  return roundToCents(cashPrice * (1 + discountPercent / 100))
}

/**
 * Calculate the cash discount amount from a card price
 * Used at checkout when customer pays with cash
 *
 * Example: Card price $10.40, 4% discount → Discount $0.40
 */
export function calculateCashDiscount(cardPrice: number, discountPercent: number): number {
  const cashPrice = cardPrice / (1 + discountPercent / 100)
  return roundToCents(cardPrice - cashPrice)
}

/**
 * Get both prices for an item
 * NOTE: The stored price in the database is the CASH price
 * The card price is calculated for display
 */
export function getDualPrices(
  storedPrice: number,
  settings: DualPricingSettings
): { cashPrice: number; cardPrice: number } {
  if (!settings.enabled) {
    return { cashPrice: storedPrice, cardPrice: storedPrice }
  }

  const discountPercent = settings.cashDiscountPercent || 4.0
  const cashPrice = storedPrice
  const cardPrice = calculateCardPrice(storedPrice, discountPercent)

  return { cashPrice, cardPrice }
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
    return roundToCents(salePrice * (commissionValue / 100))
  }

  return 0
}

/**
 * Format the savings message for cash discount
 */
export function formatSavingsMessage(cashTotal: number, cardTotal: number): string {
  const savings = cardTotal - cashTotal
  if (savings <= 0) return ''
  return `Save ${formatCurrency(savings)} by paying with cash!`
}

/**
 * Calculate the cash price from a card price (reverse calculation)
 * Used when you know the card price and need the cash price
 */
export function calculateCashPrice(cardPrice: number, discountPercent: number): number {
  return roundToCents(cardPrice / (1 + discountPercent / 100))
}

/**
 * Round a price to the specified increment using cent-based integer math.
 * Skill 88: Price Rounding
 *
 * All arithmetic is done in integer cents to avoid floating-point artifacts
 * (e.g. 0.05 increments producing 32.3999... instead of 32.40).
 *
 * @param price - The price to round
 * @param increment - The increment to round to ('none', '0.05', '0.10', '0.25', '0.50', '1.00')
 * @param direction - Rounding direction ('nearest', 'up', 'down')
 * @returns The rounded price, always clean 2-decimal
 */
export function roundPrice(
  price: number,
  increment: 'none' | '0.05' | '0.10' | '0.25' | '0.50' | '1.00',
  direction: 'nearest' | 'up' | 'down' = 'nearest'
): number {
  const cents = Math.round(price * 100)

  if (increment === 'none') {
    return cents / 100
  }

  const incCents = Math.round(parseFloat(increment) * 100)
  if (incCents <= 0) {
    return cents / 100
  }

  let roundedCents: number
  switch (direction) {
    case 'up':
      roundedCents = Math.ceil(cents / incCents) * incCents
      break
    case 'down':
      roundedCents = Math.floor(cents / incCents) * incCents
      break
    case 'nearest':
    default:
      roundedCents = Math.round(cents / incCents) * incCents
      break
  }

  return roundedCents / 100
}

/**
 * Apply price rounding based on settings
 */
export function applyPriceRounding(
  price: number,
  settings: {
    enabled: boolean
    increment: 'none' | '0.05' | '0.10' | '0.25' | '0.50' | '1.00'
    direction: 'nearest' | 'up' | 'down'
    applyToCash: boolean
    applyToCard: boolean
  },
  paymentMethod: 'cash' | 'card'
): number {
  if (!settings.enabled) {
    return price
  }

  // Check if rounding should be applied for this payment method
  if (paymentMethod === 'cash' && !settings.applyToCash) {
    return price
  }
  if (paymentMethod === 'card' && !settings.applyToCard) {
    return price
  }

  return roundPrice(price, settings.increment, settings.direction)
}
