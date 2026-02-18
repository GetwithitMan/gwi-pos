/**
 * Public Menu API Types
 *
 * These types define the contracts for online ordering and external menu consumption.
 * They differ from internal types by:
 * - Excluding admin/internal fields
 * - Including computed fields (stockStatus, isOrderableOnline)
 * - Normalizing for client consumption
 */

// Stock status for menu items
export type StockStatus = 'in_stock' | 'low_stock' | 'critical' | 'out_of_stock'

// Base public menu item (what /api/menu/items returns for online ordering)
export interface PublicMenuItem {
  id: string
  name: string
  description: string | null
  price: number
  categoryId: string
  categoryName?: string

  // Availability
  isAvailable: boolean
  stockStatus: StockStatus
  isOrderableOnline: boolean // Computed: isAvailable && stockStatus !== 'out_of_stock' && showOnline

  // Time windows (if configured)
  availableFrom: string | null // HH:MM format
  availableTo: string | null   // HH:MM format
  availableDays: string[] | null // ['monday', 'tuesday', ...]

  // Item type and special configs
  itemType: 'standard' | 'combo' | 'timed_rental'

  // Liquor-specific
  pourSizes?: Record<string, { label: string; multiplier: number }>
  defaultPourSize?: string

  // Timed rental-specific
  timedPricing?: {
    per15Min?: number
    per30Min?: number
    perHour?: number
  }
  minimumMinutes?: number

  // Commission (visible to online ordering for custom tip logic)
  commissionType?: string | null
  commissionValue?: number | null

  // Media
  imageUrl?: string | null

  // Metadata
  sortOrder: number
}

// Public modifier (what /api/menu/items/[id]/modifiers?channel=online returns)
export interface PublicModifier {
  id: string
  name: string
  displayName: string | null
  price: number
  upsellPrice: number | null

  // Pre-modifier options
  allowNo: boolean
  allowLite: boolean
  allowOnSide: boolean
  allowExtra: boolean
  extraPrice: number | null
  extraUpsellPrice: number | null

  // Defaults
  isDefault: boolean
  isLabel: boolean

  // Channel visibility (already filtered by channel param, but included for context)
  showOnline: boolean
  showOnPOS: boolean

  // Child group support
  childModifierGroupId: string | null
  childModifierGroup?: PublicModifierGroup | null

  // Spirit-specific
  spiritTier?: string | null
  linkedBottleProduct?: {
    id: string
    name: string
    pourCost: number | null
  } | null

  // Metadata
  sortOrder: number
}

// Public modifier group (nested in PublicModifier or returned by modifiers endpoint)
export interface PublicModifierGroup {
  id: string
  name: string
  displayName: string | null
  minSelections: number
  maxSelections: number
  isRequired: boolean
  allowStacking: boolean

  // Online override (if hasOnlineOverride=true, modifiers array is already filtered)
  hasOnlineOverride: boolean

  // Spirit group config
  isSpiritGroup: boolean
  spiritConfig?: {
    spiritCategoryId: string
    spiritCategoryName: string
    upsellEnabled: boolean
    upsellPromptText: string | null
    defaultTier: string
  } | null

  // Pricing
  tieredPricingConfig?: {
    enabled: boolean
    modes: { flat_tiers: boolean; free_threshold: boolean }
    flat_tiers?: { tiers: Array<{ upTo: number; price: number }>; overflowPrice: number }
    free_threshold?: { freeCount: number }
  } | null
  exclusionGroupKey: string | null

  // Modifiers (recursively includes child groups)
  modifiers: PublicModifier[]

  // Metadata
  sortOrder: number
}

// Category for online ordering
export interface PublicCategory {
  id: string
  name: string
  categoryType: string
  color: string
  sortOrder: number

  // Visibility
  showOnline: boolean

  // Item count (computed)
  itemCount?: number
}

// Full menu response for initial load
export interface PublicMenuResponse {
  categories: PublicCategory[]
  items: PublicMenuItem[]
}

// Socket event types for real-time updates
export type MenuSocketEvent =
  | MenuItemChangedEvent
  | MenuStockChangedEvent
  | MenuStructureChangedEvent
  | EntertainmentStatusChangedEvent

export interface MenuItemChangedEvent {
  type: 'menu:item-changed'
  locationId: string
  payload: {
    itemId: string
    action: 'created' | 'updated' | 'deleted' | 'restored'
    changes?: Partial<PublicMenuItem>
  }
}

export interface MenuStockChangedEvent {
  type: 'menu:stock-changed'
  locationId: string
  payload: {
    itemId: string
    stockStatus: StockStatus
    isOrderableOnline: boolean
  }
}

export interface MenuStructureChangedEvent {
  type: 'menu:structure-changed'
  locationId: string
  payload: {
    action: 'category-created' | 'category-updated' | 'category-deleted' | 'modifier-group-updated'
    entityId: string
    entityType: 'category' | 'modifier-group'
  }
}

export interface EntertainmentStatusChangedEvent {
  type: 'entertainment:status-changed'
  locationId: string
  payload: {
    itemId: string
    entertainmentStatus: 'available' | 'in_use' | 'reserved' | 'maintenance'
    currentOrderId: string | null
    expiresAt: string | null
  }
}
