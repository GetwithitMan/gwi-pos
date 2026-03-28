/**
 * Shared types for floor plan components.
 * Extracted from FloorPlanHome.tsx to enable sub-component decomposition.
 *
 * MenuItem, Category, OpenOrder are re-exported from @/types.
 * InlineOrderItem, ViewMode, QuickOrderType, FloorPlanHomeProps are defined here.
 */

// Re-export types used across floor plan sub-components
export type { MenuItem, PricingOption } from '@/types'
export type { CategoryFloorPlan as Category } from '@/types'
export type { OpenOrderFloorPlan as OpenOrder } from '@/types'
export type { PizzaOrderConfig } from '@/types'
export type { OrderTypeConfig } from '@/types/order-types'
export type { FloorPlanTable, FloorPlanSection, FloorPlanElement } from './use-floor-plan'

// InlineOrderItem: derived type from the inlineOrderItems memo.
// Kept as a named type alias for use in function signatures throughout floor plan components.
export type InlineOrderItem = {
  id: string
  menuItemId: string
  name: string
  price: number
  quantity: number
  modifiers?: { id: string; name: string; price: number; depth?: number; preModifier?: string | null; modifierId?: string | null; spiritTier?: string | null; linkedBottleProductId?: string | null; parentModifierId?: string | null }[]
  specialNotes?: string
  seatNumber?: number
  sourceTableId?: string
  courseNumber?: number
  courseStatus?: 'pending' | 'fired' | 'ready' | 'served'
  isHeld?: boolean
  sentToKitchen?: boolean
  isCompleted?: boolean
  status?: 'active' | 'voided' | 'comped'
  voidReason?: string
  wasMade?: boolean
  isTimedRental?: boolean
  blockTimeMinutes?: number
  blockTimeStartedAt?: string
  blockTimeExpiresAt?: string
  kitchenStatus?: 'pending' | 'cooking' | 'ready' | 'delivered'
  completedAt?: string
  resendCount?: number
  resendNote?: string
  createdAt?: string
  delayMinutes?: number | null
  delayStartedAt?: string | null
  delayFiredAt?: string | null
  splitLabel?: string
  ingredientModifications?: {
    ingredientId: string
    name: string
    modificationType: 'no' | 'lite' | 'on_side' | 'extra' | 'swap'
    priceAdjustment: number
    swappedTo?: { modifierId: string; name: string; price: number }
  }[]
  categoryType?: string
}

// View mode: tables (floor plan) or menu (category items)
export type ViewMode = 'tables' | 'menu'

// Order type for quick order buttons
export type QuickOrderType = string
