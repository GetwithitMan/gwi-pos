'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { useOrderStore } from '@/stores/order-store'
import { useDevStore } from '@/stores/dev-store'
import { useOrderSettings } from '@/hooks/useOrderSettings'
import { usePOSDisplay } from '@/hooks/usePOSDisplay'
import { usePOSLayout } from '@/hooks/usePOSLayout'
import { useActiveOrder } from '@/hooks/useActiveOrder'
import { usePricing } from '@/hooks/usePricing'
import { useOrderPanelItems } from '@/hooks/useOrderPanelItems'
import { calculateCardPrice } from '@/lib/pricing'
import { isTempId } from '@/lib/order-utils'
import { useFloorPlanStore } from '@/components/floor-plan/use-floor-plan'
import dynamic from 'next/dynamic'
import { FloorPlanHome } from '@/components/floor-plan'
import { SilentErrorBoundary } from '@/lib/error-boundary'

// BartenderView (~2K lines) is only rendered for the 'bartender' role.
// Dynamic import keeps it out of the main POS bundle for all other roles.
const BartenderView = dynamic(
  () => import('@/components/bartender/BartenderView').then(m => ({ default: m.BartenderView })),
  { ssr: false }
)
import { UnifiedPOSHeader } from '@/components/orders/UnifiedPOSHeader'
import { useMenuSearch } from '@/hooks/useMenuSearch'
import { useQuickPick } from '@/hooks/useQuickPick'
import { useOrderPanelCallbacks } from '@/hooks/useOrderPanelCallbacks'
import { useOrderingEngine } from '@/hooks/useOrderingEngine'
import { toast } from '@/stores/toast-store'
import { hasPermission, PERMISSIONS } from '@/lib/auth-utils'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { useOrderPageStore } from '@/stores/order-page-store'
import { OrderPageModals } from './OrderPageModals'
import { WeightCaptureModal } from '@/components/scale/WeightCaptureModal'
import { PricingOptionPicker } from '@/components/orders/PricingOptionPicker'
import { AgeVerificationModal } from '@/components/orders/AgeVerificationModal'
import { AllergenNotice } from '@/components/orders/AllergenNotice'
import { SharedOrderPanel } from './components/SharedOrderPanel'
import { useOrderBootstrap } from './hooks/useOrderBootstrap'
import { useOrderHandlers } from './hooks/useOrderHandlers'
import { TestModeBanner } from '@/components/payments/TestModeBanner'
import { HappyHourBanner } from '@/components/pos/HappyHourBanner'
import { TrainingModeBanner } from '@/components/pos/TrainingModeBanner'
import type { MenuItem, PizzaOrderConfig } from '@/types'
import type { ViewMode, OrderToLoad, QuickBarItem } from './types'

// DEFERRED: Replace with dynamic terminal ID from device provisioning
const TERMINAL_ID = 'terminal-1'

export default function OrdersPage() {
  const router = useRouter()
  const employee = useAuthStore(s => s.employee)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const logout = useAuthStore(s => s.logout)
  const currentOrderId = useOrderStore(s => s.currentOrder?.id)
  const currentOrderStatus = useOrderStore(s => s.currentOrder?.status)
  const currentOrderType = useOrderStore(s => s.currentOrder?.orderType)
  const currentOrderSubtotal = useOrderStore(s => s.currentOrder?.subtotal)
  const currentOrderDiscountTotal = useOrderStore(s => s.currentOrder?.discountTotal)
  const currentOrderTipTotal = useOrderStore(s => s.currentOrder?.tipTotal)
  // Full order ref: only used for payment modal prop and split check items.
  // Hot-path reads above use granular selectors to avoid re-rendering on every item change.
  const currentOrder = useOrderStore(s => s.currentOrder)
  const hasDevAccess = useDevStore(s => s.hasDevAccess)
  const setHasDevAccess = useDevStore(s => s.setHasDevAccess)

  // ── Hydration guard ──
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])

  // Preload PaymentModal
  useEffect(() => { import('@/components/payment/PaymentModal') }, [])

  // ── Active order hook ──
  const activeOrderFull = useActiveOrder({
    locationId: employee?.location?.id,
    employeeId: employee?.id,
  })
  const { expandedItemId, handleToggleExpand, ensureOrderInDB, clearOrder } = activeOrderFull

  // ── View mode ──
  const isBartender = employee?.role?.name?.toLowerCase() === 'bartender'
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    isBartender ? 'bartender' : 'floor-plan'
  )

  // Auto-switch to bartender view when a bartender logs in (e.g. employee switch)
  const prevEmployeeIdRef = useRef(employee?.id)
  useEffect(() => {
    if (employee?.id && employee.id !== prevEmployeeIdRef.current) {
      prevEmployeeIdRef.current = employee.id
      const nowBartender = employee?.role?.name?.toLowerCase() === 'bartender'
      setViewMode(nowBartender ? 'bartender' : 'floor-plan')
    }
  }, [employee?.id, employee?.role?.name])

  // ── Permissions ──
  const permissionsArray = Array.isArray(employee?.permissions) ? employee.permissions : []
  useEffect(() => {
    if (employee && !hasPermission(permissionsArray, PERMISSIONS.POS_ACCESS)) {
      router.replace('/crew')
    }
  }, [employee, permissionsArray, router])

  const isManager = employee?.role?.name && ['Manager', 'Owner', 'Admin'].includes(employee.role.name) ||
    permissionsArray.some(p => ['admin', 'manage_menu', 'manage_employees'].includes(p))
  const canAccessAdmin = isManager ||
    permissionsArray.some(p => p.startsWith('reports.') || p.startsWith('settings.') || p.startsWith('tips.'))

  // ── Domain hooks (state groups) ──
  // ── All modal + UI orchestration state from store ──
  const store = useOrderPageStore
  const setShowModifierModal = store(s => s.setShowModifierModal)
  const setSelectedItem = store(s => s.setSelectedItem)
  const setItemModifierGroups = store(s => s.setItemModifierGroups)
  const setLoadingModifiers = store(s => s.setLoadingModifiers)
  const setEditingOrderItem = store(s => s.setEditingOrderItem)
  const setShowPizzaModal = store(s => s.setShowPizzaModal)
  const setSelectedPizzaItem = store(s => s.setSelectedPizzaItem)
  const setSelectedPizzaSpecialty = store(s => s.setSelectedPizzaSpecialty)
  const setEditingPizzaItem = store(s => s.setEditingPizzaItem)
  const setShowComboModal = store(s => s.setShowComboModal)
  const setSelectedComboItem = store(s => s.setSelectedComboItem)
  const setComboTemplate = store(s => s.setComboTemplate)
  const setComboSelections = store(s => s.setComboSelections)
  const setShowTimedRentalModal = store(s => s.setShowTimedRentalModal)
  const setSelectedTimedItem = store(s => s.setSelectedTimedItem)
  const setSelectedRateType = store(s => s.setSelectedRateType)
  const setLoadingSession = store(s => s.setLoadingSession)
  const setShowEntertainmentStart = store(s => s.setShowEntertainmentStart)
  const setEntertainmentItem = store(s => s.setEntertainmentItem)
  const setShowPaymentModal = store(s => s.setShowPaymentModal)
  const setInitialPayMethod = store(s => s.setInitialPayMethod)
  const setOrderToPayId = store(s => s.setOrderToPayId)
  const setPaymentTabCards = store(s => s.setPaymentTabCards)
  const setShowDiscountModal = store(s => s.setShowDiscountModal)
  const setAppliedDiscounts = store(s => s.setAppliedDiscounts)
  const setItemDiscountTargetId = store(s => s.setItemDiscountTargetId)
  const setShowCompVoidModal = store(s => s.setShowCompVoidModal)
  const setCompVoidItem = store(s => s.setCompVoidItem)
  const setResendModal = store(s => s.setResendModal)
  const setResendNote = store(s => s.setResendNote)
  const setResendLoading = store(s => s.setResendLoading)
  const setShowReceiptModal = store(s => s.setShowReceiptModal)
  const setReceiptOrderId = store(s => s.setReceiptOrderId)
  const setPreloadedReceiptData = store(s => s.setPreloadedReceiptData)
  const setShowDisplaySettings = store(s => s.setShowDisplaySettings)
  const setShowTabNamePrompt = store(s => s.setShowTabNamePrompt)
  const setTabNameCallback = store(s => s.setTabNameCallback)
  const setShowItemTransferModal = store(s => s.setShowItemTransferModal)
  const setShowTabTransferModal = store(s => s.setShowTabTransferModal)
  const setEditingNotesItemId = store(s => s.setEditingNotesItemId)
  const setEditingNotesText = store(s => s.setEditingNotesText)
  const setShowSplitTicketManager = store(s => s.setShowSplitTicketManager)
  const setSplitManageMode = store(s => s.setSplitManageMode)
  const setEditingChildSplit = store(s => s.setEditingChildSplit)
  const setSplitParentToReturnTo = store(s => s.setSplitParentToReturnTo)
  const setPayAllSplitsQueue = store(s => s.setPayAllSplitsQueue)
  const setShowPayAllSplitsConfirm = store(s => s.setShowPayAllSplitsConfirm)
  const setPayAllSplitsTotal = store(s => s.setPayAllSplitsTotal)
  const setPayAllSplitsCardTotal = store(s => s.setPayAllSplitsCardTotal)
  const setPayAllSplitsParentId = store(s => s.setPayAllSplitsParentId)
  const setPayAllSplitsProcessing = store(s => s.setPayAllSplitsProcessing)
  const setPayAllSplitsStep = store(s => s.setPayAllSplitsStep)
  const setOrderSplitChips = store(s => s.setOrderSplitChips)
  const setSplitParentId = store(s => s.setSplitParentId)
  const setSplitChipsFlashing = store(s => s.setSplitChipsFlashing)
  const setShowTabsPanel = store(s => s.setShowTabsPanel)
  const setIsTabManagerExpanded = store(s => s.setIsTabManagerExpanded)
  const setShowTipAdjustment = store(s => s.setShowTipAdjustment)
  const setTabsRefreshTrigger = store(s => s.setTabsRefreshTrigger)
  const setShowTimeClockModal = store(s => s.setShowTimeClockModal)
  const setCurrentShift = store(s => s.setCurrentShift)
  const setShowShiftStartModal = store(s => s.setShowShiftStartModal)
  const setShowShiftCloseoutModal = store(s => s.setShowShiftCloseoutModal)
  const setShowCardTabFlow = store(s => s.setShowCardTabFlow)
  const setCardTabOrderId = store(s => s.setCardTabOrderId)
  const setTabCardInfo = store(s => s.setTabCardInfo)
  const setShowWeightModal = store(s => s.setShowWeightModal)
  const setWeightCaptureItem = store(s => s.setWeightCaptureItem)
  const setPricingPickerItem = store(s => s.setPricingPickerItem)
  const setShowAgeVerification = store(s => s.setShowAgeVerification)
  const setAgeVerificationItem = store(s => s.setAgeVerificationItem)
  const setAgeVerificationCallback = store(s => s.setAgeVerificationCallback)
  const setAllergenNotice = store(s => s.setAllergenNotice)

  // Read-only store selectors used in this component
  const showSplitTicketManager = store(s => s.showSplitTicketManager)
  const editingChildSplit = store(s => s.editingChildSplit)
  const orderSplitChips = store(s => s.orderSplitChips)
  const splitChipsFlashing = store(s => s.splitChipsFlashing)
  const splitParentId = store(s => s.splitParentId)
  const splitParentToReturnTo = store(s => s.splitParentToReturnTo)
  const payAllSplitsQueue = store(s => s.payAllSplitsQueue)
  const tabCardInfo = store(s => s.tabCardInfo)
  const tabsRefreshTrigger = store(s => s.tabsRefreshTrigger)
  const showWeightModal = store(s => s.showWeightModal)
  const weightCaptureItem = store(s => s.weightCaptureItem)
  const pricingPickerItem = store(s => s.pricingPickerItem)
  const showAgeVerification = store(s => s.showAgeVerification)
  const ageVerificationItem = store(s => s.ageVerificationItem)
  const ageVerificationCallback = store(s => s.ageVerificationCallback)
  const allergenNotice = store(s => s.allergenNotice)
  const selectedItem = store(s => s.selectedItem)
  const editingOrderItem = store(s => s.editingOrderItem)
  const selectedPizzaItem = store(s => s.selectedPizzaItem)
  const editingPizzaItem = store(s => s.editingPizzaItem)
  const selectedComboItem = store(s => s.selectedComboItem)
  const comboTemplate = store(s => s.comboTemplate)
  const comboSelections = store(s => s.comboSelections)
  const selectedTimedItem = store(s => s.selectedTimedItem)
  const selectedRateType = store(s => s.selectedRateType)
  const entertainmentItem = store(s => s.entertainmentItem)
  const resendModal = store(s => s.resendModal)
  const resendNote = store(s => s.resendNote)
  const editingNotesItemId = store(s => s.editingNotesItemId)
  const editingNotesText = store(s => s.editingNotesText)
  const orderToPayId = store(s => s.orderToPayId)
  const cardTabOrderId = store(s => s.cardTabOrderId)

  // State that was previously from usePaymentFlow but only paymentMethod needs local state
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'credit'>('credit')

  // Shift checked needs local state (used only in bootstrap)
  const [shiftChecked, setShiftChecked] = useState(false)

  const { dualPricing, paymentSettings, priceRounding, taxRate, receiptSettings,
    taxInclusiveLiquor, taxInclusiveFood, requireCardForTab, allowNameOnlyTab, ageVerification, sendBehavior, barOperations, entertainmentTipsEnabled } = useOrderSettings()

  const { settings: displaySettings, menuItemClass, gridColsClass, orderPanelClass,
    categorySize, categoryColorMode, categoryButtonBgColor, categoryButtonTextColor,
    showPriceOnMenuItems, updateSetting, updateSettings } = usePOSDisplay()

  const hasLayoutPermission = !!employee?.id
  const { currentMode, setMode, favorites, addFavorite, removeFavorite, reorderFavorites,
    canCustomize, layout, categoryOrder, setCategoryOrder, categoryColors, setCategoryColor,
    resetCategoryColor, resetAllCategoryColors, menuItemColors, setMenuItemStyle,
    resetMenuItemStyle, resetAllMenuItemStyles, quickBar, quickBarEnabled, addToQuickBar,
    removeFromQuickBar, isInQuickBar, updateSetting: updateLayoutSetting } = usePOSLayout({
    employeeId: employee?.id,
    locationId: employee?.location?.id,
    permissions: hasLayoutPermission ? { posLayout: ['customize_personal'] } : undefined,
  })

  const pricingPickerCallbackRef = useRef<((option: any) => void) | null>(null)

  // ── Saved order state ──
  const [savedOrderId, setSavedOrderId] = useState<string | null>(null)
  const [orderSent, setOrderSent] = useState(false)
  const sendLockRef = useRef(false)

  // ── Sync savedOrderId with store ──
  const savedOrderIdRef = useRef(savedOrderId)
  savedOrderIdRef.current = savedOrderId
  useEffect(() => {
    const storeOrderId = currentOrderId ?? null
    if (storeOrderId !== savedOrderIdRef.current) {
      setSavedOrderId(storeOrderId)
    }
  }, [currentOrderId])

  // ── Order type state ──
  const [selectedOrderType, setSelectedOrderType] = useState<any>(null)
  const [orderCustomFields, setOrderCustomFields] = useState<Record<string, string | undefined>>({})
  const [isEditingFavorites, setIsEditingFavorites] = useState(false)
  const [isEditingMenuItems, setIsEditingMenuItems] = useState(false)

  // ── Quick Bar ──
  const [quickBarItems, setQuickBarItems] = useState<QuickBarItem[]>([])

  // ── Floor plan integration ──
  const [orderToLoad, setOrderToLoad] = useState<OrderToLoad | null>(null)
  const bartenderDeselectTabRef = useRef<(() => void) | null>(null)
  const floorPlanDeselectTableRef = useRef<(() => void) | null>(null)
  const orderReadyPromiseRef = useRef<Promise<string | null> | null>(null)
  const [paidOrderId, setPaidOrderId] = useState<string | null>(null)
  const [floorPlanRefreshTrigger, setFloorPlanRefreshTrigger] = useState(0)

  // ── Inline callback refs for ordering engine ──
  const handleOpenModifiersSharedRef = useRef<((...args: any[]) => void) | null>(null)
  const inlineModifierCallbackRef = useRef<((modifiers: any[], ingredientModifications?: any[]) => void) | null>(null)
  const inlineTimedRentalCallbackRef = useRef<((price: number, blockMinutes: number) => void) | null>(null)
  const inlinePizzaCallbackRef = useRef<((config: PizzaOrderConfig) => void) | null>(null)
  const inlineComboCallbackRef = useRef<((modifiers: { id: string; name: string; price: number; depth?: number }[]) => void) | null>(null)

  // ── Quick order type + tables click refs ──
  const quickOrderTypeRef = useRef<((orderType: string) => void) | null>(null)
  const tablesClickRef = useRef<(() => void) | null>(null)

  // ── Bootstrap: menu, order types, shifts, snapshot ──
  const bootstrap = useOrderBootstrap({
    locationId: employee?.location?.id,
    employeeId: employee?.id,
    employeeRoleId: employee?.role?.id,
    onShiftFound: setCurrentShift,
    onNoShift: () => setShowShiftStartModal(true),
    onShiftChecked: () => setShiftChecked(true),
    shiftChecked,
  })

  // ── Pricing ──
  const pricing = usePricing({
    subtotal: currentOrderSubtotal || 0,
    discountTotal: currentOrderDiscountTotal || 0,
    tipTotal: currentOrderTipTotal || 0,
    paymentMethod,
  })

  // ── OrderPanel items ──
  const orderPanelItems = useOrderPanelItems(bootstrap.menuItems)
  const selectedSeat = useFloorPlanStore(s => s.selectedSeat)
  const clearSelectedSeat = useFloorPlanStore(s => s.clearSelectedSeat)
  const addTableOrder = useFloorPlanStore(s => s.addTableOrder)
  const filterSeatNumber = selectedSeat?.seatNumber ?? null

  const filteredOrderPanelItems = useMemo(() => {
    if (!filterSeatNumber) return orderPanelItems
    return orderPanelItems.filter(item => item.seatNumber === filterSeatNumber)
  }, [orderPanelItems, filterSeatNumber])

  // ── Quick Pick ──
  const { selectedItemId: quickPickSelectedId, selectedItemIds: quickPickSelectedIds,
    selectItem: selectQuickPickItem, setSelectedItemId: setQuickPickSelectedId,
    clearSelection: clearQuickPick, multiSelectMode: quickPickMultiSelect,
    toggleMultiSelect: toggleQuickPickMultiSelect,
    selectAllPending: selectAllPendingQuickPick } = useQuickPick(orderPanelItems)

  // ── Ordering engine + panel callbacks ──
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
    onOpenPricingOptionPicker: (item, onComplete) => {
      pricingPickerCallbackRef.current = onComplete
      setPricingPickerItem(item)
    },
    onOpenComboBuilder: async (item, onComplete) => {
      inlineComboCallbackRef.current = onComplete
      setSelectedComboItem(item as MenuItem)
      setComboSelections({})
      setShowComboModal(true)
      try {
        const response = await fetch(`/api/combos/${item.id}`)
        if (response.ok) {
          const data = await response.json()
          setComboTemplate(data.data?.template)
        }
      } catch (error) {
        console.error('Failed to load combo template:', error)
      }
    },
  })

  // ── Barcode scanner — auto-add scanned items to order ──
  const handleBarcodeScan = useCallback(async (barcode: string) => {
    const locId = employee?.location?.id
    if (!locId) return

    try {
      const res = await fetch(`/api/barcode/lookup?code=${encodeURIComponent(barcode)}&locationId=${locId}`)
      if (!res.ok) {
        toast.error('Barcode lookup failed')
        return
      }

      const { data } = await res.json()

      if (!data) {
        toast.error(`Unknown barcode: ${barcode}`)
        return
      }

      if (!data.menuItem) {
        toast.error(`Barcode "${barcode}" is not linked to a menu item`)
        return
      }

      if (!data.menuItem.isAvailable) {
        toast.error(`${data.menuItem.name} is 86'd`)
        return
      }

      // Determine price: barcode pack price > menu item base price
      const price = data.price ?? Number(data.menuItem.price)
      const label = data.label ? ` (${data.label})` : ''

      engine.addItemDirectly({
        menuItemId: data.menuItem.id,
        name: data.menuItem.name + label,
        price,
        quantity: 1,
      })

      toast.success(`Added: ${data.menuItem.name}${label}`)
    } catch {
      toast.error('Barcode scan failed')
    }
  }, [employee?.location?.id, engine])

  useBarcodeScanner({
    onScan: handleBarcodeScan,
    enabled: true,
  })

  const panelCallbacks = useOrderPanelCallbacks({
    engine,
    activeOrder: activeOrderFull,
    onOpenCompVoid: (item) => {
      const orderId = useOrderStore.getState().currentOrder?.id || savedOrderId
      if (!orderId) return
      setOrderToPayId(orderId)
      setCompVoidItem(item)
      setShowCompVoidModal(true)
    },
    onOpenResend: (itemId, itemName) => {
      setResendNote('')
      setResendModal({ itemId, itemName })
    },
    onOpenSplit: async () => {
      setEditingChildSplit(false)
      const orderId = savedOrderId || useOrderStore.getState().currentOrder?.id
      if (orderId) {
        try {
          const res = await fetch(`/api/orders/${orderId}/split-tickets`)
          if (res.ok) {
            const data = await res.json()
            if (data.data?.splitOrders && data.data.splitOrders.length > 0) {
              // Already split — open manage mode (modal)
              setSplitManageMode(true)
              setShowSplitTicketManager(true)
              return
            }
          }
        } catch { /* fall through */ }
      }
      // New split — navigate to full-page split experience
      if (orderId) {
        router.push(`/orders/split?orderId=${orderId}`)
      } else {
        setShowSplitTicketManager(true)
      }
    },
  })

  // ── Handlers hook ──
  // Note: `as any` casts are needed for a few domain-hook setters whose types use
  // narrow discriminated unions (e.g., "cash"|"credit" vs string). Runtime behavior
  // is identical — the handlers hook never passes invalid values.
  const handlers = useOrderHandlers({
    locationId: employee?.location?.id,
    employeeId: employee?.id,
    employee: employee ?? undefined,
    savedOrderId,
    setSavedOrderId,
    orderToPayId,
    setOrderToPayId,
    ensureOrderInDB,
    clearOrder,
    activeOrderFull,
    isBartender,
    menuItems: bootstrap.menuItems,
    orderTypes: bootstrap.orderTypes,
    selectedCategoryData: bootstrap.selectedCategoryData,
    throttledLoadMenu: bootstrap.throttledLoadMenu,
    pricing,
    setShowPaymentModal, setInitialPayMethod: setInitialPayMethod as any, setPaymentTabCards,
    setShowDiscountModal, setAppliedDiscounts, setItemDiscountTargetId,
    setShowCompVoidModal, setCompVoidItem,
    setShowSplitTicketManager, setSplitManageMode,
    setShowModifierModal, setSelectedItem, setItemModifierGroups, setLoadingModifiers, setEditingOrderItem,
    setShowPizzaModal, setSelectedPizzaItem, setSelectedPizzaSpecialty, setEditingPizzaItem,
    setShowComboModal, setSelectedComboItem, setComboTemplate, setComboSelections,
    setShowTimedRentalModal, setSelectedTimedItem, setSelectedRateType: setSelectedRateType as any, setLoadingSession,
    setShowEntertainmentStart, setEntertainmentItem: setEntertainmentItem as any,
    setShowWeightModal, setWeightCaptureItem,
    setViewMode, setOrderSent, setSelectedOrderType, setOrderCustomFields,
    setTabsRefreshTrigger, setFloorPlanRefreshTrigger,
    setShowTabNamePrompt, setTabNameCallback,
    setShowReceiptModal, setReceiptOrderId,
    setEditingNotesItemId, setEditingNotesText,
    setResendNote, setResendModal, setResendLoading,
    setSplitParentToReturnTo, setPayAllSplitsQueue, setPayAllSplitsParentId,
    setPayAllSplitsTotal, setPayAllSplitsCardTotal, setShowPayAllSplitsConfirm,
    setPayAllSplitsProcessing, setPayAllSplitsStep: setPayAllSplitsStep as any,
    setEditingChildSplit, setOrderSplitChips, setSplitParentId, setSplitChipsFlashing,
    setPaidOrderId, setTabCardInfo: setTabCardInfo as any, setShowCardTabFlow, setCardTabOrderId,
    inlineModifierCallbackRef, inlinePizzaCallbackRef, inlineTimedRentalCallbackRef,
    orderReadyPromiseRef, bartenderDeselectTabRef, floorPlanDeselectTableRef, sendLockRef,
    weightCaptureItem, selectedItem, editingOrderItem,
    selectedPizzaItem, editingPizzaItem,
    selectedComboItem, comboTemplate, comboSelections,
    selectedTimedItem, selectedRateType: selectedRateType as any,
    entertainmentItem: entertainmentItem as any,
    resendModal, resendNote, editingNotesItemId, editingNotesText,
    splitParentId, orderSplitChips, editingChildSplit,
    payAllSplitsParentId, tabCardInfo: tabCardInfo as any,
    setMode, addTableOrder, requireCardForTab,
    setShowAgeVerification, setAgeVerificationItem, setAgeVerificationCallback, setAllergenNotice,
    ageVerificationSettings: ageVerification,
    sendBehavior: sendBehavior ?? 'return_to_floor',
  })

  // Wire up modifier ref
  handleOpenModifiersSharedRef.current = handlers.handleOpenModifiersShared

  // ── Split chips sync ──
  const splitParentIdRef = useRef(splitParentId)
  splitParentIdRef.current = splitParentId
  const orderSplitChipsRef = useRef(orderSplitChips)
  orderSplitChipsRef.current = orderSplitChips

  useEffect(() => {
    const orderId = currentOrderId
    const status = currentOrderStatus
    if (!orderId) {
      setOrderSplitChips([])
      setSplitParentId(null)
      return
    }
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
    if (splitParentIdRef.current) return
    if (orderSplitChipsRef.current.length > 0) {
      setOrderSplitChips([])
      setSplitParentId(null)
    }
  }, [currentOrderId, currentOrderStatus, setOrderSplitChips, setSplitParentId])

  // ── Split check items (for SplitCheckScreen) ──
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

  // ── Quick pick number handler ──
  const ordersDigitBufferRef = useRef<string>('')
  const ordersDigitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleQuickPickNumber = useCallback((num: number) => {
    if (!quickPickSelectedId) return
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

    const { updateQuantity } = useOrderStore.getState()
    if (pendingQty !== item.quantity) updateQuantity(quickPickSelectedId, pendingQty)

    ordersDigitTimerRef.current = setTimeout(() => {
      ordersDigitBufferRef.current = ''
    }, 600)
  }, [quickPickSelectedId, activeOrderFull])

  useEffect(() => {
    ordersDigitBufferRef.current = ''
    if (ordersDigitTimerRef.current) clearTimeout(ordersDigitTimerRef.current)
  }, [quickPickSelectedId])

  // ── Quick bar items loading ──
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
      } catch { /* non-critical */ }
    }
    loadQuickBarItems()
    return () => { cancelled = true }
  }, [quickBar, menuItemColors])

  // ── Open orders count refresh ──
  useEffect(() => {
    if (employee?.location?.id) {
      bootstrap.loadOpenOrdersCount()
    }
  }, [employee?.location?.id, tabsRefreshTrigger, bootstrap.loadOpenOrdersCount])

  // ── Menu search ──
  const menuSearch = useMenuSearch({
    locationId: employee?.location?.id,
    menuItems: bootstrap.menuItems as any,
  })

  const handleSearchSelect = useCallback((item: { id: string; name: string; price: number; categoryId: string }) => {
    const fullItem = bootstrap.menuItems.find((m: any) => m.id === item.id)
    if (fullItem) {
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
  }, [bootstrap.menuItems, menuSearch])

  const handleScanComplete = useCallback(async (sku: string) => {
    const result = await menuSearch.lookupBySku(sku)
    if (result) {
      handleSearchSelect(result)
    } else {
      toast.error(`Item not found: ${sku}`)
    }
  }, [menuSearch, handleSearchSelect])

  // ── Logout handler ──
  const handleLogout = async () => {
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
      } catch { /* proceed */ }
    }
    clearOrder()
    setHasDevAccess(false)
    logout()
    router.push('/login')
  }

  // ── Auth redirect ──
  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.push('/login')
    }
  }, [hydrated, isAuthenticated, router])

  // ── Pricing values ──
  const subtotal = pricing.subtotal
  const taxAmount = pricing.tax
  const totalDiscounts = pricing.discounts + pricing.cashDiscount
  const grandTotal = pricing.total

  // ── Auth guard ──
  if (!hydrated || !isAuthenticated || !employee) {
    return null
  }

  if (!(viewMode === 'floor-plan' || viewMode === 'bartender') || !employee.location?.id) {
    return null
  }

  // ── Repeat Round handler — duplicates all items from the last sent batch ──
  // Uses stored item data (ref) so it works even after the order is cleared
  const handleRepeatRound = useCallback(() => {
    const itemsData = handlers.lastSentItemsDataRef.current
    if (itemsData.length === 0) return

    const store = useOrderStore.getState()
    // Ensure there's an active order to add items to
    if (!store.currentOrder) return

    let addedCount = 0
    for (const item of itemsData) {
      store.addItem({
        menuItemId: item.menuItemId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        modifiers: item.modifiers.map(m => ({
          id: m.id,
          modifierId: m.modifierId,
          name: m.name,
          price: m.price,
          preModifier: m.preModifier ?? null,
          depth: m.depth ?? 0,
          spiritTier: m.spiritTier ?? null,
          linkedBottleProductId: m.linkedBottleProductId ?? null,
          parentModifierId: m.parentModifierId ?? null,
        })),
        categoryType: item.categoryType,
        pourSize: item.pourSize ?? undefined,
        pourMultiplier: item.pourMultiplier ?? undefined,
        specialNotes: item.specialNotes ?? undefined,
      })
      addedCount += item.quantity
    }

    toast.success(`Repeated ${addedCount} item${addedCount !== 1 ? 's' : ''} from last round`)
  }, [handlers.lastSentItemsDataRef])

  // ── Shared OrderPanel element ──
  const sharedOrderPanel = (
    <SharedOrderPanel
      viewMode={viewMode}
      locationId={employee.location?.id}
      employeeId={employee.id}
      employee={employee}
      savedOrderId={savedOrderId}
      orderTypes={bootstrap.orderTypes}
      filteredOrderPanelItems={filteredOrderPanelItems}
      orderPanelItems={orderPanelItems}
      filterSeatNumber={filterSeatNumber}
      selectedSeat={selectedSeat}
      pricing={pricing}
      requireCardForTab={requireCardForTab}
      allowNameOnlyTab={allowNameOnlyTab}
      taxInclusiveLiquor={taxInclusiveLiquor}
      taxInclusiveFood={taxInclusiveFood}
      panelCallbacks={panelCallbacks}
      activeOrderFull={activeOrderFull}
      quickPickSelectedId={quickPickSelectedId}
      quickPickSelectedIds={quickPickSelectedIds}
      selectQuickPickItem={selectQuickPickItem}
      quickPickMultiSelect={quickPickMultiSelect}
      toggleQuickPickMultiSelect={toggleQuickPickMultiSelect}
      selectAllPendingQuickPick={selectAllPendingQuickPick}
      handleQuickPickNumber={handleQuickPickNumber}
      editingChildSplit={editingChildSplit}
      orderSplitChips={orderSplitChips}
      splitChipsFlashing={splitChipsFlashing}
      splitParentId={splitParentId}
      tabCardInfo={tabCardInfo as any}
      handleSendToKitchen={handlers.handleSendToKitchen}
      handleOpenPayment={handlers.handleOpenPayment}
      handleOpenDiscount={handlers.handleOpenDiscount}
      handleItemDiscount={handlers.handleItemDiscount}
      handleItemDiscountRemove={handlers.handleItemDiscountRemove}
      handleQuickSplitEvenly={handlers.handleQuickSplitEvenly}
      ensureOrderInDB={ensureOrderInDB}
      isSendingOrder={handlers.isSendingOrder}
      setSplitManageMode={setSplitManageMode}
      setShowSplitTicketManager={setShowSplitTicketManager}
      setOrderSplitChips={setOrderSplitChips}
      setSavedOrderId={setSavedOrderId}
      setShowPaymentModal={setShowPaymentModal}
      setInitialPayMethod={setInitialPayMethod as any}
      setOrderToPayId={setOrderToPayId}
      setPaymentTabCards={setPaymentTabCards}
      setPayAllSplitsParentId={setPayAllSplitsParentId}
      setPayAllSplitsTotal={setPayAllSplitsTotal}
      setPayAllSplitsCardTotal={setPayAllSplitsCardTotal}
      setShowPayAllSplitsConfirm={setShowPayAllSplitsConfirm}
      setViewMode={setViewMode}
      setMode={setMode}
      clearOrder={clearOrder}
      setOrderSent={setOrderSent}
      setSelectedOrderType={setSelectedOrderType}
      setOrderCustomFields={setOrderCustomFields}
      setAppliedDiscounts={setAppliedDiscounts}
      setShowCardTabFlow={setShowCardTabFlow}
      setCardTabOrderId={setCardTabOrderId}
      setShowTabNamePrompt={setShowTabNamePrompt}
      setTabNameCallback={setTabNameCallback}
      setTabCardInfo={setTabCardInfo as any}
      setIsSendingOrder={handlers.setIsSendingOrder}
      setTabsRefreshTrigger={setTabsRefreshTrigger}
      onTransferItems={savedOrderId && hasPermission(permissionsArray, PERMISSIONS.POS_TRANSFER_ORDER) ? () => setShowItemTransferModal(true) : undefined}
      onTransferOrder={savedOrderId && hasPermission(permissionsArray, PERMISSIONS.POS_TRANSFER_ORDER) ? () => setShowTabTransferModal(true) : undefined}
      lastSentItemIds={handlers.lastSentItemIds}
      onRepeatRound={handleRepeatRound}
      bartenderDeselectTabRef={bartenderDeselectTabRef}
      floorPlanDeselectTableRef={floorPlanDeselectTableRef}
      orderReadyPromiseRef={orderReadyPromiseRef}
    />
  )

  // ── Main render ──
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TestModeBanner />
      <TrainingModeBanner />
      <HappyHourBanner />
      <UnifiedPOSHeader
        orderTypes={bootstrap.orderTypes}
        employeeName={employee.displayName}
        employeeRole={employee.role?.name}
        employeeId={employee.id}
        locationId={employee.location?.id}
        viewMode={viewMode}
        onViewModeChange={(mode) => {
          const order = useOrderStore.getState().currentOrder
          if (mode === 'bartender') {
            setMode('bar')
            setViewMode('bartender')
            useFloorPlanStore.getState().clearSelectedSeat()
            if (order) {
              const hasSentItems = order.items.some(i => i.sentToKitchen)
              if (order.id && !hasSentItems) {
                fetch(`/api/orders/${order.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: 'cancelled' }),
                }).catch(err => console.warn('fire-and-forget failed in pos.orders:', err))
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
            if (order?.orderType === 'bar_tab' && order?.status !== 'split') {
              clearOrder()
            }
          }
        }}
        activeOrderType={currentOrderType || null}
        onQuickOrderType={(type) => quickOrderTypeRef.current?.(type)}
        onTablesClick={() => tablesClickRef.current?.()}
        onSwitchUser={() => { logout() }}
        onOpenTimeClock={() => setShowTimeClockModal(true)}
        onLogout={logout}
        onOpenSettings={() => setShowDisplaySettings(true)}
        onOpenAdminNav={canAccessAdmin ? () => router.push('/settings') : undefined}
        canCustomize={canCustomize}
        quickBarEnabled={quickBarEnabled}
        onToggleQuickBar={() => updateLayoutSetting('quickBarEnabled', !quickBarEnabled)}
        quickPickEnabled={layout.quickPickEnabled}
        onToggleQuickPick={() => updateLayoutSetting('quickPickEnabled', !layout.quickPickEnabled)}
        isEditingFavorites={isEditingFavorites}
        onToggleEditFavorites={() => setIsEditingFavorites(!isEditingFavorites)}
        isEditingCategories={false}
        onToggleEditCategories={() => {}}
        isEditingMenuItems={isEditingMenuItems}
        onToggleEditMenuItems={() => setIsEditingMenuItems(!isEditingMenuItems)}
        onResetAllCategoryColors={resetAllCategoryColors}
        onResetAllMenuItemStyles={resetAllMenuItemStyles}
        openOrdersCount={bootstrap.openOrdersCount}
        onOpenOrdersPanel={() => { setShowTabsPanel(true) }}
        searchQuery={menuSearch.query}
        onSearchChange={menuSearch.setQuery}
        onSearchClear={menuSearch.clearSearch}
        searchResults={menuSearch.results || { directMatches: [], ingredientMatches: [], totalMatches: 0 }}
        isSearching={menuSearch.isSearching}
        onSearchSelect={handleSearchSelect}
        onScanComplete={handleScanComplete}
        cardPriceMultiplier={pricing.isDualPricingEnabled ? 1 + pricing.cashDiscountRate / 100 : undefined}
        scaleId={bootstrap.terminalScaleId}
        employeePermissions={permissionsArray}
        onQuickServiceOrder={() => {
          const takeout = bootstrap.orderTypes.find(ot => ot.slug === 'takeout' && ot.isActive)
          const fallback = bootstrap.orderTypes.find(ot => ot.slug !== 'dine_in' && ot.slug !== 'bar_tab' && ot.isActive)
          const quickType = takeout || fallback
          const slug = quickType?.slug || 'takeout'
          if (viewMode !== 'floor-plan') {
            setViewMode('floor-plan')
          }
          clearOrder()
          useOrderStore.getState().startOrder(slug, {
            locationId: employee?.location?.id,
            orderTypeId: quickType?.id,
          })
          quickOrderTypeRef.current?.(slug)
        }}
      />
      {viewMode === 'floor-plan' && (
        <SilentErrorBoundary name="FloorPlan">
          <FloorPlanHome
            orderTypes={bootstrap.orderTypes}
            locationId={employee.location?.id}
            employeeId={employee.id}
            isEditingFavorites={isEditingFavorites}
            isEditingCategories={false}
            isEditingMenuItems={isEditingMenuItems}
            onRegisterQuickOrderType={(fn) => { quickOrderTypeRef.current = fn }}
            onRegisterTablesClick={(fn) => { tablesClickRef.current = fn }}
            onOpenOrdersCountChange={bootstrap.setOpenOrdersCount}
            onOpenPayment={(orderId) => {
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
            onOpenModifiers={handlers.handleOpenModifiersShared as any}
            onOpenCardFirst={(orderId) => {
              setCardTabOrderId(orderId)
              setShowCardTabFlow(true)
            }}
            onOpenTimedRental={handlers.handleOpenTimedRental}
            onOpenPizzaBuilder={(item, onComplete) => {
              inlinePizzaCallbackRef.current = onComplete
              setSelectedPizzaItem(item as MenuItem)
              setEditingPizzaItem(null)
              setShowPizzaModal(true)
            }}
            onOpenPricingOptionPicker={(item, onComplete) => {
              pricingPickerCallbackRef.current = onComplete
              setPricingPickerItem(item)
            }}
            onOpenComboBuilder={async (item, onComplete) => {
              inlineComboCallbackRef.current = onComplete
              setSelectedComboItem(item as MenuItem)
              setComboSelections({})
              setShowComboModal(true)
              try {
                const response = await fetch(`/api/combos/${item.id}`)
                if (response.ok) {
                  const data = await response.json()
                  setComboTemplate(data.data?.template)
                }
              } catch (error) {
                console.error('Failed to load combo template:', error)
              }
            }}
            orderToLoad={orderToLoad}
            onOrderLoaded={() => setOrderToLoad(null)}
            paidOrderId={paidOrderId}
            onPaidOrderCleared={() => setPaidOrderId(null)}
            onRegisterDeselectTable={(fn) => { floorPlanDeselectTableRef.current = fn }}
            refreshTrigger={floorPlanRefreshTrigger}
            initialCategories={bootstrap.categories}
            initialMenuItems={bootstrap.menuItems}
            initialSnapshot={bootstrap.initialSnapshot}
          >
            {sharedOrderPanel}
          </FloorPlanHome>
        </SilentErrorBoundary>
      )}
      {viewMode === 'bartender' && (
        <BartenderView
          locationId={employee.location?.id}
          employeeId={employee.id}
          employeePermissions={permissionsArray}
          dualPricing={dualPricing}
          onRegisterDeselectTab={(fn) => {
            bartenderDeselectTabRef.current = () => {
              const store = useOrderStore.getState()
              const order = store.currentOrder
              if (order?.id && !isTempId(order.id)) {
                const hasSentItems = order.items.some(i => i.sentToKitchen)
                if (!hasSentItems) {
                  fetch(`/api/orders/${order.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'cancelled' }),
                  }).catch(err => console.warn('fire-and-forget failed in pos.orders:', err))
                }
              }
              fn()
              setTabCardInfo({ cardLast4: '', cardType: '', cardholderName: '' })
              handlers.setIsSendingOrder(false)
              setSavedOrderId(null)
            }
          }}
          onOpenCompVoid={(item) => {
            const orderId = useOrderStore.getState().currentOrder?.id || savedOrderId
            if (!orderId) return
            setOrderToPayId(orderId)
            setCompVoidItem({
              ...item,
              modifiers: item.modifiers.map(m => ({
                id: m.id, modifierId: m.id, name: m.name, price: m.price,
                depth: 0, preModifier: null, spiritTier: null,
                linkedBottleProductId: null, parentModifierId: null,
              })),
            })
            setShowCompVoidModal(true)
          }}
          onOpenPayment={(orderId) => {
            if (useOrderStore.getState().currentOrder?.status === 'split') {
              setSplitManageMode(true)
              setShowSplitTicketManager(true)
              return
            }
            setOrderToPayId(orderId)
            setShowPaymentModal(true)
          }}
          onOpenModifiers={handlers.handleOpenModifiersShared as any}
          requireNameWithoutCard={!allowNameOnlyTab && !requireCardForTab}
          refreshTrigger={tabsRefreshTrigger}
          initialCategories={bootstrap.categories}
          initialMenuItems={bootstrap.menuItems}
          onSelectedTabChange={(tabId) => setSavedOrderId(tabId)}
          onOpenComboBuilder={async (item, onComplete) => {
            inlineComboCallbackRef.current = onComplete
            setSelectedComboItem(item as MenuItem)
            setComboSelections({})
            setShowComboModal(true)
            try {
              const response = await fetch(`/api/combos/${item.id}`)
              if (response.ok) {
                const data = await response.json()
                setComboTemplate(data.data?.template)
              }
            } catch (error) {
              console.error('Failed to load combo template:', error)
            }
          }}
        >
          {sharedOrderPanel}
        </BartenderView>
      )}

      {/* Shared Modals — modal state read from useOrderPageStore */}
      <OrderPageModals
        employee={employee}
        permissionsArray={permissionsArray}
        savedOrderId={savedOrderId}
        displaySettings={displaySettings}
        onUpdateSetting={updateSetting}
        onBatchUpdateSettings={updateSettings}
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
        onViewReceipt={(orderId) => {
          setReceiptOrderId(orderId)
          setShowReceiptModal(true)
        }}
        dualPricing={dualPricing}
        inlineModifierCallbackRef={inlineModifierCallbackRef}
        onAddItemWithModifiers={handlers.handleAddItemWithModifiers}
        onUpdateItemWithModifiers={handlers.handleUpdateItemWithModifiers}
        quickPreModifiers={barOperations.quickPreModifiers}
        quickPreModifiersEnabled={barOperations.quickPreModifiersEnabled}
        inlinePizzaCallbackRef={inlinePizzaCallbackRef}
        onAddPizzaToOrder={handlers.handleAddPizzaToOrder}
        inlineComboCallbackRef={inlineComboCallbackRef}
        onComboConfirm={(selections) => {
          const ct = useOrderPageStore.getState().comboTemplate
          if (inlineComboCallbackRef.current) {
            const modifiers: { id: string; name: string; price: number; depth?: number }[] = []
            if (ct) {
              for (const component of ct.components) {
                if (component.menuItem) {
                  modifiers.push({ id: `combo-item-${component.id}`, name: component.displayName, price: 0, depth: 0 })
                  const componentSelections = selections[component.id] || {}
                  for (const mg of component.menuItem.modifierGroups || []) {
                    const groupSelections = componentSelections[mg.modifierGroup.id] || []
                    for (const modifierId of groupSelections) {
                      const modifier = mg.modifierGroup.modifiers.find((m: any) => m.id === modifierId)
                      if (modifier) {
                        const overridePrice = component.modifierPriceOverrides?.[modifier.id]
                        modifiers.push({ id: `combo-${component.id}-${modifier.id}`, name: `  - ${modifier.name}`, price: overridePrice !== undefined ? overridePrice : 0, depth: 1 })
                      }
                    }
                  }
                } else if (component.options && component.options.length > 0) {
                  const legacySelections = (selections[component.id] as unknown as string[]) || []
                  for (const optionId of legacySelections) {
                    const option = component.options.find((o: any) => o.id === optionId)
                    if (option) modifiers.push({ id: `combo-${component.id}-${option.id}`, name: `${component.displayName}: ${option.name}`, price: option.upcharge, depth: 0 })
                  }
                }
              }
            }
            inlineComboCallbackRef.current(modifiers)
            inlineComboCallbackRef.current = null
          } else {
            handlers.handleAddComboToOrderWithSelections(selections)
          }
          useOrderPageStore.getState().closeComboModal()
        }}
        onStartEntertainmentWithCurrentOrder={handlers.handleStartEntertainmentWithCurrentOrder}
        onStartEntertainmentWithNewTab={handlers.handleStartEntertainmentWithNewTab}
        onStartEntertainmentWithExistingTab={handlers.handleStartEntertainmentWithExistingTab}
        inlineTimedRentalCallbackRef={inlineTimedRentalCallbackRef}
        onStartTimedSession={handlers.handleStartTimedSession}
        onTabCardsChanged={handlers.handleTabCardsChanged}
        paymentSettings={paymentSettings}
        priceRounding={priceRounding}
        entertainmentTipsEnabled={entertainmentTipsEnabled}
        currentOrder={currentOrder}
        onPaymentComplete={(receiptData) => {
          const paidId = useOrderPageStore.getState().orderToPayId
          setShowPaymentModal(false)
          setOrderToPayId(null)
          setInitialPayMethod(undefined)

          const sptr = useOrderPageStore.getState().splitParentToReturnTo
          const pasq = useOrderPageStore.getState().payAllSplitsQueue
          if (sptr) {
            if (pasq.length > 0) {
              const nextSplitId = pasq[0]
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
            setSavedOrderId(sptr)
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
        receiptSettings={receiptSettings}
        setPaidOrderId={setPaidOrderId}
        onCardTabComplete={async (result) => {
          setShowCardTabFlow(false)

          if (result.tabStatus === 'existing_tab_found' && result.existingTab) {
            if (cardTabOrderId) {
              fetch(`/api/orders/${cardTabOrderId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'cancelled' }),
              }).catch(err => console.warn('fire-and-forget failed in pos.orders:', err))
            }
            useOrderStore.getState().clearOrder()
            setSavedOrderId(null)
            setOrderSent(false)
            setSelectedOrderType(null)
            setOrderCustomFields({})
            setCardTabOrderId(null)
            setOrderToLoad({
              id: result.existingTab.orderId,
              orderNumber: result.existingTab.tabNumber,
              tabName: result.existingTab.tabName,
              orderType: 'bar_tab',
            })
            setTabCardInfo({
              cardholderName: undefined,
              cardLast4: result.existingTab.last4,
              cardType: result.existingTab.brand,
            })
            setSavedOrderId(result.existingTab.orderId)
            toast.success(`Opened existing tab \u2014 ${result.existingTab.tabName}`)
            return
          }

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
            toast.success(`Tab opened \u2014 \u2022\u2022\u2022${result.cardLast4}`)
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
                    toast.error('Failed to save tab items \u2014 check open orders')
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
                }).then(res => res.json()).then(json => {
                  const d = json?.data
                  if (d?.action === 'increment_failed') {
                    toast.error('Card limit reached — take a new card or cash.', 10000)
                  }
                }).catch(err => console.warn('fire-and-forget failed in pos.orders:', err))
              } catch (err) {
                console.error('[CardTab] Background send failed:', err)
                toast.error('Tab may not have saved \u2014 check open orders')
              } finally {
                setTabsRefreshTrigger(prev => prev + 1)
              }
            })()
          } else {
            // Card was not approved (declined / error path via onComplete)
            const store = useOrderStore.getState()
            const hasItems = (store.currentOrder?.items?.length ?? 0) > 0
            if (cardTabOrderId) {
              if (!hasItems) {
                // Empty shell — safe to cancel
                fetch(`/api/orders/${cardTabOrderId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: 'cancelled' }),
                }).catch(err => console.warn('fire-and-forget failed in pos.orders:', err))
              }
              if (store.currentOrder?.id === cardTabOrderId) {
                store.updateOrderId(`temp_${Date.now()}`, undefined)
              }
            }
            if (!hasItems) {
              setSavedOrderId(null)
            }
            setCardTabOrderId(null)
          }
        }}
        onCardTabCancel={() => {
          setShowCardTabFlow(false)
          const store = useOrderStore.getState()
          const hasItems = (store.currentOrder?.items?.length ?? 0) > 0
          if (cardTabOrderId) {
            if (!hasItems) {
              // Empty shell order — safe to cancel
              fetch(`/api/orders/${cardTabOrderId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'cancelled' }),
              }).catch(err => console.warn('fire-and-forget failed in pos.orders:', err))
            }
            // Reset the order's DB link but keep items in local state
            if (store.currentOrder?.id === cardTabOrderId) {
              store.updateOrderId(`temp_${Date.now()}`, undefined)
            }
          }
          if (!hasItems) {
            setSavedOrderId(null)
          }
          setCardTabOrderId(null)
        }}
        onDiscountApplied={handlers.handleDiscountApplied}
        onCompVoidComplete={handlers.handleCompVoidComplete}
        onConfirmResend={handlers.confirmResendItem}
        onTransferComplete={async () => {
          try {
            const response = await fetch(`/api/orders/${savedOrderId}`)
            if (response.ok) {
              const orderData = await response.json()
              useOrderStore.getState().loadOrder(orderData)
            }
          } catch (error) {
            console.error('Failed to reload order:', error)
          }
        }}
        splitCheckItems={splitCheckItems}
        setFloorPlanRefreshTrigger={setFloorPlanRefreshTrigger}
        setSavedOrderId={setSavedOrderId}
        clearOrder={clearOrder}
        setOrderSent={setOrderSent}
        onSplitApplied={() => {
          setSplitManageMode(true)
          setFloorPlanRefreshTrigger(prev => prev + 1)
        }}
        onPaySplit={(splitId) => {
          const parentId = useOrderPageStore.getState().splitParentId || savedOrderId || useOrderStore.getState().currentOrder?.id || ''
          setSplitParentToReturnTo(parentId)
          setShowSplitTicketManager(false)
          setSplitManageMode(false)
          clearOrder()
          setOrderToPayId(splitId)
          setShowPaymentModal(true)
        }}
        onPayAllSplits={(splitIds, combinedTotal) => {
          if (splitIds.length === 0) return
          const parentId = useOrderPageStore.getState().splitParentId || savedOrderId || useOrderStore.getState().currentOrder?.id || ''
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
        onPayAllCash={() => handlers.callPayAllSplitsAPI('cash')}
        onPayAllCard={(cardResult) => handlers.callPayAllSplitsAPI('credit', cardResult)}
        pricing={pricing}
        lastCallEnabled={barOperations.lastCallEnabled}
      />

      {/* Weight Capture Modal */}
      {weightCaptureItem && (
        <WeightCaptureModal
          isOpen={showWeightModal}
          onClose={() => { setShowWeightModal(false); setWeightCaptureItem(null) }}
          item={weightCaptureItem}
          scaleId={bootstrap.terminalScaleId}
          onConfirm={handlers.handleAddWeightItem}
        />
      )}

      {/* Pricing Option Picker */}
      <PricingOptionPicker
        item={pricingPickerItem}
        onSelect={(option) => {
          pricingPickerCallbackRef.current?.(option)
          setPricingPickerItem(null)
          pricingPickerCallbackRef.current = null
        }}
        onClose={() => {
          setPricingPickerItem(null)
          pricingPickerCallbackRef.current = null
        }}
      />

      {/* Age Verification Modal */}
      <AgeVerificationModal
        isOpen={showAgeVerification}
        itemName={ageVerificationItem?.name || ''}
        minimumAge={ageVerification?.minimumAge ?? 21}
        onVerified={() => {
          setShowAgeVerification(false)
          ageVerificationCallback?.()
          setAgeVerificationCallback(null)
          setAgeVerificationItem(null)
        }}
        onCancel={() => {
          setShowAgeVerification(false)
          setAgeVerificationCallback(null)
          setAgeVerificationItem(null)
        }}
      />

      {/* Allergen Notice (auto-dismissing toast) */}
      {allergenNotice && (
        <AllergenNotice
          itemName={allergenNotice.itemName}
          allergens={allergenNotice.allergens}
          onDismiss={() => setAllergenNotice(null)}
        />
      )}
    </div>
  )
}
