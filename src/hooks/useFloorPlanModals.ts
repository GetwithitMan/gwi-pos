import { useState, useCallback } from 'react'

interface MenuItem {
  id: string
  name: string
  price: number
  description?: string
  categoryId: string
  categoryType?: string
  hasModifiers?: boolean
  isPizza?: boolean
  itemType?: string
  entertainmentStatus?: 'available' | 'in_use' | 'maintenance' | 'reserved' | null
  blockTimeMinutes?: number | null
  modifierGroupCount?: number
  timedPricing?: {
    per15Min?: number
    per30Min?: number
    perHour?: number
    minimum?: number
  }
  stockStatus?: 'ok' | 'low' | 'critical' | 'out'
  stockCount?: number | null
  stockIngredientName?: string | null
  is86d?: boolean
  reasons86d?: string[]
}

interface CompVoidItem {
  id: string
  name: string
  price: number
  quantity: number
  modifiers: { id: string; name: string; price: number }[]
  status?: string
  menuItemId?: string
}

interface ContextMenuState {
  x: number
  y: number
  item: MenuItem
}

export function useFloorPlanModals() {
  const [compVoidItem, setCompVoidItem] = useState<CompVoidItem | null>(null)
  const [showTableOptions, setShowTableOptions] = useState(false)
  const [showShareOwnership, setShowShareOwnership] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [showRoomReorderModal, setShowRoomReorderModal] = useState(false)

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  return {
    compVoidItem,
    setCompVoidItem,
    showTableOptions,
    setShowTableOptions,
    showShareOwnership,
    setShowShareOwnership,
    contextMenu,
    setContextMenu,
    closeContextMenu,
    showRoomReorderModal,
    setShowRoomReorderModal,
  }
}
