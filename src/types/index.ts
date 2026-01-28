// Shared Types for GWI POS
// Consolidated type definitions used across the application

/**
 * Category for menu organization
 */
export interface Category {
  id: string
  name: string
  color: string
  categoryType?: 'food' | 'drinks' | 'liquor' | 'entertainment' | 'combos'
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
  // Entertainment item status
  entertainmentStatus?: 'available' | 'in_use' | 'maintenance' | null
  currentOrderId?: string | null
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
  modifiers: Modifier[]
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
