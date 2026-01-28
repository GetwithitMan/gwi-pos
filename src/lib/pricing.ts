// Pricing Utilities
// Skill 31: Cash Discount Program & Skill 29: Commissions

import { DualPricingSettings } from './settings'
import { formatCurrency } from './utils'

// Re-export for backwards compatibility
export { formatCurrency }

/**
 * Calculate the card/display price from the stored cash price
 * IMPORTANT: Menu item prices are stored as CASH prices
 * Card price = cash price × (1 + discount%)
 *
 * Example: Cash price $10, 4% fee → Card price $10.40
 */
export function calculateCardPrice(cashPrice: number, discountPercent: number): number {
  return Math.round(cashPrice * (1 + discountPercent / 100) * 100) / 100
}

/**
 * Calculate the cash discount amount from a card price
 * Used at checkout when customer pays with cash
 *
 * Example: Card price $10.40, 4% discount → Discount $0.40
 */
export function calculateCashDiscount(cardPrice: number, discountPercent: number): number {
  // The discount is: cardPrice - (cardPrice / (1 + discount%))
  // Or approximately: cardPrice × (discount% / (100 + discount%))
  const cashPrice = cardPrice / (1 + discountPercent / 100)
  return Math.round((cardPrice - cashPrice) * 100) / 100
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
    return Math.round(salePrice * (commissionValue / 100) * 100) / 100
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
  return Math.round((cardPrice / (1 + discountPercent / 100)) * 100) / 100
}

/**
 * Round a price to the specified increment
 * Skill 88: Price Rounding
 *
 * @param price - The price to round
 * @param increment - The increment to round to ('none', '0.05', '0.10', '0.25', '0.50', '1.00')
 * @param direction - Rounding direction ('nearest', 'up', 'down')
 * @returns The rounded price
 */
export function roundPrice(
  price: number,
  increment: 'none' | '0.05' | '0.10' | '0.25' | '0.50' | '1.00',
  direction: 'nearest' | 'up' | 'down' = 'nearest'
): number {
  if (increment === 'none') {
    return Math.round(price * 100) / 100  // Just round to 2 decimal places
  }

  const incrementValue = parseFloat(increment)

  switch (direction) {
    case 'up':
      return Math.ceil(price / incrementValue) * incrementValue
    case 'down':
      return Math.floor(price / incrementValue) * incrementValue
    case 'nearest':
    default:
      return Math.round(price / incrementValue) * incrementValue
  }
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
