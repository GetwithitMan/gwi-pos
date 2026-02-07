// Location Settings Types and Defaults
// Skill 09: Features & Config

import type { GlobalReceiptSettings } from '@/types/receipt-settings'
import { DEFAULT_GLOBAL_RECEIPT_SETTINGS, mergeGlobalReceiptSettings } from '@/types/receipt-settings'
export type { GlobalReceiptSettings }

export interface DualPricingSettings {
  enabled: boolean
  cashDiscountPercent: number      // % discount for paying with cash (e.g., 4 = 4% off)
  applyToCredit: boolean           // Apply card pricing to credit cards
  applyToDebit: boolean            // Apply card pricing to debit cards
  showSavingsMessage: boolean      // Show "Save $X by paying with cash" message
}

export interface PriceRoundingSettings {
  enabled: boolean
  increment: 'none' | '0.05' | '0.10' | '0.25' | '0.50' | '1.00'  // Round to nearest X
  direction: 'nearest' | 'up' | 'down'   // Rounding direction
  applyToCash: boolean             // Apply rounding to cash payments (default: true)
  applyToCard: boolean             // Apply rounding to card payments (default: false)
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

export interface TipShareSettings {
  // Payout method
  payoutMethod: 'payroll' | 'manual'  // payroll = auto-added to payroll, manual = use report to pay out

  // Auto tip-out at closeout
  autoTipOutEnabled: boolean          // Enable automatic role-based tip-outs at shift closeout
  requireTipOutAcknowledgment: boolean // Server must acknowledge tip-out before completing closeout

  // Display settings
  showTipSharesOnReceipt: boolean     // Include tip share breakdown on shift receipt
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

  // Card processing
  processor: 'none' | 'simulated' | 'datacap'  // datacap = Datacap Direct integration
  testMode: boolean

  // Datacap Direct configuration
  datacapMerchantId?: string
  readerTimeoutSeconds: number     // Timeout for reader response (default: 30)
  autoSwapOnFailure: boolean       // Automatically offer reader swap when offline (default: true)

  // Bar Tab Pre-Auth (auto-increment)
  incrementThresholdPercent: number  // Fire IncrementalAuth when tab reaches this % of auth (default: 80)
  incrementAmount: number            // Fixed increment amount in dollars (default: 25)
  autoIncrementEnabled: boolean      // Enable background auto-increment (default: true)
  maxTabAlertAmount: number          // Alert manager when tab exceeds this amount (default: 500)

  // Quick Pay / Tip Configuration
  quickPayEnabled: boolean                   // Enable Quick Pay single-transaction mode (default: true)
  tipDollarAmountThreshold: number           // Under this amount, show dollar tips (default: 15)
  tipDollarSuggestions: number[]             // Dollar suggestions for under-threshold (default: [1, 2, 3])
  tipPercentSuggestions: number[]            // Percent suggestions for over-threshold (default: [18, 20, 25])
  requireCustomForZeroTip: boolean           // Must tap Custom to skip tip (default: true)

  // Walkout Recovery (Phase 6)
  walkoutRetryEnabled: boolean               // Enable auto-retry for walkout tabs (default: true)
  walkoutRetryFrequencyDays: number          // Days between retry attempts (default: 3)
  walkoutMaxRetryDays: number                // Stop retrying after this many days (default: 30)
  walkoutAutoDetectMinutes: number           // Auto-detect walkout if tab idle for N minutes (default: 120)

  // Card Recognition (Phase 8)
  cardRecognitionEnabled: boolean            // Enable repeat customer tracking by card (default: true)
  cardRecognitionToastEnabled: boolean       // Show welcome-back toast to bartender (default: true)

  // Digital Receipts (Phase 7)
  digitalReceiptRetentionDays: number        // Local retention before cloud archive (default: 90)
  requireSignatureAbove: number              // Require signature for amounts above this (default: 25)

  // Bottle Service (Phase 10)
  bottleServiceEnabled: boolean              // Enable bottle service tab type (default: false)
  bottleServiceAutoGratuityPercent: number   // Default auto-gratuity for bottle service (default: 20)
  bottleServiceReAuthAlertEnabled: boolean   // Alert bartender when tab reaches deposit amount (default: true)
  bottleServiceMinSpendEnforced: boolean     // Require manager override to close under minimum (default: false)
}

export interface LoyaltySettings {
  // Master switch
  enabled: boolean

  // Points earning
  pointsPerDollar: number          // e.g., 1 point per $1 spent
  earnOnSubtotal: boolean          // true = before tax, false = after tax
  earnOnTips: boolean              // include tips in earning calculation
  minimumEarnAmount: number        // minimum order to earn points (e.g., $5)

  // Points redemption
  redemptionEnabled: boolean       // allow using points for payment
  pointsPerDollarRedemption: number // e.g., 100 points = $1
  minimumRedemptionPoints: number  // minimum points to redeem (e.g., 100)
  maximumRedemptionPercent: number // max % of order payable with points (e.g., 50)

  // Rewards/Tiers (optional)
  showPointsOnReceipt: boolean
  welcomeBonus: number             // points given when customer is created
}

export interface HappyHourSchedule {
  dayOfWeek: number[]              // 0-6, Sunday-Saturday
  startTime: string                // HH:MM format
  endTime: string                  // HH:MM format
}

export interface HappyHourSettings {
  // Master switch
  enabled: boolean
  name: string                     // Display name, e.g., "Happy Hour" or "Early Bird"

  // Schedule
  schedules: HappyHourSchedule[]   // Multiple schedules supported

  // Pricing
  discountType: 'percent' | 'fixed' // Discount type
  discountValue: number            // Percent off (e.g., 20) or fixed amount (e.g., 2)
  appliesTo: 'all' | 'categories' | 'items' // What it applies to
  categoryIds: string[]            // If appliesTo is 'categories'
  itemIds: string[]                // If appliesTo is 'items'

  // Display
  showBadge: boolean               // Show "Happy Hour" badge on items
  showOriginalPrice: boolean       // Show original price crossed out
}

export interface BarTabSettings {
  // Card Requirements
  requireCardForTab: boolean           // Require credit card to start a tab
  pullCustomerFromCard: boolean        // Auto-fill customer name from card holder
  allowNameOnlyTab: boolean            // Allow tabs with just a name (no card)

  // Tab Management
  tabTimeoutMinutes: number            // Show timeout warning after X minutes of inactivity
}

export interface POSDisplaySettings {
  // Menu Item Sizing
  menuItemSize: 'compact' | 'normal' | 'large'
  menuItemsPerRow: 3 | 4 | 5 | 6

  // Category Button Sizing
  categorySize: 'sm' | 'md' | 'lg'

  // Order Panel
  orderPanelWidth: 'narrow' | 'normal' | 'wide'

  // Color Theme
  categoryColorMode: 'solid' | 'subtle' | 'outline'

  // Custom Button Colors (optional - null/undefined means use defaults)
  categoryButtonBgColor?: string | null      // Custom background color for buttons
  categoryButtonTextColor?: string | null    // Custom text color for buttons

  // Quick Settings
  showPriceOnMenuItems: boolean
}

// Custom colors for individual category buttons
export interface CategoryColorOverride {
  bgColor?: string | null              // Selected button background
  textColor?: string | null            // Selected button text
  unselectedBgColor?: string | null    // Unselected button background (makes buttons pop)
  unselectedTextColor?: string | null  // Unselected button text
}

// Custom styling for individual menu item buttons
export type PopEffect = 'none' | 'glow' | 'larger' | 'border' | 'all'

export interface MenuItemCustomization {
  bgColor?: string | null        // Background color
  textColor?: string | null      // Text color
  popEffect?: PopEffect | null   // Pop effect type
  glowColor?: string | null      // Custom glow color (defaults to bgColor if not set)
}

// POS Layout Settings - stored per-employee for personal customization
// or per-location for global defaults (admin only)
export interface POSLayoutSettings {
  // Current Mode
  currentMode: 'bar' | 'food'
  defaultMode: 'bar' | 'food'           // What mode to start in
  rememberLastMode: boolean             // Remember last used mode on login

  // Favorites (per mode) - array of menu item IDs
  barFavorites: string[]
  foodFavorites: string[]
  maxFavorites: number                  // Max items in favorites bar (default: 8)

  // Quick Bar - personal quick access bar (mode-independent)
  // Displayed above category bar for fast access to frequently used items
  quickBar: string[]                    // Array of menuItemIds
  quickBarEnabled: boolean              // Show/hide quick bar
  maxQuickBarItems: number              // Max items in quick bar (default: 12)

  // Category Order (per mode) - array of category IDs in display order
  // Empty array = use default alphabetical/sortOrder
  barCategoryOrder: string[]
  foodCategoryOrder: string[]

  // Category visibility - which categories to show/hide per mode
  // Empty array = show all
  barHiddenCategories: string[]
  foodHiddenCategories: string[]

  // Custom category colors (per category ID)
  // Allows employees to personalize individual category button colors
  categoryColors: { [categoryId: string]: CategoryColorOverride }

  // Custom menu item styling (per menu item ID)
  // Allows employees to personalize individual menu item buttons
  menuItemColors: { [menuItemId: string]: MenuItemCustomization }

  // UI Preferences
  showFavoritesBar: boolean             // Show/hide favorites bar
  compactCategoryBar: boolean           // Single row with overflow vs wrap
  autoCollapseCategories: boolean       // Collapse "other" categories into dropdown

  // Quick Pick Numbers — per-employee toggle
  quickPickEnabled: boolean             // Show number strip (1-9) for fast quantity setting

  // Coursing — per-employee settings
  coursingCourseCount: number           // How many course buttons to show (default: 5)
  coursingDefaultDelay: number          // Default delay minutes for new courses (0 = fire immediately)
}

// Default layout settings
export const DEFAULT_LAYOUT_SETTINGS: POSLayoutSettings = {
  currentMode: 'bar',
  defaultMode: 'bar',
  rememberLastMode: true,

  barFavorites: [],
  foodFavorites: [],
  maxFavorites: 8,

  quickBar: [],
  quickBarEnabled: true,
  maxQuickBarItems: 12,

  barCategoryOrder: [],
  foodCategoryOrder: [],

  barHiddenCategories: [],
  foodHiddenCategories: [],

  categoryColors: {},
  menuItemColors: {},

  showFavoritesBar: true,
  compactCategoryBar: true,
  autoCollapseCategories: true,

  quickPickEnabled: false,

  coursingCourseCount: 5,
  coursingDefaultDelay: 0,
}

export interface LocationSettings {
  tax: TaxSettings
  dualPricing: DualPricingSettings
  priceRounding: PriceRoundingSettings
  tips: TipSettings
  tipShares: TipShareSettings
  receipts: ReceiptSettings
  payments: PaymentSettings
  loyalty: LoyaltySettings
  happyHour: HappyHourSettings
  barTabs: BarTabSettings
  posDisplay: POSDisplaySettings
  receiptDisplay: GlobalReceiptSettings  // Controls WHAT features are available in the Visual Editor
}

// Default settings for new locations
export const DEFAULT_SETTINGS: LocationSettings = {
  tax: {
    defaultRate: 8.0,
    calculateAfterDiscount: true,
  },
  dualPricing: {
    enabled: true,
    cashDiscountPercent: 4.0,       // 4% discount for cash payments
    applyToCredit: true,
    applyToDebit: true,
    showSavingsMessage: true,
  },
  priceRounding: {
    enabled: false,
    increment: 'none',              // none, 0.05, 0.10, 0.25, 0.50, 1.00
    direction: 'nearest',           // nearest, up, down
    applyToCash: true,              // Apply to cash payments
    applyToCard: false,             // Apply to card payments
  },
  tips: {
    enabled: true,
    suggestedPercentages: [18, 20, 22, 25],
    calculateOn: 'subtotal',
  },
  tipShares: {
    payoutMethod: 'payroll',              // Default: tip shares go to payroll
    autoTipOutEnabled: true,              // Auto tip-out based on rules
    requireTipOutAcknowledgment: true,    // Server must acknowledge tip-out
    showTipSharesOnReceipt: true,         // Show on shift receipt
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
    processor: 'simulated',        // 'none' | 'simulated' | 'datacap'
    testMode: true,
    readerTimeoutSeconds: 30,
    autoSwapOnFailure: true,
    // Bar Tab Pre-Auth
    incrementThresholdPercent: 80,
    incrementAmount: 25,
    autoIncrementEnabled: true,
    maxTabAlertAmount: 500,
    // Quick Pay / Tips
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
    // Digital Receipts
    digitalReceiptRetentionDays: 90,
    requireSignatureAbove: 25,
    // Bottle Service
    bottleServiceEnabled: false,
    bottleServiceAutoGratuityPercent: 20,
    bottleServiceReAuthAlertEnabled: true,
    bottleServiceMinSpendEnforced: false,
  },
  loyalty: {
    enabled: false,
    pointsPerDollar: 1,
    earnOnSubtotal: true,
    earnOnTips: false,
    minimumEarnAmount: 0,
    redemptionEnabled: true,
    pointsPerDollarRedemption: 100,
    minimumRedemptionPoints: 100,
    maximumRedemptionPercent: 50,
    showPointsOnReceipt: true,
    welcomeBonus: 0,
  },
  happyHour: {
    enabled: false,
    name: 'Happy Hour',
    schedules: [
      {
        dayOfWeek: [1, 2, 3, 4, 5], // Monday-Friday
        startTime: '16:00',
        endTime: '18:00',
      },
    ],
    discountType: 'percent',
    discountValue: 20,
    appliesTo: 'all',
    categoryIds: [],
    itemIds: [],
    showBadge: true,
    showOriginalPrice: true,
  },
  barTabs: {
    requireCardForTab: false,        // Don't require card by default
    pullCustomerFromCard: true,      // Auto-fill name when card is used
    allowNameOnlyTab: true,          // Allow tabs with just a name
    tabTimeoutMinutes: 240,          // 4 hours default timeout warning
  },
  posDisplay: {
    menuItemSize: 'normal',
    menuItemsPerRow: 5,
    categorySize: 'md',
    orderPanelWidth: 'normal',
    categoryColorMode: 'solid',
    categoryButtonBgColor: null,
    categoryButtonTextColor: null,
    showPriceOnMenuItems: true,
  },
  receiptDisplay: DEFAULT_GLOBAL_RECEIPT_SETTINGS,
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
    priceRounding: {
      ...DEFAULT_SETTINGS.priceRounding,
      ...(partial.priceRounding || {}),
    },
    tips: {
      ...DEFAULT_SETTINGS.tips,
      ...(partial.tips || {}),
    },
    tipShares: {
      ...DEFAULT_SETTINGS.tipShares,
      ...(partial.tipShares || {}),
    },
    receipts: {
      ...DEFAULT_SETTINGS.receipts,
      ...(partial.receipts || {}),
    },
    payments: {
      ...DEFAULT_SETTINGS.payments,
      ...(partial.payments || {}),
    },
    loyalty: {
      ...DEFAULT_SETTINGS.loyalty,
      ...(partial.loyalty || {}),
    },
    happyHour: {
      ...DEFAULT_SETTINGS.happyHour,
      ...(partial.happyHour || {}),
      schedules: (partial.happyHour?.schedules?.length)
        ? partial.happyHour.schedules
        : DEFAULT_SETTINGS.happyHour.schedules,
    },
    barTabs: {
      ...DEFAULT_SETTINGS.barTabs,
      ...(partial.barTabs || {}),
    },
    posDisplay: {
      ...DEFAULT_SETTINGS.posDisplay,
      ...(partial.posDisplay || {}),
    },
    receiptDisplay: mergeGlobalReceiptSettings(partial.receiptDisplay),
  }
}

// Check if happy hour is currently active
export function isHappyHourActive(settings: HappyHourSettings): boolean {
  if (!settings.enabled) return false

  const now = new Date()
  const currentDay = now.getDay() // 0-6, Sunday-Saturday
  const currentTimeMinutes = now.getHours() * 60 + now.getMinutes()

  for (const schedule of settings.schedules) {
    if (!schedule.dayOfWeek.includes(currentDay)) continue

    const [startHour, startMin] = schedule.startTime.split(':').map(Number)
    const [endHour, endMin] = schedule.endTime.split(':').map(Number)

    const startMinutes = startHour * 60 + startMin
    const endMinutes = endHour * 60 + endMin

    // Handle overnight schedules (e.g., 22:00 - 02:00)
    if (endMinutes < startMinutes) {
      // Schedule spans midnight
      if (currentTimeMinutes >= startMinutes || currentTimeMinutes <= endMinutes) {
        return true
      }
    } else {
      // Normal schedule
      if (currentTimeMinutes >= startMinutes && currentTimeMinutes <= endMinutes) {
        return true
      }
    }
  }

  return false
}

// Calculate happy hour price for an item
export function getHappyHourPrice(
  originalPrice: number,
  settings: HappyHourSettings,
  itemId?: string,
  categoryId?: string
): { price: number; isDiscounted: boolean } {
  if (!settings.enabled || !isHappyHourActive(settings)) {
    return { price: originalPrice, isDiscounted: false }
  }

  // Check if item qualifies for happy hour
  let qualifies = false
  if (settings.appliesTo === 'all') {
    qualifies = true
  } else if (settings.appliesTo === 'categories' && categoryId) {
    qualifies = settings.categoryIds.includes(categoryId)
  } else if (settings.appliesTo === 'items' && itemId) {
    qualifies = settings.itemIds.includes(itemId)
  }

  if (!qualifies) {
    return { price: originalPrice, isDiscounted: false }
  }

  // Apply discount
  let discountedPrice: number
  if (settings.discountType === 'percent') {
    discountedPrice = originalPrice * (1 - settings.discountValue / 100)
  } else {
    discountedPrice = Math.max(0, originalPrice - settings.discountValue)
  }

  return {
    price: Math.round(discountedPrice * 100) / 100,
    isDiscounted: true,
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
