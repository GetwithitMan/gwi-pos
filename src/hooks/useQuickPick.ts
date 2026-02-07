'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { OrderPanelItemData } from '@/components/orders/OrderPanelItem'

/**
 * Manages Quick Pick selection state with multi-select support.
 * - Auto-selects the newest pending item when a new item is added
 * - Single tap = select single item (clears previous selection)
 * - Tap with multiSelect mode = toggle item in/out of selection set
 * - Clears selection on send/clear
 */
export function useQuickPick(items: OrderPanelItemData[]) {
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const prevCountRef = useRef(items.length)

  // Auto-select newest pending item when a new item is added
  useEffect(() => {
    if (items.length > prevCountRef.current) {
      const pending = items.filter(
        i => !i.sentToKitchen && (!i.kitchenStatus || i.kitchenStatus === 'pending')
      )
      const newest = pending[pending.length - 1]
      if (newest) {
        setSelectedItemIds(new Set([newest.id]))
        setMultiSelectMode(false)
      }
    }
    prevCountRef.current = items.length
  }, [items])

  // Clear selection when all items are removed
  useEffect(() => {
    if (items.length === 0) {
      setSelectedItemIds(new Set())
      setMultiSelectMode(false)
    }
  }, [items.length])

  // Clear items from selection if they were sent to kitchen or removed
  useEffect(() => {
    if (selectedItemIds.size === 0) return
    const validIds = new Set<string>()
    for (const id of selectedItemIds) {
      const item = items.find(i => i.id === id)
      if (item && !item.sentToKitchen) {
        validIds.add(id)
      }
    }
    if (validIds.size !== selectedItemIds.size) {
      setSelectedItemIds(validIds)
    }
  }, [items, selectedItemIds])

  // Single-select: replace selection with one item
  const selectItem = useCallback((itemId: string) => {
    if (multiSelectMode) {
      // In multi-select mode, toggle the item
      setSelectedItemIds(prev => {
        const next = new Set(prev)
        if (next.has(itemId)) {
          next.delete(itemId)
        } else {
          next.add(itemId)
        }
        return next
      })
    } else {
      // Single select mode
      setSelectedItemIds(prev => {
        if (prev.size === 1 && prev.has(itemId)) {
          // Tapping same item deselects
          return new Set()
        }
        return new Set([itemId])
      })
    }
  }, [multiSelectMode])

  // Toggle multi-select mode
  const toggleMultiSelect = useCallback(() => {
    setMultiSelectMode(prev => !prev)
  }, [])

  // Select all pending items
  const selectAllPending = useCallback(() => {
    const pending = items.filter(
      i => !i.sentToKitchen && (!i.kitchenStatus || i.kitchenStatus === 'pending')
    )
    setSelectedItemIds(new Set(pending.map(i => i.id)))
    setMultiSelectMode(true)
  }, [items])

  const clearSelection = useCallback(() => {
    setSelectedItemIds(new Set())
    setMultiSelectMode(false)
  }, [])

  // Backwards-compatible: first selected item ID (for quick pick number)
  const selectedItemId = selectedItemIds.size > 0 ? Array.from(selectedItemIds)[0] : null

  return {
    selectedItemId,          // Single ID for backwards compat (first in set)
    selectedItemIds,         // Full set for multi-select
    selectItem,              // Tap handler (respects multiSelectMode)
    setSelectedItemId: (id: string | null) => {
      if (id) setSelectedItemIds(new Set([id]))
      else setSelectedItemIds(new Set())
    },
    clearSelection,
    multiSelectMode,
    toggleMultiSelect,
    selectAllPending,
  }
}
