'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFloorPlanStore, FloorPlanTable, FloorPlanElement } from './use-floor-plan'
import { FloorPlanEntertainment } from './FloorPlanEntertainment'
import { TableNode, getCombinedGroupColor } from './TableNode'
import { TableInfoPanel } from './TableInfoPanel'
import { CategoriesBar } from './CategoriesBar'
import { VirtualCombineBar } from './VirtualCombineBar'
import { ExistingOrdersModal } from './ExistingOrdersModal'
import { VirtualGroupManagerModal } from './VirtualGroupManagerModal'
import { RoomTabs } from './RoomTabs'
import { RoomReorderModal } from './RoomReorderModal'
import { useFloorPlanAutoScale, useFloorPlanDrag } from './hooks'
import { calculateAttachSide, calculateAttachPosition } from './table-positioning'
import { getCombinedGroupTables, calculatePerimeterCapacity } from '@/lib/table-geometry'
import { toTableRect, toTableRectArray } from '@/lib/table-utils'
import {
  generateVirtualSeatPositions,
  type TableForPerimeter,
  type VirtualSeatPosition,
} from '@/domains/floor-plan/groups'
import { usePOSLayout } from '@/hooks/usePOSLayout'
import { QuickAccessBar } from '@/components/pos/QuickAccessBar'
import { MenuItemContextMenu } from '@/components/pos/MenuItemContextMenu'
import { StockBadge } from '@/components/menu/StockBadge'
import { CompVoidModal } from '@/components/orders/CompVoidModal'
import { SplitTicketManager } from '@/components/orders/SplitTicketManager'
import { OrderPanel, type OrderPanelItemData } from '@/components/orders/OrderPanel'
import { logger } from '@/lib/logger'
import type { PizzaOrderConfig } from '@/types'
import { toast } from '@/stores/toast-store'
import { useOrderStore } from '@/stores/order-store'
import { useActiveOrder } from '@/hooks/useActiveOrder'
import { usePricing } from '@/hooks/usePricing'
import { useEvents } from '@/lib/events'
import { useMenuSearch } from '@/hooks/useMenuSearch'
import { MenuSearchInput, MenuSearchResults } from '@/components/search'
import './styles/floor-plan.css'

interface Category {
  id: string
  name: string
  color?: string
  itemCount?: number
  categoryType?: string
}

interface MenuItem {
  id: string
  name: string
  price: number
  description?: string
  categoryId: string
  categoryType?: string // 'food' | 'pizza' | 'entertainment' | etc.
  hasModifiers?: boolean
  isPizza?: boolean
  itemType?: string // 'standard' | 'combo' | 'timed_rental' | 'pizza'
  entertainmentStatus?: 'available' | 'in_use' | 'maintenance'
  blockTimeMinutes?: number
  modifierGroupCount?: number
  timedPricing?: {
    per15Min?: number
    per30Min?: number
    perHour?: number
    minimum?: number
  }
  // Prep stock status (from API)
  stockStatus?: 'ok' | 'low' | 'critical' | 'out'
  stockCount?: number | null
  stockIngredientName?: string | null
  // 86 status (ingredient out of stock)
  is86d?: boolean
  reasons86d?: string[]
}

interface InlineOrderItem {
  id: string
  menuItemId: string
  name: string
  price: number
  quantity: number
  modifiers?: { id: string; name: string; price: number }[]
  specialNotes?: string
  seatNumber?: number
  sourceTableId?: string // For virtual groups - tracks which table this item was ordered from
  courseNumber?: number
  courseStatus?: 'pending' | 'fired' | 'ready' | 'served'
  isHeld?: boolean
  sentToKitchen?: boolean
  isCompleted?: boolean
  status?: 'active' | 'voided' | 'comped'
  // Timed rental / entertainment items
  isTimedRental?: boolean
  blockTimeMinutes?: number
  blockTimeStartedAt?: string
  blockTimeExpiresAt?: string
  // Item lifecycle status
  kitchenStatus?: 'pending' | 'cooking' | 'ready' | 'delivered'
  completedAt?: string
  resendCount?: number
  resendNote?: string
  createdAt?: string
}

interface OpenOrder {
  id: string
  orderNumber: number
  tableId?: string
  tableName?: string
  tabName?: string
  orderType: string
  total: number
  itemCount: number
  openedAt: string
  employeeName?: string
}

// View mode: tables (floor plan) or menu (category items)
type ViewMode = 'tables' | 'menu'

// Order type for quick order buttons
type QuickOrderType = 'takeout' | 'delivery' | 'bar_tab'

interface FloorPlanHomeProps {
  locationId: string
  employeeId: string
  employeeName: string
  employeeRole?: string
  onLogout: () => void
  onSwitchUser?: () => void
  onOpenSettings?: () => void
  onOpenAdminNav?: () => void
  isManager?: boolean
  // Payment and modifier callbacks
  onOpenPayment?: (orderId: string) => void
  onOpenModifiers?: (item: MenuItem, onComplete: (modifiers: { id: string; name: string; price: number }[]) => void, existingModifiers?: { id: string; name: string; price: number }[]) => void
  // Open Orders panel
  onOpenOrdersPanel?: () => void
  // Tabs page (for bartenders)
  onOpenTabs?: () => void
  // Switch to bartender view (speed-optimized for bar tabs)
  onSwitchToBartenderView?: () => void
  // Guest count for seat assignment (from table or default)
  defaultGuestCount?: number
  // Timed rental/entertainment modal callback
  onOpenTimedRental?: (item: MenuItem, onComplete: (price: number, blockMinutes: number) => void) => void
  // Pizza builder modal callback
  onOpenPizzaBuilder?: (item: MenuItem, onComplete: (config: PizzaOrderConfig) => void) => void
  // Order to load (from Open Orders panel) - set this to load an existing order
  orderToLoad?: { id: string; orderNumber: number; tableId?: string; tabName?: string; orderType: string } | null
  // Callback when order is loaded (to clear the orderToLoad prop)
  onOrderLoaded?: () => void
  // Order ID that was just paid - triggers clearing of order panel
  paidOrderId?: string | null
  // Callback when paid order is cleared (to reset paidOrderId prop)
  onPaidOrderCleared?: () => void
}

// Pizza order configuration (matches what pizza builder produces)
export function FloorPlanHome({
  locationId,
  employeeId,
  employeeName,
  employeeRole,
  onLogout,
  onSwitchUser,
  onOpenSettings,
  onOpenAdminNav,
  isManager = false,
  onOpenPayment,
  onOpenModifiers,
  onOpenOrdersPanel,
  onOpenTabs,
  onSwitchToBartenderView,
  defaultGuestCount = 4,
  onOpenTimedRental,
  onOpenPizzaBuilder,
  orderToLoad,
  onOrderLoaded,
  paidOrderId,
  onPaidOrderCleared,
}: FloorPlanHomeProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // View mode: tables (floor plan) or menu (category items)
  const [viewMode, setViewMode] = useState<ViewMode>('tables')

  // Categories and menu items
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [loadingMenuItems, setLoadingMenuItems] = useState(false)

  // Open orders count
  const [openOrdersCount, setOpenOrdersCount] = useState(0)

  // Employee dropdown
  const [showEmployeeDropdown, setShowEmployeeDropdown] = useState(false)

  // Settings dropdown
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false)

  // Active order state (for selected table or quick order)
  const [activeTableId, setActiveTableId] = useState<string | null>(null)
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null)
  const [activeOrderNumber, setActiveOrderNumber] = useState<string | null>(null)
  const [activeOrderType, setActiveOrderType] = useState<string | null>(null)
  const [showOrderPanel, setShowOrderPanel] = useState(false)
  const [isSendingOrder, setIsSendingOrder] = useState(false)
  const [pendingPayAfterSave, setPendingPayAfterSave] = useState(false)
  const [guestCount, setGuestCount] = useState(defaultGuestCount)

  // === Shared order hook (single source of truth for order items) ===
  const activeOrder = useActiveOrder({
    locationId,
    employeeId,
  })

  // DEPRECATED: inlineOrderItems now reads from Zustand store via useActiveOrder hook
  // This alias exists for backward compatibility while we migrate all call sites
  const inlineOrderItems: InlineOrderItem[] = useMemo(() => {
    const storeItems = useOrderStore.getState().currentOrder?.items || []
    return storeItems.map(item => ({
      id: item.id,
      menuItemId: item.menuItemId,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      modifiers: item.modifiers?.map(m => ({ id: m.id, name: m.name, price: m.price })),
      specialNotes: item.specialNotes,
      seatNumber: item.seatNumber,
      sourceTableId: item.sourceTableId,
      courseNumber: item.courseNumber,
      courseStatus: item.courseStatus,
      isHeld: item.isHeld,
      sentToKitchen: item.sentToKitchen,
      isCompleted: item.isCompleted,
      blockTimeMinutes: item.blockTimeMinutes ?? undefined,
      blockTimeStartedAt: item.blockTimeStartedAt ?? undefined,
      blockTimeExpiresAt: item.blockTimeExpiresAt ?? undefined,
      completedAt: item.completedAt,
      resendCount: item.resendCount,
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrder.items]) // Re-derive when hook items change (hook subscribes to store)

  // COMPATIBILITY SHIM: setInlineOrderItems bridges old patterns to the Zustand store
  // This allows all 31 existing call sites to keep working while store is source of truth
  // Refs for shim closure (avoids stale state in useCallback)
  const activeOrderTypeRef = useRef(activeOrderType)
  activeOrderTypeRef.current = activeOrderType
  const activeTableIdRef = useRef(activeTableId)
  activeTableIdRef.current = activeTableId
  const guestCountRef = useRef(guestCount)
  guestCountRef.current = guestCount

  const setInlineOrderItems = useCallback((
    action: InlineOrderItem[] | ((prev: InlineOrderItem[]) => InlineOrderItem[])
  ) => {
    const store = useOrderStore.getState()

    // Ensure order exists in store before mutating items
    if (!store.currentOrder) {
      store.startOrder(activeOrderTypeRef.current || 'dine_in', {
        locationId,
        tableId: activeTableIdRef.current || undefined,
        guestCount: guestCountRef.current || 1,
      })
    }

    const currentItems = store.currentOrder?.items || []

    // Resolve new items from action (direct array or callback)
    const prevAsInline: InlineOrderItem[] = currentItems.map(item => ({
      id: item.id, menuItemId: item.menuItemId, name: item.name, price: item.price,
      quantity: item.quantity, modifiers: item.modifiers?.map(m => ({ id: m.id, name: m.name, price: m.price })),
      specialNotes: item.specialNotes, seatNumber: item.seatNumber, sourceTableId: item.sourceTableId,
      courseNumber: item.courseNumber, courseStatus: item.courseStatus, isHeld: item.isHeld,
      sentToKitchen: item.sentToKitchen, isCompleted: item.isCompleted,
      blockTimeMinutes: item.blockTimeMinutes ?? undefined, blockTimeStartedAt: item.blockTimeStartedAt ?? undefined,
      blockTimeExpiresAt: item.blockTimeExpiresAt ?? undefined, completedAt: item.completedAt,
      resendCount: item.resendCount,
    }))

    const newItems = typeof action === 'function' ? action(prevAsInline) : action

    if (newItems.length === 0) {
      // Clear all items — just remove them from the store
      for (const item of [...currentItems]) {
        store.removeItem(item.id)
      }
      return
    }

    // Diff: remove items that are no longer present
    for (const existing of currentItems) {
      if (!newItems.find(n => n.id === existing.id)) {
        store.removeItem(existing.id)
      }
    }

    // Diff: add new items and update changed items
    for (const newItem of newItems) {
      const existing = currentItems.find(e => e.id === newItem.id)
      if (!existing) {
        // New item — add to store
        store.addItem({
          menuItemId: newItem.menuItemId,
          name: newItem.name,
          price: newItem.price,
          quantity: newItem.quantity,
          modifiers: (newItem.modifiers || []).map(m => ({ id: m.id, name: m.name, price: m.price, depth: 0 })),
          specialNotes: newItem.specialNotes,
          seatNumber: newItem.seatNumber,
          sourceTableId: newItem.sourceTableId,
          courseNumber: newItem.courseNumber,
          courseStatus: newItem.courseStatus,
          isHeld: newItem.isHeld,
          sentToKitchen: newItem.sentToKitchen,
          isCompleted: newItem.isCompleted,
          blockTimeMinutes: newItem.blockTimeMinutes,
          blockTimeStartedAt: newItem.blockTimeStartedAt,
          blockTimeExpiresAt: newItem.blockTimeExpiresAt,
          completedAt: newItem.completedAt,
          resendCount: newItem.resendCount,
        })
        // Override the auto-generated ID with the intended one
        const storeNow = useOrderStore.getState().currentOrder?.items || []
        const justAdded = storeNow[storeNow.length - 1]
        if (justAdded && justAdded.id !== newItem.id) {
          store.updateItemId(justAdded.id, newItem.id)
        }
      } else {
        // Existing item — update if changed
        store.updateItem(newItem.id, {
          quantity: newItem.quantity,
          modifiers: (newItem.modifiers || []).map(m => ({ id: m.id, name: m.name, price: m.price, depth: 0 })),
          specialNotes: newItem.specialNotes,
          seatNumber: newItem.seatNumber,
          sourceTableId: newItem.sourceTableId,
          courseNumber: newItem.courseNumber,
          courseStatus: newItem.courseStatus,
          isHeld: newItem.isHeld,
          sentToKitchen: newItem.sentToKitchen,
          isCompleted: newItem.isCompleted,
          blockTimeMinutes: newItem.blockTimeMinutes,
          blockTimeStartedAt: newItem.blockTimeStartedAt,
          blockTimeExpiresAt: newItem.blockTimeExpiresAt,
          completedAt: newItem.completedAt,
          resendCount: newItem.resendCount,
        })
      }
    }
  }, [locationId])

  // Notes editing state
  const [editingNotesItemId, setEditingNotesItemId] = useState<string | null>(null)
  const [editingNotesText, setEditingNotesText] = useState('')

  // Modifiers editing state
  const [editingModifiersItemId, setEditingModifiersItemId] = useState<string | null>(null)

  // Comp/Void modal state
  const [compVoidItem, setCompVoidItem] = useState<{
    id: string
    name: string
    price: number
    quantity: number
    modifiers: { name: string; price: number }[]
    status?: string
  } | null>(null)

  // Split ticket manager state
  const [showSplitTicketManager, setShowSplitTicketManager] = useState(false)
  const [splitItemId, setSplitItemId] = useState<string | null>(null)

  // Item controls expansion state
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)

  // Active seat for auto-assignment (null = "Shared")
  const [activeSeatNumber, setActiveSeatNumber] = useState<number | null>(null)
  // Source table for seat (for virtual groups - tracks which table the seat belongs to)
  const [activeSourceTableId, setActiveSourceTableId] = useState<string | null>(null)

  // Context menu state for menu items (right-click)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    item: MenuItem
  } | null>(null)

  // Note: Drag state (lastDropPosition) is now managed by useFloorPlanDrag hook

  // Room/section selection state
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  const [showRoomReorderModal, setShowRoomReorderModal] = useState(false)
  const [preferredRoomOrder, setPreferredRoomOrder] = useState<string[]>([])

  // Virtual group manager modal state
  const [virtualGroupManagerTableId, setVirtualGroupManagerTableId] = useState<string | null>(null)

  // Dismissed virtual group banners (auto-dismiss after 5 seconds)
  const [dismissedBanners, setDismissedBanners] = useState<Set<string>>(new Set())

  // Resend to kitchen state
  const [resendModal, setResendModal] = useState<{ itemId: string; itemName: string } | null>(null)
  const [resendNote, setResendNote] = useState('')
  const [resendLoading, setResendLoading] = useState(false)

  // TODO: May be redundant now that OrderPanel manages its own sort/highlight state
  const [itemSortDirection, setItemSortDirection] = useState<'newest-bottom' | 'newest-top'>('newest-bottom')
  // TODO: May be redundant now that OrderPanel manages its own sort/highlight state
  const [newestItemId, setNewestItemId] = useState<string | null>(null)
  // TODO: May be redundant now that OrderPanel manages its own sort/highlight state
  const prevItemCountRef2 = useRef(0)
  // TODO: May be redundant now that OrderPanel manages its own scroll ref
  const orderScrollRef = useRef<HTMLDivElement>(null)
  const newestTimerRef2 = useRef<ReturnType<typeof setTimeout> | null>(null)

  const {
    tables,
    sections,
    elements,
    selectedTableId,
    draggedTableId,
    dropTargetTableId,
    infoPanelTableId,
    undoStack,
    isLoading,
    showSeats,
    selectedSeat,
    flashingTables,
    setTables,
    setSections,
    setElements,
    selectTable,
    startDrag,
    updateDragTarget,
    endDrag,
    openInfoPanel,
    closeInfoPanel,
    addUndoAction,
    popUndoAction,
    clearExpiredUndos,
    toggleShowSeats,
    selectSeat,
    clearSelectedSeat,
    flashTableMessage,
    clearExpiredFlashes,
    setLoading,
    // Virtual combine mode
    virtualCombineMode,
    virtualCombineSelectedIds,
    virtualCombinePrimaryId,
    startVirtualCombineMode,
    toggleVirtualCombineSelection,
    cancelVirtualCombineMode,
    clearVirtualCombineMode,
    updateTablesWithVirtualGroup,
  } = useFloorPlanStore()

  // Virtual group perimeter seats data - calculated from tables in virtual groups
  // This enables seats to be distributed around the combined perimeter of grouped tables
  // Two modes:
  // - Static (long-hold): Tables stay in place, keep their own seats, just get colored glow
  // - Snapped (drag-drop): Tables visually snap together, seats redistribute around perimeter
  interface VirtualGroupSeatData {
    groupId: string
    virtualSeats: VirtualSeatPosition[] // Empty for static groups
    displayName: string
    tableIds: string[]
    groupColor: string
    isStatic?: boolean // True for long-hold groups (tables keep their own seats)
  }

  // No sync functions needed — Zustand store IS the source of truth
  // syncOrderToStore and syncLocalItemsToStore have been removed

  // Switch to Bar Mode — items already live in Zustand store, no sync needed
  const handleSwitchToBartenderView = useCallback(() => {
    if (onSwitchToBartenderView) {
      onSwitchToBartenderView()
    }
  }, [onSwitchToBartenderView])

  // Helper function to calculate snap position for a secondary table relative to a primary table
  // Used when tables don't have stored visual offsets
  const calculateSnapPositionForTable = useCallback((
    secondary: FloorPlanTable,
    primary: FloorPlanTable
  ): { x: number; y: number } => {
    // Calculate centers
    const primaryCenterX = primary.posX + primary.width / 2
    const primaryCenterY = primary.posY + primary.height / 2
    const secondaryCenterX = secondary.posX + secondary.width / 2
    const secondaryCenterY = secondary.posY + secondary.height / 2

    // Determine which edge to snap to based on relative position
    const dx = secondaryCenterX - primaryCenterX
    const dy = secondaryCenterY - primaryCenterY

    // Determine primary direction (horizontal or vertical)
    const isHorizontal = Math.abs(dx) > Math.abs(dy)

    let snapX: number
    let snapY: number

    if (isHorizontal) {
      if (dx > 0) {
        // Secondary is to the RIGHT of primary - snap to primary's right edge
        snapX = primary.posX + primary.width  // Left edge of secondary touches right edge of primary
      } else {
        // Secondary is to the LEFT of primary - snap to primary's left edge
        snapX = primary.posX - secondary.width  // Right edge of secondary touches left edge of primary
      }
      // Align centers vertically (with small offset to preserve original offset)
      const verticalOffset = Math.min(Math.abs(dy), Math.min(primary.height, secondary.height) * 0.3)
      snapY = primary.posY + (primary.height - secondary.height) / 2 + (dy > 0 ? verticalOffset : -verticalOffset) * 0.5
    } else {
      if (dy > 0) {
        // Secondary is BELOW primary - snap to primary's bottom edge
        snapY = primary.posY + primary.height  // Top edge of secondary touches bottom edge of primary
      } else {
        // Secondary is ABOVE primary - snap to primary's top edge
        snapY = primary.posY - secondary.height  // Bottom edge of secondary touches top edge of primary
      }
      // Align centers horizontally (with small offset to preserve original offset)
      const horizontalOffset = Math.min(Math.abs(dx), Math.min(primary.width, secondary.width) * 0.3)
      snapX = primary.posX + (primary.width - secondary.width) / 2 + (dx > 0 ? horizontalOffset : -horizontalOffset) * 0.5
    }

    return { x: snapX, y: snapY }
  }, [])

  // Helper function to calculate snap position for a table joining an existing group with multiple tables
  // Finds the nearest already-positioned table and snaps to it
  const calculateSnapPositionForTableInGroup = useCallback((
    newTable: FloorPlanTable,
    primaryTable: FloorPlanTable,
    allGroupTables: FloorPlanTable[],
    currentOffsets: Map<string, { offsetX: number; offsetY: number }>
  ): { x: number; y: number } => {
    // Get all tables that already have positions calculated (including primary)
    const positionedTables = allGroupTables.filter(t =>
      t.id === primaryTable.id || currentOffsets.has(t.id)
    )

    if (positionedTables.length === 0) {
      // Fallback to primary
      return calculateSnapPositionForTable(newTable, primaryTable)
    }

    // Find the nearest positioned table to snap to
    let nearestTable = primaryTable
    let nearestDistance = Infinity

    for (const table of positionedTables) {
      const offset = currentOffsets.get(table.id) || { offsetX: 0, offsetY: 0 }
      const visualX = table.posX + offset.offsetX
      const visualY = table.posY + offset.offsetY

      // Calculate distance from new table's original position to this positioned table
      const dx = newTable.posX - visualX
      const dy = newTable.posY - visualY
      const distance = Math.sqrt(dx * dx + dy * dy)

      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestTable = table
      }
    }

    // Create a virtual table with the visual position for snapping
    const nearestOffset = currentOffsets.get(nearestTable.id) || { offsetX: 0, offsetY: 0 }
    const virtualNearestTable: FloorPlanTable = {
      ...nearestTable,
      posX: nearestTable.posX + nearestOffset.offsetX,
      posY: nearestTable.posY + nearestOffset.offsetY,
    }

    return calculateSnapPositionForTable(newTable, virtualNearestTable)
  }, [calculateSnapPositionForTable])

  // Determine which virtual groups are "snapped" (drag-drop) vs "static" (long-hold)
  // Snapped groups have non-zero offsets and redistribute seats around perimeter
  // Static groups keep tables in place with their original seats
  const snappedGroupIds = useMemo(() => {
    const snapped = new Set<string>()
    tables.forEach(t => {
      if (t.virtualGroupId) {
        // If any table in the group has non-zero offsets, it's a snapped group
        if (t.virtualGroupOffsetX != null && t.virtualGroupOffsetY != null &&
            (t.virtualGroupOffsetX !== 0 || t.virtualGroupOffsetY !== 0)) {
          snapped.add(t.virtualGroupId)
        }
      }
    })
    return snapped
  }, [tables])

  const virtualGroupSeats = useMemo<Map<string, VirtualGroupSeatData>>(() => {
    const groups = new Map<string, VirtualGroupSeatData>()

    // Find all unique virtual group IDs
    const groupIds = new Set<string>()
    tables.forEach(t => {
      if (t.virtualGroupId) groupIds.add(t.virtualGroupId)
    })

    // Calculate virtual seats for each group
    groupIds.forEach(groupId => {
      const groupTables = tables.filter(t => t.virtualGroupId === groupId)
      if (groupTables.length < 2) return // Need at least 2 tables for virtual group

      // Find primary table
      const primaryTable = groupTables.find(t => t.virtualGroupPrimary) || groupTables[0]
      const groupColor = primaryTable.virtualGroupColor || '#06b6d4'

      // Check if this is a snapped (drag-drop) group or static (long-hold) group
      const isSnappedGroup = snappedGroupIds.has(groupId)

      // For STATIC groups (long-hold): tables stay in place, no perimeter seat redistribution
      // Just store group info for coloring/display purposes
      if (!isSnappedGroup) {
        // Count total seats across all tables in the group
        const totalSeats = groupTables.reduce((sum, t) => sum + (t.seats?.length || 0), 0)
        const names = groupTables.map(t => t.name)
        const displayName = names.length === 2
          ? `${names[0]} & ${names[1]} • Party of ${totalSeats}`
          : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]} • Party of ${totalSeats}`

        groups.set(groupId, {
          groupId,
          virtualSeats: [], // No perimeter seats for static groups
          displayName,
          tableIds: groupTables.map(t => t.id),
          groupColor,
          isStatic: true, // Flag to indicate tables keep their own seats
        })
        return
      }

      // For SNAPPED groups (drag-drop): calculate perimeter seat redistribution
      const visualOffsets = new Map<string, { offsetX: number; offsetY: number }>()

      // Primary table stays at its position (no offset)
      visualOffsets.set(primaryTable.id, { offsetX: 0, offsetY: 0 })

      // Sort secondary tables by distance from primary (closest first)
      const secondaryTables = groupTables.filter(t => t.id !== primaryTable.id)
      secondaryTables.sort((a, b) => {
        const distA = Math.sqrt(
          Math.pow(a.posX - primaryTable.posX, 2) +
          Math.pow(a.posY - primaryTable.posY, 2)
        )
        const distB = Math.sqrt(
          Math.pow(b.posX - primaryTable.posX, 2) +
          Math.pow(b.posY - primaryTable.posY, 2)
        )
        return distA - distB
      })

      // Calculate offset for each secondary table
      secondaryTables.forEach(table => {
        // Use DB-stored offsets
        if (table.virtualGroupOffsetX != null && table.virtualGroupOffsetY != null) {
          visualOffsets.set(table.id, {
            offsetX: table.virtualGroupOffsetX,
            offsetY: table.virtualGroupOffsetY,
          })
          return
        }

        // Fallback: Auto-calculate snap position
        const snapPos = calculateSnapPositionForTableInGroup(
          table,
          primaryTable,
          groupTables,
          visualOffsets
        )
        visualOffsets.set(table.id, {
          offsetX: snapPos.x - table.posX,
          offsetY: snapPos.y - table.posY,
        })
      })

      // Build tables for perimeter calculation using visual (snapped) positions
      const tablesForPerimeter: TableForPerimeter[] = groupTables.map(t => {
        const offset = visualOffsets.get(t.id) || { offsetX: 0, offsetY: 0 }
        return {
          id: t.id,
          name: t.name,
          posX: t.posX + offset.offsetX,
          posY: t.posY + offset.offsetY,
          width: t.width,
          height: t.height,
          rotation: t.rotation,
          seats: (t.seats || []).map(s => ({
            id: s.id,
            seatNumber: s.seatNumber,
            label: s.label,
            relativeX: s.relativeX,
            relativeY: s.relativeY,
          })),
        }
      })

      // Generate perimeter seats around the combined shape
      const virtualSeats = generateVirtualSeatPositions(tablesForPerimeter, 22)

      // Build display name
      const names = groupTables.map(t => t.name)
      const totalSeats = virtualSeats.length
      const displayName = names.length === 2
        ? `${names[0]} & ${names[1]} • Party of ${totalSeats}`
        : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]} • Party of ${totalSeats}`

      groups.set(groupId, {
        groupId,
        virtualSeats,
        displayName,
        tableIds: groupTables.map(t => t.id),
        groupColor,
        isStatic: false,
      })
    })

    return groups
  }, [tables, snappedGroupIds, calculateSnapPositionForTableInGroup])

  // Auto-scaling hook (fits floor plan to container)
  const {
    containerSize,
    tableBounds,
    autoScale,
    autoScaleOffset,
  } = useFloorPlanAutoScale({
    containerRef,
    tables,
    elements,
    selectedSectionId,
  })

  // POS Layout personalization hook (quick bar, colors, etc.)
  const {
    quickBar,
    quickBarEnabled,
    toggleQuickBar,
    addToQuickBar,
    removeFromQuickBar,
    isInQuickBar,
    menuItemColors,
    categoryColors,
    canCustomize,
    resetAllCategoryColors,
    resetAllMenuItemStyles,
  } = usePOSLayout({
    employeeId,
    locationId,
    permissions: { posLayout: ['customize_personal'] }, // Servers can customize their own layout
  })

  // Editing modes (for settings dropdown options)
  const [isEditingFavorites, setIsEditingFavorites] = useState(false)
  const [isEditingCategories, setIsEditingCategories] = useState(false)
  const [isEditingMenuItems, setIsEditingMenuItems] = useState(false)

  // Menu search
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    isSearching,
    results: searchResults,
    clearSearch
  } = useMenuSearch({
    locationId,
    menuItems: menuItems.map(item => ({
      id: item.id,
      name: item.name,
      price: Number(item.price),
      categoryId: item.categoryId,
    })),
    enabled: true  // Panel is always visible, search always enabled
  })

  // Sort sections based on employee's preferred room order
  const sortedSections = useMemo(() => {
    if (preferredRoomOrder.length === 0) return sections

    return [...sections].sort((a, b) => {
      const aIndex = preferredRoomOrder.indexOf(a.id)
      const bIndex = preferredRoomOrder.indexOf(b.id)

      // Rooms in preferred order come first, in that order
      // Rooms not in preferred order come after, in original order
      if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex
      if (aIndex >= 0) return -1
      if (bIndex >= 0) return 1
      return 0
    })
  }, [sections, preferredRoomOrder])

  // Load employee's room order preferences on mount
  useEffect(() => {
    const loadPreferences = async () => {
      if (!employeeId) return
      try {
        const res = await fetch(`/api/employees/${employeeId}/preferences`)
        if (res.ok) {
          const data = await res.json()
          if (data.preferences?.preferredRoomOrder) {
            setPreferredRoomOrder(data.preferences.preferredRoomOrder)
          }
        }
      } catch (error) {
        console.error('Failed to load room preferences:', error)
      }
    }
    loadPreferences()
  }, [employeeId])

  // Initialize to first room when sections load
  useEffect(() => {
    if (sortedSections.length > 0 && selectedSectionId === null) {
      setSelectedSectionId(sortedSections[0].id)
    }
  }, [sortedSections, selectedSectionId])

  // Save room order preferences
  const handleSaveRoomOrder = useCallback(async (orderedRoomIds: string[]) => {
    if (!employeeId) return
    try {
      const res = await fetch(`/api/employees/${employeeId}/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredRoomOrder: orderedRoomIds }),
      })
      if (res.ok) {
        setPreferredRoomOrder(orderedRoomIds)
        toast.success('Room order saved')
      } else {
        toast.error('Failed to save room order')
      }
    } catch (error) {
      console.error('Failed to save room order:', error)
      toast.error('Failed to save room order')
    }
  }, [employeeId])

  // Virtual combine state
  const [isCreatingVirtualGroup, setIsCreatingVirtualGroup] = useState(false)
  const [showExistingOrdersModal, setShowExistingOrdersModal] = useState(false)
  const [pendingExistingOrders, setPendingExistingOrders] = useState<Array<{
    tableId: string
    tableName: string
    orderId: string
    orderNumber: number
    itemCount: number
    total: number
  }>>([])

  // Seat management refresh trigger (Skill 121)
  const [refreshKey, setRefreshKey] = useState(0)

  // Extra virtual seats per table (for walk-up guests before order exists)
  const [extraSeats, setExtraSeats] = useState<Map<string, number>>(new Map())

  // FIX: Ref to always access latest tables data (avoids stale closure issues)
  const tablesRef = useRef(tables)
  tablesRef.current = tables

  // Ref for fixtures/elements data (for collision detection)
  const fixturesRef = useRef(elements)
  fixturesRef.current = elements

  // Auto-dismiss virtual group banners after 5 seconds
  useEffect(() => {
    const virtualGroupIds = new Set(
      tables
        .filter(t => t.virtualGroupId && t.virtualGroupPrimary)
        .map(t => t.virtualGroupId!)
    )

    if (virtualGroupIds.size === 0) return

    const timers: NodeJS.Timeout[] = []

    virtualGroupIds.forEach(groupId => {
      if (!dismissedBanners.has(groupId)) {
        const timer = setTimeout(() => {
          setDismissedBanners(prev => new Set([...prev, groupId]))
        }, 5000)
        timers.push(timer)
      }
    })

    return () => {
      timers.forEach(timer => clearTimeout(timer))
    }
  }, [tables, dismissedBanners])

  // FIX: Refs for auto-scale values (needed in handlePointerMove for coordinate transformation)
  const autoScaleRef = useRef(autoScale)
  autoScaleRef.current = autoScale
  const autoScaleOffsetRef = useRef(autoScaleOffset)
  autoScaleOffsetRef.current = autoScaleOffset

  // Helper to get best seat count - use MAX of capacity and actual seats, plus any extra virtual seats
  const getTableSeatCount = useCallback((t: FloorPlanTable): number => {
    const seatsLen = t.seats?.length || 0
    const cap = t.capacity || 0
    const extra = extraSeats.get(t.id) || 0
    return Math.max(seatsLen, cap) + extra
  }, [extraSeats])

  // Get all tables in a virtual group (returns array with primary table first)
  // FIX: Uses tablesRef.current to always access latest tables data
  const getVirtualGroupTables = useCallback((table: FloorPlanTable | null): FloorPlanTable[] => {
    if (!table) return []
    if (!table.virtualGroupId) return [table]

    // Find all tables in the same virtual group - use ref for latest data
    const groupTables = tablesRef.current.filter(t => t.virtualGroupId === table.virtualGroupId)

    // Sort so primary table is first
    return groupTables.sort((a, b) => {
      if (a.virtualGroupPrimary) return -1
      if (b.virtualGroupPrimary) return 1
      return 0
    })
  }, [])

  // Calculate total seats for a table (including combined tables or virtual group)
  // Uses perimeter-based capacity for combined groups to avoid the "8-seat" problem
  // FIX: Uses tablesRef.current to always access latest tables data (avoids stale closure)
  const getTotalSeats = useCallback((table: FloorPlanTable | null): number => {
    if (!table) return 0

    // Always use the ref to get the latest tables data
    const currentTables = tablesRef.current

    // If this is a virtual group, sum all tables in the group (including extra seats)
    if (table.virtualGroupId) {
      const groupTables = getVirtualGroupTables(table)
      const total = groupTables.reduce((sum, t) => {
        const tableSeats = getTableSeatCount(t)
        const tableExtra = extraSeats.get(t.id) || 0
        return sum + tableSeats + tableExtra
      }, 0)
      logger.log(`[getTotalSeats] Virtual group ${table.name}: tables=${groupTables.length}, total=${total}`)
      return total
    }

    // FIX: If this is a CHILD of a combined group, redirect to the PRIMARY
    // This handles the case where user taps on a child table or if activeTableId is stale
    if (table.combinedWithId) {
      const primaryTable = currentTables.find(t => t.id === table.combinedWithId)
      if (primaryTable) {
        logger.log(`[getTotalSeats] Redirecting from child ${table.name} to primary ${primaryTable.name}`)
        // Calculate seats from the primary's perspective
        const combinedIds = primaryTable.combinedTableIds as string[] | null
        if (combinedIds && Array.isArray(combinedIds) && combinedIds.length > 0) {
          const primarySeats = primaryTable.seats?.length || 0
          const primaryExtra = extraSeats.get(primaryTable.id) || 0
          let totalSeats = primarySeats + primaryExtra

          for (const childId of combinedIds) {
            const childTable = currentTables.find(t => t.id === childId)
            if (childTable) {
              const childSeats = childTable.seats?.length || 0
              const childExtra = extraSeats.get(childId) || 0
              totalSeats += childSeats + childExtra
            }
          }

          if (totalSeats === 0) {
            totalSeats = primaryTable.capacity || 0
          }

          logger.log(`[getTotalSeats] Child ${table.name} -> Primary ${primaryTable.name}: TOTAL=${totalSeats}`)
          return totalSeats
        }
        // Primary doesn't have combinedTableIds - fall back to primary's seat count
        return getTableSeatCount(primaryTable)
      }
      // Primary not found - just return this table's count
      logger.warn(`[getTotalSeats] Primary table ${table.combinedWithId} not found for child ${table.name}`)
    }

    // If this is a combined table (primary), sum seats from primary + all children
    // Use combinedTableIds directly instead of getCombinedGroupTables for reliability
    const combinedIds = table.combinedTableIds as string[] | null
    if (combinedIds && Array.isArray(combinedIds) && combinedIds.length > 0) {
      // Start with primary table's seats
      const primarySeats = table.seats?.length || 0
      const primaryExtra = extraSeats.get(table.id) || 0
      let totalSeats = primarySeats + primaryExtra

      logger.log(`[getTotalSeats] Combined primary ${table.name}: seats.length=${primarySeats}, extra=${primaryExtra}, combinedIds=${combinedIds.length}`)

      // Add seats from each child table listed in combinedTableIds
      for (const childId of combinedIds) {
        const childTable = currentTables.find(t => t.id === childId)
        if (childTable) {
          const childSeats = childTable.seats?.length || 0
          const childExtra = extraSeats.get(childId) || 0
          logger.log(`[getTotalSeats] + Child ${childTable.name}: seats.length=${childSeats}, extra=${childExtra}`)
          totalSeats += childSeats + childExtra
        } else {
          logger.warn(`[getTotalSeats] Child table ${childId} not found in tables array! (tables count: ${currentTables.length})`)
        }
      }

      // If no actual seat records exist, fall back to primary's combined capacity
      if (totalSeats === 0) {
        totalSeats = table.capacity || 0
        logger.log(`[getTotalSeats] No seats found, using capacity=${totalSeats}`)
      }

      logger.log(`[getTotalSeats] Combined table ${table.name}: TOTAL=${totalSeats}`)
      return totalSeats
    }

    // Single table - use MAX of capacity and seats array length
    const seatCount = getTableSeatCount(table)
    logger.log(`[getTotalSeats] Table ${table.name}: capacity=${table.capacity}, seats.length=${table.seats?.length}, returning=${seatCount}`)
    return seatCount
  }, [getTableSeatCount, getVirtualGroupTables, extraSeats])

  // Get combined table count (includes virtual groups)
  const getCombinedTableCount = useCallback((table: FloorPlanTable | null): number => {
    if (!table) return 0

    // Check virtual group first
    if (table.virtualGroupId) {
      const groupTables = getVirtualGroupTables(table)
      return groupTables.length
    }

    // Physical combine
    if (table.combinedTableIds && table.combinedTableIds.length > 0) {
      return table.combinedTableIds.length + 1 // +1 for the primary table
    }
    return 1
  }, [getVirtualGroupTables])

  // Get the active table object
  const activeTable = activeTableId ? tables.find(t => t.id === activeTableId) || null : null

  // FIX 3: Group order items by seat for display - use useMemo instead of useCallback
  // useCallback returns a function that runs on every render; useMemo caches the result
  const groupedOrderItems = useMemo(() => {
    if (!activeTable || getTotalSeats(activeTable) === 0) {
      // No seats - just return all items in one "group"
      return [{ seatNumber: null, sourceTableId: null, label: 'All Items', items: inlineOrderItems }]
    }

    const groups: { seatNumber: number | null; sourceTableId: string | null; label: string; items: InlineOrderItem[] }[] = []

    // For virtual groups, use T-S notation (e.g., T4-S1)
    const isVirtualGroup = activeTable.virtualGroupId !== null

    if (isVirtualGroup) {
      // Group by sourceTableId + seatNumber
      const seatKeys = new Map<string, InlineOrderItem[]>()

      inlineOrderItems.forEach(item => {
        if (item.seatNumber && item.sourceTableId) {
          const key = `${item.sourceTableId}-${item.seatNumber}`
          if (!seatKeys.has(key)) {
            seatKeys.set(key, [])
          }
          seatKeys.get(key)!.push(item)
        }
      })

      // Sort by table name, then seat number
      const sortedKeys = Array.from(seatKeys.keys()).sort((a, b) => {
        const [tableIdA, seatA] = a.split('-')
        const [tableIdB, seatB] = b.split('-')
        const tableA = tables.find(t => t.id === tableIdA)
        const tableB = tables.find(t => t.id === tableIdB)
        const nameCompare = (tableA?.name || '').localeCompare(tableB?.name || '')
        if (nameCompare !== 0) return nameCompare
        return parseInt(seatA) - parseInt(seatB)
      })

      sortedKeys.forEach(key => {
        const [tableId, seatNumStr] = key.split('-')
        const seatNum = parseInt(seatNumStr)
        const table = tables.find(t => t.id === tableId)
        const tableLabel = table?.abbreviation || table?.name || 'Table'
        groups.push({
          seatNumber: seatNum,
          sourceTableId: tableId,
          label: `${tableLabel}-S${seatNum}`,
          items: seatKeys.get(key)!,
        })
      })
    } else {
      // Non-virtual group - simple seat grouping
      const seatsWithItems = new Set<number>()
      inlineOrderItems.forEach(item => {
        if (item.seatNumber) {
          seatsWithItems.add(item.seatNumber)
        }
      })

      Array.from(seatsWithItems).sort((a, b) => a - b).forEach(seatNum => {
        groups.push({
          seatNumber: seatNum,
          sourceTableId: null,
          label: `Seat ${seatNum}`,
          items: inlineOrderItems.filter(item => item.seatNumber === seatNum),
        })
      })
    }

    // Add shared items (no seat) at the end
    const sharedItems = inlineOrderItems.filter(item => !item.seatNumber)
    if (sharedItems.length > 0) {
      groups.push({
        seatNumber: null,
        sourceTableId: null,
        label: 'Shared',
        items: sharedItems,
      })
    }

    return groups
  }, [activeTable, getTotalSeats, inlineOrderItems, tables])

  // Convert grouped order items to OrderPanel seatGroups format
  const seatGroupsForPanel = useMemo(() => {
    if (!activeTableId || inlineOrderItems.length === 0) return undefined

    const groups = groupedOrderItems

    // If only one group with no seat number (e.g., "All Items"), don't use seat grouping
    if (groups.length === 1 && groups[0].seatNumber === null) {
      return undefined
    }

    // Convert to OrderPanel's SeatGroup format
    return groups.map(group => ({
      seatNumber: group.seatNumber,
      sourceTableId: group.sourceTableId,
      label: group.label,
      items: group.items.map(i => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        price: i.price,
        modifiers: i.modifiers?.map(m => ({ name: m.name, price: m.price })),
        specialNotes: i.specialNotes,
        kitchenStatus: i.kitchenStatus as OrderPanelItemData['kitchenStatus'],
        isHeld: i.isHeld,
        isCompleted: i.isCompleted,
        isTimedRental: i.isTimedRental,
        menuItemId: i.menuItemId,
        blockTimeMinutes: i.blockTimeMinutes,
        blockTimeStartedAt: i.blockTimeStartedAt,
        blockTimeExpiresAt: i.blockTimeExpiresAt,
        seatNumber: i.seatNumber,
        courseNumber: i.courseNumber,
        courseStatus: i.courseStatus,
        sentToKitchen: i.sentToKitchen,
        resendCount: i.resendCount,
        completedAt: i.completedAt,
        createdAt: i.createdAt,
      })),
    }))
  }, [activeTableId, inlineOrderItems, groupedOrderItems])

  // Quick bar items with full data
  const [quickBarItems, setQuickBarItems] = useState<{
    id: string
    name: string
    price: number
    bgColor?: string | null
    textColor?: string | null
  }[]>([])

  // Load quick bar items when quickBar changes
  useEffect(() => {
    if (quickBar.length === 0) {
      setQuickBarItems([])
      return
    }

    const loadQuickBarItems = async () => {
      try {
        // Fetch item details for each quick bar item
        const itemPromises = quickBar.map(async (itemId) => {
          const res = await fetch(`/api/menu/items/${itemId}`)
          if (res.ok) {
            const data = await res.json()
            const customStyle = menuItemColors[itemId]
            return {
              id: data.item.id,
              name: data.item.name,
              price: Number(data.item.price),
              bgColor: customStyle?.bgColor || null,
              textColor: customStyle?.textColor || null,
            }
          }
          return null
        })

        const items = await Promise.all(itemPromises)
        setQuickBarItems(items.filter(Boolean) as typeof quickBarItems)
      } catch (error) {
        console.error('[FloorPlanHome] Quick bar items load error:', error)
      }
    }

    loadQuickBarItems()
  }, [quickBar, menuItemColors])

  // Load data on mount
  useEffect(() => {
    loadFloorPlanData()
    loadCategories()
    loadOpenOrdersCount()
    // Clear any leftover virtual combine state from previous sessions
    cancelVirtualCombineMode()
  }, [locationId, cancelVirtualCombineMode])

  // Consolidated heartbeat - single interval for all periodic tasks
  // FIX 4: Uses refs for callbacks to prevent interval restart on re-render
  // This prevents multiple setIntervals from causing frame drops during animations
  useEffect(() => {
    let tickCount = 0
    const heartbeat = setInterval(() => {
      tickCount++

      // Every tick (1s): Clear expired undos and flashes
      callbacksRef.current.clearExpiredUndos()
      callbacksRef.current.clearExpiredFlashes()

      // Every 30 ticks (30s): Refresh floor plan data for live preview
      // This allows admin changes to tables/entertainment to appear on POS
      if (tickCount % 30 === 0 && tickCount > 0) {
        callbacksRef.current.loadFloorPlanData?.()
      }

      // Every 60 ticks (60s): Refresh open orders count
      if (tickCount >= 60) {
        tickCount = 0
        callbacksRef.current.loadOpenOrdersCount?.()
      }
    }, 1000)

    return () => clearInterval(heartbeat)
  }, []) // Empty deps - refs keep callbacks fresh

  // Socket.io: Listen for floor plan updates from admin
  const { subscribe, isConnected } = useEvents({ locationId, autoConnect: true })

  useEffect(() => {
    if (!isConnected) return

    // Subscribe to floor-plan:updated event for live preview
    // Pass false to skip loading state during background refresh
    const unsubscribe = subscribe('floor-plan:updated', () => {
      logger.log('[FloorPlanHome] Received floor-plan:updated event, refreshing...')
      loadFloorPlanData(false)
    })

    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, subscribe])

  // Load order when orderToLoad prop is set (from Open Orders panel)
  useEffect(() => {
    if (!orderToLoad) return

    const loadOrder = async () => {
      try {
        const res = await fetch(`/api/orders/${orderToLoad.id}`)
        if (!res.ok) {
          console.error('[FloorPlanHome] Failed to load order:', orderToLoad.id)
          toast.error('Failed to load order. Please try again.')
          return
        }

        const data = await res.json()

        // Set order state
        setActiveOrderId(orderToLoad.id)
        setActiveOrderNumber(String(orderToLoad.orderNumber))
        setActiveTableId(orderToLoad.tableId || null)
        setActiveOrderType(orderToLoad.orderType || 'bar_tab')
        setShowOrderPanel(true)

        // Load items
        const items = (data.items || []).map((item: { id: string; menuItemId: string; name: string; price: number; quantity: number; modifiers?: { id: string; name: string; price: number }[]; specialNotes?: string; seatNumber?: number; courseNumber?: number; courseStatus?: string; isHeld?: boolean; isCompleted?: boolean; kitchenStatus?: string; status?: string; blockTimeMinutes?: number; completedAt?: string; resendCount?: number; resendNote?: string; createdAt?: string }) => ({
          id: item.id,
          menuItemId: item.menuItemId,
          name: item.name || 'Unknown',
          price: Number(item.price) || 0,
          quantity: item.quantity,
          modifiers: (item.modifiers || []).map((m: { id: string; name: string; price: number }) => ({
            id: m.id,
            name: m.name || '',
            price: Number(m.price) || 0,
          })),
          specialNotes: item.specialNotes,
          seatNumber: item.seatNumber,
          courseNumber: item.courseNumber,
          courseStatus: item.courseStatus as 'pending' | 'fired' | 'ready' | 'served' | undefined,
          isHeld: item.isHeld,
          isCompleted: item.isCompleted,
          sentToKitchen: item.kitchenStatus !== 'pending' && item.kitchenStatus !== undefined,
          status: item.status as 'active' | 'voided' | 'comped' | undefined,
          blockTimeMinutes: item.blockTimeMinutes,
          // Item lifecycle status
          kitchenStatus: item.kitchenStatus as 'pending' | 'cooking' | 'ready' | 'delivered' | undefined,
          completedAt: item.completedAt,
          resendCount: item.resendCount,
          resendNote: item.resendNote,
          createdAt: item.createdAt,
        }))
        setInlineOrderItems(items)

        // Store is already updated via setInlineOrderItems shim — no separate sync needed

        // Notify parent that order is loaded
        onOrderLoaded?.()
      } catch (error) {
        console.error('[FloorPlanHome] Failed to load order:', error)
        toast.error('Failed to load order. Please try again.')
      }
    }

    loadOrder()
  }, [orderToLoad, onOrderLoaded])

  // Clear order when it's been paid (paidOrderId matches activeOrderId)
  useEffect(() => {
    if (!paidOrderId) return
    if (paidOrderId !== activeOrderId) return

    // Clear extra seats for the table that was just paid
    // (extra seats are temporary and should reset when ticket is closed)
    if (activeTableId) {
      const activeTable = tables.find(t => t.id === activeTableId)
      if (activeTable?.virtualGroupId) {
        // Clear extra seats for all tables in the virtual group
        const groupTables = tables.filter(t => t.virtualGroupId === activeTable.virtualGroupId)
        setExtraSeats(prev => {
          const next = new Map(prev)
          groupTables.forEach(t => next.delete(t.id))
          return next
        })
      } else {
        // Clear extra seats for just this table
        setExtraSeats(prev => {
          const next = new Map(prev)
          next.delete(activeTableId)
          return next
        })
      }
    }

    // Clear the order panel state
    setActiveOrderId(null)
    setActiveOrderNumber(null)
    setActiveTableId(null)
    setActiveOrderType(null)
    setInlineOrderItems([])
    setShowOrderPanel(false)
    setSelectedCategoryId(null)
    setViewMode('tables')

    // Clear Zustand store for cross-route persistence
    useOrderStore.getState().clearOrder()

    // Refresh floor plan to show updated table status
    loadFloorPlanData()
    loadOpenOrdersCount()

    // Notify parent that we've cleared the paid order
    onPaidOrderCleared?.()
  }, [paidOrderId, activeOrderId, activeTableId, tables, onPaidOrderCleared])

  // Refs to track previous data for change detection (prevents flashing during polling)
  const prevTablesJsonRef = useRef<string>('')
  const prevSectionsJsonRef = useRef<string>('')
  const prevElementsJsonRef = useRef<string>('')

  // Ref to prevent double-tap race condition on Send button
  const isProcessingSendRef = useRef(false)

  // FIX 4: Refs for heartbeat callbacks - prevents interval restart on re-render
  const callbacksRef = useRef({
    clearExpiredUndos,
    clearExpiredFlashes,
    loadFloorPlanData: null as (() => Promise<void>) | null,
    loadOpenOrdersCount: null as (() => Promise<void>) | null,
  })

  const loadFloorPlanData = async (showLoading = true) => {
    // Only show loading state on initial load, not during background polling
    if (showLoading) setLoading(true)
    try {
      const [tablesRes, sectionsRes, elementsRes] = await Promise.all([
        fetch(`/api/tables?locationId=${locationId}&includeSeats=true&includeOrders=true&includeOrderItems=true`),
        fetch(`/api/sections?locationId=${locationId}`),
        fetch(`/api/floor-plan-elements?locationId=${locationId}`),
      ])

      if (tablesRes.ok) {
        const data = await tablesRes.json()
        const newTables = data.tables || []
        // Only update if data actually changed to prevent flashing during polling
        const newJson = JSON.stringify(newTables)
        if (newJson !== prevTablesJsonRef.current) {
          prevTablesJsonRef.current = newJson
          setTables(newTables)
        }
      }
      if (sectionsRes.ok) {
        const data = await sectionsRes.json()
        const newSections = data.sections || []
        const newJson = JSON.stringify(newSections)
        if (newJson !== prevSectionsJsonRef.current) {
          prevSectionsJsonRef.current = newJson
          setSections(newSections)
        }
      }
      if (elementsRes.ok) {
        const data = await elementsRes.json()
        const newElements = data.elements || []
        const newJson = JSON.stringify(newElements)
        if (newJson !== prevElementsJsonRef.current) {
          prevElementsJsonRef.current = newJson
          setElements(newElements)
        }
      }
    } catch (error) {
      console.error('[FloorPlanHome] Load error:', error)
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  const loadCategories = async () => {
    try {
      // Use same /api/menu endpoint as orders page for consistency
      const timestamp = Date.now()
      const params = new URLSearchParams({ locationId, _t: timestamp.toString() })
      const res = await fetch(`/api/menu?${params}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })
      if (res.ok) {
        const data = await res.json()
        setCategories(data.categories || [])
      }
    } catch (error) {
      console.error('[FloorPlanHome] Categories load error:', error)
    }
  }

  const loadOpenOrdersCount = async () => {
    try {
      const res = await fetch(`/api/orders?locationId=${locationId}&status=open&count=true`)
      if (res.ok) {
        const data = await res.json()
        setOpenOrdersCount(data.count || 0)
      }
    } catch (error) {
      console.error('[FloorPlanHome] Open orders count error:', error)
    }
  }

  // FIX 4: Keep refs updated with latest callbacks
  useEffect(() => {
    callbacksRef.current = {
      clearExpiredUndos,
      clearExpiredFlashes,
      loadFloorPlanData: () => loadFloorPlanData(false),
      loadOpenOrdersCount,
    }
  })

  const loadMenuItems = async (categoryId: string) => {
    setLoadingMenuItems(true)
    try {
      // Include stock status for prep item tracking
      const res = await fetch(`/api/menu/items?categoryId=${categoryId}&locationId=${locationId}&includeStock=true`)
      if (res.ok) {
        const data = await res.json()
        setMenuItems(data.items || [])
      }
    } catch (error) {
      console.error('[FloorPlanHome] Menu items load error:', error)
    } finally {
      setLoadingMenuItems(false)
    }
  }

  // Handle category click - toggle between tables and menu view
  const handleCategoryClick = useCallback((categoryId: string | null) => {
    if (!categoryId) {
      // "All" was clicked - show tables
      setSelectedCategoryId(null)
      setViewMode('tables')
      setMenuItems([])
      return
    }

    // Toggle behavior: clicking same category deselects it
    if (categoryId === selectedCategoryId) {
      setSelectedCategoryId(null)
      setViewMode('tables')
      setMenuItems([])
      return
    }

    // Select new category
    setSelectedCategoryId(categoryId)
    setViewMode('menu')
    loadMenuItems(categoryId)
  }, [selectedCategoryId])


  // Handle confirming virtual combine
  const handleConfirmVirtualCombine = useCallback(async (existingOrderActions?: Array<{ orderId: string; action: 'merge' | 'close' }>) => {
    if (virtualCombineSelectedIds.size < 2) return

    // FIX: Use tablesRef.current to get latest table data (avoids stale closure)
    const currentTables = tablesRef.current
    const selectedTableIds = Array.from(virtualCombineSelectedIds)
    const primaryId = virtualCombinePrimaryId || selectedTableIds[0]
    const primaryTable = currentTables.find(t => t.id === primaryId)

    setIsCreatingVirtualGroup(true)

    try {
      // Check if primary table is already in a virtual group (ADD mode vs CREATE mode)
      if (primaryTable?.virtualGroupId) {
        // ADD mode: Add new tables to existing group
        const existingGroupId = primaryTable.virtualGroupId
        const tablesToAdd = selectedTableIds.filter(id => {
          const table = currentTables.find(t => t.id === id)
          return !table?.virtualGroupId // Only add tables not already in the group
        })

        if (tablesToAdd.length === 0) {
          toast.info('All selected tables are already in this group')
          clearVirtualCombineMode()
          return
        }

        // Add each new table to the group
        const addedTables: Array<{ id: string; virtualGroupId: string; virtualGroupPrimary: boolean; virtualGroupColor: string }> = []

        for (const tableId of tablesToAdd) {
          const res = await fetch(`/api/tables/virtual-combine/${existingGroupId}/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tableId,
              locationId,
              employeeId,
              mergeExistingOrder: existingOrderActions?.find(a =>
                currentTables.find(t => t.id === tableId)?.currentOrder?.id === a.orderId
              )?.action === 'merge',
            }),
          })

          const data = await res.json()

          if (data.requiresAction) {
            // Show modal to handle this table's existing order
            setPendingExistingOrders([data.existingOrder])
            setShowExistingOrdersModal(true)
            setIsCreatingVirtualGroup(false)
            return
          }

          if (!res.ok) {
            throw new Error(data.error || `Failed to add table to group`)
          }

          if (data.data?.table) {
            addedTables.push({
              id: data.data.table.id,
              virtualGroupId: data.data.table.virtualGroupId,
              virtualGroupPrimary: false,
              virtualGroupColor: data.data.table.virtualGroupColor,
            })
          }
        }

        // Update local state with added tables
        if (addedTables.length > 0) {
          updateTablesWithVirtualGroup(addedTables)
        }

        toast.success(`Added ${tablesToAdd.length} table${tablesToAdd.length > 1 ? 's' : ''} to virtual group`)
      } else {
        // CREATE mode: Create a new STATIC virtual group (long-hold)
        // Tables stay in their original positions - NO visual offsets
        // This creates a color-linked group where each table keeps its own seats
        // (Contrast with drag-drop mode which snaps tables together and redistributes seats)

        const res = await fetch('/api/tables/virtual-combine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tableIds: selectedTableIds,
            primaryTableId: primaryId,
            locationId,
            employeeId,
            existingOrderActions,
            // NO visualOffsets - this creates a STATIC group where tables stay in place
          }),
        })

        const data = await res.json()

        if (data.requiresAction) {
          // Show modal to handle existing orders
          setPendingExistingOrders(data.existingOrders)
          setShowExistingOrdersModal(true)
          setIsCreatingVirtualGroup(false)
          return
        }

        if (!res.ok) {
          throw new Error(data.error || 'Failed to create virtual group')
        }

        // Update local state with new virtual group info
        if (data.data?.tables) {
          updateTablesWithVirtualGroup(
            data.data.tables.map((t: { id: string; virtualGroupId: string; virtualGroupPrimary: boolean; virtualGroupColor: string }) => ({
              id: t.id,
              virtualGroupId: t.virtualGroupId,
              virtualGroupPrimary: t.virtualGroupPrimary,
              virtualGroupColor: t.virtualGroupColor,
            }))
          )
        }

        toast.success(`Virtual group created with ${selectedTableIds.length} tables`)
      }

      clearVirtualCombineMode()
      setShowExistingOrdersModal(false)
      setPendingExistingOrders([])
    } catch (error) {
      console.error('Failed to create/add to virtual group:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to create virtual group')
    } finally {
      setIsCreatingVirtualGroup(false)
    }
  }, [virtualCombineSelectedIds, virtualCombinePrimaryId, locationId, employeeId, updateTablesWithVirtualGroup, clearVirtualCombineMode, calculateSnapPositionForTableInGroup])
  // Note: Using tablesRef.current instead of tables in dependency array

  // Handle table tap - open order panel
  // If tapped table is part of a combined group, redirect to the PRIMARY table
  // If in virtual combine mode, toggle selection instead
  // FIX: Uses tablesRef.current to always access latest tables data
  const handleTableTap = useCallback(async (table: FloorPlanTable) => {
    logger.log('[VirtualCombine] handleTableTap called:', { tableId: table.id, virtualCombineMode, selectedIds: Array.from(virtualCombineSelectedIds) })

    // Always use the ref to get the latest tables data
    const currentTables = tablesRef.current

    // In virtual combine mode, toggle selection
    if (virtualCombineMode) {
      const primaryTable = currentTables.find(t => t.id === virtualCombinePrimaryId)
      const primaryGroupId = primaryTable?.virtualGroupId

      // Prevent selecting tables that are in a DIFFERENT virtual group
      if (table.virtualGroupId && table.virtualGroupId !== primaryGroupId && !virtualCombineSelectedIds.has(table.id)) {
        toast.error(`${table.name} is already in another group. Dissolve that group first.`)
        return
      }
      // Prevent selecting tables that are physically combined
      if (table.combinedWithId || (table.combinedTableIds && table.combinedTableIds.length > 0)) {
        toast.error(`${table.name} is physically combined. Split it first.`)
        return
      }
      logger.log('[VirtualCombine] Toggling selection for table:', table.id)
      toggleVirtualCombineSelection(table.id)
      return
    }

    if (selectedSeat) {
      clearSelectedSeat()
    }

    // If this table is in a VIRTUAL group, redirect to the PRIMARY virtual table
    if (table.virtualGroupId && !table.virtualGroupPrimary) {
      const virtualPrimary = currentTables.find(t => t.virtualGroupId === table.virtualGroupId && t.virtualGroupPrimary)
      if (virtualPrimary) {
        table = virtualPrimary
      }
    }

    // If this table is combined INTO another (physical), find and use the primary instead
    // FIX: Also check if the table passed in has stale data - look up fresh from ref
    let primaryTable = table
    const freshTable = currentTables.find(t => t.id === table.id)
    if (freshTable?.combinedWithId) {
      const foundPrimary = currentTables.find(t => t.id === freshTable.combinedWithId)
      if (foundPrimary) {
        primaryTable = foundPrimary
        logger.log(`[handleTableTap] Redirecting from child ${table.name} to primary ${foundPrimary.name}`)
      }
    } else if (table.combinedWithId) {
      const foundPrimary = currentTables.find(t => t.id === table.combinedWithId)
      if (foundPrimary) {
        primaryTable = foundPrimary
      }
    }

    const totalSeats = getTotalSeats(primaryTable)
    logger.log(`[handleTableTap] Setting guest count to ${totalSeats} for table ${primaryTable.name} (capacity=${primaryTable.capacity})`)

    setActiveTableId(primaryTable.id)
    setActiveOrderType('dine_in')
    setShowOrderPanel(true)
    setActiveSeatNumber(null) // Reset active seat when switching tables
    setActiveSourceTableId(null) // Reset source table too
    setGuestCount(totalSeats) // Set guest count based on table capacity

    if (primaryTable.currentOrder) {
      // Load existing order items from PRIMARY table (combined tables share one order)
      setActiveOrderId(primaryTable.currentOrder.id)
      setActiveOrderNumber(String(primaryTable.currentOrder.orderNumber))
      try {
        const res = await fetch(`/api/orders/${primaryTable.currentOrder.id}`)
        if (res.ok) {
          const data = await res.json()
          const items = (data.items || []).map((item: { id: string; menuItemId: string; name: string; price: number; quantity: number; modifiers?: { id: string; name: string; price: number }[]; specialNotes?: string; seatNumber?: number; courseNumber?: number; courseStatus?: string; isHeld?: boolean; isCompleted?: boolean; kitchenStatus?: string; status?: string; blockTimeMinutes?: number; completedAt?: string; resendCount?: number; resendNote?: string; createdAt?: string }) => ({
            id: item.id,
            menuItemId: item.menuItemId,
            name: item.name || 'Unknown',
            price: Number(item.price) || 0,
            quantity: item.quantity,
            modifiers: (item.modifiers || []).map((m: { id: string; name: string; price: number }) => ({
              id: m.id,
              name: m.name || '',
              price: Number(m.price) || 0,
            })),
            specialNotes: item.specialNotes,
            seatNumber: item.seatNumber,
            courseNumber: item.courseNumber,
            courseStatus: item.courseStatus as 'pending' | 'fired' | 'ready' | 'served' | undefined,
            isHeld: item.isHeld,
            isCompleted: item.isCompleted,
            sentToKitchen: item.kitchenStatus !== 'pending' && item.kitchenStatus !== undefined,
            status: item.status as 'active' | 'voided' | 'comped' | undefined,
            blockTimeMinutes: item.blockTimeMinutes,
            // Item lifecycle status
            kitchenStatus: item.kitchenStatus as 'pending' | 'cooking' | 'ready' | 'delivered' | undefined,
            completedAt: item.completedAt,
            resendCount: item.resendCount,
            resendNote: item.resendNote,
            createdAt: item.createdAt,
          }))
          setInlineOrderItems(items)

          // Store is already updated via setInlineOrderItems shim — no separate sync needed
        }
      } catch (error) {
        console.error('[FloorPlanHome] Failed to load order:', error)
      }
    } else {
      // FIX: Only clear items if we're switching to a DIFFERENT table
      // If tapping the same table we already have selected, preserve unsaved items
      const isSameTable = activeTableId === primaryTable.id
      if (!isSameTable) {
        setActiveOrderId(null)
        setActiveOrderNumber(null)
        setInlineOrderItems([])
        useOrderStore.getState().clearOrder()
      }
      // If same table, keep existing items (user may have added items but not sent yet)
    }
  }, [selectedSeat, clearSelectedSeat, getTotalSeats, virtualCombineMode, toggleVirtualCombineSelection, virtualCombineSelectedIds.size, virtualCombinePrimaryId, activeTableId])

  // Handle quick order type (Takeout, Delivery, Bar Tab)
  const handleQuickOrderType = useCallback((orderType: QuickOrderType) => {
    setActiveTableId(null)
    setActiveOrderType(orderType)
    setActiveOrderId(null)
    setActiveOrderNumber(null)
    setInlineOrderItems([])
    useOrderStore.getState().clearOrder()
    setShowOrderPanel(true)
  }, [])

  // Handle menu item tap - add to order
  const handleMenuItemTap = useCallback(async (item: MenuItem) => {
    // Check for timed rental (entertainment) items - show rate selection modal
    if (item.itemType === 'timed_rental' && onOpenTimedRental) {
      onOpenTimedRental(item, (price: number, blockMinutes: number) => {
        const newItem: InlineOrderItem = {
          id: `temp-${crypto.randomUUID()}`,
          menuItemId: item.id,
          name: item.name,
          price: price, // Use selected rate price
          quantity: 1,
          modifiers: [],
          seatNumber: activeSeatNumber || undefined,
          sourceTableId: activeSourceTableId || undefined,
          sentToKitchen: false,
          // Store block time info for timed session
          blockTimeMinutes: blockMinutes,
        }
        setInlineOrderItems(prev => [...prev, newItem])
      })
      return
    }

    // Check for pizza items - show pizza builder modal
    if (item.isPizza && onOpenPizzaBuilder) {
      onOpenPizzaBuilder(item, (config: PizzaOrderConfig) => {
        // Build pizza item with selections as modifiers
        // Use priceBreakdown since the global PizzaOrderConfig structure has that
        const pizzaModifiers: { id: string; name: string; price: number }[] = []

        // Add size and crust
        pizzaModifiers.push({ id: config.sizeId, name: `Size`, price: config.priceBreakdown.sizePrice })
        pizzaModifiers.push({ id: config.crustId, name: `Crust`, price: config.priceBreakdown.crustPrice })

        // Add sauces if present
        if (config.sauces && config.sauces.length > 0) {
          config.sauces.forEach(s => {
            pizzaModifiers.push({ id: s.sauceId, name: `${s.name} (${s.amount})`, price: s.price || 0 })
          })
        } else if (config.sauceId) {
          pizzaModifiers.push({ id: config.sauceId, name: `Sauce (${config.sauceAmount})`, price: config.priceBreakdown.saucePrice })
        }

        // Add cheeses if present
        if (config.cheeses && config.cheeses.length > 0) {
          config.cheeses.forEach(c => {
            pizzaModifiers.push({ id: c.cheeseId, name: `${c.name} (${c.amount})`, price: c.price || 0 })
          })
        } else if (config.cheeseId) {
          pizzaModifiers.push({ id: config.cheeseId, name: `Cheese (${config.cheeseAmount})`, price: config.priceBreakdown.cheesePrice })
        }

        // Add toppings
        config.toppings.forEach(t => {
          const sectionStr = t.sections ? `sections: ${t.sections.length}` : ''
          pizzaModifiers.push({ id: t.toppingId, name: `${t.name}${sectionStr ? ` (${sectionStr})` : ''}`, price: t.price })
        })

        const newItem: InlineOrderItem = {
          id: `temp-${crypto.randomUUID()}`,
          menuItemId: item.id,
          name: item.name,
          price: config.totalPrice, // Use calculated pizza price
          quantity: 1,
          modifiers: pizzaModifiers,
          seatNumber: activeSeatNumber || undefined,
          sourceTableId: activeSourceTableId || undefined,
          sentToKitchen: false,
        }
        setInlineOrderItems(prev => [...prev, newItem])
      })
      return
    }

    // If item has modifiers, check if defaults can auto-fill all required groups
    if (item.hasModifiers && onOpenModifiers) {
      // Try to auto-add with defaults (no modal needed if defaults satisfy requirements)
      try {
        const res = await fetch(`/api/menu/items/${item.id}/modifier-groups`)
        if (res.ok) {
          const { data: groups } = await res.json()
          if (groups && groups.length > 0) {
            // Collect all default modifiers and check if required groups are satisfied
            const defaultMods: { id: string; name: string; price: number }[] = []
            let allRequiredSatisfied = true

            for (const group of groups) {
              const defaults = (group.modifiers || []).filter((m: any) => m.isDefault)
              defaults.forEach((m: any) => {
                defaultMods.push({ id: m.id, name: m.name, price: Number(m.price || 0) })
              })
              // Check if required group has enough defaults
              if (group.isRequired && group.minSelections > 0 && defaults.length < group.minSelections) {
                allRequiredSatisfied = false
              }
            }

            // If defaults satisfy all requirements, add directly — skip modal
            if (allRequiredSatisfied && defaultMods.length > 0) {
              const modPrice = defaultMods.reduce((sum, m) => sum + m.price, 0)
              const newItem: InlineOrderItem = {
                id: `temp-${crypto.randomUUID()}`,
                menuItemId: item.id,
                name: item.name,
                price: item.price,
                quantity: 1,
                modifiers: defaultMods,
                seatNumber: activeSeatNumber || undefined,
                sourceTableId: activeSourceTableId || undefined,
                sentToKitchen: false,
              }
              setInlineOrderItems(prev => [...prev, newItem])
              if (navigator.vibrate) navigator.vibrate(10)
              return
            }
          }
        }
      } catch (e) {
        // If fetch fails, fall through to open modal
        console.error('Failed to check defaults:', e)
      }

      // Defaults don't cover requirements — open modifier modal as usual
      onOpenModifiers(item, (modifiers) => {
        const newItem: InlineOrderItem = {
          id: `temp-${crypto.randomUUID()}`,
          menuItemId: item.id,
          name: item.name,
          price: item.price,
          quantity: 1,
          modifiers,
          seatNumber: activeSeatNumber || undefined,
          sourceTableId: activeSourceTableId || undefined,
          sentToKitchen: false,
        }
        setInlineOrderItems(prev => [...prev, newItem])
      })
      return
    }

    // Add item directly
    const newItem: InlineOrderItem = {
      id: `temp-${crypto.randomUUID()}`,
      menuItemId: item.id,
      name: item.name,
      price: item.price,
      quantity: 1,
      modifiers: [],
      seatNumber: activeSeatNumber || undefined, // Assign active seat
      sourceTableId: activeSourceTableId || undefined,
      sentToKitchen: false,
    }
    setInlineOrderItems(prev => [...prev, newItem])

    // Haptic feedback
    if (navigator.vibrate) {
      navigator.vibrate(10)
    }
  }, [onOpenModifiers, onOpenTimedRental, onOpenPizzaBuilder, activeSeatNumber, activeSourceTableId])

  // Handle search result selection
  const handleSearchSelect = useCallback((item: { id: string; name: string; price: number; categoryId: string }) => {
    // Find full menu item data
    const fullItem = menuItems.find(m => m.id === item.id)
    if (fullItem) {
      handleMenuItemTap(fullItem)
    }
    clearSearch()
  }, [menuItems, clearSearch, handleMenuItemTap])

  // Handle quick bar item click - add to order
  const handleQuickBarItemClick = useCallback(async (itemId: string) => {
    // Find the item in quickBarItems to get full info
    const qbItem = quickBarItems.find(i => i.id === itemId)
    if (!qbItem) return

    // Fetch full item details (including hasModifiers)
    try {
      const res = await fetch(`/api/menu/items/${itemId}`)
      if (!res.ok) return

      const { item } = await res.json()
      handleMenuItemTap({
        id: item.id,
        name: item.name,
        price: Number(item.price),
        categoryId: item.categoryId,
        categoryType: item.categoryType,
        hasModifiers: item.modifierGroups?.length > 0,
        itemType: item.itemType,
        isPizza: item.isPizza,
        entertainmentStatus: item.entertainmentStatus,
        blockTimeMinutes: item.blockTimeMinutes,
        timedPricing: item.timedPricing,
      })
    } catch (error) {
      console.error('[FloorPlanHome] Quick bar item load error:', error)
    }
  }, [quickBarItems, handleMenuItemTap])

  // Handle right-click on menu item (context menu)
  const handleMenuItemContextMenu = useCallback((e: React.MouseEvent, item: MenuItem) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      item,
    })
  }, [])

  // Close context menu
  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  // Update item quantity
  const handleUpdateQuantity = useCallback((itemId: string, quantity: number) => {
    if (quantity <= 0) {
      setInlineOrderItems(prev => prev.filter(item => item.id !== itemId))
    } else {
      setInlineOrderItems(prev =>
        prev.map(item =>
          item.id === itemId ? { ...item, quantity } : item
        )
      )
    }
  }, [])

  // Remove item
  const handleRemoveItem = useCallback((itemId: string) => {
    setInlineOrderItems(prev => prev.filter(item => item.id !== itemId))
  }, [])

  // Toggle hold on item
  const handleToggleHold = useCallback((itemId: string) => {
    setInlineOrderItems(prev =>
      prev.map(item =>
        item.id === itemId ? { ...item, isHeld: !item.isHeld } : item
      )
    )
  }, [])

  // Open notes editor
  const handleOpenNotesEditor = useCallback((itemId: string, currentNotes?: string) => {
    setEditingNotesItemId(itemId)
    setEditingNotesText(currentNotes || '')
  }, [])

  // Handle tapping an existing order item to edit modifiers
  const handleOrderItemTap = useCallback((item: InlineOrderItem) => {
    // Don't allow editing sent items
    if (item.sentToKitchen) {
      return
    }

    // Find the menu item to get modifier groups
    const menuItem = menuItems.find(m => m.id === item.menuItemId)
    if (!menuItem) return

    // Open modifier modal in "edit" mode with current modifiers
    if (onOpenModifiers) {
      onOpenModifiers(menuItem, (newModifiers) => {
        // Update the item's modifiers
        setInlineOrderItems(prev => prev.map(i =>
          i.id === item.id
            ? {
                ...i,
                modifiers: newModifiers,
              }
            : i
        ))
      }, item.modifiers) // Pass existing modifiers for pre-selection
    }
  }, [menuItems, onOpenModifiers])

  // Save notes
  const handleSaveNotes = useCallback(() => {
    if (editingNotesItemId) {
      setInlineOrderItems(prev =>
        prev.map(item =>
          item.id === editingNotesItemId
            ? { ...item, specialNotes: editingNotesText.trim() || undefined }
            : item
        )
      )
    }
    setEditingNotesItemId(null)
    setEditingNotesText('')
  }, [editingNotesItemId, editingNotesText])

  // Update seat number
  const handleUpdateSeat = useCallback((itemId: string, seatNumber: number | null) => {
    setInlineOrderItems(prev =>
      prev.map(item =>
        item.id === itemId
          ? { ...item, seatNumber: seatNumber || undefined }
          : item
      )
    )
  }, [])

  // Add a new seat to the table (Skill 121 - Atomic Seat Management)
  // Works with or without an active order
  const handleAddSeat = useCallback(async (tableId?: string) => {
    const targetTableId = tableId || activeTable?.id
    if (!targetTableId) {
      toast.error('No table selected')
      return
    }

    // If there's an active order, add seat via API
    if (activeOrderId) {
      try {
        const response = await fetch(`/api/orders/${activeOrderId}/seating`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'INSERT',
            position: getTotalSeats(activeTable) + 1, // Add at the end
          }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to add seat')
        }

        const result = await response.json()
        toast.success(`Seat ${result.position} added`)

        // Refresh the order to get updated seat count
        const orderResponse = await fetch(`/api/orders/${activeOrderId}`)
        if (orderResponse.ok) {
          // Force a refresh by updating the state
          setRefreshKey(prev => prev + 1)
        }
      } catch (err) {
        console.error('[FloorPlanHome] Failed to add seat:', err)
        toast.error(err instanceof Error ? err.message : 'Failed to add seat')
      }
    } else {
      // No active order - add a virtual seat locally
      setExtraSeats(prev => {
        const next = new Map(prev)
        const current = next.get(targetTableId) || 0
        next.set(targetTableId, current + 1)
        return next
      })
      // Use getTotalSeats for combined tables (8+5=13, so new seat is 14)
      const newSeatNum = getTotalSeats(activeTable!) + 1
      toast.success(`Seat ${newSeatNum} added`)
    }
  }, [activeOrderId, activeTable, getTotalSeats])

  // Update course number
  const handleUpdateCourse = useCallback((itemId: string, courseNumber: number | null) => {
    setInlineOrderItems(prev =>
      prev.map(item =>
        item.id === itemId
          ? { ...item, courseNumber: courseNumber || undefined }
          : item
      )
    )
  }, [])

  // Toggle item controls expansion
  const handleToggleItemControls = useCallback((itemId: string) => {
    setExpandedItemId(prev => prev === itemId ? null : itemId)
  }, [])

  // Edit item (reopen modifiers)
  const handleEditItem = useCallback((item: InlineOrderItem) => {
    // Find the menu item to get its data
    const menuItem = menuItems.find(mi => mi.id === item.menuItemId)
    if (!menuItem) return

    if (onOpenModifiers) {
      onOpenModifiers(menuItem, (newModifiers) => {
        setInlineOrderItems(prev =>
          prev.map(i =>
            i.id === item.id
              ? { ...i, modifiers: newModifiers }
              : i
          )
        )
      }, item.modifiers)
    }
  }, [menuItems, onOpenModifiers])

  // Save modifier changes to API and update local state
  const handleSaveModifierChanges = useCallback(async (
    itemId: string,
    newModifiers: { id: string; name: string; price: number }[]
  ) => {
    if (!activeOrderId) return

    try {
      const response = await fetch(`/api/orders/${activeOrderId}/items/${itemId}/modifiers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modifiers: newModifiers })
      })

      if (!response.ok) {
        const data = await response.json()
        toast.error(data.error || 'Failed to update modifiers')
        return
      }

      // Update local state
      setInlineOrderItems(prev => prev.map(item =>
        item.id === itemId
          ? { ...item, modifiers: newModifiers, resendCount: (item.resendCount || 0) + 1 }
          : item
      ))

      setEditingModifiersItemId(null)
      toast.success('Modifiers updated')
    } catch (error) {
      console.error('Failed to update modifiers:', error)
      toast.error('Connection error. Please try again.')
    }
  }, [activeOrderId])

  // Edit modifiers on a sent item
  const handleEditSentItemModifiers = useCallback((item: InlineOrderItem) => {
    const menuItem = menuItems.find(mi => mi.id === item.menuItemId)
    if (!menuItem) return

    setEditingModifiersItemId(item.id)

    if (onOpenModifiers) {
      onOpenModifiers(menuItem, (newModifiers) => {
        handleSaveModifierChanges(item.id, newModifiers)
      }, item.modifiers)
    }
  }, [menuItems, onOpenModifiers, handleSaveModifierChanges])

  // Handle resend item to kitchen
  const handleResendItem = useCallback((itemId: string, itemName: string) => {
    setResendNote('')
    setResendModal({ itemId, itemName })
  }, [])

  // Confirm resend item to kitchen
  const confirmResendItem = useCallback(async () => {
    if (!resendModal) return

    setResendLoading(true)
    try {
      const response = await fetch('/api/kds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemIds: [resendModal.itemId],
          action: 'resend',
          resendNote: resendNote.trim() || undefined,
        }),
      })

      if (response.ok) {
        // Update local state to increment resend count
        setInlineOrderItems(prev => prev.map(item =>
          item.id === resendModal.itemId
            ? { ...item, resendCount: (item.resendCount || 0) + 1 }
            : item
        ))

        setResendModal(null)
        setResendNote('')
        toast.success('Item resent to kitchen')
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to resend item')
      }
    } catch (error) {
      console.error('Failed to resend item:', error)
      toast.error('Failed to resend item')
    } finally {
      setResendLoading(false)
    }
  }, [resendModal, resendNote])

  // Open comp/void modal for a sent item
  const handleOpenCompVoid = useCallback((item: InlineOrderItem) => {
    setCompVoidItem({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      modifiers: (item.modifiers || []).map(m => ({ name: m.name, price: m.price })),
      status: item.status,
    })
  }, [])

  // Send order to kitchen — delegates to useActiveOrder hook
  const handleSendToKitchen = useCallback(async () => {
    // Race condition prevention
    if (isProcessingSendRef.current || inlineOrderItems.length === 0) return

    // Filter out held items and already-sent items
    const unsavedItems = inlineOrderItems.filter(item => !item.sentToKitchen && !item.isHeld)
    if (unsavedItems.length === 0) return

    isProcessingSendRef.current = true
    setIsSendingOrder(true)

    try {
      // Hook handles: ensureOrderInDB → POST /send → mark items sent → reload
      await activeOrder.handleSendToKitchen(employeeId)

      // Sync activeOrderId/Number from store (hook updated it)
      const store = useOrderStore.getState()
      if (store.currentOrder?.id) {
        setActiveOrderId(store.currentOrder.id)
        if (store.currentOrder.orderNumber) {
          setActiveOrderNumber(String(store.currentOrder.orderNumber))
        }
      }

      // Clear extra virtual seats for this table since they're now part of the order
      if (activeTableId) {
        setExtraSeats(prev => {
          const next = new Map(prev)
          next.delete(activeTableId)
          return next
        })
      }

      // Refresh floor plan data (without showing loading indicator)
      await loadFloorPlanData(false)
      loadOpenOrdersCount()
    } catch (error) {
      console.error('[FloorPlanHome] Failed to send order:', error)
    } finally {
      isProcessingSendRef.current = false
      setIsSendingOrder(false)
    }
  }, [inlineOrderItems, activeOrder.handleSendToKitchen, employeeId, activeTableId])

  // Save order to DB without sending to kitchen (for Pay before Send flow)
  const handleSaveOrderForPayment = useCallback(async () => {
    if (inlineOrderItems.length === 0) return

    // If all items already saved, just open payment
    if (!activeOrder.hasUnsavedItems && activeOrderId) {
      setPendingPayAfterSave(true)
      return
    }

    setIsSendingOrder(true)
    try {
      // Hook handles: create/append order in DB, map IDs
      const orderId = await activeOrder.ensureOrderInDB(employeeId)
      if (!orderId) return

      // Sync local state with store's order ID
      setActiveOrderId(orderId)
      const store = useOrderStore.getState()
      if (store.currentOrder?.orderNumber) {
        setActiveOrderNumber(String(store.currentOrder.orderNumber))
      }

      // Flag that payment should open
      setPendingPayAfterSave(true)
    } catch (error) {
      console.error('[FloorPlanHome] Failed to save order for payment:', error)
      toast.error('Failed to save order')
    } finally {
      setIsSendingOrder(false)
    }
  }, [inlineOrderItems, activeOrder.hasUnsavedItems, activeOrder.ensureOrderInDB, activeOrderId, employeeId])

  // Open payment
  const handleOpenPayment = useCallback(() => {
    if (activeOrderId && onOpenPayment) {
      onOpenPayment(activeOrderId)
    }
  }, [activeOrderId, onOpenPayment])

  // Close order panel
  const handleCloseOrderPanel = useCallback(() => {
    // If no items were added and no order exists, clear extra seats (reset to original)
    // This handles the case where user opens a table, maybe adds an extra seat, but then
    // clicks away without ordering anything
    if (inlineOrderItems.length === 0 && !activeOrderId && activeTableId) {
      const currentTable = tablesRef.current.find(t => t.id === activeTableId)
      if (currentTable?.virtualGroupId) {
        // Clear extra seats for all tables in the virtual group
        const groupTables = tablesRef.current.filter(t => t.virtualGroupId === currentTable.virtualGroupId)
        setExtraSeats(prev => {
          const next = new Map(prev)
          groupTables.forEach(t => next.delete(t.id))
          return next
        })
      } else {
        // Clear extra seats for just this table
        setExtraSeats(prev => {
          const next = new Map(prev)
          next.delete(activeTableId)
          return next
        })
      }
    }

    // Clear dependent state FIRST
    setInlineOrderItems([])
    setActiveOrderId(null)
    setActiveOrderNumber(null)
    setActiveOrderType(null)
    setExpandedItemId(null)
    setEditingNotesItemId(null)
    setEditingNotesText('')
    setGuestCount(defaultGuestCount)
    setActiveSeatNumber(null)
    setActiveSourceTableId(null)

    // Clear Zustand store for cross-route persistence
    useOrderStore.getState().clearOrder()

    // Clear primary state LAST
    setActiveTableId(null)
    setShowOrderPanel(false)
  }, [defaultGuestCount, inlineOrderItems.length, activeOrderId, activeTableId])

  // Detect new items added → highlight + auto-scroll
  useEffect(() => {
    const prevCount = prevItemCountRef2.current
    prevItemCountRef2.current = inlineOrderItems.length

    if (inlineOrderItems.length > prevCount) {
      const pendingItems = inlineOrderItems.filter(item =>
        !item.sentToKitchen && (!item.kitchenStatus || item.kitchenStatus === 'pending')
      )
      if (pendingItems.length > 0) {
        const newest = itemSortDirection === 'newest-top' ? pendingItems[0] : pendingItems[pendingItems.length - 1]
        if (newest) {
          setNewestItemId(newest.id)

          requestAnimationFrame(() => {
            const container = orderScrollRef.current
            if (!container) return
            const el = container.querySelector(`[data-item-id="${newest.id}"]`)
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
            }
          })

          if (newestTimerRef2.current) clearTimeout(newestTimerRef2.current)
          newestTimerRef2.current = setTimeout(() => setNewestItemId(null), 2000)
        }
      }
    }
  }, [inlineOrderItems, itemSortDirection])

  // Payment mode state (cash or card)
  const [paymentMode, setPaymentMode] = useState<'cash' | 'card'>('cash')
  const [showTotalDetails, setShowTotalDetails] = useState(false)

  // Calculate order subtotal
  const orderSubtotal = inlineOrderItems.reduce((sum, item) => {
    const itemTotal = item.price * item.quantity
    const modifiersTotal = (item.modifiers || []).reduce((mSum, m) => mSum + m.price, 0) * item.quantity
    return sum + itemTotal + modifiersTotal
  }, 0)

  // Pricing (replaces hardcoded TAX_RATE and CASH_DISCOUNT_RATE)
  const pricing = usePricing({
    subtotal: orderSubtotal,  // The calculated orderSubtotal from inlineOrderItems
    discountTotal: 0,
    tipTotal: 0,
    paymentMethod: paymentMode || 'card',
  })

  // Totals from pricing hook (replaces hardcoded TAX_RATE and CASH_DISCOUNT_RATE)
  const cashDiscount = pricing.cashDiscount
  const tax = pricing.tax
  const orderTotal = pricing.total
  const cardTotal = pricing.cardSubtotal + pricing.tax

  // Handle payment success (extracted from inline for OrderPanel)
  const handlePaymentSuccess = useCallback(async (result: { cardLast4?: string; cardBrand?: string; tipAmount: number }) => {
    toast.success(`Payment approved! Card: ****${result.cardLast4 || '****'}`)

    // Record the payment in the database and mark order as paid/closed
    if (activeOrderId) {
      try {
        await fetch(`/api/orders/${activeOrderId}/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            payments: [{
              method: 'credit',
              amount: orderTotal,
              tipAmount: result.tipAmount || 0,
              cardBrand: result.cardBrand,
              cardLast4: result.cardLast4,
            }],
            employeeId,
          }),
        })
      } catch (err) {
        console.error('[FloorPlanHome] Failed to record payment:', err)
      }
    }

    // Clear the order panel (same as handleCloseOrderPanel)
    setInlineOrderItems([])
    setActiveOrderId(null)
    setActiveOrderNumber(null)
    setActiveOrderType(null)
    setExpandedItemId(null)
    setEditingNotesItemId(null)
    setEditingNotesText('')
    setGuestCount(defaultGuestCount)
    setActiveSeatNumber(null)
    setActiveSourceTableId(null)
    useOrderStore.getState().clearOrder()
    setActiveTableId(null)
    setShowOrderPanel(false)
    setSelectedCategoryId(null)
    setViewMode('tables')

    // Refresh floor plan to show updated table status
    loadFloorPlanData()
    loadOpenOrdersCount()
  }, [activeOrderId, orderTotal, employeeId, defaultGuestCount, loadFloorPlanData, loadOpenOrdersCount])

  // Get primary tables for combined groups
  const primaryTables = tables.filter(
    t => t.combinedTableIds && t.combinedTableIds.length > 0
  )

  // Build connection lines between combined tables
  const connectionLines = primaryTables.flatMap(primary => {
    const connectedIds = primary.combinedTableIds || []
    const groupColor = getCombinedGroupColor(primary.id)

    return connectedIds.map(connectedId => {
      const connected = tables.find(t => t.id === connectedId)
      if (!connected) return null

      const primaryCenterX = primary.posX + primary.width / 2
      const primaryCenterY = primary.posY + primary.height / 2
      const connectedCenterX = connected.posX + connected.width / 2
      const connectedCenterY = connected.posY + connected.height / 2

      const dx = connectedCenterX - primaryCenterX
      const dy = connectedCenterY - primaryCenterY

      let x1: number, y1: number, x2: number, y2: number

      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0) {
          x1 = primary.posX + primary.width
          y1 = primary.posY + primary.height / 2
          x2 = connected.posX
          y2 = connected.posY + connected.height / 2
        } else {
          x1 = primary.posX
          y1 = primary.posY + primary.height / 2
          x2 = connected.posX + connected.width
          y2 = connected.posY + connected.height / 2
        }
      } else {
        if (dy > 0) {
          x1 = primary.posX + primary.width / 2
          y1 = primary.posY + primary.height
          x2 = connected.posX + connected.width / 2
          y2 = connected.posY
        } else {
          x1 = primary.posX + primary.width / 2
          y1 = primary.posY
          x2 = connected.posX + connected.width / 2
          y2 = connected.posY + connected.height
        }
      }

      return { id: `${primary.id}-${connectedId}`, x1, y1, x2, y2, color: groupColor }
    }).filter(Boolean)
  }) as { id: string; x1: number; y1: number; x2: number; y2: number; color: string }[]

  // Build combined group colors map
  const combinedGroupColors = new Map<string, string>()
  for (const primary of primaryTables) {
    const color = getCombinedGroupColor(primary.id)
    combinedGroupColors.set(primary.id, color)
    const childIds = primary.combinedTableIds || []
    for (const childId of childIds) {
      combinedGroupColors.set(childId, color)
    }
  }

  // Note: Ghost preview calculation is now handled by useFloorPlanDrag hook

  // Handle table combine - USES VIRTUAL COMBINE (no permanent DB changes)
  // Dragging tables together in FOH view creates a temporary visual group only
  // The backend database positions are NOT modified
  const handleTableCombine = useCallback(async (
    sourceId: string,
    targetId: string,
    dropPosition?: { x: number; y: number }
  ) => {
    try {
      const currentTables = tablesRef.current
      const sourceTable = currentTables.find(t => t.id === sourceId)
      const targetTable = currentTables.find(t => t.id === targetId)

      if (!sourceTable || !targetTable) {
        toast.error('Could not find tables to combine')
        return false
      }

      // Check if either table is already in a virtual group
      if (sourceTable.virtualGroupId || targetTable.virtualGroupId) {
        toast.info('One or more tables is already in a virtual group')
        return false
      }

      // Use target as primary (the table being dropped onto)
      const primaryId = targetId
      const tableIds = [targetId, sourceId]

      // Calculate visual offsets for snap positioning
      const visualOffsets: Array<{ tableId: string; offsetX: number; offsetY: number }> = []
      const offsetsMap = new Map<string, { offsetX: number; offsetY: number }>()

      // Primary table stays at its position
      visualOffsets.push({ tableId: primaryId, offsetX: 0, offsetY: 0 })
      offsetsMap.set(primaryId, { offsetX: 0, offsetY: 0 })

      // Calculate snap position for source table relative to target
      const snapPos = calculateSnapPositionForTable(sourceTable, targetTable)
      const offset = {
        offsetX: snapPos.x - sourceTable.posX,
        offsetY: snapPos.y - sourceTable.posY,
      }
      visualOffsets.push({ tableId: sourceId, ...offset })

      logger.log('[FloorPlanHome] Virtual combine request:', {
        sourceId,
        targetId,
        primaryId,
        visualOffsets,
      })

      const res = await fetch('/api/tables/virtual-combine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableIds,
          primaryTableId: primaryId,
          locationId,
          employeeId,
          visualOffsets,
        }),
      })

      const data = await res.json()

      if (data.requiresAction) {
        // Tables have open orders - show modal to handle them
        setPendingExistingOrders(data.existingOrders)
        setShowExistingOrdersModal(true)
        return false
      }

      if (res.ok) {
        // Update local state with new virtual group info
        if (data.data?.tables) {
          updateTablesWithVirtualGroup(
            data.data.tables.map((t: { id: string; virtualGroupId: string; virtualGroupPrimary: boolean; virtualGroupColor: string }) => ({
              id: t.id,
              virtualGroupId: t.virtualGroupId,
              virtualGroupPrimary: t.virtualGroupPrimary,
              virtualGroupColor: t.virtualGroupColor,
            }))
          )
        }
        toast.success('Tables grouped together')
        await loadFloorPlanData()
        return true
      } else {
        console.error('[FloorPlanHome] Virtual combine failed:', data.error)
        toast.error(`Failed to group tables: ${data.error || 'Unknown error'}`)
      }
      return false
    } catch (error) {
      console.error('[FloorPlanHome] Virtual combine error:', error)
      toast.error('Failed to group tables. Please try again.')
      return false
    }
  }, [locationId, employeeId, updateTablesWithVirtualGroup, calculateSnapPositionForTable])
  // Note: Using tablesRef.current instead of tables in dependency array

  // Handle reset to default
  const handleResetToDefault = useCallback(async (tableIds: string[]) => {
    try {
      const res = await fetch('/api/tables/reset-to-default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableIds,
          locationId,
          employeeId,
        }),
      })

      if (res.ok) {
        const result = await res.json()
        if (result.data?.skippedTableIds?.length > 0) {
          for (const tableId of result.data.skippedTableIds) {
            flashTableMessage(tableId, 'OPEN ORDER', 3000)
          }
        }
        // FIX: Await data refresh to ensure positions are loaded before continuing
        await loadFloorPlanData()
        closeInfoPanel()
        return true
      }
      return false
    } catch (error) {
      console.error('[FloorPlanHome] Reset error:', error)
      return false
    }
  }, [locationId, employeeId, closeInfoPanel, flashTableMessage])

  // Handle status update
  const handleUpdateStatus = useCallback(async (tableId: string, status: string) => {
    try {
      await fetch(`/api/tables/${tableId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      loadFloorPlanData()
    } catch (error) {
      console.error('Failed to update status:', error)
    }
  }, [])

  // Handle undo - removes the last table added to a combined group
  const handleUndo = useCallback(async () => {
    const action = popUndoAction()
    if (!action) return

    if (action.type === 'combine') {
      // Remove just the source table (the one that was added) from the group
      // This is different from split which breaks apart ALL tables
      const res = await fetch(`/api/tables/${action.sourceTableId}/remove-from-group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          employeeId,
        }),
      })

      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        console.error('[Undo] Failed to remove table from group:', error)
      }

      // Await data refresh to prevent stale table data
      await loadFloorPlanData()
    }
  }, [popUndoAction, locationId, employeeId, loadFloorPlanData])

  // Handle seat tap - sync both visual selection and order panel seat
  // FIX: Uses tablesRef.current to always access latest tables data (avoids stale closure)
  const handleSeatTap = useCallback((tableId: string, seatNumber: number) => {
    // For combined tables, always use the primary table ID for consistency
    // This ensures order panel and table visual stay in sync
    const table = tablesRef.current.find(t => t.id === tableId)
    const effectiveTableId = table?.combinedWithId || tableId
    const isCombinedGroup = Boolean(table?.combinedWithId || table?.combinedTableIds?.length)
    const isVirtualGroup = Boolean(table?.virtualGroupId)

    // For combined groups, just check seatNumber since seats are sequential across tables
    // For single tables, check both tableId and seatNumber
    const isAlreadySelected = isCombinedGroup
      ? selectedSeat?.seatNumber === seatNumber
      : selectedSeat?.tableId === effectiveTableId && selectedSeat?.seatNumber === seatNumber

    if (isAlreadySelected) {
      // Deselecting - clear both
      clearSelectedSeat()
      setActiveSeatNumber(null)
      setActiveSourceTableId(null)
    } else {
      // Selecting - update both
      selectSeat(effectiveTableId, seatNumber)
      setActiveSeatNumber(seatNumber)
      // For virtual groups, track which table the seat belongs to
      setActiveSourceTableId(isVirtualGroup ? tableId : effectiveTableId)
    }
  }, [selectedSeat, selectSeat, clearSelectedSeat])
  // Note: Using tablesRef.current instead of tables in dependency array

  // Drag handlers hook (handles pointer move/up and ghost preview)
  const {
    handlePointerMove,
    handlePointerUp,
    ghostPreview,
    isColliding,
  } = useFloorPlanDrag({
    containerRef,
    tablesRef,
    fixturesRef,
    autoScaleRef,
    autoScaleOffsetRef,
    draggedTableId,
    dropTargetTableId,
    updateDragTarget,
    endDrag,
    onCombine: handleTableCombine,
  })

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (searchQuery) {
          // Escape clears search if active
          clearSearch()
        } else if (viewMode === 'menu') {
          // Escape in menu mode goes back to tables
          setSelectedCategoryId(null)
          setViewMode('tables')
          setMenuItems([])
        } else {
          closeInfoPanel()
          selectTable(null)
          handleCloseOrderPanel()
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        handleUndo()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        const searchInput = searchContainerRef.current?.querySelector('input')
        searchInput?.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewMode, closeInfoPanel, selectTable, handleUndo, handleCloseOrderPanel, searchQuery, clearSearch])

  // Close search results on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        if (searchQuery) clearSearch()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [searchQuery, clearSearch])

  // Close employee dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setShowEmployeeDropdown(false)
    if (showEmployeeDropdown) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [showEmployeeDropdown])

  // Close settings dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setShowSettingsDropdown(false)
    if (showSettingsDropdown) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [showSettingsDropdown])

  const selectedCategory = categories.find(c => c.id === selectedCategoryId)

  return (
    <div
      className={`floor-plan-container floor-plan-home ${virtualCombineMode ? 'virtual-combine-mode' : ''}`}
      style={{ height: '100vh', maxHeight: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      {/* Header */}
      <header className="floor-plan-header">
        <div className="floor-plan-header-left">
          {/* Employee Menu Dropdown */}
          <div style={{ position: 'relative', zIndex: 100 }}>
            <button
              className="employee-dropdown-trigger"
              onClick={(e) => {
                e.stopPropagation()
                setShowEmployeeDropdown(!showEmployeeDropdown)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '10px',
                color: '#f1f5f9',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 500,
              }}
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span>{employeeName}</span>
              <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ opacity: 0.6 }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Dropdown Menu */}
            <AnimatePresence>
              {showEmployeeDropdown && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: '4px',
                    minWidth: '200px',
                    background: 'rgba(15, 23, 42, 0.98)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '12px',
                    padding: '8px 0',
                    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
                    zIndex: 1000,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Employee Info */}
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#f1f5f9' }}>{employeeName}</div>
                    {employeeRole && (
                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{employeeRole}</div>
                    )}
                  </div>

                  {/* Menu Items */}
                  <div style={{ padding: '4px 0' }}>
                    {onSwitchUser && (
                      <button
                        onClick={() => {
                          setShowEmployeeDropdown(false)
                          onSwitchUser()
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          width: '100%',
                          padding: '10px 16px',
                          background: 'transparent',
                          border: 'none',
                          color: '#e2e8f0',
                          fontSize: '13px',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        Switch User
                      </button>
                    )}

                    {onOpenSettings && (
                      <button
                        onClick={() => {
                          setShowEmployeeDropdown(false)
                          onOpenSettings()
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          width: '100%',
                          padding: '10px 16px',
                          background: 'transparent',
                          border: 'none',
                          color: '#e2e8f0',
                          fontSize: '13px',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Settings
                      </button>
                    )}

                    {onSwitchToBartenderView && (
                      <button
                        onClick={() => {
                          setShowEmployeeDropdown(false)
                          handleSwitchToBartenderView()
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          width: '100%',
                          padding: '10px 16px',
                          background: 'transparent',
                          border: 'none',
                          color: '#818cf8',
                          fontSize: '13px',
                          cursor: 'pointer',
                          textAlign: 'left' as const,
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                        </svg>
                        Bar Mode
                      </button>
                    )}

                    <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.1)', margin: '4px 0' }} />

                    <button
                      onClick={() => {
                        setShowEmployeeDropdown(false)
                        onLogout()
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        width: '100%',
                        padding: '10px 16px',
                        background: 'transparent',
                        border: 'none',
                        color: '#f87171',
                        fontSize: '13px',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                      Clock Out
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Quick Order Type Buttons */}
          <div style={{ display: 'flex', gap: '8px', marginLeft: '16px' }}>
            {/* Tables Button - Returns to floor plan view */}
            <button
              onClick={() => {
                setViewMode('tables')
                setSelectedCategoryId(null)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                background: viewMode === 'tables' && !activeOrderType ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                border: `1px solid ${viewMode === 'tables' && !activeOrderType ? 'rgba(99, 102, 241, 0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
                borderRadius: '8px',
                color: viewMode === 'tables' && !activeOrderType ? '#a5b4fc' : '#94a3b8',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              Tables
            </button>

            <button
              onClick={() => handleQuickOrderType('takeout')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                background: activeOrderType === 'takeout' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                border: `1px solid ${activeOrderType === 'takeout' ? 'rgba(34, 197, 94, 0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
                borderRadius: '8px',
                color: activeOrderType === 'takeout' ? '#86efac' : '#94a3b8',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8" />
              </svg>
              Takeout
            </button>

            <button
              onClick={() => handleQuickOrderType('delivery')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                background: activeOrderType === 'delivery' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                border: `1px solid ${activeOrderType === 'delivery' ? 'rgba(99, 102, 241, 0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
                borderRadius: '8px',
                color: activeOrderType === 'delivery' ? '#a5b4fc' : '#94a3b8',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
              </svg>
              Delivery
            </button>

            {onSwitchToBartenderView && (
              <button
                onClick={() => handleSwitchToBartenderView()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '8px',
                  color: '#94a3b8',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Bar Mode
              </button>
            )}

            {/* Gear Settings Button */}
            <div style={{ position: 'relative', marginLeft: '8px' }}>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowSettingsDropdown(!showSettingsDropdown)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '8px',
                  background: showSettingsDropdown ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${showSettingsDropdown ? 'rgba(99, 102, 241, 0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
                  borderRadius: '8px',
                  color: showSettingsDropdown ? '#a5b4fc' : '#94a3b8',
                  cursor: 'pointer',
                }}
                title="Layout Settings"
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>

              {/* Settings Dropdown */}
              <AnimatePresence>
                {showSettingsDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      marginTop: '4px',
                      minWidth: '220px',
                      background: 'rgba(15, 23, 42, 0.98)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '12px',
                      padding: '8px 0',
                      boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
                      zIndex: 1000,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canCustomize && (
                      <>
                        {/* Show/Hide Quick Bar Toggle */}
                        <button
                          onClick={() => {
                            toggleQuickBar()
                            setShowSettingsDropdown(false)
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            width: '100%',
                            padding: '10px 16px',
                            background: 'transparent',
                            border: 'none',
                            color: '#e2e8f0',
                            fontSize: '13px',
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          <svg width="16" height="16" fill="none" stroke={quickBarEnabled ? '#22c55e' : '#94a3b8'} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                          </svg>
                          {quickBarEnabled ? '✓ Quick Bar Enabled' : 'Enable Quick Bar'}
                        </button>

                        <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.1)', margin: '4px 0' }} />

                        {/* Edit Favorites */}
                        <button
                          onClick={() => {
                            setIsEditingFavorites(!isEditingFavorites)
                            setIsEditingCategories(false)
                            setIsEditingMenuItems(false)
                            setShowSettingsDropdown(false)
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            width: '100%',
                            padding: '10px 16px',
                            background: isEditingFavorites ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                            border: 'none',
                            color: isEditingFavorites ? '#a5b4fc' : '#e2e8f0',
                            fontSize: '13px',
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                          onMouseEnter={(e) => { if (!isEditingFavorites) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)' }}
                          onMouseLeave={(e) => { if (!isEditingFavorites) e.currentTarget.style.background = 'transparent' }}
                        >
                          <svg width="16" height="16" fill={isEditingFavorites ? '#a5b4fc' : '#94a3b8'} viewBox="0 0 20 20">
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                          </svg>
                          {isEditingFavorites ? '✓ Done Editing Favorites' : 'Edit Favorites'}
                        </button>

                        {/* Reorder Categories */}
                        <button
                          onClick={() => {
                            setIsEditingCategories(!isEditingCategories)
                            setIsEditingFavorites(false)
                            setIsEditingMenuItems(false)
                            setShowSettingsDropdown(false)
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            width: '100%',
                            padding: '10px 16px',
                            background: isEditingCategories ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                            border: 'none',
                            color: isEditingCategories ? '#a5b4fc' : '#e2e8f0',
                            fontSize: '13px',
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                          onMouseEnter={(e) => { if (!isEditingCategories) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)' }}
                          onMouseLeave={(e) => { if (!isEditingCategories) e.currentTarget.style.background = 'transparent' }}
                        >
                          <svg width="16" height="16" fill="none" stroke={isEditingCategories ? '#a5b4fc' : '#94a3b8'} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                          </svg>
                          {isEditingCategories ? '✓ Done Reordering' : 'Reorder Categories'}
                        </button>

                        {/* Customize Item Colors */}
                        <button
                          onClick={() => {
                            setIsEditingMenuItems(!isEditingMenuItems)
                            setIsEditingFavorites(false)
                            setIsEditingCategories(false)
                            setShowSettingsDropdown(false)
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            width: '100%',
                            padding: '10px 16px',
                            background: isEditingMenuItems ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
                            border: 'none',
                            color: isEditingMenuItems ? '#c4b5fd' : '#e2e8f0',
                            fontSize: '13px',
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                          onMouseEnter={(e) => { if (!isEditingMenuItems) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)' }}
                          onMouseLeave={(e) => { if (!isEditingMenuItems) e.currentTarget.style.background = 'transparent' }}
                        >
                          <svg width="16" height="16" fill="none" stroke={isEditingMenuItems ? '#c4b5fd' : '#94a3b8'} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                          </svg>
                          {isEditingMenuItems ? '✓ Done Customizing Items' : 'Customize Item Colors'}
                        </button>

                        <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.1)', margin: '4px 0' }} />

                        {/* Reset All Category Colors */}
                        <button
                          onClick={() => {
                            resetAllCategoryColors()
                            setShowSettingsDropdown(false)
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            width: '100%',
                            padding: '10px 16px',
                            background: 'transparent',
                            border: 'none',
                            color: '#f87171',
                            fontSize: '13px',
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(248, 113, 113, 0.1)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Reset All Category Colors
                        </button>

                        {/* Reset All Item Styles */}
                        <button
                          onClick={() => {
                            resetAllMenuItemStyles()
                            setShowSettingsDropdown(false)
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            width: '100%',
                            padding: '10px 16px',
                            background: 'transparent',
                            border: 'none',
                            color: '#f87171',
                            fontSize: '13px',
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(248, 113, 113, 0.1)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Reset All Item Styles
                        </button>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="floor-plan-header-right">
          {/* Open Orders Button */}
          <button
            onClick={onOpenOrdersPanel}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              background: openOrdersCount > 0 ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.03)',
              border: `1px solid ${openOrdersCount > 0 ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.08)'}`,
              borderRadius: '10px',
              color: openOrdersCount > 0 ? '#a5b4fc' : '#94a3b8',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Open Orders
            {openOrdersCount > 0 && (
              <span
                style={{
                  background: 'rgba(99, 102, 241, 0.3)',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontSize: '12px',
                  fontWeight: 700,
                }}
              >
                {openOrdersCount}
              </span>
            )}
          </button>

          {/* Show Seats Toggle */}
          <button
            className={`icon-btn ${showSeats ? 'active' : ''}`}
            onClick={toggleShowSeats}
            title={showSeats ? 'Hide Seats' : 'Show Seats'}
            style={showSeats ? { background: 'rgba(99, 102, 241, 0.2)', borderColor: 'rgba(99, 102, 241, 0.4)' } : undefined}
          >
            <svg width="18" height="18" fill="none" stroke={showSeats ? '#a5b4fc' : 'currentColor'} viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3" strokeWidth={2} />
              <circle cx="12" cy="4" r="2" strokeWidth={2} />
              <circle cx="12" cy="20" r="2" strokeWidth={2} />
              <circle cx="4" cy="12" r="2" strokeWidth={2} />
              <circle cx="20" cy="12" r="2" strokeWidth={2} />
            </svg>
          </button>

          {/* Reset Layout (if combined tables exist) */}
          {primaryTables.length > 0 && (
            <button
              className="reset-to-default-btn"
              onClick={() => handleResetToDefault(primaryTables.map(t => t.id))}
              title="Reset all combined tables"
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reset
            </button>
          )}

          {/* Undo Button */}
          <AnimatePresence>
            {undoStack.length > 0 && (
              <motion.button
                className="icon-btn"
                onClick={handleUndo}
                title="Undo"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                style={{ background: 'rgba(251, 191, 36, 0.15)', borderColor: 'rgba(251, 191, 36, 0.3)' }}
              >
                <svg width="18" height="18" fill="none" stroke="#fbbf24" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
              </motion.button>
            )}
          </AnimatePresence>

          {/* Admin Menu - Always show if callback provided, permissions control nav content */}
          {onOpenAdminNav && (
            <button
              className="icon-btn"
              onClick={onOpenAdminNav}
              title="Menu"
              style={{
                background: 'rgba(59, 130, 246, 0.2)',
                border: '1px solid rgba(59, 130, 246, 0.4)',
                borderRadius: '8px',
                padding: '8px',
              }}
            >
              <svg width="22" height="22" fill="none" stroke="#3b82f6" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {/* Content below header: Left column (bars + main) + Right order panel */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left Column - Bars + Main Content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>

          {/* Quick Access Bar - Personal favorites */}
          {(quickBarEnabled || isEditingFavorites) && (
            <QuickAccessBar
              items={quickBarItems}
              onItemClick={handleQuickBarItemClick}
              onRemoveItem={removeFromQuickBar}
              isEditMode={isEditingFavorites}
            />
          )}

          {/* Menu Search Bar - always visible */}
          <div className="px-4 py-2 bg-gray-900/50 border-b border-gray-800/50" ref={searchContainerRef}>
            <div className="relative max-w-xl">
              <MenuSearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                onClear={clearSearch}
                placeholder="Search menu items or ingredients... (⌘K)"
                isSearching={isSearching}
              />
              <MenuSearchResults
                results={searchResults}
                query={searchQuery}
                isSearching={isSearching}
                onSelectItem={handleSearchSelect}
                onClose={clearSearch}
              />
            </div>
          </div>

          {/* Categories Bar */}
          <CategoriesBar
            categories={categories}
            selectedCategoryId={selectedCategoryId}
            onCategorySelect={handleCategoryClick}
          />

          {/* Main Content Area - Tables OR Menu Items */}
          <div className="floor-plan-main" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Left Panel - Tables or Menu Items */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {viewMode === 'tables' ? (
            <>
              {/* Room/Section Tabs */}
              {sortedSections.length > 0 && (
                <RoomTabs
                  rooms={sortedSections.map(s => ({ id: s.id, name: s.name, color: s.color }))}
                  selectedRoomId={selectedSectionId}
                  onRoomSelect={setSelectedSectionId}
                  showAllTab={false}
                  showSettingsButton={true}
                  onOpenSettings={() => setShowRoomReorderModal(true)}
                />
              )}

              {/* Floor Plan Canvas */}
              <div
                ref={containerRef}
                className="floor-plan-canvas"
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onClick={() => selectTable(null)}
                style={{ flex: 1 }}
              >
              {isLoading ? (
                <div className="flex items-center justify-center h-full text-slate-400">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  >
                    <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </motion.div>
                </div>
              ) : tables.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400">
                  <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="opacity-50 mb-4">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  <p className="text-lg font-medium">No tables configured</p>
                  <p className="text-sm opacity-60 mt-1">Add tables in the admin settings</p>
                </div>
              ) : (
                <>
                  {/* Scale indicator - show when auto-scaled */}
                  {autoScale < 1 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        background: 'rgba(99, 102, 241, 0.2)',
                        border: '1px solid rgba(99, 102, 241, 0.3)',
                        color: '#a5b4fc',
                        fontSize: '11px',
                        fontWeight: 500,
                        zIndex: 10,
                      }}
                    >
                      {Math.round(autoScale * 100)}% zoom
                    </div>
                  )}

                  {/* Auto-scaled content wrapper */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      transform: autoScale < 1
                        ? `translate(${autoScaleOffset.x}px, ${autoScaleOffset.y}px) scale(${autoScale})`
                        : undefined,
                      transformOrigin: 'top left',
                      pointerEvents: 'auto',
                    }}
                  >
                  {/* Connection Lines */}
                  {connectionLines.length > 0 && (
                    <svg className="connection-lines-layer">
                      <defs>
                        <filter id="connectionGlow" x="-50%" y="-50%" width="200%" height="200%">
                          <feGaussianBlur stdDeviation="3" result="blur" />
                          <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                      </defs>
                      {connectionLines.map(line => (
                        <g key={line.id}>
                          <line
                            x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
                            stroke={`${line.color}66`} strokeWidth="8" strokeLinecap="round"
                            filter="url(#connectionGlow)"
                          />
                          <line
                            x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
                            stroke={line.color} strokeWidth="3" strokeLinecap="round"
                            strokeDasharray="8 4" className="connection-line-animated"
                          />
                        </g>
                      ))}
                    </svg>
                  )}

                  {/* Section Labels - filtered by selected section */}
                  {sections
                    .filter(section => {
                      // Show all section labels when "All" is selected
                      if (selectedSectionId === null) return true
                      // Only show the selected section's label
                      return section.id === selectedSectionId
                    })
                    .map(section => (
                      <div
                        key={section.id}
                        className="section-label"
                        style={{ left: section.posX + 10, top: section.posY + 10, color: section.color }}
                      >
                        {section.name}
                      </div>
                    ))}

                  {/* Tables - filtered by selected section */}
                  <AnimatePresence>
                    {tables
                      .filter(table => {
                        // Show all tables when "All" is selected (selectedSectionId is null)
                        if (selectedSectionId === null) return true
                        // Show tables in the selected section
                        return table.section?.id === selectedSectionId
                      })
                      .map(table => {
                      const flash = flashingTables.get(table.id)
                      const flashMessage = flash && flash.expiresAt > Date.now() ? flash.message : null

                      // Check if this table is part of the active combined group
                      // A table is selected if:
                      // 1. It's directly selected (selectedTableId or activeTableId)
                      // 2. It's a child and its primary is active
                      // 3. It's a primary and one of its children is somehow active (shouldn't happen with redirect)
                      const isInActiveGroup = (() => {
                        if (!activeTableId) return false
                        // Direct match
                        if (table.id === activeTableId) return true
                        // This table is a child of the active table
                        if (table.combinedWithId === activeTableId) return true
                        // This table is a primary and has the active table as a child
                        if (table.combinedTableIds?.includes(activeTableId)) return true
                        return false
                      })()

                      // Calculate combinedSeatOffset for sequential seat numbering across combined tables
                      // Primary table: offset = 0 (but still part of combined group)
                      // Child tables: offset = primary's seats + preceding siblings' seats
                      let combinedSeatOffset = 0
                      let isPartOfCombinedGroup = false

                      if (table.combinedWithId) {
                        // This is a child table - find the primary and calculate offset
                        isPartOfCombinedGroup = true
                        const primaryTable = tables.find(t => t.id === table.combinedWithId)
                        if (primaryTable && primaryTable.combinedTableIds) {
                          // Start with primary table's seat count
                          combinedSeatOffset = primaryTable.seats?.length || primaryTable.capacity || 0
                          // Add seats from all preceding siblings in the combinedTableIds array
                          const myIndex = primaryTable.combinedTableIds.indexOf(table.id)
                          for (let i = 0; i < myIndex; i++) {
                            const siblingTable = tables.find(t => t.id === primaryTable.combinedTableIds![i])
                            if (siblingTable) {
                              combinedSeatOffset += siblingTable.seats?.length || siblingTable.capacity || 0
                            }
                          }
                        }
                      } else if (table.combinedTableIds && table.combinedTableIds.length > 0) {
                        // This is the primary table of a combined group
                        // Offset is 0 but we still mark it as part of a combined group
                        isPartOfCombinedGroup = true
                      }

                      // Calculate total seats for the combined group (for selection validation)
                      const combinedTotalSeats = isPartOfCombinedGroup ? getTotalSeats(table) : undefined

                      // For SNAPPED virtual groups (drag-drop), apply visual offset to table position
                      // Static groups (long-hold) keep original positions
                      const isSnappedVirtualGroup = table.virtualGroupId && !virtualGroupSeats.get(table.virtualGroupId)?.isStatic
                      const visualTable = isSnappedVirtualGroup && (table.virtualGroupOffsetX || table.virtualGroupOffsetY)
                        ? {
                            ...table,
                            posX: table.posX + (table.virtualGroupOffsetX || 0),
                            posY: table.posY + (table.virtualGroupOffsetY || 0),
                          }
                        : table

                      return (
                        <TableNode
                          key={table.id}
                          table={visualTable}
                          isSelected={selectedTableId === table.id || isInActiveGroup}
                          isDragging={draggedTableId === table.id}
                          isDropTarget={dropTargetTableId === table.id}
                          isColliding={draggedTableId === table.id && isColliding}
                          combinedGroupColor={combinedGroupColors.get(table.id)}
                          showSeats={showSeats && (!table.virtualGroupId || Boolean(table.virtualGroupId && virtualGroupSeats.get(table.virtualGroupId)?.isStatic))} // Show seats for: non-grouped tables OR static virtual groups (long-hold). Hide for snapped groups (drag-drop) where we render perimeter seats
                          selectedSeat={selectedSeat}
                          flashMessage={flashMessage}
                          combinedSeatOffset={combinedSeatOffset}
                          combinedTotalSeats={combinedTotalSeats}
                          isVirtualCombineMode={virtualCombineMode}
                          isVirtualCombineSelected={virtualCombineSelectedIds.has(table.id)}
                          isVirtualCombineUnavailable={virtualCombineMode && !virtualCombineSelectedIds.has(table.id) && (() => {
                            // Allow tables in same virtual group as primary
                            const primaryTable = tables.find(t => t.id === virtualCombinePrimaryId)
                            const primaryGroupId = primaryTable?.virtualGroupId
                            if (table.virtualGroupId && table.virtualGroupId === primaryGroupId) {
                              return false // Same group - available
                            }
                            return (
                              Boolean(table.virtualGroupId) || // In different group
                              Boolean(table.combinedWithId) ||
                              Boolean(table.combinedTableIds && table.combinedTableIds.length > 0)
                            )
                          })()}
                          virtualGroupColor={table.virtualGroupColor || undefined}
                          onTap={() => handleTableTap(table)}
                          onDragStart={() => startDrag(table.id)}
                          onDragEnd={endDrag}
                          onLongPress={() => {
                            // Long press starts virtual combine mode (or opens manager/info panel)
                            if (virtualCombineMode) {
                              // Already in virtual combine mode - no action
                              return
                            }
                            if (table.combinedTableIds && table.combinedTableIds.length > 0) {
                              // Physical combined table - open info panel
                              openInfoPanel(table.id)
                            } else if (table.virtualGroupId) {
                              // Already in a virtual group - open virtual group manager modal
                              setVirtualGroupManagerTableId(table.id)
                            } else {
                              // Start virtual combine mode with this table
                              startVirtualCombineMode(table.id)
                            }
                          }}
                          onSeatTap={(seatNumber) => handleSeatTap(table.id, seatNumber)}
                        />
                      )
                    })}
                  </AnimatePresence>

                  {/* Virtual Group Perimeter Seats - distributed around combined table shapes */}
                  {/* Only rendered for SNAPPED groups (drag-drop). Static groups (long-hold) keep their own seats. */}
                  {showSeats && Array.from(virtualGroupSeats.entries()).map(([groupId, groupData]) => {
                    // Skip static groups - they keep their individual table seats
                    if (groupData.isStatic) return null

                    // Only show seats for tables in the currently selected section
                    const groupTablesInSection = tables.filter(t =>
                      t.virtualGroupId === groupId &&
                      (selectedSectionId === null || t.sectionId === selectedSectionId || t.sectionId === null)
                    )
                    if (groupTablesInSection.length === 0) return null

                    const SEAT_SIZE = 24
                    const SEAT_HALF = SEAT_SIZE / 2

                    return (
                      <div key={`virtual-group-seats-${groupId}`}>
                        {/* Group display name label */}
                        {groupData.virtualSeats.length > 0 && (() => {
                          // Calculate center of the group for label placement
                          const minX = Math.min(...groupData.virtualSeats.map(s => s.absoluteX))
                          const maxX = Math.max(...groupData.virtualSeats.map(s => s.absoluteX))
                          const minY = Math.min(...groupData.virtualSeats.map(s => s.absoluteY))
                          const labelX = (minX + maxX) / 2
                          const labelY = minY - 50

                          // Check if this banner is dismissed
                          const isDismissed = dismissedBanners.has(groupId)

                          return (
                            <AnimatePresence>
                              {!isDismissed && (
                                <motion.div
                                  initial={{ opacity: 0, y: -10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -10 }}
                                  transition={{ duration: 0.3 }}
                                  onClick={() => {
                                    setDismissedBanners(prev => new Set([...prev, groupId]))
                                  }}
                                  style={{
                                    position: 'absolute',
                                    left: labelX,
                                    top: labelY,
                                    transform: 'translateX(-50%)',
                                    background: `${groupData.groupColor}dd`,
                                    color: 'white',
                                    padding: '6px 12px',
                                    borderRadius: '16px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    whiteSpace: 'nowrap',
                                    zIndex: 25,
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                                    cursor: 'pointer',
                                  }}
                                >
                                  {groupData.displayName}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          )
                        })()}

                        {/* Virtual seats around perimeter */}
                        {groupData.virtualSeats.map((seat) => {
                          const isSelected = selectedSeat?.tableId === groupData.tableIds[0] &&
                            selectedSeat?.seatNumber === seat.perimeterNumber

                          return (
                            <motion.div
                              key={seat.id}
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={{ scale: 0, opacity: 0 }}
                              onClick={(e) => {
                                e.stopPropagation()
                                // Find the primary table for this group
                                const primaryTable = tables.find(t =>
                                  t.virtualGroupId === groupId && t.virtualGroupPrimary
                                )
                                if (primaryTable) {
                                  handleSeatTap(primaryTable.id, seat.perimeterNumber)
                                }
                              }}
                              style={{
                                position: 'absolute',
                                left: seat.absoluteX - SEAT_HALF,
                                top: seat.absoluteY - SEAT_HALF,
                                width: SEAT_SIZE,
                                height: SEAT_SIZE,
                                backgroundColor: isSelected
                                  ? groupData.groupColor
                                  : `${groupData.groupColor}30`,
                                border: `2px solid ${groupData.groupColor}`,
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '10px',
                                fontWeight: 600,
                                color: isSelected ? 'white' : groupData.groupColor,
                                cursor: 'pointer',
                                zIndex: isSelected ? 30 : 20,
                                boxShadow: isSelected
                                  ? `0 0 12px ${groupData.groupColor}`
                                  : '0 2px 4px rgba(0,0,0,0.2)',
                                transition: 'all 0.2s ease',
                              }}
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.95 }}
                            >
                              {seat.perimeterNumber}
                            </motion.div>
                          )
                        })}
                      </div>
                    )
                  })}

                  {/* Floor Plan Elements - filtered by selected section */}
                  {elements
                    .filter(element => {
                      // Show all elements when "All" is selected
                      if (selectedSectionId === null) return true
                      // Show elements in the selected section (or unassigned elements)
                      return element.sectionId === selectedSectionId || element.sectionId === null
                    })
                    .map(element => {
                      // Render entertainment items with FloorPlanEntertainment (SVG visuals)
                      if (element.elementType === 'entertainment') {
                        return (
                          <div
                            key={element.id}
                            style={{
                              position: 'absolute',
                              left: element.posX,
                              top: element.posY,
                              zIndex: 10,
                            }}
                          >
                            <FloorPlanEntertainment
                              element={element}
                              isSelected={false}
                              mode="service"
                              onSelect={() => {
                                // Handle tapping on entertainment item - start timed rental
                                if (element.linkedMenuItem) {
                                  const menuItem: MenuItem = {
                                    id: element.linkedMenuItem.id,
                                    name: element.linkedMenuItem.name,
                                    price: element.linkedMenuItem.price,
                                    categoryId: '',
                                    itemType: 'timed_rental',
                                    entertainmentStatus: element.linkedMenuItem.entertainmentStatus as 'available' | 'in_use' | 'maintenance' | undefined,
                                    blockTimeMinutes: element.linkedMenuItem.blockTimeMinutes || undefined,
                                  }
                                  // Use existing handleMenuItemTap which handles timed rentals
                                  handleMenuItemTap(menuItem)
                                }
                              }}
                            />
                          </div>
                        )
                      }

                      // Render fixtures (walls, bars, etc.) as solid colored rectangles with glassmorphism
                      return (
                        <div
                          key={element.id}
                          style={{
                            position: 'absolute',
                            left: element.posX,
                            top: element.posY,
                            width: element.width,
                            height: element.height,
                            transform: `rotate(${element.rotation}deg)`,
                            transformOrigin: 'center',
                            backgroundColor: element.fillColor || 'rgba(156, 163, 175, 0.7)',
                            backdropFilter: 'blur(8px)',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                            opacity: element.opacity,
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            pointerEvents: 'none',
                            zIndex: 5,
                          }}
                        >
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight: 600,
                              color: 'rgba(255, 255, 255, 0.9)',
                              textShadow: '0 1px 2px rgba(0, 0, 0, 0.5)',
                              textAlign: 'center',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: '90%',
                            }}
                          >
                            {element.name}
                          </span>
                        </div>
                      )
                    })}

                  {/* Ghost Preview */}
                  {ghostPreview && (
                    <motion.div
                      className="table-ghost-preview"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 0.6, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      style={{
                        position: 'absolute',
                        left: ghostPreview.posX,
                        top: ghostPreview.posY,
                        width: ghostPreview.width,
                        height: ghostPreview.height,
                        borderRadius: '12px',
                        border: '2px dashed #22c55e',
                        backgroundColor: 'rgba(34, 197, 94, 0.15)',
                        pointerEvents: 'none',
                        zIndex: 90,
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          bottom: '-24px',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          fontSize: '11px',
                          fontWeight: 600,
                          color: '#22c55e',
                          textTransform: 'uppercase',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Attach {ghostPreview.side}
                      </div>
                    </motion.div>
                  )}
                  </div>
                  {/* End of auto-scaled content wrapper */}
                </>
              )}
            </div>
            </>
          ) : (
            /* Menu Items Grid - replaces tables when category is selected */
            <div
              style={{ flex: 1, overflow: 'auto', padding: '20px' }}
              onClick={(e) => {
                // Click on empty area deselects category
                if (e.target === e.currentTarget) {
                  setSelectedCategoryId(null)
                  setViewMode('tables')
                  setMenuItems([])
                }
              }}
            >
              {loadingMenuItems ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#64748b' }}>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  >
                    <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </motion.div>
                </div>
              ) : menuItems.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b' }}>
                  <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ opacity: 0.5, marginBottom: '16px' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                  </svg>
                  <p style={{ fontSize: '14px' }}>No items in this category</p>
                  <p style={{ fontSize: '12px', marginTop: '4px', opacity: 0.6 }}>Tap the category again to go back</p>
                </div>
              ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                      gap: '16px',
                    }}
                  >
                    {menuItems.map((item) => {
                      const customStyle = menuItemColors[item.id]
                      const inQuickBar = isInQuickBar(item.id)
                      // Check if item is 86'd (ingredient-level or out of prep stock)
                      const isItem86d = item.is86d || item.stockStatus === 'out'
                      const bgColor = isItem86d
                        ? 'rgba(100, 100, 100, 0.3)'
                        : (customStyle?.bgColor || 'rgba(255, 255, 255, 0.03)')
                      const textColor = isItem86d
                        ? '#6b7280'
                        : (customStyle?.textColor || '#e2e8f0')

                      return (
                        <motion.button
                          key={item.id}
                          onClick={() => {
                            if (isItem86d) {
                              // Show toast explaining why item is unavailable
                              const reason = item.reasons86d?.length
                                ? `${item.name} is unavailable - ${item.reasons86d.join(', ')} is out`
                                : item.stockIngredientName
                                  ? `${item.name} is unavailable - ${item.stockIngredientName} is out`
                                  : `${item.name} is currently unavailable`
                              toast.warning(reason)
                            } else {
                              handleMenuItemTap(item)
                            }
                          }}
                          onContextMenu={(e) => handleMenuItemContextMenu(e, item)}
                          whileHover={isItem86d ? {} : { scale: 1.02, y: -2 }}
                          whileTap={isItem86d ? {} : { scale: 0.98 }}
                          className={inQuickBar ? 'ring-2 ring-amber-400/50' : ''}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '20px 16px',
                            background: bgColor,
                            border: `1px solid ${isItem86d ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255, 255, 255, 0.08)'}`,
                            borderRadius: '14px',
                            cursor: isItem86d ? 'not-allowed' : 'pointer',
                            minHeight: '110px',
                            transition: 'all 0.15s ease',
                            position: 'relative',
                            opacity: isItem86d ? 0.6 : 1,
                          }}
                          onMouseOver={(e) => {
                            if (!isItem86d) {
                              if (!customStyle?.bgColor) {
                                e.currentTarget.style.background = 'rgba(99, 102, 241, 0.15)'
                              }
                              e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.3)'
                            }
                          }}
                          onMouseOut={(e) => {
                            e.currentTarget.style.background = bgColor
                            e.currentTarget.style.borderColor = isItem86d
                              ? 'rgba(239, 68, 68, 0.3)'
                              : 'rgba(255, 255, 255, 0.08)'
                          }}
                        >
                          {/* Quick bar indicator */}
                          {inQuickBar && !isItem86d && (
                            <span className="absolute top-1 left-1 text-amber-400 z-10">
                              <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                              </svg>
                            </span>
                          )}
                          {/* 86 badge - ingredient-level */}
                          {item.is86d && (
                            <span
                              className="absolute top-1 right-1 px-1.5 py-0.5 bg-red-600 text-white text-[10px] font-bold rounded z-10"
                              title={item.reasons86d?.length
                                ? `Out: ${item.reasons86d.join(', ')}`
                                : 'Out of stock'}
                            >
                              86
                            </span>
                          )}
                          {/* Prep stock status badge (low/critical/out) */}
                          {!item.is86d && item.stockStatus && (
                            <StockBadge
                              status={item.stockStatus}
                              count={item.stockCount}
                              ingredientName={item.stockIngredientName}
                            />
                          )}
                          {/* Striped overlay for 86'd items */}
                          {isItem86d && (
                            <div
                              className="absolute inset-0 rounded-[14px] pointer-events-none"
                              style={{
                                background: 'repeating-linear-gradient(135deg, transparent, transparent 10px, rgba(0,0,0,0.1) 10px, rgba(0,0,0,0.1) 20px)',
                              }}
                            />
                          )}
                          <span
                            style={{
                              fontSize: '15px',
                              fontWeight: 500,
                              color: textColor,
                              textAlign: 'center',
                              marginBottom: '8px',
                              lineHeight: 1.3,
                              textDecoration: isItem86d ? 'line-through' : 'none',
                            }}
                          >
                            {item.name}
                          </span>
                          <span
                            style={{
                              fontSize: '15px',
                              fontWeight: 600,
                              color: isItem86d ? '#6b7280' : '#22c55e',
                            }}
                          >
                            ${item.price.toFixed(2)}
                          </span>
                          {item.hasModifiers && !isItem86d && (
                            <span
                              style={{
                                fontSize: '11px',
                                color: '#94a3b8',
                                marginTop: '6px',
                              }}
                            >
                              + options
                            </span>
                          )}
                        </motion.button>
                      )
                    })}
                  </div>
                )}
            </div>
          )}
        </div>
          </div>{/* end floor-plan-main */}
        </div>{/* end Left Column */}

        {/* Right Panel - Order Panel (always visible, full height from below header) */}
        <div
          style={{
            width: 360,
            flexShrink: 0,
            borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
              {/* Order Panel Header - Fixed, doesn't scroll */}
              <div
                style={{
                  padding: '16px 20px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexShrink: 0,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#f1f5f9', margin: 0 }}>
                    {activeTable
                      ? activeTable.virtualGroupId
                        ? 'Virtual Group'
                        : getCombinedTableCount(activeTable) > 1
                          ? `Combined ${getCombinedTableCount(activeTable)} Tables`
                          : activeTable.name
                      : activeOrderType === 'bar_tab' ? 'Bar Tab'
                      : activeOrderType === 'takeout' ? 'Takeout'
                      : activeOrderType === 'delivery' ? 'Delivery'
                      : 'New Order'}
                  </h3>
                  {/* Virtual group: Show table list with primary indicator + Ungroup button */}
                  {activeTable?.virtualGroupId && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                      {getVirtualGroupTables(activeTable).map((t, i) => (
                        <span
                          key={t.id}
                          style={{
                            fontSize: '11px',
                            fontWeight: t.virtualGroupPrimary ? 600 : 400,
                            color: t.virtualGroupPrimary ? '#06b6d4' : '#94a3b8',
                            padding: '2px 6px',
                            background: t.virtualGroupPrimary ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                            borderRadius: '4px',
                          }}
                        >
                          {t.abbreviation || t.name}{t.virtualGroupPrimary ? ' ★' : ''}
                        </span>
                      ))}
                      {/* Ungroup button - opens VirtualGroupManagerModal */}
                      <button
                        onClick={() => setVirtualGroupManagerTableId(activeTable.id)}
                        style={{
                          fontSize: '11px',
                          fontWeight: 500,
                          color: '#f87171',
                          padding: '2px 8px',
                          background: 'rgba(248, 113, 113, 0.15)',
                          border: '1px solid rgba(248, 113, 113, 0.3)',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          marginLeft: '4px',
                        }}
                      >
                        Ungroup
                      </button>
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                    {activeOrderNumber && (
                      <span style={{ fontSize: '12px', color: '#64748b' }}>
                        Order #{activeOrderNumber}
                      </span>
                    )}
                    {activeTable && getTotalSeats(activeTable) > 0 && (
                      <span style={{ fontSize: '11px', color: '#64748b', padding: '2px 6px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '4px' }}>
                        {getTotalSeats(activeTable)} seats
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Seat Selection Buttons (for table orders with seats) - Fixed, doesn't scroll */}
              {activeTable && getTotalSeats(activeTable) > 0 && (
                <div
                  style={{
                    padding: '10px 20px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                    background: 'rgba(255, 255, 255, 0.02)',
                    flexShrink: 0,
                    maxHeight: '150px',
                    overflowY: 'auto',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>Assign to seat:</span>
                    {activeSeatNumber && (
                      <span style={{ fontSize: '10px', color: '#c084fc' }}>
                        New items → {activeSourceTableId && activeTable.virtualGroupId
                          ? `${tables.find(t => t.id === activeSourceTableId)?.abbreviation || tables.find(t => t.id === activeSourceTableId)?.name || 'Table'}-S${activeSeatNumber}`
                          : `Seat ${activeSeatNumber}`}
                      </span>
                    )}
                  </div>

                  {/* "Shared" button */}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: activeTable.virtualGroupId ? '12px' : '0' }}>
                    <button
                      onClick={() => {
                        setActiveSeatNumber(null)
                        setActiveSourceTableId(null)
                        clearSelectedSeat() // Sync visual selection
                      }}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: `1px solid ${!activeSeatNumber ? 'rgba(168, 85, 247, 0.5)' : 'rgba(255, 255, 255, 0.1)'}`,
                        background: !activeSeatNumber ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                        color: !activeSeatNumber ? '#c084fc' : '#94a3b8',
                        fontSize: '12px',
                        fontWeight: !activeSeatNumber ? 600 : 400,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      Shared
                    </button>
                  </div>

                  {/* Long-hold virtual group (static, no offsets): Show seats grouped by table */}
                  {/* Drag-combined virtual group (has offsets) + single/physical: Show flat 1..N */}
                  {activeTable.virtualGroupId && (() => {
                    // Check if ANY non-primary table has offsets — if so, it's a drag-combined group
                    const groupTables = getVirtualGroupTables(activeTable)
                    const hasDragOffsets = groupTables.some(t => !t.virtualGroupPrimary && (t.virtualGroupOffsetX || t.virtualGroupOffsetY))
                    return !hasDragOffsets // true = long-hold (static), false = drag-combined
                  })() ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {getVirtualGroupTables(activeTable).map((groupTable) => (
                        <div key={groupTable.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          {/* Table label */}
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 600,
                              color: groupTable.virtualGroupPrimary ? '#06b6d4' : '#94a3b8',
                              padding: '4px 8px',
                              background: groupTable.virtualGroupPrimary ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                              borderRadius: '4px',
                              minWidth: '50px',
                              textAlign: 'center',
                            }}
                          >
                            {groupTable.abbreviation || groupTable.name}
                            {groupTable.virtualGroupPrimary && ' ★'}
                          </span>

                          {/* Seat buttons for this table */}
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {Array.from({ length: getTableSeatCount(groupTable) }, (_, i) => i + 1).map(seatNum => {
                              const isSelected = activeSeatNumber === seatNum && activeSourceTableId === groupTable.id
                              return (
                                <button
                                  key={`${groupTable.id}-${seatNum}`}
                                  onClick={() => {
                                    setActiveSeatNumber(seatNum)
                                    setActiveSourceTableId(groupTable.id)
                                    selectSeat(groupTable.id, seatNum)
                                  }}
                                  style={{
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '5px',
                                    border: `1px solid ${isSelected ? 'rgba(168, 85, 247, 0.5)' : 'rgba(255, 255, 255, 0.1)'}`,
                                    background: isSelected ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                                    color: isSelected ? '#c084fc' : '#94a3b8',
                                    fontSize: '11px',
                                    fontWeight: isSelected ? 600 : 400,
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }}
                                >
                                  {seatNum}
                                </button>
                              )
                            })}

                            {/* Add Seat Button for this table in virtual group */}
                            <button
                              onClick={() => handleAddSeat(groupTable.id)}
                              title={`Add a seat to ${groupTable.name}`}
                              style={{
                                width: '28px',
                                height: '28px',
                                borderRadius: '5px',
                                border: '2px dashed rgba(34, 197, 94, 0.4)',
                                background: 'rgba(34, 197, 94, 0.1)',
                                color: '#22c55e',
                                fontSize: '14px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(34, 197, 94, 0.2)'
                                e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.6)'
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'rgba(34, 197, 94, 0.1)'
                                e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.4)'
                              }}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    /* Drag-combined virtual group, single table, or physical combine: Flat seat list 1..N */
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                      {Array.from({ length: getTotalSeats(activeTable) }, (_, i) => i + 1).map(seatNum => (
                        <button
                          key={seatNum}
                          onClick={() => {
                            setActiveSeatNumber(seatNum)
                            setActiveSourceTableId(activeTable.id)
                            // Sync visual selection on table
                            if (activeTableId) {
                              selectSeat(activeTableId, seatNum)
                            }
                          }}
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '6px',
                            border: `1px solid ${activeSeatNumber === seatNum ? 'rgba(168, 85, 247, 0.5)' : 'rgba(255, 255, 255, 0.1)'}`,
                            background: activeSeatNumber === seatNum ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                            color: activeSeatNumber === seatNum ? '#c084fc' : '#94a3b8',
                            fontSize: '13px',
                            fontWeight: activeSeatNumber === seatNum ? 600 : 400,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {seatNum}
                        </button>
                      ))}

                      {/* Add Seat Button (Skill 121) - works with or without active order */}
                      <button
                        onClick={() => handleAddSeat()}
                        title="Add a seat for extra guest"
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '6px',
                            border: '2px dashed rgba(34, 197, 94, 0.4)',
                            background: 'rgba(34, 197, 94, 0.1)',
                            color: '#22c55e',
                            fontSize: '18px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(34, 197, 94, 0.2)'
                            e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.6)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(34, 197, 94, 0.1)'
                            e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.4)'
                          }}
                        >
                          +
                        </button>
                    </div>
                  )}
                </div>
              )}

              {/* Order Panel — shared component replaces inline rendering + OrderPanelActions */}
              <OrderPanel
                orderId={activeOrderId}
                orderNumber={activeOrderNumber ? Number(activeOrderNumber) : undefined}
                orderType={activeOrderType || undefined}
                locationId={locationId}
                items={inlineOrderItems.map(i => ({
                  id: i.id,
                  name: i.name,
                  quantity: i.quantity,
                  price: i.price,
                  modifiers: i.modifiers?.map(m => ({ name: m.name, price: m.price })),
                  specialNotes: i.specialNotes,
                  kitchenStatus: i.kitchenStatus as OrderPanelItemData['kitchenStatus'],
                  isHeld: i.isHeld,
                  isCompleted: i.isCompleted,
                  isTimedRental: i.isTimedRental,
                  menuItemId: i.menuItemId,
                  blockTimeMinutes: i.blockTimeMinutes,
                  blockTimeStartedAt: i.blockTimeStartedAt,
                  blockTimeExpiresAt: i.blockTimeExpiresAt,
                  seatNumber: i.seatNumber,
                  courseNumber: i.courseNumber,
                  courseStatus: i.courseStatus,
                  sentToKitchen: i.sentToKitchen,
                  resendCount: i.resendCount,
                  completedAt: i.completedAt,
                  createdAt: i.createdAt,
                }))}
                seatGroups={seatGroupsForPanel}
                subtotal={orderSubtotal}
                tax={tax}
                total={orderTotal}
                showItemControls={true}
                showEntertainmentTimers={true}
                onItemClick={(item) => {
                  const fullItem = inlineOrderItems.find(i => i.id === item.id)
                  if (fullItem) handleOrderItemTap(fullItem)
                }}
                onItemRemove={handleRemoveItem}
                onQuantityChange={handleUpdateQuantity}
                onItemHoldToggle={handleToggleHold}
                onItemNoteEdit={handleOpenNotesEditor}
                onItemCourseChange={handleUpdateCourse}
                onItemEditModifiers={(itemId) => {
                  const editItem = inlineOrderItems.find(i => i.id === itemId)
                  if (editItem) handleEditItem(editItem)
                }}
                onItemCompVoid={(itemId) => {
                  const voidItem = inlineOrderItems.find(i => i.id === itemId)
                  if (voidItem) handleOpenCompVoid(voidItem)
                }}
                onItemResend={(itemId) => {
                  const resendItem = inlineOrderItems.find(i => i.id === itemId)
                  if (resendItem) handleResendItem(itemId, resendItem.name)
                }}
                onItemSplit={(itemId) => {
                  setSplitItemId(itemId)
                  setShowSplitTicketManager(true)
                }}
                expandedItemId={expandedItemId}
                onItemToggleExpand={(id) => setExpandedItemId(prev => prev === id ? null : id)}
                onItemSeatChange={handleUpdateSeat}
                maxSeats={Math.max(guestCount, 4)}
                maxCourses={5}
                onSend={handleSendToKitchen}
                isSending={isSendingOrder}
                terminalId="terminal-1"
                employeeId={employeeId}
                onPaymentSuccess={handlePaymentSuccess}
                cashDiscountRate={pricing.cashDiscountRate / 100}
                taxRate={pricing.taxRate}
                onPaymentModeChange={(mode) => setPaymentMode(mode)}
                onSaveOrderFirst={handleSaveOrderForPayment}
                autoShowPayment={pendingPayAfterSave}
                onAutoShowPaymentHandled={() => setPendingPayAfterSave(false)}
                hideHeader={true}
                className="flex-1"
              />
        </div>
      </div>

      {/* Virtual Combine Bar */}
      <VirtualCombineBar
        tables={tables}
        onConfirm={() => handleConfirmVirtualCombine()}
        onCancel={cancelVirtualCombineMode}
        isConfirming={isCreatingVirtualGroup}
      />

      {/* Existing Orders Modal (for virtual combine) */}
      <ExistingOrdersModal
        isOpen={showExistingOrdersModal}
        existingOrders={pendingExistingOrders}
        primaryTableName={tables.find(t => t.id === virtualCombinePrimaryId)?.name || 'Primary'}
        onConfirm={(actions) => handleConfirmVirtualCombine(actions)}
        onCancel={() => {
          setShowExistingOrdersModal(false)
          setPendingExistingOrders([])
        }}
        onCloseOrder={(orderId) => {
          // Redirect to payment for this order
          if (onOpenPayment) {
            onOpenPayment(orderId)
          }
        }}
        isProcessing={isCreatingVirtualGroup}
      />

      {/* Virtual Group Manager Modal (for managing/dissolving virtual groups) */}
      {virtualGroupManagerTableId && (() => {
        const managerTable = tables.find(t => t.id === virtualGroupManagerTableId)
        if (!managerTable?.virtualGroupId) return null
        const groupTables = tables.filter(t => t.virtualGroupId === managerTable.virtualGroupId)
        const primaryTable = groupTables.find(t => t.virtualGroupPrimary) || groupTables[0]
        return (
          <VirtualGroupManagerModal
            isOpen={true}
            onClose={() => setVirtualGroupManagerTableId(null)}
            groupTables={groupTables}
            primaryTableId={primaryTable?.id || managerTable.id}
            virtualGroupId={managerTable.virtualGroupId}
            locationId={locationId}
            employeeId={employeeId}
            onGroupUpdated={() => {
              // Clear extra seats for all tables in this group (they were virtual/temporary)
              const tableIdsInGroup = groupTables.map(t => t.id)
              setExtraSeats(prev => {
                const next = new Map(prev)
                tableIdsInGroup.forEach(id => next.delete(id))
                return next
              })
              loadFloorPlanData(false)
              setVirtualGroupManagerTableId(null)
            }}
          />
        )
      })()}

      {/* Table Info Panel (for combined table management) */}
      {infoPanelTableId && (
        <TableInfoPanel
          table={tables.find(t => t.id === infoPanelTableId) || null}
          isOpen={true}
          onClose={closeInfoPanel}
          onAddItems={() => {
            const table = tables.find(t => t.id === infoPanelTableId)
            if (table) handleTableTap(table)
            closeInfoPanel()
          }}
          onViewCheck={() => {
            const table = tables.find(t => t.id === infoPanelTableId)
            if (table) handleTableTap(table)
            closeInfoPanel()
          }}
          onMarkDirty={() => {
            if (infoPanelTableId) handleUpdateStatus(infoPanelTableId, 'dirty')
          }}
          onMarkAvailable={() => {
            if (infoPanelTableId) handleUpdateStatus(infoPanelTableId, 'available')
          }}
          onResetToDefault={
            tables.find(t => t.id === infoPanelTableId)?.combinedTableIds?.length
              ? () => handleResetToDefault([infoPanelTableId])
              : undefined
          }
        />
      )}

      {/* Notes Editor Modal */}
      <AnimatePresence>
        {editingNotesItemId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.6)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
            onClick={() => setEditingNotesItemId(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'rgba(15, 23, 42, 0.98)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '16px',
                padding: '24px',
                width: '100%',
                maxWidth: '400px',
                margin: '20px',
                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
              }}
            >
              <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#f1f5f9', marginBottom: '16px' }}>
                Kitchen Note
              </h3>
              <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '12px' }}>
                This note will be sent to the kitchen with the order.
              </p>
              <textarea
                value={editingNotesText}
                onChange={(e) => setEditingNotesText(e.target.value)}
                placeholder="e.g., No onions, extra pickles, allergic to nuts..."
                autoFocus
                style={{
                  width: '100%',
                  minHeight: '100px',
                  padding: '12px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '10px',
                  color: '#e2e8f0',
                  fontSize: '14px',
                  resize: 'vertical',
                  outline: 'none',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    handleSaveNotes()
                  }
                  if (e.key === 'Escape') {
                    setEditingNotesItemId(null)
                  }
                }}
              />
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button
                  onClick={() => setEditingNotesItemId(null)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '10px',
                    color: '#94a3b8',
                    fontSize: '14px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveNotes}
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: '#f59e0b',
                    border: 'none',
                    borderRadius: '10px',
                    color: '#fff',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Save Note
                </button>
              </div>
              <p style={{ fontSize: '11px', color: '#475569', marginTop: '12px', textAlign: 'center' }}>
                Press ⌘+Enter to save • Esc to cancel
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Menu Item Context Menu (right-click) */}
      {contextMenu && (
        <MenuItemContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          itemId={contextMenu.item.id}
          itemName={contextMenu.item.name}
          isInQuickBar={isInQuickBar(contextMenu.item.id)}
          onClose={closeContextMenu}
          onAddToQuickBar={() => addToQuickBar(contextMenu.item.id)}
          onRemoveFromQuickBar={() => removeFromQuickBar(contextMenu.item.id)}
        />
      )}

      {/* Room Reorder Modal */}
      <RoomReorderModal
        isOpen={showRoomReorderModal}
        onClose={() => setShowRoomReorderModal(false)}
        rooms={sections.map(s => ({ id: s.id, name: s.name, color: s.color }))}
        currentOrder={preferredRoomOrder}
        onSave={handleSaveRoomOrder}
      />

      {/* Resend to Kitchen Modal */}
      {resendModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: '#1e293b',
              borderRadius: '12px',
              padding: '24px',
              width: '400px',
              maxWidth: '90vw',
              border: '1px solid rgba(245, 158, 11, 0.3)',
            }}
          >
            <h3
              style={{
                color: '#f1f5f9',
                fontSize: '18px',
                fontWeight: 600,
                marginBottom: '16px',
              }}
            >
              Resend to Kitchen
            </h3>
            <p
              style={{
                color: '#94a3b8',
                fontSize: '14px',
                marginBottom: '16px',
              }}
            >
              Resending: <strong style={{ color: '#e2e8f0' }}>{resendModal.itemName}</strong>
            </p>
            <textarea
              value={resendNote}
              onChange={(e) => setResendNote(e.target.value)}
              placeholder="Add a note for the kitchen (optional)"
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#e2e8f0',
                fontSize: '14px',
                resize: 'none',
                height: '80px',
                marginBottom: '16px',
                fontFamily: 'inherit',
              }}
            />
            <div
              style={{
                display: 'flex',
                gap: '12px',
                justifyContent: 'flex-end',
              }}
            >
              <button
                onClick={() => setResendModal(null)}
                style={{
                  padding: '10px 20px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  color: '#94a3b8',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmResendItem}
                disabled={resendLoading}
                style={{
                  padding: '10px 20px',
                  background: resendLoading ? 'rgba(245, 158, 11, 0.5)' : '#f59e0b',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: resendLoading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease',
                  opacity: resendLoading ? 0.7 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!resendLoading) {
                    e.currentTarget.style.background = '#d97706'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!resendLoading) {
                    e.currentTarget.style.background = '#f59e0b'
                  }
                }}
              >
                {resendLoading ? 'Sending...' : 'Resend'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Comp/Void Modal */}
      {compVoidItem && activeOrderId && employeeId && (
        <CompVoidModal
          isOpen={true}
          onClose={() => setCompVoidItem(null)}
          orderId={activeOrderId}
          item={{
            id: compVoidItem.id,
            name: compVoidItem.name,
            price: compVoidItem.price,
            quantity: compVoidItem.quantity,
            modifiers: compVoidItem.modifiers,
            status: compVoidItem.status,
          }}
          employeeId={employeeId}
          locationId={locationId}
          onComplete={async () => {
            setCompVoidItem(null)
            // Refresh order data by reloading the order
            if (activeOrderId) {
              try {
                const response = await fetch(`/api/orders/${activeOrderId}`)
                if (response.ok) {
                  const orderData = await response.json()
                  // Update inline order items from the fresh order data
                  const freshItems = orderData.items?.map((item: any) => ({
                    id: item.id,
                    menuItemId: item.menuItemId,
                    name: item.name,
                    price: Number(item.price),
                    quantity: item.quantity,
                    modifiers: item.modifiers?.map((mod: any) => ({
                      id: mod.modifierId,
                      name: mod.name,
                      price: Number(mod.price),
                    })) || [],
                    seatNumber: item.seatNumber,
                    courseNumber: item.courseNumber,
                    specialNotes: item.specialNotes,
                    sentToKitchen: true,
                    resendCount: item.resendCount,
                  })) || []
                  setInlineOrderItems(freshItems)
                }
              } catch (error) {
                console.error('Failed to refresh order:', error)
              }
            }
            toast.success('Item comped/voided successfully')
          }}
        />
      )}

      {/* Split Ticket Manager */}
      {showSplitTicketManager && activeOrderId && (
        <SplitTicketManager
          orderId={activeOrderId}
          isOpen={showSplitTicketManager}
          onClose={() => {
            setShowSplitTicketManager(false)
            setSplitItemId(null)
          }}
          orderNumber={activeOrderNumber || ''}
          items={inlineOrderItems.map(item => ({
            id: item.id,
            tempId: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            modifiers: (item.modifiers || []).map(m => ({ name: m.name, price: m.price })),
          }))}
          orderDiscount={0}
          taxRate={pricing.taxRate}
          onSplitComplete={async () => {
            // Refresh order data by reloading the order
            if (activeOrderId) {
              try {
                const response = await fetch(`/api/orders/${activeOrderId}`)
                if (response.ok) {
                  const orderData = await response.json()
                  // Update inline order items from the fresh order data
                  const freshItems = orderData.items?.map((item: any) => ({
                    id: item.id,
                    menuItemId: item.menuItemId,
                    name: item.name,
                    price: Number(item.price),
                    quantity: item.quantity,
                    modifiers: item.modifiers?.map((mod: any) => ({
                      id: mod.modifierId,
                      name: mod.name,
                      price: Number(mod.price),
                    })) || [],
                    seatNumber: item.seatNumber,
                    courseNumber: item.courseNumber,
                    specialNotes: item.specialNotes,
                    sentToKitchen: true,
                    resendCount: item.resendCount,
                  })) || []
                  setInlineOrderItems(freshItems)
                }
              } catch (error) {
                console.error('Failed to refresh order:', error)
              }
            }
            setShowSplitTicketManager(false)
            setSplitItemId(null)
            toast.success('Item moved to split check')
          }}
        />
      )}
    </div>
  )
}
