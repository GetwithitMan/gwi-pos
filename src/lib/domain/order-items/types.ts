/**
 * Order Items Domain Types
 *
 * Domain-level types for order item operations.
 * No framework imports (NextRequest/NextResponse) — route-agnostic.
 */

import type { Prisma } from '@prisma/client'

// ─── Transaction Client ─────────────────────────────────────────────────────

export type TxClient = Prisma.TransactionClient

// ─── Modifier Input ─────────────────────────────────────────────────────────

export interface ModifierInput {
  modifierId: string
  name: string
  price: number
  preModifier?: string
  depth?: number
  spiritTier?: string
  linkedBottleProductId?: string
}

// ─── Ingredient Modification Input ──────────────────────────────────────────

export interface IngredientModificationInput {
  ingredientId: string
  name: string
  modificationType: 'no' | 'lite' | 'on_side' | 'extra' | 'swap'
  priceAdjustment: number
  swappedTo?: {
    modifierId: string
    name: string
    price: number
  }
}

// ─── Pizza Config ───────────────────────────────────────────────────────────

export interface PizzaPriceBreakdown {
  sizePrice: number
  crustPrice: number
  saucePrice: number
  cheesePrice: number
  toppingsPrice: number
}

export interface PizzaConfig {
  sizeId: string
  crustId: string
  sauceId?: string
  cheeseId?: string
  sauceAmount?: 'none' | 'light' | 'regular' | 'extra'
  cheeseAmount?: 'none' | 'light' | 'regular' | 'extra'
  toppings?: unknown[]
  sauces?: unknown[]
  cheeses?: unknown[]
  cookingInstructions?: string
  cutStyle?: string
  totalPrice: number
  priceBreakdown: PizzaPriceBreakdown
}

// ─── Add Item Input ─────────────────────────────────────────────────────────

export interface AddItemInput {
  menuItemId: string
  name: string
  price: number
  quantity: number
  pourSize?: string
  pourMultiplier?: number
  correlationId?: string
  modifiers: ModifierInput[]
  ingredientModifications?: IngredientModificationInput[]
  specialNotes?: string
  seatNumber?: number | null
  courseNumber?: number | null
  isHeld?: boolean
  delayMinutes?: number | null
  pizzaConfig?: PizzaConfig
  blockTimeMinutes?: number
  soldByWeight?: boolean
  weight?: number
  weightUnit?: string
  unitPrice?: number
  grossWeight?: number
  tareWeight?: number
  pricingOptionId?: string
  pricingOptionLabel?: string
}

// ─── Update Item Input ──────────────────────────────────────────────────────

export interface UpdateItemInput {
  seatNumber?: number | null
  courseNumber?: number | null
  courseStatus?: string
  isHeld?: boolean
  holdUntil?: string | null
  specialNotes?: string
  quantity?: number
}

// ─── Item Action ────────────────────────────────────────────────────────────

export type ItemAction =
  | 'assign_seat'
  | 'assign_course'
  | 'fire_course'
  | 'mark_ready'
  | 'mark_served'
  | 'hold'
  | 'fire'
  | 'release'

// ─── Validation Results ─────────────────────────────────────────────────────

export interface ValidationSuccess {
  valid: true
}

export interface ValidationError {
  valid: false
  error: string
  status: number
}

export type ValidationResult = ValidationSuccess | ValidationError

// ─── Menu Item Info (subset fetched for add-item) ───────────────────────────

export interface MenuItemInfo {
  id: string
  commissionType: string | null
  commissionValue: Prisma.Decimal | null
  itemType: string | null
  isAvailable: boolean
  isActive: boolean
  deletedAt: Date | null
  name: string
  categoryId: string | null
  category: { categoryType: string | null } | null
}

// ─── Item Prep Data (pre-computed item data for creation) ───────────────────

export interface ItemPrepData {
  item: AddItemInput
  effectivePrice: number
  fullItemTotal: number
  itemCommission: number
  menuItem: MenuItemInfo | undefined
  catType: string | null
  itemTaxInclusive: boolean
}

// ─── Order Totals Update (DB write shape) ───────────────────────────────────

export interface OrderTotalsUpdate {
  subtotal: number
  taxTotal: number
  taxFromInclusive: number
  taxFromExclusive: number
  total: number
  commissionTotal: number | undefined
  itemCount: number
}
