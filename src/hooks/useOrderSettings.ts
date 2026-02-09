'use client'

import { useState, useEffect } from 'react'
import type { DualPricingSettings, PaymentSettings, PriceRoundingSettings, ReceiptSettings } from '@/lib/settings'

const DEFAULT_DUAL_PRICING: DualPricingSettings = {
  enabled: true,
  cashDiscountPercent: 4.0,
  applyToCredit: true,
  applyToDebit: true,
  showSavingsMessage: true,
}

const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  acceptCash: true,
  acceptCredit: true,
  acceptDebit: true,
  acceptGiftCards: false,
  acceptHouseAccounts: false,
  cashRounding: 'none',
  roundingDirection: 'nearest',
  enablePreAuth: true,
  defaultPreAuthAmount: 50,
  preAuthExpirationDays: 7,
  processor: 'simulated',
  testMode: true,
  readerTimeoutSeconds: 30,
  autoSwapOnFailure: true,
}

const DEFAULT_PRICE_ROUNDING: PriceRoundingSettings = {
  enabled: false,
  increment: 'none',
  direction: 'nearest',
  applyToCash: true,
  applyToCard: false,
}

export function useOrderSettings() {
  const [dualPricing, setDualPricing] = useState<DualPricingSettings>(DEFAULT_DUAL_PRICING)
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings>(DEFAULT_PAYMENT_SETTINGS)
  const [priceRounding, setPriceRounding] = useState<PriceRoundingSettings>(DEFAULT_PRICE_ROUNDING)
  const [taxRate, setTaxRate] = useState(0.08)
  const [taxInclusiveLiquor, setTaxInclusiveLiquor] = useState(false)
  const [taxInclusiveFood, setTaxInclusiveFood] = useState(false)
  const [receiptSettings, setReceiptSettings] = useState<Partial<ReceiptSettings>>({})
  const [isLoading, setIsLoading] = useState(true)

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/settings')
      if (response.ok) {
        const data = await response.json()
        const settings = data.settings || data

        if (settings.dualPricing) {
          setDualPricing(settings.dualPricing)
        }
        if (settings.priceRounding) {
          setPriceRounding(settings.priceRounding)
        }
        if (settings.tax?.defaultRate) {
          setTaxRate(settings.tax.defaultRate / 100)
        }
        if (settings.tax?.taxInclusiveLiquor !== undefined) {
          setTaxInclusiveLiquor(settings.tax.taxInclusiveLiquor)
        }
        if (settings.tax?.taxInclusiveFood !== undefined) {
          setTaxInclusiveFood(settings.tax.taxInclusiveFood)
        }
        if (settings.payments) {
          setPaymentSettings(settings.payments)
        }
        if (settings.receipts) {
          setReceiptSettings(settings.receipts)
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadSettings()
  }, [])

  return {
    dualPricing,
    paymentSettings,
    priceRounding,
    taxRate,
    taxInclusiveLiquor,
    taxInclusiveFood,
    receiptSettings,
    isLoading,
    reloadSettings: loadSettings,
  }
}
