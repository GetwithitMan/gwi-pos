// Location Settings Types and Defaults
// Skill 09: Features & Config

export interface DualPricingSettings {
  enabled: boolean
  model: 'cash_discount' | 'card_surcharge'
  cardSurchargePercent: number
  applyToCredit: boolean
  applyToDebit: boolean
  showBothPrices: boolean
  showSavingsMessage: boolean
}

export interface TaxSettings {
  defaultRate: number
  calculateAfterDiscount: boolean
}

export interface TipSettings {
  enabled: boolean
  suggestedPercentages: number[]
  calculateOn: 'subtotal' | 'total'
}

export interface ReceiptSettings {
  headerText: string
  footerText: string
  showServerName: boolean
  showTableNumber: boolean
}

export interface PaymentSettings {
  // Payment methods
  acceptCash: boolean
  acceptCredit: boolean
  acceptDebit: boolean
  acceptGiftCards: boolean
  acceptHouseAccounts: boolean

  // Rounding (for cash)
  cashRounding: 'none' | 'nickel' | 'dime' | 'quarter' | 'dollar'
  roundingDirection: 'nearest' | 'up' | 'down'

  // Pre-auth (bar tabs)
  enablePreAuth: boolean
  defaultPreAuthAmount: number
  preAuthExpirationDays: number

  // Card processing (go-live)
  processor: 'none' | 'stripe' | 'square'
  testMode: boolean
}

export interface LocationSettings {
  tax: TaxSettings
  dualPricing: DualPricingSettings
  tips: TipSettings
  receipts: ReceiptSettings
  payments: PaymentSettings
}

// Default settings for new locations
export const DEFAULT_SETTINGS: LocationSettings = {
  tax: {
    defaultRate: 8.0,
    calculateAfterDiscount: true,
  },
  dualPricing: {
    enabled: true,
    model: 'card_surcharge',
    cardSurchargePercent: 4.0,
    applyToCredit: true,
    applyToDebit: true,
    showBothPrices: true,
    showSavingsMessage: true,
  },
  tips: {
    enabled: true,
    suggestedPercentages: [18, 20, 22, 25],
    calculateOn: 'subtotal',
  },
  receipts: {
    headerText: 'Thank you for your visit!',
    footerText: '',
    showServerName: true,
    showTableNumber: true,
  },
  payments: {
    acceptCash: true,
    acceptCredit: true,
    acceptDebit: true,
    acceptGiftCards: false,
    acceptHouseAccounts: false,
    cashRounding: 'none',
    roundingDirection: 'nearest',
    enablePreAuth: true,
    defaultPreAuthAmount: 100.00,
    preAuthExpirationDays: 7,
    processor: 'none',
    testMode: true,
  },
}

// Merge partial settings with defaults
export function mergeWithDefaults(partial: Partial<LocationSettings> | null | undefined): LocationSettings {
  if (!partial) return { ...DEFAULT_SETTINGS }

  return {
    tax: {
      ...DEFAULT_SETTINGS.tax,
      ...(partial.tax || {}),
    },
    dualPricing: {
      ...DEFAULT_SETTINGS.dualPricing,
      ...(partial.dualPricing || {}),
    },
    tips: {
      ...DEFAULT_SETTINGS.tips,
      ...(partial.tips || {}),
    },
    receipts: {
      ...DEFAULT_SETTINGS.receipts,
      ...(partial.receipts || {}),
    },
    payments: {
      ...DEFAULT_SETTINGS.payments,
      ...(partial.payments || {}),
    },
  }
}

// Parse settings from database JSON
export function parseSettings(json: unknown): LocationSettings {
  if (typeof json === 'string') {
    try {
      return mergeWithDefaults(JSON.parse(json))
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }
  return mergeWithDefaults(json as Partial<LocationSettings>)
}
