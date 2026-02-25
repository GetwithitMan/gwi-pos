'use client'

import { useCallback, useRef, useState } from 'react'
import { useOrderStore } from '@/stores/order-store'
import { useFloorPlanStore } from '@/components/floor-plan/use-floor-plan'
import { buildPizzaModifiers, getPizzaBasePrice } from '@/lib/pizza-order-utils'
import { debugPizzaPricing } from '@/lib/pizza-helpers'
import { calculateCardPrice } from '@/lib/pricing'
import { formatCurrency } from '@/lib/utils'
import { OfflineManager } from '@/lib/offline-manager'
import { isTempId } from '@/lib/order-utils'
import { fetchAndLoadSplitOrder } from '@/lib/split-order-loader'
import { toast } from '@/stores/toast-store'
import type {
  MenuItem,
  SelectedModifier,
  PizzaOrderConfig,
  OrderItem,
  OrderTypeConfig,
  OrderCustomFields,
  WorkflowRules,
  OpenOrder,
  OrderPanelItemData,
  ActiveSession,
  EntertainmentItemInfo,
  TabCardInfo,
} from '../types'
import type { IngredientModificationType } from '@/types/orders'
import type { PrepaidPackage } from '@/lib/entertainment-pricing'

interface UseOrderHandlersOptions {
  locationId?: string
  employeeId?: string
  employee?: {
    id: string
    location?: { id: string }
    role?: { name?: string }
    displayName?: string
  }
  savedOrderId: string | null
  setSavedOrderId: (id: string | null) => void
  orderToPayId: string | null
  setOrderToPayId: (id: string | null) => void
  ensureOrderInDB: (employeeId?: string) => Promise<string | null>
  clearOrder: () => void
  activeOrderFull: any
  isBartender: boolean
  menuItems: MenuItem[]
  orderTypes: OrderTypeConfig[]
  selectedCategoryData?: { categoryType?: string }
  activeSessions: ActiveSession[]
  setActiveSessions: (fn: (prev: ActiveSession[]) => ActiveSession[]) => void
  throttledLoadMenu: () => void
  pricing: any

  // State setters for modals/flows
  setShowPaymentModal: (v: boolean) => void
  setInitialPayMethod: (v: string | undefined) => void
  setPaymentTabCards: (v: any[]) => void
  setShowDiscountModal: (v: boolean) => void
  setAppliedDiscounts: (v: any[]) => void
  setItemDiscountTargetId: (v: string | null) => void
  setShowCompVoidModal: (v: boolean) => void
  setCompVoidItem: (v: any) => void
  setShowSplitTicketManager: (v: boolean) => void
  setSplitManageMode: (v: boolean) => void
  setShowModifierModal: (v: boolean) => void
  setSelectedItem: (v: MenuItem | null) => void
  setItemModifierGroups: (v: any[]) => void
  setLoadingModifiers: (v: boolean) => void
  setEditingOrderItem: (v: any) => void
  setShowPizzaModal: (v: boolean) => void
  setSelectedPizzaItem: (v: MenuItem | null) => void
  setEditingPizzaItem: (v: any) => void
  setShowComboModal: (v: boolean) => void
  setSelectedComboItem: (v: MenuItem | null) => void
  setComboTemplate: (v: any) => void
  setComboSelections: (v: Record<string, any>) => void
  setShowTimedRentalModal: (v: boolean) => void
  setSelectedTimedItem: (v: MenuItem | null) => void
  setSelectedRateType: (v: 'per15Min' | 'per30Min' | 'perHour') => void
  setLoadingSession: (v: boolean) => void
  setShowEntertainmentStart: (v: boolean) => void
  setEntertainmentItem: (v: EntertainmentItemInfo | null) => void
  setShowWeightModal: (v: boolean) => void
  setWeightCaptureItem: (v: { id: string; name: string; pricePerWeightUnit: number; weightUnit: string } | null)=> void
  setViewMode: (v: 'floor-plan' | 'bartender') => void
  setOrderSent: (v: boolean) => void
  setSelectedOrderType: (v: OrderTypeConfig | null) => void
  setOrderCustomFields: (v: OrderCustomFields) => void
  setTabsRefreshTrigger: (fn: (prev: number) => number) => void
  setFloorPlanRefreshTrigger: (fn: (prev: number) => number) => void
  setShowTabNamePrompt: (v: boolean) => void
  setTabNameCallback: (v: (() => void) | null) => void
  setShowReceiptModal: (v: boolean) => void
  setReceiptOrderId: (v: string | null) => void
  setEditingNotesItemId: (v: string | null) => void
  setEditingNotesText: (v: string) => void
  setResendNote: (v: string) => void
  setResendModal: (v: { itemId: string; itemName: string } | null) => void
  setResendLoading: (v: boolean) => void
  setSplitParentToReturnTo: (v: string | null) => void
  setPayAllSplitsQueue: (v: string[] | ((prev: string[]) => string[])) => void
  setPayAllSplitsParentId: (v: string | null) => void
  setPayAllSplitsTotal: (v: number) => void
  setPayAllSplitsCardTotal: (v: number) => void
  setShowPayAllSplitsConfirm: (v: boolean) => void
  setPayAllSplitsProcessing: (v: boolean) => void
  setPayAllSplitsStep: (v: string) => void
  setEditingChildSplit: (v: boolean) => void
  setOrderSplitChips: (v: any[] | ((prev: any[]) => any[])) => void
  setSplitParentId: (v: string | null) => void
  setSplitChipsFlashing: (v: boolean) => void
  setPaidOrderId: (v: string | null) => void
  setTabCardInfo: (v: TabCardInfo) => void
  setShowCardTabFlow: (v: boolean) => void
  setCardTabOrderId: (v: string | null) => void

  // Refs
  inlineModifierCallbackRef: React.MutableRefObject<((...args: any[]) => void) | null>
  inlinePizzaCallbackRef: React.MutableRefObject<((config: PizzaOrderConfig) => void) | null>
  inlineTimedRentalCallbackRef: React.MutableRefObject<((price: number, blockMinutes: number) => void) | null>
  orderReadyPromiseRef: React.MutableRefObject<Promise<string | null> | null>
  bartenderDeselectTabRef: React.MutableRefObject<(() => void) | null>
  floorPlanDeselectTableRef: React.MutableRefObject<(() => void) | null>
  sendLockRef: React.MutableRefObject<boolean>

  // Existing state values
  weightCaptureItem: { id: string; name: string; pricePerWeightUnit: number; weightUnit: string } | null
  selectedItem: MenuItem | null
  editingOrderItem: any
  selectedPizzaItem: MenuItem | null
  editingPizzaItem: any
  selectedComboItem: MenuItem | null
  comboTemplate: any
  comboSelections: Record<string, any>
  selectedTimedItem: MenuItem | null
  selectedRateType: string
  entertainmentItem: EntertainmentItemInfo | null
  resendModal: { itemId: string; itemName: string } | null
  resendNote: string
  editingNotesItemId: string | null
  editingNotesText: string
  splitParentId: string | null
  orderSplitChips: any[]
  editingChildSplit: boolean
  payAllSplitsParentId: string | null
  tabCardInfo: TabCardInfo | null

  // Mode setter
  setMode: (mode: 'bar' | 'food') => void

  // FloorPlan store
  addTableOrder: (tableId: string, order: any) => void

  // requireCardForTab
  requireCardForTab: boolean
}

export function useOrderHandlers(options: UseOrderHandlersOptions) {
  const {
    locationId,
    employeeId,
    employee,
    savedOrderId,
    setSavedOrderId,
    orderToPayId,
    setOrderToPayId,
    ensureOrderInDB,
    clearOrder,
    activeOrderFull,
    isBartender,
    menuItems,
    orderTypes,
    selectedCategoryData,
    activeSessions,
    setActiveSessions,
    throttledLoadMenu,
    pricing,
    setShowPaymentModal,
    setInitialPayMethod,
    setPaymentTabCards,
    setShowDiscountModal,
    setAppliedDiscounts,
    setItemDiscountTargetId,
    setShowCompVoidModal,
    setCompVoidItem,
    setShowSplitTicketManager,
    setSplitManageMode,
    setShowModifierModal,
    setSelectedItem,
    setItemModifierGroups,
    setLoadingModifiers,
    setEditingOrderItem,
    setShowPizzaModal,
    setSelectedPizzaItem,
    setEditingPizzaItem,
    setShowComboModal,
    setSelectedComboItem,
    setComboTemplate,
    setComboSelections,
    setShowTimedRentalModal,
    setSelectedTimedItem,
    setSelectedRateType,
    setLoadingSession,
    setShowEntertainmentStart,
    setEntertainmentItem,
    setShowWeightModal,
    setWeightCaptureItem,
    setViewMode,
    setOrderSent,
    setSelectedOrderType,
    setOrderCustomFields,
    setTabsRefreshTrigger,
    setFloorPlanRefreshTrigger,
    setShowTabNamePrompt,
    setTabNameCallback,
    setShowReceiptModal,
    setReceiptOrderId,
    setEditingNotesItemId,
    setEditingNotesText,
    setResendNote,
    setResendModal,
    setResendLoading,
    setSplitParentToReturnTo,
    setPayAllSplitsQueue,
    setPayAllSplitsParentId,
    setPayAllSplitsTotal,
    setPayAllSplitsCardTotal,
    setShowPayAllSplitsConfirm,
    setPayAllSplitsProcessing,
    setPayAllSplitsStep,
    setEditingChildSplit,
    setOrderSplitChips,
    setSplitParentId,
    setSplitChipsFlashing,
    setPaidOrderId,
    setTabCardInfo,
    setShowCardTabFlow,
    setCardTabOrderId,
    inlineModifierCallbackRef,
    inlinePizzaCallbackRef,
    inlineTimedRentalCallbackRef,
    orderReadyPromiseRef,
    bartenderDeselectTabRef,
    floorPlanDeselectTableRef,
    sendLockRef,
    weightCaptureItem,
    selectedItem,
    editingOrderItem,
    selectedPizzaItem,
    editingPizzaItem,
    selectedComboItem,
    comboTemplate,
    comboSelections,
    selectedTimedItem,
    selectedRateType,
    entertainmentItem,
    resendModal,
    resendNote,
    editingNotesItemId,
    editingNotesText,
    splitParentId,
    orderSplitChips,
    editingChildSplit,
    payAllSplitsParentId,
    tabCardInfo,
    setMode,
    addTableOrder,
    requireCardForTab,
  } = options

  const [isSendingOrder, setIsSendingOrder] = useState(false)

  const currentOrder = useOrderStore(s => s.currentOrder)
  const { startOrder, updateOrderType, loadOrder, addItem, updateItem, removeItem, updateQuantity } = useOrderStore.getState()

  // Order type selection
  const handleOrderTypeSelect = useCallback((orderType: OrderTypeConfig, customFields?: OrderCustomFields) => {
    setSelectedOrderType(orderType)
    if (customFields) {
      setOrderCustomFields(customFields)
    }

    if (orderType.slug === 'bar_tab') {
      setMode('bar')
    } else {
      setMode('food')
    }

    const workflowRules = (orderType.workflowRules || {}) as WorkflowRules
    if (workflowRules.requireTableSelection) {
      toast.warning('Please select a table from the floor plan')
    } else {
      const cleanFields: Record<string, string> = {}
      if (customFields) {
        Object.entries(customFields).forEach(([key, value]) => {
          if (value !== undefined) {
            cleanFields[key] = value
          }
        })
      }

      const currentOrderState = useOrderStore.getState().currentOrder
      if (currentOrderState?.items.length) {
        updateOrderType(orderType.slug, {
          tabName: customFields?.customerName,
          orderTypeId: orderType.id,
          customFields: Object.keys(cleanFields).length > 0 ? cleanFields : undefined,
        })
      } else {
        startOrder(orderType.slug, {
          tabName: customFields?.customerName,
          orderTypeId: orderType.id,
          customFields: Object.keys(cleanFields).length > 0 ? cleanFields : undefined,
        })
      }
    }
  }, [setMode, setSelectedOrderType, setOrderCustomFields])

  // Validate order before send
  const validateBeforeSend = useCallback((): { valid: boolean; message?: string } => {
    const order = useOrderStore.getState().currentOrder
    if (!order) return { valid: false, message: 'No order to send' }

    const orderTypeConfig = orderTypes.find(t => t.slug === order.orderType)
    if (!orderTypeConfig) {
      return { valid: true }
    }

    const workflowRules = (orderTypeConfig.workflowRules || {}) as WorkflowRules

    if (workflowRules.requireTableSelection && !order.tableId) {
      return { valid: false, message: 'TABLE_REQUIRED' }
    }

    if (workflowRules.requireCustomerName && !order.tabName) {
      return { valid: false, message: 'TAB_NAME_REQUIRED' }
    }

    if (workflowRules.requirePaymentBeforeSend) {
      return { valid: false, message: 'Payment is required before sending this order type to kitchen. Please collect payment first.' }
    }

    return { valid: true }
  }, [orderTypes])

  // Send to kitchen
  const handleSendToKitchen = useCallback(async () => {
    if (sendLockRef.current) return
    const order = useOrderStore.getState().currentOrder
    if (!order?.items.length) return

    const validation = validateBeforeSend()
    if (!validation.valid) {
      if (validation.message === 'TABLE_REQUIRED') {
        toast.warning('Please select a table from the floor plan')
        return
      }
      if (validation.message === 'TAB_NAME_REQUIRED') {
        setTabNameCallback(() => () => handleSendToKitchen())
        setShowTabNamePrompt(true)
        return
      }
      const orderTypeConfig = orderTypes.find(t => t.slug === order.orderType)
      const workflowRules = (orderTypeConfig?.workflowRules || {}) as WorkflowRules
      if (workflowRules.requirePaymentBeforeSend) {
        toast.warning('Payment is required before sending this order')
        handleOpenPayment()
      } else {
        toast.warning(validation.message || 'Cannot send order')
      }
      return
    }

    sendLockRef.current = true
    setIsSendingOrder(true)
    try {
      await activeOrderFull.handleSendToKitchen(employeeId)

      const orderId = useOrderStore.getState().currentOrder?.id || savedOrderId
      if (orderId) {
        const orderNum = orderId.slice(-6).toUpperCase()

        const sentTableId = useOrderStore.getState().currentOrder?.tableId
        if (sentTableId) {
          addTableOrder(sentTableId, {
            id: orderId,
            orderNumber: parseInt(orderNum, 10) || 0,
            guestCount: order?.items.length || 0,
            total: order?.subtotal || 0,
            openedAt: new Date().toISOString(),
            server: employeeId || '',
            status: 'sent',
          })
        }

        clearOrder()
        setSavedOrderId(null)
        setOrderSent(false)
        setSelectedOrderType(null)
        setOrderCustomFields({})
        setTabsRefreshTrigger(prev => prev + 1)
        setFloorPlanRefreshTrigger(prev => prev + 1)
        toast.success(`Order #${orderNum} sent to kitchen`)

        if (!isBartender) {
          setViewMode('floor-plan')
        }

        printKitchenTicket(orderId).catch(() => {})
      }
    } finally {
      sendLockRef.current = false
      setIsSendingOrder(false)
    }
  }, [savedOrderId, employeeId, isBartender, orderTypes, activeOrderFull, validateBeforeSend, addTableOrder, clearOrder])

  // Print kitchen ticket
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
      void OfflineManager.queuePrintJob(orderId, '', 0, []).catch(() => {})
      toast.info('Print queued — will retry when printer available')
    }
  }

  // Resend item
  const confirmResendItem = useCallback(async () => {
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
  }, [resendModal, resendNote])

  // Select open order
  const handleSelectOpenOrder = useCallback((order: OpenOrder) => {
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
    setSavedOrderId(order.id)
    setOrderSent(false)
    if (order.hasPreAuth && order.preAuth?.last4) {
      setTabCardInfo({
        cardholderName: order.cardholderName || undefined,
        cardLast4: order.preAuth.last4,
        cardType: order.preAuth.cardBrand,
      })
    }
  }, [])

  // Open payment
  const handleOpenPayment = useCallback(async () => {
    const order = useOrderStore.getState().currentOrder
    if (order?.status === 'split') {
      setSplitManageMode(true)
      setShowSplitTicketManager(true)
      return
    }

    const hasItems = order?.items.length && order.items.length > 0
    const hasSplitTotal = order?.total && order.total > 0 && !hasItems
    if (!hasItems && !hasSplitTotal) return

    let orderId = savedOrderId
    if (!orderId) {
      setIsSendingOrder(true)
      try {
        orderId = await ensureOrderInDB(employeeId)
        if (orderId) setSavedOrderId(orderId)
      } finally {
        setIsSendingOrder(false)
      }
      if (!orderId) return
    }

    setOrderToPayId(orderId)
    orderReadyPromiseRef.current = ensureOrderInDB(employeeId)

    fetch(`/api/orders/${orderId}/cards`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(d => {
        const authorized = (d.data || []).filter((c: { status: string }) => c.status === 'authorized')
        setPaymentTabCards(authorized)
      })
      .catch(() => setPaymentTabCards([]))

    setShowPaymentModal(true)
  }, [savedOrderId, employeeId, ensureOrderInDB])

  // Pay All Splits cleanup
  const cleanupAfterPayAllSplits = useCallback(() => {
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
  }, [clearOrder])

  // Pay All Splits API call
  const callPayAllSplitsAPI = useCallback(async (method: string, cardDetails?: {
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
          employeeId,
          terminalId: 'terminal-1',
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
  }, [payAllSplitsParentId, employeeId, cleanupAfterPayAllSplits])

  // Receipt close
  const handleReceiptClose = useCallback(() => {
    setShowReceiptModal(false)
    setReceiptOrderId(null)
    setSavedOrderId(null)
    setOrderSent(false)
    clearOrder()
    if (!isBartender) {
      setViewMode('floor-plan')
    }
  }, [isBartender, clearOrder])

  // Order settings save
  const handleOrderSettingsSave = useCallback(async (settings: {
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
    const orderResponse = await fetch(`/api/orders/${savedOrderId}`)
    if (orderResponse.ok) {
      const orderData = await orderResponse.json()
      loadOrder(orderData.data || orderData)
    }
    setTabsRefreshTrigger(prev => prev + 1)
  }, [savedOrderId])

  // Open split ticket
  const handleOpenSplitTicket = useCallback(() => {
    const order = useOrderStore.getState().currentOrder
    if (!order?.items.length) return
    setShowSplitTicketManager(true)
    if (!savedOrderId) {
      orderReadyPromiseRef.current = ensureOrderInDB(employeeId).then(id => {
        if (id) setSavedOrderId(id)
        return id
      })
    }
  }, [savedOrderId, employeeId, ensureOrderInDB])

  // Quick split evenly
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

  // Discount handlers
  const handleOpenDiscount = useCallback(async () => {
    const order = useOrderStore.getState().currentOrder
    if (!order?.items.length) return
    setItemDiscountTargetId(null)

    let orderId = savedOrderId
    if (!orderId) {
      orderId = await ensureOrderInDB(employeeId)
      if (orderId) {
        setSavedOrderId(orderId)
      }
    }

    if (orderId) {
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
  }, [savedOrderId, employeeId, ensureOrderInDB])

  const handleItemDiscount = useCallback(async (itemId: string) => {
    const store = useOrderStore.getState()
    const itemIndex = store.currentOrder?.items?.findIndex(i => i.id === itemId) ?? -1

    const orderId = await ensureOrderInDB(employeeId)
    if (orderId && !savedOrderId) setSavedOrderId(orderId)

    if (orderId) {
      const updatedStore = useOrderStore.getState()
      const actualItemId = (itemIndex >= 0 && updatedStore.currentOrder?.items?.[itemIndex]?.id) || itemId
      setOrderToPayId(orderId)
      setItemDiscountTargetId(actualItemId)
      setShowDiscountModal(true)
    }
  }, [savedOrderId, employeeId, ensureOrderInDB])

  const handleItemDiscountRemove = useCallback(async (itemId: string, discountId: string) => {
    const orderId = savedOrderId
    if (!orderId) return
    try {
      const res = await fetch(`/api/orders/${orderId}/items/${itemId}/discount?discountId=${discountId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to remove discount')
        return
      }
      const rawResult = await res.json()
      const result = rawResult.data ?? rawResult
      if (result.orderTotals) {
        const store = useOrderStore.getState()
        if (store.currentOrder) {
          store.syncServerTotals({
            subtotal: result.orderTotals.subtotal,
            discountTotal: result.orderTotals.discountTotal,
            taxTotal: result.orderTotals.taxTotal,
            total: result.orderTotals.total,
          })
        }
      }
      void fetch(`/api/orders/${orderId}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) loadOrder(data.data || data) })
        .catch(console.error)
      setTabsRefreshTrigger(prev => prev + 1)
      toast.success('Discount removed')
    } catch {
      toast.error('Failed to remove discount')
    }
  }, [savedOrderId])

  const handleDiscountApplied = useCallback((newTotals: {
    subtotal?: number
    discountTotal: number
    taxTotal: number
    total: number
  }) => {
    setItemDiscountTargetId(null)
    const store = useOrderStore.getState()
    if (store.currentOrder) {
      store.syncServerTotals({
        subtotal: newTotals.subtotal ?? store.currentOrder.subtotal,
        discountTotal: newTotals.discountTotal,
        taxTotal: newTotals.taxTotal,
        total: newTotals.total,
      })
    }
    if (orderToPayId) {
      fetch(`/api/orders/${orderToPayId}/discount`)
        .then(res => res.json())
        .then(data => {
          setAppliedDiscounts(data.data?.discounts || [])
        })
        .catch(console.error)
    }
    setTabsRefreshTrigger(prev => prev + 1)
    if (savedOrderId) {
      void fetch(`/api/orders/${savedOrderId}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) loadOrder(data.data || data) })
        .catch(console.error)
    }
  }, [orderToPayId, savedOrderId])

  // Comp/Void handlers
  const handleOpenCompVoid = useCallback(async (item: OrderItem) => {
    let orderId = savedOrderId
    if (!orderId) {
      setIsSendingOrder(true)
      try {
        orderId = await ensureOrderInDB(employeeId)
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
  }, [savedOrderId, employeeId, ensureOrderInDB])

  const handleCompVoidComplete = useCallback(async (result: {
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
    setTabsRefreshTrigger(prev => prev + 1)
    setShowCompVoidModal(false)

    if (result.orderAutoClosed) {
      clearOrder()
      setSavedOrderId(null)
      setCompVoidItem(null)
      return
    }

    const { syncServerTotals } = useOrderStore.getState()
    syncServerTotals(result.orderTotals)

    if (result.item?.id && result.action !== 'restore') {
      updateItem(result.item.id, { status: result.action === 'void' ? 'voided' : 'comped' })
    }

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
  }, [savedOrderId, orderToPayId, clearOrder])

  // Add item handler
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleAddItem = useCallback(async (item: MenuItem) => {
    if (!item.isAvailable) return

    const order = useOrderStore.getState().currentOrder
    if (order?.status === 'split' && orderSplitChips.length > 0) {
      toast.warning('Select a split check or add a new one')
      setSplitChipsFlashing(true)
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
      flashTimeoutRef.current = setTimeout(() => setSplitChipsFlashing(false), 1500)
      return
    }

    if (item.itemType === 'combo') {
      setSelectedComboItem(item)
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
      return
    }

    if (item.itemType === 'timed_rental') {
      if (item.entertainmentStatus === 'in_use') {
        toast.warning(`${item.name} is currently in use`)
        return
      }
      setSelectedTimedItem(item)
      setSelectedRateType('perHour')
      setShowTimedRentalModal(true)
      return
    }

    if (selectedCategoryData?.categoryType === 'pizza') {
      setSelectedPizzaItem(item)
      setShowPizzaModal(true)
      return
    }

    if (item.soldByWeight && item.pricePerWeightUnit) {
      setWeightCaptureItem({
        id: item.id,
        name: item.name,
        pricePerWeightUnit: Number(item.pricePerWeightUnit),
        weightUnit: item.weightUnit || 'lb',
      })
      setShowWeightModal(true)
      return
    }

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
      addItem({
        menuItemId: item.id,
        name: item.name,
        price: item.price,
        quantity: 1,
        modifiers: [],
      })
    }
  }, [orderSplitChips, selectedCategoryData])

  // Weight item
  const handleAddWeightItem = useCallback((
    weight: number,
    weightUnit: string,
    unitPrice: number,
    grossWeight?: number,
    tareWeight?: number,
  ) => {
    if (!weightCaptureItem) return
    const totalPrice = Math.round(weight * unitPrice * 100) / 100
    addItem({
      menuItemId: weightCaptureItem.id,
      name: weightCaptureItem.name,
      price: totalPrice,
      quantity: 1,
      modifiers: [],
      soldByWeight: true,
      weight,
      weightUnit,
      unitPrice,
      grossWeight: grossWeight ?? null,
      tareWeight: tareWeight ?? null,
    })
    setWeightCaptureItem(null)
    setShowWeightModal(false)
  }, [weightCaptureItem])

  // Quick bar item click
  const handleQuickBarItemClick = useCallback(async (itemId: string) => {
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
  }, [handleAddItem])

  // Add item with modifiers
  const handleAddItemWithModifiers = useCallback((modifiers: SelectedModifier[], specialNotes?: string, pourSize?: string, pourMultiplier?: number, ingredientModifications?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]) => {
    if (!selectedItem) return

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

    const basePrice = pourMultiplier ? selectedItem.price * pourMultiplier : selectedItem.price
    const applyToMods = selectedItem.applyPourToModifiers && pourMultiplier

    const itemName = pourSize
      ? `${selectedItem.name} (${pourSize.charAt(0).toUpperCase() + pourSize.slice(1)})`
      : selectedItem.name

    addItem({
      menuItemId: selectedItem.id,
      name: itemName,
      price: basePrice,
      quantity: 1,
      specialNotes,
      pourSize: pourSize ?? null,
      pourMultiplier: pourMultiplier ?? null,
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
  }, [selectedItem])

  // Update item with modifiers (editing)
  const handleUpdateItemWithModifiers = useCallback((modifiers: SelectedModifier[], specialNotes?: string, pourSize?: string, pourMultiplier?: number, ingredientModifications?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]) => {
    if (!selectedItem || !editingOrderItem) return

    const basePrice = pourMultiplier ? selectedItem.price * pourMultiplier : selectedItem.price
    const applyToMods = selectedItem.applyPourToModifiers && pourMultiplier

    const itemName = pourSize
      ? `${selectedItem.name} (${pourSize.charAt(0).toUpperCase() + pourSize.slice(1)})`
      : selectedItem.name

    updateItem(editingOrderItem.id, {
      name: itemName,
      price: basePrice,
      specialNotes,
      pourSize: pourSize ?? null,
      pourMultiplier: pourMultiplier ?? null,
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
  }, [selectedItem, editingOrderItem])

  // Pizza handler
  const handleAddPizzaToOrder = useCallback((config: PizzaOrderConfig) => {
    if (!selectedPizzaItem) return

    if (inlinePizzaCallbackRef.current) {
      inlinePizzaCallbackRef.current(config)
      inlinePizzaCallbackRef.current = null
      setShowPizzaModal(false)
      setSelectedPizzaItem(null)
      setEditingPizzaItem(null)
      return
    }

    const itemName = selectedPizzaItem.name
    const pizzaModifiers = buildPizzaModifiers(config)
    const basePrice = getPizzaBasePrice(config)

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
      updateItem(editingPizzaItem.id, {
        name: itemName,
        price: basePrice,
        specialNotes: config.specialNotes,
        modifiers: pizzaModifiers,
        pizzaConfig: config,
      })
    } else {
      addItem({
        menuItemId: selectedPizzaItem.id,
        name: itemName,
        price: basePrice,
        quantity: 1,
        specialNotes: config.specialNotes,
        modifiers: pizzaModifiers,
        pizzaConfig: config,
      })
    }

    setShowPizzaModal(false)
    setSelectedPizzaItem(null)
    setEditingPizzaItem(null)
  }, [selectedPizzaItem, editingPizzaItem])

  // Combo handler
  const handleAddComboToOrderWithSelections = useCallback((selections: Record<string, Record<string, string[]>>) => {
    if (!selectedComboItem || !comboTemplate) return

    let totalUpcharge = 0
    const comboModifiers: SelectedModifier[] = []

    for (const component of comboTemplate.components) {
      if (component.menuItem) {
        comboModifiers.push({
          id: `combo-item-${component.id}`,
          name: component.displayName,
          price: 0,
          depth: 0,
        })

        const componentSelections = selections[component.id] || {}
        for (const mg of component.menuItem.modifierGroups || []) {
          const groupSelections = componentSelections[mg.modifierGroup.id] || []
          for (const modifierId of groupSelections) {
            const modifier = mg.modifierGroup.modifiers.find((m: any) => m.id === modifierId)
            if (modifier) {
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
        const legacySelections = (selections[component.id] as unknown as string[]) || []
        for (const optionId of legacySelections) {
          const option = component.options.find((o: any) => o.id === optionId)
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
      price: comboTemplate.basePrice,
      quantity: 1,
      modifiers: comboModifiers,
    })

    setShowComboModal(false)
    setSelectedComboItem(null)
    setComboTemplate(null)
    setComboSelections({})
  }, [selectedComboItem, comboTemplate])

  // Timed session handlers
  const handleStartTimedSession = useCallback(async (rateType?: 'per15Min' | 'per30Min' | 'perHour') => {
    if (!selectedTimedItem || !locationId) return

    const effectiveRateType = rateType || selectedRateType

    const timedPricing = selectedTimedItem.timedPricing as { per15Min?: number; per30Min?: number; perHour?: number; minimum?: number } | null
    let rateAmount = selectedTimedItem.price
    if (timedPricing) {
      rateAmount = timedPricing[effectiveRateType as keyof typeof timedPricing] as number || timedPricing.perHour || timedPricing.per30Min || timedPricing.per15Min || selectedTimedItem.price
    }

    let blockMinutes = 60
    if (effectiveRateType === 'per15Min') blockMinutes = 15
    else if (effectiveRateType === 'per30Min') blockMinutes = 30
    else if (effectiveRateType === 'perHour') blockMinutes = 60

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
          locationId,
          menuItemId: selectedTimedItem.id,
          rateType: effectiveRateType,
          rateAmount,
          startedById: employeeId,
        }),
      })

      if (response.ok) {
        const session = await response.json()
        setActiveSessions(prev => [...prev, {
          id: session.id,
          menuItemId: selectedTimedItem.id,
          menuItemName: selectedTimedItem.name,
          startedAt: session.startedAt,
          rateType: effectiveRateType,
          rateAmount,
        }])

        const rateLabel = effectiveRateType.replace('per', '').replace('Min', ' min').replace('Hour', '/hr')
        addItem({
          menuItemId: selectedTimedItem.id,
          name: `\u23F1\uFE0F ${selectedTimedItem.name} (Active)`,
          price: 0,
          quantity: 1,
          modifiers: [],
          specialNotes: `Session ID: ${session.id} | Rate: ${formatCurrency(rateAmount)}${rateLabel}`,
        })

        setShowTimedRentalModal(false)
        setSelectedTimedItem(null)
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
  }, [selectedTimedItem, locationId, employeeId, selectedRateType, throttledLoadMenu])

  const handleStopTimedSession = useCallback(async (sessionId: string) => {
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
          const order = useOrderStore.getState().currentOrder
          const orderItem = order?.items.find(item =>
            item.specialNotes?.includes(`Session ID: ${sessionId}`)
          )
          if (orderItem) {
            updateItem(orderItem.id, {
              name: `${session.menuItemName} (${result.totalMinutes} min)`,
              price: result.totalAmount || result.totalCharge,
              specialNotes: `Billed: ${result.totalMinutes} min @ ${formatCurrency(session.rateAmount)}`,
            })
          } else if (order) {
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
        setActiveSessions(prev => prev.filter(s => s.id !== sessionId))
        throttledLoadMenu()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to stop session')
      }
    } catch (error) {
      console.error('Failed to stop session:', error)
      toast.error('Failed to stop session')
    }
  }, [activeSessions, throttledLoadMenu])

  // Entertainment session start handlers
  const handleStartEntertainmentWithNewTab = useCallback(async (tabName: string, pkg?: PrepaidPackage) => {
    if (!entertainmentItem || !locationId) return
    try {
      const orderRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          employeeId,
          orderType: 'bar_tab',
          tabName,
        }),
      })
      const orderData = await orderRes.json()
      const orderId = orderData.data?.id
      if (!orderId) throw new Error('Failed to create order')

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

      if (pkg && itemData.data?.id) {
        await fetch('/api/entertainment/block-time', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderItemId: itemData.data.id,
            locationId,
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
  }, [entertainmentItem, locationId, employeeId, throttledLoadMenu])

  const handleStartEntertainmentWithExistingTab = useCallback(async (orderId: string, pkg?: PrepaidPackage) => {
    if (!entertainmentItem || !locationId) return
    try {
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
      if (pkg && itemData.data?.id) {
        await fetch('/api/entertainment/block-time', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderItemId: itemData.data.id,
            locationId,
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
  }, [entertainmentItem, locationId, throttledLoadMenu])

  const handleStartEntertainmentWithCurrentOrder = useCallback(async (pkg?: PrepaidPackage) => {
    const orderId = savedOrderId
    if (orderId) {
      await handleStartEntertainmentWithExistingTab(orderId, pkg)
    }
  }, [savedOrderId, handleStartEntertainmentWithExistingTab])

  // Edit order item
  const handleEditOrderItem = useCallback(async (orderItem: any) => {
    const menuItem = menuItems.find(m => m.id === orderItem.menuItemId)
    if (!menuItem) return

    if (orderItem.pizzaConfig) {
      setSelectedPizzaItem(menuItem)
      setEditingPizzaItem({
        id: orderItem.id,
        pizzaConfig: orderItem.pizzaConfig,
      })
      setShowPizzaModal(true)
      return
    }

    if (menuItem.itemType === 'combo') {
      setSelectedComboItem(menuItem)
      setComboSelections({})
      setShowComboModal(true)
      try {
        const response = await fetch(`/api/combos/${menuItem.id}`)
        if (response.ok) {
          const data = await response.json()
          setComboTemplate(data.data?.template)
        }
      } catch (error) {
        console.error('Failed to load combo template:', error)
      }
      return
    }

    if (menuItem.modifierGroupCount && menuItem.modifierGroupCount > 0) {
      setSelectedItem(menuItem)
      setEditingOrderItem({
        id: orderItem.id,
        menuItemId: orderItem.menuItemId,
        modifiers: orderItem.modifiers.map((m: any) => ({
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
  }, [menuItems])

  // Shared handler for opening modifier modal from FloorPlanHome/BartenderView
  const handleOpenModifiersShared = useCallback(async (
    item: MenuItem,
    onComplete: (modifiers: any[], ingredientModifications?: any[]) => void,
    existingModifiers?: any[],
    existingIngredientMods?: any[]
  ) => {
    try {
      inlineModifierCallbackRef.current = onComplete
      setLoadingModifiers(true)
      setSelectedItem(item)

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
          ingredientModifications: existingIngredientMods as any,
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

  // Open timed rental handler (for FloorPlanHome/BartenderView)
  const handleOpenTimedRental = useCallback((
    item: any,
    onComplete: (price: number, blockMinutes: number) => void
  ) => {
    setEntertainmentItem({
      id: item.id,
      name: item.name,
      ratePerMinute: (item as any).ratePerMinute || 0.25,
      prepaidPackages: (item as any).prepaidPackages || [],
      happyHourEnabled: (item as any).happyHourEnabled || false,
      happyHourPrice: (item as any).happyHourPrice || null,
    })
    setShowEntertainmentStart(true)
    inlineTimedRentalCallbackRef.current = onComplete
  }, [])

  // Notes editing
  const handleOpenNotesEditor = useCallback((itemId: string, currentNotes?: string) => {
    setEditingNotesItemId(itemId)
    setEditingNotesText(currentNotes || '')
  }, [])

  const handleSaveNotes = useCallback(() => {
    if (editingNotesItemId) {
      updateItem(editingNotesItemId, {
        specialNotes: editingNotesText.trim() || undefined,
      })
    }
    setEditingNotesItemId(null)
    setEditingNotesText('')
  }, [editingNotesItemId, editingNotesText])

  // Tab cards changed handler
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

  // Item control handlers (wrappers around activeOrderFull)
  const handleHoldToggle = useCallback(async (itemId: string) => {
    await activeOrderFull.handleHoldToggle(itemId)
  }, [activeOrderFull])

  const handleNoteEdit = useCallback(async (itemId: string, currentNote?: string) => {
    await activeOrderFull.handleNoteEdit(itemId, currentNote)
  }, [activeOrderFull])

  const handleCourseChange = useCallback(async (itemId: string, course: number | null) => {
    await activeOrderFull.handleCourseChange(itemId, course)
  }, [activeOrderFull])

  const handleEditModifiers = useCallback((itemId: string) => {
    const order = useOrderStore.getState().currentOrder
    const fullItem = order?.items.find(i => i.id === itemId)
    if (fullItem) {
      handleEditOrderItem(fullItem)
    }
  }, [handleEditOrderItem])

  const handleCompVoid = useCallback(async (item: OrderPanelItemData) => {
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
  }, [handleOpenCompVoid])

  const handleResend = useCallback(async (item: OrderPanelItemData) => {
    await activeOrderFull.handleResend(item.id)
  }, [activeOrderFull])

  const handleSeatChange = useCallback(async (itemId: string, seat: number | null) => {
    await activeOrderFull.handleSeatChange(itemId, seat)
  }, [activeOrderFull])

  // Search handlers
  const handleSearchSelect = useCallback((item: { id: string; name: string; price: number; categoryId: string }) => {
    const fullItem = menuItems.find((m: any) => m.id === item.id)
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
  }, [menuItems])

  return {
    isSendingOrder,
    setIsSendingOrder,
    handleOrderTypeSelect,
    validateBeforeSend,
    handleSendToKitchen,
    confirmResendItem,
    handleSelectOpenOrder,
    handleOpenPayment,
    cleanupAfterPayAllSplits,
    callPayAllSplitsAPI,
    handleReceiptClose,
    handleOrderSettingsSave,
    handleOpenSplitTicket,
    handleQuickSplitEvenly,
    handleOpenDiscount,
    handleItemDiscount,
    handleItemDiscountRemove,
    handleDiscountApplied,
    handleOpenCompVoid,
    handleCompVoidComplete,
    handleAddItem,
    handleAddWeightItem,
    handleQuickBarItemClick,
    handleAddItemWithModifiers,
    handleUpdateItemWithModifiers,
    handleAddPizzaToOrder,
    handleAddComboToOrderWithSelections,
    handleStartTimedSession,
    handleStopTimedSession,
    handleStartEntertainmentWithNewTab,
    handleStartEntertainmentWithExistingTab,
    handleStartEntertainmentWithCurrentOrder,
    handleEditOrderItem,
    handleOpenModifiersShared,
    handleOpenTimedRental,
    handleOpenNotesEditor,
    handleSaveNotes,
    handleTabCardsChanged,
    handleHoldToggle,
    handleNoteEdit,
    handleCourseChange,
    handleEditModifiers,
    handleCompVoid,
    handleResend,
    handleSeatChange,
    handleSearchSelect,
  }
}
