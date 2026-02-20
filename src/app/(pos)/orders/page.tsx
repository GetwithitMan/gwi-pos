'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { useAuthStore } from '@/stores/auth-store'
import { useOrderStore } from '@/stores/order-store'
import { useDevStore } from '@/stores/dev-store'
import { useOrderSettings } from '@/hooks/useOrderSettings'
import { usePOSDisplay } from '@/hooks/usePOSDisplay'
import { usePOSLayout } from '@/hooks/usePOSLayout'
import { useActiveOrder } from '@/hooks/useActiveOrder'
import { usePricing } from '@/hooks/usePricing'
import { useOrderPanelItems } from '@/hooks/useOrderPanelItems'
import { formatCurrency } from '@/lib/utils'
import { calculateCardPrice } from '@/lib/pricing'
import { debugPizzaPricing } from '@/lib/pizza-helpers'
import { buildPizzaModifiers, getPizzaBasePrice } from '@/lib/pizza-order-utils'
import { fetchAndLoadSplitOrder } from '@/lib/split-order-loader'
import { isTempId } from '@/lib/order-utils'
import { type OpenOrder } from '@/components/orders/OpenOrdersPanel'
import type { OrderTypeConfig, OrderCustomFields, WorkflowRules } from '@/types/order-types'
import type { IngredientModificationType } from '@/types/orders'
import type { PrepaidPackage } from '@/lib/entertainment-pricing'
import { FloorPlanHome } from '@/components/floor-plan'
import { useFloorPlanStore, type FloorPlanTable, type FloorPlanSection, type FloorPlanElement } from '@/components/floor-plan/use-floor-plan'
import { BartenderView } from '@/components/bartender'
import { OrderPanel, type OrderPanelItemData } from '@/components/orders/OrderPanel'
import { UnifiedPOSHeader } from '@/components/orders/UnifiedPOSHeader'
import { useMenuSearch } from '@/hooks/useMenuSearch'
import { QuickPickStrip } from '@/components/orders/QuickPickStrip'
import { useQuickPick } from '@/hooks/useQuickPick'
import { useOrderPanelCallbacks } from '@/hooks/useOrderPanelCallbacks'
import { useOrderingEngine } from '@/hooks/useOrderingEngine'
import { toast } from '@/stores/toast-store'
import { hasPermission, PERMISSIONS } from '@/lib/auth-utils'
import { useOrderSockets } from '@/hooks/useOrderSockets'
import { useSplitTickets } from '@/hooks/useSplitTickets'
import { useShiftManagement } from '@/hooks/useShiftManagement'
import { useTimedRentals } from '@/hooks/useTimedRentals'
import { useItemOperations } from '@/hooks/useItemOperations'
import { usePaymentFlow } from '@/hooks/usePaymentFlow'
import { useModifierModal } from '@/hooks/useModifierModal'
import { useComboBuilder } from '@/hooks/useComboBuilder'
import { useCardTabFlow } from '@/hooks/useCardTabFlow'
import { useTabsPanel } from '@/hooks/useTabsPanel'
import { usePizzaBuilder } from '@/hooks/usePizzaBuilder'
import { useOrderPageModals } from './useOrderPageModals'
import { OrderPageModals } from './OrderPageModals'
import type { Category, MenuItem, SelectedModifier, PizzaOrderConfig, OrderItem } from '@/types'

// DEFERRED: Replace with dynamic terminal ID from device provisioning — tracked in PM-TASK-BOARD.md
// For now, uses the seeded terminal.
const TERMINAL_ID = 'terminal-1'

export default function OrdersPage() {
  const router = useRouter()
  const employee = useAuthStore(s => s.employee)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const logout = useAuthStore(s => s.logout)
  const currentOrder = useOrderStore(s => s.currentOrder)
  const { startOrder, updateOrderType, loadOrder, addItem, updateItem, removeItem, updateQuantity } = useOrderStore.getState()
  const hasDevAccess = useDevStore(s => s.hasDevAccess)
  const setHasDevAccess = useDevStore(s => s.setHasDevAccess)

  // Hydration guard: Zustand persist middleware starts with defaults (isAuthenticated=false)
  // before rehydrating from localStorage. Without this guard, the auth redirect fires
  // immediately on mount before the real auth state loads, causing unexpected logouts.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])

  // Preload PaymentModal so first payment isn't delayed
  useEffect(() => {
    import('@/components/payment/PaymentModal')
  }, [])

  // Shared handlers from useActiveOrder hook
  const activeOrderFull = useActiveOrder({
    locationId: employee?.location?.id,
    employeeId: employee?.id,
  })
  const {
    expandedItemId,
    handleHoldToggle: sharedHoldToggle,
    handleNoteEdit: sharedNoteEdit,
    handleCourseChange: sharedCourseChange,
    handleSeatChange: sharedSeatChange,
    handleResend: sharedResend,
    handleToggleExpand,
    ensureOrderInDB,
    clearOrder,
  } = activeOrderFull

  const [categories, setCategories] = useState<Category[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Bootstrap snapshot data — passed to FloorPlanHome to avoid duplicate /api/floorplan/snapshot fetch
  // undefined = bootstrap pending (FloorPlanHome waits), null = bootstrap failed/skipped (FloorPlanHome fetches itself)
  const [initialSnapshot, setInitialSnapshot] = useState<{
    tables: FloorPlanTable[]
    sections: FloorPlanSection[]
    elements: FloorPlanElement[]
    openOrdersCount: number
  } | null | undefined>(undefined)

  // Floor Plan integration (T019)
  // viewMode: 'floor-plan' = default HOME view, 'bartender' = speed-optimized bar view
  // T023: FloorPlanHome is now the default for ALL users including bartenders
  // T024: Bartenders can switch to bartender view for faster tab management
  const isBartender = employee?.role?.name?.toLowerCase() === 'bartender'
  const [viewMode, setViewMode] = useState<'floor-plan' | 'bartender'>('floor-plan')

  // Check if user has admin/manager permissions
  // Handle both array permissions (new format) and role name check
  const permissionsArray = Array.isArray(employee?.permissions) ? employee.permissions : []

  // Guard: redirect non-POS employees to Crew Hub
  useEffect(() => {
    if (employee && !hasPermission(permissionsArray, PERMISSIONS.POS_ACCESS)) {
      router.replace('/crew')
    }
  }, [employee, permissionsArray, router])

  // Full manager access (can do everything)
  const isManager = employee?.role?.name && ['Manager', 'Owner', 'Admin'].includes(employee.role.name) ||
    permissionsArray.some(p => ['admin', 'manage_menu', 'manage_employees'].includes(p))

  // Can access admin nav (reports, settings, etc.) - more inclusive
  const canAccessAdmin = isManager ||
    permissionsArray.some(p => p.startsWith('reports.') || p.startsWith('settings.') || p.startsWith('tips.'))

  // Modifier selection state (extracted to useModifierModal hook)
  const {
    showModifierModal, setShowModifierModal,
    selectedItem, setSelectedItem,
    itemModifierGroups, setItemModifierGroups,
    loadingModifiers, setLoadingModifiers,
    editingOrderItem, setEditingOrderItem,
  } = useModifierModal()

  // Ref for handleOpenModifiersShared — defined later but needed by useOrderingEngine
  const handleOpenModifiersSharedRef = useRef<((...args: any[]) => void) | null>(null)

  // T023: Inline ordering modifier callback ref
  const inlineModifierCallbackRef = useRef<((modifiers: { id: string; name: string; price: number; depth?: number; preModifier?: string | null; modifierId?: string | null; spiritTier?: string | null; linkedBottleProductId?: string | null; parentModifierId?: string | null }[], ingredientModifications?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]) => void) | null>(null)
  // T023: Inline ordering timed rental callback ref
  const inlineTimedRentalCallbackRef = useRef<((price: number, blockMinutes: number) => void) | null>(null)
  // T023: Inline ordering pizza builder callback ref
  const inlinePizzaCallbackRef = useRef<((config: PizzaOrderConfig) => void) | null>(null)

  // Pizza builder state (extracted to usePizzaBuilder hook)
  const {
    showPizzaModal, setShowPizzaModal,
    selectedPizzaItem, setSelectedPizzaItem,
    editingPizzaItem, setEditingPizzaItem,
  } = usePizzaBuilder()

  // Settings loaded from API via custom hook
  const { dualPricing, paymentSettings, priceRounding, taxRate, receiptSettings, taxInclusiveLiquor, taxInclusiveFood, requireCardForTab } = useOrderSettings()
  const { settings: displaySettings, menuItemClass, gridColsClass, orderPanelClass, categorySize, categoryColorMode, categoryButtonBgColor, categoryButtonTextColor, showPriceOnMenuItems, updateSetting, updateSettings } = usePOSDisplay()

  // POS Layout (Bar/Food mode, favorites, category order)
  // All logged-in employees can customize their personal layout colors
  // This is a fun personalization feature for servers
  const hasLayoutPermission = !!employee?.id
  const {
    currentMode,
    setMode,
    favorites,
    addFavorite,
    removeFavorite,
    reorderFavorites,
    canCustomize,
    layout,
    categoryOrder,
    setCategoryOrder,
    categoryColors,
    setCategoryColor,
    resetCategoryColor,
    resetAllCategoryColors,
    menuItemColors,
    setMenuItemStyle,
    resetMenuItemStyle,
    resetAllMenuItemStyles,
    // Quick Bar (T035)
    quickBar,
    quickBarEnabled,
    addToQuickBar,
    removeFromQuickBar,
    isInQuickBar,
    updateSetting: updateLayoutSetting,
  } = usePOSLayout({
    employeeId: employee?.id,
    locationId: employee?.location?.id,
    permissions: hasLayoutPermission ? { posLayout: ['customize_personal'] } : undefined,
  })

  // Payment flow state (extracted to usePaymentFlow hook)
  const {
    paymentMethod, setPaymentMethod,
    showPaymentModal, setShowPaymentModal,
    initialPayMethod, setInitialPayMethod,
    orderToPayId, setOrderToPayId,
    paymentTabCards, setPaymentTabCards,
    showDiscountModal, setShowDiscountModal,
    appliedDiscounts, setAppliedDiscounts,
  } = usePaymentFlow()

  // Unified pricing calculations
  const pricing = usePricing({
    subtotal: currentOrder?.subtotal || 0,
    discountTotal: currentOrder?.discountTotal || 0,
    tipTotal: currentOrder?.tipTotal || 0,
    paymentMethod,
  })

  // Modal visibility state (extracted to useOrderPageModals hook)
  const {
    showDisplaySettings, setShowDisplaySettings,
    showReceiptModal, setShowReceiptModal,
    receiptOrderId, setReceiptOrderId,
    preloadedReceiptData, setPreloadedReceiptData,
    showTabNamePrompt, setShowTabNamePrompt,
    tabNameCallback, setTabNameCallback,
    showItemTransferModal, setShowItemTransferModal,
    editingNotesItemId, setEditingNotesItemId,
    editingNotesText, setEditingNotesText,
  } = useOrderPageModals()

  const [isEditingFavorites, setIsEditingFavorites] = useState(false)
  const [isEditingMenuItems, setIsEditingMenuItems] = useState(false)

  // Quick Bar items with full data (T035)
  const [quickBarItems, setQuickBarItems] = useState<{
    id: string
    name: string
    price: number
    bgColor?: string | null
    textColor?: string | null
  }[]>([])

  // Order to load into FloorPlanHome (for editing from Open Orders panel)
  const [orderToLoad, setOrderToLoad] = useState<{ id: string; orderNumber: number; tableId?: string; tableName?: string; tabName?: string; orderType: string } | null>(null)

  // BartenderView tab deselect callback (registered via onRegisterDeselectTab)
  const bartenderDeselectTabRef = useRef<(() => void) | null>(null)
  // FloorPlanHome table deselect callback (registered via onRegisterDeselectTable)
  const floorPlanDeselectTableRef = useRef<(() => void) | null>(null)

  // Background items-persist promise (started when PaymentModal opens, awaited before /pay)
  const orderReadyPromiseRef = useRef<Promise<string | null> | null>(null)

  // Order that was just paid - triggers FloorPlanHome to clear its state
  const [paidOrderId, setPaidOrderId] = useState<string | null>(null)

  // Floor plan refresh trigger - increment to force FloorPlanHome to refresh
  const [floorPlanRefreshTrigger, setFloorPlanRefreshTrigger] = useState(0)

  // Card-first tab flow state (extracted to useCardTabFlow hook)
  const {
    showCardTabFlow, setShowCardTabFlow,
    cardTabOrderId, setCardTabOrderId,
    tabCardInfo, setTabCardInfo,
  } = useCardTabFlow(currentOrder)

  // Comp/Void + Resend modal state (extracted to useItemOperations hook)
  const {
    showCompVoidModal, setShowCompVoidModal,
    resendModal, setResendModal,
    resendNote, setResendNote,
    resendLoading, setResendLoading,
    compVoidItem, setCompVoidItem,
  } = useItemOperations()

  // Split Ticket Manager state (extracted to useSplitTickets hook)
  const {
    showSplitTicketManager, setShowSplitTicketManager,
    splitManageMode, setSplitManageMode,
    editingChildSplit, setEditingChildSplit,
    splitParentToReturnTo, setSplitParentToReturnTo,
    payAllSplitsQueue, setPayAllSplitsQueue,
    showPayAllSplitsConfirm, setShowPayAllSplitsConfirm,
    payAllSplitsTotal, setPayAllSplitsTotal,
    payAllSplitsCardTotal, setPayAllSplitsCardTotal,
    payAllSplitsParentId, setPayAllSplitsParentId,
    payAllSplitsProcessing, setPayAllSplitsProcessing,
    payAllSplitsStep, setPayAllSplitsStep,
    orderSplitChips, setOrderSplitChips,
    splitParentId, setSplitParentId,
    splitChipsFlashing, setSplitChipsFlashing,
  } = useSplitTickets()

  // Tabs panel state (extracted to useTabsPanel hook)
  const {
    showTabsPanel, setShowTabsPanel,
    isTabManagerExpanded, setIsTabManagerExpanded,
    showTipAdjustment, setShowTipAdjustment,
    tabsRefreshTrigger, setTabsRefreshTrigger,
  } = useTabsPanel()

  // Saved order state
  const [savedOrderId, setSavedOrderId] = useState<string | null>(null)
  const [isSendingOrder, setIsSendingOrder] = useState(false)
  const [orderSent, setOrderSent] = useState(false)

  // Sync savedOrderId with Zustand store — FloorPlanHome/BartenderView load orders
  // directly into Zustand via store.loadOrder(), bypassing setSavedOrderId.
  // This ensures Split/CompVoid/Resend modals can render (they depend on savedOrderId).
  useEffect(() => {
    const storeOrderId = currentOrder?.id ?? null
    if (storeOrderId !== savedOrderId) {
      setSavedOrderId(storeOrderId)
    }
  }, [currentOrder?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh tab cards when a new card is added via PaymentModal
  const handleTabCardsChanged = useCallback(() => {
    const orderId = orderToPayId || savedOrderId
    if (!orderId) return
    fetch(`/api/orders/${orderId}/cards`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(d => {
        const authorized = (d.data || []).filter((c: { status: string }) => c.status === 'authorized')
        setPaymentTabCards(authorized)
      })
      .catch(() => {})
  }, [orderToPayId, savedOrderId])

  // Order type state (configurable order types)
  const [orderTypes, setOrderTypes] = useState<OrderTypeConfig[]>([])
  const [selectedOrderType, setSelectedOrderType] = useState<OrderTypeConfig | null>(null)
  const [orderCustomFields, setOrderCustomFields] = useState<OrderCustomFields>({})

  // Open orders count for badge
  const [openOrdersCount, setOpenOrdersCount] = useState(0)

  // Menu search (lifted from FloorPlanHome for UnifiedPOSHeader)
  const menuSearch = useMenuSearch({
    locationId: employee?.location?.id,
    menuItems: menuItems as any,
  })

  // Ref callbacks for UnifiedPOSHeader → FloorPlanHome communication
  const quickOrderTypeRef = useRef<((orderType: string) => void) | null>(null)
  const tablesClickRef = useRef<(() => void) | null>(null)

  // Fetch split chips when a split parent order is loaded, or clear when leaving split context
  useEffect(() => {
    const orderId = currentOrder?.id
    const status = currentOrder?.status
    if (!orderId) {
      setOrderSplitChips([])
      setSplitParentId(null)
      return
    }
    // If current order IS the split parent
    if (status === 'split') {
      setSplitParentId(orderId)
      fetch(`/api/orders/${orderId}/split-tickets`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          const splits = data?.splitOrders || data?.data?.splitOrders || []
          setOrderSplitChips(splits.map((s: any, idx: number) => ({
            id: s.id,
            label: s.displayNumber || `Check ${idx + 1}`,
            isPaid: s.status === 'paid',
            total: Number(s.total ?? 0),
          })))
        })
        .catch(() => setOrderSplitChips([]))
      return
    }
    // If we have a splitParentId, we're in split context — keep chips visible
    // (covers navigating between sibling splits AND newly created splits)
    if (splitParentId) {
      return
    }
    // Otherwise, leaving split context entirely
    if (orderSplitChips.length > 0) {
      setOrderSplitChips([])
      setSplitParentId(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrder?.id, currentOrder?.status])

  // Shift management state (extracted to useShiftManagement hook)
  const {
    showTimeClockModal, setShowTimeClockModal,
    currentShift, setCurrentShift,
    showShiftStartModal, setShowShiftStartModal,
    showShiftCloseoutModal, setShowShiftCloseoutModal,
    shiftChecked, setShiftChecked,
  } = useShiftManagement()

  // Combo selection state (extracted to useComboBuilder hook)
  const {
    showComboModal, setShowComboModal,
    selectedComboItem, setSelectedComboItem,
    comboTemplate, setComboTemplate,
    comboSelections, setComboSelections,
  } = useComboBuilder()

  // Timed rental & entertainment state (extracted to useTimedRentals hook)
  const {
    showTimedRentalModal, setShowTimedRentalModal,
    selectedTimedItem, setSelectedTimedItem,
    selectedRateType, setSelectedRateType,
    activeSessions, setActiveSessions,
    loadingSession, setLoadingSession,
    showEntertainmentStart, setShowEntertainmentStart,
    entertainmentItem, setEntertainmentItem,
  } = useTimedRentals()

  // Menu search state (legacy order-entry mode removed — FloorPlanHome/BartenderView have their own search)

  // OrderPanel data mapping
  const orderPanelItems = useOrderPanelItems(menuItems)

  // Seat filter: when a seat is selected on the floor plan, filter items to that seat
  const selectedSeat = useFloorPlanStore(s => s.selectedSeat)
  const clearSelectedSeat = useFloorPlanStore(s => s.clearSelectedSeat)
  const addTableOrder = useFloorPlanStore(s => s.addTableOrder)
  const filterSeatNumber = selectedSeat?.seatNumber ?? null

  // Seat selection handler: tap a seat header in OrderPanel to select that seat for adding items
  const handleSeatSelect = useCallback((seatNumber: number | null) => {
    const tableId = currentOrder?.tableId
    if (!tableId) return
    if (seatNumber === null || seatNumber === 0) {
      useFloorPlanStore.getState().clearSelectedSeat()
    } else {
      useFloorPlanStore.getState().selectSeat(tableId, seatNumber)
    }
  }, [currentOrder?.tableId])

  const filteredOrderPanelItems = useMemo(() => {
    if (!filterSeatNumber) return orderPanelItems
    return orderPanelItems.filter(item => item.seatNumber === filterSeatNumber)
  }, [orderPanelItems, filterSeatNumber])

  // Memoize split check items to avoid re-creating array every render
  const splitCheckItems = useMemo(() => {
    if (!showSplitTicketManager || !currentOrder) return []
    return currentOrder.items.map(item => ({
      id: item.id,
      seatNumber: item.seatNumber,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      categoryType: item.categoryType,
      sentToKitchen: item.sentToKitchen,
      isPaid: item.status === 'comped' || item.status === 'voided',
    }))
  }, [showSplitTicketManager, currentOrder])

  // Quick Pick: selection state for fast quantity setting
  const {
    selectedItemId: quickPickSelectedId,
    selectedItemIds: quickPickSelectedIds,
    selectItem: selectQuickPickItem,
    setSelectedItemId: setQuickPickSelectedId,
    clearSelection: clearQuickPick,
    multiSelectMode: quickPickMultiSelect,
    toggleMultiSelect: toggleQuickPickMultiSelect,
    selectAllPending: selectAllPendingQuickPick,
  } = useQuickPick(orderPanelItems)

  // Unified ordering engine for OrderPanel callbacks (floor-plan + bartender views)
  const engine = useOrderingEngine({
    locationId: employee?.location?.id || '',
    employeeId: employee?.id,
    onOpenModifiers: ((...args: any[]) => handleOpenModifiersSharedRef.current?.(...args)) as any,
    onOpenPizzaBuilder: (item, onComplete) => {
      inlinePizzaCallbackRef.current = onComplete
      setSelectedPizzaItem(item as MenuItem)
      setEditingPizzaItem(null)
      setShowPizzaModal(true)
    },
    onOpenTimedRental: (item, onComplete) => {
      inlineTimedRentalCallbackRef.current = onComplete
      setSelectedTimedItem(item as MenuItem)
      setShowTimedRentalModal(true)
    },
  })

  // Unified OrderPanel callbacks (shared between floor-plan and bartender)
  const panelCallbacks = useOrderPanelCallbacks({
    engine,
    activeOrder: activeOrderFull,
    onOpenCompVoid: (item) => {
      const orderId = useOrderStore.getState().currentOrder?.id || savedOrderId
      if (!orderId) {
        console.error('[CompVoid] No order ID found — cannot open comp/void modal')
        return
      }
      setOrderToPayId(orderId)
      setCompVoidItem(item)
      setShowCompVoidModal(true)
    },
    onOpenResend: (itemId, itemName) => {
      setResendNote('')
      setResendModal({ itemId, itemName })
    },
    onOpenSplit: async () => {
      // Check if order already has splits — if so, open manage mode
      setEditingChildSplit(false)
      const orderId = savedOrderId || useOrderStore.getState().currentOrder?.id
      if (orderId) {
        try {
          const res = await fetch(`/api/orders/${orderId}/split-tickets`)
          if (res.ok) {
            const data = await res.json()
            if (data.data?.splitOrders && data.data.splitOrders.length > 0) {
              setSplitManageMode(true)
              setShowSplitTicketManager(true)
              return
            }
          }
        } catch { /* ignore — fall through to edit mode */ }
      }
      setShowSplitTicketManager(true)
    },
  })

  // Multi-digit entry: tapping 1 then 0 quickly = 10
  const ordersDigitBufferRef = useRef<string>('')
  const ordersDigitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleQuickPickNumber = useCallback((num: number) => {
    if (!quickPickSelectedId) return
    // Read latest items from store to avoid stale closure on rapid taps
    const storeOrder = useOrderStore.getState().currentOrder
    const item = storeOrder?.items.find(i => i.id === quickPickSelectedId)
    if (!item || item.sentToKitchen) return

    if (ordersDigitTimerRef.current) clearTimeout(ordersDigitTimerRef.current)
    ordersDigitBufferRef.current += String(num)
    const pendingQty = parseInt(ordersDigitBufferRef.current, 10)

    if (pendingQty === 0) {
      ordersDigitBufferRef.current = ''
      activeOrderFull.handleRemoveItem(quickPickSelectedId)
      return
    }

    if (pendingQty !== item.quantity) updateQuantity(quickPickSelectedId, pendingQty)

    ordersDigitTimerRef.current = setTimeout(() => {
      ordersDigitBufferRef.current = ''
    }, 600)
  }, [quickPickSelectedId, updateQuantity, activeOrderFull])

  // Clear digit buffer on selection change
  useEffect(() => {
    ordersDigitBufferRef.current = ''
    if (ordersDigitTimerRef.current) clearTimeout(ordersDigitTimerRef.current)
  }, [quickPickSelectedId])

  // OrderPanel calculations (from usePricing hook)
  // Tax-inclusive liquor/food is handled inside usePricing + server-side calculateOrderTotals.
  // After save, syncServerTotals overwrites these with the server's authoritative values.
  const subtotal = pricing.subtotal
  const taxAmount = pricing.tax
  const totalDiscounts = pricing.discounts + pricing.cashDiscount
  const grandTotal = pricing.total

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.push('/login')
    }
  }, [hydrated, isAuthenticated, router])

  // Ref for tracking selected category (used by bootstrap + loadMenu)
  const selectedCategoryRef = useRef(selectedCategory)
  selectedCategoryRef.current = selectedCategory

  // Session bootstrap — single fetch replaces menu + shift + orderTypes + snapshot
  const bootstrapLoadedRef = useRef(false)
  useEffect(() => {
    if (!employee?.location?.id || !employee?.id || bootstrapLoadedRef.current) return
    bootstrapLoadedRef.current = true

    fetch(`/api/session/bootstrap?locationId=${employee?.location?.id}&employeeId=${employee.id}`)
      .then(res => res.json())
      .then(({ data }) => {
        if (!data) return

        // Menu data
        if (data.menu) {
          setCategories(data.menu.categories)
          setMenuItems([...data.menu.items])
          if (data.menu.categories.length > 0 && !selectedCategoryRef.current) {
            setSelectedCategory(data.menu.categories[0].id)
          }
          setIsLoading(false)
        }

        // Active shift
        if (data.shift) {
          setCurrentShift({
            ...data.shift,
            employee: {
              ...data.shift.employee,
              roleId: employee?.role?.id,
            },
            locationId: employee?.location?.id,
          })
          setShiftChecked(true)
        } else if (data.shift === null) {
          // No open shift — prompt to start one
          setShowShiftStartModal(true)
          setShiftChecked(true)
        }

        // Order types
        if (data.orderTypes) {
          setOrderTypes(data.orderTypes)
        }

        // Floor plan snapshot for FloorPlanHome
        if (data.snapshot) {
          setInitialSnapshot(data.snapshot)
          setOpenOrdersCount(data.snapshot.openOrdersCount ?? 0)
        } else {
          setInitialSnapshot(null) // Signal FloorPlanHome to fetch on its own
        }
      })
      .catch(err => {
        console.error('Bootstrap failed, falling back to individual fetches:', err)
        // Bootstrap set the flag synchronously, so individual mount effects already skipped.
        // Manually trigger the fallback fetches.
        bootstrapLoadedRef.current = false
        setInitialSnapshot(null) // Signal FloorPlanHome to fetch on its own
        loadMenu()
        loadOrderTypes()
        checkOpenShift()
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.location?.id, employee?.id])

  // Load menu with cache-busting
  // NOTE: selectedCategory intentionally NOT in deps — loadMenu fetches ALL items.
  // Category filtering is done client-side (line ~2437). Including selectedCategory
  // here caused a circular re-fetch on every category click (loadMenu recreated →
  // useEffect re-ran → full /api/menu re-fetch). Use selectedCategoryRef for the
  // initial-selection guard (declared above, near bootstrap effect).

  const loadMenu = useCallback(async () => {
    if (!employee?.location?.id) return
    try {
      const response = await fetch(`/api/menu?locationId=${employee?.location?.id}`, {
        cache: 'no-store',
      })
      if (response.ok) {
        const data = await response.json()
        setCategories(data.data.categories)
        setMenuItems([...data.data.items]) // Force new array reference
        if (data.data.categories.length > 0 && !selectedCategoryRef.current) {
          setSelectedCategory(data.data.categories[0].id)
        }
      }
    } catch (error) {
      console.error('Failed to load menu:', error)
    } finally {
      setIsLoading(false)
    }
  }, [employee?.location?.id])

  // Load order types
  const loadOrderTypes = useCallback(async () => {
    if (!employee?.location?.id) return
    try {
      const response = await fetch(`/api/order-types?locationId=${employee?.location?.id}`)
      if (response.ok) {
        const data = await response.json()
        setOrderTypes(data.data?.orderTypes || [])
      }
    } catch (error) {
      console.error('Failed to load order types:', error)
    }
  }, [employee?.location?.id])

  useEffect(() => {
    if (employee?.location?.id) {
      // Skip menu + orderTypes if bootstrap already loaded them
      if (!bootstrapLoadedRef.current) {
        loadMenu()
        loadOrderTypes()
      }
      loadActiveSessions()
    }
  }, [employee?.location?.id, loadMenu, loadOrderTypes])

  // Throttled loadMenu — coalesces rapid calls from entertainment handlers
  const menuRefreshingRef = useRef(false)
  const menuRefreshQueuedRef = useRef(false)
  const throttledLoadMenu = useCallback(() => {
    if (menuRefreshingRef.current) {
      menuRefreshQueuedRef.current = true
      return
    }
    menuRefreshingRef.current = true
    loadMenu().finally(() => {
      menuRefreshingRef.current = false
      if (menuRefreshQueuedRef.current) {
        menuRefreshQueuedRef.current = false
        loadMenu()
      }
    })
  }, [loadMenu])

  // Socket-based real-time updates for open orders + entertainment status
  useOrderSockets({
    locationId: employee?.location?.id,
    onOpenOrdersChanged: () => {
      loadOpenOrdersCount()
    },
    onEntertainmentStatusChanged: (data) => {
      setMenuItems(prev => prev.map(item =>
        item.id === data.itemId
          ? { ...item, entertainmentStatus: data.entertainmentStatus as MenuItem['entertainmentStatus'], currentOrderId: data.currentOrderId }
          : item
      ))
    },
  })

  // Visibility-change fallback for entertainment status (tab refocus)
  const selectedCategoryData = categories.find(c => c.id === selectedCategory)
  useEffect(() => {
    if (selectedCategoryData?.categoryType !== 'entertainment') return

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') loadMenu()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [selectedCategoryData?.categoryType, loadMenu])

  const loadActiveSessions = async () => {
    if (!employee?.location?.id) return
    try {
      const params = new URLSearchParams({ locationId: employee?.location?.id, status: 'active' })
      const response = await fetch(`/api/timed-sessions?${params}`)
      if (response.ok) {
        const data = await response.json()
        setActiveSessions(data.data?.sessions || [])
      }
    } catch (error) {
      console.error('Failed to load active sessions:', error)
    }
  }

  // Check for open shift on load — skip if bootstrap is handling it
  useEffect(() => {
    if (employee?.id && employee?.location?.id && !shiftChecked && !bootstrapLoadedRef.current) {
      checkOpenShift()
    }
  }, [employee?.id, employee?.location?.id, shiftChecked])

  const checkOpenShift = async () => {
    if (!employee?.id || !employee?.location?.id) return
    try {
      const params = new URLSearchParams({
        locationId: employee?.location?.id,
        employeeId: employee.id,
        status: 'open',
      })
      const response = await fetch(`/api/shifts?${params}`)
      if (response.ok) {
        const data = await response.json()
        if (data.data?.shifts && data.data.shifts.length > 0) {
          // Enrich shift data with roleId and locationId for tip distribution
          setCurrentShift({
            ...data.data.shifts[0],
            employee: {
              ...data.data.shifts[0].employee,
              roleId: employee?.role?.id,
            },
            locationId: employee?.location?.id,
          })
        } else {
          // No open shift - prompt to start one
          setShowShiftStartModal(true)
        }
      }
    } catch (error) {
      console.error('Failed to check shift:', error)
    } finally {
      setShiftChecked(true)
    }
  }

  // Load open orders count (debounced — many call sites trigger tabsRefreshTrigger)
  const loadOpenOrdersCountRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const loadOpenOrdersCount = useCallback(() => {
    if (!employee?.location?.id) return
    clearTimeout(loadOpenOrdersCountRef.current)
    loadOpenOrdersCountRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ locationId: employee?.location?.id, summary: 'true' })
        const response = await fetch(`/api/orders/open?${params}`)
        if (response.ok) {
          const data = await response.json()
          setOpenOrdersCount(data.data?.orders?.length || 0)
        }
      } catch (error) {
        console.error('Failed to load open orders count:', error)
      }
    }, 300)
  }, [employee?.location?.id])

  useEffect(() => {
    if (employee?.location?.id) {
      loadOpenOrdersCount()
    }
  }, [employee?.location?.id, tabsRefreshTrigger, loadOpenOrdersCount])


  // Load quick bar items when quickBar changes (T035)
  useEffect(() => {
    if (!quickBar || quickBar.length === 0) {
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
          const { data: { items } } = await res.json()
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

  const handleLogout = async () => {
    // Check for open shift and prompt for closeout
    if (employee?.id) {
      try {
        const res = await fetch(`/api/shifts?employeeId=${employee.id}&status=open`)
        if (res.ok) {
          const data = await res.json()
          if (data.data?.length > 0) {
            const closeShift = window.confirm(
              'You have an open shift. Would you like to close your shift before logging out?'
            )
            if (closeShift) {
              router.push('/reports/shift')
              return
            }
          }
        }
      } catch {
        // Shift check failed — proceed with logout anyway
      }
    }
    clearOrder()
    setHasDevAccess(false)
    logout()
    router.push('/login')
  }

  // ensureOrderInDB from useActiveOrder handles: create new order, append unsaved items,
  // correlationId mapping, and syncServerTotals — replaces the old saveOrderToDatabase function

  // Handle order type selection
  const handleOrderTypeSelect = (orderType: OrderTypeConfig, customFields?: OrderCustomFields) => {
    setSelectedOrderType(orderType)
    if (customFields) {
      setOrderCustomFields(customFields)
    }

    // Sync bar/food category mode with order type
    if (orderType.slug === 'bar_tab') {
      setMode('bar')
    } else {
      // All non-bar order types (dine_in, takeout, delivery, drive_thru, custom) default to food mode
      setMode('food')
    }

    // If order type requires table selection, open table picker
    const workflowRules = (orderType.workflowRules || {}) as WorkflowRules
    if (workflowRules.requireTableSelection) {
      toast.warning('Please select a table from the floor plan')
    } else {
      // Convert OrderCustomFields to Record<string, string> (filter out undefined)
      const cleanFields: Record<string, string> = {}
      if (customFields) {
        Object.entries(customFields).forEach(([key, value]) => {
          if (value !== undefined) {
            cleanFields[key] = value
          }
        })
      }

      // If there's an existing order with items, update the order type instead of starting fresh
      if (currentOrder?.items.length) {
        updateOrderType(orderType.slug, {
          tabName: customFields?.customerName,
          orderTypeId: orderType.id,
          customFields: Object.keys(cleanFields).length > 0 ? cleanFields : undefined,
        })
      } else {
        // Start new order with the selected type
        startOrder(orderType.slug, {
          tabName: customFields?.customerName,
          orderTypeId: orderType.id,
          customFields: Object.keys(cleanFields).length > 0 ? cleanFields : undefined,
        })
      }
    }
  }

  // Validate order before sending to kitchen based on workflow rules
  const validateBeforeSend = (): { valid: boolean; message?: string } => {
    if (!currentOrder) return { valid: false, message: 'No order to send' }

    // Find the order type config
    const orderTypeConfig = orderTypes.find(t => t.slug === currentOrder.orderType)
    if (!orderTypeConfig) {
      // No config found, allow sending (backward compatibility)
      return { valid: true }
    }

    const workflowRules = (orderTypeConfig.workflowRules || {}) as WorkflowRules

    // If table is required but none selected, block and prompt for table picker
    if (workflowRules.requireTableSelection && !currentOrder.tableId) {
      return { valid: false, message: 'TABLE_REQUIRED' }
    }

    // Check customer name requirement
    if (workflowRules.requireCustomerName && !currentOrder.tabName && !orderCustomFields.customerName) {
      return { valid: false, message: 'TAB_NAME_REQUIRED' }
    }

    // Check payment requirement (for takeout/delivery)
    if (workflowRules.requirePaymentBeforeSend) {
      // This would check if payment has been made
      // For now, we'll prompt user to pay first
      return { valid: false, message: 'Payment is required before sending this order type to kitchen. Please collect payment first.' }
    }

    return { valid: true }
  }

  // Send to Kitchen handler — delegates to shared useActiveOrder hook
  // which handles: ensureOrderInDB, isHeld filtering, per-item delays, coursing, and /send API call
  const handleSendToKitchen = async () => {
    if (!currentOrder?.items.length) return

    // Validate based on workflow rules (page-specific logic)
    const validation = validateBeforeSend()
    if (!validation.valid) {
      if (validation.message === 'TABLE_REQUIRED') {
        toast.warning('Please select a table from the floor plan')
        return
      }
      if (validation.message === 'TAB_NAME_REQUIRED') {
        // Show tab name prompt, then retry send after name is entered
        setTabNameCallback(() => () => handleSendToKitchen())
        setShowTabNamePrompt(true)
        return
      }
      // If payment is required, open payment modal
      const orderTypeConfig = orderTypes.find(t => t.slug === currentOrder.orderType)
      const workflowRules = (orderTypeConfig?.workflowRules || {}) as WorkflowRules
      if (workflowRules.requirePaymentBeforeSend) {
        toast.warning('Payment is required before sending this order')
        handleOpenPayment()
      } else {
        toast.warning(validation.message || 'Cannot send order')
      }
      return
    }

    setIsSendingOrder(true)
    try {
      // Use the shared hook — handles ensureOrderInDB, isHeld filtering, delays, coursing, /send
      await activeOrderFull.handleSendToKitchen(employee?.id)

      // After hook completes, get the order ID for printing/cleanup
      const orderId = useOrderStore.getState().currentOrder?.id || savedOrderId
      if (orderId) {
        const orderNum = orderId.slice(-6).toUpperCase()

        // Optimistic: mark table as occupied immediately so floor plan
        // tile turns blue without waiting for full snapshot reload
        const sentTableId = useOrderStore.getState().currentOrder?.tableId
        if (sentTableId) {
          addTableOrder(sentTableId, {
            id: orderId,
            orderNumber: parseInt(orderNum, 10) || 0,
            guestCount: currentOrder?.items.length || 0,
            total: currentOrder?.subtotal || 0,
            openedAt: new Date().toISOString(),
            server: employee?.id || '',
            status: 'sent',
          })
        }

        // Clear UI IMMEDIATELY — don't block on print
        clearOrder()
        setSavedOrderId(null)
        setOrderSent(false)
        setSelectedOrderType(null)
        setOrderCustomFields({})
        setTabsRefreshTrigger(prev => prev + 1)
        setFloorPlanRefreshTrigger(prev => prev + 1)
        toast.success(`Order #${orderNum} sent to kitchen`)

        // Return to floor plan (if not bartender)
        if (!isBartender) {
          setViewMode('floor-plan')
        }

        // Print kitchen ticket in background (fire-and-forget)
        printKitchenTicket(orderId).catch(() => {})
      }
    } finally {
      setIsSendingOrder(false)
    }
  }

  // Print kitchen ticket when order is sent
  const printKitchenTicket = async (orderId: string) => {
    try {
      const response = await fetch('/api/print/kitchen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      })

      if (!response.ok) {
        console.error('Failed to print kitchen ticket')
      }
    } catch (err) {
      console.error('Failed to print kitchen ticket:', err)
    }
  }

  // Start timers for entertainment items when order is sent
  // Reads from store instead of refetching — order was just saved
  const startEntertainmentTimers = async (_orderId: string) => {
    try {
      const storeItems = useOrderStore.getState().currentOrder?.items || []

      for (const item of storeItems) {
        const menuItem = menuItems.find(m => m.id === item.menuItemId)

        if (menuItem?.itemType === 'timed_rental' && !item.blockTimeStartedAt) {
          const blockMinutes = menuItem.blockTimeMinutes || 60

          await fetch('/api/entertainment/block-time', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderItemId: item.id,
              minutes: blockMinutes,
            }),
          })
        }
      }
    } catch (err) {
      console.error('Failed to start entertainment timers:', err)
    }
  }

  // Handle resending an item to the kitchen (KDS) - opens modal
  const handleResendItem = (itemId: string, itemName: string) => {
    setResendNote('')
    setResendModal({ itemId, itemName })
  }

  // Actually perform the resend after modal confirmation
  const confirmResendItem = async () => {
    if (!resendModal) return

    setResendLoading(true)
    try {
      const response = await fetch('/api/kds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemIds: [resendModal.itemId],
          action: 'resend',
          resendNote: resendNote.trim() || undefined,
        }),
      })

      if (response.ok) {
        // Success - close modal (no blocking alert)
        setResendModal(null)
        setResendNote('')
      } else {
        console.error('Failed to resend item')
      }
    } catch (error) {
      console.error('Failed to resend item:', error)
    } finally {
      setResendLoading(false)
    }
  }

  // Handle selecting an open order to continue working on it
  const handleSelectOpenOrder = (order: OpenOrder) => {
    // Load the order into the current order state
    loadOrder({
      id: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      tableId: order.tableId || undefined,
      tableName: order.table?.name || undefined,
      tabName: order.tabName || undefined,
      guestCount: order.guestCount,
      items: order.items,
      subtotal: order.subtotal,
      taxTotal: order.taxTotal,
      total: order.total,
    })

    // Track that this is a saved order (but allow sending updates)
    setSavedOrderId(order.id)
    setOrderSent(false) // Allow sending updates to kitchen

    // Restore tab card info from pre-auth data (so "Add to Tab" works correctly)
    if (order.hasPreAuth && order.preAuth?.last4) {
      setTabCardInfo({
        cardholderName: order.cardholderName || undefined,
        cardLast4: order.preAuth.last4,
        cardType: order.preAuth.cardBrand,
      })
    }

    // Close the panel
    setShowTabsPanel(false)
  }

  // Payment handlers
  const handleOpenPayment = async () => {
    // Split parent → route to split manager (parent total is $0, children have the money)
    if (currentOrder?.status === 'split') {
      setSplitManageMode(true)
      setShowSplitTicketManager(true)
      return
    }

    // Allow payment if there are items OR if the order has a total (split orders)
    const hasItems = currentOrder?.items.length && currentOrder.items.length > 0
    const hasSplitTotal = currentOrder?.total && currentOrder.total > 0 && !hasItems
    if (!hasItems && !hasSplitTotal) return

    let orderId = savedOrderId
    if (!orderId) {
      // Edge case: no draft shell was created (e.g., loaded from Open Orders)
      // Fall back to blocking await
      setIsSendingOrder(true)
      try {
        orderId = await ensureOrderInDB(employee?.id)
        if (orderId) setSavedOrderId(orderId)
      } finally {
        setIsSendingOrder(false)
      }
      if (!orderId) return
    }

    // Open modal IMMEDIATELY — items persist in background while user
    // interacts with payment method selection (~1-3 seconds of overlap)
    setOrderToPayId(orderId)

    // Start items persist in background (store promise for PaymentModal to await)
    orderReadyPromiseRef.current = ensureOrderInDB(employee?.id)

    // Fetch pre-authed tab cards in parallel
    fetch(`/api/orders/${orderId}/cards`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(d => {
        const authorized = (d.data || []).filter((c: { status: string }) => c.status === 'authorized')
        setPaymentTabCards(authorized)
        // Don't auto-skip — show method selection so user sees cards and can pick which to charge
      })
      .catch(() => setPaymentTabCards([]))

    setShowPaymentModal(true)
  }

  // Pay All Splits — clean up after successful batch pay
  const cleanupAfterPayAllSplits = () => {
    setShowPayAllSplitsConfirm(false)
    setPayAllSplitsParentId(null)
    setPayAllSplitsTotal(0)
    setPayAllSplitsStep('confirm')
    setShowSplitTicketManager(false)
    setSplitManageMode(false)
    clearOrder()
    setSavedOrderId(null)
    setOrderSent(false)
    setFloorPlanRefreshTrigger(prev => prev + 1)
    setTabsRefreshTrigger(prev => prev + 1)
  }

  // Pay All Splits — call batch API (used for cash directly, and after Datacap success for card)
  const callPayAllSplitsAPI = async (method: string, cardDetails?: {
    cardBrand?: string; cardLast4?: string; authCode?: string;
    datacapRecordNo?: string; datacapRefNumber?: string; datacapSequenceNo?: string;
    entryMethod?: string; amountAuthorized?: number;
  }) => {
    if (!payAllSplitsParentId) return
    setPayAllSplitsProcessing(true)
    try {
      const res = await fetch(`/api/orders/${payAllSplitsParentId}/pay-all-splits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method,
          employeeId: employee?.id,
          terminalId: TERMINAL_ID,
          ...cardDetails,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        toast.error(err.error || 'Failed to pay all splits')
        return
      }
      const data = await res.json()
      toast.success(`All ${data.data.splitsPaid} splits paid — $${data.data.totalAmount.toFixed(2)}`)
      cleanupAfterPayAllSplits()
    } catch {
      toast.error('Failed to pay all splits')
    } finally {
      setPayAllSplitsProcessing(false)
    }
  }

  const handleReceiptClose = () => {
    setShowReceiptModal(false)
    setReceiptOrderId(null)
    // Clear order after receipt is dismissed
    setSavedOrderId(null)
    setOrderSent(false)
    clearOrder()
    // Return to floor plan (if not bartender)
    if (!isBartender) {
      setViewMode('floor-plan')
    }
  }

  // Handle order settings save (tab name, guests, gratuity)
  const handleOrderSettingsSave = async (settings: {
    tabName?: string
    guestCount?: number
    tipTotal?: number
    separateChecks?: boolean
  }) => {
    if (!savedOrderId) return

    const response = await fetch(`/api/orders/${savedOrderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })

    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Failed to save settings')
    }

    // Reload the order from API to get updated values
    const orderResponse = await fetch(`/api/orders/${savedOrderId}`)
    if (orderResponse.ok) {
      const orderData = await orderResponse.json()
      loadOrder(orderData.data || orderData)
    }

    // Refresh tabs panel
    setTabsRefreshTrigger(prev => prev + 1)
  }

  // Handle opening split ticket manager (to create separate tickets)
  const handleOpenSplitTicket = () => {
    if (!currentOrder?.items.length) return

    // Show split screen immediately with in-memory items
    setShowSplitTicketManager(true)

    // If order not saved yet, persist in background (split Save will use savedOrderId once ready)
    if (!savedOrderId) {
      orderReadyPromiseRef.current = ensureOrderInDB(employee?.id).then(id => {
        if (id) setSavedOrderId(id)
        return id
      })
    }
  }

  // Handle quick split evenly (÷2 shortcut button)
  const handleQuickSplitEvenly = useCallback(async (numWays: number) => {
    const orderId = savedOrderId
    if (!orderId) return
    try {
      const res = await fetch(`/api/orders/${orderId}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'even', numWays }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to split')
        return
      }
      toast.success(`Split ${numWays} ways`)
      // Reload the order to pick up split state
      const orderResponse = await fetch(`/api/orders/${orderId}`)
      if (orderResponse.ok) {
        const orderData = await orderResponse.json()
        loadOrder(orderData)
      }
      setFloorPlanRefreshTrigger(prev => prev + 1)
    } catch {
      toast.error('Failed to split order')
    }
  }, [savedOrderId])

  // Handle opening discount modal
  const handleOpenDiscount = async () => {
    if (!currentOrder?.items.length) return

    // If order hasn't been saved yet, save it first
    let orderId = savedOrderId
    if (!orderId) {
      setIsSendingOrder(true)
      try {
        orderId = await ensureOrderInDB(employee?.id)
        if (orderId) {
          setSavedOrderId(orderId)
        }
      } finally {
        setIsSendingOrder(false)
      }
    }

    if (orderId) {
      // Load existing discounts for this order
      try {
        const response = await fetch(`/api/orders/${orderId}/discount`)
        if (response.ok) {
          const data = await response.json()
          setAppliedDiscounts(data.data?.discounts || [])
        }
      } catch (err) {
        console.error('Failed to load discounts:', err)
      }
      setOrderToPayId(orderId)
      setShowDiscountModal(true)
    }
  }

  // Handle discount applied
  const handleDiscountApplied = (newTotals: {
    discountTotal: number
    taxTotal: number
    total: number
  }) => {
    // Reload the order discounts
    if (orderToPayId) {
      fetch(`/api/orders/${orderToPayId}/discount`)
        .then(res => res.json())
        .then(data => {
          setAppliedDiscounts(data.data?.discounts || [])
        })
        .catch(console.error)
    }
    // Trigger a refresh of the tabs/orders to update totals
    setTabsRefreshTrigger(prev => prev + 1)
  }

  // Comp/Void handlers
  const handleOpenCompVoid = async (item: OrderItem) => {
    // If order hasn't been saved yet, save it first
    let orderId = savedOrderId
    if (!orderId) {
      setIsSendingOrder(true)
      try {
        orderId = await ensureOrderInDB(employee?.id)
        if (orderId) {
          setSavedOrderId(orderId)
        }
      } finally {
        setIsSendingOrder(false)
      }
    }

    if (orderId) {
      setOrderToPayId(orderId)
      setCompVoidItem(item)
      setShowCompVoidModal(true)
    }
  }

  const handleCompVoidComplete = async (result: {
    action: 'comp' | 'void' | 'restore'
    item?: { id: string }
    orderAutoClosed?: boolean
    orderTotals: {
      subtotal: number
      discountTotal: number
      taxTotal: number
      total: number
    }
  }) => {
    // Trigger a refresh to update order display
    setTabsRefreshTrigger(prev => prev + 1)
    setShowCompVoidModal(false)

    // If all items were voided/comped and order was auto-closed, clear it
    if (result.orderAutoClosed) {
      clearOrder()
      setSavedOrderId(null)
      setCompVoidItem(null)
      return
    }

    // Immediately update totals from comp-void response (prevents stale total in PaymentModal)
    const { syncServerTotals } = useOrderStore.getState()
    syncServerTotals(result.orderTotals)

    // Also update the item status in the store for instant UI feedback
    if (result.item?.id && result.action !== 'restore') {
      updateItem(result.item.id, { status: result.action === 'void' ? 'voided' : 'comped' })
    }

    // Reload full order from API so voided/comped items show complete updated status
    const orderId = savedOrderId || orderToPayId
    if (orderId) {
      try {
        const res = await fetch(`/api/orders/${orderId}`)
        if (res.ok) {
          const data = await res.json()
          loadOrder(data)
        }
      } catch (err) {
        console.error('Failed to reload order after comp/void:', err)
      }
    }
    setCompVoidItem(null)
  }

  // OrderPanel item control handlers
  // Shared handlers (useActiveOrder) already call the API AND update the Zustand store.
  // No need to refetch the full order afterwards.
  const handleHoldToggle = async (itemId: string) => {
    await sharedHoldToggle(itemId)
  }

  const handleNoteEdit = async (itemId: string, currentNote?: string) => {
    await sharedNoteEdit(itemId, currentNote)
  }

  const handleCourseChange = async (itemId: string, course: number | null) => {
    await sharedCourseChange(itemId, course)
  }

  const handleEditModifiers = (itemId: string) => {
    const fullItem = currentOrder?.items.find(i => i.id === itemId)
    if (fullItem) {
      handleEditOrderItem(fullItem)
    }
  }

  const handleCompVoid = async (item: OrderPanelItemData) => {
    await handleOpenCompVoid({
      id: item.id,
      menuItemId: item.menuItemId || '',
      name: item.name,
      quantity: item.quantity,
      price: Number(item.price),
      modifiers: item.modifiers?.map(m => ({
        id: m.id,
        name: m.name,
        price: Number(m.price)
      })) || [],
    })
  }

  const handleResend = async (item: OrderPanelItemData) => {
    // sharedResend already calls loadOrder() internally
    await sharedResend(item.id)
  }

  // handleToggleExpand now comes from useActiveOrder hook — no local function needed

  const handleSeatChange = async (itemId: string, seat: number | null) => {
    await sharedSeatChange(itemId, seat)
  }

  // Flash split chips to draw attention when user tries to add items to a split parent
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
    }
  }, [])

  const handleAddItem = async (item: MenuItem) => {
    if (!item.isAvailable) return

    // Block adding items directly to a split parent — must select a split first
    if (currentOrder?.status === 'split' && orderSplitChips.length > 0) {
      toast.warning('Select a split check or add a new one')
      setSplitChipsFlashing(true)
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
      flashTimeoutRef.current = setTimeout(() => setSplitChipsFlashing(false), 1500)
      return
    }

    // Handle combo items
    if (item.itemType === 'combo') {
      setSelectedComboItem(item)
      setComboSelections({})
      setShowComboModal(true)

      // Load combo template
      try {
        const response = await fetch(`/api/combos/${item.id}`)
        if (response.ok) {
          const data = await response.json()
          setComboTemplate(data.data?.template)
        }
      } catch (error) {
        console.error('Failed to load combo template:', error)
      }
      return
    }

    // Handle timed rental items
    if (item.itemType === 'timed_rental') {
      // If item is in use, show toast instead of adding
      if (item.entertainmentStatus === 'in_use') {
        toast.warning(`${item.name} is currently in use`)
        return
      }
      // Otherwise show the normal rental modal
      setSelectedTimedItem(item)
      setSelectedRateType('perHour')
      setShowTimedRentalModal(true)
      return
    }

    // Handle pizza items - check if item is in a pizza category
    if (selectedCategoryData?.categoryType === 'pizza') {
      setSelectedPizzaItem(item)
      setShowPizzaModal(true)
      return
    }

    // Check if item has modifiers
    if (item.modifierGroupCount && item.modifierGroupCount > 0) {
      setSelectedItem(item)
      setLoadingModifiers(true)
      setShowModifierModal(true)

      try {
        const response = await fetch(`/api/menu/items/${item.id}/modifier-groups`)
        if (response.ok) {
          const data = await response.json()
          setItemModifierGroups(data.data || [])
        }
      } catch (error) {
        console.error('Failed to load modifiers:', error)
      } finally {
        setLoadingModifiers(false)
      }
    } else {
      // No modifiers, add directly
      addItem({
        menuItemId: item.id,
        name: item.name,
        price: item.price,
        quantity: 1,
        modifiers: [],
      })
    }
  }

  // Handle quick bar item click - add to order (T035)
  const handleQuickBarItemClick = async (itemId: string) => {
    try {
      const res = await fetch(`/api/menu/items/${itemId}`)
      if (!res.ok) return

      const resp = await res.json()
      const item = resp.data?.item || resp.item
      handleAddItem({
        id: item.id,
        name: item.name,
        price: Number(item.price),
        categoryId: item.categoryId,
        isAvailable: item.isAvailable ?? true,
        itemType: item.itemType,
        modifierGroupCount: item.modifierGroups?.length || 0,
      } as MenuItem)
    } catch (error) {
      console.error('[Orders] Quick bar item load error:', error)
    }
  }

  const handleAddItemWithModifiers = (modifiers: SelectedModifier[], specialNotes?: string, pourSize?: string, pourMultiplier?: number, ingredientModifications?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]) => {
    if (!selectedItem) return

    // T023: If there's an inline modifier callback, call it and return
    // This is used when adding items from the floor plan inline ordering
    if (inlineModifierCallbackRef.current) {
      const applyToMods = selectedItem.applyPourToModifiers && pourMultiplier
      const simplifiedModifiers = modifiers.map(mod => ({
        id: mod.id ?? '',
        modifierId: mod.id,
        name: mod.name,
        price: applyToMods && pourMultiplier ? mod.price * pourMultiplier : mod.price,
        depth: mod.depth ?? 0,
        preModifier: mod.preModifier ?? null,
        spiritTier: mod.spiritTier ?? null,
        linkedBottleProductId: mod.linkedBottleProductId ?? null,
        parentModifierId: mod.parentModifierId ?? null,
      }))
      inlineModifierCallbackRef.current(simplifiedModifiers, ingredientModifications)
      inlineModifierCallbackRef.current = null
      setShowModifierModal(false)
      setSelectedItem(null)
      setItemModifierGroups([])
      setEditingOrderItem(null)
      return
    }

    // Apply pour multiplier to base price
    // Note: pourMultiplier applies to spirit modifiers only, not ingredient priceAdjustments.
    // Ingredient pricing is always flat. Liquor pricing is handled by the Liquor Builder (future).
    const basePrice = pourMultiplier ? selectedItem.price * pourMultiplier : selectedItem.price
    const applyToMods = selectedItem.applyPourToModifiers && pourMultiplier

    // Build item name with pour size
    const itemName = pourSize
      ? `${selectedItem.name} (${pourSize.charAt(0).toUpperCase() + pourSize.slice(1)})`
      : selectedItem.name

    addItem({
      menuItemId: selectedItem.id,
      name: itemName,
      price: basePrice,
      quantity: 1,
      specialNotes,
      modifiers: modifiers.map(mod => ({
        id: mod.id ?? '',
        modifierId: mod.id,
        name: mod.name,
        price: applyToMods ? mod.price * pourMultiplier : mod.price,
        depth: mod.depth ?? 0,
        preModifier: mod.preModifier ?? null,
        spiritTier: mod.spiritTier ?? null,
        linkedBottleProductId: mod.linkedBottleProductId ?? null,
        parentModifierId: mod.parentModifierId ?? null,
      })),
      ingredientModifications: ingredientModifications?.map(mod => ({
        ingredientId: mod.ingredientId,
        name: mod.name,
        modificationType: mod.modificationType as IngredientModificationType,
        priceAdjustment: mod.priceAdjustment,
        swappedTo: mod.swappedTo,
      })),
    })

    setShowModifierModal(false)
    setSelectedItem(null)
    setItemModifierGroups([])
    setEditingOrderItem(null)
  }

  // Handle adding pizza to order
  const handleAddPizzaToOrder = (config: PizzaOrderConfig) => {
    if (!selectedPizzaItem) return

    // T023: Check if this is inline ordering callback
    if (inlinePizzaCallbackRef.current) {
      inlinePizzaCallbackRef.current(config)
      inlinePizzaCallbackRef.current = null
      setShowPizzaModal(false)
      setSelectedPizzaItem(null)
      setEditingPizzaItem(null)
      return
    }

    // Build display name with size info
    const itemName = selectedPizzaItem.name

    // Build modifiers array organized by section boxes (extracted to pizza-order-utils)
    const pizzaModifiers = buildPizzaModifiers(config)

    // FIX-004: Use base price only (size + crust + sauce + cheese)
    // Toppings are in modifiers, not in item.price
    const basePrice = getPizzaBasePrice(config)

    // Development validation
    if (process.env.NODE_ENV === 'development') {
      const tempItem = {
        id: 'temp',
        menuItemId: selectedPizzaItem.id,
        name: itemName,
        price: basePrice,
        quantity: 1,
        modifiers: pizzaModifiers.map(m => ({ ...m, quantity: 1 })),
        pizzaConfig: config,
      } as any
      debugPizzaPricing(tempItem, 'orders-page-add')
    }

    if (editingPizzaItem) {
      // Update existing item
      updateItem(editingPizzaItem.id, {
        name: itemName,
        price: basePrice,  // ✅ FIX-004: Base price only, not totalPrice
        specialNotes: config.specialNotes,
        modifiers: pizzaModifiers,
        pizzaConfig: config,
      })
    } else {
      // Add new item
      addItem({
        menuItemId: selectedPizzaItem.id,
        name: itemName,
        price: basePrice,  // ✅ FIX-004: Base price only, not totalPrice
        quantity: 1,
        specialNotes: config.specialNotes,
        modifiers: pizzaModifiers,
        pizzaConfig: config,
      })
    }

    setShowPizzaModal(false)
    setSelectedPizzaItem(null)
    setEditingPizzaItem(null)
  }

  // Handle adding combo to order with selections from ComboStepFlow
  const handleAddComboToOrderWithSelections = (selections: Record<string, Record<string, string[]>>) => {
    if (!selectedComboItem || !comboTemplate) return

    // Calculate total with upcharges and build modifiers for KDS display
    let totalUpcharge = 0
    const comboModifiers: SelectedModifier[] = []

    for (const component of comboTemplate.components) {
      // New structure: component has menuItem with modifierGroups
      if (component.menuItem) {
        // Add the item itself as a modifier line for KDS
        comboModifiers.push({
          id: `combo-item-${component.id}`,
          name: component.displayName,
          price: 0, // Item price is included in combo base
          depth: 0,
        })

        // Process each modifier group for this item
        const componentSelections = selections[component.id] || {}
        for (const mg of component.menuItem.modifierGroups || []) {
          const groupSelections = componentSelections[mg.modifierGroup.id] || []
          for (const modifierId of groupSelections) {
            const modifier = mg.modifierGroup.modifiers.find(m => m.id === modifierId)
            if (modifier) {
              // Check for price override - in combos, modifiers are included ($0) unless explicitly set as upcharge
              const overridePrice = component.modifierPriceOverrides?.[modifier.id]
              const price = overridePrice !== undefined ? overridePrice : 0
              totalUpcharge += price
              comboModifiers.push({
                id: `combo-${component.id}-${modifier.id}`,
                name: `  - ${modifier.name}`,
                price: price,
                depth: 1,
              })
            }
          }
        }
      } else if (component.options && component.options.length > 0) {
        // Legacy: use options array (flat structure)
        const legacySelections = (selections[component.id] as unknown as string[]) || []
        for (const optionId of legacySelections) {
          const option = component.options.find(o => o.id === optionId)
          if (option) {
            totalUpcharge += option.upcharge
            comboModifiers.push({
              id: `combo-${component.id}-${option.id}`,
              name: `${component.displayName}: ${option.name}`,
              price: option.upcharge,
              depth: 0,
            })
          }
        }
      }
    }

    addItem({
      menuItemId: selectedComboItem.id,
      name: selectedComboItem.name,
      price: comboTemplate.basePrice,  // Base price only - modifier upcharges are added separately
      quantity: 1,
      modifiers: comboModifiers,
    })

    setShowComboModal(false)
    setSelectedComboItem(null)
    setComboTemplate(null)
    setComboSelections({})
  }

  // Handle adding combo to order (legacy inline modal - kept for backward compatibility)
  const handleAddComboToOrder = () => {
    handleAddComboToOrderWithSelections(comboSelections)
  }

  // Handle starting a timed rental session
  const handleStartTimedSession = async (rateType?: 'per15Min' | 'per30Min' | 'perHour') => {
    if (!selectedTimedItem || !employee?.location?.id) return

    const effectiveRateType = rateType || selectedRateType

    const pricing = selectedTimedItem.timedPricing as { per15Min?: number; per30Min?: number; perHour?: number; minimum?: number } | null

    // Get the rate - try selected type first, then fall back
    let rateAmount = selectedTimedItem.price
    if (pricing) {
      rateAmount = pricing[effectiveRateType] || pricing.perHour || pricing.per30Min || pricing.per15Min || selectedTimedItem.price
    }

    // Calculate block time in minutes based on selected rate type
    let blockMinutes = 60 // default to 1 hour
    if (effectiveRateType === 'per15Min') blockMinutes = 15
    else if (effectiveRateType === 'per30Min') blockMinutes = 30
    else if (effectiveRateType === 'perHour') blockMinutes = 60

    // T023: Check if this is inline ordering callback - skip API session creation
    if (inlineTimedRentalCallbackRef.current) {
      inlineTimedRentalCallbackRef.current(rateAmount, blockMinutes)
      inlineTimedRentalCallbackRef.current = null
      setShowTimedRentalModal(false)
      setSelectedTimedItem(null)
      return
    }

    setLoadingSession(true)
    try {
      const response = await fetch('/api/timed-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: employee?.location?.id,
          menuItemId: selectedTimedItem.id,
          rateType: effectiveRateType,
          rateAmount,
          startedById: employee.id,
        }),
      })

      if (response.ok) {
        const session = await response.json()

        // Add to active sessions tracking
        setActiveSessions(prev => [...prev, {
          id: session.id,
          menuItemId: selectedTimedItem.id,
          menuItemName: selectedTimedItem.name,
          startedAt: session.startedAt,
          rateType: effectiveRateType,
          rateAmount,
        }])

        // Add a placeholder item to the order showing active session
        const rateLabel = effectiveRateType.replace('per', '').replace('Min', ' min').replace('Hour', '/hr')
        addItem({
          menuItemId: selectedTimedItem.id,
          name: `⏱️ ${selectedTimedItem.name} (Active)`,
          price: 0, // Price calculated when stopped
          quantity: 1,
          modifiers: [],
          specialNotes: `Session ID: ${session.id} | Rate: ${formatCurrency(rateAmount)}${rateLabel}`,
        })

        setShowTimedRentalModal(false)
        setSelectedTimedItem(null)

        // Refresh menu to update entertainment item status
        throttledLoadMenu()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to start session')
      }
    } catch (error) {
      console.error('Failed to start timed session:', error)
      toast.error('Failed to start session')
    } finally {
      setLoadingSession(false)
    }
  }

  // Handle stopping a timed session and billing
  const handleStopTimedSession = async (sessionId: string) => {
    if (!confirm('Stop this session and calculate charges?')) return

    try {
      const response = await fetch(`/api/timed-sessions/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      })

      if (response.ok) {
        const result = await response.json()
        const session = activeSessions.find(s => s.id === sessionId)

        if (session) {
          // Find the order item with session ID in notes
          const orderItem = currentOrder?.items.find(item =>
            item.specialNotes?.includes(`Session ID: ${sessionId}`)
          )

          if (orderItem) {
            // Update the existing placeholder item with final price
            updateItem(orderItem.id, {
              name: `${session.menuItemName} (${result.totalMinutes} min)`,
              price: result.totalAmount || result.totalCharge,
              specialNotes: `Billed: ${result.totalMinutes} min @ ${formatCurrency(session.rateAmount)}`,
            })
          } else if (currentOrder) {
            // Add a new item to the current order with the final charges
            addItem({
              menuItemId: session.menuItemId,
              name: `${session.menuItemName} (${result.totalMinutes} min)`,
              price: result.totalAmount || result.totalCharge,
              quantity: 1,
              modifiers: [],
              specialNotes: `Billed: ${result.totalMinutes} min @ ${formatCurrency(session.rateAmount)}`,
            })
          }
        }

        // Remove from active sessions
        setActiveSessions(prev => prev.filter(s => s.id !== sessionId))

        // Refresh menu to update entertainment item status
        throttledLoadMenu()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to stop session')
      }
    } catch (error) {
      console.error('Failed to stop session:', error)
      toast.error('Failed to stop session')
    }
  }

  // Handle search result selection from UnifiedPOSHeader
  const handleSearchSelect = useCallback((item: { id: string; name: string; price: number; categoryId: string }) => {
    // Find full menu item data
    const fullItem = menuItems.find((m: any) => m.id === item.id)
    if (fullItem) {
      // Add item to order via the ordering engine (works for both floor plan and bartender)
      const { addItem } = useOrderStore.getState()
      addItem({
        menuItemId: fullItem.id,
        name: fullItem.name,
        price: fullItem.price,
        quantity: 1,
        modifiers: [],
        categoryType: (fullItem as any).categoryType,
      })
    }
    menuSearch.clearSearch()
  }, [menuItems, menuSearch])

  // Handle opening entertainment session start modal
  // Shared handler for opening modifier modal from FloorPlanHome/BartenderView inline ordering
  // Called by useOrderingEngine via onOpenModifiers(item, onComplete, existingModifiers, existingIngredientMods)
  const handleOpenModifiersShared = useCallback(async (
    item: MenuItem,
    onComplete: (modifiers: { id: string; name: string; price: number; depth?: number; preModifier?: string | null }[], ingredientModifications?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]) => void,
    existingModifiers?: { id: string; name: string; price: number; depth?: number; preModifier?: string | null }[],
    existingIngredientMods?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]
  ) => {
    try {
      inlineModifierCallbackRef.current = onComplete
      setLoadingModifiers(true)
      setSelectedItem(item)

      // If editing (existingModifiers provided), set editingOrderItem so ModifierModal restores selections
      if ((existingModifiers && existingModifiers.length > 0) || existingIngredientMods) {
        setEditingOrderItem({
          id: 'inline-edit',
          menuItemId: item.id,
          modifiers: (existingModifiers || []).map((m: Record<string, unknown>) => ({
            id: String(m.id || ''),
            name: String(m.name || ''),
            price: Number(m.price || 0),
            depth: Number(m.depth ?? 0),
            parentModifierId: m.parentModifierId ? String(m.parentModifierId) : undefined,
          })),
          ingredientModifications: existingIngredientMods as { ingredientId: string; name: string; modificationType: 'no' | 'lite' | 'on_side' | 'extra' | 'swap'; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[],
        })
      }
      setShowModifierModal(true)

      const response = await fetch(`/api/menu/items/${item.id}/modifier-groups`)
      if (response.ok) {
        const data = await response.json()
        setItemModifierGroups(data.data || [])
      }
      setLoadingModifiers(false)
    } catch (error) {
      console.error('Failed to load modifiers:', error)
      setLoadingModifiers(false)
      inlineModifierCallbackRef.current = null
    }
  }, [])
  // Wire up the ref so useOrderingEngine can call it
  handleOpenModifiersSharedRef.current = handleOpenModifiersShared

  const handleOpenTimedRental = (
    item: any,
    onComplete: (price: number, blockMinutes: number) => void
  ) => {
    // Store item info for the modal
    setEntertainmentItem({
      id: item.id,
      name: item.name,
      ratePerMinute: (item as any).ratePerMinute || 0.25,
      prepaidPackages: (item as any).prepaidPackages || [],
      happyHourEnabled: (item as any).happyHourEnabled || false,
      happyHourPrice: (item as any).happyHourPrice || null,
    })
    setShowEntertainmentStart(true)
    // Store callback for later use if needed
    inlineTimedRentalCallbackRef.current = onComplete
  }

  // Handle starting entertainment with new tab
  const handleStartEntertainmentWithNewTab = async (tabName: string, pkg?: PrepaidPackage) => {
    if (!entertainmentItem || !employee?.location?.id) return

    try {
      // 1. Create new order
      const orderRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: employee?.location?.id,
          employeeId: employee.id,
          orderType: 'bar_tab',
          tabName,
        }),
      })
      const orderData = await orderRes.json()
      const orderId = orderData.data?.id

      if (!orderId) throw new Error('Failed to create order')

      // 2. Add entertainment item to order
      const itemRes = await fetch(`/api/orders/${orderId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          menuItemId: entertainmentItem.id,
          quantity: 1,
          price: pkg?.price || 0,
          blockTimeMinutes: pkg?.minutes || 0,
        }),
      })
      const itemData = await itemRes.json()

      // 3. Start the timer if prepaid
      if (pkg && itemData.data?.id) {
        await fetch('/api/entertainment/block-time', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderItemId: itemData.data.id,
            locationId: employee?.location?.id,
            minutes: pkg.minutes,
          }),
        })
      }

      setShowEntertainmentStart(false)
      setEntertainmentItem(null)
      throttledLoadMenu()
    } catch (err) {
      console.error('Failed to start entertainment session:', err)
      toast.error('Failed to start session')
    }
  }

  // Handle starting entertainment with existing tab
  const handleStartEntertainmentWithExistingTab = async (orderId: string, pkg?: PrepaidPackage) => {
    if (!entertainmentItem || !employee?.location?.id) return

    try {
      // Add item to existing order
      const itemRes = await fetch(`/api/orders/${orderId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          menuItemId: entertainmentItem.id,
          quantity: 1,
          price: pkg?.price || 0,
          blockTimeMinutes: pkg?.minutes || 0,
        }),
      })
      const itemData = await itemRes.json()

      // Start timer if prepaid
      if (pkg && itemData.data?.id) {
        await fetch('/api/entertainment/block-time', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderItemId: itemData.data.id,
            locationId: employee?.location?.id,
            minutes: pkg.minutes,
          }),
        })
      }

      setShowEntertainmentStart(false)
      setEntertainmentItem(null)
      throttledLoadMenu()
    } catch (err) {
      console.error('Failed to add entertainment to order:', err)
      toast.error('Failed to add to order')
    }
  }

  // Handle starting entertainment with current order
  const handleStartEntertainmentWithCurrentOrder = async (pkg?: PrepaidPackage) => {
    // Use savedOrderId if available
    const orderId = savedOrderId
    if (orderId) {
      await handleStartEntertainmentWithExistingTab(orderId, pkg)
    }
  }

  // Handle editing an existing order item
  const handleEditOrderItem = async (orderItem: NonNullable<typeof currentOrder>['items'][0]) => {
    // Find the menu item
    const menuItem = menuItems.find(m => m.id === orderItem.menuItemId)
    if (!menuItem) return

    // Check if this is a pizza item (has pizzaConfig)
    if (orderItem.pizzaConfig) {
      setSelectedPizzaItem(menuItem)
      setEditingPizzaItem({
        id: orderItem.id,
        pizzaConfig: orderItem.pizzaConfig,
      })
      setShowPizzaModal(true)
      return
    }

    if (menuItem.modifierGroupCount && menuItem.modifierGroupCount > 0) {
      setSelectedItem(menuItem)
      setEditingOrderItem({
        id: orderItem.id,
        menuItemId: orderItem.menuItemId,
        modifiers: orderItem.modifiers.map(m => ({
          id: m.id,
          name: m.name,
          price: m.price,
          depth: m.depth ?? 0,
          parentModifierId: m.parentModifierId ?? undefined,
        })),
        ingredientModifications: orderItem.ingredientModifications,
        specialNotes: orderItem.specialNotes,
      })
      setLoadingModifiers(true)
      setShowModifierModal(true)

      try {
        const response = await fetch(`/api/menu/items/${menuItem.id}/modifiers`)
        if (response.ok) {
          const data = await response.json()
          setItemModifierGroups(data.data?.modifierGroups || [])
        }
      } catch (error) {
        console.error('Failed to load modifiers:', error)
      } finally {
        setLoadingModifiers(false)
      }
    }
  }

  const handleUpdateItemWithModifiers = (modifiers: SelectedModifier[], specialNotes?: string, pourSize?: string, pourMultiplier?: number, ingredientModifications?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]) => {
    if (!selectedItem || !editingOrderItem) return

    // Apply pour multiplier to base price
    // Note: pourMultiplier applies to spirit modifiers only, not ingredient priceAdjustments.
    // Ingredient pricing is always flat. Liquor pricing is handled by the Liquor Builder (future).
    const basePrice = pourMultiplier ? selectedItem.price * pourMultiplier : selectedItem.price
    const applyToMods = selectedItem.applyPourToModifiers && pourMultiplier

    // Build item name with pour size
    const itemName = pourSize
      ? `${selectedItem.name} (${pourSize.charAt(0).toUpperCase() + pourSize.slice(1)})`
      : selectedItem.name

    updateItem(editingOrderItem.id, {
      name: itemName,
      price: basePrice,
      specialNotes,
      modifiers: modifiers.map(mod => ({
        id: mod.id ?? '',
        modifierId: mod.id,
        name: mod.name,
        price: applyToMods ? mod.price * pourMultiplier : mod.price,
        depth: mod.depth ?? 0,
        preModifier: mod.preModifier ?? null,
        spiritTier: mod.spiritTier ?? null,
        linkedBottleProductId: mod.linkedBottleProductId ?? null,
        parentModifierId: mod.parentModifierId ?? null,
      })),
      ingredientModifications: ingredientModifications?.map(mod => ({
        ingredientId: mod.ingredientId,
        name: mod.name,
        modificationType: mod.modificationType as IngredientModificationType,
        priceAdjustment: mod.priceAdjustment,
        swappedTo: mod.swappedTo,
      })),
    })

    setShowModifierModal(false)
    setSelectedItem(null)
    setItemModifierGroups([])
    setEditingOrderItem(null)
  }

  // Quick notes editing for any item
  const handleOpenNotesEditor = (itemId: string, currentNotes?: string) => {
    setEditingNotesItemId(itemId)
    setEditingNotesText(currentNotes || '')
  }

  const handleSaveNotes = () => {
    if (editingNotesItemId) {
      updateItem(editingNotesItemId, {
        specialNotes: editingNotesText.trim() || undefined,
      })
    }
    setEditingNotesItemId(null)
    setEditingNotesText('')
  }

  // State for editing categories order
  const [isEditingCategories, setIsEditingCategories] = useState(false)

  // DnD sensors for category reordering
  const categorySensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Sort categories based on custom order or default mode-based sorting
  const sortedCategories = useMemo(() => {
    // If there's a custom order saved, use it
    if (categoryOrder && categoryOrder.length > 0) {
      const orderedCategories: Category[] = []
      const remainingCategories = [...categories]

      // Add categories in the saved order
      for (const id of categoryOrder) {
        const index = remainingCategories.findIndex(c => c.id === id)
        if (index !== -1) {
          orderedCategories.push(remainingCategories[index])
          remainingCategories.splice(index, 1)
        }
      }

      // Add any new categories that aren't in the saved order
      return [...orderedCategories, ...remainingCategories]
    }

    // Default sorting by mode
    const barTypes = ['liquor', 'drinks', 'cocktails', 'beer', 'wine']
    const foodTypes = ['food', 'combos', 'appetizers', 'entrees']

    return [...categories].sort((a, b) => {
      const aType = a.categoryType || 'food'
      const bType = b.categoryType || 'food'

      if (currentMode === 'bar') {
        const aIsBar = barTypes.includes(aType)
        const bIsBar = barTypes.includes(bType)
        if (aIsBar && !bIsBar) return -1
        if (!aIsBar && bIsBar) return 1
      } else {
        const aIsFood = foodTypes.includes(aType) || !barTypes.includes(aType)
        const bIsFood = foodTypes.includes(bType) || !barTypes.includes(bType)
        if (aIsFood && !bIsFood) return -1
        if (!aIsFood && bIsFood) return 1
      }

      return 0
    })
  }, [categories, currentMode, categoryOrder])

  // Handle category drag end
  const handleCategoryDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = sortedCategories.findIndex(c => c.id === active.id)
      const newIndex = sortedCategories.findIndex(c => c.id === over.id)
      const newOrder = arrayMove(sortedCategories, oldIndex, newIndex).map(c => c.id)
      setCategoryOrder(newOrder)
    }
  }

  const filteredItems = menuItems.filter(
    item => item.categoryId === selectedCategory && item.isAvailable
  )
  const unavailableItems = menuItems.filter(
    item => item.categoryId === selectedCategory && !item.isAvailable
  )

  // Helper to format price display - shows both card and cash prices when dual pricing enabled
  const discountPercent = dualPricing.cashDiscountPercent || 4.0
  const formatItemPrice = (storedPrice: number) => {
    if (!dualPricing.enabled) {
      return <span className="text-sm font-medium">{formatCurrency(storedPrice)}</span>
    }
    // Card price is default display; cash price shown smaller
    const cardPrice = calculateCardPrice(storedPrice, discountPercent)
    return (
      <span className="text-sm font-medium">{formatCurrency(cardPrice)}</span>
    )
  }

  if (!hydrated || !isAuthenticated || !employee) {
    return null
  }

  // Combined Floor Plan + Bartender view with shared OrderPanel and modals
  // Shared OrderPanel element — passed as children to whichever view is active
  const sharedOrderPanel = (viewMode === 'floor-plan' || viewMode === 'bartender') && employee.location?.id ? (
    <div className="flex h-full">
    <OrderPanel
            orderId={currentOrder?.id || savedOrderId}
            orderNumber={currentOrder?.orderNumber}
            orderType={currentOrder?.orderType || (viewMode === 'bartender' ? 'bar_tab' : undefined)}
            tabName={currentOrder?.tabName}
            tableName={currentOrder?.tableName}
            tableId={currentOrder?.tableId}
            locationId={employee?.location?.id}
            employeeId={employee.id}
            items={filteredOrderPanelItems}
            filterSeatNumber={filterSeatNumber}
            onClearSeatFilter={clearSelectedSeat}
            onSeatSelect={handleSeatSelect}
            selectedSeatNumber={selectedSeat?.seatNumber ?? null}
            subtotal={pricing.subtotal}
            cashSubtotal={pricing.cashSubtotal}
            cardSubtotal={pricing.cardSubtotal}
            tax={pricing.tax}
            cashTax={pricing.cashTax}
            cardTax={pricing.cardTax}
            total={pricing.total}
            showItemControls={true}
            showEntertainmentTimers={true}
            onItemClick={panelCallbacks.onItemClick}
            onItemRemove={panelCallbacks.onItemRemove}
            onQuantityChange={panelCallbacks.onQuantityChange}
            onItemHoldToggle={panelCallbacks.onItemHoldToggle}
            onItemNoteEdit={panelCallbacks.onItemNoteEdit}
            onItemCourseChange={panelCallbacks.onItemCourseChange}
            onItemEditModifiers={panelCallbacks.onItemEditModifiers}
            onItemCompVoid={panelCallbacks.onItemCompVoid}
            onItemResend={panelCallbacks.onItemResend}
            onItemSplit={editingChildSplit || orderSplitChips.some(c => c.id === currentOrder?.id) ? undefined : panelCallbacks.onItemSplit}
            onQuickSplitEvenly={savedOrderId && !editingChildSplit && !orderSplitChips.some(c => c.id === currentOrder?.id) ? handleQuickSplitEvenly : undefined}
            onItemSeatChange={panelCallbacks.onItemSeatChange}
            expandedItemId={panelCallbacks.expandedItemId}
            onItemToggleExpand={panelCallbacks.onItemToggleExpand}
            onSend={handleSendToKitchen}
            onPay={async (method) => {
              // Split parent → route to split manager (parent total is $0, children have the money)
              if (useOrderStore.getState().currentOrder?.status === 'split') {
                setSplitManageMode(true)
                setShowSplitTicketManager(true)
                return
              }
              // Ensure order is saved to DB before opening payment
              const orderId = savedOrderId || useOrderStore.getState().currentOrder?.id || await ensureOrderInDB(employee?.id)
              if (orderId) {
                setInitialPayMethod(method)
                setOrderToPayId(orderId)
                // Fetch tab cards before showing modal so card buttons appear
                fetch(`/api/orders/${orderId}/cards`)
                  .then(r => r.ok ? r.json() : { data: [] })
                  .then(d => {
                    const authorized = (d.data || []).filter((c: { status: string }) => c.status === 'authorized')
                    setPaymentTabCards(authorized)
                  })
                  .catch(() => setPaymentTabCards([]))
                setShowPaymentModal(true)
              }
            }}
            onPrintCheck={async () => {
              const orderId = savedOrderId || useOrderStore.getState().currentOrder?.id || await ensureOrderInDB(employee?.id)
              if (orderId) {
                try {
                  await fetch('/api/print/receipt', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderId, type: 'check' }),
                  })
                  toast.success('Check sent to printer')
                } catch {
                  toast.error('Failed to print check')
                }
              }
            }}
            isSending={isSendingOrder}
            hasActiveTab={!!(tabCardInfo?.cardLast4 || currentOrder?.tabName)}
            requireCardForTab={(() => {
              const barTabOT = orderTypes.find(t => t.slug === 'bar_tab')
              return (barTabOT?.workflowRules as WorkflowRules)?.requireCardOnFile ?? requireCardForTab
            })()}
            tabCardLast4={tabCardInfo?.cardLast4}
            onStartTab={async () => {
              // Read fresh state — avoids stale closure issues
              const store = useOrderStore.getState()
              const items = store.currentOrder?.items
              if (!items?.length) return

              // Use store's current order ID (always fresh) — savedOrderId may be stale
              // after hiding a tab (React state update hasn't flushed yet)
              const existingOrderId = store.currentOrder?.id || null

              // ── Existing tab with saved order → optimistic clear, background work ──
              if (existingOrderId) {
                // Capture everything we need before clearing state
                const capturedOrderId = existingOrderId
                const capturedEmployeeId = employee?.id
                const capturedNewItems = items.filter(i => !i.sentToKitchen)
                // Use already-loaded tabCardInfo for instant feedback (background will verify)
                const optimisticCardLast4 = tabCardInfo?.cardLast4 ?? ''

                // Serialise items once — shared by both paths in the background
                const serialisedItems = capturedNewItems.map(item => ({
                  menuItemId: item.menuItemId,
                  name: item.name,
                  price: item.price,
                  quantity: item.quantity,
                  isHeld: item.isHeld || false,
                  modifiers: (item.modifiers || []).map(mod => ({
                    modifierId: (mod.id || mod.modifierId) ?? '',
                    name: mod.name,
                    price: Number(mod.price),
                    depth: mod.depth ?? 0,
                    preModifier: mod.preModifier ?? null,
                    spiritTier: mod.spiritTier ?? null,
                    linkedBottleProductId: mod.linkedBottleProductId ?? null,
                    parentModifierId: mod.parentModifierId ?? null,
                  })),
                  specialNotes: item.specialNotes,
                }))

                // ── Clear UI immediately — bartender starts next order now ──
                bartenderDeselectTabRef.current?.()
                clearOrder()
                setSavedOrderId(null)
                setOrderSent(false)
                setSelectedOrderType(null)
                setOrderCustomFields({})
                toast.success(
                  optimisticCardLast4
                    ? `Sending to tab •••${optimisticCardLast4}…`
                    : 'Sending to tab…'
                )

                // ── Background: verify card, append, send, re-auth ──
                void (async () => {
                  try {
                    // Source-of-truth card check (runs after UI is already clear)
                    let verifiedCardLast4 = ''
                    try {
                      const cardsRes = await fetch(`/api/orders/${capturedOrderId}/cards`)
                      if (cardsRes.ok) {
                        const cardsData = await cardsRes.json()
                        const activeCard = (cardsData.data || []).find(
                          (c: { status: string }) => c.status === 'authorized'
                        )
                        if (activeCard) {
                          verifiedCardLast4 = activeCard.cardLast4 || ''
                          setTabCardInfo({
                            cardholderName: activeCard.cardholderName || undefined,
                            cardLast4: activeCard.cardLast4,
                            cardType: activeCard.cardType,
                            recordNo: activeCard.recordNo || undefined,
                            authAmount: activeCard.authAmount != null ? Number(activeCard.authAmount) : undefined,
                          })
                        }
                      }
                    } catch { /* use optimistic value */ }

                    // Fall back to optimistic card info if server returns nothing
                    const effectiveLast4 = verifiedCardLast4 || optimisticCardLast4

                    // Append unsent items
                    if (serialisedItems.length > 0) {
                      const appendRes = await fetch(`/api/orders/${capturedOrderId}/items`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ items: serialisedItems }),
                      })
                      if (!appendRes.ok) {
                        toast.error('Failed to save items — check the tab')
                        return
                      }
                    }

                    // Send to kitchen
                    const sendRes = await fetch(`/api/orders/${capturedOrderId}/send`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ employeeId: capturedEmployeeId }),
                    })
                    if (!sendRes.ok) {
                      toast.error('Failed to send to kitchen — check open orders')
                      return
                    }

                    // Auto-increment if card on file (best-effort — never blocks UI)
                    if (effectiveLast4) {
                      try {
                        const authRes = await fetch(`/api/orders/${capturedOrderId}/auto-increment`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ employeeId: capturedEmployeeId, force: true }),
                        })
                        if (authRes.ok) {
                          const d = await authRes.json()
                          if (d.data?.incremented) {
                            toast.success(`Re-auth ✓ — hold $${d.data.newAuthorizedTotal.toFixed(2)} •••${effectiveLast4}`)
                          } else if (d.data?.action === 'increment_failed') {
                            toast.error(`Re-auth declined •••${effectiveLast4} — hold $${d.data.totalAuthorized?.toFixed(2) ?? '?'}`)
                          }
                          // below_threshold / no_card / disabled → silent (initial "Sending…" toast covers it)
                        }
                      } catch { /* auto-increment is best-effort */ }
                    }
                  } catch (err) {
                    console.error('[onStartTab] Background tab update failed:', err)
                    toast.error('Tab may not have updated — check open orders')
                  } finally {
                    setTabsRefreshTrigger(prev => prev + 1)
                  }
                })()

                return
              }

              // ── New tab (no existing order) ──
              const currentStore = useOrderStore.getState()
              if (currentStore.currentOrder && currentStore.currentOrder.orderType !== 'bar_tab') {
                currentStore.updateOrderType('bar_tab')
              }

              // Check order type workflow rules for card requirement
              const barTabOT = orderTypes.find(t => t.slug === 'bar_tab')
              const cardRequired = (barTabOT?.workflowRules as WorkflowRules)?.requireCardOnFile ?? requireCardForTab

              if (cardRequired) {
                // Card required → create lightweight draft shell, then show card modal instantly
                try {
                  let orderId = existingOrderId
                  if (!orderId) {
                    const shellRes = await fetch('/api/orders', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        employeeId: employee?.id,
                        locationId: employee?.location?.id,
                        orderType: 'bar_tab',
                        items: [],
                      }),
                    })
                    if (!shellRes.ok) {
                      toast.error('Failed to create order')
                      return
                    }
                    const shellRaw = await shellRes.json()
                    const shell = shellRaw.data ?? shellRaw
                    orderId = shell.id
                    const store2 = useOrderStore.getState()
                    store2.updateOrderId(shell.id, shell.orderNumber)
                    setSavedOrderId(shell.id)
                  }
                  setCardTabOrderId(orderId)
                  setShowCardTabFlow(true)
                } catch {
                  toast.error('Failed to save order — please try again')
                }
              } else {
                // Card NOT required → show tab name prompt with keyboard
                // (reader stays in ready mode — if card is tapped it will be picked up)
                setTabNameCallback(() => async () => {
                  // After name is entered, capture state then clear UI instantly
                  const store = useOrderStore.getState()
                  const tabName = store.currentOrder?.tabName
                  if (!tabName) return

                  // Capture order state before clearing
                  const capturedOrder = store.currentOrder
                  if (!capturedOrder || capturedOrder.items.length === 0) return
                  const capturedItems = [...capturedOrder.items]
                  const capturedEmployeeId = employee?.id
                  const capturedLocationId = capturedOrder.locationId || employee?.location?.id

                  // Clear UI instantly — user can start next order immediately
                  toast.success('Order sent to kitchen')
                  clearOrder()
                  setSavedOrderId(null)
                  setOrderSent(false)
                  setSelectedOrderType(null)
                  setOrderCustomFields({})

                  // Fire-and-forget: create order + send to kitchen in background
                  void (async () => {
                    try {
                      // Create order with items + tabName in one call
                      const res = await fetch('/api/orders', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          employeeId: capturedEmployeeId,
                          locationId: capturedLocationId,
                          orderType: 'bar_tab',
                          tabName,
                          guestCount: capturedOrder.guestCount || 1,
                          items: capturedItems.map(item => ({
                            menuItemId: item.menuItemId,
                            name: item.name,
                            price: item.price,
                            quantity: item.quantity,
                            modifiers: item.modifiers?.map(m => ({
                              modifierId: m.modifierId || m.id,
                              name: m.name,
                              price: m.price,
                              preModifier: m.preModifier,
                              depth: m.depth,
                            })) || [],
                          })),
                        }),
                      })

                      if (!res.ok) {
                        console.error('[onStartTab] Background create failed')
                        toast.error('Tab may not have saved — check open orders')
                        return
                      }

                      const created = await res.json()

                      // Send to kitchen
                      const sendRes = await fetch(`/api/orders/${created.id}/send`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ employeeId: capturedEmployeeId }),
                      })
                      if (!sendRes.ok) {
                        console.error('[onStartTab] Background send failed')
                      }
                    } catch (err) {
                      console.error('[onStartTab] Background tab creation failed:', err)
                      toast.error('Tab may not have saved — check open orders')
                    } finally {
                      setTabsRefreshTrigger(prev => prev + 1)
                    }
                  })()
                })
                setShowTabNamePrompt(true)
              }
            }}
            onOtherPayment={async () => {
              // Open PaymentModal at method selection step (gift card, house account, etc.)
              const orderId = savedOrderId || useOrderStore.getState().currentOrder?.id || await ensureOrderInDB(employee?.id)
              if (orderId) {
                setInitialPayMethod(undefined)
                setOrderToPayId(orderId)
                setShowPaymentModal(true)
              }
            }}
            cashDiscountPct={pricing.cashDiscountRate}
            taxPct={Math.round(pricing.taxRate * 100)}
            cashTotal={pricing.cashTotal}
            cardTotal={pricing.cardTotal}
            cashDiscountAmount={pricing.isDualPricingEnabled ? pricing.cardTotal - pricing.cashTotal : 0}
            hasTaxInclusiveItems={taxInclusiveLiquor || taxInclusiveFood}
            roundingAdjustment={pricing.cashRoundingDelta !== 0 ? pricing.cashRoundingDelta : undefined}
            hasSentItems={currentOrder?.items?.some(i => i.sentToKitchen) ?? false}
            onCancelOrder={() => {
              clearOrder()
              setSavedOrderId(null)
              setSelectedOrderType(null)
              setOrderCustomFields({})
              setOrderSent(false)
              setAppliedDiscounts([])
              useFloorPlanStore.getState().clearSelectedSeat()
            }}
            onHide={() => {
              // Deselect tab/table in the active view
              if (viewMode === 'bartender') {
                bartenderDeselectTabRef.current?.()
              } else {
                floorPlanDeselectTableRef.current?.()
              }
              setSavedOrderId(null)
              setSelectedOrderType(null)
              setOrderCustomFields({})
              setOrderSent(false)
              useFloorPlanStore.getState().clearSelectedSeat()
            }}
            selectedItemId={quickPickSelectedId}
            selectedItemIds={quickPickSelectedIds}
            onItemSelect={selectQuickPickItem}
            multiSelectMode={quickPickMultiSelect}
            onToggleMultiSelect={toggleQuickPickMultiSelect}
            onSelectAllPending={selectAllPendingQuickPick}
            pendingDelay={currentOrder?.pendingDelay ?? undefined}
            delayStartedAt={currentOrder?.delayStartedAt ?? undefined}
            delayFiredAt={currentOrder?.delayFiredAt ?? undefined}
            onFireDelayed={activeOrderFull.handleFireDelayed}
            onCancelDelay={() => useOrderStore.getState().setPendingDelay(null)}
            onFireItem={activeOrderFull.handleFireItem}
            onCancelItemDelay={(itemId) => useOrderStore.getState().setItemDelay([itemId], null)}
            reopenedAt={currentOrder?.reopenedAt}
            reopenReason={currentOrder?.reopenReason}
            hideHeader={viewMode === 'floor-plan'}
            className={viewMode === 'bartender' ? 'w-[360px] flex-shrink-0' : 'flex-1 min-h-0'}
            splitChips={orderSplitChips.length > 0 ? orderSplitChips : undefined}
            splitChipsFlashing={splitChipsFlashing}
            cardPriceMultiplier={pricing.isDualPricingEnabled ? 1 + pricing.cashDiscountRate / 100 : undefined}
            onAddSplit={orderSplitChips.length > 0 ? async () => {
              const parentId = splitParentId || currentOrder?.id
              if (!parentId) return
              try {
                const res = await fetch(`/api/orders/${parentId}/split-tickets/create-check`, { method: 'POST' })
                if (!res.ok) {
                  toast.error('Failed to create new split')
                  return
                }
                const newSplit = await res.json()
                // Add to chips and load the new split
                setOrderSplitChips(prev => [...prev, {
                  id: newSplit.id,
                  label: newSplit.displayNumber,
                  isPaid: false,
                  total: 0,
                }])
                const success = await fetchAndLoadSplitOrder(newSplit.id, currentOrder?.tableId ?? undefined)
                if (success) {
                  setSavedOrderId(newSplit.id)
                }
                toast.success(`Split ${newSplit.displayNumber} created`)
              } catch {
                toast.error('Failed to create new split')
              }
            } : undefined}
            onSplitChipSelect={orderSplitChips.length > 0 ? async (splitId) => {
              const success = await fetchAndLoadSplitOrder(splitId, currentOrder?.tableId ?? undefined)
              if (success) {
                setSavedOrderId(splitId)
              }
            } : undefined}
            onManageSplits={orderSplitChips.length > 0 ? () => {
              setSplitManageMode(true)
              setShowSplitTicketManager(true)
            } : undefined}
            onPayAll={orderSplitChips.length > 0 ? () => {
              const unpaid = orderSplitChips.filter(c => !c.isPaid)
              if (unpaid.length === 0) return
              const parentId = splitParentId || savedOrderId || currentOrder?.id || ''
              const combinedTotal = unpaid.reduce((sum, c) => sum + c.total, 0)
              const combinedCardTotal = pricing.isDualPricingEnabled
                ? calculateCardPrice(combinedTotal, pricing.cashDiscountRate)
                : combinedTotal
              setPayAllSplitsParentId(parentId)
              setPayAllSplitsTotal(combinedTotal)
              setPayAllSplitsCardTotal(combinedCardTotal)
              setShowPayAllSplitsConfirm(true)
            } : undefined}
          />
      {/* Quick Pick Strip — always visible, right side of order panel */}
        <QuickPickStrip
          selectedItemId={quickPickSelectedId}
          selectedItemQty={quickPickSelectedId ? orderPanelItems.find(i => i.id === quickPickSelectedId)?.quantity : undefined}
          selectedCount={quickPickSelectedIds.size}
          onNumberTap={handleQuickPickNumber}
          multiSelectMode={quickPickMultiSelect}
          onToggleMultiSelect={toggleQuickPickMultiSelect}
          onHoldToggle={quickPickSelectedId ? () => {
            const item = currentOrder?.items.find(i => i.id === quickPickSelectedId)
            if (item) updateItem(quickPickSelectedId, { isHeld: !item.isHeld })
          } : undefined}
          isHeld={quickPickSelectedId ? currentOrder?.items.find(i => i.id === quickPickSelectedId)?.isHeld : false}
          onSetDelay={(minutes) => {
            const selectedIds = Array.from(quickPickSelectedIds)
            if (selectedIds.length > 0) {
              const store = useOrderStore.getState()
              const allHaveThisDelay = selectedIds.every(id => {
                const item = store.currentOrder?.items.find(i => i.id === id)
                return item?.delayMinutes === minutes
              })
              store.setItemDelay(selectedIds, allHaveThisDelay ? null : minutes)
            } else {
              const current = currentOrder?.pendingDelay
              useOrderStore.getState().setPendingDelay(current === minutes ? null : minutes)
            }
          }}
          activeDelay={(() => {
            const selectedIds = Array.from(quickPickSelectedIds)
            if (selectedIds.length === 0) return currentOrder?.pendingDelay ?? null
            const firstItem = currentOrder?.items.find(i => i.id === selectedIds[0])
            return firstItem?.delayMinutes ?? null
          })()}
        />
    </div>
  ) : null

  if ((viewMode === 'floor-plan' || viewMode === 'bartender') && employee.location?.id) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <UnifiedPOSHeader
          orderTypes={orderTypes}
          employeeName={employee.displayName}
          employeeRole={employee.role?.name}
          viewMode={viewMode}
          onViewModeChange={(mode) => {
            const order = useOrderStore.getState().currentOrder
            if (mode === 'bartender') {
              setMode('bar')
              setViewMode('bartender')
              // Clear seat filter — seat context is table-specific, not relevant in bar view
              useFloorPlanStore.getState().clearSelectedSeat()
              // Always clear any existing order when switching to bar view
              // Bar view starts clean — no order number until Send/Start Tab
              if (order) {
                const hasSentItems = order.items.some(i => i.sentToKitchen)
                if (order.id && !hasSentItems) {
                  // Cancel unsent draft in DB
                  fetch(`/api/orders/${order.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'cancelled' }),
                  }).catch(() => {})
                }
                clearOrder()
                setSavedOrderId(null)
              }
            } else {
              if (order?.id && order.tableId) {
                setOrderToLoad({ id: order.id, orderNumber: order.orderNumber || 0, orderType: order.orderType })
              }
              setMode('food')
              setViewMode('floor-plan')
              // Clear any bar_tab order so floor plan starts clean
              // FloorPlanHome will handle order creation when a table is tapped
              // Guard: don't clear split orders (would orphan child tickets)
              if (order?.orderType === 'bar_tab' && order?.status !== 'split') {
                clearOrder()
              }
            }
          }}
          activeOrderType={currentOrder?.orderType || null}
          onQuickOrderType={(type) => quickOrderTypeRef.current?.(type)}
          onTablesClick={() => tablesClickRef.current?.()}
          onSwitchUser={() => { logout() }}
          onOpenTimeClock={() => setShowTimeClockModal(true)}
          onLogout={logout}
          onOpenSettings={() => setShowDisplaySettings(true)}
          onOpenAdminNav={canAccessAdmin ? () => router.push('/settings') : undefined}
          canCustomize={canCustomize}
          quickBarEnabled={quickBarEnabled}
          onToggleQuickBar={() => updateLayoutSetting('quickPickEnabled', !quickBarEnabled)}
          isEditingFavorites={isEditingFavorites}
          onToggleEditFavorites={() => setIsEditingFavorites(!isEditingFavorites)}
          isEditingCategories={isEditingCategories}
          onToggleEditCategories={() => setIsEditingCategories(!isEditingCategories)}
          isEditingMenuItems={isEditingMenuItems}
          onToggleEditMenuItems={() => setIsEditingMenuItems(!isEditingMenuItems)}
          onResetAllCategoryColors={resetAllCategoryColors}
          onResetAllMenuItemStyles={resetAllMenuItemStyles}
          openOrdersCount={openOrdersCount}
          onOpenOrdersPanel={() => { setShowTabsPanel(true) }}
          searchQuery={menuSearch.query}
          onSearchChange={menuSearch.setQuery}
          onSearchClear={menuSearch.clearSearch}
          searchResults={menuSearch.results || { directMatches: [], ingredientMatches: [], totalMatches: 0 }}
          isSearching={menuSearch.isSearching}
          onSearchSelect={handleSearchSelect}
          cardPriceMultiplier={pricing.isDualPricingEnabled ? 1 + pricing.cashDiscountRate / 100 : undefined}
        />
        {viewMode === 'floor-plan' && (
          <FloorPlanHome
            orderTypes={orderTypes}
            locationId={employee?.location?.id}
            employeeId={employee.id}
            isEditingFavorites={isEditingFavorites}
            isEditingCategories={isEditingCategories}
            isEditingMenuItems={isEditingMenuItems}
            onRegisterQuickOrderType={(fn) => { quickOrderTypeRef.current = fn }}
            onRegisterTablesClick={(fn) => { tablesClickRef.current = fn }}
            onOpenOrdersCountChange={setOpenOrdersCount}
            onOpenPayment={(orderId) => {
              // Split parent → route to split manager
              if (useOrderStore.getState().currentOrder?.status === 'split') {
                setSplitManageMode(true)
                setShowSplitTicketManager(true)
                return
              }
              setOrderToPayId(orderId)
              setShowPaymentModal(true)
            }}
            onOpenSplitManager={(orderId) => {
              setSavedOrderId(orderId)
              setSplitManageMode(true)
              setShowSplitTicketManager(true)
            }}
            onOpenModifiers={handleOpenModifiersShared as any}
            onOpenCardFirst={(orderId) => {
              setCardTabOrderId(orderId)
              setShowCardTabFlow(true)
            }}
            onOpenTimedRental={handleOpenTimedRental}
            onOpenPizzaBuilder={(item, onComplete) => {
              inlinePizzaCallbackRef.current = onComplete
              setSelectedPizzaItem(item as MenuItem)
              setEditingPizzaItem(null)
              setShowPizzaModal(true)
            }}
            orderToLoad={orderToLoad}
            onOrderLoaded={() => setOrderToLoad(null)}
            paidOrderId={paidOrderId}
            onPaidOrderCleared={() => setPaidOrderId(null)}
            onRegisterDeselectTable={(fn) => { floorPlanDeselectTableRef.current = fn }}
            refreshTrigger={floorPlanRefreshTrigger}
            initialCategories={categories}
            initialMenuItems={menuItems}
            initialSnapshot={initialSnapshot}
          >
            {sharedOrderPanel}
          </FloorPlanHome>
        )}
        {viewMode === 'bartender' && (
          <BartenderView
            locationId={employee?.location?.id}
            employeeId={employee.id}
            employeePermissions={permissionsArray}
            dualPricing={dualPricing}
            onRegisterDeselectTab={(fn) => {
              bartenderDeselectTabRef.current = () => {
                // Cancel empty draft in DB before clearing local state
                const store = useOrderStore.getState()
                const order = store.currentOrder
                if (order?.id && !isTempId(order.id)) {
                  const hasSentItems = order.items.some(i => i.sentToKitchen)
                  if (!hasSentItems) {
                    fetch(`/api/orders/${order.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'cancelled' }),
                    }).catch(() => {})
                  }
                }
                fn()
                // Clear stale tab card info so hasActiveTab resets and button shows "Start Tab"
                setTabCardInfo({ cardLast4: '', cardType: '', cardholderName: '' })
                setIsSendingOrder(false) // Reset stuck sending state
                setSavedOrderId(null)
              }
            }}
            onOpenCompVoid={(item) => {
              const orderId = useOrderStore.getState().currentOrder?.id || savedOrderId
              if (!orderId) {
                console.error('[BartenderView CompVoid] No order ID found')
                return
              }
              setOrderToPayId(orderId)
              setCompVoidItem({
                ...item,
                modifiers: item.modifiers.map(m => ({
                  id: m.id,
                  modifierId: m.id,
                  name: m.name,
                  price: m.price,
                  depth: 0,
                  preModifier: null,
                  spiritTier: null,
                  linkedBottleProductId: null,
                  parentModifierId: null,
                })),
              })
              setShowCompVoidModal(true)
            }}
            onOpenPayment={(orderId) => {
              // Split parent → route to split manager
              if (useOrderStore.getState().currentOrder?.status === 'split') {
                setSplitManageMode(true)
                setShowSplitTicketManager(true)
                return
              }
              setOrderToPayId(orderId)
              setShowPaymentModal(true)
            }}
            onOpenModifiers={handleOpenModifiersShared as any}
            requireNameWithoutCard={false}
            refreshTrigger={tabsRefreshTrigger}
            initialCategories={categories}
            initialMenuItems={menuItems}
            onSelectedTabChange={(tabId) => setSavedOrderId(tabId)}
          >
            {sharedOrderPanel}
          </BartenderView>
        )}

        {/* Shared Modals — extracted to OrderPageModals component */}
        <OrderPageModals
          employee={employee}
          permissionsArray={permissionsArray}
          showDisplaySettings={showDisplaySettings}
          onCloseDisplaySettings={() => setShowDisplaySettings(false)}
          displaySettings={displaySettings}
          onUpdateSetting={updateSetting}
          onBatchUpdateSettings={updateSettings}
          showTabsPanel={showTabsPanel}
          setShowTabsPanel={setShowTabsPanel}
          isTabManagerExpanded={isTabManagerExpanded}
          setIsTabManagerExpanded={setIsTabManagerExpanded}
          tabsRefreshTrigger={tabsRefreshTrigger}
          setTabsRefreshTrigger={setTabsRefreshTrigger}
          savedOrderId={savedOrderId}
          onSelectOpenOrder={(order) => {
            setOrderToLoad({
              id: order.id,
              orderNumber: order.orderNumber,
              tableId: order.tableId || undefined,
              tableName: order.table?.name || undefined,
              tabName: order.tabName || undefined,
              orderType: order.orderType,
            })
            if (order.hasPreAuth && order.preAuth?.last4) {
              setTabCardInfo({
                cardholderName: order.cardholderName || undefined,
                cardLast4: order.preAuth.last4,
                cardType: order.preAuth.cardBrand,
              })
            }
            setSavedOrderId(order.id)
            setShowTabsPanel(false)
            setIsTabManagerExpanded(false)
          }}
          onViewOpenOrder={(order) => {
            setOrderToLoad({
              id: order.id,
              orderNumber: order.orderNumber,
              tableId: order.tableId || undefined,
              tableName: order.table?.name || undefined,
              tabName: order.tabName || undefined,
              orderType: order.orderType,
            })
            if (order.hasPreAuth && order.preAuth?.last4) {
              setTabCardInfo({
                cardholderName: order.cardholderName || undefined,
                cardLast4: order.preAuth.last4,
                cardType: order.preAuth.cardBrand,
              })
            }
            setSavedOrderId(order.id)
            setShowTabsPanel(false)
            setIsTabManagerExpanded(false)
          }}
          onNewTab={() => {
            setShowTabsPanel(false)
            setIsTabManagerExpanded(false)
          }}
          onClosedOrderAction={() => setTabsRefreshTrigger(prev => prev + 1)}
          onOpenTipAdjustment={() => setShowTipAdjustment(true)}
          onViewReceipt={(orderId) => {
            setReceiptOrderId(orderId)
            setShowReceiptModal(true)
          }}
          showModifierModal={showModifierModal}
          setShowModifierModal={setShowModifierModal}
          selectedItem={selectedItem}
          setSelectedItem={setSelectedItem}
          itemModifierGroups={itemModifierGroups}
          setItemModifierGroups={setItemModifierGroups}
          loadingModifiers={loadingModifiers}
          editingOrderItem={editingOrderItem}
          setEditingOrderItem={setEditingOrderItem}
          dualPricing={dualPricing}
          inlineModifierCallbackRef={inlineModifierCallbackRef}
          onAddItemWithModifiers={handleAddItemWithModifiers}
          onUpdateItemWithModifiers={handleUpdateItemWithModifiers}
          showPizzaModal={showPizzaModal}
          setShowPizzaModal={setShowPizzaModal}
          selectedPizzaItem={selectedPizzaItem}
          setSelectedPizzaItem={setSelectedPizzaItem}
          editingPizzaItem={editingPizzaItem}
          setEditingPizzaItem={setEditingPizzaItem}
          inlinePizzaCallbackRef={inlinePizzaCallbackRef}
          onAddPizzaToOrder={handleAddPizzaToOrder}
          showEntertainmentStart={showEntertainmentStart}
          setShowEntertainmentStart={setShowEntertainmentStart}
          entertainmentItem={entertainmentItem}
          setEntertainmentItem={setEntertainmentItem}
          onStartEntertainmentWithCurrentOrder={handleStartEntertainmentWithCurrentOrder}
          onStartEntertainmentWithNewTab={handleStartEntertainmentWithNewTab}
          onStartEntertainmentWithExistingTab={handleStartEntertainmentWithExistingTab}
          showTimedRentalModal={showTimedRentalModal}
          setShowTimedRentalModal={setShowTimedRentalModal}
          selectedTimedItem={selectedTimedItem}
          setSelectedTimedItem={setSelectedTimedItem}
          inlineTimedRentalCallbackRef={inlineTimedRentalCallbackRef}
          onStartTimedSession={handleStartTimedSession}
          loadingSession={loadingSession}
          showPaymentModal={showPaymentModal}
          setShowPaymentModal={setShowPaymentModal}
          orderToPayId={orderToPayId}
          setOrderToPayId={setOrderToPayId}
          initialPayMethod={initialPayMethod}
          setInitialPayMethod={setInitialPayMethod}
          paymentTabCards={paymentTabCards}
          onTabCardsChanged={handleTabCardsChanged}
          paymentSettings={paymentSettings}
          priceRounding={priceRounding}
          currentOrder={currentOrder}
          onPaymentComplete={(receiptData) => {
            const paidId = orderToPayId
            setShowPaymentModal(false)
            setOrderToPayId(null)
            setInitialPayMethod(undefined)

            if (splitParentToReturnTo) {
              if (payAllSplitsQueue.length > 0) {
                const nextSplitId = payAllSplitsQueue[0]
                setPayAllSplitsQueue(prev => prev.slice(1))
                clearOrder()
                setOrderToPayId(nextSplitId)
                setShowPaymentModal(true)
                setFloorPlanRefreshTrigger(prev => prev + 1)
                setTabsRefreshTrigger(prev => prev + 1)
                return
              }
              if (paidId && receiptData) {
                setPreloadedReceiptData(receiptData)
                setReceiptOrderId(paidId)
                setShowReceiptModal(true)
              }
              setSavedOrderId(splitParentToReturnTo)
              setSplitManageMode(true)
              setShowSplitTicketManager(true)
              setSplitParentToReturnTo(null)
              setPayAllSplitsQueue([])
              clearOrder()
              setFloorPlanRefreshTrigger(prev => prev + 1)
              setTabsRefreshTrigger(prev => prev + 1)
              return
            }

            if (paidId && receiptData) {
              setPreloadedReceiptData(receiptData)
              setReceiptOrderId(paidId)
              setShowReceiptModal(true)
            }
            clearOrder()
            setSavedOrderId(null)
            setOrderSent(false)
            setSelectedOrderType(null)
            setOrderCustomFields({})
            setTabsRefreshTrigger(prev => prev + 1)
            setFloorPlanRefreshTrigger(prev => prev + 1)
          }}
          orderReadyPromiseRef={orderReadyPromiseRef}
          terminalId={TERMINAL_ID}
          showReceiptModal={showReceiptModal}
          setShowReceiptModal={setShowReceiptModal}
          receiptOrderId={receiptOrderId}
          setReceiptOrderId={setReceiptOrderId}
          preloadedReceiptData={preloadedReceiptData}
          setPreloadedReceiptData={setPreloadedReceiptData}
          receiptSettings={receiptSettings}
          setPaidOrderId={setPaidOrderId}
          showTipAdjustment={showTipAdjustment}
          setShowTipAdjustment={setShowTipAdjustment}
          showCardTabFlow={showCardTabFlow}
          setShowCardTabFlow={setShowCardTabFlow}
          cardTabOrderId={cardTabOrderId}
          onCardTabComplete={async (result) => {
            setShowCardTabFlow(false)
            if (result.approved) {
              const store = useOrderStore.getState()
              const allItems = store.currentOrder?.items || []
              const capturedItems = allItems.filter(i => isTempId(i.id))
              const orderId = cardTabOrderId!
              const capturedEmployeeId = employee?.id

              setTabCardInfo({
                cardholderName: result.cardholderName,
                cardLast4: result.cardLast4,
                cardType: result.cardType,
                recordNo: result.recordNo || undefined,
                authAmount: result.authAmount != null ? Number(result.authAmount) : undefined,
              })
              toast.success(`Tab opened — •••${result.cardLast4}`)
              useOrderStore.getState().clearOrder()
              setSavedOrderId(null)
              setOrderSent(false)
              setSelectedOrderType(null)
              setOrderCustomFields({})
              setCardTabOrderId(null)

              void (async () => {
                try {
                  if (capturedItems.length > 0) {
                    const appendRes = await fetch(`/api/orders/${orderId}/items`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        items: capturedItems.map(item => ({
                          menuItemId: item.menuItemId,
                          name: item.name,
                          price: item.price,
                          quantity: item.quantity,
                          modifiers: (item.modifiers || []).map(m => ({
                            modifierId: m.modifierId || m.id,
                            name: m.name,
                            price: Number(m.price),
                            preModifier: m.preModifier ?? null,
                            depth: m.depth ?? 0,
                          })),
                        })),
                      }),
                    })
                    if (!appendRes.ok) {
                      const errBody = await appendRes.json().catch(() => ({}))
                      console.error('[CardTab] Failed to append items:', appendRes.status, errBody)
                      toast.error('Failed to save tab items — check open orders')
                      return
                    }
                  }

                  if (result.cardholderName) {
                    await fetch(`/api/orders/${orderId}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ tabName: result.cardholderName }),
                    })
                  }

                  await fetch(`/api/orders/${orderId}/send`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ employeeId: capturedEmployeeId }),
                  })

                  fetch(`/api/orders/${orderId}/auto-increment`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ employeeId: capturedEmployeeId }),
                  }).catch(() => {})
                } catch (err) {
                  console.error('[CardTab] Background send failed:', err)
                  toast.error('Tab may not have saved — check open orders')
                } finally {
                  setTabsRefreshTrigger(prev => prev + 1)
                }
              })()
            } else {
              // Card declined — cancel the empty draft so it doesn't linger as a $0.00 tab
              if (cardTabOrderId) {
                fetch(`/api/orders/${cardTabOrderId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: 'cancelled' }),
                }).catch(() => {})
              }
              setCardTabOrderId(null)
            }
          }}
          onCardTabCancel={() => {
            setShowCardTabFlow(false)
            // Cancel the empty draft order in the DB so it doesn't linger as a $0.00 tab
            if (cardTabOrderId) {
              fetch(`/api/orders/${cardTabOrderId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'cancelled' }),
              }).catch(() => {})
            }
            setCardTabOrderId(null)
          }}
          showDiscountModal={showDiscountModal}
          setShowDiscountModal={setShowDiscountModal}
          appliedDiscounts={appliedDiscounts}
          onDiscountApplied={handleDiscountApplied}
          showCompVoidModal={showCompVoidModal}
          setShowCompVoidModal={setShowCompVoidModal}
          compVoidItem={compVoidItem}
          setCompVoidItem={setCompVoidItem}
          onCompVoidComplete={handleCompVoidComplete}
          resendModal={resendModal}
          setResendModal={setResendModal}
          resendNote={resendNote}
          setResendNote={setResendNote}
          resendLoading={resendLoading}
          onConfirmResend={confirmResendItem}
          showItemTransferModal={showItemTransferModal}
          setShowItemTransferModal={setShowItemTransferModal}
          onTransferComplete={async () => {
            try {
              const response = await fetch(`/api/orders/${savedOrderId}`)
              if (response.ok) {
                const orderData = await response.json()
                loadOrder(orderData)
              }
            } catch (error) {
              console.error('Failed to reload order:', error)
            }
          }}
          showSplitTicketManager={showSplitTicketManager}
          setShowSplitTicketManager={setShowSplitTicketManager}
          splitManageMode={splitManageMode}
          setSplitManageMode={setSplitManageMode}
          splitParentId={splitParentId}
          splitCheckItems={splitCheckItems}
          setFloorPlanRefreshTrigger={setFloorPlanRefreshTrigger}
          splitParentToReturnTo={splitParentToReturnTo}
          setSplitParentToReturnTo={setSplitParentToReturnTo}
          payAllSplitsQueue={payAllSplitsQueue}
          setPayAllSplitsQueue={setPayAllSplitsQueue}
          editingChildSplit={editingChildSplit}
          setEditingChildSplit={setEditingChildSplit}
          setSavedOrderId={setSavedOrderId}
          clearOrder={clearOrder}
          setOrderSent={setOrderSent}
          onSplitApplied={() => {
            setSplitManageMode(true)
            setFloorPlanRefreshTrigger(prev => prev + 1)
          }}
          onPaySplit={(splitId) => {
            const parentId = splitParentId || savedOrderId || useOrderStore.getState().currentOrder?.id || ''
            setSplitParentToReturnTo(parentId)
            setShowSplitTicketManager(false)
            setSplitManageMode(false)
            clearOrder()
            setOrderToPayId(splitId)
            setShowPaymentModal(true)
          }}
          onPayAllSplits={(splitIds, combinedTotal) => {
            if (splitIds.length === 0) return
            const parentId = splitParentId || savedOrderId || useOrderStore.getState().currentOrder?.id || ''
            const combinedCardTotal = pricing.isDualPricingEnabled
              ? calculateCardPrice(combinedTotal, pricing.cashDiscountRate)
              : combinedTotal
            setPayAllSplitsParentId(parentId)
            setPayAllSplitsTotal(combinedTotal)
            setPayAllSplitsCardTotal(combinedCardTotal)
            setShowPayAllSplitsConfirm(true)
          }}
          onAddCard={(splitId) => {
            setShowSplitTicketManager(false)
            setCardTabOrderId(splitId)
            setShowCardTabFlow(true)
          }}
          onAddItems={async (splitId) => {
            setShowSplitTicketManager(false)
            setSplitManageMode(false)
            setEditingChildSplit(true)
            try {
              const res = await fetch(`/api/orders/${splitId}?view=split`)
              if (res.ok) {
                const { data } = await res.json()
                useOrderStore.getState().loadOrder(data)
                setSavedOrderId(splitId)
              }
            } catch (err) {
              console.error('Failed to load split order', err)
            }
          }}
          noteEditTarget={activeOrderFull.noteEditTarget}
          closeNoteEditor={activeOrderFull.closeNoteEditor}
          saveNote={activeOrderFull.saveNote}
          showPayAllSplitsConfirm={showPayAllSplitsConfirm}
          setShowPayAllSplitsConfirm={setShowPayAllSplitsConfirm}
          payAllSplitsParentId={payAllSplitsParentId}
          setPayAllSplitsParentId={setPayAllSplitsParentId}
          payAllSplitsTotal={payAllSplitsTotal}
          payAllSplitsCardTotal={payAllSplitsCardTotal}
          setPayAllSplitsStep={setPayAllSplitsStep}
          payAllSplitsProcessing={payAllSplitsProcessing}
          orderSplitChips={orderSplitChips}
          onPayAllCash={() => callPayAllSplitsAPI('cash')}
          onPayAllCard={(cardResult) => callPayAllSplitsAPI('credit', cardResult)}
          showTabNamePrompt={showTabNamePrompt}
          setShowTabNamePrompt={setShowTabNamePrompt}
          tabNameCallback={tabNameCallback}
          setTabNameCallback={setTabNameCallback}
          tabCardInfo={tabCardInfo}
          showTimeClockModal={showTimeClockModal}
          setShowTimeClockModal={setShowTimeClockModal}
          currentShift={currentShift}
          setCurrentShift={setCurrentShift}
          setShowShiftCloseoutModal={setShowShiftCloseoutModal}
          showShiftStartModal={showShiftStartModal}
          setShowShiftStartModal={setShowShiftStartModal}
          showShiftCloseoutModal={showShiftCloseoutModal}
          pricing={pricing}
        />
      </div>
    )
  }

  // Fallback — should not be reached since viewMode is always 'floor-plan' or 'bartender'
  return null
}
