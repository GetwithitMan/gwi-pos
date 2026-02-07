'use client'

import { useMemo } from 'react'
import { useOrderSettings } from '@/hooks/useOrderSettings'
import {
  calculateCardPrice,
  applyPriceRounding,
  formatSavingsMessage,
} from '@/lib/pricing'
import type { DualPricingSettings, PriceRoundingSettings } from '@/lib/settings'

interface UsePricingOptions {
  // Raw order values (from store or local state)
  subtotal: number           // Sum of item prices (stored as cash prices in DB)
  discountTotal?: number     // Dollar discounts applied
  tipTotal?: number          // Gratuity amount

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
}

export function usePricing(options: UsePricingOptions = { subtotal: 0 }): UsePricingReturn {
  const { dualPricing, taxRate, priceRounding, isLoading } = useOrderSettings()

  const paymentMethod = options.paymentMethod || 'card'

  const calculated = useMemo(() => {
    // 1. Start with stored subtotal (cash prices in DB)
    const storedSubtotal = options.subtotal || 0

    // 2. Calculate card price if dual pricing enabled
    const discountPct = dualPricing.cashDiscountPercent || 4.0
    const cardSubtotal = dualPricing.enabled
      ? calculateCardPrice(storedSubtotal, discountPct)
      : storedSubtotal
    const cashSubtotal = storedSubtotal

    // 3. Calculate cash discount based on payment method
    const cashDiscountAmount = dualPricing.enabled && paymentMethod === 'cash'
      ? cardSubtotal - storedSubtotal
      : 0

    // 4. The display subtotal depends on payment method
    //    Card: show card price (higher)
    //    Cash: show cash price (lower, because discount applied)
    const displaySubtotal = paymentMethod === 'cash' ? cashSubtotal : cardSubtotal

    // 5. Apply dollar discounts
    const dollarDiscounts = options.discountTotal || 0

    // 6. Calculate taxable amount
    const taxableAmount = displaySubtotal - cashDiscountAmount - dollarDiscounts

    // 7. Calculate tax
    const taxAmount = Math.round(taxableAmount * taxRate * 100) / 100

    // 8. Add tip
    const tip = options.tipTotal || 0

    // 9. Calculate total before rounding
    const totalBeforeRounding = taxableAmount + taxAmount + tip

    // 10. Apply price rounding
    const total = applyPriceRounding(totalBeforeRounding, priceRounding, paymentMethod)

    return {
      subtotal: displaySubtotal,
      cashSubtotal,
      cardSubtotal,
      cashDiscount: cashDiscountAmount,
      discounts: dollarDiscounts,
      taxableAmount,
      tax: taxAmount,
      tip,
      total,
      totalBeforeRounding,
    }
  }, [
    options.subtotal,
    options.discountTotal,
    options.tipTotal,
    paymentMethod,
    dualPricing,
    taxRate,
    priceRounding,
  ])

  // Savings message - only show when paying with card and dual pricing is enabled
  const savingsMessage = dualPricing.enabled && paymentMethod === 'card'
    ? formatSavingsMessage(calculated.cashSubtotal + calculated.tax, calculated.cardSubtotal + calculated.tax)
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
  }
}
