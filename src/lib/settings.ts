// Location Settings Types and Defaults
// Skill 09: Features & Config

import { type GlobalReceiptSettings, DEFAULT_GLOBAL_RECEIPT_SETTINGS, mergeGlobalReceiptSettings } from '@/types/print'
export type { GlobalReceiptSettings }

// ─── Pricing Program (T-080 Phase 1A) ────────────────────────────────────────

export interface PricingProgram {
  model: 'cash_discount' | 'surcharge' | 'flat_rate' | 'interchange_plus' | 'tiered' | 'none'
  enabled: boolean

  // Cash Discount fields (model === 'cash_discount')
  cashDiscountPercent?: number        // 0-10%
  applyToCredit?: boolean
  applyToDebit?: boolean
  showSavingsMessage?: boolean

  // Surcharge fields (model === 'surcharge')
  surchargePercent?: number           // 0-3% (Visa/MC cap)
  surchargeApplyToCredit?: boolean
  surchargeApplyToDebit?: boolean
  surchargeDisclosure?: string

  // Flat Rate fields (model === 'flat_rate')
  flatRatePercent?: number
  flatRatePerTxn?: number

  // Interchange Plus fields (model === 'interchange_plus')
  markupPercent?: number
  markupPerTxn?: number

  // Tiered fields (model === 'tiered')
  qualifiedRate?: number
  midQualifiedRate?: number
  nonQualifiedRate?: number
  tieredPerTxn?: number

  // State compliance
  venueState?: string
}

export const DEFAULT_PRICING_PROGRAM: PricingProgram = {
  model: 'none',
  enabled: false,
}

export function getPricingProgram(settings: LocationSettings): PricingProgram {
  // If new pricingProgram field exists and is enabled, use it
  if (settings.pricingProgram?.enabled) return settings.pricingProgram
  // Fall back to legacy dualPricing
  if (settings.dualPricing?.enabled) {
    return {
      model: 'cash_discount',
      enabled: true,
      cashDiscountPercent: settings.dualPricing.cashDiscountPercent,
      applyToCredit: settings.dualPricing.applyToCredit,
      applyToDebit: settings.dualPricing.applyToDebit,
      showSavingsMessage: settings.dualPricing.showSavingsMessage,
    }
  }
  // If pricingProgram exists but is disabled (e.g. model='none'), return it
  if (settings.pricingProgram) return settings.pricingProgram
  return DEFAULT_PRICING_PROGRAM
}

/**
 * Single source of truth for the active pricing model.
 * All pricing code, UI badges, and payment flows must call this — never read dualPricing or pricingProgram directly.
 * Precedence: pricingProgram.enabled > dualPricing.enabled > none
 */
export const effectivePricingProgram = getPricingProgram

// ─────────────────────────────────────────────────────────────────────────────

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
  taxInclusiveLiquor: boolean   // Liquor & alcohol prices include tax (categoryType: 'liquor', 'drinks')
  taxInclusiveFood: boolean     // Food prices include tax (categoryType: 'food', 'pizza', 'combos')
}

export interface TipSettings {
  enabled: boolean
  /** Canonical tip % suggestions used everywhere (POS prompt, Quick Pay, receipts). Integer percentages, 2-6 values, sorted ascending. */
  suggestedPercentages: number[]
  calculateOn: 'subtotal' | 'total'
  /** Canonical dollar tip suggestions shown when order subtotal is below dollarThreshold. Replaces payments.tipDollarSuggestions. */
  dollarSuggestions?: number[]
  /** Order subtotal below this amount shows dollar tip buttons instead of percent buttons. Replaces payments.tipDollarAmountThreshold. */
  dollarThreshold?: number
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

export interface TipBankSettings {
  enabled: boolean
  allocationMode: 'ITEM_BASED' | 'CHECK_BASED'
  chargebackPolicy: 'BUSINESS_ABSORBS' | 'EMPLOYEE_CHARGEBACK'
  allowNegativeBalances: boolean
  allowManagerInPools: boolean
  poolCashTips: boolean
  tipGuide: {
    basis: 'pre_discount' | 'gross_subtotal' | 'net_total' | 'custom'
    percentages: number[]
    showBasisExplanation: boolean
    roundTo: 'penny' | 'nickel' | 'dime' | 'quarter'
  }

  // CC Fee Deduction — deduct credit card processing fee from CC tips before crediting employee
  deductCCFeeFromTips: boolean       // If true, CC tips are reduced by ccFeePercent before ledger credit
  ccFeePercent: number               // Processing fee % (e.g., 3.0 = 3%). Only applied when deductCCFeeFromTips=true

  // EOD Tip Payout — controls tip cash-out behavior at shift close
  allowEODCashOut: boolean           // Show "Cash Out Tips" option at shift closeout
  requireManagerApprovalForCashOut: boolean  // Manager must approve cash payout at EOD
  defaultPayoutMethod: 'cash' | 'payroll'   // Default selection in closeout (employee can change)

  // Tip Group Attribution — when to credit a check to the active group/segment
  tipAttributionTiming: 'check_opened' | 'check_closed' | 'check_both' | 'per_item' // per_item = proportional by item: tip credited to segment active when each item was added
  // check_opened = group active when order was created gets credit
  // check_closed = group active when payment processes gets credit (default, best for bars)
  // check_both = proportional credit split between open-time and close-time groups
  // per_item = proportional by item: tip credited to segment active when each item was added

  /** When the last group member clocks out with open tabs still running, where do tips from those tabs go after they eventually close? */
  lateTabTipHandling: 'pool_period' | 'personal_bank'
  /** How is tip credit attributed within a segment when multiple employees served the check? */
  attributionModel: 'primary_100' | 'primary_70_assist_30'

  // Table Tip Ownership Mode
  // ITEM_BASED = each item's tip share goes to whoever rang it (default, helpers get credit)
  // PRIMARY_SERVER_OWNS_ALL = for dine-in, 100% of tip goes to primary server; helpers paid via tip-out rules
  tableTipOwnershipMode: 'ITEM_BASED' | 'PRIMARY_SERVER_OWNS_ALL'

  // Stand-alone Servers — allow employees to opt out of group pooling at clock-in
  allowStandaloneServers: boolean  // If true, "No Group (Keep My Own Tips)" option at clock-in

  // Ad-hoc Groups — whether employees can create their own groups outside admin templates
  allowEmployeeCreatedGroups: boolean  // If false, only admin-defined templates are used

  // No Tip Quick Button — show a "$0 Tip" button on the tip prompt screen
  noTipQuickButton: boolean  // If true, a "$0 Tip" button appears on the tip prompt (default: false)
}

export interface AutoGratuitySettings {
  enabled: boolean
  minimumPartySize: number       // Minimum guest count to trigger auto-gratuity (default: 6)
  percent: number                // Gratuity percentage (default: 18)
  allowRemoval: boolean          // Manager can remove the auto-gratuity (default: true)
}

export interface AutoRebootSettings {
  enabled: boolean
  delayMinutes: number
}

export interface AlertSettings {
  enabled: boolean
  largeVoidThreshold: number          // Dollar amount — void above this triggers alert (default: 50)
  largeDiscountThreshold: number      // Dollar amount — discount above this triggers alert (default: 50)
  frequentDiscountLimit: number       // Per employee per day — above this triggers alert (default: 10)
  overtimeWarningMinutes: number      // Minutes before overtime to warn (default: 30)
  cashDrawerAlertEnabled: boolean     // Alert on cash drawer events (default: true)
}

export interface SecuritySettings {
  requirePinAfterPayment: boolean      // Require PIN re-entry after each payment (default: false)
  idleLockMinutes: number              // Lock screen after N minutes idle, 0 = disabled (default: 0)
  enableBuddyPunchDetection: boolean   // Alert on suspicious clock events from different IPs (default: false)
  require2FAForLargeRefunds: boolean   // Require remote manager approval for refunds above threshold (default: false)
  refund2FAThreshold: number           // Refunds above this amount need 2FA ($) (default: 100)
  require2FAForLargeVoids: boolean     // Require remote manager approval for voids above threshold (default: false)
  void2FAThreshold: number             // Voids above this amount need remote 2FA ($) (default: 200)
}

export interface BusinessDaySettings {
  dayStartTime: string         // HH:MM format, default "04:00"
  enforceClockOut: boolean     // Force clock-out by day boundary (default: true)
  enforceTabClose: boolean     // Force tab close by day boundary (default: true)
  batchAtDayEnd: boolean       // Run daily batch at day boundary (default: true)
  graceMinutes: number         // Grace period after boundary (default: 15)
  warnBeforeClose: boolean     // Warn if open orders exist during EOD reset (default: true)
}

// ─── Break Compliance Settings ──────────────────────────────────────────────

export interface BreakComplianceSettings {
  complianceMode: 'off' | 'warn' | 'enforce'   // How to handle missing breaks (default: 'warn')
  minShiftForBreak: number                       // Hours — shifts longer than this require a break (default: 5)
  breakDurationMinutes: number                   // Minimum break duration in minutes (default: 30)
}

export const DEFAULT_BREAK_COMPLIANCE: BreakComplianceSettings = {
  complianceMode: 'warn',
  minShiftForBreak: 5,
  breakDurationMinutes: 30,
}

export const DEFAULT_AUTO_GRATUITY: AutoGratuitySettings = {
  enabled: false,
  minimumPartySize: 6,
  percent: 18,
  allowRemoval: true,
}

export interface ClockOutSettings {
  requireSettledBeforeClockOut: boolean   // Check for open tabs/orders before allowing clock-out
  requireTipsAdjusted: boolean           // Check for unadjusted tips before clock-out
  allowTransferOnClockOut: boolean       // Allow transferring tabs/orders to another employee
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
  acceptHotelRoomCharge: boolean   // Bill to Room via Oracle OPERA PMS

  // Rounding (for cash)
  cashRounding: 'none' | 'nickel' | 'dime' | 'quarter' | 'dollar'
  roundingDirection: 'nearest' | 'up' | 'down'

  // Pre-auth (bar tabs)
  enablePreAuth: boolean
  defaultPreAuthAmount: number
  preAuthExpirationDays: number

  // Card processing
  processor: 'none' | 'datacap'  // datacap = Datacap Direct integration
  testMode: boolean

  // Datacap Direct configuration (written by UPDATE_PAYMENT_CONFIG fleet command)
  datacapMerchantId?: string       // Datacap Merchant ID (MID)
  datacapTokenKey?: string         // Datacap AES token key (32-char hex)
  datacapEnvironment?: 'cert' | 'production'  // cert = Datacap testing, production = live
  readerTimeoutSeconds: number     // Timeout for reader response (default: 30)
  autoSwapOnFailure: boolean       // Automatically offer reader swap when offline (default: true)

  // Bar Tab Pre-Auth (auto-increment)
  incrementThresholdPercent: number  // Fire IncrementalAuth when tab reaches this % of auth (default: 80)
  incrementAmount: number            // Fixed increment amount in dollars (default: 25)
  autoIncrementEnabled: boolean      // Enable background auto-increment (default: true)
  incrementTipBufferPercent: number  // Extra % added to hold to cover potential tip (default: 25, 0 = disabled)
  maxTabAlertAmount: number          // Alert manager when tab exceeds this amount (default: 500)

  // Quick Pay / Tip Configuration
  quickPayEnabled: boolean                   // Enable Quick Pay single-transaction mode (default: true)
  /** @deprecated Use settings.tips.dollarThreshold as canonical source. v1.14: remove fallback. v1.15: delete. */
  tipDollarAmountThreshold: number           // Under this amount, show dollar tips (default: 15)
  /** @deprecated Use settings.tips.dollarSuggestions as canonical source. v1.14: remove fallback. v1.15: delete. */
  tipDollarSuggestions: number[]             // Dollar suggestions for under-threshold (default: [1, 2, 3])
  /** @deprecated Use settings.tips.suggestedPercentages as canonical source. v1.14: remove fallback. v1.15: delete. */
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

  // Shift Close Validation
  requireCloseTabsBeforeShift: boolean  // Block shift close if employee has open orders
  managerExemptFromTabClose: boolean    // Managers can close shift with open tabs

  // Declined Capture
  maxCaptureRetries: number             // Max retry attempts before walkout flag (default: 3)
  autoFlagWalkoutAfterDeclines: boolean // Auto-create walkout after max retries
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

  // Bartender view preferences (server-synced, replaces localStorage)
  bartender?: BartenderPreferences
}

// Bartender view preferences — stored inside POSLayoutSettings.bartender
// Replaces 14 localStorage calls in BartenderView.tsx with server-synced data
export interface BartenderPreferences {
  favorites: FavoriteItemRef[]
  categorySettings: BartenderCategorySettings
  categoryOrder: string[]                    // Category IDs in display order
  itemSettings: BartenderItemSettings
  itemCustomizations: Record<string, BartenderItemCustomization>
  itemOrder: Record<string, string[]>        // categoryId → menuItemId[] sort order
}

// Lightweight favorite reference (rich enough to render without re-fetching)
export interface FavoriteItemRef {
  menuItemId: string
  name: string
  price: number
  hasModifiers?: boolean
}

export interface BartenderCategorySettings {
  rows: 1 | 2
  size: 'xsmall' | 'small' | 'medium' | 'large' | 'xlarge' | 'blind'
}

export interface BartenderItemSettings {
  size: 'compact' | 'normal' | 'large' | 'xlarge'
  itemsPerRow: 'auto' | 3 | 4 | 5 | 6
  showPrices: boolean
  showDualPricing: boolean
  showQuickPours: boolean
  useScrolling: boolean
}

export interface BartenderItemCustomization {
  backgroundColor?: string
  textColor?: string
  highlight?: 'none' | 'glow' | 'border' | 'larger'
  sortOrder?: number
  fontStyle?: 'normal' | 'bold' | 'italic' | 'boldItalic'
  fontFamily?: 'default' | 'rounded' | 'mono' | 'serif' | 'handwritten'
  glowColor?: string
  borderColor?: string
  effect?: 'none' | 'pulse' | 'shimmer' | 'rainbow' | 'neon'
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

  quickPickEnabled: true,

  coursingCourseCount: 5,
  coursingDefaultDelay: 0,
}

export interface ApprovalSettings {
  requireVoidApproval: boolean           // Require manager approval for voids (default: true)
  requireDiscountApproval: boolean       // Require manager approval for ALL discounts (default: true)
  discountApprovalThreshold: number      // % above which manager approval is required (default: 20)
  voidApprovalThreshold: number          // $ above which void needs approval (0 = all voids) (default: 25)
  requireRefundApproval: boolean         // Require manager approval for refunds (default: true)
  requireDrawerOpenApproval: boolean     // Require manager approval to open drawer (default: true)
  defaultMaxDiscountPercent: number      // Cap for non-managers (e.g., 25 = servers can only give up to 25% off) (default: 25)
}

// ─── Hotel PMS Integration (Oracle OPERA Cloud / OHIP) ────────────────────────

export interface HotelPmsSettings {
  enabled: boolean              // Is this integration active?
  baseUrl: string               // OPERA Cloud API base URL (e.g. https://xxx.oraclehospitality.com)
  clientId: string              // OAuth client ID
  clientSecret: string          // OAuth client secret (stored as-is; treat as sensitive)
  appKey: string                // x-app-key header (OHIP application registration key)
  hotelId: string               // x-hotelid header (property code in OPERA)
  environment: 'cert' | 'production'  // cert = OPERA sandbox, production = live
  chargeCode: string            // F&B charge/transaction code configured in OPERA (e.g. "REST01")
  allowGuestLookup: boolean     // Allow cashier to search by guest last name in addition to room number
}

// ─── MarginEdge Integration Settings ─────────────────────────────────────────

export interface MarginEdgeSettings {
  enabled: boolean
  apiKey: string          // stored in DB, never returned to frontend
  environment: 'production' | 'sandbox'
  restaurantId?: string   // their internal restaurant identifier
  lastSyncAt?: string
  lastSyncStatus?: 'success' | 'error'
  lastSyncError?: string
  lastProductSyncAt?: string
  lastInvoiceSyncAt?: string
  syncOptions: {
    syncInvoices: boolean
    syncProducts: boolean
    autoUpdateCosts: boolean
    costChangeAlertThreshold: number  // percent, default 5
  }
}

export const DEFAULT_MARGIN_EDGE_SETTINGS: MarginEdgeSettings = {
  enabled: false,
  apiKey: '',
  environment: 'production',
  syncOptions: {
    syncInvoices: true,
    syncProducts: true,
    autoUpdateCosts: true,
    costChangeAlertThreshold: 5,
  }
}

export const DEFAULT_HOTEL_PMS_SETTINGS: HotelPmsSettings = {
  enabled: false,
  baseUrl: '',
  clientId: '',
  clientSecret: '',
  appKey: '',
  hotelId: '',
  environment: 'cert',
  chargeCode: '',
  allowGuestLookup: true,
}

// ─── 7shifts Integration Settings ────────────────────────────────────────────

export interface SevenShiftsSettings {
  enabled: boolean
  clientId: string
  clientSecret: string
  companyId: number           // 7shifts numeric company ID
  companyGuid: string         // UUID — required as x-company-guid header on every call
  locationId7s: number        // 7shifts location ID
  webhookSecret: string       // shared secret for webhook verification
  environment: 'sandbox' | 'production'

  // Serverless-safe token cache (persisted to DB)
  accessToken?: string
  accessTokenExpiresAt?: number  // epoch ms

  syncOptions: {
    pushSales: boolean
    pushTimePunches: boolean
    pullSchedule: boolean
  }

  // Per-operation sync status
  lastSalesPushAt: string | null
  lastSalesPushStatus: 'success' | 'error' | null
  lastSalesPushError: string | null

  lastPunchPushAt: string | null
  lastPunchPushStatus: 'success' | 'error' | null
  lastPunchPushError: string | null

  lastSchedulePullAt: string | null
  lastSchedulePullStatus: 'success' | 'error' | null
  lastSchedulePullError: string | null

  // Set to ISO timestamp when webhooks are successfully registered
  webhooksRegisteredAt?: string | null
}

export const DEFAULT_SEVEN_SHIFTS_SETTINGS: SevenShiftsSettings = {
  enabled: false,
  clientId: '',
  clientSecret: '',
  companyId: 0,
  companyGuid: '',
  locationId7s: 0,
  webhookSecret: '',
  environment: 'sandbox',
  syncOptions: {
    pushSales: true,
    pushTimePunches: true,
    pullSchedule: true,
  },
  lastSalesPushAt: null,
  lastSalesPushStatus: null,
  lastSalesPushError: null,
  lastPunchPushAt: null,
  lastPunchPushStatus: null,
  lastPunchPushError: null,
  lastSchedulePullAt: null,
  lastSchedulePullStatus: null,
  lastSchedulePullError: null,
  webhooksRegisteredAt: null,
}

// ─── EOD (End of Day) Settings ──────────────────────────────────────────────

export interface EodSettings {
  autoBatchClose: boolean               // Auto-trigger Datacap batch close during EOD reset (default: true)
  batchCloseTime: string                // HH:MM 24h format — when automated nightly batch fires (default: "04:00")
  autoCaptureTabs?: boolean             // Auto-capture open bar tabs during EOD reset (default: false)
  autoGratuityPercent?: number          // Auto-gratuity % applied to auto-captured tabs (default: 20)
}

export const DEFAULT_EOD_SETTINGS: EodSettings = {
  autoBatchClose: true,
  batchCloseTime: '04:00',
  autoCaptureTabs: false,
  autoGratuityPercent: 20,
}

// ─── Speed-of-Service Goals Settings ─────────────────────────────────────────

export interface SpeedOfServiceSettings {
  goalMinutes: number              // Target minutes from send to bump (default: 15)
  warningMinutes: number           // Threshold for slow-ticket alert (default: 20)
  alertEnabled: boolean            // Fire alert when bump time exceeds warningMinutes (default: false)
}

export const DEFAULT_SPEED_OF_SERVICE: SpeedOfServiceSettings = {
  goalMinutes: 15,
  warningMinutes: 20,
  alertEnabled: false,
}

// ─── Walkout Auto-Detection Settings ────────────────────────────────────────

export interface WalkoutSettings {
  autoDetectMinutes: number             // Minutes an open order must be idle before flagging (default: 120)
  autoDetectEnabled: boolean            // Enable walkout auto-detection (default: true)
  maxCaptureRetries: number             // Max walkout capture retry attempts before marking exhausted (default: 10)
}

export const DEFAULT_WALKOUT_SETTINGS: WalkoutSettings = {
  autoDetectMinutes: 120,
  autoDetectEnabled: true,
  maxCaptureRetries: 10,
}

// ─── Age Verification Settings ────────────────────────────────────────────────

export interface AgeVerificationSettings {
  enabled: boolean             // Master toggle for age verification prompts
  minimumAge: number           // Minimum age required (default: 21)
  verifyOnce: boolean          // Only prompt once per order, not per item (default: true)
}

export const DEFAULT_AGE_VERIFICATION: AgeVerificationSettings = {
  enabled: true,
  minimumAge: 21,
  verifyOnce: true,
}

// ─── Payroll Export Settings ──────────────────────────────────────────────────

export interface PayrollExportSettings {
  enabled: boolean                   // Master toggle (default: false)
  provider: 'none' | 'adp' | 'gusto' | 'paychex' | 'csv'  // Payroll provider format (default: 'none')
  includeTimeClock: boolean          // Include time clock hours in export (default: true)
  includeTips: boolean               // Include tip data in export (default: true)
  includeBreaks: boolean             // Include break hours in export (default: true)
  exportFormat: 'csv' | 'json'       // Output file format (default: 'csv')
  payPeriod: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'  // Pay period cycle (default: 'biweekly')
}

export const DEFAULT_PAYROLL_EXPORT: PayrollExportSettings = {
  enabled: false,
  provider: 'none',
  includeTimeClock: true,
  includeTips: true,
  includeBreaks: true,
  exportFormat: 'csv',
  payPeriod: 'biweekly',
}

// ─── Catering Settings ──────────────────────────────────────────────────────

export interface CateringSettings {
  enabled: boolean                   // Master toggle (default: false)
  minAdvanceDays: number             // Minimum days in advance to place catering order (default: 3)
  minOrderAmount: number             // Minimum order amount in dollars (default: 100.00)
  requireDeposit: boolean            // Require deposit payment (default: true)
  depositPercent: number             // Deposit percentage of total (default: 25)
  serviceFeePercent: number          // Auto-applied gratuity / service fee (default: 18)
  deliveryFee: number                // Fixed delivery fee in dollars, 0 = none (default: 0)
  maxGuestCount: number              // Maximum guest count per order (default: 500)
}

export const DEFAULT_CATERING: CateringSettings = {
  enabled: false,
  minAdvanceDays: 3,
  minOrderAmount: 100.00,
  requireDeposit: true,
  depositPercent: 25,
  serviceFeePercent: 18,
  deliveryFee: 0,
  maxGuestCount: 500,
}

export interface LocationSettings {
  tax: TaxSettings
  dualPricing: DualPricingSettings
  pricingProgram?: PricingProgram       // New multi-model pricing program (optional for backward compat)
  priceRounding: PriceRoundingSettings
  tips: TipSettings
  tipShares: TipShareSettings
  tipBank: TipBankSettings
  receipts: ReceiptSettings
  payments: PaymentSettings
  loyalty: LoyaltySettings
  happyHour: HappyHourSettings
  barTabs: BarTabSettings
  posDisplay: POSDisplaySettings
  clockOut: ClockOutSettings
  businessDay: BusinessDaySettings
  autoReboot: AutoRebootSettings
  receiptDisplay: GlobalReceiptSettings  // Controls WHAT features are available in the Visual Editor
  approvals: ApprovalSettings
  alerts: AlertSettings
  security: SecuritySettings
  hotelPms?: HotelPmsSettings           // Oracle OPERA PMS integration (optional for backward compat)
  sevenShifts?: SevenShiftsSettings     // 7shifts labor management integration (optional for backward compat)
  marginEdge?: MarginEdgeSettings       // MarginEdge COGS integration (optional for backward compat)
  bergReportsEnabled?: boolean           // Berg liquor controls comparison reports (Tier 1)
  localDataRetention?: 'daily' | 'weekly' | 'biweekly' | 'monthly' | '60days' | '90days'
  eod?: EodSettings                     // EOD batch close automation (optional for backward compat)
  walkout?: WalkoutSettings             // Walkout auto-detection (optional for backward compat)
  breaks?: BreakComplianceSettings     // Break compliance enforcement (optional for backward compat)
  kds?: KdsSettings                    // KDS order age thresholds (optional for backward compat)
  speedOfService?: SpeedOfServiceSettings  // Speed-of-service goal/alert thresholds (optional for backward compat)
  autoGratuity?: AutoGratuitySettings  // Party-size auto-gratuity (optional for backward compat)
  ageVerification?: AgeVerificationSettings  // Age verification prompts for restricted items (optional for backward compat)
  cashManagement?: CashManagementSettings   // Cash management thresholds and policies (optional for backward compat)
  loginMessages?: LoginMessageSettings        // Configurable messages shown on the login screen (optional for backward compat)
  training?: TrainingSettings                 // Training mode — suppress payments/printing/inventory for training employees (optional for backward compat)
  comboAutoSuggest?: boolean                   // Auto-suggest combo conversions when individual items match a combo template (default: true)
  sendBehavior?: 'stay' | 'return_to_floor' | 'return_to_orders'  // Post-send navigation behavior (default: 'return_to_floor')
  paidInOutCategories?: string[]               // Available categories for paid in/out records
  serverBanking?: ServerBankingSettings        // Per-server cash float (buy-in at shift start, settle at shift end) (optional for backward compat)
  preOrders?: PreOrderSettings                 // Pre-order / future order scheduling (optional for backward compat)
  employeeMeals?: EmployeeMealSettings         // Employee meal tracking — separate from comps (optional for backward compat)
  showNutritionalInfo?: boolean                 // Display nutritional info on menu items (default: false)
  coverCharge?: CoverChargeSettings             // Door entry / cover charge management (optional for backward compat)
  qrOrdering?: QrOrderingSettings               // QR code dine-in ordering (optional for backward compat)
  waitlist?: WaitlistSettings                    // Public-facing waitlist management (optional for backward compat)
  menuRestorePoints?: MenuRestorePointSettings   // Menu snapshot restore points (optional for backward compat)
  reservationDeposits?: ReservationDepositSettings  // Reservation deposit collection (optional for backward compat)
  cardOnFile?: CardOnFileSettings                   // Card-on-file / saved card foundations (optional for backward compat)
  printerFailover?: PrinterFailoverSettings         // Kitchen printer failure fallback (optional for backward compat)
  accounting?: AccountingSettings                    // Accounting integration (QuickBooks/Xero/CSV) (optional for backward compat)
  customerFeedback?: CustomerFeedbackSettings       // Post-payment feedback collection (optional for backward compat)
  pourControl?: PourControlSettings                 // Pour control hardware integration (optional for backward compat)
  payrollExport?: PayrollExportSettings             // Payroll data export (ADP/Gusto/Paychex/CSV) (optional for backward compat)
  catering?: CateringSettings                       // Catering order management (optional for backward compat)
  hardwareLimits?: HardwareLimitsSettings            // Per-device and per-transaction limits (optional for backward compat)
  upsellPrompts?: UpsellPromptSettings               // Upsell prompt rules configuration (optional for backward compat)
  invoicing?: InvoicingSettings                       // B2B customer invoicing system (optional for backward compat)
  marketing?: MarketingSettings                       // Email/SMS marketing campaigns (optional for backward compat)
  thirdPartyDelivery?: ThirdPartyDeliverySettings     // DoorDash/UberEats/Grubhub delivery integration (optional for backward compat)
  hostView?: HostViewSettings                         // Host management station — seating, waitlist, server rotation (optional for backward compat)
  delivery?: DeliverySettings                         // In-house delivery management (optional for backward compat)
  textToPay?: TextToPaySettings                       // Text-to-Pay / Payment Links via SMS/email (optional for backward compat)
  memberships?: MembershipSettings                     // Recurring membership billing (optional for backward compat)
  entertainment?: EntertainmentSettings                 // Entertainment / timed rental policies (optional for backward compat)
}

// ─── Text-to-Pay Settings ───────────────────────────────────────────────────

export interface TextToPaySettings {
  enabled: boolean                    // Master toggle (default: false)
  defaultExpirationMinutes: number    // Link expiry in minutes (default: 60)
  allowTipOnLink: boolean             // Show tip selector on pay page (default: true)
  requireCustomerPhone: boolean       // Require phone number on order to send link (default: false)
  smsTemplate: string                 // SMS body template — {venue}, {link}, {amount} placeholders
}

export const DEFAULT_TEXT_TO_PAY: TextToPaySettings = {
  enabled: false,
  defaultExpirationMinutes: 60,
  allowTipOnLink: true,
  requireCustomerPhone: false,
  smsTemplate: 'Pay your bill at {venue}: {link}',
}

// ─── Host View Settings ─────────────────────────────────────────────────────

export interface HostViewSettings {
  enabled: boolean                // Master toggle (default: false)
  showWaitTimes: boolean          // Show estimated wait times (default: true)
  showServerLoad: boolean         // Show # of tables per server (default: true)
  autoRotateServers: boolean      // Round-robin seat assignment (default: true)
  sectionBased: boolean           // Assign by section (default: true)
  quotedWaitMultiplier: number    // Multiply estimated wait for customer-facing quote (default: 1.2)
}

export const DEFAULT_HOST_VIEW: HostViewSettings = {
  enabled: false,
  showWaitTimes: true,
  showServerLoad: true,
  autoRotateServers: true,
  sectionBased: true,
  quotedWaitMultiplier: 1.2,
}

// ─── Delivery Management Settings ───────────────────────────────────────────

export interface DeliverySettings {
  enabled: boolean              // Master toggle (default: false)
  deliveryFee: number           // Default delivery fee in dollars (default: 5.00)
  freeDeliveryMinimum: number   // Order minimum for free delivery, 0 = no free delivery (default: 0)
  maxDeliveryRadius: number     // Maximum delivery radius in miles (default: 10)
  estimatedDeliveryMinutes: number // Estimated delivery time in minutes (default: 45)
  requirePhone: boolean         // Require phone number for delivery orders (default: true)
  requireAddress: boolean       // Require address for delivery orders (default: true)
  maxActiveDeliveries: number   // Maximum concurrent active deliveries (default: 20)
}

export const DEFAULT_DELIVERY: DeliverySettings = {
  enabled: false,
  deliveryFee: 5.00,
  freeDeliveryMinimum: 0,
  maxDeliveryRadius: 10,
  estimatedDeliveryMinutes: 45,
  requirePhone: true,
  requireAddress: true,
  maxActiveDeliveries: 20,
}

// ─── Third-Party Delivery Settings ──────────────────────────────────────────

export interface ThirdPartyDeliveryPlatformSettings {
  enabled: boolean
  storeId: string                // DoorDash/UberEats storeId or Grubhub restaurantId
  webhookSecret: string          // HMAC secret for webhook signature validation
  autoAccept: boolean            // Auto-accept incoming orders (skip manual review)
  prepTimeMinutes: number        // Default prep time communicated to platform
}

export interface ThirdPartyDeliveryUberEatsSettings extends ThirdPartyDeliveryPlatformSettings {
  clientId: string               // UberEats OAuth client ID (for future API calls)
}

export interface ThirdPartyDeliverySettings {
  doordash: ThirdPartyDeliveryPlatformSettings
  ubereats: ThirdPartyDeliveryUberEatsSettings
  grubhub: ThirdPartyDeliveryPlatformSettings
  autoPrintTicket: boolean       // Auto-print kitchen ticket on new delivery order
  alertOnNewOrder: boolean       // Sound alert on new delivery order
  defaultTaxRate: number         // Override tax rate for delivery orders (0 = use location default)
}

export const DEFAULT_THIRD_PARTY_DELIVERY: ThirdPartyDeliverySettings = {
  doordash: {
    enabled: false,
    storeId: '',
    webhookSecret: '',
    autoAccept: false,
    prepTimeMinutes: 20,
  },
  ubereats: {
    enabled: false,
    storeId: '',
    clientId: '',
    webhookSecret: '',
    autoAccept: false,
    prepTimeMinutes: 20,
  },
  grubhub: {
    enabled: false,
    storeId: '',
    webhookSecret: '',
    autoAccept: false,
    prepTimeMinutes: 20,
  },
  autoPrintTicket: true,
  alertOnNewOrder: true,
  defaultTaxRate: 0,
}

// ─── Marketing Campaign Settings ────────────────────────────────────────────

export interface MarketingSettings {
  enabled: boolean              // Master toggle (default: false)
  smsEnabled: boolean           // Allow SMS campaigns (default: false)
  emailEnabled: boolean         // Allow email campaigns (default: true)
  senderName: string            // From name for emails (default: '')
  unsubscribeUrl: string        // Required for CAN-SPAM (default: '')
  maxSmsPerDay: number          // Daily SMS send limit (default: 500)
  maxEmailsPerDay: number       // Daily email send limit (default: 2000)
  defaultSegments: string[]     // Available audience segments
}

export const DEFAULT_MARKETING: MarketingSettings = {
  enabled: false,
  smsEnabled: false,
  emailEnabled: true,
  senderName: '',
  unsubscribeUrl: '',
  maxSmsPerDay: 500,
  maxEmailsPerDay: 2000,
  defaultSegments: ['all', 'vip', 'new', 'inactive', 'birthday'],
}

// ─── Upsell Prompts Settings ────────────────────────────────────────────────

export interface UpsellPromptSettings {
  enabled: boolean                    // Master toggle (default: false)
  maxPromptsPerOrder: number          // Max suggestions shown per order (default: 3)
  showOnItemAdd: boolean              // Show upsell prompt when item is added (default: true)
  showBeforeSend: boolean             // Show upsell prompt before sending to kitchen (default: false)
  dismissCooldownMinutes: number      // Minutes before showing same prompt again after dismiss (default: 0)
}

export const DEFAULT_UPSELL_PROMPTS: UpsellPromptSettings = {
  enabled: false,
  maxPromptsPerOrder: 3,
  showOnItemAdd: true,
  showBeforeSend: false,
  dismissCooldownMinutes: 0,
}

// ─── B2B Invoicing Settings ─────────────────────────────────────────────────

export interface InvoicingCompanyInfo {
  name: string
  address: string
  phone: string
  email: string
  taxId: string
}

export interface InvoicingSettings {
  enabled: boolean                    // Master toggle (default: false)
  defaultPaymentTermsDays: number     // Default net payment terms in days (default: 30)
  defaultTaxRate: number              // Override tax rate for invoices, 0 = no tax (default: 0)
  autoNumberPrefix: string            // Prefix for auto-generated invoice numbers (default: 'INV')
  nextInvoiceNumber: number           // Next sequential invoice number (default: 1001)
  companyInfo: InvoicingCompanyInfo   // Company info printed on invoices
  lateFeePercent: number              // Monthly late fee percentage, 0 = disabled (default: 0)
  reminderDays: number[]              // Days before due date to send reminders (default: [7, 3, 1])
}

export const DEFAULT_INVOICING_COMPANY_INFO: InvoicingCompanyInfo = {
  name: '',
  address: '',
  phone: '',
  email: '',
  taxId: '',
}

export const DEFAULT_INVOICING: InvoicingSettings = {
  enabled: false,
  defaultPaymentTermsDays: 30,
  defaultTaxRate: 0,
  autoNumberPrefix: 'INV',
  nextInvoiceNumber: 1001,
  companyInfo: { ...DEFAULT_INVOICING_COMPANY_INFO },
  lateFeePercent: 0,
  reminderDays: [7, 3, 1],
}

// ─── Printer Failover Settings ──────────────────────────────────────────────

export interface PrinterFailoverSettings {
  enabled: boolean              // Master toggle — try backup printer on failure (default: true)
  maxRetries: number            // Max retry attempts before marking failed_permanent (default: 3)
  alertOnFailure: boolean       // Emit manager alert when printer fails permanently (default: true)
  showStatusIndicator: boolean  // Show printer health dot in POS header (default: true)
}

export const DEFAULT_PRINTER_FAILOVER: PrinterFailoverSettings = {
  enabled: true,
  maxRetries: 3,
  alertOnFailure: true,
  showStatusIndicator: true,
}

// ─── Reservation Deposit Settings ────────────────────────────────────────────

export interface ReservationDepositSettings {
  enabled: boolean                     // Master toggle (default: false)
  defaultAmount: number                // Default deposit amount in dollars (default: 50.00)
  refundableBeforeHours: number        // Refundable if cancelled X hours before reservation (default: 24)
  requireForPartySize: number          // Require deposit for parties >= X guests (default: 6)
  nonRefundablePercent: number         // What % is always non-refundable, 0-100 (default: 0)
}

export const DEFAULT_RESERVATION_DEPOSIT: ReservationDepositSettings = {
  enabled: false,
  defaultAmount: 50.00,
  refundableBeforeHours: 24,
  requireForPartySize: 6,
  nonRefundablePercent: 0,
}

// ─── Card on File Settings ──────────────────────────────────────────────────

export interface CardOnFileSettings {
  enabled: boolean                     // Master toggle (default: false)
  allowSaveCard: boolean               // Allow customers to save cards (default: true)
  requireConsent: boolean              // Require explicit consent checkbox (default: true)
  maxCardsPerCustomer: number          // Maximum saved cards per customer (default: 5)
}

export const DEFAULT_CARD_ON_FILE: CardOnFileSettings = {
  enabled: false,
  allowSaveCard: true,
  requireConsent: true,
  maxCardsPerCustomer: 5,
}

// ─── Waitlist Settings ────────────────────────────────────────────────────────

export interface WaitlistSettings {
  enabled: boolean                     // Master toggle (default: false)
  maxPartySize: number                 // Maximum party size allowed (default: 20)
  estimateMinutesPerTurn: number       // Average wait per party ahead (default: 45)
  smsNotifications: boolean            // Send SMS via Twilio when table ready (default: true)
  maxWaitlistSize: number              // Max concurrent entries before full (default: 50)
  autoRemoveAfterMinutes: number       // Remove if not seated within X min of notification (default: 15)
  // Deposit settings
  depositEnabled: boolean              // Require deposit to hold waitlist position (default: false)
  depositAmount: number                // Deposit amount in dollars (default: 25)
  allowCashDeposit: boolean            // Accept cash as deposit method (default: true)
  applyDepositToOrder: boolean         // Apply deposit toward the order when seated (default: true)
  forfeitOnNoShow: boolean             // Forfeit deposit if customer doesn't show (default: true)
}

export const DEFAULT_WAITLIST_SETTINGS: WaitlistSettings = {
  enabled: false,
  maxPartySize: 20,
  estimateMinutesPerTurn: 45,
  smsNotifications: true,
  maxWaitlistSize: 50,
  autoRemoveAfterMinutes: 15,
  depositEnabled: false,
  depositAmount: 25,
  allowCashDeposit: true,
  applyDepositToOrder: true,
  forfeitOnNoShow: true,
}

// ─── Menu Restore Point Settings ──────────────────────────────────────────────

export interface MenuRestorePointSettings {
  enabled: boolean                     // Master toggle (default: true)
  maxSnapshots: number                 // Keep last N snapshots (default: 10)
  autoSnapshotOnBulkEdit: boolean      // Auto-create before bulk operations (default: true)
}

export const DEFAULT_MENU_RESTORE_POINT_SETTINGS: MenuRestorePointSettings = {
  enabled: true,
  maxSnapshots: 10,
  autoSnapshotOnBulkEdit: true,
}

// ─── Cash Management Settings ─────────────────────────────────────────────────

export interface CashManagementSettings {
  varianceWarningThreshold: number    // Dollar amount — variance triggers warning (default: 5.00)
  varianceCriticalThreshold: number   // Dollar amount — variance triggers critical alert (default: 25.00)
  requireWitnessForDrops: boolean     // Require a second employee to witness safe drops (default: false)
  requireReasonForNoSale: boolean     // Require a reason code when opening drawer without a sale (default: true)
  maxDropAmount: number               // Maximum single safe drop amount in dollars (default: 500.00)
}

export const DEFAULT_CASH_MANAGEMENT: CashManagementSettings = {
  varianceWarningThreshold: 5.00,
  varianceCriticalThreshold: 25.00,
  requireWitnessForDrops: false,
  requireReasonForNoSale: true,
  maxDropAmount: 500.00,
}

// ─── Login Message Settings ──────────────────────────────────────────────────

export interface LoginMessage {
  text: string
  type: 'info' | 'warning' | 'urgent'
  expiresAt?: string  // ISO date, null/undefined = permanent
}

export interface LoginMessageSettings {
  enabled: boolean
  messages: LoginMessage[]
}

export const DEFAULT_LOGIN_MESSAGES: LoginMessageSettings = {
  enabled: false,
  messages: [],
}

// ─── Training Mode Settings ─────────────────────────────────────────────────

export interface TrainingSettings {
  enabled: boolean                   // Master toggle
  trainingEmployeeIds: string[]      // Employees currently in training mode
  suppressInventory: boolean         // Don't deduct inventory for training orders (default: true)
  suppressPayments: boolean          // Don't hit Datacap for training orders (default: true)
  suppressPrinting: boolean          // Don't print kitchen tickets for training orders (default: true)
}

export const DEFAULT_TRAINING_SETTINGS: TrainingSettings = {
  enabled: false,
  trainingEmployeeIds: [],
  suppressInventory: true,
  suppressPayments: true,
  suppressPrinting: true,
}

// ─── Employee Meal Settings ─────────────────────────────────────────────────

export interface EmployeeMealSettings {
  enabled: boolean                 // Master toggle (default: false)
  maxMealValue: number             // Maximum meal value in dollars (default: 15.00)
  mealAllowancePerShift: number    // Number of meals allowed per shift (default: 1)
  trackForPayroll: boolean         // Include in payroll deduction reports (default: false)
  requireManagerApproval: boolean  // Require manager approval for meals exceeding maxMealValue (default: false)
}

export const DEFAULT_EMPLOYEE_MEAL_SETTINGS: EmployeeMealSettings = {
  enabled: false,
  maxMealValue: 15.00,
  mealAllowancePerShift: 1,
  trackForPayroll: false,
  requireManagerApproval: false,
}

// ─── Server Banking Settings ─────────────────────────────────────────────────

export interface ServerBankingSettings {
  enabled: boolean                // Master toggle (default: false)
  defaultBankAmount: number       // Pre-filled buy-in amount in dollars (default: 100.00)
  requireExactBuyIn: boolean      // If true, buy-in must match defaultBankAmount exactly (default: false)
  trackOverShort: boolean         // Track over/short variance at shift close (default: true)
}

export const DEFAULT_SERVER_BANKING: ServerBankingSettings = {
  enabled: false,
  defaultBankAmount: 100.00,
  requireExactBuyIn: false,
  trackOverShort: true,
}

// ─── Pre-Order / Future Order Settings ──────────────────────────────────────

export interface PreOrderSettings {
  enabled: boolean                // Master toggle (default: false)
  maxAdvanceHours: number         // How far ahead can you schedule an order, in hours (default: 72)
  minAdvanceMinutes: number       // Minimum lead time in minutes from now (default: 30)
  allowedOrderTypes: string[]     // Which order types support pre-order (default: ['pickup', 'delivery'])
}

export const DEFAULT_PRE_ORDER: PreOrderSettings = {
  enabled: false,
  maxAdvanceHours: 72,
  minAdvanceMinutes: 30,
  allowedOrderTypes: ['pickup', 'delivery'],
}

// ─── Cover Charge Settings ─────────────────────────────────────────────────

export interface CoverChargeSettings {
  enabled: boolean               // Master toggle (default: false)
  defaultAmount: number          // Default cover charge in dollars (default: 10.00)
  vipBypass: boolean             // VIP customers skip cover charge (default: true)
  trackDoorCount: boolean        // Track running door count (default: true)
  maxCapacity: number            // 0 = unlimited (default: 0)
}

export const DEFAULT_COVER_CHARGE: CoverChargeSettings = {
  enabled: false,
  defaultAmount: 10.00,
  vipBypass: true,
  trackDoorCount: true,
  maxCapacity: 0,
}

// ─── Hardware & Transaction Limits Settings ─────────────────────────────────

export interface HardwareLimitsSettings {
  // ─── Device Count Limits (synced from Mission Control subscription tier) ───
  maxPOSTerminals: number                  // Max fixed station terminals (default: 20)
  maxHandhelds: number                     // Max handheld devices (default: 4)
  maxCellularDevices: number               // Max cellular (LTE/5G) devices (default: 2)
  maxKDSScreens: number                    // Max KDS displays (default: 4)
  maxPrinters: number                      // Max printers (default: 6)

  // Transaction Limits
  maxSingleTransactionAmount: number       // Max dollar amount for a single order payment (default: 9999.99, 0 = unlimited)
  maxCashPaymentAmount: number             // Max single cash payment allowed (default: 500, 0 = unlimited)
  maxOpenTabAmount: number                 // Max running tab total before lock (default: 1000, 0 = unlimited)
  maxDiscountDollarAmount: number          // Max dollar discount on a single order (default: 0 = unlimited)

  // Handheld / Device Limits
  handheldMaxPaymentAmount: number         // Max payment amount for HANDHELD terminals (default: 500, 0 = unlimited)
  handheldAllowVoids: boolean              // Can handhelds void items? (default: true)
  handheldAllowComps: boolean              // Can handhelds comp items? (default: true)
  handheldAllowDiscounts: boolean          // Can handhelds apply discounts? (default: true)
  handheldAllowRefunds: boolean            // Can handhelds process refunds? (default: false)
  handheldAllowCashPayments: boolean       // Can handhelds accept cash? (default: false)
  handheldAllowTabClose: boolean           // Can handhelds close tabs? (default: true)

  // Cellular-Specific (these are on top of the hard-coded proxy.ts blocks)
  cellularMaxOrderAmount: number           // Max order total for cellular devices (default: 200, 0 = unlimited)
  cellularAllowVoids: boolean              // Can cellular void? (default: false — currently re-auth required)
  cellularAllowComps: boolean              // Can cellular comp? (default: false — currently re-auth required)

  // Volume Guards
  maxOrdersPerHour: number                 // Max orders a single employee can create per hour (default: 0 = unlimited)
  maxVoidsPerShift: number                 // Max voids per employee per shift (default: 0 = unlimited)
  maxCompsPerShift: number                 // Max comps per employee per shift (default: 0 = unlimited)
}

export const DEFAULT_HARDWARE_LIMITS: HardwareLimitsSettings = {
  maxPOSTerminals: 20,
  maxHandhelds: 4,
  maxCellularDevices: 2,
  maxKDSScreens: 4,
  maxPrinters: 6,
  maxSingleTransactionAmount: 9999.99,
  maxCashPaymentAmount: 500,
  maxOpenTabAmount: 1000,
  maxDiscountDollarAmount: 0,
  handheldMaxPaymentAmount: 500,
  handheldAllowVoids: true,
  handheldAllowComps: true,
  handheldAllowDiscounts: true,
  handheldAllowRefunds: false,
  handheldAllowCashPayments: false,
  handheldAllowTabClose: true,
  cellularMaxOrderAmount: 200,
  cellularAllowVoids: false,
  cellularAllowComps: false,
  maxOrdersPerHour: 0,
  maxVoidsPerShift: 0,
  maxCompsPerShift: 0,
}

// ─── QR Ordering Settings ──────────────────────────────────────────────────

export interface QrOrderingSettings {
  enabled: boolean                 // Master toggle (default: false)
  requireTableAssignment: boolean  // Order must be tied to a table (default: true)
  allowPayment: boolean            // Allow payment from phone (default: false)
  showPrices: boolean              // Show prices on public menu (default: true)
  maxItemsPerOrder: number         // Max items per QR order (default: 50)
  menuCategoryFilter: string[]     // Empty = all categories (default: [])
}

export const DEFAULT_QR_ORDERING: QrOrderingSettings = {
  enabled: false,
  requireTableAssignment: true,
  allowPayment: false,
  showPrices: true,
  maxItemsPerOrder: 50,
  menuCategoryFilter: [],
}

// ─── KDS Settings ──────────────────────────────────────────────────────────────

export interface KdsSettings {
  orderAgeWarningMinutes: number       // Minutes until order card turns yellow (default: 10)
  orderAgeCriticalMinutes: number      // Minutes until order card turns red (default: 20)
}

export const DEFAULT_KDS_SETTINGS: KdsSettings = {
  orderAgeWarningMinutes: 10,
  orderAgeCriticalMinutes: 20,
}

// ─── Accounting Integration Settings ─────────────────────────────────────────

export interface AccountingGLMapping {
  salesRevenue: string            // GL account for sales revenue (default: '4000')
  cashPayments: string            // GL account for cash payments (default: '1000')
  cardPayments: string            // GL account for card payments (default: '1100')
  giftCardPayments: string        // GL account for gift card payments (default: '1200')
  houseAccountPayments: string    // GL account for house account payments (default: '1300')
  taxCollected: string            // GL account for tax collected (default: '2100')
  tipsPayable: string             // GL account for tips payable (default: '2200')
  discounts: string               // GL account for discounts (default: '4100')
  refunds: string                 // GL account for refunds (default: '4200')
  comps: string                   // GL account for comps (default: '5000')
  cogs: string                    // GL account for cost of goods sold (default: '5100')
  laborCost: string               // GL account for labor cost (default: '6000')
}

export interface AccountingSettings {
  enabled: boolean                                            // Master toggle (default: false)
  provider: 'none' | 'quickbooks' | 'xero' | 'csv'          // Accounting provider (default: 'none')
  autoExportDaily: boolean                                    // Auto-export daily journal (default: false)
  exportTime: string                                          // HH:MM — time for daily auto-export (default: '04:00')
  glMapping: AccountingGLMapping                              // GL account code mapping
}

export const DEFAULT_GL_MAPPING: AccountingGLMapping = {
  salesRevenue: '4000',
  cashPayments: '1000',
  cardPayments: '1100',
  giftCardPayments: '1200',
  houseAccountPayments: '1300',
  taxCollected: '2100',
  tipsPayable: '2200',
  discounts: '4100',
  refunds: '4200',
  comps: '5000',
  cogs: '5100',
  laborCost: '6000',
}

export const DEFAULT_ACCOUNTING_SETTINGS: AccountingSettings = {
  enabled: false,
  provider: 'none',
  autoExportDaily: false,
  exportTime: '04:00',
  glMapping: { ...DEFAULT_GL_MAPPING },
}

// ─── Customer Feedback Settings ─────────────────────────────────────────────

export interface CustomerFeedbackSettings {
  enabled: boolean              // Master toggle (default: false)
  promptAfterPayment: boolean   // Show rating prompt after payment (default: true)
  sendSmsRequest: boolean       // Send SMS feedback request (default: false)
  sendEmailRequest: boolean     // Send email feedback request (default: false)
  feedbackUrl: string           // Public feedback page URL (default: '')
  ratingScale: 5 | 10          // Star rating scale (default: 5)
  requireComment: boolean       // Require comment with rating (default: false)
}

export const DEFAULT_CUSTOMER_FEEDBACK: CustomerFeedbackSettings = {
  enabled: false,
  promptAfterPayment: true,
  sendSmsRequest: false,
  sendEmailRequest: false,
  feedbackUrl: '',
  ratingScale: 5,
  requireComment: false,
}

// ─── Pour Control Settings ──────────────────────────────────────────────────

export interface PourControlSettings {
  enabled: boolean              // Master toggle (default: false)
  provider: 'none' | 'berg' | 'barvision' | 'tapwatcher' | 'generic'  // Hardware provider (default: 'none')
  defaultPourOz: number         // Standard pour size in oz (default: 1.5)
  overPourThresholdPercent: number // Flag pours >X% over target (default: 15)
  trackWaste: boolean           // Track waste from over-pours (default: true)
  alertOnOverPour: boolean      // Alert managers on over-pours (default: false)
}

export const DEFAULT_POUR_CONTROL: PourControlSettings = {
  enabled: false,
  provider: 'none',
  defaultPourOz: 1.5,
  overPourThresholdPercent: 15,
  trackWaste: true,
  alertOnOverPour: false,
}

// Default settings for new locations
export const DEFAULT_SETTINGS: LocationSettings = {
  tax: {
    defaultRate: 8.0,
    calculateAfterDiscount: true,
    taxInclusiveLiquor: false,
    taxInclusiveFood: false,
  },
  dualPricing: {
    enabled: true,
    cashDiscountPercent: 4.0,       // 4% discount for cash payments
    applyToCredit: true,
    applyToDebit: true,
    showSavingsMessage: true,
  },
  priceRounding: {
    enabled: true,
    increment: '1.00',              // none, 0.05, 0.10, 0.25, 0.50, 1.00
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
  tipBank: {
    enabled: true,
    allocationMode: 'CHECK_BASED',
    chargebackPolicy: 'BUSINESS_ABSORBS',
    allowNegativeBalances: false,
    allowManagerInPools: false,
    poolCashTips: true,
    tipGuide: {
      basis: 'pre_discount',
      percentages: [15, 18, 20, 25],
      showBasisExplanation: true,
      roundTo: 'quarter',
    },
    deductCCFeeFromTips: false,       // Off by default — business absorbs CC fees on tips
    ccFeePercent: 3.0,                // Common processing fee (only applied if deductCCFeeFromTips=true)
    allowEODCashOut: true,            // Employees can cash out tips at shift close
    requireManagerApprovalForCashOut: false,  // No manager approval needed by default
    defaultPayoutMethod: 'cash',      // Default to cash payout (business doesn't want to hold tips)
    tipAttributionTiming: 'check_closed', // Credit the group active when payment processes (best for bars)
    lateTabTipHandling: 'pool_period',
    attributionModel: 'primary_100',
    tableTipOwnershipMode: 'ITEM_BASED',   // Default: helpers get per-item credit on server tables
    allowStandaloneServers: true,            // Allow "No Group" option at clock-in
    allowEmployeeCreatedGroups: true,        // Allow ad-hoc group creation (legacy behavior)
    noTipQuickButton: false,                 // Off by default to encourage tipping
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
    acceptHotelRoomCharge: false,
    cashRounding: 'none',
    roundingDirection: 'nearest',
    enablePreAuth: true,
    defaultPreAuthAmount: 100.00,
    preAuthExpirationDays: 7,
    processor: 'none',             // 'none' | 'datacap'
    testMode: true,
    readerTimeoutSeconds: 30,
    autoSwapOnFailure: true,
    // Bar Tab Pre-Auth
    incrementThresholdPercent: 80,
    incrementAmount: 25,
    autoIncrementEnabled: true,
    incrementTipBufferPercent: 25,
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
    requireCloseTabsBeforeShift: true,   // Block shift close with open orders
    managerExemptFromTabClose: true,     // Managers can override
    maxCaptureRetries: 3,                // Max capture retries before walkout
    autoFlagWalkoutAfterDeclines: true,  // Auto-flag walkout after max retries
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
  clockOut: {
    requireSettledBeforeClockOut: true,    // On by default (safe default — checks for open tabs/orders)
    requireTipsAdjusted: false,            // Off by default (not all locations need this)
    allowTransferOnClockOut: true,         // Allow transfers by default
  },
  businessDay: {
    dayStartTime: '04:00',
    enforceClockOut: true,
    enforceTabClose: true,
    batchAtDayEnd: true,
    graceMinutes: 15,
    warnBeforeClose: true,
  },
  autoReboot: {
    enabled: false,
    delayMinutes: 15,
  },
  receiptDisplay: DEFAULT_GLOBAL_RECEIPT_SETTINGS,
  approvals: {
    requireVoidApproval: true,
    requireDiscountApproval: true,
    discountApprovalThreshold: 20,
    voidApprovalThreshold: 25,
    requireRefundApproval: true,
    requireDrawerOpenApproval: true,
    defaultMaxDiscountPercent: 25,
  },
  alerts: {
    enabled: true,
    largeVoidThreshold: 50,
    largeDiscountThreshold: 50,
    frequentDiscountLimit: 10,
    overtimeWarningMinutes: 30,
    cashDrawerAlertEnabled: true,
  },
  security: {
    requirePinAfterPayment: false,
    idleLockMinutes: 0,
    enableBuddyPunchDetection: false,
    require2FAForLargeRefunds: false,
    refund2FAThreshold: 100,
    require2FAForLargeVoids: false,
    void2FAThreshold: 200,
  },
  localDataRetention: 'monthly',
  cashManagement: DEFAULT_CASH_MANAGEMENT,
  sendBehavior: 'return_to_floor',
  paidInOutCategories: ['Cash Advance', 'Vendor Payment', 'Refund', 'Restock', 'Tip Payout', 'Other'],
}

// ─── Entertainment Settings ──────────────────────────────────────────────

export interface EntertainmentSettings {
  allowExtendWithWaitlist: boolean  // Allow extending time when customers are on the waitlist (default: true)
}

export const DEFAULT_ENTERTAINMENT_SETTINGS: EntertainmentSettings = {
  allowExtendWithWaitlist: true,
}

// ─── Membership Settings ──────────────────────────────────────────────────

export interface MembershipSettings {
  enabled: boolean
  retryScheduleDays: number[]    // [0, 3, 7]
  gracePeriodDays: number        // 14
  sendDeclineEmails: boolean
  sendUpcomingChargeEmails: boolean
  sendRetryScheduledEmails: boolean
  sendAdminDeclineAlerts: boolean
}

export const DEFAULT_MEMBERSHIP_SETTINGS: MembershipSettings = {
  enabled: false,
  retryScheduleDays: [0, 3, 7],
  gracePeriodDays: 14,
  sendDeclineEmails: true,
  sendUpcomingChargeEmails: true,
  sendRetryScheduledEmails: true,
  sendAdminDeclineAlerts: true,
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
      // cashDiscountPercent > 0 is authoritative: dual pricing is active whenever a discount is
      // configured, regardless of how the enabled flag is stored. This prevents the legacy state
      // where enabled:false gets stuck in the DB when a cash discount percent is present.
      enabled: ((partial.dualPricing?.cashDiscountPercent ?? DEFAULT_SETTINGS.dualPricing.cashDiscountPercent) > 0)
        || (partial.dualPricing?.enabled ?? DEFAULT_SETTINGS.dualPricing.enabled),
    },
    pricingProgram: partial.pricingProgram,  // pass-through: optional, undefined if not set
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
    tipBank: {
      ...DEFAULT_SETTINGS.tipBank,
      ...(partial.tipBank || {}),
      tipGuide: {
        ...DEFAULT_SETTINGS.tipBank.tipGuide,
        ...(partial.tipBank?.tipGuide || {}),
        percentages: (partial.tipBank?.tipGuide?.percentages?.length)
          ? partial.tipBank.tipGuide.percentages
          : DEFAULT_SETTINGS.tipBank.tipGuide.percentages,
      },
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
    clockOut: {
      ...DEFAULT_SETTINGS.clockOut,
      ...(partial.clockOut || {}),
    },
    businessDay: {
      ...DEFAULT_SETTINGS.businessDay,
      ...(partial.businessDay || {}),
    },
    autoReboot: {
      ...DEFAULT_SETTINGS.autoReboot,
      ...(partial.autoReboot || {}),
    },
    receiptDisplay: mergeGlobalReceiptSettings(partial.receiptDisplay),
    approvals: {
      ...DEFAULT_SETTINGS.approvals,
      ...(partial.approvals || {}),
    },
    alerts: {
      ...DEFAULT_SETTINGS.alerts,
      ...(partial.alerts || {}),
    },
    security: {
      ...DEFAULT_SETTINGS.security,
      ...(partial.security || {}),
    },
    localDataRetention: partial.localDataRetention ?? DEFAULT_SETTINGS.localDataRetention,
    hotelPms: partial.hotelPms
      ? { ...DEFAULT_HOTEL_PMS_SETTINGS, ...partial.hotelPms }
      : undefined,
    sevenShifts: partial.sevenShifts
      ? { ...DEFAULT_SEVEN_SHIFTS_SETTINGS, ...partial.sevenShifts, syncOptions: { ...DEFAULT_SEVEN_SHIFTS_SETTINGS.syncOptions, ...partial.sevenShifts.syncOptions } }
      : undefined,
    marginEdge: partial.marginEdge
      ? { ...DEFAULT_MARGIN_EDGE_SETTINGS, ...partial.marginEdge, syncOptions: { ...DEFAULT_MARGIN_EDGE_SETTINGS.syncOptions, ...partial.marginEdge.syncOptions } }
      : undefined,
    eod: partial.eod
      ? { ...DEFAULT_EOD_SETTINGS, ...partial.eod }
      : undefined,
    walkout: partial.walkout
      ? { ...DEFAULT_WALKOUT_SETTINGS, ...partial.walkout }
      : undefined,
    breaks: partial.breaks
      ? { ...DEFAULT_BREAK_COMPLIANCE, ...partial.breaks }
      : undefined,
    kds: partial.kds
      ? { ...DEFAULT_KDS_SETTINGS, ...partial.kds }
      : undefined,
    autoGratuity: partial.autoGratuity
      ? { ...DEFAULT_AUTO_GRATUITY, ...partial.autoGratuity }
      : undefined,
    ageVerification: partial.ageVerification
      ? { ...DEFAULT_AGE_VERIFICATION, ...partial.ageVerification }
      : undefined,
    speedOfService: partial.speedOfService
      ? { ...DEFAULT_SPEED_OF_SERVICE, ...partial.speedOfService }
      : undefined,
    cashManagement: partial.cashManagement
      ? { ...DEFAULT_CASH_MANAGEMENT, ...partial.cashManagement }
      : DEFAULT_CASH_MANAGEMENT,
    loginMessages: partial.loginMessages
      ? { ...DEFAULT_LOGIN_MESSAGES, ...partial.loginMessages, messages: partial.loginMessages.messages ?? [] }
      : undefined,
    training: partial.training
      ? { ...DEFAULT_TRAINING_SETTINGS, ...partial.training, trainingEmployeeIds: partial.training.trainingEmployeeIds ?? [] }
      : undefined,
    comboAutoSuggest: partial.comboAutoSuggest ?? true,
    sendBehavior: partial.sendBehavior ?? DEFAULT_SETTINGS.sendBehavior,
    paidInOutCategories: partial.paidInOutCategories ?? DEFAULT_SETTINGS.paidInOutCategories,
    serverBanking: partial.serverBanking
      ? { ...DEFAULT_SERVER_BANKING, ...partial.serverBanking }
      : undefined,
    preOrders: partial.preOrders
      ? { ...DEFAULT_PRE_ORDER, ...partial.preOrders, allowedOrderTypes: partial.preOrders.allowedOrderTypes ?? DEFAULT_PRE_ORDER.allowedOrderTypes }
      : undefined,
    coverCharge: partial.coverCharge
      ? { ...DEFAULT_COVER_CHARGE, ...partial.coverCharge }
      : undefined,
    qrOrdering: partial.qrOrdering
      ? { ...DEFAULT_QR_ORDERING, ...partial.qrOrdering, menuCategoryFilter: partial.qrOrdering.menuCategoryFilter ?? DEFAULT_QR_ORDERING.menuCategoryFilter }
      : undefined,
    employeeMeals: partial.employeeMeals
      ? { ...DEFAULT_EMPLOYEE_MEAL_SETTINGS, ...partial.employeeMeals }
      : undefined,
    showNutritionalInfo: partial.showNutritionalInfo ?? false,
    waitlist: partial.waitlist
      ? { ...DEFAULT_WAITLIST_SETTINGS, ...partial.waitlist }
      : undefined,
    menuRestorePoints: partial.menuRestorePoints
      ? { ...DEFAULT_MENU_RESTORE_POINT_SETTINGS, ...partial.menuRestorePoints }
      : undefined,
    reservationDeposits: partial.reservationDeposits
      ? { ...DEFAULT_RESERVATION_DEPOSIT, ...partial.reservationDeposits }
      : undefined,
    cardOnFile: partial.cardOnFile
      ? { ...DEFAULT_CARD_ON_FILE, ...partial.cardOnFile }
      : undefined,
    printerFailover: partial.printerFailover
      ? { ...DEFAULT_PRINTER_FAILOVER, ...partial.printerFailover }
      : undefined,
    accounting: partial.accounting
      ? { ...DEFAULT_ACCOUNTING_SETTINGS, ...partial.accounting, glMapping: { ...DEFAULT_GL_MAPPING, ...partial.accounting.glMapping } }
      : undefined,
    payrollExport: partial.payrollExport
      ? { ...DEFAULT_PAYROLL_EXPORT, ...partial.payrollExport }
      : undefined,
    catering: partial.catering
      ? { ...DEFAULT_CATERING, ...partial.catering }
      : undefined,
    customerFeedback: partial.customerFeedback
      ? { ...DEFAULT_CUSTOMER_FEEDBACK, ...partial.customerFeedback }
      : undefined,
    pourControl: partial.pourControl
      ? { ...DEFAULT_POUR_CONTROL, ...partial.pourControl }
      : undefined,
    hardwareLimits: partial.hardwareLimits
      ? { ...DEFAULT_HARDWARE_LIMITS, ...partial.hardwareLimits }
      : undefined,
    upsellPrompts: partial.upsellPrompts
      ? { ...DEFAULT_UPSELL_PROMPTS, ...partial.upsellPrompts }
      : undefined,
    invoicing: partial.invoicing
      ? { ...DEFAULT_INVOICING, ...partial.invoicing, companyInfo: { ...DEFAULT_INVOICING_COMPANY_INFO, ...partial.invoicing.companyInfo }, reminderDays: partial.invoicing.reminderDays ?? DEFAULT_INVOICING.reminderDays }
      : undefined,
    marketing: partial.marketing
      ? { ...DEFAULT_MARKETING, ...partial.marketing, defaultSegments: partial.marketing.defaultSegments ?? DEFAULT_MARKETING.defaultSegments }
      : undefined,
    thirdPartyDelivery: partial.thirdPartyDelivery
      ? {
          ...DEFAULT_THIRD_PARTY_DELIVERY,
          ...partial.thirdPartyDelivery,
          doordash: { ...DEFAULT_THIRD_PARTY_DELIVERY.doordash, ...partial.thirdPartyDelivery.doordash },
          ubereats: { ...DEFAULT_THIRD_PARTY_DELIVERY.ubereats, ...partial.thirdPartyDelivery.ubereats },
          grubhub: { ...DEFAULT_THIRD_PARTY_DELIVERY.grubhub, ...partial.thirdPartyDelivery.grubhub },
        }
      : undefined,
    hostView: partial.hostView
      ? { ...DEFAULT_HOST_VIEW, ...partial.hostView }
      : undefined,
    delivery: partial.delivery
      ? { ...DEFAULT_DELIVERY, ...partial.delivery }
      : undefined,
    textToPay: partial.textToPay
      ? { ...DEFAULT_TEXT_TO_PAY, ...partial.textToPay }
      : undefined,
    memberships: partial.memberships
      ? { ...DEFAULT_MEMBERSHIP_SETTINGS, ...partial.memberships }
      : undefined,
    entertainment: partial.entertainment
      ? { ...DEFAULT_ENTERTAINMENT_SETTINGS, ...partial.entertainment }
      : undefined,
  }
}

/**
 * Get the active happy hour end time for the current schedule.
 * Returns null if happy hour is not active right now.
 */
export function getHappyHourEndTime(settings: HappyHourSettings): Date | null {
  if (!settings.enabled) return null

  const now = new Date()
  const currentDay = now.getDay()
  const currentTimeMinutes = now.getHours() * 60 + now.getMinutes()

  for (const schedule of settings.schedules) {
    if (!schedule.dayOfWeek.includes(currentDay)) continue

    const [startHour, startMin] = schedule.startTime.split(':').map(Number)
    const [endHour, endMin] = schedule.endTime.split(':').map(Number)

    const startMinutes = startHour * 60 + startMin
    const endMinutes = endHour * 60 + endMin

    let isActive = false
    if (endMinutes < startMinutes) {
      isActive = currentTimeMinutes >= startMinutes || currentTimeMinutes <= endMinutes
    } else {
      isActive = currentTimeMinutes >= startMinutes && currentTimeMinutes <= endMinutes
    }

    if (isActive) {
      const endDate = new Date(now)
      endDate.setSeconds(0, 0)
      if (endMinutes < startMinutes && currentTimeMinutes < startMinutes) {
        // Past midnight in overnight schedule — end time is today
        endDate.setHours(endHour, endMin)
      } else if (endMinutes < startMinutes) {
        // Before midnight in overnight schedule — end time is tomorrow
        endDate.setDate(endDate.getDate() + 1)
        endDate.setHours(endHour, endMin)
      } else {
        endDate.setHours(endHour, endMin)
      }
      return endDate
    }
  }

  return null
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
