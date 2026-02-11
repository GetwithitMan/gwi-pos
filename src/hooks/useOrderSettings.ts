'use client'

import { useState, useEffect } from 'react'
import type { DualPricingSettings, PaymentSettings, PriceRoundingSettings, ReceiptSettings } from '@/lib/settings'
import { useOrderStore } from '@/stores/order-store'
import { setLocationTaxRate } from '@/lib/seat-utils'

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
  // Bar Tab Pre-Auth
  incrementThresholdPercent: 80,
  incrementAmount: 25,
  autoIncrementEnabled: true,
  incrementTipBufferPercent: 25,
  maxTabAlertAmount: 500,
  // Quick Pay / Tip
  quickPayEnabled: true,
  tipDollarAmountThreshold: 15,
  tipDollarSuggestions: [1, 2, 3],
  tipPercentSuggestions: [18, 20, 25],
  requireCustomForZeroTip: true,
  // Walkout Recovery
  walkoutRetryEnabled: true,
  walkoutRetryFrequencyDays: 3,
  walkoutMaxRetryDays: 30,
  walkoutAutoDetectMinutes: 120,
  // Card Recognition
  cardRecognitionEnabled: true,
  cardRecognitionToastEnabled: true,
  // Signature
  requireSignatureAbove: 25,
  // Bottle Service
  bottleServiceEnabled: false,
  bottleServiceAutoGratuityPercent: 20,
  bottleServiceReAuthAlertEnabled: true,
  bottleServiceMinSpendEnforced: false,
  // Digital Receipts
  digitalReceiptRetentionDays: 90,
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
  const [taxRate, setTaxRate] = useState(0)
  const [taxInclusiveLiquor, setTaxInclusiveLiquor] = useState(false)
  const [taxInclusiveFood, setTaxInclusiveFood] = useState(false)
  const [receiptSettings, setReceiptSettings] = useState<Partial<ReceiptSettings>>({})
  const [requireCardForTab, setRequireCardForTab] = useState(false)
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
        if (typeof settings.tax?.defaultRate === 'number' && settings.tax.defaultRate >= 0) {
          const rate = settings.tax.defaultRate / 100
          setTaxRate(rate)
          // Push to order store so calculateTotals() uses real location rate
          useOrderStore.getState().setEstimatedTaxRate(rate)
          // Push to seat-utils so seat balance calculations use real rate
          setLocationTaxRate(rate)
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
        if (settings.barTabs?.requireCardForTab !== undefined) {
          setRequireCardForTab(settings.barTabs.requireCardForTab)
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
    requireCardForTab,
    isLoading,
    reloadSettings: loadSettings,
  }
}
