/**
 * Orders Domain Type Definitions
 * This file contains types specific to the orders domain.
 */

/**
 * Canonical modifier shape used throughout the application.
 * This ensures modifiers maintain ALL their data through every operation.
 *
 * IMPORTANT: This is the SINGLE SOURCE OF TRUTH for modifier data structure.
 * All modifier mappings MUST include all these fields to prevent data loss.
 */
export interface UiModifier {
  id: string                     // Synthetic or DB id (use || operator to ensure string)
  modifierId?: string | null     // Real DB modifier id when present
  name: string
  price: number
  depth?: number                 // Hierarchy depth (0=top level)
  preModifier?: string | null    // "No", "Lite", "Extra", etc.
  spiritTier?: string | null     // "Well", "Call", "Premium", "Top Shelf"
  linkedBottleProductId?: string | null  // For spirit upgrades
  parentModifierId?: string | null       // For tracking modifier hierarchy
}

/**
 * An inline order item representation with complete modifier data
 */
export interface InlineOrderItem {
  id: string                    // DB id once saved, temp UUID before
  correlationId?: string        // Stable ID for matching before save (client-side tracking)
  menuItemId: string
  name: string
  price: number
  quantity: number
  modifiers: UiModifier[]  // Uses canonical type
  specialNotes?: string
  status?: 'pending' | 'sent' | 'preparing' | 'ready' | 'served' | 'voided' | 'comped'
  voidReason?: string
  sentToKitchen?: boolean
  seatNumber?: number
  courseNumber?: number
  holdUntil?: Date | null
  firedAt?: Date | null
  isHeld?: boolean
  blockTimeMinutes?: number
}

/** Ingredient modification types — single source of truth */
export type IngredientModificationType = 'no' | 'lite' | 'on_side' | 'extra' | 'swap'

/** Ingredient modification on an order item */
export interface IngredientModification {
  ingredientId: string
  name: string
  modificationType: IngredientModificationType
  priceAdjustment: number
  swappedTo?: { modifierId: string; name: string; price: number }
}
