/**
 * Pizza Price Estimate — Client-Safe Utility
 *
 * DISPLAY ONLY — server quote is authoritative.
 * This provides immediate UX feedback while the customer builds their pizza.
 * Final price is always determined by the server at checkout-quote and checkout.
 *
 * If the client estimate differs from the server quote, the UI should show the
 * server amount with a note ("Price updated"). The customer must acknowledge
 * any material price change (>$0.50 or >2%) before payment submission.
 *
 * Pricing modes:
 *   - FRACTIONAL (recommended): topping price × coverage% × sizeMultiplier
 *     Half pizza = 50% of topping price, quarter = 25%, eighth = 12.5%
 *   - FLAT: topping price × sizeMultiplier regardless of how much pizza it covers
 *   - HYBRID: custom % per coverage level (falls back to flat if no config)
 *
 * NO Prisma or server-only imports — safe for browser bundles.
 */

import { getSectionCoverage } from './pizza-section-utils'

export interface PizzaPriceInput {
  /** Base price for the selected size (e.g., $12.99 for a Large) */
  sizeBasePrice: number
  /** Topping price multiplier for this size (e.g., 1.0 for Medium, 1.3 for Large) */
  sizeToppingMultiplier: number
  /** Upcharge for selected crust (0 for standard) */
  crustPrice: number
  /** Base price for selected sauce */
  saucePrice: number
  /** Base price for selected cheese */
  cheesePrice: number
  /** Sauce amount: 'none' = $0, 'light' = regular price, 'regular' = regular price, 'extra' = regular + extraPrice */
  sauceAmount: 'none' | 'light' | 'regular' | 'extra'
  /** Cheese amount: same rules as sauce */
  cheeseAmount: 'none' | 'light' | 'regular' | 'extra'
  /** Additional cost when sauce is "extra" */
  sauceExtraPrice: number
  /** Additional cost when cheese is "extra" */
  cheeseExtraPrice: number
  /** Toppings with per-topping pricing and section placement */
  toppings: Array<{
    /** Base price for this topping on a whole pizza */
    price: number
    /** Price when "extra" amount is selected (falls back to price × 2) */
    extraPrice?: number
    /** Which of the 24 sections this topping covers */
    sections: number[]
    /** 'regular' or 'extra' (2x amount) */
    amount: 'regular' | 'extra'
  }>
  /** How coverage affects topping price */
  pricingMode: 'fractional' | 'flat' | 'hybrid'
  /** Number of toppings that are free (applied to highest-price first) */
  freeToppingsCount: number
  /** Whether free toppings count is per pizza or varies by size */
  freeToppingsMode: 'per_pizza' | 'per_size'
}

export interface PizzaPriceEstimate {
  sizePrice: number
  crustPrice: number
  saucePrice: number
  cheesePrice: number
  toppingsPrice: number
  totalPrice: number
  freeToppingsUsed: number
}

/**
 * Calculate a client-side pizza price estimate for display purposes.
 *
 * DISPLAY ONLY — the server checkout-quote is the authoritative price.
 *
 * @param input - All pricing inputs from the pizza builder state
 * @returns Breakdown of estimated prices by component
 */
export function calculatePizzaPriceEstimate(input: PizzaPriceInput): PizzaPriceEstimate {
  const {
    sizeBasePrice,
    sizeToppingMultiplier,
    crustPrice,
    saucePrice,
    cheesePrice,
    sauceAmount,
    cheeseAmount,
    sauceExtraPrice,
    cheeseExtraPrice,
    toppings,
    pricingMode,
    freeToppingsCount,
  } = input

  // --- Size ---
  const sizeResult = round2(sizeBasePrice)

  // --- Crust ---
  const crustResult = round2(crustPrice)

  // --- Sauce ---
  const sauceResult = calculateCondimentPrice(saucePrice, sauceExtraPrice, sauceAmount)

  // --- Cheese ---
  const cheeseResult = calculateCondimentPrice(cheesePrice, cheeseExtraPrice, cheeseAmount)

  // --- Toppings ---
  // 1. Calculate the effective price for each topping (before free-topping deduction)
  const toppingPrices = toppings.map((t) => {
    const basePrice = t.amount === 'extra'
      ? (t.extraPrice ?? t.price * 2)
      : t.price

    const coverageMultiplier = getCoverageMultiplier(t.sections, pricingMode)
    return round2(basePrice * coverageMultiplier * sizeToppingMultiplier)
  })

  // 2. Apply free toppings to the most expensive toppings first
  const freeToppingsUsed = applyFreeToppings(toppingPrices, freeToppingsCount)

  const toppingsPrice = round2(toppingPrices.reduce((sum, p) => sum + p, 0))

  // --- Total ---
  const totalPrice = round2(sizeResult + crustResult + sauceResult + cheeseResult + toppingsPrice)

  return {
    sizePrice: sizeResult,
    crustPrice: crustResult,
    saucePrice: sauceResult,
    cheesePrice: cheeseResult,
    toppingsPrice,
    totalPrice,
    freeToppingsUsed,
  }
}

/**
 * Calculate sauce or cheese price based on amount selection.
 * - 'none': $0
 * - 'light': regular price (no discount)
 * - 'regular': regular price
 * - 'extra': regular price + extraPrice
 */
function calculateCondimentPrice(
  basePrice: number,
  extraPrice: number,
  amount: 'none' | 'light' | 'regular' | 'extra'
): number {
  switch (amount) {
    case 'none':
      return 0
    case 'light':
    case 'regular':
      return round2(basePrice)
    case 'extra':
      return round2(basePrice + extraPrice)
  }
}

/**
 * Get the coverage multiplier for a topping based on pricing mode.
 *
 * - fractional: actual coverage fraction (half = 0.5, quarter = 0.25)
 * - flat: always 1.0 regardless of coverage
 * - hybrid: falls back to flat (1.0) — hybrid requires server-side config
 *   that isn't available on the client. Server quote will be authoritative.
 */
function getCoverageMultiplier(
  sections: number[],
  pricingMode: 'fractional' | 'flat' | 'hybrid'
): number {
  if (pricingMode === 'flat' || pricingMode === 'hybrid') {
    // Hybrid requires venue-specific config (hybridPricing JSON from PizzaConfig).
    // Client doesn't have it, so fall back to flat. Server quote corrects this.
    return 1.0
  }

  // Fractional: price scales linearly with coverage
  return getSectionCoverage(sections)
}

/**
 * Apply free toppings by zeroing out the most expensive ones first.
 * Mutates the toppingPrices array in place.
 *
 * @returns Number of free toppings actually applied
 */
function applyFreeToppings(toppingPrices: number[], freeToppingsCount: number): number {
  if (freeToppingsCount <= 0 || toppingPrices.length === 0) return 0

  // Build index-price pairs, sort by price descending (most expensive first)
  const indexed = toppingPrices
    .map((price, index) => ({ price, index }))
    .sort((a, b) => b.price - a.price)

  const toApply = Math.min(freeToppingsCount, toppingPrices.length)

  for (let i = 0; i < toApply; i++) {
    toppingPrices[indexed[i].index] = 0
  }

  return toApply
}

/** Round to 2 decimal places (cents) */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
