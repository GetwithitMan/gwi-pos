import { useState, useCallback } from 'react'
import type { MenuItemFloorPlan as MenuItem } from '@/types'

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
