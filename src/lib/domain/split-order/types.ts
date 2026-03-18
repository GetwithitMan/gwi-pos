/**
 * Split Order Domain Types
 *
 * Framework-agnostic types for the split order domain module.
 */

import { db } from '@/lib/db'

// ─── Transaction Client ──────────────────────────────────────────────────────

export type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0]

// ─── Split Types ─────────────────────────────────────────────────────────────

export type SplitType = 'even' | 'by_item' | 'by_seat' | 'by_table' | 'custom_amount' | 'get_splits'

export interface SplitRequest {
  type: SplitType
  employeeId?: string
  numWays?: number
  itemIds?: string[]
  amount?: number
}

// ─── Order Shape (what the route fetches & passes in) ────────────────────────

/** Modifier on an order item (from Prisma include) */
export interface SplitOrderItemModifier {
  id: string
  modifierId: string | null
  name: string
  price: any // Prisma Decimal
  quantity: number
  preModifier: string | null
  depth: number
  commissionAmount: any | null // Prisma Decimal
  linkedMenuItemId: string | null
  linkedMenuItemName: string | null
  linkedMenuItemPrice: any | null // Prisma Decimal
  spiritTier: string | null
  linkedBottleProductId: string | null
  isCustomEntry: boolean
  isNoneSelection: boolean
  customEntryName: string | null
  customEntryPrice: any | null // Prisma Decimal
  swapTargetName: string | null
  swapTargetItemId: string | null
  swapPricingMode: string | null
  swapEffectivePrice: any | null // Prisma Decimal
}

/** Item-level discount (from Prisma include) */
export interface SplitItemDiscount {
  id: string
  discountRuleId: string | null
  amount: any // Prisma Decimal
  percent: any | null
  appliedById: string | null
  reason: string | null
  deletedAt: Date | null
}

/** Order item as fetched for split operations */
export interface SplitOrderItem {
  id: string
  menuItemId: string | null
  name: string
  price: any // Prisma Decimal
  quantity: number
  itemTotal: any // Prisma Decimal
  specialNotes: string | null
  seatNumber: number | null
  courseNumber: number | null
  sourceTableId: string | null
  blockTimeMinutes: number | null
  blockTimeStartedAt: Date | null
  blockTimeExpiresAt: Date | null
  isTaxInclusive?: boolean
  pricingRuleApplied?: unknown  // PricingAdjustment JSONB — preserved through splits
  modifiers: SplitOrderItemModifier[]
  menuItem?: { id: string; itemType: string | null } | null
  itemDiscounts?: SplitItemDiscount[]
}

/** Order discount (from Prisma include) */
export interface SplitOrderDiscount {
  id: string
  discountRuleId: string | null
  couponId: string | null
  couponCode: string | null
  name: string
  amount: any // Prisma Decimal
  percent: any | null
  appliedBy: string | null
  isAutomatic: boolean
  reason: string | null
}

/** Payment summary */
export interface SplitPayment {
  totalAmount: any // Prisma Decimal
  status: string
}

/** Split order child (for get_splits) */
export interface SplitChildSummary {
  id: string
  orderNumber: number
  splitIndex: number | null
  parentOrderId: string | null
  displayNumber: string | null
  total: any
  status: string
  payments: SplitPayment[]
  items?: unknown[]
  splitOrders?: unknown[]
}

/** The full order shape passed to domain functions */
export interface SplitSourceOrder {
  id: string
  orderNumber: number
  splitIndex?: number | null
  displayNumber: string | null
  locationId: string
  employeeId: string
  customerId: string | null
  orderType: string | null
  status: string
  tableId: string | null
  tabName: string | null
  parentOrderId: string | null
  subtotal: any // Prisma Decimal
  discountTotal: any
  taxTotal: any
  taxFromInclusive: any
  taxFromExclusive: any
  total: any
  notes: string | null
  items: SplitOrderItem[]
  discounts: SplitOrderDiscount[]
  payments: SplitPayment[]
  splitOrders: SplitChildSummary[]
  parentOrder?: (SplitChildSummary & { splitOrders: SplitChildSummary[] }) | null
  location: { settings: unknown }
}

// ─── Result Types ────────────────────────────────────────────────────────────

export interface EvenSplitChild {
  id: string
  orderNumber: number
  splitIndex: number | null
  displayNumber: string | null
  total: any
}

export interface EvenSplitResult {
  splitOrders: EvenSplitChild[]
}

export interface ItemSplitResult {
  newOrder: {
    id: string
    orderNumber: number
    splitIndex: number | null
    displayNumber: string | null
    total: any
    taxTotal: any
    items: Array<{
      id: string
      menuItemId: string | null
      name: string
      quantity: number
      price: any
      seatNumber: number | null
      specialNotes: string | null
      isTaxInclusive: boolean
      modifiers: SplitOrderItemModifier[]
    }>
  }
  remainingSubtotal: number
  remainingTax: number
  remainingTotal: number
  remainingItems: SplitOrderItem[]
  baseOrderNumber: number
  nextSplitIndex: number
}

export interface SeatSplitChildSummary {
  id: string
  orderNumber: number
  splitIndex: number | null
  displayNumber: string
  seatNumber: number | null
  total: number
  itemCount: number
  paidAmount: number
  isPaid: boolean
}

export interface SeatSplitResult {
  splitOrders: SeatSplitChildSummary[]
  itemIdsToRemove: string[]
  remainingItems: SplitOrderItem[]
  remainingTotal: number
}

export interface TableSplitChildSummary {
  id: string
  orderNumber: number
  splitIndex: number | null
  displayNumber: string
  tableId: string
  tableName: string
  total: number
  itemCount: number
  paidAmount: number
  isPaid: boolean
}

export interface TableSplitResult {
  splitOrders: TableSplitChildSummary[]
  itemIdsToRemove: string[]
  remainingItems: SplitOrderItem[]
  remainingTotal: number
}

export interface CustomSplitResult {
  orderId: string
  orderNumber: number
  displayNumber: string
  originalTotal: number
  paidAmount: number
  remainingBalance: number
  splitAmount: number
  newRemaining: number
}

export interface GetSplitsResult {
  splits: Array<{
    id: string
    orderNumber: number
    splitIndex: number | null
    displayNumber: string
    total: number
    paidAmount: number
    isPaid: boolean
    itemCount: number
    isParent: boolean
  }>
  currentSplitId: string
}
