'use client'

/**
 * FloorPlanHome — Main floor plan orchestrator component.
 *
 * Composes sub-components for rendering while owning all state and business logic.
 * Sub-components: FloorPlanTableCanvas, FloorPlanMenuView, FloorPlanOrderPanel,
 * FloorPlanEodSummary, and hooks/useFloorPlanSockets.
 *
 * This file should stay under 800 lines (orchestration + layout + callbacks).
 */

import { useEffect, useState, useCallback, useRef, useMemo, lazy, Suspense, useTransition } from 'react'
import { useFloorPlanStore, FloorPlanTable, FloorPlanSection, FloorPlanElement } from './use-floor-plan'
import { TableInfoPanel } from './TableInfoPanel'
import { CategoriesBar } from './CategoriesBar'
const RoomReorderModal = lazy(() => import('./RoomReorderModal').then(m => ({ default: m.RoomReorderModal })))
import { useFloorPlanAutoScale, useFloorPlanDrag } from './hooks'
import { useFloorPlanSockets } from './hooks/useFloorPlanSockets'
import { usePOSLayout } from '@/hooks/usePOSLayout'
import { QuickAccessBar } from '@/components/pos/QuickAccessBar'
import { MenuItemContextMenu } from '@/components/pos/MenuItemContextMenu'
import { ItemDescriptionModal } from '@/components/pos/ItemDescriptionModal'
import { useFloorPlanModals } from '@/hooks/useFloorPlanModals'
const CompVoidModal = lazy(() => import('@/components/orders/CompVoidModal').then(m => ({ default: m.CompVoidModal })))
import { NoteEditModal } from '@/components/orders/NoteEditModal'
import { logger } from '@/lib/logger'
import type { PizzaOrderConfig, MenuItem, CategoryFloorPlan as Category, OpenOrderFloorPlan as OpenOrder, PricingOption } from '@/types'
import type { OrderTypeConfig } from '@/types/order-types'
import { toast } from '@/stores/toast-store'
const SharedOwnershipModal = lazy(() => import('@/components/tips/SharedOwnershipModal'))
import { useOrderStore } from '@/stores/order-store'
import { useActiveOrder } from '@/hooks/useActiveOrder'
import { usePricing } from '@/hooks/usePricing'
import { getActivePricingRules, getBestPricingRuleForItem } from '@/lib/settings'
import type { PricingRule, PricingAdjustment } from '@/lib/settings'
import { useOrderSettings } from '@/hooks/useOrderSettings'
import { useOrderingEngine } from '@/hooks/useOrderingEngine'
import type { EngineMenuItem, EngineModifier, EngineIngredientMod } from '@/hooks/useOrderingEngine'
import { calculateOrderSubtotal, splitSubtotalsByTaxInclusion } from '@/lib/order-calculations'
import { isTempId, fetchAndMergeOrder } from '@/lib/order-utils'
import { useOrderEditing } from '@/hooks/useOrderEditing'
// Sub-components
import { FloorPlanTableCanvas } from './FloorPlanTableCanvas'
import { FloorPlanMenuView } from './FloorPlanMenuView'
import { FloorPlanOrderPanel } from './FloorPlanOrderPanel'
import { FloorPlanEodSummary } from './FloorPlanEodSummary'
import type { InlineOrderItem, ViewMode, QuickOrderType } from './types'
import './styles/floor-plan.css'

// MenuItem, Category, OpenOrder imported from @/types

interface FloorPlanHomeProps {
  locationId: string
  employeeId: string
  onOpenPayment?: (orderId: string) => void
  onOpenCardFirst?: (orderId: string) => void
  onOpenSplitManager?: (orderId: string) => void
  onOpenModifiers?: (item: MenuItem, onComplete: (modifiers: { id: string; name: string; price: number; depth?: number; preModifier?: string | null }[], ingredientModifications?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]) => void, existingModifiers?: { id: string; name: string; price: number; depth?: number; preModifier?: string | null }[], existingIngredientMods?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]) => void
  isEditingFavorites?: boolean
  isEditingCategories?: boolean
  isEditingMenuItems?: boolean
  onRegisterQuickOrderType?: (fn: (orderType: string) => void) => void
  onRegisterTablesClick?: (fn: () => void) => void
  onOpenOrdersCountChange?: (count: number) => void
  defaultGuestCount?: number
  onOpenTimedRental?: (item: MenuItem, onComplete: (price: number, blockMinutes: number) => void) => void
  onOpenPizzaBuilder?: (item: MenuItem, onComplete: (config: PizzaOrderConfig) => void) => void
  onOpenPricingOptionPicker?: (item: MenuItem, onComplete: (option: any) => void) => void
  onOpenComboBuilder?: (item: MenuItem, onComplete: (modifiers: { id: string; name: string; price: number; depth?: number }[]) => void) => void
  orderToLoad?: { id: string; orderNumber: number; tableId?: string; tableName?: string; tabName?: string; orderType: string } | null
  onOrderLoaded?: () => void
  paidOrderId?: string | null
  onPaidOrderCleared?: () => void
  children?: React.ReactNode
  onRegisterDeselectTable?: (fn: () => void) => void
  refreshTrigger?: number
  initialCategories?: Category[]
  initialMenuItems?: MenuItem[]
  initialSnapshot?: {
    tables: FloorPlanTable[]
    sections: FloorPlanSection[]
    elements: FloorPlanElement[]
    openOrdersCount: number
  } | null
  orderTypes?: OrderTypeConfig[]
}

export function FloorPlanHome({
  locationId,
  employeeId,
  onOpenPayment,
  onOpenCardFirst,
  onOpenSplitManager,
  onOpenModifiers,
  isEditingFavorites: isEditingFavoritesProp = false,
  isEditingCategories: isEditingCategoriesProp = false,
  isEditingMenuItems: isEditingMenuItemsProp = false,
  onRegisterQuickOrderType,
  onRegisterTablesClick,
  onOpenOrdersCountChange,
  defaultGuestCount = 4,
  onOpenTimedRental,
  onOpenPizzaBuilder,
  onOpenPricingOptionPicker,
  onOpenComboBuilder,
  orderToLoad,
  onOrderLoaded,
  paidOrderId,
  onPaidOrderCleared,
  children,
  onRegisterDeselectTable,
  refreshTrigger,
  initialCategories,
  initialMenuItems,
  initialSnapshot,
  orderTypes,
}: FloorPlanHomeProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // ===========================
  // STATE
  // ===========================

  const [viewMode, setViewMode] = useState<ViewMode>('tables')
  const [categories, setCategories] = useState<Category[]>(initialCategories || [])
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [allMenuItems, setAllMenuItems] = useState<MenuItem[]>(initialMenuItems || [])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [isCategoryPending, startCategoryTransition] = useTransition()
  const loadingMenuItems = false

  const [pricingRules, setPricingRules] = useState<PricingRule[]>([])
  const [activePricingRules, setActivePricingRules] = useState<PricingRule[]>([])
  const [openOrdersCount, setOpenOrdersCount] = useState(0)
  const [eodSummary, setEodSummary] = useState<{ cancelledDrafts: number; rolledOverOrders: number; tablesReset: number; businessDay: string } | null>(null)
  const [longPressItem, setLongPressItem] = useState<MenuItem | null>(null)
  const [activeTableId, setActiveTableId] = useState<string | null>(null)
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null)
  const [activeOrderNumber, setActiveOrderNumber] = useState<string | null>(null)
  const [activeOrderType, setActiveOrderType] = useState<string | null>(null)
  const [showOrderPanel, setShowOrderPanel] = useState(false)
  const [isSendingOrder, setIsSendingOrder] = useState(false)
  const [guestCount, setGuestCount] = useState(defaultGuestCount)
  const [activeSeatNumber, setActiveSeatNumber] = useState<number | null>(null)
  const [activeSourceTableId, setActiveSourceTableId] = useState<string | null>(null)
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  const [preferredRoomOrder, setPreferredRoomOrder] = useState<string[]>([])
  const [extraSeats, setExtraSeats] = useState<Map<string, number>>(new Map())
  const [quickBarItems, setQuickBarItems] = useState<{ id: string; name: string; price: number; bgColor?: string | null; textColor?: string | null }[]>([])

  // ===========================
  // REFS
  // ===========================

  const activeOrderIdRef = useRef(activeOrderId)
  useEffect(() => { activeOrderIdRef.current = activeOrderId })

  const selectedCategoryIdRef = useRef(selectedCategoryId)
  const allMenuItemsRef = useRef(allMenuItems)
  useEffect(() => {
    selectedCategoryIdRef.current = selectedCategoryId
    allMenuItemsRef.current = allMenuItems
  })

  const tablesRef = useRef<FloorPlanTable[]>([])
  const fixturesRef = useRef<FloorPlanElement[]>([])
  const optimisticGraceRef = useRef<number>(0)
  const autoScaleRef = useRef(1)
  const autoScaleOffsetRef = useRef({ x: 0, y: 0 })

  const snapshotInFlightRef = useRef(false)
  const snapshotPendingCountRef = useRef(0)
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isProcessingSendRef = useRef(false)
  const isSeatAddInFlightRef = useRef(false)
  const isTableSwitchInFlightRef = useRef(false)
  const fetchLoadIdRef = useRef(0)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ===========================
  // DERIVED STATE / STORE SELECTORS
  // ===========================

  const activeOTConfig = orderTypes?.find(ot => ot.slug === (activeOrderType || 'dine_in'))
  const requiresTable = activeOTConfig?.workflowRules?.requireTableSelection ?? (activeOrderType === null || activeOrderType === 'dine_in')
  const tableRequiredButMissing = requiresTable && !activeTableId
  const tableRequiredButMissingRef = useRef(tableRequiredButMissing)
  useEffect(() => { tableRequiredButMissingRef.current = tableRequiredButMissing })

  // Zustand atomic selectors
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

  // Zustand actions
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
  const patchTableOrder = useFloorPlanStore(s => s.patchTableOrder)
  const removeTableOrder = useFloorPlanStore(s => s.removeTableOrder)
  const addTableOrder = useFloorPlanStore(s => s.addTableOrder)
  const updateSingleTableStatus = useFloorPlanStore(s => s.updateSingleTableStatus)
  const addSeatToTable = useFloorPlanStore(s => s.addSeatToTable)

  // ===========================
  // HOOKS
  // ===========================

  const {
    compVoidItem, setCompVoidItem,
    showTableOptions, setShowTableOptions,
    showShareOwnership, setShowShareOwnership,
    contextMenu, setContextMenu, closeContextMenu,
    showRoomReorderModal, setShowRoomReorderModal,
  } = useFloorPlanModals()

  const activeOrder = useActiveOrder({ locationId, employeeId })
  useOrderEditing(activeOrderId, locationId)

  const {
    containerSize,
    tableBounds,
    autoScale,
    autoScaleOffset,
  } = useFloorPlanAutoScale({ containerRef, tables, elements, selectedSectionId })

  const {
    quickBar, quickBarEnabled, toggleQuickBar, addToQuickBar, removeFromQuickBar, isInQuickBar,
    menuItemColors, categoryColors, canCustomize, resetAllCategoryColors, resetAllMenuItemStyles,
    layout, updateSetting,
  } = usePOSLayout({ employeeId, locationId, permissions: { posLayout: ['customize_personal'] } })

  const engine = useOrderingEngine({
    locationId, employeeId,
    seatNumber: activeSeatNumber ?? undefined,
    sourceTableId: activeSourceTableId ?? undefined,
    defaultOrderType: activeOrderType || 'dine_in',
    tableId: activeTableId ?? undefined,
    guestCount,
    onOpenModifiers: onOpenModifiers as any,
    onOpenPizzaBuilder: onOpenPizzaBuilder as any,
    onOpenTimedRental: onOpenTimedRental as any,
    onOpenPricingOptionPicker: onOpenPricingOptionPicker as any,
    onOpenComboBuilder: onOpenComboBuilder as any,
  })

  const { taxInclusiveLiquor: settingsTaxIncLiquor, taxInclusiveFood: settingsTaxIncFood } = useOrderSettings()

  // ===========================
  // CLEAR ORDER PANEL HELPER
  // ===========================

  const clearOrderPanel = useCallback(() => {
    setActiveOrderId(null)
    setActiveOrderNumber(null)
    setActiveOrderType(null)
    setActiveSeatNumber(null)
    setActiveSourceTableId(null)
    useOrderStore.getState().clearOrder()
    useFloorPlanStore.getState().clearSelectedSeat()
    setActiveTableId(null)
    setShowOrderPanel(false)
  }, [])

  // ===========================
  // INLINE ORDER ITEMS (memoized from store)
  // ===========================

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
      splitLabel: item.splitLabel,
    }))
  }, [activeOrder.items])

  const seatsWithItems = useMemo(() => {
    const set = new Set<number>()
    for (const item of inlineOrderItems) {
      if (item.seatNumber && item.status !== 'voided') set.add(item.seatNumber)
    }
    return set
  }, [inlineOrderItems])

  // ===========================
  // PRICING
  // ===========================

  const orderSubtotal = calculateOrderSubtotal(inlineOrderItems)
  const taxSplit = useMemo(() => splitSubtotalsByTaxInclusion(inlineOrderItems, {
    taxInclusiveLiquor: settingsTaxIncLiquor,
    taxInclusiveFood: settingsTaxIncFood,
  }), [inlineOrderItems, settingsTaxIncLiquor, settingsTaxIncFood])

  const paymentMode = 'card' as const
  const pricing = usePricing({
    subtotal: orderSubtotal,
    inclusiveSubtotal: taxSplit.inclusiveSubtotal,
    exclusiveSubtotal: taxSplit.exclusiveSubtotal,
    discountTotal: 0,
    tipTotal: 0,
    paymentMethod: paymentMode || 'card',
  })
  const orderTotal = pricing.total

  const pricingAdjustmentMap = useMemo(() => {
    const map = new Map<string, PricingAdjustment | null>()
    if (activePricingRules.length === 0) return map
    for (const item of menuItems) {
      map.set(item.id, getBestPricingRuleForItem(activePricingRules, item.id, item.categoryId, item.price))
    }
    return map
  }, [activePricingRules, menuItems])

  // ===========================
  // TABLE / ORDER DERIVED DATA
  // ===========================

  const activeTable = activeTableId ? tables.find(t => t.id === activeTableId) || null : null

  const activeOrderStatusBadges = useMemo(() => {
    if (!activeTableId) return undefined
    const at = tables.find(t => t.id === activeTableId)
    return {
      hasDelay: !!(activeOrder.pendingDelay && activeOrder.pendingDelay > 0),
      hasHeld: inlineOrderItems.some(i => !i.sentToKitchen && i.isHeld),
      hasCourses: activeOrder.coursingEnabled,
      delayMinutes: activeOrder.pendingDelay ?? undefined,
      isBottleService: !!(at?.currentOrder?.isBottleService),
      bottleServiceTierName: at?.currentOrder?.bottleServiceTierName ?? null,
      bottleServiceTierColor: at?.currentOrder?.bottleServiceTierColor ?? null,
      bottleServiceMinSpend: at?.currentOrder?.bottleServiceMinSpend ?? null,
      bottleServiceCurrentSpend: at?.currentOrder?.bottleServiceCurrentSpend ?? null,
      bottleServiceReAuthNeeded: at?.currentOrder?.bottleServiceReAuthNeeded ?? false,
    }
  }, [activeTableId, activeOrder.pendingDelay, activeOrder.coursingEnabled, inlineOrderItems, tables])

  const activeTableData = activeTableId ? tables.find((t: any) => t.id === activeTableId) : null
  const hasSplitChips = activeTableData?.currentOrder?.status === 'split' &&
    (activeTableData?.currentOrder?.splitOrders?.length ?? 0) > 0
  const splitChips = hasSplitChips
    ? activeTableData!.currentOrder!.splitOrders!.map((s: any, idx: number) => ({
        id: s.id as string,
        label: (s.displayNumber || `Check ${idx + 1}`) as string,
        isPaid: !!(s.isPaid || s.status === 'paid'),
        total: Number(s.total ?? 0),
      }))
    : []

  const isEditingFavorites = isEditingFavoritesProp
  const isEditingCategories = isEditingCategoriesProp
  const isEditingMenuItems = isEditingMenuItemsProp

  // ===========================
  // SEAT HELPERS
  // ===========================

  const getTableSeatCount = useCallback((t: FloorPlanTable): number => {
    const seatsLen = t.seats?.length || 0
    const cap = t.capacity || 0
    const extra = extraSeats.get(t.id) || 0
    return Math.max(seatsLen, cap) + extra
  }, [extraSeats])

  const getTotalSeats = useCallback((table: FloorPlanTable | null): number => {
    if (!table) return 0
    return getTableSeatCount(table)
  }, [getTableSeatCount])

  // ===========================
  // SORTED SECTIONS
  // ===========================

  const sortedSections = useMemo(() => {
    if (preferredRoomOrder.length === 0) return sections
    return [...sections].sort((a, b) => {
      const aIndex = preferredRoomOrder.indexOf(a.id)
      const bIndex = preferredRoomOrder.indexOf(b.id)
      if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex
      if (aIndex >= 0) return -1
      if (bIndex >= 0) return 1
      return 0
    })
  }, [sections, preferredRoomOrder])

  // ===========================
  // DATA LOADING
  // ===========================

  const restoreExtraSeatsFromTables = useCallback((tables: FloorPlanTable[]) => {
    const newExtraSeats = new Map<string, number>()
    for (const table of tables) {
      if (table.currentOrder) {
        const physicalSeats = Math.max(table.seats?.length || 0, table.capacity || 0)
        const orderGuests = table.currentOrder.guestCount || 0
        if (orderGuests > physicalSeats) {
          newExtraSeats.set(table.id, orderGuests - physicalSeats)
        }
      }
    }
    if (newExtraSeats.size > 0) {
      setExtraSeats(prev => {
        const merged = new Map(prev)
        for (const [id, count] of newExtraSeats) {
          merged.set(id, count)
        }
        return merged
      })
    }
  }, [])

  const loadFloorPlanData = async (showLoading = true) => {
    if (snapshotInFlightRef.current) {
      snapshotPendingCountRef.current++
      return
    }
    if (snapshotTimerRef.current) {
      clearTimeout(snapshotTimerRef.current)
      snapshotTimerRef.current = null
    }
    snapshotInFlightRef.current = true
    snapshotPendingCountRef.current = 0
    if (showLoading) setLoading(true)
    try {
      const res = await fetch(`/api/floorplan/snapshot?locationId=${locationId}`)
      if (res.ok) {
        const snapshot = await res.json()
        const payload = snapshot.data ?? snapshot
        setTables(payload.tables || [])
        setSections(payload.sections || [])
        setElements(payload.elements || [])
        setOpenOrdersCount(payload.openOrdersCount ?? 0)
        restoreExtraSeatsFromTables(payload.tables || [])
      }
    } catch (error) {
      console.error('[FloorPlanHome] Snapshot load error:', error)
    } finally {
      snapshotInFlightRef.current = false
      if (showLoading) setLoading(false)
      if (snapshotPendingCountRef.current > 0) {
        const delay = snapshotPendingCountRef.current > 1 ? 0 : 150
        snapshotPendingCountRef.current = 0
        snapshotTimerRef.current = setTimeout(() => {
          loadFloorPlanData(false)
        }, delay)
      }
    }
  }

  const loadCategories = async () => {
    try {
      const res = await fetch(`/api/menu?locationId=${locationId}`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setCategories(data.data?.categories || [])
        setAllMenuItems(data.data?.items || [])
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

  // FIX 4: Refs for heartbeat callbacks
  const callbacksRef = useRef({
    clearExpiredFlashes,
    loadFloorPlanData: null as (() => Promise<void>) | null,
  })
  useEffect(() => {
    callbacksRef.current = {
      clearExpiredFlashes,
      loadFloorPlanData: () => loadFloorPlanData(false),
    }
  })

  // ===========================
  // SOCKET HOOK
  // ===========================

  const { socket, isConnected } = useFloorPlanSockets({
    loadFloorPlanData: () => loadFloorPlanData(false),
    clearOrderPanel,
    activeOrderIdRef,
    tablesRef,
    optimisticGraceRef,
    addTableOrder,
    removeTableOrder,
    patchTableOrder,
    updateSingleTableStatus,
    setEodSummary,
    setPricingRules,
  })

  // ===========================
  // EFFECTS
  // ===========================

  // Sync refs
  useEffect(() => {
    tablesRef.current = tables
    fixturesRef.current = elements
  })
  useEffect(() => {
    autoScaleRef.current = autoScale
    autoScaleOffsetRef.current = autoScaleOffset
  })

  // Sync parent menu data
  useEffect(() => {
    if (initialCategories && initialCategories.length > 0) {
      setCategories(initialCategories)
    }
  }, [initialCategories])

  useEffect(() => {
    if (initialMenuItems && initialMenuItems.length > 0) {
      setAllMenuItems(initialMenuItems)
      if (selectedCategoryIdRef.current) {
        const selectedCat = categories.find(c => c.id === selectedCategoryIdRef.current)
        if (selectedCat?.categoryType === 'pizza') {
          const pizzaCatIds = new Set(categories.filter(c => c.categoryType === 'pizza').map(c => c.id))
          setMenuItems(initialMenuItems.filter(item =>
            item.categoryId === selectedCategoryIdRef.current ||
            (item.itemType === 'pizza' && (!item.categoryId || pizzaCatIds.has(item.categoryId)))
          ))
        } else {
          setMenuItems(initialMenuItems.filter(
            item => item.categoryId === selectedCategoryIdRef.current
          ))
        }
      }
    }
  }, [initialMenuItems, categories])

  // Open orders count reporting
  useEffect(() => {
    onOpenOrdersCountChange?.(openOrdersCount)
  }, [openOrdersCount, onOpenOrdersCountChange])

  // Sync selectedSeat from store -> activeSeatNumber
  useEffect(() => {
    if (selectedSeat && selectedSeat.tableId === activeTableId) {
      setActiveSeatNumber(selectedSeat.seatNumber)
      setActiveSourceTableId(selectedSeat.tableId)
    } else {
      setActiveSeatNumber(null)
    }
  }, [selectedSeat, activeTableId])

  // Register deselect function
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

  // Register tables click handler
  useEffect(() => {
    if (onRegisterTablesClick) {
      onRegisterTablesClick(() => {
        setViewMode('tables')
        setSelectedCategoryId(null)
      })
    }
  }, [onRegisterTablesClick])

  // Restore active table from store on mount
  useEffect(() => {
    const currentOrder = useOrderStore.getState().currentOrder
    if (currentOrder?.tableId && currentOrder.items?.length > 0 && !activeTableId) {
      setActiveTableId(currentOrder.tableId)
      setActiveOrderId(currentOrder.id || null)
      setActiveOrderNumber(currentOrder.orderNumber ? String(currentOrder.orderNumber) : null)
      setActiveOrderType(currentOrder.orderType || null)
      setShowOrderPanel(true)
    }
  }, [])

  // Initialize sections
  useEffect(() => {
    if (sortedSections.length > 0 && selectedSectionId === null) {
      setSelectedSectionId(sortedSections[0].id)
    }
  }, [sortedSections, selectedSectionId])

  // Load employee preferences
  useEffect(() => {
    const loadPreferences = async () => {
      if (!employeeId) return
      try {
        const res = await fetch(`/api/employees/${employeeId}/preferences`)
        if (res.ok) {
          const data = await res.json()
          if (data.data?.preferences?.preferredRoomOrder) {
            setPreferredRoomOrder(data.data.preferences.preferredRoomOrder)
          }
        }
      } catch { /* Network error — room preferences will use defaults */ }
    }
    loadPreferences()
  }, [employeeId])

  // Pricing rules: load from settings on mount, recompute every 60s
  useEffect(() => {
    let cancelled = false
    fetch('/api/settings')
      .then(res => res.json())
      .then(raw => {
        if (cancelled) return
        const data = raw.data ?? raw
        const s = data.settings || data
        const rules: PricingRule[] = s.pricingRules ?? []
        setPricingRules(rules)
        setActivePricingRules(getActivePricingRules(rules))
      })
      .catch(err => console.warn('fire-and-forget failed in floor-plan.FloorPlanHome:', err))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    setActivePricingRules(getActivePricingRules(pricingRules))
    const interval = setInterval(() => {
      setActivePricingRules(getActivePricingRules(pricingRules))
    }, 60000)
    return () => clearInterval(interval)
  }, [pricingRules])

  // 1s heartbeat for UI timers
  useEffect(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    heartbeatRef.current = setInterval(() => {
      callbacksRef.current.clearExpiredFlashes()
    }, 1000)
    return () => {
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null }
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current)
    }
  }, [])

  // Load initial data
  useEffect(() => {
    if (initialSnapshot && typeof initialSnapshot === 'object') {
      setTables(initialSnapshot.tables || [])
      setSections(initialSnapshot.sections || [])
      setElements(initialSnapshot.elements || [])
      setOpenOrdersCount(initialSnapshot.openOrdersCount ?? 0)
      restoreExtraSeatsFromTables(initialSnapshot.tables || [])
      setLoading(false)
    } else if (initialSnapshot === null) {
      loadFloorPlanData()
    }
    if (initialCategories === undefined) {
      loadCategories()
    }
  }, [locationId, initialSnapshot])

  // Parent-triggered refresh
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      const timer = setTimeout(() => {
        loadFloorPlanData(false)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [refreshTrigger])

  // Instant local table status when items added
  const currentOrderItemCount = useOrderStore(s => s.currentOrder?.items?.length ?? 0)
  useEffect(() => {
    if (activeTableId && currentOrderItemCount > 0) {
      updateTableStatus(activeTableId, 'occupied')
    }
  }, [activeTableId, currentOrderItemCount, updateTableStatus])

  // Load order from orderToLoad prop
  useEffect(() => {
    if (!orderToLoad) return
    const loadOrder = async () => {
      try {
        setActiveOrderId(orderToLoad.id)
        setActiveOrderNumber(String(orderToLoad.orderNumber))
        setActiveTableId(orderToLoad.tableId || null)
        setActiveOrderType(orderToLoad.orderType || 'bar_tab')
        setShowOrderPanel(true)

        const merged = await fetchAndMergeOrder(orderToLoad.id)
        if (!merged) {
          console.error('[FloorPlanHome] Failed to load order:', orderToLoad.id)
          toast.error('Failed to load order. Please try again.')
          return
        }
        const data = merged.raw
        const store = useOrderStore.getState()
        store.loadOrder({
          id: orderToLoad.id,
          orderNumber: data.orderNumber ?? orderToLoad.orderNumber,
          orderType: data.orderType || orderToLoad.orderType || 'dine_in',
          tableId: data.tableId || orderToLoad.tableId,
          tableName: data.tableName || orderToLoad.tableName,
          tabName: data.tabName,
          guestCount: data.guestCount || 1,
          status: data.status,
          items: merged.items,
          subtotal: merged.subtotal,
          discountTotal: Number(data.discountTotal) || 0,
          taxTotal: merged.taxTotal,
          tipTotal: merged.tipTotal,
          total: merged.total,
        })
        onOrderLoaded?.()
      } catch (error) {
        console.error('[FloorPlanHome] Failed to load order:', error)
        toast.error('Failed to load order. Please try again.')
      }
    }
    loadOrder()
  }, [orderToLoad, onOrderLoaded])

  // Clear order when paid
  useEffect(() => {
    if (!paidOrderId) return
    const storeOrderId = useOrderStore.getState().currentOrder?.id
    const isPaidOrderActive = paidOrderId === activeOrderId || paidOrderId === storeOrderId
    if (isPaidOrderActive) {
      if (activeTableId) {
        setExtraSeats(prev => { const next = new Map(prev); next.delete(activeTableId); return next })
      }
      clearOrderPanel()
      setSelectedCategoryId(null)
      setViewMode('tables')
    }
    loadFloorPlanData()
    onPaidOrderCleared?.()
  }, [paidOrderId, activeOrderId, activeTableId, tables, onPaidOrderCleared, clearOrderPanel])

  // Keyboard shortcut: number keys for quantity
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (viewMode !== 'menu') return
      const num = parseInt(e.key, 10)
      if (num >= 1 && num <= 5) {
        engine.setQuantityMultiplier(num)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [viewMode, engine.setQuantityMultiplier])

  // Quick bar items loading
  useEffect(() => {
    if (quickBar.length === 0) { setQuickBarItems([]); return }
    let cancelled = false
    const loadQuickBarItems = async () => {
      try {
        const res = await fetch('/api/menu/items/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemIds: quickBar }),
        })
        if (!cancelled && res.ok) {
          const { data: { items } } = await res.json()
          setQuickBarItems(
            (items as { id: string; name: string; price: number }[]).map(item => ({
              id: item.id, name: item.name, price: item.price,
              bgColor: menuItemColors[item.id]?.bgColor || null,
              textColor: menuItemColors[item.id]?.textColor || null,
            }))
          )
        }
      } catch { /* Quick bar load failed — non-critical */ }
    }
    loadQuickBarItems()
    return () => { cancelled = true }
  }, [quickBar, menuItemColors])

  // ===========================
  // CALLBACKS
  // ===========================

  const handleSaveRoomOrder = useCallback(async (orderedRoomIds: string[]) => {
    if (!employeeId) return
    try {
      const res = await fetch(`/api/employees/${employeeId}/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredRoomOrder: orderedRoomIds }),
      })
      if (res.ok) { setPreferredRoomOrder(orderedRoomIds); toast.success('Room order saved') }
      else { toast.error('Failed to save room order') }
    } catch (error) { console.error('Failed to save room order:', error); toast.error('Failed to save room order') }
  }, [employeeId])

  const handleCategoryClick = useCallback((categoryId: string | null) => {
    if (tableRequiredButMissingRef.current) { toast.warning('Tap a table on the floor plan to start an order'); return }
    startCategoryTransition(() => {
      if (!categoryId) { setSelectedCategoryId(null); setViewMode('tables'); setMenuItems([]); return }
      if (categoryId === selectedCategoryIdRef.current) { setSelectedCategoryId(null); setViewMode('tables'); setMenuItems([]); return }
      setSelectedCategoryId(categoryId)
      setViewMode('menu')
      const selectedCat = categories.find(c => c.id === categoryId)
      if (selectedCat?.categoryType === 'pizza') {
        const pizzaCatIds = new Set(categories.filter(c => c.categoryType === 'pizza').map(c => c.id))
        setMenuItems(allMenuItemsRef.current.filter(item =>
          item.categoryId === categoryId ||
          (item.itemType === 'pizza' && (!item.categoryId || pizzaCatIds.has(item.categoryId)))
        ))
      } else {
        setMenuItems(allMenuItemsRef.current.filter(item => item.categoryId === categoryId))
      }
    })
  }, [categories])

  const handleResetTable = useCallback((tableId: string) => {
    void fetch(`/api/orders/_/seating`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'RESET_TABLE', tableId }),
    }).catch(err => console.warn('fire-and-forget failed in floor-plan.FloorPlanHome:', err))
    setExtraSeats(prev => { if (!prev.has(tableId)) return prev; const next = new Map(prev); next.delete(tableId); return next })
    setActiveOrderId(null); setActiveOrderNumber(null); setActiveTableId(null); setShowOrderPanel(false)
    useOrderStore.getState().clearOrder()
  }, [])

  const handleTableTap = useCallback(async (table: FloorPlanTable) => {
    if (isTableSwitchInFlightRef.current) return
    isTableSwitchInFlightRef.current = true
    try {
      if (selectedSeat) { clearSelectedSeat() }
      if (activeTableId && activeTableId !== table.id) {
        const store = useOrderStore.getState()
        const prevOrderId = activeOrderId || store.currentOrder?.id
        const hasItems = (store.currentOrder?.items.length ?? 0) > 0
        if (!hasItems && prevOrderId && !isTempId(prevOrderId)) {
          void fetch(`/api/orders/${prevOrderId}/seating`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'CLEANUP' }),
          }).catch(err => console.warn('fire-and-forget failed in floor-plan.FloorPlanHome:', err))
        }
        setExtraSeats(prev => { if (!prev.has(activeTableId)) return prev; const next = new Map(prev); next.delete(activeTableId); return next })
      }
      const totalSeats = getTotalSeats(table)
      const primaryTable = table
      logger.log(`[handleTableTap] Setting guest count to ${totalSeats} for table ${primaryTable.name} (capacity=${primaryTable.capacity})`)
      setActiveTableId(primaryTable.id); setActiveOrderType('dine_in'); setShowOrderPanel(true)
      setActiveSeatNumber(null); setActiveSourceTableId(null); setGuestCount(totalSeats)
      const orderStatus = primaryTable.currentOrder?.status
      const isActiveOrder = primaryTable.currentOrder &&
        ['open', 'draft', 'sent', 'in_progress', 'split'].includes(orderStatus || '')
      if (isActiveOrder) {
        const currentOrder = primaryTable.currentOrder!
        setActiveOrderId(currentOrder.id); setActiveOrderNumber(String(currentOrder.orderNumber))
        const store = useOrderStore.getState()
        store.loadOrder({
          id: currentOrder.id, orderNumber: currentOrder.orderNumber, orderType: 'dine_in',
          tableId: primaryTable.id, guestCount: currentOrder.guestCount || totalSeats,
          status: orderStatus, items: [], subtotal: 0, taxTotal: 0, total: currentOrder.total || 0,
        })
        const capturedLoadId = ++fetchLoadIdRef.current
        fetchAndMergeOrder(currentOrder.id, { knownStatus: orderStatus })
          .then(merged => {
            if (!merged) return
            if (fetchLoadIdRef.current !== capturedLoadId) return
            const data = merged.raw
            const store = useOrderStore.getState()
            store.loadOrder({
              id: currentOrder.id, orderNumber: data.orderNumber ?? currentOrder.orderNumber,
              orderType: data.orderType || 'dine_in', tableId: data.tableId || primaryTable.id,
              tabName: data.tabName, guestCount: data.guestCount || totalSeats, status: data.status,
              items: merged.items, subtotal: merged.subtotal, taxTotal: merged.taxTotal,
              tipTotal: merged.tipTotal, total: merged.total, notes: data.notes,
              reopenedAt: data.reopenedAt, reopenReason: data.reopenReason,
            })
            const maxSeatInItems = (data.items || []).reduce(
              (max: number, item: { seatNumber?: number | null }) => Math.max(max, item.seatNumber || 0), 0
            )
            const orderSeatCount = Math.max(maxSeatInItems,
              data.baseSeatCount ? (data.baseSeatCount + (data.extraSeatCount || 0)) : 0)
            if (orderSeatCount > totalSeats) {
              setExtraSeats(prev => { const next = new Map(prev); next.set(primaryTable.id, orderSeatCount - totalSeats); return next })
            }
          })
          .catch(error => console.error('[FloorPlanHome] Failed to load order:', error))
      } else {
        setExtraSeats(prev => { if (!prev.has(primaryTable.id)) return prev; const next = new Map(prev); next.delete(primaryTable.id); return next })
        const isSameTable = activeTableId === primaryTable.id
        const store = useOrderStore.getState()
        const hasUnsavedItems = (store.currentOrder?.items.length ?? 0) > 0
        const isAssigningTableToFreeItems = !activeTableId && hasUnsavedItems
        if (isAssigningTableToFreeItems) {
          store.updateOrderType('dine_in', { locationId, tableId: primaryTable.id, guestCount: totalSeats })
        } else if (!isSameTable) {
          setActiveOrderId(null); setActiveOrderNumber(null); activeOrder.clearOrder()
          store.startOrder('dine_in', { locationId, tableId: primaryTable.id, guestCount: totalSeats })
        }
      }
    } finally {
      isTableSwitchInFlightRef.current = false
    }
  }, [selectedSeat, clearSelectedSeat, getTotalSeats, activeTableId, activeOrderId])

  const handleQuickOrderType = useCallback((orderType: QuickOrderType) => {
    const store = useOrderStore.getState()
    const hasItems = (store.currentOrder?.items.length ?? 0) > 0
    if (hasItems) { store.updateOrderType(orderType) }
    else { activeOrder.clearOrder(); store.startOrder(orderType, { locationId }) }
    setActiveTableId(null); setActiveOrderType(orderType); setActiveOrderId(null); setActiveOrderNumber(null); setShowOrderPanel(true)
  }, [])

  useEffect(() => {
    if (onRegisterQuickOrderType) { onRegisterQuickOrderType(handleQuickOrderType) }
  }, [onRegisterQuickOrderType, handleQuickOrderType])

  const handleMenuItemTap = engine.handleMenuItemTap

  const handleQuickPickTap = useCallback((item: MenuItem, option: PricingOption) => {
    if (tableRequiredButMissingRef.current) { toast.warning('Tap a table on the floor plan to start an order'); return }
    const isVariant = option.price !== null
    const itemName = isVariant ? `${item.name} (${option.label})` : item.name
    const itemPrice = isVariant ? option.price! : item.price
    const pricingOptionLabel = isVariant ? undefined : option.label
    if (item.hasModifiers || item.alwaysOpenModifiers) {
      engine.handleMenuItemTap({ ...item, name: itemName, price: itemPrice, hasPricingOptions: false } as EngineMenuItem)
    } else {
      engine.addItemDirectly({ menuItemId: item.id, name: itemName, price: itemPrice, categoryType: item.categoryType, pricingOptionId: option.id, pricingOptionLabel })
    }
  }, [engine])

  const handleQuickBarItemClick = useCallback(async (itemId: string) => {
    if (tableRequiredButMissingRef.current) { toast.warning('Tap a table on the floor plan to start an order'); return }
    const qbItem = quickBarItems.find(i => i.id === itemId)
    if (!qbItem) return
    try {
      const res = await fetch(`/api/menu/items/${itemId}`)
      if (!res.ok) return
      const resp = await res.json()
      const item = resp.data?.item || resp.item
      handleMenuItemTap({
        id: item.id, name: item.name, price: Number(item.price), categoryId: item.categoryId,
        categoryType: item.categoryType, hasModifiers: item.modifierGroups?.length > 0,
        itemType: item.itemType, isPizza: item.isPizza,
      } as EngineMenuItem)
    } catch (error) { console.error('[FloorPlanHome] Quick bar item load error:', error) }
  }, [quickBarItems, handleMenuItemTap])

  const handleMenuItemContextMenu = useCallback((e: React.MouseEvent, item: MenuItem) => {
    e.preventDefault(); e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, item })
  }, [])

  const handleMenuItemLongPress = useCallback((item: MenuItem) => { setLongPressItem(item) }, [])

  const handleItemDescriptionUpdated = useCallback(() => { void loadCategories() }, [])

  const handleOrderItemTap = useCallback((item: InlineOrderItem) => {
    if (item.sentToKitchen) return
    const menuItem = menuItems.find(m => m.id === item.menuItemId)
    if (!menuItem) return
    engine.handleEditItemModifiers(item.id, menuItem as EngineMenuItem, item.modifiers as EngineModifier[], item.ingredientModifications as EngineIngredientMod[])
  }, [menuItems, engine])

  const handleSaveNotes = useCallback(async (note: string) => {
    if (activeOrder.noteEditTarget?.itemId) { await activeOrder.saveNote(activeOrder.noteEditTarget.itemId, note) }
    activeOrder.closeNoteEditor()
  }, [activeOrder.noteEditTarget, activeOrder.saveNote, activeOrder.closeNoteEditor])

  const handleAddSeat = useCallback(async (tableId?: string) => {
    if (isSeatAddInFlightRef.current) return
    isSeatAddInFlightRef.current = true
    try {
      const targetTableId = tableId || activeTable?.id
      if (!targetTableId) { toast.error('No table selected'); return }
      const resolvedOrderId = activeOrderId || useOrderStore.getState().currentOrder?.id || null
      const isSavedOrder = resolvedOrderId && !resolvedOrderId.startsWith('temp-')
      if (isSavedOrder) {
        const response = await fetch(`/api/orders/${resolvedOrderId}/seating`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'INSERT', position: getTotalSeats(activeTable) + 1 }),
        })
        if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Failed to add seat') }
        const resultResp = await response.json()
        const result = resultResp.data || resultResp
        toast.success(`Seat ${result.position} added`)
        if (result.warning === 'high_seat_count') { toast.info(`This table now has ${result.newTotalSeats} seats`) }
        if (activeTable) {
          const existingSeats = activeTable.seats || []
          const newSeatNumber = existingSeats.length + 1
          const orbitRadius = Math.max(activeTable.width, activeTable.height) / 2 + 20
          const angle = (newSeatNumber - 1) * (360 / (existingSeats.length + 1))
          const radians = (angle - 90) * Math.PI / 180
          addSeatToTable(targetTableId, {
            id: `temp-seat-${Date.now()}`, label: String(newSeatNumber), seatNumber: newSeatNumber,
            relativeX: Math.round(orbitRadius * Math.cos(radians)),
            relativeY: Math.round(orbitRadius * Math.sin(radians)),
            angle: Math.round(angle), seatType: 'standard', isTemporary: true,
          })
        }
      } else {
        setExtraSeats(prev => { const next = new Map(prev); const current = next.get(targetTableId) || 0; next.set(targetTableId, current + 1); return next })
        const newSeatNum = getTotalSeats(activeTable!) + 1
        toast.success(`Seat ${newSeatNum} added`)
      }
    } catch (err) {
      console.error('[FloorPlanHome] Failed to add seat:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to add seat')
    } finally { isSeatAddInFlightRef.current = false }
  }, [activeOrderId, activeTable, getTotalSeats, addSeatToTable])

  const handleSaveModifierChanges = useCallback(async (itemId: string, newModifiers: { id: string; name: string; price: number }[]) => {
    if (!activeOrderId) return
    try {
      const response = await fetch(`/api/orders/${activeOrderId}/items/${itemId}/modifiers`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modifiers: newModifiers }),
      })
      if (!response.ok) { const data = await response.json(); toast.error(data.error || 'Failed to update modifiers'); return }
      const store = useOrderStore.getState()
      const existingItem = store.currentOrder?.items.find(i => i.id === itemId)
      store.updateItem(itemId, {
        modifiers: newModifiers.map(m => ({ id: m.id, name: m.name, price: Number(m.price), depth: 0, preModifier: null, spiritTier: null, linkedBottleProductId: null, parentModifierId: null })),
        resendCount: (existingItem?.resendCount || 0) + 1,
      })
      toast.success('Modifiers updated')
    } catch (error) { console.error('Failed to update modifiers:', error); toast.error('Connection error. Please try again.') }
  }, [activeOrderId])

  const handleEditSentItemModifiers = useCallback((item: InlineOrderItem) => {
    const menuItem = menuItems.find(mi => mi.id === item.menuItemId)
    if (!menuItem) return
    if (onOpenModifiers) {
      onOpenModifiers(menuItem, (newModifiers, ingredientMods) => {
        handleSaveModifierChanges(item.id, newModifiers)
        if (ingredientMods) { useOrderStore.getState().updateItem(item.id, { ingredientModifications: ingredientMods as any }) }
      }, item.modifiers, item.ingredientModifications as any)
    }
  }, [menuItems, onOpenModifiers, handleSaveModifierChanges])

  const handleOpenCompVoid = useCallback((item: InlineOrderItem) => {
    setCompVoidItem({
      id: item.id, name: item.name, price: item.price, quantity: item.quantity,
      modifiers: (item.modifiers || []).map(m => ({
        id: (m.id || m.modifierId) ?? '', modifierId: m.modifierId, name: m.name, price: Number(m.price),
        depth: m.depth ?? 0, preModifier: m.preModifier ?? null, spiritTier: m.spiritTier ?? null,
        linkedBottleProductId: m.linkedBottleProductId ?? null, parentModifierId: m.parentModifierId ?? null,
      })),
      status: item.status,
    })
  }, [])

  const handleSendToKitchen = useCallback(async () => {
    if (isProcessingSendRef.current || inlineOrderItems.length === 0) return
    const unsavedItems = inlineOrderItems.filter(item => !item.sentToKitchen && !item.isHeld)
    if (unsavedItems.length === 0) return
    isProcessingSendRef.current = true; setIsSendingOrder(true)
    try {
      await activeOrder.handleSendToKitchen(employeeId)
      const store = useOrderStore.getState()
      if (store.currentOrder?.id) {
        setActiveOrderId(store.currentOrder.id)
        if (store.currentOrder.orderNumber) { setActiveOrderNumber(String(store.currentOrder.orderNumber)) }
      }
      if (activeTableId) { setExtraSeats(prev => { const next = new Map(prev); next.delete(activeTableId); return next }) }
      optimisticGraceRef.current = Date.now() + 3000
      const sentOrderId = store.currentOrder?.id
      const sentOrderNumber = store.currentOrder?.orderNumber
      if (activeTableId && sentOrderId) {
        addTableOrder(activeTableId, {
          id: sentOrderId, orderNumber: sentOrderNumber || 0, guestCount: inlineOrderItems.length,
          total: store.currentOrder?.subtotal || 0, openedAt: new Date().toISOString(),
          server: employeeId || '', status: 'sent',
        })
      } else if (activeTableId) { updateSingleTableStatus(activeTableId, 'occupied') }
      clearOrderPanel()
      loadFloorPlanData(false).catch(err => console.warn('floor plan data load failed:', err))
    } catch (error) { console.error('[FloorPlanHome] Failed to send order:', error) }
    finally { isProcessingSendRef.current = false; setIsSendingOrder(false) }
  }, [inlineOrderItems, activeOrder.handleSendToKitchen, employeeId, activeTableId, addTableOrder, updateSingleTableStatus, clearOrderPanel])

  const handleCloseOrder = useCallback(async () => {
    if (!activeOrderId) return
    try {
      const res = await fetch(`/api/orders/${activeOrderId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      if (!res.ok) { const err = await res.json().catch(() => ({})); toast.error(err.error || 'Failed to close order'); return }
      toast.success('Order closed')
    } catch (e) { toast.error('Failed to close order — check connection'); return }
    activeOrder.closeNoteEditor(); setGuestCount(defaultGuestCount); clearOrderPanel(); loadFloorPlanData()
  }, [activeOrderId, defaultGuestCount, activeOrder, loadFloorPlanData, clearOrderPanel])

  const handleCloseOrderPanel = useCallback(() => {
    const store = useOrderStore.getState()
    const orderId = activeOrderId || store.currentOrder?.id
    const hasItems = (store.currentOrder?.items.length ?? 0) > 0
    if (!hasItems && orderId && !isTempId(orderId)) {
      const cleanup = () => fetch(`/api/orders/${orderId}/seating`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'CLEANUP' }),
      })
      void cleanup().catch(err => {
        console.warn('floor plan cleanup failed, retrying:', err)
        setTimeout(() => void cleanup().catch(err2 => console.warn('floor plan cleanup retry failed:', err2)), 1000)
      })
    }
    if (activeTableId) { setExtraSeats(prev => { if (!prev.has(activeTableId)) return prev; const next = new Map(prev); next.delete(activeTableId); return next }) }
    activeOrder.closeNoteEditor(); setGuestCount(defaultGuestCount); clearOrderPanel()
  }, [defaultGuestCount, activeTableId, activeOrderId, clearOrderPanel])

  const handleUpdateStatus = useCallback(async (tableId: string, status: string) => {
    try {
      await fetch(`/api/tables/${tableId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      loadFloorPlanData()
    } catch (error) { console.error('Failed to update status:', error) }
  }, [])

  const handleSeatTap = useCallback(async (tableId: string, seatNumber: number) => {
    const isAlreadySelected = selectedSeat?.tableId === tableId && selectedSeat?.seatNumber === seatNumber
    if (isAlreadySelected) { clearSelectedSeat(); setActiveSeatNumber(null); setActiveSourceTableId(null); return }
    const table = tablesRef.current.find(t => t.id === tableId)
    if (!table) return
    if (activeTableId !== tableId) { await handleTableTap(table) }
    else if (!showOrderPanel) { setShowOrderPanel(true) }
    selectSeat(tableId, seatNumber); setActiveSeatNumber(seatNumber); setActiveSourceTableId(tableId)
  }, [selectedSeat, selectSeat, clearSelectedSeat, activeTableId, handleTableTap, showOrderPanel])

  const handleSeatDrag = useCallback((seatId: string, newRelativeX: number, newRelativeY: number) => {
    fetch(`/api/seats/${seatId}?context=pos`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relativeX: newRelativeX, relativeY: newRelativeY }),
    }).catch(err => console.warn('Operation failed:', err))
  }, [])

  // Stable TableNode callbacks
  const handleTableTapById = useCallback((tableId: string) => {
    const table = tablesRef.current.find(t => t.id === tableId)
    if (table) handleTableTap(table)
  }, [handleTableTap])

  const handleDragStartById = useCallback((tableId: string) => { startDrag(tableId) }, [startDrag])
  const handleLongPressById = useCallback((tableId: string) => { openInfoPanel(tableId) }, [openInfoPanel])
  const handleSeatTapForTable = useCallback((tableId: string, seatNumber: number) => { handleSeatTap(tableId, seatNumber) }, [handleSeatTap])

  const handleDeselectCategory = useCallback(() => {
    setSelectedCategoryId(null); setViewMode('tables'); setMenuItems([])
  }, [])

  const handleSeatSelect = useCallback((seatNumber: number | null, tableId: string | null) => {
    setActiveSeatNumber(seatNumber); setActiveSourceTableId(tableId)
  }, [])

  // Drag handlers hook
  const { handlePointerMove, handlePointerUp, ghostPreview, isColliding } = useFloorPlanDrag({
    containerRef, tables, tablesRef, fixturesRef, autoScaleRef, autoScaleOffsetRef,
    draggedTableId, dropTargetTableId, updateDragTarget, endDrag,
  })

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (viewMode === 'menu') { setSelectedCategoryId(null); setViewMode('tables'); setMenuItems([]); engine.resetQuantity() }
        else { closeInfoPanel(); selectTable(null); handleCloseOrderPanel() }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewMode, closeInfoPanel, selectTable, handleCloseOrderPanel, engine.resetQuantity])

  // ===========================
  // RENDER
  // ===========================

  return (
    <div
      className="floor-plan-container floor-plan-home"
      style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      {/* Content: Order panel (left) + Main content (right) */}
      <div style={{ display: 'flex', flexDirection: 'row-reverse', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left Column - Bars + Main Content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>

          {/* Quick Access Bar */}
          {(quickBarEnabled || isEditingFavorites) && (
            <QuickAccessBar
              items={quickBarItems}
              onItemClick={handleQuickBarItemClick}
              onRemoveItem={removeFromQuickBar}
              isEditMode={isEditingFavorites}
            />
          )}

          {/* Categories Bar */}
          <CategoriesBar
            categories={categories}
            selectedCategoryId={selectedCategoryId}
            onCategorySelect={handleCategoryClick}
          />

          {/* Main Content Area */}
          <div className="floor-plan-main" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {viewMode === 'tables' ? (
                <FloorPlanTableCanvas
                  tables={tables}
                  sections={sections}
                  elements={elements}
                  sortedSections={sortedSections.map(s => ({ id: s.id, name: s.name, color: s.color }))}
                  selectedSectionId={selectedSectionId}
                  isLoading={isLoading}
                  activeTableId={activeTableId}
                  selectedTableId={selectedTableId}
                  draggedTableId={draggedTableId}
                  dropTargetTableId={dropTargetTableId}
                  isColliding={isColliding}
                  flashingTables={flashingTables}
                  selectedSeat={selectedSeat}
                  seatsWithItems={seatsWithItems}
                  activeOrderStatusBadges={activeOrderStatusBadges}
                  inlineOrderItems={inlineOrderItems}
                  autoScale={autoScale}
                  autoScaleOffset={autoScaleOffset}
                  containerRef={containerRef}
                  onSectionSelect={setSelectedSectionId}
                  onOpenSettings={() => setShowRoomReorderModal(true)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onCanvasClick={() => selectTable(null)}
                  onTableTap={handleTableTapById}
                  onDragStart={handleDragStartById}
                  onDragEnd={endDrag}
                  onLongPress={handleLongPressById}
                  onSeatTap={handleSeatTapForTable}
                  onSeatDrag={handleSeatDrag}
                  onResetTable={handleResetTable}
                  onEntertainmentItemTap={handleMenuItemTap}
                />
              ) : (
                <FloorPlanMenuView
                  menuItems={menuItems}
                  loadingMenuItems={loadingMenuItems}
                  isCategoryPending={isCategoryPending}
                  menuItemColors={menuItemColors}
                  isInQuickBar={isInQuickBar}
                  pricing={pricing}
                  pricingAdjustmentMap={pricingAdjustmentMap}
                  quantityMultiplier={engine.quantityMultiplier}
                  onSetQuantity={engine.setQuantityMultiplier}
                  onMenuItemTap={handleMenuItemTap}
                  onContextMenu={handleMenuItemContextMenu}
                  onQuickPickTap={handleQuickPickTap}
                  onLongPress={handleMenuItemLongPress}
                  onUnavailable={(reason) => toast.warning(reason)}
                  onDeselectCategory={handleDeselectCategory}
                />
              )}
            </div>
          </div>{/* end floor-plan-main */}
        </div>{/* end Left Column */}

        {/* Left Panel - Order Panel */}
        <FloorPlanOrderPanel
          activeTable={activeTable}
          activeTableId={activeTableId}
          activeOrderId={activeOrderId}
          activeOrderNumber={activeOrderNumber}
          activeOrderType={activeOrderType}
          tableRequiredButMissing={tableRequiredButMissing}
          activeSeatNumber={activeSeatNumber}
          totalSeats={activeTable ? getTotalSeats(activeTable) : 0}
          hasSplitChips={hasSplitChips}
          splitChips={splitChips}
          inlineOrderItems={inlineOrderItems}
          orderTotal={orderTotal}
          showTableOptions={showTableOptions}
          coursingEnabled={activeOrder.coursingEnabled}
          guestCount={guestCount}
          courseDelays={activeOrder.courseDelays}
          onSetShowTableOptions={setShowTableOptions}
          onCoursingToggle={activeOrder.setCoursingEnabled}
          onGuestCountChange={setGuestCount}
          onCloseOrderPanel={handleCloseOrderPanel}
          onShowShareOwnership={() => setShowShareOwnership(true)}
          onSeatSelect={handleSeatSelect}
          onClearSelectedSeat={clearSelectedSeat}
          onSelectSeat={selectSeat}
          onAddSeat={() => handleAddSeat()}
          onFireCourse={activeOrder.handleFireCourse}
        >
          {children}
        </FloorPlanOrderPanel>
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
          onMarkDirty={() => { if (infoPanelTableId) handleUpdateStatus(infoPanelTableId, 'dirty') }}
          onMarkAvailable={() => { if (infoPanelTableId) handleUpdateStatus(infoPanelTableId, 'available') }}
          locationId={locationId}
          employeeId={employeeId}
        />
      )}

      {/* Notes Editor Modal */}
      <NoteEditModal
        isOpen={!!activeOrder.noteEditTarget}
        onClose={activeOrder.closeNoteEditor}
        onSave={handleSaveNotes}
        currentNote={activeOrder.noteEditTarget?.currentNote}
        itemName={activeOrder.noteEditTarget?.itemName}
      />

      {/* Menu Item Context Menu */}
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
      <Suspense fallback={null}>
        <RoomReorderModal
          isOpen={showRoomReorderModal}
          onClose={() => setShowRoomReorderModal(false)}
          rooms={sections.map(s => ({ id: s.id, name: s.name, color: s.color }))}
          currentOrder={preferredRoomOrder}
          onSave={handleSaveRoomOrder}
        />
      </Suspense>

      {/* Comp/Void Modal */}
      {compVoidItem && activeOrderId && employeeId && (
        <Suspense fallback={null}>
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
              if (result.orderAutoClosed) {
                useOrderStore.getState().clearOrder(); setActiveOrderId(null)
                toast.success('Order cancelled — all items voided'); return
              }
              const store = useOrderStore.getState()
              if (voidedItemId) {
                store.updateItem(voidedItemId, {
                  status: result.action === 'restore' ? 'active' as const : result.action as 'voided' | 'comped',
                })
              }
              if (result.orderTotals) {
                store.syncServerTotals({
                  subtotal: result.orderTotals.subtotal, discountTotal: result.orderTotals.discountTotal,
                  taxTotal: result.orderTotals.taxTotal, total: result.orderTotals.total,
                })
              }
              toast.success(result.action === 'restore' ? 'Item restored' : 'Item comped/voided successfully')
              if (activeOrderId) {
                void fetch(`/api/orders/${activeOrderId}`)
                  .then(r => r.ok ? r.json() : null)
                  .then(d => { if (d) useOrderStore.getState().loadOrder(d.data || d) })
                  .catch(err => console.warn('fire-and-forget failed in floor-plan.FloorPlanHome:', err))
              }
            }}
          />
        </Suspense>
      )}

      {/* Shared Ownership Modal */}
      {activeOrderId && (
        <Suspense fallback={null}>
          <SharedOwnershipModal
            orderId={activeOrderId}
            locationId={locationId}
            employeeId={employeeId}
            isOpen={showShareOwnership}
            onClose={() => setShowShareOwnership(false)}
          />
        </Suspense>
      )}

      {/* Item Description Modal */}
      <ItemDescriptionModal
        item={longPressItem}
        isOpen={!!longPressItem}
        onClose={() => setLongPressItem(null)}
        onItemUpdated={handleItemDescriptionUpdated}
      />

      {/* EOD Summary Overlay */}
      {eodSummary && (
        <FloorPlanEodSummary
          summary={eodSummary}
          onDismiss={() => setEodSummary(null)}
        />
      )}
    </div>
  )
}
