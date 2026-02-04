/**
 * Inventory Domain
 *
 * Manages stock, purchasing, and waste tracking.
 *
 * Modules:
 * - I1: Items (inventory items, ingredients)
 * - I2: Stock Levels (current stock, thresholds)
 * - I3: Purchasing (purchase orders, vendors)
 * - I4: Receiving (deliveries, invoice matching)
 * - I5: Transfers (between locations)
 * - I6: Waste (waste logging, variance)
 * - I7: Counts (inventory counts, adjustments)
 */

// Types will be added as we migrate
export type InventoryItem = {
  id: string
  name: string
  currentStock: number
  unit: string
  parLevel?: number
  reorderPoint?: number
}

export type Ingredient = {
  id: string
  name: string
  categoryId?: string
  standardQuantity?: number
  standardUnit?: string
  is86d: boolean
}

// Constants
export const STOCK_STATUSES = [
  'in_stock',
  'low_stock',
  'critical',
  'out_of_stock',
] as const

export const INVENTORY_TRANSACTION_TYPES = [
  'purchase',
  'sale',
  'waste',
  'adjustment',
  'transfer',
  'count',
] as const
