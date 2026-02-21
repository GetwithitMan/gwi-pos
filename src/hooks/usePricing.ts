'use client'

import { useMemo } from 'react'
import { useOrderSettings } from '@/hooks/useOrderSettings'
import {
  calculateCardPrice,
  calculateSurcharge,
  roundToCents,
  formatSavingsMessage,
} from '@/lib/pricing'
import { calculateOrderTotals } from '@/lib/order-calculations'
import type { DualPricingSettings, PriceRoundingSettings, PricingProgram } from '@/lib/settings'

interface UsePricingOptions {
  // Raw order values (from store or local state)
  subtotal: number           // Sum of item prices (stored as cash prices in DB)
  discountTotal?: number     // Dollar discounts applied
  tipTotal?: number          // Gratuity amount

  // Tax-inclusive split subtotals (optional — when provided, overrides flat tax calc)
  inclusiveSubtotal?: number  // Subtotal of tax-inclusive items (liquor/food with inclusive pricing)
  exclusiveSubtotal?: number  // Subtotal of tax-exclusive items (normal pricing)

  // Payment context
  paymentMethod?: 'cash' | 'card'   // Default: 'card' (shows card price by default)
}

interface UsePricingReturn {
  // === Calculated Totals ===
  subtotal: number         // Card-adjusted subtotal (if dual pricing enabled)
  cashSubtotal: number     // Cash/stored subtotal (always the DB price)
  cardSubtotal: number     // Card subtotal (with surcharge if dual pricing)
  cashDiscount: number     // Cash discount amount (card - cash)
  discounts: number        // Applied dollar discounts
  taxableAmount: number    // Amount subject to tax (after discounts)
  tax: number              // Tax amount
  tip: number              // Tip/gratuity
  total: number            // Final total (after rounding)
  totalBeforeRounding: number  // Total before price rounding
  roundingDelta: number    // total - totalBeforeRounding

  // === Cash & Card totals (both always computed for toggle buttons) ===
  cashTotal: number        // Cash total with tax (tax-inclusive aware)
  cardTotal: number        // Card total with tax (tax-inclusive aware)
  cashTax: number          // Tax on cash subtotal
  cardTax: number          // Tax on card subtotal
  cashRoundingDelta: number  // Rounding applied to cash total (for UI display)
  cardRoundingDelta: number  // Rounding applied to card total (usually 0)

  // === Settings (from API) ===
  taxRate: number           // Decimal (0.08)
  dualPricing: DualPricingSettings
  priceRounding: PriceRoundingSettings
  isDualPricingEnabled: boolean

  // === Helpers ===
  isLoading: boolean        // Settings still loading from API
  savingsMessage: string    // "Save $X by paying with cash!" or ""

  // === For PaymentModal props ===
  cashDiscountRate: number  // The percentage (4.0, not 0.04)

  // === Surcharge (T-080 Phase 3) ===
  surchargeAmount: number   // Surcharge line item amount (0 for all non-surcharge models)
  pricingProgram: PricingProgram
}

/**
 * Thin adapter hook over calculateOrderTotals.
 *
 * All tax, rounding, and total logic lives in order-calculations.ts.
 * This hook:
 * 1. Gets settings from useOrderSettings()
 * 2. Builds synthetic items from subtotal splits
 * 3. Calls calculateOrderTotals twice (cash + card) for toggle buttons
 * 4. Returns the same shape consumers expect
 */
export function usePricing(options: UsePricingOptions = { subtotal: 0 }): UsePricingReturn {
  const { dualPricing, taxRate, priceRounding, taxInclusiveLiquor, taxInclusiveFood, pricingProgram, isLoading } = useOrderSettings()

  const hasTaxInclusive = taxInclusiveLiquor || taxInclusiveFood
  const paymentMethod = options.paymentMethod || 'card'

  const calculated = useMemo(() => {
    // 1. Start with stored subtotal (cash prices in DB)
    const storedSubtotal = options.subtotal || 0
    const discountPct = dualPricing.cashDiscountPercent || 4.0
    const dollarDiscounts = options.discountTotal || 0
    const tip = options.tipTotal || 0

    // 2. Derive cash and card subtotals (dual pricing computed ONCE here)
    const cashSubtotal = storedSubtotal
    const cardSubtotal = dualPricing.enabled
      ? calculateCardPrice(storedSubtotal, discountPct)
      : storedSubtotal

    // 3. Build synthetic items for the centralized calculator
    // Split into inclusive/exclusive if tax-inclusive pricing is active
    const buildItems = (sub: number, inclSub?: number, exclSub?: number) => {
      const items: Array<{ price: number; quantity: number; isTaxInclusive: boolean; modifiers: never[] }> = []
      if (hasTaxInclusive && inclSub !== undefined && exclSub !== undefined) {
        if (inclSub > 0) items.push({ price: inclSub, quantity: 1, isTaxInclusive: true, modifiers: [] })
        if (exclSub > 0) items.push({ price: exclSub, quantity: 1, isTaxInclusive: false, modifiers: [] })
      } else if (sub > 0) {
        items.push({ price: sub, quantity: 1, isTaxInclusive: false, modifiers: [] })
      }
      return items
    }

    const locationSettings = { tax: { defaultRate: taxRate * 100 } }

    // 4. Calculate cash totals
    const cashInclSub = options.inclusiveSubtotal || 0
    const cashExclSub = options.exclusiveSubtotal || 0
    const cashItems = buildItems(cashSubtotal, cashInclSub, cashExclSub)
    const cashResult = calculateOrderTotals(cashItems, locationSettings, dollarDiscounts, tip, priceRounding, 'cash')

    // 5. Calculate card totals (apply surcharge to subtotals)
    let cardInclSub = cashInclSub
    let cardExclSub = cashExclSub
    if (dualPricing.enabled) {
      cardInclSub = cashInclSub > 0 ? calculateCardPrice(cashInclSub, discountPct) : 0
      cardExclSub = cashExclSub > 0 ? calculateCardPrice(cashExclSub, discountPct) : 0
    }
    const cardItems = buildItems(cardSubtotal, cardInclSub, cardExclSub)
    const cardResult = calculateOrderTotals(cardItems, locationSettings, dollarDiscounts, tip, priceRounding, 'card')

    // 6. Pick active result based on payment method
    const active = paymentMethod === 'cash' ? cashResult : cardResult
    const displaySubtotal = paymentMethod === 'cash' ? cashSubtotal : cardSubtotal

    // Cash discount amount (only when paying cash and dual pricing enabled)
    const cashDiscountAmount = dualPricing.enabled && paymentMethod === 'cash'
      ? roundToCents(cardSubtotal - cashSubtotal)
      : 0

    // 7. Compute surcharge amount (surcharge model only, card payments only)
    let surchargeAmount = 0
    if (
      pricingProgram.model === 'surcharge' &&
      pricingProgram.enabled &&
      paymentMethod !== 'cash'
    ) {
      surchargeAmount = calculateSurcharge(displaySubtotal, pricingProgram.surchargePercent ?? 0)
    }

    return {
      subtotal: displaySubtotal,
      cashSubtotal,
      cardSubtotal,
      cashDiscount: cashDiscountAmount,
      discounts: dollarDiscounts,
      taxableAmount: roundToCents(displaySubtotal - cashDiscountAmount - dollarDiscounts),
      tax: active.taxTotal,
      tip,
      total: active.total,
      totalBeforeRounding: active.totalBeforeRounding,
      roundingDelta: active.roundingDelta,
      cashTotal: cashResult.total,
      cardTotal: cardResult.total,
      cashTax: cashResult.taxTotal,
      cardTax: cardResult.taxTotal,
      cashRoundingDelta: cashResult.roundingDelta,
      cardRoundingDelta: cardResult.roundingDelta,
      surchargeAmount,
    }
  }, [
    options.subtotal,
    options.inclusiveSubtotal,
    options.exclusiveSubtotal,
    options.discountTotal,
    options.tipTotal,
    paymentMethod,
    dualPricing,
    taxRate,
    priceRounding,
    hasTaxInclusive,
    pricingProgram,
  ])

  // Savings message - only show when paying with card and dual pricing is enabled
  const savingsMessage = dualPricing.enabled && paymentMethod === 'card'
    ? formatSavingsMessage(calculated.cashTotal, calculated.cardTotal)
    : ''

  return {
    ...calculated,
    taxRate,
    dualPricing,
    priceRounding,
    isDualPricingEnabled: dualPricing.enabled,
    isLoading,
    savingsMessage,
    cashDiscountRate: dualPricing.cashDiscountPercent || 4.0,
    pricingProgram,
  }
}
