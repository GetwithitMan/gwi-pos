import { create } from 'zustand'

/**
 * Minimal store tracking real-time stock status for menu items.
 *
 * Fed by two socket events:
 *   - `inventory:stock-change`  (ingredient-level, carries ingredientId + stockLevel)
 *   - `menu:stock-changed`     (menu-item-level, carries itemId + stockStatus)
 *
 * POS menu grid and order entry can read `isItemUnavailable(itemId)` to show
 * an 86'd badge or block ordering.
 */

export type StockLevel = 'in_stock' | 'low_stock' | 'critical' | 'out_of_stock'

interface StockStatusState {
  /** Map of menuItemId → stock status */
  itemStatus: Record<string, StockLevel>

  /** Update a single menu item's stock status */
  setItemStatus: (itemId: string, status: StockLevel) => void

  /** Check if a menu item is unavailable (out_of_stock or critical) */
  isItemUnavailable: (itemId: string) => boolean

  /** Clear all tracked statuses (e.g. on EOD reset) */
  clear: () => void
}

export const useStockStatusStore = create<StockStatusState>((set, get) => ({
  itemStatus: {},

  setItemStatus: (itemId, status) => {
    set((state) => {
      if (state.itemStatus[itemId] === status) return state
      return { itemStatus: { ...state.itemStatus, [itemId]: status } }
    })
  },

  isItemUnavailable: (itemId) => {
    const status = get().itemStatus[itemId]
    return status === 'out_of_stock'
  },

  clear: () => {
    set({ itemStatus: {} })
  },
}))
