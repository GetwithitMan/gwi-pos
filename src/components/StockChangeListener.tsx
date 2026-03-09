'use client'

import { useEffect } from 'react'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import { toast } from '@/stores/toast-store'
import { useStockStatusStore } from '@/stores/stock-status-store'
import type { StockLevel } from '@/stores/stock-status-store'

/**
 * Listens for inventory and menu stock-change socket events.
 * Updates the stock status store and shows a toast when items go out of stock.
 * Mounted in the root layout so all POS terminals get real-time 86'd updates.
 *
 * Handles two events:
 *   - `inventory:stock-change` — ingredient-level changes (from dispatchStockLevelChange)
 *   - `menu:stock-changed`    — menu-item-level changes (from dispatchMenuStockChanged)
 */
export function StockChangeListener() {
  useEffect(() => {
    const socket = getSharedSocket()
    const setItemStatus = useStockStatusStore.getState().setItemStatus

    // inventory:stock-change — ingredient level, shows toast for critical/zero stock
    const onInventoryStockChange = (data: {
      ingredientId: string
      name: string
      currentStock: number
      previousStock: number
      unit: string
      stockLevel: 'critical' | 'low' | 'ok' | 'good'
    }) => {
      if (data.stockLevel === 'critical' || data.currentStock <= 0) {
        toast.warning(`86'd: ${data.name} is out of stock`, 6000)
      } else if (data.stockLevel === 'low') {
        toast.info(`Low stock: ${data.name} (${data.currentStock} ${data.unit} remaining)`, 4000)
      }
    }

    // menu:stock-changed — menu item level, updates the store for 86'd badge
    const onMenuStockChanged = (data: {
      itemId: string
      stockStatus: StockLevel
      isOrderableOnline: boolean
    }) => {
      setItemStatus(data.itemId, data.stockStatus)

      if (data.stockStatus === 'out_of_stock') {
        toast.warning(`Item 86'd — no longer available`, 5000)
      }
    }

    socket.on('inventory:stock-change', onInventoryStockChange)
    socket.on('menu:stock-changed', onMenuStockChanged)

    return () => {
      socket.off('inventory:stock-change', onInventoryStockChange)
      socket.off('menu:stock-changed', onMenuStockChanged)
      releaseSharedSocket()
    }
  }, [])

  return null
}
