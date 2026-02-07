// Shared Types for GWI POS
// Consolidated type definitions used across the application

/**
 * Category for menu organization
 */
export interface Category {
  id: string
  name: string
  color: string
  categoryType?: 'food' | 'drinks' | 'liquor' | 'entertainment' | 'combos' | 'pizza'
}

/**
 * Menu item with pricing and availability
 */
export interface MenuItem {
  id: string
  categoryId: string
  name: string
  price: number
  isAvailable: boolean
  modifierGroupCount?: number
  itemType?: string
  timedPricing?: {
    per15Min?: number
    per30Min?: number
    perHour?: number
    minimum?: number
  }
  // Entertainment item fields
  entertainmentStatus?: 'available' | 'in_use' | 'maintenance' | null
  currentOrderId?: string | null
  blockTimeMinutes?: number | null  // Default block time for entertainment items
  // Pour size options for liquor items (can be old or new format)
  // Old format: { shot: 1.0, double: 2.0 }
  // New format: { shot: { label: "Shot", multiplier: 1.0 }, double: { label: "Double", multiplier: 2.0 } }
  pourSizes?: Record<string, number | { label: string; multiplier: number }> | null
  defaultPourSize?: string | null
  applyPourToModifiers?: boolean
  // Liquor item flag
  isLiquorItem?: boolean
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
}

/**
 * An item on an order with its modifiers
 */
export interface OrderItem {
  id: string
  menuItemId: string
  name: string
  quantity: number
  price: number
  modifiers: { id: string; name: string; price: number; preModifier?: string }[]
  specialNotes?: string
  status?: 'pending' | 'sent' | 'preparing' | 'ready' | 'served' | 'voided' | 'comped'
  voidReason?: string
  sentToKitchen?: boolean
  seatNumber?: number
  courseNumber?: number
  holdUntil?: Date | null
  firedAt?: Date | null
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
 * Open order summary for display
 */
export interface OpenOrderSummary {
  id: string
  orderNumber: string
  tableId?: string
  tableName?: string
  tabId?: string
  tabName?: string
  employeeId: string
  employeeName: string
  status: OrderStatus
  subtotal: number
  total: number
  itemCount: number
  createdAt: string
  updatedAt: string
}

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

// Re-export payment types (legacy SimulatedCardReader types removed)
export type {
  SimulatedPaymentResult,
  CardReadMethod,
  CardReaderState,
} from './payment'
