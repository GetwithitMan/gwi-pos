/**
 * order-utils.ts — Single source of truth for order-related utilities
 *
 * Contains:
 * - Temp ID generation and detection
 * - Item payload builder (client → API mapping)
 * - Delay/hold state helpers
 * - Reopened order detection
 */

// ════════════════════════════════════════════════════════════════
// TEMP ID MANAGEMENT
// ════════════════════════════════════════════════════════════════

const TEMP_ID_PREFIX = 'temp_'

/** Generate a temporary item ID for client-side items not yet saved to DB */
export function generateTempItemId(): string {
  return `${TEMP_ID_PREFIX}${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/** Check if an ID is a temporary client-side ID (not yet persisted) */
export function isTempId(id: string | undefined | null): boolean {
  if (!id) return true
  // Support both new 'temp_' prefix and legacy 'item_' prefix
  return id.startsWith(TEMP_ID_PREFIX) || id.startsWith('item_') || id.startsWith('local-')
}

// ════════════════════════════════════════════════════════════════
// ITEM PAYLOAD BUILDER
// ════════════════════════════════════════════════════════════════

interface StoreOrderItem {
  id: string
  menuItemId: string
  name: string
  price: number
  quantity: number
  modifiers: Array<{
    id: string
    modifierId?: string | null
    name: string
    price: number
    preModifier?: string | null
    depth?: number
    commissionAmount?: number
    parentModifierId?: string | null
    spiritTier?: string | null
    linkedBottleProductId?: string | null
  }>
  ingredientModifications?: Array<{
    ingredientId: string
    name: string
    modificationType: 'no' | 'lite' | 'on_side' | 'extra' | 'swap'
    priceAdjustment: number
    swappedTo?: { modifierId: string; name: string; price: number }
  }>
  specialNotes?: string
  seatNumber?: number
  courseNumber?: number
  isHeld?: boolean
  delayMinutes?: number | null
  blockTimeMinutes?: number | null
  pizzaConfig?: any
  sourceTableId?: string
}

/**
 * Build the canonical API payload for an order item.
 * Use this EVERYWHERE items are sent to POST /api/orders or POST /api/orders/{id}/items.
 * This is the SINGLE place where store item → API payload mapping happens.
 */
export function buildOrderItemPayload(item: StoreOrderItem, options?: { includeCorrelationId?: boolean }) {
  return {
    menuItemId: item.menuItemId,
    name: item.name,
    price: item.price,
    quantity: item.quantity,
    ...(options?.includeCorrelationId ? { correlationId: item.id } : {}),
    modifiers: item.modifiers.map(mod => ({
      modifierId: mod.modifierId || mod.id || '',
      name: mod.name,
      price: Number(mod.price),
      depth: mod.depth ?? 0,
      preModifier: mod.preModifier ?? null,
      spiritTier: (mod as any).spiritTier ?? null,
      linkedBottleProductId: (mod as any).linkedBottleProductId ?? null,
      parentModifierId: mod.parentModifierId ?? null,
    })),
    ingredientModifications: item.ingredientModifications?.map(ing => ({
      ingredientId: ing.ingredientId,
      name: ing.name,
      modificationType: ing.modificationType,
      priceAdjustment: ing.priceAdjustment,
      swappedTo: ing.swappedTo,
    })),
    specialNotes: item.specialNotes || null,
    seatNumber: item.seatNumber || null,
    courseNumber: item.courseNumber || null,
    isHeld: item.isHeld || false,
    delayMinutes: item.delayMinutes || null,
    blockTimeMinutes: item.blockTimeMinutes || null,
    pizzaConfig: item.pizzaConfig,
  }
}

// ════════════════════════════════════════════════════════════════
// DELAY / HOLD STATE HELPERS
// ════════════════════════════════════════════════════════════════

interface DelayableItem {
  delayMinutes?: number | null
  delayStartedAt?: string | null
  delayFiredAt?: string | null
  sentToKitchen?: boolean
  isHeld?: boolean
  kitchenStatus?: string
}

/** Item has no delay and no hold — fires immediately on Send */
export function isImmediate(item: DelayableItem): boolean {
  return !item.isHeld && (!item.delayMinutes || item.delayMinutes <= 0)
}

/** Item has a delay preset but timer hasn't started yet (pre-Send) */
export function isDelayedPending(item: DelayableItem): boolean {
  return !!(item.delayMinutes && item.delayMinutes > 0 && !item.delayStartedAt && !item.delayFiredAt)
}

/** Item has an active countdown timer running (post-Send, pre-fire) */
export function isOnDelayTimer(item: DelayableItem): boolean {
  return !!(
    item.delayMinutes && item.delayMinutes > 0 &&
    item.delayStartedAt &&
    !item.delayFiredAt &&
    !item.sentToKitchen
  )
}

/** Item's delay has completed and it was fired to kitchen */
export function isDelayFired(item: DelayableItem): boolean {
  return !!(
    item.delayMinutes && item.delayMinutes > 0 &&
    (item.delayFiredAt || item.sentToKitchen)
  )
}

// ════════════════════════════════════════════════════════════════
// ORDER STATE HELPERS
// ════════════════════════════════════════════════════════════════

interface ReopenableOrder {
  reopenedAt?: string | null
  reopenReason?: string | null
}

/** Check if an order was reopened after being closed */
export function isReopened(order: ReopenableOrder | null | undefined): boolean {
  return !!order?.reopenedAt
}
