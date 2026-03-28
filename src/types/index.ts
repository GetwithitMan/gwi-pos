// Shared Types for GWI POS
// Consolidated type definitions used across the application

import type { IngredientModification } from './orders'

/**
 * Category for menu organization
 *
 * This is the canonical Category type. All consumers MUST import from here.
 * Use Pick<Category, ...> for lightweight subsets — do NOT define local interfaces.
 */
export interface Category {
  id: string
  name: string
  color?: string
  categoryType?: 'food' | 'drinks' | 'liquor' | 'entertainment' | 'combos' | 'pizza' | 'retail' | string
  categoryShow?: string  // 'bar' | 'food' | 'entertainment' | 'all'
  itemCount?: number
  isActive?: boolean
  printerIds?: string[] | null
}

// ─── Category Pick Types ─────────────────────────────────────────────────────

/** Minimal fields for category selection / display */
export type CategoryBasic = Pick<Category, 'id' | 'name'>

/** Fields for the floor plan categories bar */
export type CategoryFloorPlan = Pick<Category, 'id' | 'name' | 'color' | 'itemCount' | 'categoryType' | 'categoryShow'>

/**
 * Pricing option within a pricing option group (e.g., "Small", "Large", "Hot")
 */
export interface PricingOption {
  id: string
  label: string
  price: number | null   // null = label-only (no price override)
  priceCC: number | null  // Cash/card price variant
  sortOrder: number
  isDefault: boolean
  showOnPos: boolean     // Show as quick pick button on POS (max 4 displayed)
  color: string | null
}

/**
 * Pricing option group attached to a menu item (e.g., "Choose Size")
 */
export interface PricingOptionGroup {
  id: string
  name: string
  sortOrder: number
  isRequired: boolean
  showAsQuickPick: boolean
  options: PricingOption[]
}

/**
 * Menu item with pricing and availability
 *
 * This is the canonical MenuItem type. All consumers MUST import from here.
 * Use Pick<MenuItem, ...> for lightweight subsets — do NOT define local interfaces.
 */
export interface MenuItem {
  id: string
  categoryId: string
  name: string
  price: number
  description?: string | null
  isActive?: boolean
  isAvailable: boolean
  modifierGroupCount?: number
  itemType?: string
  categoryType?: string
  hasModifiers?: boolean
  isPizza?: boolean
  timedPricing?: {
    per15Min?: number
    per30Min?: number
    perHour?: number
    minimum?: number
  } | null
  // Entertainment item fields
  entertainmentStatus?: 'available' | 'in_use' | 'maintenance' | 'reserved' | null
  currentOrderId?: string | null
  blockTimeMinutes?: number | null  // Default block time for entertainment items
  ratePerMinute?: number | null
  prepaidPackages?: any[] | null
  happyHourEnabled?: boolean | null
  happyHourPrice?: number | null
  waitlistCount?: number
  // Prep stock / 86 status
  stockStatus?: 'ok' | 'low' | 'critical' | 'out'
  stockCount?: number | null
  stockIngredientName?: string | null
  is86d?: boolean
  reasons86d?: string[]
  // Pour size options for liquor items (can be old or new format)
  // Old format: { shot: 1.0, double: 2.0 }
  // New format: { shot: { label: "Shot", multiplier: 1.0, customPrice?: 11.00 }, double: { label: "Double", multiplier: 2.0 } }
  // Metadata key: _hideDefaultOnPos (boolean) — when true, the default pour size button is hidden on POS
  pourSizes?: Record<string, number | { label: string; multiplier: number; customPrice?: number | null }> & { _hideDefaultOnPos?: boolean } | null
  defaultPourSize?: string | null
  applyPourToModifiers?: boolean
  // Liquor item flag
  isLiquorItem?: boolean
  // Weight-based selling (scale integration)
  soldByWeight?: boolean
  weightUnit?: string | null
  pricePerWeightUnit?: number | null
  // Pricing option groups (size/variant pricing)
  pricingOptionGroups?: PricingOptionGroup[]
  hasPricingOptions?: boolean
  // Allergen tracking
  allergens?: string[]
  // Calories (informational)
  calories?: number | null
  // Age verification
  isAgeRestricted?: boolean
  // Force-open modifier modal on every tap
  alwaysOpenModifiers?: boolean
  // Tip-exempt — excluded from tip suggestion calculations
  tipExempt?: boolean
  // Image URL (online ordering, menu display)
  imageUrl?: string | null
  // Printer routing
  printerIds?: string[] | null
  backupPrinterIds?: string[] | null
}

// ─── MenuItem Pick Types ─────────────────────────────────────────────────────
// Use these for lightweight consumers instead of defining local interfaces.

/** Minimal fields for search results */
export type MenuItemSearch = Pick<MenuItem, 'id' | 'name' | 'price' | 'categoryId' | 'is86d'>

/** Fields needed for the floor plan / POS item grid */
export type MenuItemFloorPlan = Pick<MenuItem,
  | 'id' | 'name' | 'price' | 'description' | 'categoryId' | 'categoryType'
  | 'hasModifiers' | 'isPizza' | 'itemType' | 'entertainmentStatus' | 'waitlistCount'
  | 'blockTimeMinutes' | 'modifierGroupCount' | 'timedPricing'
  | 'stockStatus' | 'stockCount' | 'stockIngredientName' | 'is86d' | 'reasons86d'
  | 'pricingOptionGroups' | 'hasPricingOptions' | 'calories' | 'alwaysOpenModifiers'
  | 'pourSizes' | 'defaultPourSize' | 'applyPourToModifiers' | 'isLiquorItem'
  | 'isAvailable'
>

/** Minimal fields for prep station assignment */
export type MenuItemPrepStation = Pick<MenuItem, 'id' | 'name' | 'categoryId'>

/** Minimal fields for basic item editor display */
export type MenuItemEditorSummary = Pick<MenuItem,
  'id' | 'name' | 'price' | 'description' | 'categoryId' | 'categoryType' | 'isActive' | 'isAvailable'
>

/**
 * Custom pre-modifier for a modifier (e.g., "Well Done", "Medium Rare")
 */
export interface CustomPreMod {
  name: string
  shortLabel?: string
  kitchenLabel?: string
  color?: string  // hex color for button display (e.g., "#ef4444")
  priceAdjustment: number  // cents
  multiplier: number
  sortOrder: number
  isActive: boolean
}

/**
 * Modifier within a modifier group
 */
export interface Modifier {
  id: string
  name: string
  price: number
  upsellPrice?: number | null
  allowedPreModifiers?: string[] | null
  allowNo?: boolean
  allowLite?: boolean
  allowExtra?: boolean
  allowOnSide?: boolean
  extraPrice?: number | null
  isDefault: boolean
  childModifierGroupId?: string | null
  // Spirit selection fields (Liquor Builder)
  spiritTier?: 'well' | 'call' | 'premium' | 'top_shelf' | null
  linkedBottleProductId?: string | null
  linkedBottleProduct?: {
    id: string
    name: string
    pourCost: number | null
  } | null
  is86d?: boolean
  isLabel?: boolean
  // Bar hot button — shows as quick-access button in modifier modal
  showAsHotButton?: boolean
  // Display/visibility
  displayName?: string | null
  isActive?: boolean
  showOnPOS?: boolean
  // Lite/Extra multipliers (null → use location defaults: 0.5 / 2.0)
  liteMultiplier?: number | null
  extraMultiplier?: number | null
  // Swap — substitute this modifier with an alternate item
  swapEnabled?: boolean
  swapTargets?: { menuItemId: string; name: string; snapshotPrice: number; pricingMode: 'target_price' | 'fixed_price' | 'no_charge'; fixedPrice?: number | null; sortOrder: number }[] | null
  customPreModifiers?: CustomPreMod[] | null
}

/**
 * Group of modifiers for an item
 */
export interface ModifierGroup {
  id: string
  name: string
  displayName?: string
  minSelections: number
  maxSelections: number
  isRequired: boolean
  allowStacking?: boolean  // Allow selecting the same modifier multiple times (e.g., 2x Fries for 2 side choices)
  // Tiered pricing configuration
  tieredPricingConfig?: {
    enabled: boolean
    modes: { flat_tiers: boolean; free_threshold: boolean }
    flat_tiers?: {
      tiers: Array<{ upTo: number; price: number }>
      overflowPrice: number
    }
    free_threshold?: {
      freeCount: number
    }
  } | null
  // Exclusion group key for cross-group duplicate prevention
  exclusionGroupKey?: string | null
  modifiers: Modifier[]
  // Modifier types for filtering/coloring
  modifierTypes?: string[]  // e.g., ['liquor'], ['food', 'combo'], etc.
  // Open entry (custom request) support
  allowOpenEntry?: boolean
  // Allow None — show "None" button on required groups
  allowNone?: boolean
  // Whether "None" selection prints to kitchen tickets/KDS
  nonePrintsToKitchen?: boolean
  // Whether "None" selection shows on customer receipts
  noneShowOnReceipt?: boolean
  // Spirit group fields (Liquor Builder)
  isSpiritGroup?: boolean
  spiritConfig?: {
    spiritCategoryId: string
    spiritCategoryName: string
    upsellEnabled: boolean
    upsellPromptText?: string | null
    defaultTier: string
  } | null
}

/**
 * A modifier that has been selected for an order item
 */
export interface SelectedModifier {
  id: string
  name: string
  price: number
  preModifier?: string  // 'no', 'light', 'extra', etc.
  childModifierGroupId?: string | null
  depth: number         // 0 = top-level, 1 = child, 2 = grandchild, etc.
  parentModifierId?: string  // ID of parent modifier if this is a child
  // Spirit selection fields (Liquor Builder)
  spiritTier?: 'well' | 'call' | 'premium' | 'top_shelf' | null
  linkedBottleProductId?: string | null
  // Open-entry custom request modifier (freeform text from POS)
  isCustomEntry?: boolean
  // None selection — explicit "None" chosen on a required modifier group
  isNoneSelection?: boolean
  // Whether this None selection should show on customer receipts
  noneShowOnReceipt?: boolean
  // Swap fields — when a modifier is swapped for an alternate item
  swapTargetName?: string
  swapTargetItemId?: string
  swapPricingMode?: 'target_price' | 'fixed_price' | 'no_charge'
  swapEffectivePrice?: number
  customPreModifier?: string  // Name of selected custom pre-mod (e.g., "Well Done")
}

/**
 * An item on an order with its modifiers
 * @deprecated Use InlineOrderItem from @/types/orders instead
 */
export interface OrderItem {
  id: string
  menuItemId: string
  name: string
  quantity: number
  price: number
  modifiers: { id: string; name: string; price: number; depth?: number; preModifier?: string | null; modifierId?: string | null; spiritTier?: string | null; linkedBottleProductId?: string | null; parentModifierId?: string | null }[]
  specialNotes?: string
  status?: 'pending' | 'sent' | 'preparing' | 'ready' | 'served' | 'voided' | 'comped'
  voidReason?: string
  sentToKitchen?: boolean
  seatNumber?: number
  courseNumber?: number
  holdUntil?: Date | null
  firedAt?: Date | null
  ingredientModifications?: IngredientModification[]
  // Pizza builder configuration (for pizza items)
  pizzaConfig?: PizzaOrderConfig
}

/**
 * Combo template component with options
 */
export interface ComboComponent {
  id: string
  slotName: string
  displayName: string
  sortOrder: number
  isRequired: boolean
  minSelections: number
  maxSelections: number
  menuItemId?: string | null
  menuItem?: {
    id: string
    name: string
    price: number
    modifierGroups?: {
      modifierGroup: ModifierGroup
    }[]
  } | null
  itemPriceOverride?: number | null
  modifierPriceOverrides?: Record<string, number> | null
  options: {
    id: string
    menuItemId: string
    name: string
    upcharge: number
    sortOrder: number
    isAvailable: boolean
  }[]
}

/**
 * Combo template structure
 */
export interface ComboTemplate {
  id: string
  basePrice: number
  comparePrice?: number | null
  components: ComboComponent[]
}

/**
 * Payment information for an order
 */
export interface PaymentInfo {
  id: string
  method: 'cash' | 'credit' | 'debit' | 'gift_card' | 'house_account'
  amount: number
  tipAmount: number
  totalAmount: number
  cardLast4?: string
  giftCardNumber?: string
  houseAccountId?: string
  changeGiven?: number
}

/**
 * Order status enum
 */
export type OrderStatus = 'open' | 'paid' | 'closed' | 'voided' | 'refunded'

/**
 * Timed session for entertainment items
 */
export interface TimedSession {
  id: string
  orderItemId: string
  menuItemName: string
  startTime: string
  rateType: 'per_15_min' | 'per_30_min' | 'per_hour' | 'flat_rate'
  rateAmount: number
  currentAmount: number
  elapsedMinutes: number
  status: 'active' | 'paused' | 'stopped'
  tableName?: string
}

/**
 * Tab for bar/quick service
 */
export interface Tab {
  id: string
  name: string
  status: 'open' | 'paid' | 'closed'
  preAuthAmount?: number
  cardLast4?: string
  employeeId: string
  employeeName?: string
  subtotal: number
  items: OrderItem[]
  createdAt: string
}

/**
 * Employee with role and permissions
 */
export interface Employee {
  id: string
  name: string
  email?: string
  roleId: string
  roleName?: string
  permissions?: string[]
  isActive: boolean
  location?: {
    id: string
    name: string
  }
}

/**
 * Customer with loyalty and account info
 */
export interface Customer {
  id: string
  firstName: string
  lastName: string
  email?: string
  phone?: string
  loyaltyPoints?: number
  houseAccountId?: string
  createdAt: string
}

/**
 * Discount applied to an order
 */
export interface AppliedDiscount {
  id: string
  name: string
  amount: number
  percent?: number | null
  discountType: 'percent' | 'fixed' | 'bogo' | 'item' | 'category'
}

/**
 * Gift card information
 */
export interface GiftCard {
  id: string
  cardNumber: string
  balance: number
  originalAmount: number
  status: 'active' | 'depleted' | 'deactivated'
  expiresAt?: string
}

/**
 * House account for business customers
 */
export interface HouseAccount {
  id: string
  name: string
  companyName?: string
  creditLimit: number
  currentBalance: number
  status: 'active' | 'suspended' | 'closed'
}

// ==================== Pizza Builder Types ====================

/**
 * Pizza configuration for a location
 */
export interface PizzaConfig {
  id: string
  locationId: string
  maxSections: number
  defaultSections: number
  sectionOptions: number[]
  pricingMode: 'fractional' | 'flat' | 'hybrid'
  hybridPricing?: { whole: number; half: number; quarter: number; eighth: number } | null
  freeToppingsEnabled: boolean
  freeToppingsCount: number
  freeToppingsMode: 'per_pizza' | 'per_size'
  extraToppingPrice?: number | null
  showVisualBuilder: boolean
  showToppingList: boolean
  defaultToListView: boolean
  // Builder mode settings (Skill 109)
  builderMode: 'quick' | 'visual' | 'both'
  defaultBuilderMode: 'quick' | 'visual'
  allowModeSwitch: boolean
  // Per-section condiment support (Android parity)
  allowCondimentSections?: boolean
  condimentDivisionMax?: number  // 1=whole only, 2=halves max
}

/**
 * Pizza size option
 */
export interface PizzaSize {
  id: string
  locationId: string
  name: string
  displayName?: string | null
  inches?: number | null
  slices: number
  basePrice: number
  priceMultiplier: number
  toppingMultiplier: number
  freeToppings: number
  sortOrder: number
  isDefault: boolean
  isActive: boolean
}

/**
 * Pizza crust option
 */
export interface PizzaCrust {
  id: string
  locationId: string
  name: string
  displayName?: string | null
  price: number
  isDefault: boolean
  isActive: boolean
  sortOrder: number
}

/**
 * Pizza sauce option
 */
export interface PizzaSauce {
  id: string
  locationId: string
  name: string
  displayName?: string | null
  price: number
  isDefault: boolean
  isActive: boolean
  sortOrder: number
  allowLight: boolean
  allowExtra: boolean
  extraPrice: number
}

/**
 * Pizza cheese option
 */
export interface PizzaCheese {
  id: string
  locationId: string
  name: string
  displayName?: string | null
  price: number
  isDefault: boolean
  isActive: boolean
  sortOrder: number
  allowLight: boolean
  allowExtra: boolean
  extraPrice: number
}

/**
 * Pizza topping option
 */
export interface PizzaTopping {
  id: string
  locationId: string
  name: string
  displayName?: string | null
  category: 'meat' | 'veggie' | 'cheese' | 'premium' | 'seafood' | 'standard'
  price: number
  extraPrice?: number | null
  isActive: boolean
  sortOrder: number
  color?: string | null
  iconUrl?: string | null
}

/**
 * Selected topping on a pizza with section coverage
 */
export interface PizzaToppingSelection {
  toppingId: string
  name: string
  sections: number[]
  amount: 'light' | 'regular' | 'extra'
  price: number
  basePrice: number
}

/**
 * Pizza specialty (pre-built pizza)
 */
export interface PizzaSpecialty {
  id: string
  locationId: string
  menuItemId: string
  menuItem: {
    id: string
    name: string
    price: number
  }
  defaultCrustId?: string | null
  defaultCrust?: PizzaCrust | null
  defaultSauceId?: string | null
  defaultSauce?: PizzaSauce | null
  defaultCheeseId?: string | null
  defaultCheese?: PizzaCheese | null
  sauceAmount: 'none' | 'light' | 'regular' | 'extra'
  cheeseAmount: 'none' | 'light' | 'regular' | 'extra'
  toppings: Array<{
    toppingId: string
    name: string
    sections: number[]
    amount: 'light' | 'regular' | 'extra'
  }>
  allowSizeChange: boolean
  allowCrustChange: boolean
  allowSauceChange: boolean
  allowCheeseChange: boolean
  allowToppingMods: boolean
}

/**
 * Sauce selection with sections (like toppings)
 */
export interface PizzaSauceSelection {
  sauceId: string
  name: string
  sections: number[]
  amount: 'none' | 'light' | 'regular' | 'extra'
  price: number
}

/**
 * Cheese selection with sections (like toppings)
 */
export interface PizzaCheeseSelection {
  cheeseId: string
  name: string
  sections: number[]
  amount: 'none' | 'light' | 'regular' | 'extra'
  price: number
}

/**
 * Full pizza order configuration
 */
export interface PizzaOrderConfig {
  sizeId: string
  crustId: string
  // Legacy fields for backwards compatibility
  sauceId: string | null
  cheeseId: string | null
  sauceAmount: 'none' | 'light' | 'regular' | 'extra'
  cheeseAmount: 'none' | 'light' | 'regular' | 'extra'
  // New sectional arrays
  sauces?: PizzaSauceSelection[]
  cheeses?: PizzaCheeseSelection[]
  toppings: PizzaToppingSelection[]
  cookingInstructions?: string
  cutStyle?: string
  specialNotes?: string
  totalPrice: number
  priceBreakdown: {
    sizePrice: number
    crustPrice: number
    saucePrice: number
    cheesePrice: number
    toppingsPrice: number
  }
}

// ─── OpenOrder Types ─────────────────────────────────────────────────────────

/**
 * Open order summary for list panels and dashboards.
 *
 * This is the canonical OpenOrder type. All consumers MUST import from here.
 * Use Pick<OpenOrder, ...> for lightweight subsets.
 */
export interface OpenOrder {
  id: string
  orderNumber: number
  displayNumber?: string
  isSplitTicket?: boolean
  status?: string
  orderType: string
  orderTypeConfig?: { name: string; color?: string | null; icon?: string | null } | null
  customFields?: Record<string, string> | null
  tabName?: string | null
  tabStatus?: string | null
  cardholderName?: string | null
  tableId?: string | null
  tableName?: string | null
  table?: { id: string; name: string; section: string | null } | null
  customer?: { id: string; firstName: string; lastName: string; phone: string | null } | null
  employee?: { id: string; name: string } | null
  employeeName?: string
  itemCount: number
  subtotal?: number
  taxTotal?: number
  tipTotal?: number
  total: number
  ageMinutes?: number
  isRolledOver?: boolean
  rolledOverAt?: string | null
  rolledOverFrom?: string | null
  isCaptureDeclined?: boolean
  captureRetryCount?: number
  openedAt?: string
  createdAt?: string
}

/** Minimal open order for shift handoff */
export type OpenOrderHandoff = Pick<OpenOrder, 'id' | 'orderNumber' | 'tabName' | 'status' | 'total'>

/** Open order for floor plan display */
export type OpenOrderFloorPlan = Pick<OpenOrder,
  'id' | 'orderNumber' | 'tableId' | 'tableName' | 'tabName' | 'orderType' | 'total' | 'itemCount' | 'openedAt' | 'employeeName'
>

// Re-export payment types
export type {
  CardReadMethod,
  CardReaderState,
} from './payment'
