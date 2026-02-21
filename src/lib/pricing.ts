// Pricing Utilities
// Skill 31: Cash Discount Program & Skill 29: Commissions
// T-080 Phase 1B: Full Pricing Program Engine

import { DualPricingSettings, PricingProgram } from './settings'
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
 * Calculate commission amount based on type and value.
 *
 * For 'fixed' commissions, the value is per-unit — multiply by quantity.
 * For 'percent' commissions, salePrice should already reflect total (price × qty).
 */
export function calculateCommission(
  salePrice: number,
  commissionType: 'fixed' | 'percent' | string | null | undefined,
  commissionValue: number | null | undefined,
  quantity: number = 1
): number {
  if (!commissionType || commissionValue === null || commissionValue === undefined) {
    return 0
  }

  if (commissionType === 'fixed') {
    return roundToCents(commissionValue * quantity)
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

// ─── Surcharge Strategy (T-080 Phase 1B) ─────────────────────────────────────

/**
 * Calculate the surcharge amount for a card transaction.
 * Surcharge is added ON TOP of the base price (unlike cash discount which reduces it).
 * Visa/MC cap: 3%. Must not apply to debit cards in most states.
 */
export function calculateSurcharge(basePrice: number, surchargePercent: number): number {
  return roundToCents(basePrice * (surchargePercent / 100))
}

/**
 * Total price including surcharge.
 */
export function calculateSurchargeTotal(basePrice: number, surchargePercent: number): number {
  return roundToCents(basePrice + calculateSurcharge(basePrice, surchargePercent))
}

// ─── Merchant Cost Strategies (absorbed by merchant, invisible to customer) ──

/**
 * Calculate merchant processing cost for a flat-rate processor (e.g. Square/Stripe model).
 * Customer price is unchanged — this is just for P&L tracking.
 */
export function calculateFlatRateCost(amount: number, ratePercent: number, perTxnFee: number): number {
  return roundToCents(amount * (ratePercent / 100) + perTxnFee)
}

/**
 * Calculate merchant cost for interchange-plus pricing.
 * interchange = actual interchange rate paid (varies by card type).
 * markupPercent and markupPerTxn are the processor's margin above interchange.
 */
export function calculateInterchangePlusCost(
  amount: number,
  interchangePercent: number,
  markupPercent: number,
  markupPerTxn: number
): number {
  return roundToCents(amount * ((interchangePercent + markupPercent) / 100) + markupPerTxn)
}

/**
 * Tiered pricing — qualified / mid-qualified / non-qualified rates.
 * tier determines which rate bucket applies.
 */
export function calculateTieredCost(
  amount: number,
  tier: 'qualified' | 'mid_qualified' | 'non_qualified',
  rates: { qualifiedRate: number; midQualifiedRate: number; nonQualifiedRate: number },
  perTxnFee: number
): number {
  const rateMap = {
    qualified: rates.qualifiedRate,
    mid_qualified: rates.midQualifiedRate,
    non_qualified: rates.nonQualifiedRate,
  }
  return roundToCents(amount * (rateMap[tier] / 100) + perTxnFee)
}

// ─── Compliance ───────────────────────────────────────────────────────────────

/** States where surcharging on credit cards is banned or restricted. */
const SURCHARGE_BANNED_STATES = new Set(['CT', 'MA', 'PR'])

/**
 * Returns true if surcharging is permitted in the given US state/territory.
 * Visa/MC rules: surcharge banned in CT, MA. Puerto Rico also prohibits it.
 */
export function isSurchargeLegal(state: string): boolean {
  return !SURCHARGE_BANNED_STATES.has(state.toUpperCase().trim())
}

// ─── Strategy Selector ────────────────────────────────────────────────────────

export interface PricingResult {
  basePrice: number
  finalPrice: number
  surchargeAmount: number
  merchantCost: number
  pricingModel: PricingProgram['model']
}

/**
 * Compute the final customer price and any surcharge/merchant cost for a given amount.
 * For surcharge models: finalPrice > basePrice (customer pays more).
 * For merchant-absorbed models: finalPrice === basePrice (customer sees no change).
 * For cash discount: use getDualPrices() or calculateCardPrice() (existing functions).
 */
export function applyPricingProgram(
  basePrice: number,
  program: PricingProgram,
  paymentMethod: 'cash' | 'credit' | 'debit' = 'credit'
): PricingResult {
  const base: PricingResult = {
    basePrice,
    finalPrice: basePrice,
    surchargeAmount: 0,
    merchantCost: 0,
    pricingModel: program.model,
  }

  if (!program.enabled) return base

  switch (program.model) {
    case 'cash_discount': {
      // Use existing calculateCardPrice for backward compat
      if (paymentMethod === 'cash') return base
      const pct = program.cashDiscountPercent ?? 0
      const applies = (paymentMethod === 'credit' && (program.applyToCredit ?? true))
        || (paymentMethod === 'debit' && (program.applyToDebit ?? true))
      if (!applies) return base
      return { ...base, finalPrice: calculateCardPrice(basePrice, pct) }
    }

    case 'surcharge': {
      if (paymentMethod === 'cash') return base
      // Typically only credit, not debit
      const appliesToCard = (paymentMethod === 'credit' && (program.surchargeApplyToCredit ?? true))
        || (paymentMethod === 'debit' && (program.surchargeApplyToDebit ?? false))
      if (!appliesToCard) return base
      const pct = program.surchargePercent ?? 0
      const surcharge = calculateSurcharge(basePrice, pct)
      return { ...base, finalPrice: roundToCents(basePrice + surcharge), surchargeAmount: surcharge }
    }

    case 'flat_rate': {
      const cost = calculateFlatRateCost(basePrice, program.flatRatePercent ?? 0, program.flatRatePerTxn ?? 0)
      return { ...base, merchantCost: cost }
    }

    case 'interchange_plus': {
      // interchange rate not stored — use markup only for tracking
      const cost = calculateInterchangePlusCost(basePrice, 0, program.markupPercent ?? 0, program.markupPerTxn ?? 0)
      return { ...base, merchantCost: cost }
    }

    case 'tiered': {
      // Default to qualified rate for estimate
      const cost = calculateTieredCost(
        basePrice,
        'qualified',
        {
          qualifiedRate: program.qualifiedRate ?? 0,
          midQualifiedRate: program.midQualifiedRate ?? 0,
          nonQualifiedRate: program.nonQualifiedRate ?? 0,
        },
        program.tieredPerTxn ?? 0
      )
      return { ...base, merchantCost: cost }
    }

    default:
      return base
  }
}
