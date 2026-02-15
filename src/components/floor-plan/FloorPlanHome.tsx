'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFloorPlanStore, FloorPlanTable, FloorPlanElement } from './use-floor-plan'
import { FloorPlanEntertainment } from './FloorPlanEntertainment'
import { TableNode } from './TableNode'
import { TableInfoPanel } from './TableInfoPanel'
import { CategoriesBar } from './CategoriesBar'
import { RoomTabs } from './RoomTabs'
import { RoomReorderModal } from './RoomReorderModal'
import { useFloorPlanAutoScale, useFloorPlanDrag } from './hooks'
import { usePOSLayout } from '@/hooks/usePOSLayout'
import { QuickAccessBar } from '@/components/pos/QuickAccessBar'
import { MenuItemContextMenu } from '@/components/pos/MenuItemContextMenu'
import { StockBadge } from '@/components/menu/StockBadge'
import { CompVoidModal } from '@/components/orders/CompVoidModal'
import { SplitCheckScreen } from '@/components/orders/SplitCheckScreen'
import { SplitTicketsOverview } from '@/components/orders/SplitTicketsOverview'
import { TableOptionsPopover } from '@/components/orders/TableOptionsPopover'
import { NoteEditModal } from '@/components/orders/NoteEditModal'
import { logger } from '@/lib/logger'
import type { PizzaOrderConfig } from '@/types'
import { toast } from '@/stores/toast-store'
import SharedOwnershipModal from '@/components/tips/SharedOwnershipModal'
import { useOrderStore } from '@/stores/order-store'
import { useActiveOrder } from '@/hooks/useActiveOrder'
import { usePricing } from '@/hooks/usePricing'
import { useOrderSettings } from '@/hooks/useOrderSettings'
import { useEvents } from '@/lib/events'
import { useMenuSearch } from '@/hooks/useMenuSearch'
import { useOrderingEngine } from '@/hooks/useOrderingEngine'
import type { EngineMenuItem, EngineModifier, EngineIngredientMod } from '@/hooks/useOrderingEngine'
import { MenuSearchInput, MenuSearchResults } from '@/components/search'
import { calculateOrderSubtotal, splitSubtotalsByTaxInclusion } from '@/lib/order-calculations'
import { isTempId } from '@/lib/order-utils'
import { getSeatColor, getSeatBgColor, getSeatTextColor, getSeatBorderColor } from '@/lib/seat-utils'
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
  entertainmentStatus?: 'available' | 'in_use' | 'maintenance' | 'reserved' | null
  blockTimeMinutes?: number | null
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

// InlineOrderItem: derived type from the inlineOrderItems memo below.
// Kept as a named type alias for use in function signatures throughout this file.
// This replaces the old standalone interface — the store is the source of truth.
type InlineOrderItem = {
  id: string
  menuItemId: string
  name: string
  price: number
  quantity: number
  modifiers?: { id: string; name: string; price: number; depth?: number; preModifier?: string | null; modifierId?: string | null; spiritTier?: string | null; linkedBottleProductId?: string | null; parentModifierId?: string | null }[]
  specialNotes?: string
  seatNumber?: number
  sourceTableId?: string
  courseNumber?: number
  courseStatus?: 'pending' | 'fired' | 'ready' | 'served'
  isHeld?: boolean
  sentToKitchen?: boolean
  isCompleted?: boolean
  status?: 'active' | 'voided' | 'comped'
  voidReason?: string
  wasMade?: boolean
  isTimedRental?: boolean
  blockTimeMinutes?: number
  blockTimeStartedAt?: string
  blockTimeExpiresAt?: string
  kitchenStatus?: 'pending' | 'cooking' | 'ready' | 'delivered'
  completedAt?: string
  resendCount?: number
  resendNote?: string
  createdAt?: string
  delayMinutes?: number | null
  delayStartedAt?: string | null
  delayFiredAt?: string | null
  ingredientModifications?: {
    ingredientId: string
    name: string
    modificationType: 'no' | 'lite' | 'on_side' | 'extra' | 'swap'
    priceAdjustment: number
    swappedTo?: { modifierId: string; name: string; price: number }
  }[]
  categoryType?: string
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
  onOpenTimeClock?: () => void
  onSwitchUser?: () => void
  onOpenSettings?: () => void
  onOpenAdminNav?: () => void
  isManager?: boolean
  // Payment and modifier callbacks
  onOpenPayment?: (orderId: string) => void
  onOpenModifiers?: (item: MenuItem, onComplete: (modifiers: { id: string; name: string; price: number; depth?: number; preModifier?: string | null }[], ingredientModifications?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]) => void, existingModifiers?: { id: string; name: string; price: number; depth?: number; preModifier?: string | null }[], existingIngredientMods?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]) => void
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
  // OrderPanel rendered by parent, passed as children to fill the right panel slot
  children?: React.ReactNode
  // Ref to allow parent to deselect current table (e.g., "Hide" button)
  onRegisterDeselectTable?: (fn: () => void) => void
  // Counter that triggers a floor plan refresh when incremented (e.g., after send-to-kitchen)
  refreshTrigger?: number
  // Pre-loaded menu data from parent (avoids duplicate /api/menu fetch)
  initialCategories?: Category[]
  initialMenuItems?: MenuItem[]
}

// Pizza order configuration (matches what pizza builder produces)
export function FloorPlanHome({
  locationId,
  employeeId,
  employeeName,
  employeeRole,
  onLogout,
  onOpenTimeClock,
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
  children,
  onRegisterDeselectTable,
  refreshTrigger,
  initialCategories,
  initialMenuItems,
}: FloorPlanHomeProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // View mode: tables (floor plan) or menu (category items)
  const [viewMode, setViewMode] = useState<ViewMode>('tables')

  // Categories and menu items — initialized from parent props when available
  const [categories, setCategories] = useState<Category[]>(initialCategories || [])
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [allMenuItems, setAllMenuItems] = useState<MenuItem[]>(initialMenuItems || []) // Full menu, loaded once
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])       // Filtered by category
  const [loadingMenuItems, setLoadingMenuItems] = useState(false)

  // Sync from parent when props update (e.g., parent's loadMenu completes after mount)
  useEffect(() => {
    if (initialCategories && initialCategories.length > 0) {
      setCategories(initialCategories)
    }
  }, [initialCategories])

  useEffect(() => {
    if (initialMenuItems && initialMenuItems.length > 0) {
      setAllMenuItems(initialMenuItems)
      // If a category is selected, refresh its filtered view
      if (selectedCategoryIdRef.current) {
        setMenuItems(initialMenuItems.filter(
          item => item.categoryId === selectedCategoryIdRef.current
        ))
      }
    }
  }, [initialMenuItems])

  // Refs for stable callbacks (avoid stale closures + prevent callback recreation)
  const selectedCategoryIdRef = useRef(selectedCategoryId)
  selectedCategoryIdRef.current = selectedCategoryId
  const allMenuItemsRef = useRef(allMenuItems)
  allMenuItemsRef.current = allMenuItems

  // Open orders count
  const [openOrdersCount, setOpenOrdersCount] = useState(0)

  // Employee dropdown
  const [showEmployeeDropdown, setShowEmployeeDropdown] = useState(false)

  // Settings dropdown
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false)
  const [showTableOptions, setShowTableOptions] = useState(false)
  const [showShareOwnership, setShowShareOwnership] = useState(false)

  // Active order state (for selected table or quick order)
  const [activeTableId, setActiveTableId] = useState<string | null>(null)
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null)
  const [activeOrderNumber, setActiveOrderNumber] = useState<string | null>(null)
  const [activeOrderType, setActiveOrderType] = useState<string | null>(null)
  const [showOrderPanel, setShowOrderPanel] = useState(false)
  const [isSendingOrder, setIsSendingOrder] = useState(false)
  const [pendingPayAfterSave, setPendingPayAfterSave] = useState(false)
  const [guestCount, setGuestCount] = useState(defaultGuestCount)

  // Register deselect function so parent can trigger "Hide" (deselect current table)
  useEffect(() => {
    if (onRegisterDeselectTable) {
      onRegisterDeselectTable(() => {
        setActiveTableId(null)
        setActiveOrderId(null)
        setActiveOrderNumber(null)
        setActiveOrderType(null)
        setShowOrderPanel(false)
        useOrderStore.getState().clearOrder()
      })
    }
  }, [onRegisterDeselectTable])

  // Restore active table from store when remounting (e.g., after switching back from bar mode)
  useEffect(() => {
    const currentOrder = useOrderStore.getState().currentOrder
    if (currentOrder?.tableId && currentOrder.items?.length > 0 && !activeTableId) {
      setActiveTableId(currentOrder.tableId)
      setActiveOrderId(currentOrder.id || null)
      setActiveOrderNumber(currentOrder.orderNumber ? String(currentOrder.orderNumber) : null)
      setActiveOrderType(currentOrder.orderType || null)
      setShowOrderPanel(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only on mount

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
      modifiers: item.modifiers?.map(m => ({
        id: (m.id || m.modifierId) ?? '',
        modifierId: m.modifierId,
        name: m.name,
        price: Number(m.price),
        depth: m.depth ?? 0,
        preModifier: m.preModifier ?? null,
        spiritTier: m.spiritTier ?? null,
        linkedBottleProductId: m.linkedBottleProductId ?? null,
        parentModifierId: m.parentModifierId ?? null,
      })),
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
      delayMinutes: item.delayMinutes,
      delayStartedAt: item.delayStartedAt,
      delayFiredAt: item.delayFiredAt,
      ingredientModifications: item.ingredientModifications,
      status: item.status,
      voidReason: item.voidReason,
      wasMade: item.wasMade,
      categoryType: item.categoryType,
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrder.items]) // Re-derive when hook items change (hook subscribes to store)

  // Per-seat color mapping: which seats have items (for color-coding on table)
  const seatsWithItems = useMemo(() => {
    const set = new Set<number>()
    for (const item of inlineOrderItems) {
      if (item.seatNumber && item.status !== 'voided') set.add(item.seatNumber)
    }
    return set
  }, [inlineOrderItems])

  // REMOVED: loadItemsIntoStore — all order loading now goes through store.loadOrder()
  // which is the SINGLE source of truth for mapping API items into the store format

  // Notes editing — delegated to useActiveOrder hook (NoteEditModal)

  // Modifiers editing state
  const [editingModifiersItemId, setEditingModifiersItemId] = useState<string | null>(null)

  // Comp/Void modal state
  const [compVoidItem, setCompVoidItem] = useState<{
    id: string
    name: string
    price: number
    quantity: number
    modifiers: { id: string; name: string; price: number }[]
    status?: string
    menuItemId?: string
  } | null>(null)

  // Split ticket manager state
  const [showSplitTicketManager, setShowSplitTicketManager] = useState(false)
  const [showSplitOverview, setShowSplitOverview] = useState(false)
  const [splitItemId, setSplitItemId] = useState<string | null>(null)

  // Active seat for auto-assignment (null = "Shared")
  const [activeSeatNumber, setActiveSeatNumber] = useState<number | null>(null)
  // Source table for seat (tracks which table the seat belongs to)
  const [activeSourceTableId, setActiveSourceTableId] = useState<string | null>(null)

  // === Ordering Engine (unified item-add, modifier, pizza, timed rental logic) ===
  const engine = useOrderingEngine({
    locationId,
    employeeId,
    seatNumber: activeSeatNumber ?? undefined,
    sourceTableId: activeSourceTableId ?? undefined,
    defaultOrderType: activeOrderType || 'dine_in',
    tableId: activeTableId ?? undefined,
    guestCount,
    onOpenModifiers: onOpenModifiers as any, // MenuItem is compatible with EngineMenuItem
    onOpenPizzaBuilder: onOpenPizzaBuilder as any,
    onOpenTimedRental: onOpenTimedRental as any,
  })

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

  // Atomic selectors — each field only triggers re-render when IT changes
  const tables = useFloorPlanStore(s => s.tables)
  const sections = useFloorPlanStore(s => s.sections)
  const elements = useFloorPlanStore(s => s.elements)
  const selectedTableId = useFloorPlanStore(s => s.selectedTableId)
  const draggedTableId = useFloorPlanStore(s => s.draggedTableId)
  const dropTargetTableId = useFloorPlanStore(s => s.dropTargetTableId)
  const infoPanelTableId = useFloorPlanStore(s => s.infoPanelTableId)
  const isLoading = useFloorPlanStore(s => s.isLoading)
  const selectedSeat = useFloorPlanStore(s => s.selectedSeat)
  const flashingTables = useFloorPlanStore(s => s.flashingTables)

  // Actions — Zustand guarantees stable function references, no re-renders
  const setTables = useFloorPlanStore(s => s.setTables)
  const setSections = useFloorPlanStore(s => s.setSections)
  const setElements = useFloorPlanStore(s => s.setElements)
  const selectTable = useFloorPlanStore(s => s.selectTable)
  const startDrag = useFloorPlanStore(s => s.startDrag)
  const updateDragTarget = useFloorPlanStore(s => s.updateDragTarget)
  const endDrag = useFloorPlanStore(s => s.endDrag)
  const openInfoPanel = useFloorPlanStore(s => s.openInfoPanel)
  const closeInfoPanel = useFloorPlanStore(s => s.closeInfoPanel)
  const selectSeat = useFloorPlanStore(s => s.selectSeat)
  const clearSelectedSeat = useFloorPlanStore(s => s.clearSelectedSeat)
  const flashTableMessage = useFloorPlanStore(s => s.flashTableMessage)
  const clearExpiredFlashes = useFloorPlanStore(s => s.clearExpiredFlashes)
  const setLoading = useFloorPlanStore(s => s.setLoading)
  const updateTableStatus = useFloorPlanStore(s => s.updateTableStatus)

  // No sync functions needed — Zustand store IS the source of truth
  // syncOrderToStore and syncLocalItemsToStore have been removed

  // Switch to Bar Mode — items already live in Zustand store, no sync needed
  const handleSwitchToBartenderView = useCallback(() => {
    if (onSwitchToBartenderView) {
      onSwitchToBartenderView()
    }
  }, [onSwitchToBartenderView])


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
    layout,
    updateSetting,
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
      } catch {
        // Network error — room preferences will use defaults
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

  // Seat management refresh trigger (Skill 121)
  const [refreshKey, setRefreshKey] = useState(0)

  // Extra seats per table (for walk-up guests before order exists)
  const [extraSeats, setExtraSeats] = useState<Map<string, number>>(new Map())

  // FIX: Ref to always access latest tables data (avoids stale closure issues)
  const tablesRef = useRef(tables)
  tablesRef.current = tables

  // Ref for fixtures/elements data (for collision detection)
  const fixturesRef = useRef(elements)
  fixturesRef.current = elements

  // FIX: Refs for auto-scale values (needed in handlePointerMove for coordinate transformation)
  const autoScaleRef = useRef(autoScale)
  autoScaleRef.current = autoScale
  const autoScaleOffsetRef = useRef(autoScaleOffset)
  autoScaleOffsetRef.current = autoScaleOffset

  // Helper to get best seat count - use MAX of capacity and actual seats, plus any extra seats
  const getTableSeatCount = useCallback((t: FloorPlanTable): number => {
    const seatsLen = t.seats?.length || 0
    const cap = t.capacity || 0
    const extra = extraSeats.get(t.id) || 0
    return Math.max(seatsLen, cap) + extra
  }, [extraSeats])

  // Calculate total seats for a table
  const getTotalSeats = useCallback((table: FloorPlanTable | null): number => {
    if (!table) return 0
    return getTableSeatCount(table)
  }, [getTableSeatCount])

  // Get the active table object
  const activeTable = activeTableId ? tables.find(t => t.id === activeTableId) || null : null

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

    let cancelled = false

    const loadQuickBarItems = async () => {
      try {
        const res = await fetch('/api/menu/items/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemIds: quickBar }),
        })
        if (!cancelled && res.ok) {
          const { items } = await res.json()
          setQuickBarItems(
            (items as { id: string; name: string; price: number }[]).map(item => ({
              id: item.id,
              name: item.name,
              price: item.price,
              bgColor: menuItemColors[item.id]?.bgColor || null,
              textColor: menuItemColors[item.id]?.textColor || null,
            }))
          )
        }
      } catch {
        // Quick bar load failed — non-critical, ignore
      }
    }

    loadQuickBarItems()

    return () => { cancelled = true }
  }, [quickBar, menuItemColors])

  // Load data on mount — skip loadCategories if parent owns menu data (prop defined, even if empty while loading)
  useEffect(() => {
    loadFloorPlanData() // snapshot includes openOrdersCount
    if (initialCategories === undefined) {
      loadCategories()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId])

  // Socket.io: primary update mechanism for all floor plan data
  const { subscribe, isConnected } = useEvents({ locationId, autoConnect: true })

  // 1s heartbeat for UI timers only (flash/undo expiry) — NO data polling
  // FIX 4: Uses refs for callbacks to prevent interval restart on re-render
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    // Guard: clear any existing interval before creating a new one
    if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    heartbeatRef.current = setInterval(() => {
      callbacksRef.current.clearExpiredFlashes()
    }, 1000)

    return () => {
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null }
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current)
    }
  }, []) // Empty deps - refs keep callbacks fresh

  // 20s fallback polling ONLY when socket is disconnected
  useEffect(() => {
    if (isConnected) return // socket working, no polling needed
    const fallback = setInterval(() => {
      callbacksRef.current.loadFloorPlanData?.() // snapshot includes count
    }, 20000)
    return () => clearInterval(fallback)
  }, [isConnected])

  // Visibility change: instant refresh when user switches back to this tab/app
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        callbacksRef.current.loadFloorPlanData?.() // snapshot includes count
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  useEffect(() => {
    if (!isConnected) return

    const refreshAll = () => {
      loadFloorPlanData(false) // snapshot includes count
    }

    const unsubs = [
      // Floor plan layout changes from another terminal
      subscribe('floor-plan:updated', () => {
        logger.log('[FloorPlanHome] Received floor-plan:updated event, refreshing...')
        refreshAll()
      }),
      // Open orders list changed (create/send/pay/void)
      subscribe('orders:list-changed', () => {
        logger.log('[FloorPlanHome] Received orders:list-changed event, refreshing...')
        refreshAll()
      }),
      // New order created — table status changes
      subscribe('order:created', () => {
        logger.log('[FloorPlanHome] Received order:created event, refreshing...')
        refreshAll()
      }),
      // Order updated (items added, metadata changed)
      subscribe('order:updated', () => {
        logger.log('[FloorPlanHome] Received order:updated event, refreshing...')
        refreshAll()
      }),
      // Explicit table status change
      subscribe('table:status-changed', () => {
        logger.log('[FloorPlanHome] Received table:status-changed event, refreshing...')
        loadFloorPlanData(false)
      }),
      // Payment processed — table goes back to available
      subscribe('payment:processed', () => {
        logger.log('[FloorPlanHome] Received payment:processed event, refreshing...')
        refreshAll()
      }),
      // Entertainment session update — status glow changes
      subscribe('entertainment:session-update', () => {
        logger.log('[FloorPlanHome] Received entertainment:session-update event, refreshing...')
        loadFloorPlanData(false)
      }),
    ]

    return () => unsubs.forEach(unsub => unsub())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, subscribe])

  // Parent-triggered refresh (e.g., after send-to-kitchen in orders page)
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      loadFloorPlanData(false) // snapshot includes count
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger])

  // Instant local table status: When items are added to a table order,
  // immediately mark the table as 'occupied' in local state (no server round-trip)
  const currentOrder = useOrderStore(s => s.currentOrder)
  const itemCount = currentOrder?.items?.length ?? 0
  useEffect(() => {
    if (activeTableId && itemCount > 0) {
      updateTableStatus(activeTableId, 'occupied')
    }
  }, [activeTableId, itemCount, updateTableStatus])

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

        // Load the full order into Zustand store — store.loadOrder handles all item mapping
        const store = useOrderStore.getState()
        store.loadOrder({
          id: orderToLoad.id,
          orderNumber: data.orderNumber ?? orderToLoad.orderNumber,
          orderType: data.orderType || orderToLoad.orderType || 'dine_in',
          tableId: data.tableId || orderToLoad.tableId,
          tabName: data.tabName,
          guestCount: data.guestCount || 1,
          items: data.items || [],
          subtotal: Number(data.subtotal) || 0,
          discountTotal: Number(data.discountTotal) || 0,
          taxTotal: Number(data.taxTotal) || 0,
          tipTotal: Number(data.tipTotal) || 0,
          total: Number(data.total) || 0,
        })

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
      // Clear extra seats for just this table
      setExtraSeats(prev => {
        const next = new Map(prev)
        next.delete(activeTableId)
        return next
      })
    }

    // Clear the order panel state
    setActiveOrderId(null)
    setActiveOrderNumber(null)
    setActiveTableId(null)
    setActiveOrderType(null)
    // (store cleared via clearOrder() below — inlineOrderItems memo auto-derives)
    setShowOrderPanel(false)
    setSelectedCategoryId(null)
    setViewMode('tables')

    // Clear Zustand store for cross-route persistence
    useOrderStore.getState().clearOrder()

    // Refresh floor plan to show updated table status
    loadFloorPlanData() // snapshot includes count

    // Notify parent that we've cleared the paid order
    onPaidOrderCleared?.()
  }, [paidOrderId, activeOrderId, activeTableId, tables, onPaidOrderCleared])

  // Refs to track previous data for change detection (prevents flashing during polling)
  // Snapshot deduplication + coalescing refs
  const snapshotInFlightRef = useRef(false)
  const snapshotPendingRef = useRef(false)
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Refs to prevent double-tap race conditions
  const isProcessingSendRef = useRef(false)
  const isSeatAddInFlightRef = useRef(false)
  const isTableSwitchInFlightRef = useRef(false)

  // FIX 4: Refs for heartbeat callbacks - prevents interval restart on re-render
  const callbacksRef = useRef({
    clearExpiredFlashes,
    loadFloorPlanData: null as (() => Promise<void>) | null,
  })

  const loadFloorPlanData = async (showLoading = true) => {
    // Coalescing: if a fetch is in flight, mark pending and let the trailing refresh handle it
    if (snapshotInFlightRef.current) {
      snapshotPendingRef.current = true
      return
    }
    if (snapshotTimerRef.current) {
      clearTimeout(snapshotTimerRef.current)
      snapshotTimerRef.current = null
    }
    snapshotInFlightRef.current = true
    snapshotPendingRef.current = false
    if (showLoading) setLoading(true)
    try {
      const res = await fetch(`/api/floorplan/snapshot?locationId=${locationId}`)
      if (res.ok) {
        const data = await res.json()
        setTables(data.tables || [])
        setSections(data.sections || [])
        setElements(data.elements || [])
        setOpenOrdersCount(data.openOrdersCount ?? 0)
      }
    } catch (error) {
      console.error('[FloorPlanHome] Snapshot load error:', error)
    } finally {
      snapshotInFlightRef.current = false
      if (showLoading) setLoading(false)
      // If more events arrived while fetching, do one trailing refresh after 150ms
      if (snapshotPendingRef.current) {
        snapshotPendingRef.current = false
        snapshotTimerRef.current = setTimeout(() => {
          loadFloorPlanData(false)
        }, 150)
      }
    }
  }

  const loadCategories = async () => {
    try {
      // Use same /api/menu endpoint as orders page for consistency
      // Stores BOTH categories AND items — items are filtered client-side on category click
      const res = await fetch(`/api/menu?locationId=${locationId}`, {
        cache: 'no-store',
      })
      if (res.ok) {
        const data = await res.json()
        setCategories(data.categories || [])
        setAllMenuItems(data.items || [])
        // If a category is currently selected, refresh its filtered view
        if (selectedCategoryIdRef.current) {
          setMenuItems((data.items || []).filter(
            (item: MenuItem) => item.categoryId === selectedCategoryIdRef.current
          ))
        }
      }
    } catch (error) {
      console.error('[FloorPlanHome] Categories load error:', error)
    }
  }

  // FIX 4: Keep refs updated with latest callbacks
  useEffect(() => {
    callbacksRef.current = {
      clearExpiredFlashes,
      loadFloorPlanData: () => loadFloorPlanData(false),
    }
  })

  // loadMenuItems removed — category filtering is now instant client-side
  // from allMenuItems (loaded once via loadCategories → /api/menu)

  // Handle category click - toggle between tables and menu view
  // Uses refs for stable callback (no recreation on state change = no Framer Motion re-evals)
  // Filters from allMenuItems client-side instead of making per-category API calls
  const handleCategoryClick = useCallback((categoryId: string | null) => {
    if (!categoryId) {
      // "All" was clicked - show tables
      setSelectedCategoryId(null)
      setViewMode('tables')
      setMenuItems([])
      return
    }

    // Toggle behavior: clicking same category deselects it
    if (categoryId === selectedCategoryIdRef.current) {
      setSelectedCategoryId(null)
      setViewMode('tables')
      setMenuItems([])
      return
    }

    // Select new category — instant client-side filter (0ms, no API call)
    setSelectedCategoryId(categoryId)
    setViewMode('menu')
    setMenuItems(allMenuItemsRef.current.filter(item => item.categoryId === categoryId))
  }, [])


  // Reset table: remove ALL temp seats on this table (regardless of order)
  const handleResetTable = useCallback((tableId: string) => {
    // Use a dummy orderId — the RESET_TABLE action only needs the tableId
    void fetch(`/api/orders/_/seating`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'RESET_TABLE', tableId }),
    }).catch(() => {})

    // Clear local state
    setExtraSeats(prev => {
      if (!prev.has(tableId)) return prev
      const next = new Map(prev)
      next.delete(tableId)
      return next
    })
    setActiveOrderId(null)
    setActiveOrderNumber(null)
    setActiveTableId(null)
    setShowOrderPanel(false)
    useOrderStore.getState().clearOrder()
  }, [])

  // Handle table tap - open order panel
  const handleTableTap = useCallback(async (table: FloorPlanTable) => {
    // Prevent double-tap races during table switch
    if (isTableSwitchInFlightRef.current) return
    isTableSwitchInFlightRef.current = true

    try {
    if (selectedSeat) {
      clearSelectedSeat()
    }

    // Clean up previous table's temp seats if switching to a different table with no items
    if (activeTableId && activeTableId !== table.id) {
      const store = useOrderStore.getState()
      const prevOrderId = activeOrderId || store.currentOrder?.id
      const hasItems = (store.currentOrder?.items.length ?? 0) > 0
      if (!hasItems && prevOrderId && !isTempId(prevOrderId)) {
        // Fire-and-forget — don't block table switch on cleanup network call
        void fetch(`/api/orders/${prevOrderId}/seating`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'CLEANUP' }),
        }).catch(() => {})
      }
      // Clear extra seats for previous table
      setExtraSeats(prev => {
        if (!prev.has(activeTableId)) return prev
        const next = new Map(prev)
        next.delete(activeTableId)
        return next
      })
    }

    const totalSeats = getTotalSeats(table)
    const primaryTable = table
    logger.log(`[handleTableTap] Setting guest count to ${totalSeats} for table ${primaryTable.name} (capacity=${primaryTable.capacity})`)

    setActiveTableId(primaryTable.id)
    setActiveOrderType('dine_in')
    setShowOrderPanel(true)
    setActiveSeatNumber(null) // Reset active seat when switching tables
    setActiveSourceTableId(null) // Reset source table too
    setGuestCount(totalSeats) // Set guest count based on table capacity

    if (primaryTable.currentOrder) {
      // Check for split orders — show overview instead of loading parent order
      const hasSplits = primaryTable.currentOrder.status === 'split' &&
                        (primaryTable.currentOrder.splitOrders?.length ?? 0) > 0
      if (hasSplits) {
        setActiveTableId(primaryTable.id)
        setActiveOrderId(primaryTable.currentOrder.id)
        setShowSplitOverview(true)
        setShowOrderPanel(false)
        return
      }

      // Load existing order items from this table
      setActiveOrderId(primaryTable.currentOrder.id)
      setActiveOrderNumber(String(primaryTable.currentOrder.orderNumber))
      try {
        const res = await fetch(`/api/orders/${primaryTable.currentOrder.id}`)
        if (res.ok) {
          const data = await res.json()
          // Use loadOrder to atomically set tableId + items in Zustand store
          // store.loadOrder handles ALL item field mapping — one path, no duplication
          const store = useOrderStore.getState()
          store.loadOrder({
            id: primaryTable.currentOrder.id,
            orderNumber: data.orderNumber ?? primaryTable.currentOrder.orderNumber,
            orderType: data.orderType || 'dine_in',
            tableId: data.tableId || primaryTable.id,
            tabName: data.tabName,
            guestCount: data.guestCount || totalSeats,
            items: data.items || [],
            subtotal: Number(data.subtotal) || 0,
            taxTotal: Number(data.taxTotal) || 0,
            tipTotal: Number(data.tipTotal) || 0,
            total: Number(data.total) || 0,
            notes: data.notes,
            reopenedAt: data.reopenedAt,
            reopenReason: data.reopenReason,
          })

          // Restore extra seats: if order items use higher seat numbers than the
          // table's physical seats, grow the seat strip to include them
          const maxSeatInItems = (data.items || []).reduce(
            (max: number, item: { seatNumber?: number | null }) =>
              Math.max(max, item.seatNumber || 0),
            0
          )
          const orderSeatCount = Math.max(
            maxSeatInItems,
            data.baseSeatCount ? (data.baseSeatCount + (data.extraSeatCount || 0)) : 0
          )
          if (orderSeatCount > totalSeats) {
            setExtraSeats(prev => {
              const next = new Map(prev)
              next.set(primaryTable.id, orderSeatCount - totalSeats)
              return next
            })
          }
        }
      } catch (error) {
        console.error('[FloorPlanHome] Failed to load order:', error)
      }
    } else {
      // No existing order on this table — clear any stale extra seats
      // (extra seats only persist while an order is active)
      setExtraSeats(prev => {
        if (!prev.has(primaryTable.id)) return prev
        const next = new Map(prev)
        next.delete(primaryTable.id)
        return next
      })

      // Only clear items if we're switching between two DIFFERENT tables
      // If tapping the same table, or assigning a table after adding items with no table, preserve items
      const isSameTable = activeTableId === primaryTable.id
      const store = useOrderStore.getState()
      const hasUnsavedItems = (store.currentOrder?.items.length ?? 0) > 0
      const isAssigningTableToFreeItems = !activeTableId && hasUnsavedItems

      if (isAssigningTableToFreeItems) {
        // User added items before picking a table — keep items, just assign the table
        store.updateOrderType('dine_in', {
          locationId,
          tableId: primaryTable.id,
          guestCount: totalSeats,
        })
      } else if (!isSameTable) {
        setActiveOrderId(null)
        setActiveOrderNumber(null)
        activeOrder.clearOrder()
        // Use hook's startOrder to trigger background draft POST
        // Draft shell created in DB immediately — ensureOrderInDB later only appends items
        activeOrder.startOrder('dine_in', {
          locationId,
          tableId: primaryTable.id,
          guestCount: totalSeats,
        })
      }
    }
    } finally {
      isTableSwitchInFlightRef.current = false
    }
  }, [selectedSeat, clearSelectedSeat, getTotalSeats, activeTableId, activeOrderId])

  // Handle selecting a split ticket from the overview
  const handleSelectSplit = useCallback(async (splitOrderId: string) => {
    setShowSplitOverview(false)
    setShowOrderPanel(true)
    setActiveOrderId(splitOrderId)

    try {
      const res = await fetch(`/api/orders/${splitOrderId}`)
      if (res.ok) {
        const data = await res.json()
        if (data) {
          const store = useOrderStore.getState()
          store.loadOrder({
            id: data.id,
            orderNumber: data.orderNumber,
            orderType: data.orderType || 'dine_in',
            tableId: data.tableId || activeTableId,
            tabName: data.tabName,
            guestCount: data.guestCount,
            items: data.items || [],
            subtotal: Number(data.subtotal) || 0,
            taxTotal: Number(data.taxTotal) || 0,
            tipTotal: Number(data.tipTotal) || 0,
            total: Number(data.total) || 0,
            notes: data.notes,
            reopenedAt: data.reopenedAt,
            reopenReason: data.reopenReason,
          })
          setActiveOrderNumber(String(data.orderNumber))
        }
      }
    } catch (err) {
      console.error('Failed to load split order:', err)
    }
  }, [activeTableId])

  // Handle merging split tickets back into one order
  const handleMergeBack = useCallback(async () => {
    if (!activeOrderId) return
    try {
      const res = await fetch(`/api/orders/${activeOrderId}/split-tickets`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Splits merged back')
        setShowSplitOverview(false)
        setActiveOrderId(null)
        setActiveTableId(null)
        loadFloorPlanData(false)
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to merge splits')
      }
    } catch {
      toast.error('Failed to merge splits')
    }
  }, [activeOrderId, loadFloorPlanData])

  // Handle transfer table (placeholder for future enhancement)
  const handleTransferTable = useCallback(() => {
    toast.info('Table transfer coming soon')
  }, [])

  // Handle quick order type (Takeout, Delivery, Bar Tab)
  const handleQuickOrderType = useCallback((orderType: QuickOrderType) => {
    const store = useOrderStore.getState()
    const hasItems = (store.currentOrder?.items.length ?? 0) > 0

    if (hasItems) {
      // Preserve existing items — only change the order type metadata
      store.updateOrderType(orderType)
    } else {
      // No items yet — start fresh with the new type
      // Use hook's startOrder to trigger background draft POST
      activeOrder.clearOrder()
      activeOrder.startOrder(orderType)
    }

    // Clear table context for non-table order types
    setActiveTableId(null)
    setActiveOrderType(orderType)
    setActiveOrderId(null)
    setActiveOrderNumber(null)
    setShowOrderPanel(true)
  }, [])

  // Handle menu item tap - add to order
  // Handle menu item tap — delegates to the ordering engine
  const handleMenuItemTap = engine.handleMenuItemTap

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
      } as EngineMenuItem)
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

  // Handle tapping an existing order item to edit modifiers
  const handleOrderItemTap = useCallback((item: InlineOrderItem) => {
    // Don't allow editing sent items
    if (item.sentToKitchen) {
      return
    }

    // Find the menu item to get modifier groups
    const menuItem = menuItems.find(m => m.id === item.menuItemId)
    if (!menuItem) return

    // Delegate to engine's edit handler
    engine.handleEditItemModifiers(
      item.id,
      menuItem as EngineMenuItem,
      item.modifiers as EngineModifier[],
      item.ingredientModifications as EngineIngredientMod[],
    )
  }, [menuItems, engine])

  // Save notes — delegates to useActiveOrder's saveNote (handles API + store update)
  const handleSaveNotes = useCallback(async (note: string) => {
    if (activeOrder.noteEditTarget?.itemId) {
      await activeOrder.saveNote(activeOrder.noteEditTarget.itemId, note)
      // Store is updated by saveNote — inlineOrderItems memo auto-derives
    }
    activeOrder.closeNoteEditor()
  }, [activeOrder.noteEditTarget, activeOrder.saveNote, activeOrder.closeNoteEditor])

  // Add a new seat to the table (Skill 121 - Atomic Seat Management)
  // Works with or without an active order
  const handleAddSeat = useCallback(async (tableId?: string) => {
    // Prevent double-tap: block concurrent seat additions
    if (isSeatAddInFlightRef.current) return
    isSeatAddInFlightRef.current = true

    try {
      const targetTableId = tableId || activeTable?.id
      if (!targetTableId) {
        toast.error('No table selected')
        return
      }

      // Resolve the real DB order ID: prefer activeOrderId, fallback to store
      const resolvedOrderId = activeOrderId || useOrderStore.getState().currentOrder?.id || null
      const isSavedOrder = resolvedOrderId && !resolvedOrderId.startsWith('temp-')

      // If there's a saved order, add seat via seating API (creates temp DB seat row)
      if (isSavedOrder) {
        const response = await fetch(`/api/orders/${resolvedOrderId}/seating`, {
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

        if (result.warning === 'high_seat_count') {
          toast.info(`This table now has ${result.newTotalSeats} seats`)
        }

        // Refresh floor plan to show the new temp seat on the table.
        // Do NOT increment extraSeats here — the snapshot refresh will
        // include the real temp Seat DB row in seats.length, so adding
        // to extraSeats would double-count.
        void loadFloorPlanData(false)
      } else {
        // No saved order yet - add an extra seat locally (will become real on order save)
        setExtraSeats(prev => {
          const next = new Map(prev)
          const current = next.get(targetTableId) || 0
          next.set(targetTableId, current + 1)
          return next
        })
        // Get next seat number
        const newSeatNum = getTotalSeats(activeTable!) + 1
        toast.success(`Seat ${newSeatNum} added`)
      }
    } catch (err) {
      console.error('[FloorPlanHome] Failed to add seat:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to add seat')
    } finally {
      isSeatAddInFlightRef.current = false
    }
  }, [activeOrderId, activeTable, getTotalSeats])

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

      // Update store directly
      const store = useOrderStore.getState()
      const existingItem = store.currentOrder?.items.find(i => i.id === itemId)
      store.updateItem(itemId, {
        modifiers: newModifiers.map(m => ({
          id: m.id, name: m.name, price: Number(m.price),
          depth: 0, preModifier: null, spiritTier: null, linkedBottleProductId: null, parentModifierId: null,
        })),
        resendCount: (existingItem?.resendCount || 0) + 1,
      })

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
      onOpenModifiers(menuItem, (newModifiers, ingredientMods) => {
        handleSaveModifierChanges(item.id, newModifiers)
        // Also update ingredient modifications in the store for sent items
        if (ingredientMods) {
          useOrderStore.getState().updateItem(item.id, {
            ingredientModifications: ingredientMods as any,
          })
        }
      }, item.modifiers, item.ingredientModifications as { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[])
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
        // Update store to increment resend count
        const store = useOrderStore.getState()
        const existingItem = store.currentOrder?.items.find(i => i.id === resendModal.itemId)
        store.updateItem(resendModal.itemId, {
          resendCount: (existingItem?.resendCount || 0) + 1,
        })

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
      modifiers: (item.modifiers || []).map(m => ({
        id: (m.id || m.modifierId) ?? '',
        modifierId: m.modifierId,
        name: m.name,
        price: Number(m.price),
        depth: m.depth ?? 0,
        preModifier: m.preModifier ?? null,
        spiritTier: m.spiritTier ?? null,
        linkedBottleProductId: m.linkedBottleProductId ?? null,
        parentModifierId: m.parentModifierId ?? null,
      })),
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

      // Clear extra seats for this table since they're now part of the order
      if (activeTableId) {
        setExtraSeats(prev => {
          const next = new Map(prev)
          next.delete(activeTableId)
          return next
        })
      }

      // Return to floor plan view IMMEDIATELY — don't block on background refreshes
      setActiveOrderId(null)
      setActiveOrderNumber(null)
      setActiveOrderType(null)
      setActiveSeatNumber(null)
      setActiveSourceTableId(null)
      useOrderStore.getState().clearOrder()
      setActiveTableId(null)
      setShowOrderPanel(false)

      // Refresh floor plan data in background (fire-and-forget — UI already cleared)
      loadFloorPlanData(false).catch(() => {})
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

  // Close/cancel an order with $0 balance (e.g. after voiding all items)
  const handleCloseOrder = useCallback(async () => {
    if (!activeOrderId) return
    try {
      const res = await fetch(`/api/orders/${activeOrderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error('[handleCloseOrder] API error:', res.status, err)
        toast.error(err.error || 'Failed to close order')
        return
      }
      toast.success('Order closed')
    } catch (e) {
      console.error('[handleCloseOrder] Network error:', e)
      toast.error('Failed to close order — check connection')
      return
    }
    // Clear the panel
    // (store cleared via clearOrder() below — inlineOrderItems memo auto-derives)
    setActiveOrderId(null)
    setActiveOrderNumber(null)
    setActiveOrderType(null)
    activeOrder.closeNoteEditor()
    setGuestCount(defaultGuestCount)
    setActiveSeatNumber(null)
    useOrderStore.getState().clearOrder()
    loadFloorPlanData()
  }, [activeOrderId, defaultGuestCount, activeOrder, loadFloorPlanData])

  // Close order panel
  const handleCloseOrderPanel = useCallback(() => {
    // If the order has no items, clean up any temp seats that were added
    // (user tapped table, added seats, but didn't add any food/drinks)
    const store = useOrderStore.getState()
    const orderId = activeOrderId || store.currentOrder?.id
    const hasItems = (store.currentOrder?.items.length ?? 0) > 0
    if (!hasItems && orderId && !isTempId(orderId)) {
      // Fire-and-forget: remove temp seats and reset extraSeatCount
      void fetch(`/api/orders/${orderId}/seating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'CLEANUP' }),
      }).catch(() => {})
    }

    // Always clear extra seats when closing panel — they're restored from order data
    // when the table is re-tapped (lines 1022-1039 restore from order.extraSeatCount)
    if (activeTableId) {
      setExtraSeats(prev => {
        if (!prev.has(activeTableId)) return prev
        const next = new Map(prev)
        next.delete(activeTableId)
        return next
      })
    }

    // Clear dependent state FIRST
    // (store cleared via clearOrder() below — inlineOrderItems memo auto-derives)
    setActiveOrderId(null)
    setActiveOrderNumber(null)
    setActiveOrderType(null)
    activeOrder.closeNoteEditor()
    setGuestCount(defaultGuestCount)
    setActiveSeatNumber(null)
    setActiveSourceTableId(null)

    // Clear Zustand store for cross-route persistence
    store.clearOrder()

    // Clear primary state LAST
    setActiveTableId(null)
    setShowOrderPanel(false)

    // Floor plan refresh happens automatically via socket dispatch from the CLEANUP API
  }, [defaultGuestCount, activeTableId, activeOrderId])

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
  const [paymentMode, setPaymentMode] = useState<'cash' | 'card'>('card')

  // Calculate order subtotal using centralized function (single source of truth)
  const orderSubtotal = calculateOrderSubtotal(inlineOrderItems)

  // Tax-inclusive settings for split pricing
  const { taxInclusiveLiquor: settingsTaxIncLiquor, taxInclusiveFood: settingsTaxIncFood } = useOrderSettings()

  // Split subtotals for tax-inclusive pricing (liquor vs food)
  const taxSplit = useMemo(() => splitSubtotalsByTaxInclusion(inlineOrderItems, {
    taxInclusiveLiquor: settingsTaxIncLiquor,
    taxInclusiveFood: settingsTaxIncFood,
  }), [inlineOrderItems, settingsTaxIncLiquor, settingsTaxIncFood])

  // Pricing (replaces hardcoded TAX_RATE and CASH_DISCOUNT_RATE)
  const pricing = usePricing({
    subtotal: orderSubtotal,
    inclusiveSubtotal: taxSplit.inclusiveSubtotal,
    exclusiveSubtotal: taxSplit.exclusiveSubtotal,
    discountTotal: 0,
    tipTotal: 0,
    paymentMethod: paymentMode || 'card',
  })

  // Totals from pricing hook (replaces hardcoded TAX_RATE and CASH_DISCOUNT_RATE)
  const orderTotal = pricing.total

  // Handle payment success (extracted from inline for OrderPanel)
  const handlePaymentSuccess = useCallback(async (result: { cardLast4?: string; cardBrand?: string; tipAmount: number }) => {
    toast.success(`Payment approved! Card: ****${result.cardLast4 || '****'}`)

    // Record the payment in the database and mark order as paid/closed
    if (activeOrderId) {
      try {
        // Fetch server-side total to avoid client/server pricing mismatch
        const orderRes = await fetch(`/api/orders/${activeOrderId}`)
        const orderData = await orderRes.json()
        const serverTotal = Number(orderData?.data?.total ?? orderData?.total ?? orderTotal)

        await fetch(`/api/orders/${activeOrderId}/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            payments: [{
              method: 'credit',
              amount: serverTotal,
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
    // (store cleared via clearOrder() below — inlineOrderItems memo auto-derives)
    setActiveOrderId(null)
    setActiveOrderNumber(null)
    setActiveOrderType(null)
    activeOrder.closeNoteEditor()
    setGuestCount(defaultGuestCount)
    setActiveSeatNumber(null)
    setActiveSourceTableId(null)
    useOrderStore.getState().clearOrder()
    setActiveTableId(null)
    setShowOrderPanel(false)
    setSelectedCategoryId(null)
    setViewMode('tables')

    // Refresh floor plan to show updated table status
    loadFloorPlanData() // snapshot includes count
  }, [activeOrderId, orderTotal, employeeId, defaultGuestCount, loadFloorPlanData])

  // Note: Ghost preview calculation is now handled by useFloorPlanDrag hook

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

  // Handle seat tap - open the table's order panel AND select the seat
  // This ensures tapping a seat on the floor plan always activates the correct table context
  const handleSeatTap = useCallback(async (tableId: string, seatNumber: number) => {
    const isAlreadySelected = selectedSeat?.tableId === tableId && selectedSeat?.seatNumber === seatNumber

    if (isAlreadySelected) {
      // Deselect seat but keep table open
      clearSelectedSeat()
      setActiveSeatNumber(null)
      setActiveSourceTableId(null)
      return
    }

    // If this seat belongs to a different table than the currently active one,
    // open that table first (same as tapping the table itself)
    const table = tablesRef.current.find(t => t.id === tableId)
    if (!table) return

    if (activeTableId !== tableId) {
      // Open the table — this loads the order, sets activeTableId, shows panel
      await handleTableTap(table)
    } else if (!showOrderPanel) {
      setShowOrderPanel(true)
    }

    // Now select the seat (after table is active)
    selectSeat(tableId, seatNumber)
    setActiveSeatNumber(seatNumber)
    setActiveSourceTableId(tableId)
  }, [selectedSeat, selectSeat, clearSelectedSeat, activeTableId, handleTableTap, showOrderPanel])

  // Handle temporary seat drag - update position via API
  const handleSeatDrag = useCallback((seatId: string, newRelativeX: number, newRelativeY: number) => {
    fetch(`/api/seats/${seatId}?context=pos`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relativeX: newRelativeX, relativeY: newRelativeY }),
    }).catch(console.error)
  }, [])

  // Stable TableNode callbacks — avoid inline closures that break React.memo
  const handleTableTapById = useCallback((tableId: string) => {
    const table = tablesRef.current.find(t => t.id === tableId)
    if (table) handleTableTap(table)
  }, [handleTableTap])

  const handleDragStartById = useCallback((tableId: string) => {
    startDrag(tableId)
  }, [startDrag])

  const handleLongPressById = useCallback((tableId: string) => {
    openInfoPanel(tableId)
  }, [openInfoPanel])

  const handleSeatTapForTable = useCallback((tableId: string, seatNumber: number) => {
    handleSeatTap(tableId, seatNumber)
  }, [handleSeatTap])

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
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        const searchInput = searchContainerRef.current?.querySelector('input')
        searchInput?.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewMode, closeInfoPanel, selectTable, handleCloseOrderPanel, searchQuery, clearSearch])

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
      className="floor-plan-container floor-plan-home"
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

                    <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.1)', margin: '4px 0' }} />

                    {/* Crew Hub Links */}
                    <a
                      href="/crew"
                      onClick={() => setShowEmployeeDropdown(false)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                        padding: '10px 16px', background: 'transparent', border: 'none',
                        color: '#e2e8f0', fontSize: '13px', cursor: 'pointer', textAlign: 'left', textDecoration: 'none',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      Crew Hub
                    </a>
                    <a
                      href="/crew/shift"
                      onClick={() => setShowEmployeeDropdown(false)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                        padding: '10px 16px', background: 'transparent', border: 'none',
                        color: '#e2e8f0', fontSize: '13px', cursor: 'pointer', textAlign: 'left', textDecoration: 'none',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      My Shift
                    </a>
                    <a
                      href="/crew/tip-bank"
                      onClick={() => setShowEmployeeDropdown(false)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                        padding: '10px 16px', background: 'transparent', border: 'none',
                        color: '#e2e8f0', fontSize: '13px', cursor: 'pointer', textAlign: 'left', textDecoration: 'none',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Tip Bank
                    </a>
                    <a
                      href="/crew/tip-group"
                      onClick={() => setShowEmployeeDropdown(false)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                        padding: '10px 16px', background: 'transparent', border: 'none',
                        color: '#e2e8f0', fontSize: '13px', cursor: 'pointer', textAlign: 'left', textDecoration: 'none',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      Tip Group
                    </a>

                    <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.1)', margin: '4px 0' }} />

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
                        if (onOpenTimeClock) {
                          onOpenTimeClock()
                        } else {
                          onLogout()
                        }
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

          {/* Settings - only shown if callback provided (permission-gated) */}
          {onOpenAdminNav && (
            <button
              className="icon-btn"
              onClick={onOpenAdminNav}
              title="Settings"
              style={{
                background: 'rgba(59, 130, 246, 0.2)',
                border: '1px solid rgba(59, 130, 246, 0.4)',
                borderRadius: '8px',
                padding: '8px',
              }}
            >
              <svg width="22" height="22" fill="none" stroke="#3b82f6" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {/* Content below header: Order panel (left) + Main content (right) */}
      <div style={{ display: 'flex', flexDirection: 'row-reverse', flex: 1, minHeight: 0, overflow: 'hidden' }}>
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
                cardPriceMultiplier={pricing.isDualPricingEnabled ? 1 + pricing.cashDiscountRate / 100 : undefined}
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

                      const isInActiveGroup = table.id === activeTableId

                      return (
                        <TableNode
                          key={table.id}
                          table={table}
                          isSelected={selectedTableId === table.id || isInActiveGroup}
                          isDragging={draggedTableId === table.id}
                          isDropTarget={dropTargetTableId === table.id}
                          isColliding={draggedTableId === table.id && isColliding}
                          showSeats={table.id === activeTableId}
                          selectedSeat={selectedSeat}
                          flashMessage={flashMessage}
                          orderStatusBadges={table.currentOrder && table.id === activeTableId ? {
                            hasDelay: !!(activeOrder.pendingDelay && activeOrder.pendingDelay > 0),
                            hasHeld: inlineOrderItems.some(i => !i.sentToKitchen && i.isHeld),
                            hasCourses: activeOrder.coursingEnabled,
                            delayMinutes: activeOrder.pendingDelay ?? undefined,
                          } : undefined}
                          seatsWithItems={table.id === activeTableId ? seatsWithItems : undefined}
                          splitCount={table.currentOrder?.splitOrders?.length}
                          onTap={handleTableTapById}
                          onDragStart={handleDragStartById}
                          onDragEnd={endDrag}
                          onLongPress={handleLongPressById}
                          onSeatTap={handleSeatTapForTable}
                          onSeatDrag={handleSeatDrag}
                        />
                      )
                    })}
                  </AnimatePresence>

                  {/* Reset Table button — shows on selected table with temp seats and no items */}
                  {activeTableId && inlineOrderItems.length === 0 && (() => {
                    const activeTable = tables.find(t => t.id === activeTableId)
                    if (!activeTable) return null
                    const hasTempSeats = activeTable.seats.some(s => s.isTemporary)
                    if (!hasTempSeats) return null
                    return (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleResetTable(activeTableId)
                        }}
                        style={{
                          position: 'absolute',
                          left: activeTable.posX + activeTable.width / 2,
                          top: activeTable.posY + activeTable.height + 50,
                          transform: 'translateX(-50%)',
                          padding: '6px 14px',
                          background: 'rgba(239, 68, 68, 0.2)',
                          border: '1px solid rgba(239, 68, 68, 0.5)',
                          borderRadius: '8px',
                          color: '#fca5a5',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          zIndex: 20,
                        }}
                      >
                        Reset Table
                      </button>
                    )
                  })()}

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

                  {/* Ghost preview removed — table combining was removed in Skill 326 */}
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
                            ${pricing.isDualPricingEnabled ? (item.price * (1 + pricing.cashDiscountRate / 100)).toFixed(2) : item.price.toFixed(2)}
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

        {/* Left Panel - Order Panel (always visible, full height from below header) */}
        <div
          style={{
            width: 360,
            flexShrink: 0,
            borderRight: '1px solid rgba(255, 255, 255, 0.08)',
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
                <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                  <h3
                    onClick={() => activeTable && setShowTableOptions(!showTableOptions)}
                    style={{
                      fontSize: '16px',
                      fontWeight: 600,
                      color: '#f1f5f9',
                      margin: 0,
                      cursor: activeTable ? 'pointer' : 'default',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    {activeTable
                      ? activeTable.name
                      : activeOrderType === 'bar_tab' ? 'Bar Tab'
                      : activeOrderType === 'takeout' ? 'Takeout'
                      : activeOrderType === 'delivery' ? 'Delivery'
                      : 'New Order'}
                    {activeTable && (
                      <svg width="12" height="12" fill="none" stroke="#64748b" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </h3>
                  {/* Table Options Popover */}
                  <TableOptionsPopover
                    isOpen={showTableOptions}
                    onClose={() => setShowTableOptions(false)}
                    tableName={activeTable?.name || 'Table'}
                    coursingEnabled={activeOrder.coursingEnabled}
                    onCoursingToggle={activeOrder.setCoursingEnabled}
                    guestCount={guestCount}
                    onGuestCountChange={setGuestCount}
                  />
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
                    {activeOrderId && (
                      <button
                        onClick={() => setShowShareOwnership(true)}
                        style={{
                          fontSize: '11px',
                          fontWeight: 500,
                          color: '#a78bfa',
                          padding: '2px 8px',
                          background: 'rgba(167, 139, 250, 0.15)',
                          border: '1px solid rgba(167, 139, 250, 0.3)',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Share
                      </button>
                    )}
                  </div>
                </div>

                {/* Fire Next Course button — shown when coursing is enabled and there are unfired courses */}
                {activeOrder.coursingEnabled && (() => {
                  // Find the next unfired course
                  const delays = activeOrder.courseDelays || {}
                  const pendingCourses: number[] = []
                  for (const item of inlineOrderItems) {
                    if (!item.sentToKitchen && item.courseNumber && item.courseNumber > 1) {
                      if (!pendingCourses.includes(item.courseNumber)) {
                        pendingCourses.push(item.courseNumber)
                      }
                    }
                  }
                  pendingCourses.sort((a, b) => a - b)
                  const nextCourse = pendingCourses.find(cn => !delays[cn]?.firedAt)
                  if (!nextCourse) return null

                  const delay = delays[nextCourse]
                  const isTimerRunning = delay?.startedAt && !delay?.firedAt

                  return (
                    <button
                      onClick={() => activeOrder.handleFireCourse(nextCourse)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '8px',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                        background: isTimerRunning
                          ? 'rgba(251, 191, 36, 0.15)'
                          : 'rgba(239, 68, 68, 0.15)',
                        color: isTimerRunning ? '#fbbf24' : '#f87171',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap' as const,
                        flexShrink: 0,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      🔥 Fire C{nextCourse}
                    </button>
                  )
                })()}
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
                      <span style={{ fontSize: '10px', color: getSeatTextColor(activeSeatNumber) }}>
                        New items → Seat {activeSeatNumber}
                      </span>
                    )}
                  </div>

                  {/* "Shared" button */}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '0' }}>
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

                  {/* Flat seat list 1..N */}
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
                            border: `1px solid ${activeSeatNumber === seatNum ? getSeatBorderColor(seatNum) : getSeatBorderColor(seatNum)}`,
                            background: activeSeatNumber === seatNum ? getSeatBgColor(seatNum) : 'rgba(255, 255, 255, 0.05)',
                            color: activeSeatNumber === seatNum ? getSeatTextColor(seatNum) : getSeatTextColor(seatNum),
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
                </div>
              )}

              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {children}
              </div>
        </div>
      </div>




      {/* Table Info Panel */}
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
        />
      )}

      {/* Notes Editor Modal — shared component */}
      <NoteEditModal
        isOpen={!!activeOrder.noteEditTarget}
        onClose={activeOrder.closeNoteEditor}
        onSave={handleSaveNotes}
        currentNote={activeOrder.noteEditTarget?.currentNote}
        itemName={activeOrder.noteEditTarget?.itemName}
      />

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
          onComplete={async (result) => {
            const voidedItemId = compVoidItem?.id
            setCompVoidItem(null)

            // If all items were voided/comped and order was auto-closed, clear it
            if (result.orderAutoClosed) {
              useOrderStore.getState().clearOrder()
              setActiveOrderId(null)
              toast.success('Order cancelled — all items voided')
              return
            }

            // Immediately update the voided/comped item status in the store
            // This ensures totals recalculate without waiting for API refresh
            if (voidedItemId) {
              useOrderStore.getState().updateItem(voidedItemId, {
                status: result.action === 'restore' ? 'active' as const : result.action as 'voided' | 'comped',
              })
            }

            // Also refresh from server for full data consistency
            if (activeOrderId) {
              try {
                const response = await fetch(`/api/orders/${activeOrderId}`)
                if (response.ok) {
                  const orderData = await response.json()
                  // Reload full order via store.loadOrder — one path, no duplication
                  const store = useOrderStore.getState()
                  store.loadOrder(orderData)
                }
              } catch (error) {
                console.error('Failed to refresh order:', error)
              }
            }
            toast.success('Item comped/voided successfully')
          }}
        />
      )}

      {/* Split Tickets Overview — shown when tapping a table with split orders */}
      {showSplitOverview && activeOrderId && activeTableId && (() => {
        const activeTable = tables.find(t => t.id === activeTableId)
        if (!activeTable?.currentOrder?.splitOrders) return null
        return (
          <SplitTicketsOverview
            parentOrderId={activeOrderId}
            orderNumber={activeTable.currentOrder.orderNumber}
            tableName={activeTable.name || ''}
            splitOrders={activeTable.currentOrder.splitOrders}
            onSelectSplit={handleSelectSplit}
            onEditSplits={() => {
              setShowSplitOverview(false)
              setShowSplitTicketManager(true)
            }}
            onMergeBack={handleMergeBack}
            onTransferItems={() => {
              setShowSplitOverview(false)
              toast.info('Item transfer coming soon')
            }}
            onTransferTable={handleTransferTable}
            onClose={() => {
              setShowSplitOverview(false)
              setActiveTableId(null)
              setActiveOrderId(null)
            }}
          />
        )
      })()}

      {/* Split Check Screen */}
      {showSplitTicketManager && activeOrderId && (
        <SplitCheckScreen
          orderId={activeOrderId}
          items={inlineOrderItems.map(item => ({
            id: item.id,
            seatNumber: item.seatNumber,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            categoryType: item.categoryType,
            sentToKitchen: item.sentToKitchen,
            isPaid: item.status === 'comped' || item.status === 'voided',
          }))}
          onClose={() => {
            setShowSplitTicketManager(false)
            setSplitItemId(null)
          }}
          onSplitApplied={async () => {
            if (activeOrderId) {
              try {
                const response = await fetch(`/api/orders/${activeOrderId}`)
                if (response.ok) {
                  const orderData = await response.json()
                  const store = useOrderStore.getState()
                  store.loadOrder(orderData)
                }
              } catch (error) {
                console.error('Failed to refresh order:', error)
              }
            }
            setShowSplitTicketManager(false)
            setSplitItemId(null)
          }}
        />
      )}

      {/* Shared Ownership Modal */}
      {activeOrderId && (
        <SharedOwnershipModal
          orderId={activeOrderId}
          locationId={locationId}
          employeeId={employeeId}
          isOpen={showShareOwnership}
          onClose={() => setShowShareOwnership(false)}
        />
      )}
    </div>
  )
}
