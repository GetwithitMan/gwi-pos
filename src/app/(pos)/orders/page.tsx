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
import { FloorPlanHome } from '@/components/floor-plan'
import { SilentErrorBoundary } from '@/components/ui/SilentErrorBoundary'
import { BartenderView } from '@/components/bartender'
import { UnifiedPOSHeader } from '@/components/orders/UnifiedPOSHeader'
import { useMenuSearch } from '@/hooks/useMenuSearch'
import { useQuickPick } from '@/hooks/useQuickPick'
import { useOrderPanelCallbacks } from '@/hooks/useOrderPanelCallbacks'
import { useOrderingEngine } from '@/hooks/useOrderingEngine'
import { toast } from '@/stores/toast-store'
import { hasPermission, PERMISSIONS } from '@/lib/auth-utils'
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
import { WeightCaptureModal } from '@/components/scale/WeightCaptureModal'
import { PricingOptionPicker } from '@/components/orders/PricingOptionPicker'
import { SharedOrderPanel } from './components/SharedOrderPanel'
import { useOrderBootstrap } from './hooks/useOrderBootstrap'
import { useOrderHandlers } from './hooks/useOrderHandlers'
import type { MenuItem, PizzaOrderConfig } from '@/types'
import type { WorkflowRules } from '@/types/order-types'
import type { ViewMode, OrderToLoad, QuickBarItem, TabCardInfo } from './types'

// DEFERRED: Replace with dynamic terminal ID from device provisioning
const TERMINAL_ID = 'terminal-1'

export default function OrdersPage() {
  const router = useRouter()
  const employee = useAuthStore(s => s.employee)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const logout = useAuthStore(s => s.logout)
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
  const [viewMode, setViewMode] = useState<ViewMode>('floor-plan')

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
  const { showModifierModal, setShowModifierModal, selectedItem, setSelectedItem,
    itemModifierGroups, setItemModifierGroups, loadingModifiers, setLoadingModifiers,
    editingOrderItem, setEditingOrderItem } = useModifierModal()

  const { showPizzaModal, setShowPizzaModal, selectedPizzaItem, setSelectedPizzaItem,
    editingPizzaItem, setEditingPizzaItem } = usePizzaBuilder()

  const { dualPricing, paymentSettings, priceRounding, taxRate, receiptSettings,
    taxInclusiveLiquor, taxInclusiveFood, requireCardForTab, allowNameOnlyTab } = useOrderSettings()

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

  const { paymentMethod, setPaymentMethod, showPaymentModal, setShowPaymentModal,
    initialPayMethod, setInitialPayMethod, orderToPayId, setOrderToPayId,
    paymentTabCards, setPaymentTabCards, showDiscountModal, setShowDiscountModal,
    appliedDiscounts, setAppliedDiscounts } = usePaymentFlow()

  const { showDisplaySettings, setShowDisplaySettings, showReceiptModal, setShowReceiptModal,
    receiptOrderId, setReceiptOrderId, preloadedReceiptData, setPreloadedReceiptData,
    showTabNamePrompt, setShowTabNamePrompt, tabNameCallback, setTabNameCallback,
    showItemTransferModal, setShowItemTransferModal, editingNotesItemId, setEditingNotesItemId,
    editingNotesText, setEditingNotesText } = useOrderPageModals()

  const { showCompVoidModal, setShowCompVoidModal, resendModal, setResendModal,
    resendNote, setResendNote, resendLoading, setResendLoading,
    compVoidItem, setCompVoidItem } = useItemOperations()

  const { showSplitTicketManager, setShowSplitTicketManager, splitManageMode, setSplitManageMode,
    editingChildSplit, setEditingChildSplit, splitParentToReturnTo, setSplitParentToReturnTo,
    payAllSplitsQueue, setPayAllSplitsQueue, showPayAllSplitsConfirm, setShowPayAllSplitsConfirm,
    payAllSplitsTotal, setPayAllSplitsTotal, payAllSplitsCardTotal, setPayAllSplitsCardTotal,
    payAllSplitsParentId, setPayAllSplitsParentId, payAllSplitsProcessing, setPayAllSplitsProcessing,
    payAllSplitsStep, setPayAllSplitsStep, orderSplitChips, setOrderSplitChips,
    splitParentId, setSplitParentId, splitChipsFlashing, setSplitChipsFlashing } = useSplitTickets()

  const { showTabsPanel, setShowTabsPanel, isTabManagerExpanded, setIsTabManagerExpanded,
    showTipAdjustment, setShowTipAdjustment, tabsRefreshTrigger, setTabsRefreshTrigger } = useTabsPanel()

  const { showTimeClockModal, setShowTimeClockModal, currentShift, setCurrentShift,
    showShiftStartModal, setShowShiftStartModal, showShiftCloseoutModal, setShowShiftCloseoutModal,
    shiftChecked, setShiftChecked } = useShiftManagement()

  const { showComboModal, setShowComboModal, selectedComboItem, setSelectedComboItem,
    comboTemplate, setComboTemplate, comboSelections, setComboSelections } = useComboBuilder()

  const { showTimedRentalModal, setShowTimedRentalModal, selectedTimedItem, setSelectedTimedItem,
    selectedRateType, setSelectedRateType, activeSessions: hookActiveSessions,
    setActiveSessions: hookSetActiveSessions, loadingSession, setLoadingSession,
    showEntertainmentStart, setShowEntertainmentStart,
    entertainmentItem, setEntertainmentItem } = useTimedRentals()

  const { showCardTabFlow, setShowCardTabFlow, cardTabOrderId, setCardTabOrderId,
    tabCardInfo, setTabCardInfo } = useCardTabFlow(currentOrder)

  // ── Pricing option picker state ──
  const [pricingPickerItem, setPricingPickerItem] = useState<any>(null)
  const pricingPickerCallbackRef = useRef<((option: any) => void) | null>(null)

  // ── Per-item discount state ──
  const [itemDiscountTargetId, setItemDiscountTargetId] = useState<string | null>(null)

  // ── Weight capture modal ──
  const [showWeightModal, setShowWeightModal] = useState(false)
  const [weightCaptureItem, setWeightCaptureItem] = useState<{
    id: string; name: string; pricePerWeightUnit: number; weightUnit: string
  } | null>(null)

  // ── Saved order state ──
  const [savedOrderId, setSavedOrderId] = useState<string | null>(null)
  const [orderSent, setOrderSent] = useState(false)
  const sendLockRef = useRef(false)

  // ── Sync savedOrderId with store ──
  const savedOrderIdRef = useRef(savedOrderId)
  savedOrderIdRef.current = savedOrderId
  useEffect(() => {
    const storeOrderId = currentOrder?.id ?? null
    if (storeOrderId !== savedOrderIdRef.current) {
      setSavedOrderId(storeOrderId)
    }
  }, [currentOrder?.id])

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
    subtotal: currentOrder?.subtotal || 0,
    discountTotal: currentOrder?.discountTotal || 0,
    tipTotal: currentOrder?.tipTotal || 0,
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
              setSplitManageMode(true)
              setShowSplitTicketManager(true)
              return
            }
          }
        } catch { /* fall through */ }
      }
      setShowSplitTicketManager(true)
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
    activeSessions: bootstrap.activeSessions,
    setActiveSessions: bootstrap.setActiveSessions as any,
    throttledLoadMenu: bootstrap.throttledLoadMenu,
    pricing,
    setShowPaymentModal, setInitialPayMethod: setInitialPayMethod as any, setPaymentTabCards,
    setShowDiscountModal, setAppliedDiscounts, setItemDiscountTargetId,
    setShowCompVoidModal, setCompVoidItem,
    setShowSplitTicketManager, setSplitManageMode,
    setShowModifierModal, setSelectedItem, setItemModifierGroups, setLoadingModifiers, setEditingOrderItem,
    setShowPizzaModal, setSelectedPizzaItem, setEditingPizzaItem,
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
  })

  // Wire up modifier ref
  handleOpenModifiersSharedRef.current = handlers.handleOpenModifiersShared

  // ── Split chips sync ──
  const splitParentIdRef = useRef(splitParentId)
  splitParentIdRef.current = splitParentId
  const orderSplitChipsRef = useRef(orderSplitChips)
  orderSplitChipsRef.current = orderSplitChips

  useEffect(() => {
    const orderId = currentOrder?.id
    const status = currentOrder?.status
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
  }, [currentOrder?.id, currentOrder?.status, setOrderSplitChips, setSplitParentId])

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
      bartenderDeselectTabRef={bartenderDeselectTabRef}
      floorPlanDeselectTableRef={floorPlanDeselectTableRef}
      orderReadyPromiseRef={orderReadyPromiseRef}
    />
  )

  // ── Main render ──
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <UnifiedPOSHeader
        orderTypes={bootstrap.orderTypes}
        employeeName={employee.displayName}
        employeeRole={employee.role?.name}
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
                  }).catch(() => {})
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
        >
          {sharedOrderPanel}
        </BartenderView>
      )}

      {/* Shared Modals */}
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
        onAddItemWithModifiers={handlers.handleAddItemWithModifiers}
        onUpdateItemWithModifiers={handlers.handleUpdateItemWithModifiers}
        showPizzaModal={showPizzaModal}
        setShowPizzaModal={setShowPizzaModal}
        selectedPizzaItem={selectedPizzaItem}
        setSelectedPizzaItem={setSelectedPizzaItem}
        editingPizzaItem={editingPizzaItem}
        setEditingPizzaItem={setEditingPizzaItem}
        inlinePizzaCallbackRef={inlinePizzaCallbackRef}
        onAddPizzaToOrder={handlers.handleAddPizzaToOrder}
        showComboModal={showComboModal}
        setShowComboModal={setShowComboModal}
        selectedComboItem={selectedComboItem}
        setSelectedComboItem={setSelectedComboItem}
        comboTemplate={comboTemplate}
        setComboTemplate={setComboTemplate}
        onComboConfirm={handlers.handleAddComboToOrderWithSelections}
        showEntertainmentStart={showEntertainmentStart}
        setShowEntertainmentStart={setShowEntertainmentStart}
        entertainmentItem={entertainmentItem}
        setEntertainmentItem={setEntertainmentItem}
        onStartEntertainmentWithCurrentOrder={handlers.handleStartEntertainmentWithCurrentOrder}
        onStartEntertainmentWithNewTab={handlers.handleStartEntertainmentWithNewTab}
        onStartEntertainmentWithExistingTab={handlers.handleStartEntertainmentWithExistingTab}
        showTimedRentalModal={showTimedRentalModal}
        setShowTimedRentalModal={setShowTimedRentalModal}
        selectedTimedItem={selectedTimedItem}
        setSelectedTimedItem={setSelectedTimedItem}
        inlineTimedRentalCallbackRef={inlineTimedRentalCallbackRef}
        onStartTimedSession={handlers.handleStartTimedSession}
        loadingSession={loadingSession}
        showPaymentModal={showPaymentModal}
        setShowPaymentModal={setShowPaymentModal}
        orderToPayId={orderToPayId}
        setOrderToPayId={setOrderToPayId}
        initialPayMethod={initialPayMethod}
        setInitialPayMethod={setInitialPayMethod}
        paymentTabCards={paymentTabCards}
        onTabCardsChanged={handlers.handleTabCardsChanged}
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

          if (result.tabStatus === 'existing_tab_found' && result.existingTab) {
            if (cardTabOrderId) {
              fetch(`/api/orders/${cardTabOrderId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'cancelled' }),
              }).catch(() => {})
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
                }).catch(() => {})
              } catch (err) {
                console.error('[CardTab] Background send failed:', err)
                toast.error('Tab may not have saved \u2014 check open orders')
              } finally {
                setTabsRefreshTrigger(prev => prev + 1)
              }
            })()
          } else {
            if (cardTabOrderId) {
              fetch(`/api/orders/${cardTabOrderId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'cancelled' }),
              }).catch(() => {})
              const store = useOrderStore.getState()
              if (store.currentOrder?.id === cardTabOrderId) {
                store.updateOrderId(`temp_${Date.now()}`, undefined)
              }
            }
            setSavedOrderId(null)
            setCardTabOrderId(null)
          }
        }}
        onCardTabCancel={() => {
          setShowCardTabFlow(false)
          if (cardTabOrderId) {
            fetch(`/api/orders/${cardTabOrderId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'cancelled' }),
            }).catch(() => {})
            const store = useOrderStore.getState()
            if (store.currentOrder?.id === cardTabOrderId) {
              store.updateOrderId(`temp_${Date.now()}`, undefined)
            }
          }
          setSavedOrderId(null)
          setCardTabOrderId(null)
        }}
        showDiscountModal={showDiscountModal}
        setShowDiscountModal={setShowDiscountModal}
        appliedDiscounts={appliedDiscounts}
        onDiscountApplied={handlers.handleDiscountApplied}
        itemDiscountTargetId={itemDiscountTargetId}
        showCompVoidModal={showCompVoidModal}
        setShowCompVoidModal={setShowCompVoidModal}
        compVoidItem={compVoidItem}
        setCompVoidItem={setCompVoidItem}
        onCompVoidComplete={handlers.handleCompVoidComplete}
        resendModal={resendModal}
        setResendModal={setResendModal}
        resendNote={resendNote}
        setResendNote={setResendNote}
        resendLoading={resendLoading}
        onConfirmResend={handlers.confirmResendItem}
        showItemTransferModal={showItemTransferModal}
        setShowItemTransferModal={setShowItemTransferModal}
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
        onPayAllCash={() => handlers.callPayAllSplitsAPI('cash')}
        onPayAllCard={(cardResult) => handlers.callPayAllSplitsAPI('credit', cardResult)}
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
    </div>
  )
}
