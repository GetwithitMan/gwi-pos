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
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { useOrderStore } from '@/stores/order-store'
import { useDevStore } from '@/stores/dev-store'
import { useOrderSettings } from '@/hooks/useOrderSettings'
import { usePOSDisplay } from '@/hooks/usePOSDisplay'
import { usePOSLayout } from '@/hooks/usePOSLayout'
import { useActiveOrder } from '@/hooks/useActiveOrder'
import { usePricing } from '@/hooks/usePricing'
import { useOrderPanelItems } from '@/hooks/useOrderPanelItems'
import { POSDisplaySettingsModal } from '@/components/orders/POSDisplaySettings'
import { formatCurrency } from '@/lib/utils'
import { calculateCardPrice } from '@/lib/pricing'
import { getPizzaBasePrice, debugPizzaPricing } from '@/lib/pizza-helpers'
import { PaymentModal } from '@/components/payment/PaymentModal'
import { DiscountModal } from '@/components/orders/DiscountModal'
import { CompVoidModal } from '@/components/orders/CompVoidModal'
import { ItemTransferModal } from '@/components/orders/ItemTransferModal'
import { SplitTicketManager } from '@/components/orders/SplitTicketManager'
import { OpenOrdersPanel, type OpenOrder } from '@/components/orders/OpenOrdersPanel'
import { TimeClockModal } from '@/components/time-clock/TimeClockModal'
import { ShiftStartModal } from '@/components/shifts/ShiftStartModal'
import { ShiftCloseoutModal } from '@/components/shifts/ShiftCloseoutModal'
import { ReceiptModal } from '@/components/receipt'
import type { OrderTypeConfig, OrderCustomFields, WorkflowRules } from '@/types/order-types'
import type { IngredientModificationType } from '@/types/orders'
import { ModifierModal } from '@/components/modifiers/ModifierModal'
import { PizzaBuilderModal } from '@/components/pizza/PizzaBuilderModal'
import { EntertainmentSessionStart } from '@/components/entertainment/EntertainmentSessionStart'
import type { PrepaidPackage } from '@/lib/entertainment-pricing'
import { FloorPlanHome } from '@/components/floor-plan'
import { BartenderView } from '@/components/bartender'
import { OrderPanel, type OrderPanelItemData } from '@/components/orders/OrderPanel'
import { QuickPickStrip } from '@/components/orders/QuickPickStrip'
import { useQuickPick } from '@/hooks/useQuickPick'
import { useOrderPanelCallbacks } from '@/hooks/useOrderPanelCallbacks'
import { useOrderingEngine } from '@/hooks/useOrderingEngine'
import { toast } from '@/stores/toast-store'
import { hasPermission, PERMISSIONS } from '@/lib/auth-utils'
import { useOrderSockets } from '@/hooks/useOrderSockets'
import TipAdjustmentOverlay from '@/components/tips/TipAdjustmentOverlay'
import { CardFirstTabFlow } from '@/components/tabs/CardFirstTabFlow'
import type { Category, MenuItem, ModifierGroup, SelectedModifier, PizzaOrderConfig, OrderItem } from '@/types'

export default function OrdersPage() {
  const router = useRouter()
  const { employee, isAuthenticated, logout } = useAuthStore()
  const currentOrder = useOrderStore(s => s.currentOrder)
  const { startOrder, updateOrderType, loadOrder, addItem, updateItem, removeItem, updateQuantity, clearOrder } = useOrderStore.getState()
  const { hasDevAccess, setHasDevAccess } = useDevStore()

  // Hydration guard: Zustand persist middleware starts with defaults (isAuthenticated=false)
  // before rehydrating from localStorage. Without this guard, the auth redirect fires
  // immediately on mount before the real auth state loads, causing unexpected logouts.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])

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
  } = activeOrderFull

  const [categories, setCategories] = useState<Category[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

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

  // Modifier selection state
  const [showModifierModal, setShowModifierModal] = useState(false)
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null)
  const [itemModifierGroups, setItemModifierGroups] = useState<ModifierGroup[]>([])
  const [loadingModifiers, setLoadingModifiers] = useState(false)
  const [editingOrderItem, setEditingOrderItem] = useState<{
    id: string
    menuItemId: string
    modifiers: { id: string; name: string; price: number; depth: number; parentModifierId?: string }[]
    ingredientModifications?: { ingredientId: string; name: string; modificationType: 'no' | 'lite' | 'on_side' | 'extra' | 'swap'; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]
    specialNotes?: string
    pizzaConfig?: PizzaOrderConfig
  } | null>(null)

  // Ref for handleOpenModifiersShared — defined later but needed by useOrderingEngine
  const handleOpenModifiersSharedRef = useRef<((...args: any[]) => void) | null>(null)

  // T023: Inline ordering modifier callback ref
  const inlineModifierCallbackRef = useRef<((modifiers: { id: string; name: string; price: number; depth?: number; preModifier?: string | null; modifierId?: string | null; spiritTier?: string | null; linkedBottleProductId?: string | null; parentModifierId?: string | null }[], ingredientModifications?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]) => void) | null>(null)
  // T023: Inline ordering timed rental callback ref
  const inlineTimedRentalCallbackRef = useRef<((price: number, blockMinutes: number) => void) | null>(null)
  // T023: Inline ordering pizza builder callback ref
  const inlinePizzaCallbackRef = useRef<((config: PizzaOrderConfig) => void) | null>(null)

  // Pizza builder state
  const [showPizzaModal, setShowPizzaModal] = useState(false)
  const [selectedPizzaItem, setSelectedPizzaItem] = useState<MenuItem | null>(null)
  const [editingPizzaItem, setEditingPizzaItem] = useState<{
    id: string
    pizzaConfig?: PizzaOrderConfig
  } | null>(null)

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

  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash')

  // Unified pricing calculations
  const pricing = usePricing({
    subtotal: currentOrder?.subtotal || 0,
    discountTotal: currentOrder?.discountTotal || 0,
    tipTotal: currentOrder?.tipTotal || 0,
    paymentMethod,
  })

  // Display settings modal
  const [showDisplaySettings, setShowDisplaySettings] = useState(false)

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

  // Payment modal state
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [initialPayMethod, setInitialPayMethod] = useState<'cash' | 'credit' | undefined>(undefined)
  const [orderToPayId, setOrderToPayId] = useState<string | null>(null)
  const [paymentTabCards, setPaymentTabCards] = useState<Array<{ id: string; cardType: string; cardLast4: string; cardholderName?: string | null; authAmount: number; isDefault: boolean }>>([])

  // Order to load into FloorPlanHome (for editing from Open Orders panel)
  const [orderToLoad, setOrderToLoad] = useState<{ id: string; orderNumber: number; tableId?: string; tabName?: string; orderType: string } | null>(null)

  // BartenderView tab deselect callback (registered via onRegisterDeselectTab)
  const bartenderDeselectTabRef = useRef<(() => void) | null>(null)
  // FloorPlanHome table deselect callback (registered via onRegisterDeselectTable)
  const floorPlanDeselectTableRef = useRef<(() => void) | null>(null)

  // Background items-persist promise (started when PaymentModal opens, awaited before /pay)
  const orderReadyPromiseRef = useRef<Promise<string | null> | null>(null)

  // Receipt modal state
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  const [receiptOrderId, setReceiptOrderId] = useState<string | null>(null)
  const [preloadedReceiptData, setPreloadedReceiptData] = useState<any>(null)

  // Order that was just paid - triggers FloorPlanHome to clear its state
  const [paidOrderId, setPaidOrderId] = useState<string | null>(null)

  // Floor plan refresh trigger - increment to force FloorPlanHome to refresh
  const [floorPlanRefreshTrigger, setFloorPlanRefreshTrigger] = useState(0)

  // Split check modal state
  const [showSplitModal, setShowSplitModal] = useState(false)
  const [splitPaymentAmount, setSplitPaymentAmount] = useState<number | null>(null)
  const [evenSplitAmounts, setEvenSplitAmounts] = useState<{ splitNumber: number; amount: number }[] | null>(null)
  const [currentSplitIndex, setCurrentSplitIndex] = useState(0)

  // Discount modal state
  const [showDiscountModal, setShowDiscountModal] = useState(false)
  const [appliedDiscounts, setAppliedDiscounts] = useState<{ id: string; name: string; amount: number; percent?: number | null }[]>([])

  // Tab name prompt state
  const [showTabNamePrompt, setShowTabNamePrompt] = useState(false)
  const [tabNameInput, setTabNameInput] = useState('')
  const [tabNameCallback, setTabNameCallback] = useState<(() => void) | null>(null)

  // Card-first tab flow state
  const [showCardTabFlow, setShowCardTabFlow] = useState(false)
  const [cardTabOrderId, setCardTabOrderId] = useState<string | null>(null)
  const [tabCardInfo, setTabCardInfo] = useState<{ cardholderName?: string; cardLast4?: string; cardType?: string } | null>(null)

  // Clear tab card info only when order transitions FROM something TO null
  // (not when currentOrder is already null — avoids race with async order loading)
  const prevOrderRef = useRef(currentOrder)
  useEffect(() => {
    if (prevOrderRef.current && !currentOrder) {
      setTabCardInfo(null)
      setCardTabOrderId(null)
    }
    prevOrderRef.current = currentOrder
  }, [currentOrder])

  // Comp/Void modal state
  const [showCompVoidModal, setShowCompVoidModal] = useState(false)

  // Resend modal state (replaces blocking prompt/alert)
  const [resendModal, setResendModal] = useState<{ itemId: string; itemName: string } | null>(null)
  const [resendNote, setResendNote] = useState('')
  const [resendLoading, setResendLoading] = useState(false)
  const [compVoidItem, setCompVoidItem] = useState<{
    id: string
    menuItemId?: string
    name: string
    quantity: number
    price: number
    modifiers: { id: string; name: string; price: number; depth?: number; preModifier?: string | null; modifierId?: string | null; spiritTier?: string | null; linkedBottleProductId?: string | null; parentModifierId?: string | null }[]
    status?: string
    voidReason?: string
  } | null>(null)

  // Item Transfer modal state
  const [showItemTransferModal, setShowItemTransferModal] = useState(false)

  // Split Ticket Manager state
  const [showSplitTicketManager, setShowSplitTicketManager] = useState(false)

  // Tabs panel state
  const [showTabsPanel, setShowTabsPanel] = useState(false)
  const [isTabManagerExpanded, setIsTabManagerExpanded] = useState(false)
  const [showTipAdjustment, setShowTipAdjustment] = useState(false)
  const [tabsRefreshTrigger, setTabsRefreshTrigger] = useState(0)

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

  // Order type state (configurable order types)
  const [orderTypes, setOrderTypes] = useState<OrderTypeConfig[]>([])
  const [selectedOrderType, setSelectedOrderType] = useState<OrderTypeConfig | null>(null)
  const [orderCustomFields, setOrderCustomFields] = useState<OrderCustomFields>({})

  // Open orders count for badge
  const [openOrdersCount, setOpenOrdersCount] = useState(0)

  // Item notes modal state (for quick note editing)
  const [editingNotesItemId, setEditingNotesItemId] = useState<string | null>(null)
  const [editingNotesText, setEditingNotesText] = useState('')

  // Time clock modal state
  const [showTimeClockModal, setShowTimeClockModal] = useState(false)

  // Shift management state
  const [currentShift, setCurrentShift] = useState<{
    id: string
    startedAt: string
    startingCash: number
    employee: { id: string; name: string; roleId?: string }
    locationId?: string
  } | null>(null)
  const [showShiftStartModal, setShowShiftStartModal] = useState(false)
  const [showShiftCloseoutModal, setShowShiftCloseoutModal] = useState(false)
  const [shiftChecked, setShiftChecked] = useState(false)

  // Combo selection state
  const [showComboModal, setShowComboModal] = useState(false)
  const [selectedComboItem, setSelectedComboItem] = useState<MenuItem | null>(null)
  const [comboTemplate, setComboTemplate] = useState<{
    id: string
    basePrice: number
    comparePrice?: number | null
    components: {
      id: string
      slotName: string
      displayName: string
      isRequired: boolean
      minSelections: number
      maxSelections: number
      menuItemId?: string | null
      menuItem?: {
        id: string
        name: string
        price: number
        modifierGroups?: {
          modifierGroup: {
            id: string
            name: string
            displayName?: string | null
            minSelections: number
            maxSelections: number
            isRequired: boolean
            modifiers: {
              id: string
              name: string
              price: number
              childModifierGroupId?: string | null
            }[]
          }
        }[]
      } | null
      itemPriceOverride?: number | null
      modifierPriceOverrides?: Record<string, number> | null
      // Legacy fields
      options: { id: string; menuItemId: string; name: string; upcharge: number; isAvailable: boolean }[]
    }[]
  } | null>(null)
  // comboSelections maps componentId -> groupId -> modifierIds
  const [comboSelections, setComboSelections] = useState<Record<string, Record<string, string[]>>>({})

  // Timed rental state
  const [showTimedRentalModal, setShowTimedRentalModal] = useState(false)
  const [selectedTimedItem, setSelectedTimedItem] = useState<MenuItem | null>(null)
  const [selectedRateType, setSelectedRateType] = useState<'per15Min' | 'per30Min' | 'perHour'>('perHour')
  const [activeSessions, setActiveSessions] = useState<{
    id: string
    menuItemId: string
    menuItemName: string
    startedAt: string
    rateType: string
    rateAmount: number
    orderItemId?: string
  }[]>([])
  const [loadingSession, setLoadingSession] = useState(false)

  // Entertainment session start modal state
  const [showEntertainmentStart, setShowEntertainmentStart] = useState(false)
  const [entertainmentItem, setEntertainmentItem] = useState<{
    id: string
    name: string
    ratePerMinute?: number
    prepaidPackages?: PrepaidPackage[]
    happyHourEnabled?: boolean
    happyHourPrice?: number
  } | null>(null)

  // Menu search state (legacy order-entry mode removed — FloorPlanHome/BartenderView have their own search)

  // OrderPanel data mapping
  const orderPanelItems = useOrderPanelItems(menuItems)

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
    onOpenSplit: () => {
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
      removeItem(quickPickSelectedId)
      return
    }

    const delta = pendingQty - item.quantity
    if (delta !== 0) updateQuantity(quickPickSelectedId, delta)

    ordersDigitTimerRef.current = setTimeout(() => {
      ordersDigitBufferRef.current = ''
    }, 600)
  }, [quickPickSelectedId, updateQuantity, removeItem])

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

  // Load menu with cache-busting
  // NOTE: selectedCategory intentionally NOT in deps — loadMenu fetches ALL items.
  // Category filtering is done client-side (line ~2437). Including selectedCategory
  // here caused a circular re-fetch on every category click (loadMenu recreated →
  // useEffect re-ran → full /api/menu re-fetch). Use selectedCategoryRef for the
  // initial-selection guard.
  const selectedCategoryRef = useRef(selectedCategory)
  selectedCategoryRef.current = selectedCategory

  const loadMenu = useCallback(async () => {
    if (!employee?.location?.id) return
    try {
      const timestamp = Date.now()
      const params = new URLSearchParams({ locationId: employee.location.id, _t: timestamp.toString() })
      const response = await fetch(`/api/menu?${params}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })
      if (response.ok) {
        const data = await response.json()
        setCategories(data.categories)
        setMenuItems([...data.items]) // Force new array reference
        if (data.categories.length > 0 && !selectedCategoryRef.current) {
          setSelectedCategory(data.categories[0].id)
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
      const response = await fetch(`/api/order-types?locationId=${employee.location.id}`)
      if (response.ok) {
        const data = await response.json()
        setOrderTypes(data.orderTypes || [])
      }
    } catch (error) {
      console.error('Failed to load order types:', error)
    }
  }, [employee?.location?.id])

  useEffect(() => {
    if (employee?.location?.id) {
      loadMenu()
      loadOrderTypes()
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
      const params = new URLSearchParams({ locationId: employee.location.id, status: 'active' })
      const response = await fetch(`/api/timed-sessions?${params}`)
      if (response.ok) {
        const data = await response.json()
        setActiveSessions(data.sessions || [])
      }
    } catch (error) {
      console.error('Failed to load active sessions:', error)
    }
  }

  // Check for open shift on load
  useEffect(() => {
    if (employee?.id && employee?.location?.id && !shiftChecked) {
      checkOpenShift()
    }
  }, [employee?.id, employee?.location?.id, shiftChecked])

  const checkOpenShift = async () => {
    if (!employee?.id || !employee?.location?.id) return
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        employeeId: employee.id,
        status: 'open',
      })
      const response = await fetch(`/api/shifts?${params}`)
      if (response.ok) {
        const data = await response.json()
        if (data.shifts && data.shifts.length > 0) {
          // Enrich shift data with roleId and locationId for tip distribution
          setCurrentShift({
            ...data.shifts[0],
            employee: {
              ...data.shifts[0].employee,
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
        const params = new URLSearchParams({ locationId: employee.location.id })
        const response = await fetch(`/api/orders/open?${params}`)
        if (response.ok) {
          const data = await response.json()
          setOpenOrdersCount(data.orders?.length || 0)
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

  useEffect(() => {
    if (!currentOrder) {
      startOrder('dine_in', { guestCount: 1 })
    }
  }, [currentOrder, startOrder])

  // Load quick bar items when quickBar changes (T035)
  useEffect(() => {
    if (!quickBar || quickBar.length === 0) {
      setQuickBarItems([])
      return
    }

    let cancelled = false

    const loadQuickBarItems = async () => {
      try {
        const itemPromises = quickBar.map(async (itemId) => {
          try {
            const res = await fetch(`/api/menu/items/${itemId}`)
            if (!cancelled && res.ok) {
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
          } catch {
            // Individual item fetch failed — skip it
          }
          return null
        })

        const items = await Promise.all(itemPromises)
        if (!cancelled) {
          setQuickBarItems(items.filter(Boolean) as typeof quickBarItems)
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
        toast.warning('Please select a table for this order')
        toast.warning('Please select a table from the floor plan')
        return
      }
      if (validation.message === 'TAB_NAME_REQUIRED') {
        // Show tab name prompt, then retry send after name is entered
        setTabNameInput('')
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
      .then(d => setPaymentTabCards((d.data || []).filter((c: { status: string }) => c.status === 'authorized')))
      .catch(() => setPaymentTabCards([]))

    setShowPaymentModal(true)
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
      method: 'PUT',
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
      loadOrder(orderData)
    }

    // Refresh tabs panel
    setTabsRefreshTrigger(prev => prev + 1)
  }

  // Handle split check result
  const handleSplitComplete = (result: {
    type: 'even' | 'by_item' | 'by_seat' | 'by_table' | 'custom_amount' | 'split_item'
    originalOrderId: string
    splits?: { splitNumber: number; amount: number }[]
    newOrderId?: string
    newOrderNumber?: number
    splitAmount?: number
    itemSplits?: { itemId: string; itemName: string; splitNumber: number; amount: number }[]
    seatSplits?: { seatNumber: number; total: number; splitOrderId: string }[]
    tableSplits?: { tableId: string; tableName: string; total: number; splitOrderId: string }[]
  }) => {
    setShowSplitModal(false)

    if (result.type === 'even' && result.splits) {
      // Store the split amounts and start payment flow
      setEvenSplitAmounts(result.splits)
      setCurrentSplitIndex(0)
      setSplitPaymentAmount(result.splits[0].amount)
      setOrderToPayId(result.originalOrderId)
      setShowPaymentModal(true)
    } else if (result.type === 'split_item' && result.splits) {
      // Split single item among guests - same payment flow as even split
      setEvenSplitAmounts(result.splits)
      setCurrentSplitIndex(0)
      setSplitPaymentAmount(result.splits[0].amount)
      setOrderToPayId(result.originalOrderId)
      setShowPaymentModal(true)
    } else if (result.type === 'by_item') {
      // Reload the current order to reflect changes
      toast.success(`New check #${result.newOrderNumber} created with selected items`)
      setTabsRefreshTrigger(prev => prev + 1)
      // Clear current order since items were moved
      clearOrder()
      setSavedOrderId(null)
    } else if (result.type === 'by_seat' && result.seatSplits) {
      // Split by seat - multiple checks created
      const seatCount = result.seatSplits.length
      toast.success(`${seatCount} separate checks created (one per seat)`)
      setTabsRefreshTrigger(prev => prev + 1)
      // Clear current order since items were moved to seat-specific checks
      clearOrder()
      setSavedOrderId(null)
    } else if (result.type === 'by_table' && result.tableSplits) {
      // Split by table - multiple checks created
      const tableCount = result.tableSplits.length
      const tableNames = result.tableSplits.map(s => s.tableName).join(', ')
      toast.success(`${tableCount} separate checks created (one per table: ${tableNames})`)
      setTabsRefreshTrigger(prev => prev + 1)
      // Clear current order since items were moved to table-specific checks
      clearOrder()
      setSavedOrderId(null)
    } else if (result.type === 'custom_amount' && result.splitAmount) {
      // Open payment modal with custom amount
      setSplitPaymentAmount(result.splitAmount)
      setOrderToPayId(result.originalOrderId)
      setShowPaymentModal(true)
    }
  }

  // Handle navigating to a different split order
  const handleNavigateToSplit = async (splitOrderId: string) => {
    try {
      const response = await fetch(`/api/orders/${splitOrderId}`)
      if (!response.ok) {
        throw new Error('Failed to fetch split order')
      }
      const orderData = await response.json()

      // Load the split order into the current order state
      loadOrder({
        id: orderData.id,
        orderNumber: orderData.orderNumber,
        orderType: orderData.orderType,
        tableId: orderData.tableId || undefined,
        tableName: orderData.tableName || undefined,
        tabName: orderData.tabName || undefined,
        guestCount: orderData.guestCount || 1,
        status: orderData.status,
        // store.loadOrder handles all item field mapping — one path, no duplication
        items: orderData.items || [],
        subtotal: Number(orderData.subtotal) || 0,
        discountTotal: Number(orderData.discountTotal) || 0,
        taxTotal: Number(orderData.taxTotal) || 0,
        total: Number(orderData.total) || 0,
      })

      // Update saved order ID
      setSavedOrderId(splitOrderId)
      setOrderSent(orderData.status === 'sent' || orderData.status === 'in_progress')

      // Close the tabs panel if open
      setShowTabsPanel(false)
    } catch (error) {
      console.error('Failed to navigate to split order:', error)
      toast.error('Failed to load split order')
    }
  }

  // Handle opening split check
  const handleOpenSplit = async () => {
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
      setOrderToPayId(orderId)
      setShowSplitModal(true)
    }
  }

  // Handle opening split ticket manager (to create separate tickets)
  const handleOpenSplitTicket = async () => {
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
      setShowSplitTicketManager(true)
    }
  }

  // Handle split ticket completion
  const handleSplitTicketComplete = () => {
    // Clear the current order and reload
    clearOrder()
    setSavedOrderId(null)
    setOrderSent(false)
    setAppliedDiscounts([])
    setShowSplitTicketManager(false)
  }

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
          setAppliedDiscounts(data.discounts || [])
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
          setAppliedDiscounts(data.discounts || [])
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

  const handleSplit = async (itemId: string) => {
    // Open split ticket manager
    await handleOpenSplitTicket()
  }

  // handleToggleExpand now comes from useActiveOrder hook — no local function needed

  const handleSeatChange = async (itemId: string, seat: number | null) => {
    await sharedSeatChange(itemId, seat)
  }

  const handleAddItem = async (item: MenuItem) => {
    if (!item.isAvailable) return

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
          setComboTemplate(data.template)
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

      const { item } = await res.json()
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

    // Build modifiers array organized by section boxes (like pizza builder)
    const pizzaModifiers: { id: string; name: string; price: number; preModifier?: string; depth: number }[] = []
    const maxSections = 24
    const halfSize = maxSections / 2
    const quarterSize = maxSections / 4
    const sixthSize = maxSections / 6
    const eighthSize = maxSections / 8

    // Define all box section ranges
    const boxSections: Record<string, number[]> = {
      'WHOLE': Array.from({ length: maxSections }, (_, i) => i),
      'RIGHT HALF': Array.from({ length: halfSize }, (_, i) => i),
      'LEFT HALF': Array.from({ length: halfSize }, (_, i) => halfSize + i),
      'TOP RIGHT': Array.from({ length: quarterSize }, (_, i) => i),
      'BOTTOM RIGHT': Array.from({ length: quarterSize }, (_, i) => quarterSize + i),
      'BOTTOM LEFT': Array.from({ length: quarterSize }, (_, i) => quarterSize * 2 + i),
      'TOP LEFT': Array.from({ length: quarterSize }, (_, i) => quarterSize * 3 + i),
    }
    // Add sixths
    for (let i = 0; i < 6; i++) {
      boxSections[`1/6-${i + 1}`] = Array.from({ length: sixthSize }, (_, j) => i * sixthSize + j)
    }
    // Add eighths
    for (let i = 0; i < 8; i++) {
      boxSections[`1/8-${i + 1}`] = Array.from({ length: eighthSize }, (_, j) => i * eighthSize + j)
    }

    // Collect all items with their sections
    type PizzaItem = { type: string; id: string; name: string; sections: number[]; price: number; amount?: string }
    const allItems: PizzaItem[] = []

    if (config.sauces) {
      config.sauces.forEach(s => {
        const prefix = s.amount === 'light' ? 'Light ' : s.amount === 'extra' ? 'Extra ' : ''
        allItems.push({ type: 'sauce', id: s.sauceId, name: `${prefix}${s.name}`, sections: s.sections, price: s.price || 0 })
      })
    }
    if (config.cheeses) {
      config.cheeses.forEach(c => {
        const prefix = c.amount === 'light' ? 'Light ' : c.amount === 'extra' ? 'Extra ' : ''
        allItems.push({ type: 'cheese', id: c.cheeseId, name: `${prefix}${c.name}`, sections: c.sections, price: c.price || 0 })
      })
    }
    config.toppings.forEach(t => {
      const prefix = t.amount === 'light' ? 'Light ' : t.amount === 'extra' ? 'Extra ' : ''
      allItems.push({ type: 'topping', id: t.toppingId, name: `${prefix}${t.name}`, sections: t.sections, price: t.price })
    })

    // Determine section mode based on items (find smallest sections used)
    let sectionMode = 1 // Default to whole
    allItems.forEach(item => {
      if (item.sections.length < maxSections) {
        if (item.sections.length <= eighthSize) sectionMode = Math.max(sectionMode, 8)
        else if (item.sections.length <= sixthSize) sectionMode = Math.max(sectionMode, 6)
        else if (item.sections.length <= quarterSize) sectionMode = Math.max(sectionMode, 4)
        else if (item.sections.length <= halfSize) sectionMode = Math.max(sectionMode, 2)
      }
    })

    // Helper to check if sections exactly match a box
    const exactlyCovers = (itemSections: number[], boxName: string): boolean => {
      const boxSecs = boxSections[boxName]
      if (!boxSecs || itemSections.length !== boxSecs.length) return false
      const sorted = [...itemSections].sort((a, b) => a - b)
      return boxSecs.every((s, i) => sorted[i] === s)
    }

    // Helper to check if item sections cover a box's sections
    const coversBox = (itemSections: number[], boxName: string): boolean => {
      const boxSecs = boxSections[boxName]
      if (!boxSecs) return false
      return boxSecs.every(s => itemSections.includes(s))
    }

    // Group items into boxes
    const boxContents: Record<string, { items: string[]; totalPrice: number }> = {}

    // Initialize all boxes we'll show
    const boxOrder = [
      'WHOLE',
      'LEFT HALF', 'RIGHT HALF',
      'TOP LEFT', 'TOP RIGHT', 'BOTTOM LEFT', 'BOTTOM RIGHT',
      '1/6-1', '1/6-2', '1/6-3', '1/6-4', '1/6-5', '1/6-6',
      '1/8-1', '1/8-2', '1/8-3', '1/8-4', '1/8-5', '1/8-6', '1/8-7', '1/8-8',
    ]

    boxOrder.forEach(box => {
      boxContents[box] = { items: [], totalPrice: 0 }
    })

    // Place each item in the appropriate box(es)
    allItems.forEach(item => {
      // Find the best (largest) box this item exactly covers
      let placed = false

      // Check from largest to smallest
      if (exactlyCovers(item.sections, 'WHOLE')) {
        boxContents['WHOLE'].items.push(item.name)
        boxContents['WHOLE'].totalPrice += item.price
        placed = true
      } else if (exactlyCovers(item.sections, 'LEFT HALF')) {
        boxContents['LEFT HALF'].items.push(item.name)
        boxContents['LEFT HALF'].totalPrice += item.price
        placed = true
      } else if (exactlyCovers(item.sections, 'RIGHT HALF')) {
        boxContents['RIGHT HALF'].items.push(item.name)
        boxContents['RIGHT HALF'].totalPrice += item.price
        placed = true
      } else {
        // Check quarters
        for (const q of ['TOP LEFT', 'TOP RIGHT', 'BOTTOM LEFT', 'BOTTOM RIGHT']) {
          if (exactlyCovers(item.sections, q)) {
            boxContents[q].items.push(item.name)
            boxContents[q].totalPrice += item.price
            placed = true
            break
          }
        }
      }

      if (!placed) {
        // Check sixths
        for (let i = 1; i <= 6; i++) {
          if (exactlyCovers(item.sections, `1/6-${i}`)) {
            boxContents[`1/6-${i}`].items.push(item.name)
            boxContents[`1/6-${i}`].totalPrice += item.price
            placed = true
            break
          }
        }
      }

      if (!placed) {
        // Check eighths
        for (let i = 1; i <= 8; i++) {
          if (exactlyCovers(item.sections, `1/8-${i}`)) {
            boxContents[`1/8-${i}`].items.push(item.name)
            boxContents[`1/8-${i}`].totalPrice += item.price
            placed = true
            break
          }
        }
      }

      if (!placed) {
        // Non-standard grouping - place in each smallest box it covers
        const smallestBoxes = sectionMode === 8 ? ['1/8-1', '1/8-2', '1/8-3', '1/8-4', '1/8-5', '1/8-6', '1/8-7', '1/8-8'] :
          sectionMode === 6 ? ['1/6-1', '1/6-2', '1/6-3', '1/6-4', '1/6-5', '1/6-6'] :
          sectionMode === 4 ? ['TOP LEFT', 'TOP RIGHT', 'BOTTOM LEFT', 'BOTTOM RIGHT'] :
          ['LEFT HALF', 'RIGHT HALF']

        smallestBoxes.forEach(boxName => {
          if (coversBox(item.sections, boxName)) {
            boxContents[boxName].items.push(item.name)
            // Don't add price multiple times for split items
          }
        })
      }
    })

    // Determine which rows to show based on section mode
    const rows: string[][] = [['WHOLE', 'LEFT HALF', 'RIGHT HALF']]
    if (sectionMode >= 4) rows.push(['TOP LEFT', 'TOP RIGHT', 'BOTTOM LEFT', 'BOTTOM RIGHT'])
    if (sectionMode >= 6) rows.push(['1/6-1', '1/6-2', '1/6-3', '1/6-4', '1/6-5', '1/6-6'])
    if (sectionMode >= 8) {
      rows.push(['1/8-1', '1/8-2', '1/8-3', '1/8-4'])
      rows.push(['1/8-5', '1/8-6', '1/8-7', '1/8-8'])
    }

    // Build modifiers from boxes - show ALL boxes in relevant rows
    rows.forEach((row, rowIdx) => {
      row.forEach(boxName => {
        // Skip halves row if mode is 1 (whole only)
        if (sectionMode === 1 && (boxName === 'LEFT HALF' || boxName === 'RIGHT HALF')) return

        const content = boxContents[boxName]
        const itemsText = content.items.length > 0 ? content.items.join(', ') : '-'

        pizzaModifiers.push({
          id: `pizza-box-${boxName.replace(/\s+/g, '-').toLowerCase()}`,
          name: `${boxName}: ${itemsText}`,
          price: content.totalPrice,
          depth: 0,
        })
      })
    })

    // Add cooking instructions
    if (config.cookingInstructions) {
      pizzaModifiers.push({
        id: 'pizza-cooking',
        name: config.cookingInstructions,
        price: 0,
        depth: 0,
      })
    }

    // Add cut style
    if (config.cutStyle && config.cutStyle !== 'Normal Cut') {
      pizzaModifiers.push({
        id: 'pizza-cut',
        name: config.cutStyle,
        price: 0,
        depth: 0,
      })
    }

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
  const handleStartTimedSession = async () => {
    if (!selectedTimedItem || !employee?.location?.id) return

    const pricing = selectedTimedItem.timedPricing as { per15Min?: number; per30Min?: number; perHour?: number; minimum?: number } | null

    // Get the rate - try selected type first, then fall back
    let rateAmount = selectedTimedItem.price
    if (pricing) {
      rateAmount = pricing[selectedRateType] || pricing.perHour || pricing.per30Min || pricing.per15Min || selectedTimedItem.price
    }

    // Calculate block time in minutes based on selected rate type
    let blockMinutes = 60 // default to 1 hour
    if (selectedRateType === 'per15Min') blockMinutes = 15
    else if (selectedRateType === 'per30Min') blockMinutes = 30
    else if (selectedRateType === 'perHour') blockMinutes = 60

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
          locationId: employee.location.id,
          menuItemId: selectedTimedItem.id,
          rateType: selectedRateType,
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
          rateType: selectedRateType,
          rateAmount,
        }])

        // Add a placeholder item to the order showing active session
        const rateLabel = selectedRateType.replace('per', '').replace('Min', ' min').replace('Hour', '/hr')
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
          locationId: employee.location.id,
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
            locationId: employee.location.id,
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
            locationId: employee.location.id,
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
          setItemModifierGroups(data.modifierGroups || [])
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
            tableId={currentOrder?.tableId}
            locationId={employee.location.id}
            employeeId={employee.id}
            items={orderPanelItems}
            subtotal={pricing.subtotal}
            cashSubtotal={pricing.cashSubtotal}
            cardSubtotal={pricing.cardSubtotal}
            tax={pricing.tax}
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
            onItemSplit={panelCallbacks.onItemSplit}
            onItemSeatChange={panelCallbacks.onItemSeatChange}
            expandedItemId={panelCallbacks.expandedItemId}
            onItemToggleExpand={panelCallbacks.onItemToggleExpand}
            onSend={handleSendToKitchen}
            onPay={async (method) => {
              // Ensure order is saved to DB before opening payment
              const orderId = savedOrderId || useOrderStore.getState().currentOrder?.id || await ensureOrderInDB(employee?.id)
              if (orderId) {
                setInitialPayMethod(method)
                setOrderToPayId(orderId)
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
            viewMode={viewMode === 'floor-plan' ? 'floor-plan' : viewMode === 'bartender' ? 'bartender' : 'legacy'}
            hasActiveTab={!!(tabCardInfo?.cardLast4 || currentOrder?.tabName)}
            requireCardForTab={requireCardForTab}
            tabCardLast4={tabCardInfo?.cardLast4}
            onStartTab={async () => {
              // Read fresh state — avoids stale closure issues
              const store = useOrderStore.getState()
              const items = store.currentOrder?.items
              if (!items?.length) return

              // Get existing order ID from Zustand (always current) or React state
              const existingOrderId = store.currentOrder?.id || savedOrderId

              // ── Existing tab with saved order → check for card & re-auth ──
              if (existingOrderId) {
                setIsSendingOrder(true)
                try {
                  // Check server for card on file (source of truth — avoids stale tabCardInfo)
                  let cardLast4 = ''
                  try {
                    const cardsRes = await fetch(`/api/orders/${existingOrderId}/cards`)
                    if (cardsRes.ok) {
                      const cardsData = await cardsRes.json()
                      const activeCard = (cardsData.data || []).find((c: { status: string }) => c.status === 'authorized')
                      if (activeCard) {
                        cardLast4 = activeCard.cardLast4 || ''
                        setTabCardInfo({
                          cardholderName: activeCard.cardholderName || undefined,
                          cardLast4: activeCard.cardLast4,
                          cardType: activeCard.cardType,
                        })
                      }
                    }
                  } catch { /* fall through to new tab flow */ }

                  if (cardLast4) {
                    // Card on file → append new items, send to kitchen, auto-increment
                    // Only POST unsent items (items already sent have sentToKitchen: true)
                    const newItems = items.filter(i => !i.sentToKitchen)
                    if (newItems.length > 0) {
                      const appendRes = await fetch(`/api/orders/${existingOrderId}/items`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          items: newItems.map(item => ({
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
                          })),
                        }),
                      })
                      if (!appendRes.ok) {
                        toast.error('Failed to save new items')
                        return
                      }
                    }

                    // Send unsent items to kitchen
                    const sendRes = await fetch(`/api/orders/${existingOrderId}/send`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ employeeId: employee?.id }),
                    })
                    if (sendRes.ok) {
                      // Await IncrementalAuthByRecordNo — show approval/decline to user
                      try {
                        const authRes = await fetch(`/api/orders/${existingOrderId}/auto-increment`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ employeeId: employee?.id, force: true }),
                        })
                        if (authRes.ok) {
                          const d = await authRes.json()
                          if (d.data?.incremented) {
                            toast.success(`Re-auth approved — hold now $${d.data.newAuthorizedTotal.toFixed(2)} •••${cardLast4}`)
                          } else if (d.data?.action === 'below_threshold') {
                            toast.success(`Sent to tab •••${cardLast4} — hold $${d.data.totalAuthorized.toFixed(2)} still covers`)
                          } else if (d.data?.action === 'increment_failed') {
                            toast.error(`Re-auth DECLINED •••${cardLast4} — hold remains $${d.data.totalAuthorized.toFixed(2)}`)
                          } else if (d.data?.action === 'no_card') {
                            toast.warning(`Sent to tab — no card on file for re-auth`)
                          } else {
                            toast.success(`Added to tab •••${cardLast4}`)
                          }
                        } else {
                          toast.success(`Added to tab •••${cardLast4}`)
                        }
                      } catch {
                        toast.success(`Added to tab •••${cardLast4}`)
                      }

                      clearOrder()
                      setSavedOrderId(null)
                      setOrderSent(false)
                      setSelectedOrderType(null)
                      setOrderCustomFields({})
                      setTabsRefreshTrigger(prev => prev + 1)
                    } else {
                      toast.error('Failed to send to kitchen')
                    }
                    return
                  }
                  // Card not found on existing order — fall through to new tab flow below
                } finally {
                  setIsSendingOrder(false)
                }
              }

              // ── New tab (no existing order or no card on file) → card auth flow ──
              const currentStore = useOrderStore.getState()
              if (currentStore.currentOrder && currentStore.currentOrder.orderType !== 'bar_tab') {
                currentStore.updateOrderType('bar_tab')
              }

              const orderId = existingOrderId || await ensureOrderInDB(employee?.id)
              if (orderId) {
                setSavedOrderId(orderId)
                setCardTabOrderId(orderId)
                setShowCardTabFlow(true)
              } else {
                toast.error('Failed to save order — please try again')
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
            className={viewMode === 'bartender' ? 'w-[360px] flex-shrink-0' : 'flex-1 min-h-0 !h-auto'}
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
      <>
        {viewMode === 'floor-plan' && (
          <FloorPlanHome
            locationId={employee.location.id}
            employeeId={employee.id}
            employeeName={employee.displayName}
            employeeRole={employee.role?.name}
            isManager={canAccessAdmin}
            onLogout={logout}
            onOpenTimeClock={() => setShowTimeClockModal(true)}
            onSwitchUser={() => { logout() }}
            onOpenSettings={() => setShowDisplaySettings(true)}
            onOpenAdminNav={canAccessAdmin ? () => router.push('/settings') : undefined}
            onSwitchToBartenderView={() => {
              // Preserve current order context when switching views
              const order = useOrderStore.getState().currentOrder
              if (order?.orderType === 'bar_tab') setMode('bar')
              setViewMode('bartender')
            }}
            onOpenPayment={(orderId) => {
              setOrderToPayId(orderId)
              setShowPaymentModal(true)
            }}
            onOpenModifiers={handleOpenModifiersShared as any}
            onOpenOrdersPanel={() => { setShowTabsPanel(true) }}
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
          >
            {sharedOrderPanel}
          </FloorPlanHome>
        )}
        {viewMode === 'bartender' && (
          <BartenderView
            locationId={employee.location.id}
            employeeId={employee.id}
            employeeName={employee.displayName}
            employeePermissions={permissionsArray}
            onRegisterDeselectTab={(fn) => { bartenderDeselectTabRef.current = fn }}
            onLogout={logout}
            onOpenTimeClock={() => setShowTimeClockModal(true)}
            onSwitchToFloorPlan={() => {
              // Preserve current order context when switching views
              const order = useOrderStore.getState().currentOrder
              if (order?.id && order.tableId) {
                setOrderToLoad({ id: order.id, orderNumber: order.orderNumber || 0, orderType: order.orderType })
              }
              if (order?.orderType !== 'bar_tab') setMode('food')
              setViewMode('floor-plan')
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
              setOrderToPayId(orderId)
              setShowPaymentModal(true)
            }}
            onOpenModifiers={handleOpenModifiersShared as any}
            requireNameWithoutCard={false}
            tapCardBehavior="close"
            refreshTrigger={tabsRefreshTrigger}
            initialCategories={categories}
            initialMenuItems={menuItems}
          >
            {sharedOrderPanel}
          </BartenderView>
        )}

        {/* Shared Modals — one set for both views */}
        <POSDisplaySettingsModal
          isOpen={showDisplaySettings}
          onClose={() => setShowDisplaySettings(false)}
          settings={displaySettings}
          onUpdate={updateSetting}
          onBatchUpdate={updateSettings}
        />
          <>
            {showTabsPanel && !isTabManagerExpanded && (
              <div
                className="fixed inset-0 bg-black/30 z-40"
                onClick={() => setShowTabsPanel(false)}
              />
            )}
            <div className={isTabManagerExpanded ? '' : 'fixed left-0 top-0 bottom-0 w-80 bg-slate-900 shadow-xl z-50'} style={!showTabsPanel && !isTabManagerExpanded ? { display: 'none' } : undefined}>
              <OpenOrdersPanel
                locationId={employee.location.id}
                employeeId={employee.id}
                employeePermissions={permissionsArray}
                refreshTrigger={tabsRefreshTrigger}
                isExpanded={isTabManagerExpanded}
                onToggleExpand={() => setIsTabManagerExpanded(!isTabManagerExpanded)}
                onSelectOrder={(order) => {
                  setOrderToLoad({
                    id: order.id,
                    orderNumber: order.orderNumber,
                    tableId: order.tableId || undefined,
                    tabName: order.tabName || undefined,
                    orderType: order.orderType,
                  })
                  // Restore tab card info from pre-auth data
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
                onViewOrder={(order) => {
                  setOrderToLoad({
                    id: order.id,
                    orderNumber: order.orderNumber,
                    tableId: order.tableId || undefined,
                    tabName: order.tabName || undefined,
                    orderType: order.orderType,
                  })
                  // Restore tab card info from pre-auth data
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
              />
            </div>
          </>
        {showModifierModal && selectedItem && (
          <ModifierModal
            item={selectedItem}
            modifierGroups={itemModifierGroups}
            loading={loadingModifiers}
            editingItem={editingOrderItem}
            dualPricing={dualPricing}
            initialNotes={editingOrderItem?.specialNotes}
            onConfirm={editingOrderItem && !inlineModifierCallbackRef.current ? handleUpdateItemWithModifiers : handleAddItemWithModifiers}
            onCancel={() => {
              setShowModifierModal(false)
              setSelectedItem(null)
              setItemModifierGroups([])
              setEditingOrderItem(null)
              inlineModifierCallbackRef.current = null
            }}
          />
        )}
        {showPizzaModal && selectedPizzaItem && (
          <PizzaBuilderModal
            item={selectedPizzaItem}
            editingItem={editingPizzaItem}
            onConfirm={handleAddPizzaToOrder}
            onCancel={() => {
              setShowPizzaModal(false)
              setSelectedPizzaItem(null)
              setEditingPizzaItem(null)
              inlinePizzaCallbackRef.current = null
            }}
          />
        )}
        {showEntertainmentStart && entertainmentItem && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <EntertainmentSessionStart
              itemName={entertainmentItem.name}
              itemId={entertainmentItem.id}
              locationId={employee?.location?.id || ''}
              ratePerMinute={entertainmentItem.ratePerMinute || 0.25}
              prepaidPackages={entertainmentItem.prepaidPackages}
              happyHour={entertainmentItem.happyHourEnabled ? {
                enabled: true,
                discount: 0,
                start: '',
                end: '',
                days: [],
              } : undefined}
              currentOrderId={savedOrderId || null}
              currentOrderName={currentOrder?.tabName || null}
              openTabs={[]}
              onStartWithCurrentOrder={handleStartEntertainmentWithCurrentOrder}
              onStartWithNewTab={handleStartEntertainmentWithNewTab}
              onStartWithExistingTab={handleStartEntertainmentWithExistingTab}
              onClose={() => {
                setShowEntertainmentStart(false)
                setEntertainmentItem(null)
              }}
            />
          </div>
        )}
        {showTimedRentalModal && selectedTimedItem && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
              <div className="p-4 border-b bg-purple-50">
                <h2 className="text-lg font-bold text-purple-800">{selectedTimedItem.name}</h2>
                <p className="text-sm text-purple-600">Start a timed session</p>
              </div>
              <div className="p-6">
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Rate
                  </label>
                  <div className="space-y-2">
                    {selectedTimedItem.timedPricing?.per15Min ? (
                      <button
                        onClick={() => setSelectedRateType('per15Min')}
                        className={`w-full p-3 rounded-lg border-2 text-left flex justify-between items-center ${
                          selectedRateType === 'per15Min'
                            ? 'border-purple-500 bg-purple-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <span>Per 15 minutes</span>
                        <span className="font-bold">{formatCurrency(selectedTimedItem.timedPricing.per15Min)}</span>
                      </button>
                    ) : null}
                    {selectedTimedItem.timedPricing?.per30Min ? (
                      <button
                        onClick={() => setSelectedRateType('per30Min')}
                        className={`w-full p-3 rounded-lg border-2 text-left flex justify-between items-center ${
                          selectedRateType === 'per30Min'
                            ? 'border-purple-500 bg-purple-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <span>Per 30 minutes</span>
                        <span className="font-bold">{formatCurrency(selectedTimedItem.timedPricing.per30Min)}</span>
                      </button>
                    ) : null}
                    {selectedTimedItem.timedPricing?.perHour ? (
                      <button
                        onClick={() => setSelectedRateType('perHour')}
                        className={`w-full p-3 rounded-lg border-2 text-left flex justify-between items-center ${
                          selectedRateType === 'perHour'
                            ? 'border-purple-500 bg-purple-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <span>Per hour</span>
                        <span className="font-bold">{formatCurrency(selectedTimedItem.timedPricing.perHour)}</span>
                      </button>
                    ) : null}
                    {!selectedTimedItem.timedPricing?.per15Min &&
                     !selectedTimedItem.timedPricing?.per30Min &&
                     !selectedTimedItem.timedPricing?.perHour && (
                      <button
                        onClick={() => setSelectedRateType('perHour')}
                        className="w-full p-3 rounded-lg border-2 text-left flex justify-between items-center border-purple-500 bg-purple-50"
                      >
                        <span>Per hour (base rate)</span>
                        <span className="font-bold">{formatCurrency(selectedTimedItem.price)}</span>
                      </button>
                    )}
                  </div>
                </div>
                {selectedTimedItem.timedPricing?.minimum && (
                  <p className="text-sm text-gray-500 mb-4">
                    Minimum: {selectedTimedItem.timedPricing.minimum} minutes
                  </p>
                )}
              </div>
              <div className="p-4 border-t bg-gray-50 flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowTimedRentalModal(false)
                    setSelectedTimedItem(null)
                    inlineTimedRentalCallbackRef.current = null
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleStartTimedSession}
                  disabled={loadingSession}
                  className="flex-1 bg-purple-500 hover:bg-purple-600"
                >
                  {loadingSession ? 'Starting...' : 'Start Timer'}
                </Button>
              </div>
            </div>
          </div>
        )}
        {showPaymentModal && orderToPayId && (
          <PaymentModal
            isOpen={showPaymentModal}
            initialMethod={initialPayMethod}
            onClose={() => {
              setShowPaymentModal(false)
              setOrderToPayId(null)
              setInitialPayMethod(undefined)
            }}
            orderId={orderToPayId}
            orderTotal={currentOrder?.total ?? 0}
            subtotal={currentOrder?.subtotal}
            remainingBalance={currentOrder?.total ?? 0}
            tabCards={paymentTabCards}
            dualPricing={dualPricing}
            paymentSettings={paymentSettings}
            priceRounding={priceRounding}
            onPaymentComplete={(receiptData) => {
              const paidId = orderToPayId
              setShowPaymentModal(false)
              setOrderToPayId(null)
              setInitialPayMethod(undefined)
              // Show receipt modal only when receiptData is provided
              // (fire-and-forget cash payments pass no data → skip receipt)
              if (paidId && receiptData) {
                setPreloadedReceiptData(receiptData)
                setReceiptOrderId(paidId)
                setShowReceiptModal(true)
              }
              // Clear the order panel after payment
              clearOrder()
              setSavedOrderId(null)
              setOrderSent(false)
              setSelectedOrderType(null)
              setOrderCustomFields({})
              setTabsRefreshTrigger(prev => prev + 1)
              setFloorPlanRefreshTrigger(prev => prev + 1)
            }}
            employeeId={employee?.id}
            terminalId="terminal-1"
            locationId={employee?.location?.id}
            waitForOrderReady={async () => {
              if (orderReadyPromiseRef.current) {
                await orderReadyPromiseRef.current
                orderReadyPromiseRef.current = null
              }
            }}
          />
        )}
        <ReceiptModal
          isOpen={showReceiptModal}
          onClose={() => {
            if (receiptOrderId) {
              setPaidOrderId(receiptOrderId)
            }
            setShowReceiptModal(false)
            setReceiptOrderId(null)
            setPreloadedReceiptData(null)
          }}
          orderId={receiptOrderId}
          locationId={employee.location?.id || ''}
          receiptSettings={receiptSettings}
          preloadedData={preloadedReceiptData}
        />
        <TipAdjustmentOverlay
          isOpen={showTipAdjustment}
          onClose={() => setShowTipAdjustment(false)}
          locationId={employee?.location?.id}
          employeeId={employee?.id}
        />

        {/* Card-First Tab Flow Modal */}
        {showCardTabFlow && cardTabOrderId && employee && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" style={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <CardFirstTabFlow
                orderId={cardTabOrderId}
                readerId="reader-1"
                employeeId={employee.id}
                onComplete={async (result) => {
                  setShowCardTabFlow(false)
                  if (result.approved) {
                    setTabCardInfo({
                      cardholderName: result.cardholderName,
                      cardLast4: result.cardLast4,
                      cardType: result.cardType,
                    })
                    const store = useOrderStore.getState()
                    if (store.currentOrder && result.cardholderName) {
                      store.currentOrder.tabName = result.cardholderName
                    }
                    setTabNameInput(result.cardholderName || '')
                    setTabNameCallback(() => async () => {
                      // Direct send — bypass validateBeforeSend since card is already authorized
                      const store = useOrderStore.getState()
                      const items = store.currentOrder?.items
                      if (!items?.length) return
                      setIsSendingOrder(true)
                      try {
                        const orderId = savedOrderId || store.currentOrder?.id || await ensureOrderInDB(employee?.id)
                        if (orderId) {
                          // Update metadata (tab name) on the saved order
                          await fetch(`/api/orders/${orderId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ tabName: store.currentOrder?.tabName }),
                          })
                          const sendRes = await fetch(`/api/orders/${orderId}/send`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ employeeId: employee?.id }),
                          })
                          if (sendRes.ok) {
                            // Fire auto-increment in background
                            fetch(`/api/orders/${orderId}/auto-increment`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ employeeId: employee?.id }),
                            }).catch(() => {})
                            toast.success(`Tab opened — •••${result.cardLast4}`)
                            clearOrder()
                            setSavedOrderId(null)
                            setOrderSent(false)
                            setSelectedOrderType(null)
                            setOrderCustomFields({})
                            setTabsRefreshTrigger(prev => prev + 1)
                          } else {
                            toast.error('Failed to send to kitchen')
                          }
                        }
                      } finally {
                        setIsSendingOrder(false)
                      }
                    })
                    setShowTabNamePrompt(true)
                  } else {
                    setCardTabOrderId(null)
                  }
                }}
                onCancel={() => {
                  setShowCardTabFlow(false)
                  setCardTabOrderId(null)
                }}
              />
            </div>
          </div>
        )}

        {/* Tab Name Prompt Modal */}
        {/* Discount Modal */}
        {showDiscountModal && currentOrder && savedOrderId && employee && (
          <DiscountModal
            isOpen={showDiscountModal}
            onClose={() => setShowDiscountModal(false)}
            orderId={savedOrderId}
            orderSubtotal={currentOrder.subtotal || 0}
            locationId={employee.location?.id || ''}
            employeeId={employee.id}
            appliedDiscounts={appliedDiscounts}
            onDiscountApplied={handleDiscountApplied}
          />
        )}

        {/* Comp/Void Modal */}
        {showCompVoidModal && (savedOrderId || orderToPayId) && compVoidItem && employee && (
          <CompVoidModal
            isOpen={showCompVoidModal}
            onClose={() => {
              setShowCompVoidModal(false)
              setCompVoidItem(null)
            }}
            orderId={(savedOrderId || orderToPayId)!}
            item={compVoidItem as OrderItem}
            employeeId={employee.id}
            locationId={employee.location?.id || ''}
            onComplete={handleCompVoidComplete}
          />
        )}

        {/* Resend to Kitchen Modal */}
        {resendModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
              <h3 className="text-lg font-bold mb-2">Resend to Kitchen</h3>
              <p className="text-gray-600 mb-4">
                Resend &quot;{resendModal.itemName}&quot; to kitchen?
              </p>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Note for kitchen (optional)
                </label>
                <input
                  type="text"
                  value={resendNote}
                  onChange={(e) => setResendNote(e.target.value)}
                  placeholder="e.g., Make it well done"
                  className="w-full p-3 border rounded-lg text-lg"
                  autoFocus
                />
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setResendModal(null)
                    setResendNote('')
                  }}
                  disabled={resendLoading}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                  onClick={confirmResendItem}
                  disabled={resendLoading}
                >
                  {resendLoading ? 'Sending...' : 'Resend'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Item Transfer Modal */}
        {showItemTransferModal && savedOrderId && employee && (
          <ItemTransferModal
            isOpen={showItemTransferModal}
            onClose={() => setShowItemTransferModal(false)}
            currentOrderId={savedOrderId}
            items={currentOrder?.items.map((item) => ({
              id: item.id,
              tempId: item.id,
              name: item.name,
              price: item.price,
              quantity: item.quantity,
              modifiers: item.modifiers.map((mod) => ({
                name: mod.name,
                price: mod.price,
              })),
              sent: item.sentToKitchen,
            })) || []}
            locationId={employee.location?.id || ''}
            employeeId={employee.id}
            onTransferComplete={async (transferredItemIds) => {
              try {
                const response = await fetch(`/api/orders/${savedOrderId}`)
                if (response.ok) {
                  const orderData = await response.json()
                  // Pass raw API data — store.loadOrder handles all mapping
                  loadOrder(orderData)
                }
              } catch (error) {
                console.error('Failed to reload order:', error)
              }
            }}
          />
        )}

        {/* Split Ticket Manager */}
        {showSplitTicketManager && savedOrderId && currentOrder && (
          <SplitTicketManager
            isOpen={showSplitTicketManager}
            onClose={() => setShowSplitTicketManager(false)}
            orderId={savedOrderId}
            orderNumber={currentOrder.orderNumber || 0}
            items={currentOrder.items.map(item => ({
              id: item.id,
              tempId: item.id,
              name: item.name,
              price: item.price,
              quantity: item.quantity,
              modifiers: item.modifiers.map(mod => ({
                id: (mod.id || mod.modifierId) ?? '',
                modifierId: mod.modifierId,
                name: mod.name,
                price: Number(mod.price),
                depth: mod.depth ?? 0,
                preModifier: mod.preModifier ?? null,
                spiritTier: mod.spiritTier ?? null,
                linkedBottleProductId: mod.linkedBottleProductId ?? null,
                parentModifierId: mod.parentModifierId ?? null,
              })),
            }))}
            orderDiscount={appliedDiscounts.reduce((sum, d) => sum + d.amount, 0)}
            taxRate={taxRate}
            roundTo={priceRounding.enabled ? priceRounding.increment : 'none'}
            onSplitComplete={handleSplitTicketComplete}
          />
        )}

        {showTabNamePrompt && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="rounded-2xl shadow-2xl w-full max-w-sm p-6" style={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)' }}>
              {tabCardInfo?.cardLast4 ? (
                <>
                  <h3 className="text-lg font-bold text-white mb-2">Tab Started</h3>
                  <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg" style={{ background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                    <span className="text-green-400 text-sm">✓</span>
                    <span className="text-green-300 text-sm font-medium">
                      {tabCardInfo.cardType} •••{tabCardInfo.cardLast4}
                    </span>
                    {tabCardInfo.cardholderName && (
                      <span className="text-green-300 text-sm ml-auto font-medium">{tabCardInfo.cardholderName}</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-400 mb-3">Add a nickname? (shown above cardholder name)</p>
                  <input
                    autoFocus
                    type="text"
                    placeholder="e.g. Blue shirt, Patio group..."
                    value={tabNameInput}
                    onChange={(e) => setTabNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const store = useOrderStore.getState()
                        if (store.currentOrder && tabNameInput.trim()) {
                          store.currentOrder.tabName = `${tabNameInput.trim()} — ${tabCardInfo.cardholderName || ''}`
                        }
                        setShowTabNamePrompt(false)
                        tabNameCallback?.()
                      }
                    }}
                    className="w-full px-4 py-3 rounded-xl text-white text-lg"
                    style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}
                  />
                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={() => { setShowTabNamePrompt(false); tabNameCallback?.() }}
                      className="flex-1 py-3 rounded-xl text-gray-300 font-semibold"
                      style={{ background: 'rgba(255,255,255,0.08)' }}
                    >
                      Skip
                    </button>
                    <button
                      onClick={() => {
                        const store = useOrderStore.getState()
                        if (store.currentOrder && tabNameInput.trim()) {
                          store.currentOrder.tabName = `${tabNameInput.trim()} — ${tabCardInfo.cardholderName || ''}`
                        }
                        setShowTabNamePrompt(false)
                        tabNameCallback?.()
                      }}
                      className="flex-1 py-3 rounded-xl text-white font-bold"
                      style={{ background: tabNameInput.trim() ? '#8b5cf6' : 'rgba(255,255,255,0.1)', opacity: tabNameInput.trim() ? 1 : 0.5 }}
                    >
                      Send to Tab
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-bold text-white mb-1">Tab Name</h3>
                  <p className="text-sm text-gray-400 mb-4">Enter a name for this tab</p>
                  <input
                    autoFocus
                    type="text"
                    placeholder="e.g. John, Table 5, etc."
                    value={tabNameInput}
                    onChange={(e) => setTabNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && tabNameInput.trim()) {
                        const store = useOrderStore.getState()
                        if (store.currentOrder) { store.currentOrder.tabName = tabNameInput.trim() }
                        setShowTabNamePrompt(false)
                        tabNameCallback?.()
                      }
                    }}
                    className="w-full px-4 py-3 rounded-xl text-white text-lg"
                    style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}
                  />
                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={() => { setShowTabNamePrompt(false); setTabNameCallback(null) }}
                      className="flex-1 py-3 rounded-xl text-gray-400 font-semibold"
                      style={{ background: 'rgba(255,255,255,0.05)' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        if (!tabNameInput.trim()) return
                        const store = useOrderStore.getState()
                        if (store.currentOrder) { store.currentOrder.tabName = tabNameInput.trim() }
                        setShowTabNamePrompt(false)
                        tabNameCallback?.()
                      }}
                      disabled={!tabNameInput.trim()}
                      className="flex-1 py-3 rounded-xl text-white font-bold"
                      style={{ background: tabNameInput.trim() ? '#8b5cf6' : 'rgba(255,255,255,0.1)', opacity: tabNameInput.trim() ? 1 : 0.5 }}
                    >
                      Start Tab
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Time Clock Modal */}
        <TimeClockModal
          isOpen={showTimeClockModal}
          onClose={() => setShowTimeClockModal(false)}
          employeeId={employee?.id || ''}
          employeeName={employee?.displayName || `${employee?.firstName} ${employee?.lastName}` || ''}
          locationId={employee?.location?.id || ''}
          onClockOut={() => {
            if (currentShift) {
              setShowShiftCloseoutModal(true)
            }
          }}
        />

        {/* Shift Start Modal */}
        <ShiftStartModal
          isOpen={showShiftStartModal}
          onClose={() => setShowShiftStartModal(false)}
          employeeId={employee?.id || ''}
          employeeName={employee?.displayName || `${employee?.firstName} ${employee?.lastName}` || ''}
          locationId={employee?.location?.id || ''}
          cashHandlingMode={useAuthStore.getState().workingRole?.cashHandlingMode || employee?.availableRoles?.find(r => r.isPrimary)?.cashHandlingMode || 'drawer'}
          workingRoleId={useAuthStore.getState().workingRole?.id || null}
          onShiftStarted={(shiftId) => {
            fetch(`/api/shifts/${shiftId}`)
              .then(res => res.json())
              .then(data => {
                setCurrentShift({
                  id: data.shift.id,
                  startedAt: data.shift.startedAt,
                  startingCash: data.shift.startingCash,
                  employee: {
                    ...data.shift.employee,
                    roleId: employee?.role?.id,
                  },
                  locationId: employee?.location?.id,
                })
              })
              .catch(err => console.error('Failed to fetch shift:', err))
          }}
        />

        {/* Shift Closeout Modal */}
        {currentShift && (
          <ShiftCloseoutModal
            isOpen={showShiftCloseoutModal}
            onClose={() => setShowShiftCloseoutModal(false)}
            shift={currentShift}
            onCloseoutComplete={() => {
              setCurrentShift(null)
            }}
            permissions={permissionsArray}
            cashHandlingMode={useAuthStore.getState().workingRole?.cashHandlingMode || employee?.availableRoles?.find(r => r.isPrimary)?.cashHandlingMode || 'drawer'}
          />
        )}
      </>
    )
  }

  // Fallback — should not be reached since viewMode is always 'floor-plan' or 'bartender'
  return null
}
