/**
 * Dual Pricing Domain Logic
 *
 * Pure functions for dual pricing (cash discount) calculations.
 * Handles cash vs credit pricing, surcharges, and discounts.
 *
 * Note: Dual pricing must comply with card brand rules and state regulations.
 * Always consult legal counsel before implementing.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DualPricingSettings {
  enabled: boolean
  mode: 'cash_discount' | 'credit_surcharge'
  percentage: number
  minimumAmount?: number
  maximumAmount?: number
  exemptCategories?: string[]
  displayMode: 'separate_prices' | 'cash_discount_note' | 'credit_surcharge_note'
}

export interface PricingCalculation {
  basePrice: number
  cashPrice: number
  creditPrice: number
  difference: number
  discountPercent: number
}

export interface OrderPricingBreakdown {
  subtotal: number
  cashSubtotal: number
  creditSubtotal: number
  adjustment: number
  adjustmentLabel: string
  tax: number
  total: number
}

// ─── Price Calculation Functions ─────────────────────────────────────────────

/**
 * Calculate cash and credit prices for an item
 *
 * @param basePrice - Item's base price
 * @param settings - Dual pricing settings
 * @returns Pricing calculation with cash and credit prices
 *
 * @example
 * // Cash discount mode
 * calculateDualPrice(10.00, { mode: 'cash_discount', percentage: 3.5 })
 * // Returns { basePrice: 10.00, cashPrice: 9.65, creditPrice: 10.00, difference: 0.35 }
 *
 * @example
 * // Credit surcharge mode
 * calculateDualPrice(10.00, { mode: 'credit_surcharge', percentage: 3.5 })
 * // Returns { basePrice: 10.00, cashPrice: 10.00, creditPrice: 10.35, difference: 0.35 }
 */
export function calculateDualPrice(
  basePrice: number,
  settings: DualPricingSettings
): PricingCalculation {
  if (!settings.enabled) {
    return {
      basePrice,
      cashPrice: basePrice,
      creditPrice: basePrice,
      difference: 0,
      discountPercent: 0,
    }
  }

  const adjustmentAmount = Math.round(basePrice * (settings.percentage / 100) * 100) / 100

  if (settings.mode === 'cash_discount') {
    // Base price is credit price, cash gets discount
    const cashPrice = Math.round((basePrice - adjustmentAmount) * 100) / 100
    return {
      basePrice,
      cashPrice,
      creditPrice: basePrice,
      difference: adjustmentAmount,
      discountPercent: settings.percentage,
    }
  } else {
    // Base price is cash price, credit gets surcharge
    const creditPrice = Math.round((basePrice + adjustmentAmount) * 100) / 100
    return {
      basePrice,
      cashPrice: basePrice,
      creditPrice,
      difference: adjustmentAmount,
      discountPercent: settings.percentage,
    }
  }
}

/**
 * Check if dual pricing applies to an item
 *
 * @param itemPrice - Item price
 * @param itemCategory - Item category ID
 * @param settings - Dual pricing settings
 * @returns True if dual pricing should be applied
 */
export function dualPricingApplies(
  itemPrice: number,
  itemCategory: string,
  settings: DualPricingSettings
): boolean {
  if (!settings.enabled) return false

  // Check minimum amount
  if (settings.minimumAmount && itemPrice < settings.minimumAmount) {
    return false
  }

  // Check maximum amount
  if (settings.maximumAmount && itemPrice > settings.maximumAmount) {
    return false
  }

  // Check exempt categories
  if (settings.exemptCategories && settings.exemptCategories.includes(itemCategory)) {
    return false
  }

  return true
}

/**
 * Calculate order totals with dual pricing
 *
 * @param items - Array of order items with prices and categories
 * @param paymentMethod - Payment method ('cash' or 'credit'/'debit')
 * @param taxRate - Tax rate as decimal (e.g., 0.0825 for 8.25%)
 * @param settings - Dual pricing settings
 * @returns Order pricing breakdown
 *
 * @example
 * calculateOrderPricing(
 *   [{ price: 10.00, category: 'food' }, { price: 5.00, category: 'drinks' }],
 *   'cash',
 *   0.0825,
 *   { enabled: true, mode: 'cash_discount', percentage: 3.5 }
 * )
 */
export function calculateOrderPricing(
  items: Array<{ price: number; category: string; quantity?: number }>,
  paymentMethod: 'cash' | 'credit' | 'debit',
  taxRate: number,
  settings: DualPricingSettings
): OrderPricingBreakdown {
  let cashSubtotal = 0
  let creditSubtotal = 0

  for (const item of items) {
    const quantity = item.quantity || 1
    const itemTotal = item.price * quantity

    if (dualPricingApplies(item.price, item.category, settings)) {
      const pricing = calculateDualPrice(item.price, settings)
      cashSubtotal += pricing.cashPrice * quantity
      creditSubtotal += pricing.creditPrice * quantity
    } else {
      // No dual pricing - same price for both
      cashSubtotal += itemTotal
      creditSubtotal += itemTotal
    }
  }

  // Round subtotals
  cashSubtotal = Math.round(cashSubtotal * 100) / 100
  creditSubtotal = Math.round(creditSubtotal * 100) / 100

  // Determine which subtotal to use based on payment method
  const isCash = paymentMethod === 'cash'
  const subtotal = isCash ? cashSubtotal : creditSubtotal
  const adjustment = creditSubtotal - cashSubtotal

  // Calculate tax on the appropriate subtotal
  const tax = Math.round(subtotal * taxRate * 100) / 100
  const total = Math.round((subtotal + tax) * 100) / 100

  // Determine adjustment label
  let adjustmentLabel = ''
  if (settings.enabled && adjustment !== 0) {
    if (settings.mode === 'cash_discount') {
      adjustmentLabel = isCash
        ? `Cash Discount (${settings.percentage}%)`
        : 'Credit Card Price'
    } else {
      adjustmentLabel = isCash
        ? 'Cash Price'
        : `Credit Card Surcharge (${settings.percentage}%)`
    }
  }

  return {
    subtotal,
    cashSubtotal,
    creditSubtotal,
    adjustment: isCash ? -adjustment : adjustment,
    adjustmentLabel,
    tax,
    total,
  }
}

// ─── Display Helpers ─────────────────────────────────────────────────────────

/**
 * Format price for display based on settings
 *
 * @param basePrice - Item's base price
 * @param settings - Dual pricing settings
 * @returns Formatted price string
 *
 * @example
 * formatPriceForDisplay(10.00, { displayMode: 'separate_prices', mode: 'cash_discount', percentage: 3.5 })
 * // Returns "$9.65 cash / $10.00 credit"
 */
export function formatPriceForDisplay(
  basePrice: number,
  settings: DualPricingSettings
): string {
  if (!settings.enabled) {
    return `$${basePrice.toFixed(2)}`
  }

  const pricing = calculateDualPrice(basePrice, settings)

  switch (settings.displayMode) {
    case 'separate_prices':
      return `$${pricing.cashPrice.toFixed(2)} cash / $${pricing.creditPrice.toFixed(2)} credit`

    case 'cash_discount_note':
      if (settings.mode === 'cash_discount') {
        return `$${pricing.creditPrice.toFixed(2)} (save $${pricing.difference.toFixed(2)} with cash)`
      }
      return `$${pricing.cashPrice.toFixed(2)}`

    case 'credit_surcharge_note':
      if (settings.mode === 'credit_surcharge') {
        return `$${pricing.cashPrice.toFixed(2)} (+$${pricing.difference.toFixed(2)} credit)`
      }
      return `$${pricing.creditPrice.toFixed(2)}`

    default:
      return `$${basePrice.toFixed(2)}`
  }
}

/**
 * Get display label for adjustment line on receipt
 *
 * @param paymentMethod - Payment method used
 * @param adjustmentAmount - Adjustment amount
 * @param settings - Dual pricing settings
 * @returns Label string for receipt
 */
export function getAdjustmentLabel(
  paymentMethod: 'cash' | 'credit' | 'debit',
  adjustmentAmount: number,
  settings: DualPricingSettings
): string {
  if (adjustmentAmount === 0 || !settings.enabled) return ''

  const isCash = paymentMethod === 'cash'

  if (settings.mode === 'cash_discount') {
    return isCash
      ? `Cash Discount (${settings.percentage}%)`
      : ''
  } else {
    return !isCash
      ? `Credit Card Processing Fee (${settings.percentage}%)`
      : ''
  }
}

// ─── Compliance Helpers ──────────────────────────────────────────────────────

/**
 * Validate dual pricing settings for compliance
 *
 * @param settings - Dual pricing settings to validate
 * @returns Validation result with warnings
 */
export function validateDualPricingCompliance(
  settings: DualPricingSettings
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = []

  // Credit surcharge limits (check card brand rules)
  if (settings.mode === 'credit_surcharge') {
    if (settings.percentage > 4.0) {
      warnings.push(
        'Credit surcharge exceeds common 4% limit. Check card brand rules and state regulations.'
      )
    }

    warnings.push(
      'Credit surcharges must comply with Visa/Mastercard rules and state laws. Some states prohibit surcharges.'
    )
  }

  // Cash discount best practices
  if (settings.mode === 'cash_discount') {
    if (settings.percentage > 10.0) {
      warnings.push('Cash discount over 10% may appear suspicious to customers.')
    }

    warnings.push(
      'Ensure menu prices represent credit card prices when using cash discount programs.'
    )
  }

  // Display requirements
  if (settings.displayMode === 'credit_surcharge_note') {
    warnings.push(
      'Surcharge disclosure must be clear at point of entry and point of sale.'
    )
  }

  return {
    valid: warnings.length === 0,
    warnings,
  }
}

// ─── Default Settings ────────────────────────────────────────────────────────

/**
 * Default dual pricing settings (disabled by default)
 */
export const DEFAULT_DUAL_PRICING_SETTINGS: DualPricingSettings = {
  enabled: false,
  mode: 'cash_discount', // Safer legally than surcharge
  percentage: 3.5,
  minimumAmount: 1.0, // Don't apply to small purchases
  maximumAmount: undefined,
  exemptCategories: [], // Could exempt alcohol in some jurisdictions
  displayMode: 'separate_prices',
}
