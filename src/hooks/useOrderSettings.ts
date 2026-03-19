'use client'

import { useState, useEffect, useRef } from 'react'
import type { DualPricingSettings, PaymentSettings, PriceRoundingSettings, ReceiptSettings, PricingProgram, AgeVerificationSettings, BarOperationsSettings } from '@/lib/settings'
import { getPricingProgram, DEFAULT_AGE_VERIFICATION, DEFAULT_BAR_OPERATIONS } from '@/lib/settings'
import { useOrderStore } from '@/stores/order-store'
import { setLocationTaxRate } from '@/lib/seat-utils'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'

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
  acceptHotelRoomCharge: false,
  cashRounding: 'none',
  roundingDirection: 'nearest',
  enablePreAuth: true,
  defaultPreAuthAmount: 50,
  preAuthExpirationDays: 7,
  processor: 'none',
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
  // Customer Split
  allowCustomerSplit: true,
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

// Module-level cache — shared across all useOrderSettings() consumers
type SendBehavior = 'stay' | 'return_to_floor' | 'return_to_orders'

interface SettingsCache {
  dualPricing: DualPricingSettings
  paymentSettings: PaymentSettings
  priceRounding: PriceRoundingSettings
  taxRate: number
  inclusiveTaxRate: number
  taxInclusiveLiquor: boolean
  taxInclusiveFood: boolean
  receiptSettings: Partial<ReceiptSettings>
  requireCardForTab: boolean
  allowNameOnlyTab: boolean
  pricingProgram: PricingProgram
  ageVerification: AgeVerificationSettings
  sendBehavior: SendBehavior
  barOperations: BarOperationsSettings
}

const DEFAULT_PRICING_PROGRAM: PricingProgram = { model: 'none', enabled: false }
let cachedSettings: SettingsCache | null = null
let cacheTime = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
let inflight: Promise<SettingsCache | null> | null = null

export function useOrderSettings() {
  const [dualPricing, setDualPricing] = useState<DualPricingSettings>(
    cachedSettings?.dualPricing ?? DEFAULT_DUAL_PRICING
  )
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings>(
    cachedSettings?.paymentSettings ?? DEFAULT_PAYMENT_SETTINGS
  )
  const [priceRounding, setPriceRounding] = useState<PriceRoundingSettings>(
    cachedSettings?.priceRounding ?? DEFAULT_PRICE_ROUNDING
  )
  const [taxRate, setTaxRate] = useState(cachedSettings?.taxRate ?? 0)
  const [inclusiveTaxRate, setInclusiveTaxRate] = useState(cachedSettings?.inclusiveTaxRate ?? 0)
  const [taxInclusiveLiquor, setTaxInclusiveLiquor] = useState(cachedSettings?.taxInclusiveLiquor ?? false)
  const [taxInclusiveFood, setTaxInclusiveFood] = useState(cachedSettings?.taxInclusiveFood ?? false)
  const [receiptSettings, setReceiptSettings] = useState<Partial<ReceiptSettings>>(
    cachedSettings?.receiptSettings ?? {}
  )
  const [requireCardForTab, setRequireCardForTab] = useState(cachedSettings?.requireCardForTab ?? false)
  const [allowNameOnlyTab, setAllowNameOnlyTab] = useState(cachedSettings?.allowNameOnlyTab ?? true)
  const [pricingProgram, setPricingProgram] = useState<PricingProgram>(
    cachedSettings?.pricingProgram ?? DEFAULT_PRICING_PROGRAM
  )
  const [ageVerification, setAgeVerification] = useState<AgeVerificationSettings>(
    cachedSettings?.ageVerification ?? DEFAULT_AGE_VERIFICATION
  )
  const [sendBehavior, setSendBehavior] = useState<SendBehavior>(
    cachedSettings?.sendBehavior ?? 'return_to_floor'
  )
  const [barOperations, setBarOperations] = useState<BarOperationsSettings>(
    cachedSettings?.barOperations ?? DEFAULT_BAR_OPERATIONS
  )
  const [isLoading, setIsLoading] = useState(!cachedSettings)

  const applySettings = (settings: {
    dualPricing?: DualPricingSettings
    payments?: PaymentSettings
    priceRounding?: PriceRoundingSettings
    tax?: { defaultRate?: number; inclusiveTaxRate?: number; taxInclusiveLiquor?: boolean; taxInclusiveFood?: boolean }
    receipts?: Partial<ReceiptSettings>
    barTabs?: { requireCardForTab?: boolean; allowNameOnlyTab?: boolean }
    pricingProgram?: PricingProgram
    ageVerification?: AgeVerificationSettings
    sendBehavior?: SendBehavior
    barOperations?: BarOperationsSettings
  }) => {
    const effectiveDualPricing = settings.dualPricing || DEFAULT_DUAL_PRICING
    const derivedPricingProgram = settings.pricingProgram
      ? settings.pricingProgram
      : getPricingProgram({ dualPricing: effectiveDualPricing } as Parameters<typeof getPricingProgram>[0])
    const result: SettingsCache = {
      dualPricing: effectiveDualPricing,
      paymentSettings: settings.payments || DEFAULT_PAYMENT_SETTINGS,
      priceRounding: settings.priceRounding || DEFAULT_PRICE_ROUNDING,
      taxRate: 0,
      inclusiveTaxRate: 0,
      taxInclusiveLiquor: false,
      taxInclusiveFood: false,
      receiptSettings: settings.receipts || {},
      requireCardForTab: settings.barTabs?.requireCardForTab ?? false,
      allowNameOnlyTab: settings.barTabs?.allowNameOnlyTab ?? true,
      pricingProgram: derivedPricingProgram,
      ageVerification: settings.ageVerification ?? DEFAULT_AGE_VERIFICATION,
      sendBehavior: settings.sendBehavior ?? 'return_to_floor',
      barOperations: settings.barOperations ? { ...DEFAULT_BAR_OPERATIONS, ...settings.barOperations } : DEFAULT_BAR_OPERATIONS,
    }

    if (typeof settings.tax?.defaultRate === 'number' && settings.tax.defaultRate >= 0) {
      result.taxRate = settings.tax.defaultRate / 100
    }
    if (typeof settings.tax?.inclusiveTaxRate === 'number' && settings.tax.inclusiveTaxRate > 0) {
      result.inclusiveTaxRate = settings.tax.inclusiveTaxRate / 100
    }
    if (settings.tax?.taxInclusiveLiquor !== undefined) {
      result.taxInclusiveLiquor = settings.tax.taxInclusiveLiquor
    }
    if (settings.tax?.taxInclusiveFood !== undefined) {
      result.taxInclusiveFood = settings.tax.taxInclusiveFood
    }

    // Push to order store so calculateTotals() uses real location rate
    useOrderStore.getState().setEstimatedTaxRate(result.taxRate)
    // Push to seat-utils so seat balance calculations use real rate
    setLocationTaxRate(result.taxRate)

    // Update module cache
    cachedSettings = result
    cacheTime = Date.now()

    // Update component state
    setDualPricing(result.dualPricing)
    setPaymentSettings(result.paymentSettings)
    setPriceRounding(result.priceRounding)
    setTaxRate(result.taxRate)
    setInclusiveTaxRate(result.inclusiveTaxRate)
    setTaxInclusiveLiquor(result.taxInclusiveLiquor)
    setTaxInclusiveFood(result.taxInclusiveFood)
    setReceiptSettings(result.receiptSettings)
    setRequireCardForTab(result.requireCardForTab)
    setAllowNameOnlyTab(result.allowNameOnlyTab)
    setPricingProgram(result.pricingProgram)
    setAgeVerification(result.ageVerification)
    setSendBehavior(result.sendBehavior)
    setBarOperations(result.barOperations)
  }

  const loadSettings = async () => {
    // Check module cache (skip on explicit reload)
    if (cachedSettings && Date.now() - cacheTime < CACHE_TTL) {
      applySettings({
        dualPricing: cachedSettings.dualPricing,
        payments: cachedSettings.paymentSettings,
        priceRounding: cachedSettings.priceRounding,
        tax: {
          defaultRate: cachedSettings.taxRate * 100,
          inclusiveTaxRate: cachedSettings.inclusiveTaxRate * 100,
          taxInclusiveLiquor: cachedSettings.taxInclusiveLiquor,
          taxInclusiveFood: cachedSettings.taxInclusiveFood,
        },
        receipts: cachedSettings.receiptSettings,
        barTabs: { requireCardForTab: cachedSettings.requireCardForTab, allowNameOnlyTab: cachedSettings.allowNameOnlyTab },
        pricingProgram: cachedSettings.pricingProgram,
        ageVerification: cachedSettings.ageVerification,
        sendBehavior: cachedSettings.sendBehavior,
        barOperations: cachedSettings.barOperations,
      })
      setIsLoading(false)
      return
    }

    // Deduplicate concurrent fetches
    if (inflight) {
      const result = await inflight
      if (result) {
        applySettings({
          dualPricing: result.dualPricing,
          payments: result.paymentSettings,
          priceRounding: result.priceRounding,
          tax: {
            defaultRate: result.taxRate * 100,
            taxInclusiveLiquor: result.taxInclusiveLiquor,
            taxInclusiveFood: result.taxInclusiveFood,
          },
          receipts: result.receiptSettings,
          barTabs: { requireCardForTab: result.requireCardForTab, allowNameOnlyTab: result.allowNameOnlyTab },
          pricingProgram: result.pricingProgram,
          ageVerification: result.ageVerification,
          sendBehavior: result.sendBehavior,
          barOperations: result.barOperations,
        })
      }
      setIsLoading(false)
      return
    }

    const fetchPromise = (async () => {
      try {
        const response = await fetch('/api/settings')
        if (response.ok) {
          const raw = await response.json()
          const data = raw.data ?? raw
          const settings = data.settings || data
          applySettings(settings)
          return cachedSettings
        }
      } catch (error) {
        console.error('Failed to load settings:', error)
      } finally {
        setIsLoading(false)
        inflight = null
      }
      return null
    })()
    inflight = fetchPromise
    await fetchPromise
  }

  const forceReload = async () => {
    // Bust cache for explicit reloads
    cachedSettings = null
    cacheTime = 0
    await loadSettings()
  }

  // Track forceReload ref so the socket handler always calls the latest version
  const forceReloadRef = useRef(forceReload)
  forceReloadRef.current = forceReload

  useEffect(() => {
    loadSettings()

    // Auto-refresh when tax rules or settings change on the server
    const socket = getSharedSocket() as { on: (e: string, cb: (...args: unknown[]) => void) => void; off: (e: string, cb?: (...args: unknown[]) => void) => void } | null
    const handler = () => {
      // Bust cache so next render gets fresh settings (tax rates, inclusive flags, etc.)
      cachedSettings = null
      cacheTime = 0
      forceReloadRef.current()
    }
    socket?.on('settings:updated', handler)
    return () => {
      socket?.off('settings:updated', handler)
      releaseSharedSocket()
    }
  }, [])

  return {
    dualPricing,
    paymentSettings,
    priceRounding,
    taxRate,
    inclusiveTaxRate,
    taxInclusiveLiquor,
    taxInclusiveFood,
    receiptSettings,
    requireCardForTab,
    allowNameOnlyTab,
    pricingProgram,
    ageVerification,
    sendBehavior,
    barOperations,
    isLoading,
    reloadSettings: forceReload,
  }
}
