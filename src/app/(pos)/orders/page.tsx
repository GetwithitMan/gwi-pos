'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useOrderStore } from '@/stores/order-store'
import { useOrderSettings } from '@/hooks/useOrderSettings'
import { formatCurrency, formatTime } from '@/lib/utils'
import { calculateCardPrice, calculateCashDiscount, applyPriceRounding } from '@/lib/pricing'
import { PaymentModal } from '@/components/payment/PaymentModal'
import { SplitCheckModal } from '@/components/payment/SplitCheckModal'
import { DiscountModal } from '@/components/orders/DiscountModal'
import { CompVoidModal } from '@/components/orders/CompVoidModal'
import { ItemTransferModal } from '@/components/orders/ItemTransferModal'
import { SplitTicketManager } from '@/components/orders/SplitTicketManager'
import { OpenOrdersPanel, type OpenOrder } from '@/components/orders/OpenOrdersPanel'
import { NewTabModal } from '@/components/tabs/NewTabModal'
import { TabDetailModal } from '@/components/tabs/TabDetailModal'
import { TabTransferModal } from '@/components/tabs/TabTransferModal'
import { TimeClockModal } from '@/components/time-clock/TimeClockModal'
import { ShiftStartModal } from '@/components/shifts/ShiftStartModal'
import { ShiftCloseoutModal } from '@/components/shifts/ShiftCloseoutModal'
import { ReceiptModal } from '@/components/receipt'
import { SeatCourseHoldControls, ItemBadges } from '@/components/orders/SeatCourseHoldControls'
import { CourseOverviewPanel } from '@/components/orders/CourseOverviewPanel'
import { ModifierModal } from '@/components/modifiers/ModifierModal'
import { AddToWaitlistModal } from '@/components/entertainment/AddToWaitlistModal'
import { OrderSettingsModal } from '@/components/orders/OrderSettingsModal'
import type { Category, MenuItem, ModifierGroup, SelectedModifier } from '@/types'

export default function OrdersPage() {
  const router = useRouter()
  const { employee, isAuthenticated, logout } = useAuthStore()
  const { currentOrder, startOrder, loadOrder, addItem, updateItem, removeItem, updateQuantity, clearOrder } = useOrderStore()
  const [categories, setCategories] = useState<Category[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showMenu, setShowMenu] = useState(false)

  // Modifier selection state
  const [showModifierModal, setShowModifierModal] = useState(false)
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null)
  const [itemModifierGroups, setItemModifierGroups] = useState<ModifierGroup[]>([])
  const [loadingModifiers, setLoadingModifiers] = useState(false)
  const [editingOrderItem, setEditingOrderItem] = useState<{
    id: string
    menuItemId: string
    modifiers: { id: string; name: string; price: number; depth: number; parentModifierId?: string }[]
    specialNotes?: string
  } | null>(null)

  // Settings loaded from API via custom hook
  const { dualPricing, paymentSettings, priceRounding, taxRate, receiptSettings } = useOrderSettings()
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash')

  // Payment modal state
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [orderToPayId, setOrderToPayId] = useState<string | null>(null)

  // Receipt modal state
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  const [receiptOrderId, setReceiptOrderId] = useState<string | null>(null)

  // Split check modal state
  const [showSplitModal, setShowSplitModal] = useState(false)
  const [splitPaymentAmount, setSplitPaymentAmount] = useState<number | null>(null)
  const [evenSplitAmounts, setEvenSplitAmounts] = useState<{ splitNumber: number; amount: number }[] | null>(null)
  const [currentSplitIndex, setCurrentSplitIndex] = useState(0)

  // Discount modal state
  const [showDiscountModal, setShowDiscountModal] = useState(false)
  const [appliedDiscounts, setAppliedDiscounts] = useState<{ id: string; name: string; amount: number; percent?: number | null }[]>([])

  // Comp/Void modal state
  const [showCompVoidModal, setShowCompVoidModal] = useState(false)
  const [compVoidItem, setCompVoidItem] = useState<{
    id: string
    name: string
    quantity: number
    price: number
    modifiers: { name: string; price: number }[]
    status?: string
    voidReason?: string
  } | null>(null)

  // Item Transfer modal state
  const [showItemTransferModal, setShowItemTransferModal] = useState(false)

  // Split Ticket Manager state
  const [showSplitTicketManager, setShowSplitTicketManager] = useState(false)

  // Entertainment waitlist modal state
  const [showWaitlistModal, setShowWaitlistModal] = useState(false)
  const [waitlistMenuItem, setWaitlistMenuItem] = useState<MenuItem | null>(null)

  // Order settings modal state
  const [showOrderSettingsModal, setShowOrderSettingsModal] = useState(false)

  // Tabs panel state
  const [showTabsPanel, setShowTabsPanel] = useState(false)
  const [showNewTabModal, setShowNewTabModal] = useState(false)
  const [showTabDetailModal, setShowTabDetailModal] = useState(false)
  const [showTabTransferModal, setShowTabTransferModal] = useState(false)
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null)
  const [selectedTabName, setSelectedTabName] = useState<string | null>(null)
  const [tabsRefreshTrigger, setTabsRefreshTrigger] = useState(0)

  // Saved order state
  const [savedOrderId, setSavedOrderId] = useState<string | null>(null)
  const [isSendingOrder, setIsSendingOrder] = useState(false)
  const [orderSent, setOrderSent] = useState(false)

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
    employee: { id: string; name: string }
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
    comparePrice?: number
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
      options: { id: string; menuItemId: string; name: string; upcharge: number }[]
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

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login')
    }
  }, [isAuthenticated, router])

  useEffect(() => {
    if (employee?.location?.id) {
      loadMenu()
      loadActiveSessions()
    }
  }, [employee?.location?.id])

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
          setCurrentShift(data.shifts[0])
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

  // Load open orders count
  useEffect(() => {
    if (employee?.location?.id) {
      loadOpenOrdersCount()
    }
  }, [employee?.location?.id, tabsRefreshTrigger])

  const loadOpenOrdersCount = async () => {
    if (!employee?.location?.id) return
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
  }

  useEffect(() => {
    if (!currentOrder) {
      startOrder('dine_in', { guestCount: 1 })
    }
  }, [currentOrder, startOrder])

  const loadMenu = async () => {
    if (!employee?.location?.id) return
    try {
      const params = new URLSearchParams({ locationId: employee.location.id })
      const response = await fetch(`/api/menu?${params}`)
      if (response.ok) {
        const data = await response.json()
        setCategories(data.categories)
        setMenuItems(data.items)
        if (data.categories.length > 0) {
          setSelectedCategory(data.categories[0].id)
        }
      }
    } catch (error) {
      console.error('Failed to load menu:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = () => {
    clearOrder()
    logout()
    router.push('/login')
  }

  // Save order to database (create new or update existing)
  const saveOrderToDatabase = async (): Promise<string | null> => {
    if (!currentOrder?.items.length || !employee) return null

    try {
      // If we already have a saved order ID, update it instead of creating new
      if (savedOrderId) {
        const response = await fetch(`/api/orders/${savedOrderId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tabName: currentOrder.tabName,
            guestCount: currentOrder.guestCount,
            notes: currentOrder.notes,
            items: currentOrder.items.map(item => ({
              menuItemId: item.menuItemId,
              name: item.name,
              price: item.price,
              quantity: item.quantity,
              modifiers: item.modifiers.map(mod => ({
                modifierId: mod.id,
                name: mod.name,
                price: mod.price,
                preModifier: mod.preModifier,
              })),
              specialNotes: item.specialNotes,
            })),
          }),
        })

        if (!response.ok) {
          const err = await response.json()
          throw new Error(err.error || 'Failed to update order')
        }

        return savedOrderId
      }

      // Create new order
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: employee.id,
          locationId: employee.location?.id,
          orderType: currentOrder.orderType,
          tabName: currentOrder.tabName,
          guestCount: currentOrder.guestCount,
          items: currentOrder.items.map(item => ({
            menuItemId: item.menuItemId,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            modifiers: item.modifiers.map(mod => ({
              modifierId: mod.id,
              name: mod.name,
              price: mod.price,
              preModifier: mod.preModifier,
            })),
            specialNotes: item.specialNotes,
          })),
          notes: currentOrder.notes,
        }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to save order')
      }

      const savedOrder = await response.json()
      return savedOrder.id
    } catch (error) {
      console.error('Failed to save order:', error)
      alert(error instanceof Error ? error.message : 'Failed to save order')
      return null
    }
  }

  // Send to Kitchen handler
  const handleSendToKitchen = async () => {
    if (!currentOrder?.items.length) return

    setIsSendingOrder(true)
    try {
      const orderId = await saveOrderToDatabase()
      if (orderId) {
        // Show brief confirmation
        const orderNum = orderId.slice(-6).toUpperCase()

        // Clear the order so user can start the next one
        clearOrder()
        setSavedOrderId(null)
        setOrderSent(false)

        // Refresh the open orders panel and count
        setTabsRefreshTrigger(prev => prev + 1)

        // Show confirmation with instructions
        alert(`Order #${orderNum} sent to kitchen!\n\nClick "Open Orders" button to view or add more items.`)
      }
    } finally {
      setIsSendingOrder(false)
    }
  }

  // Handle resending an item to the kitchen (KDS)
  const handleResendItem = async (itemId: string, itemName: string) => {
    // Prompt for an optional note
    const resendNote = prompt(
      `Resend "${itemName}" to kitchen?\n\nOptional: Add a note for the kitchen (e.g., "Make it well done")`,
      ''
    )

    // If user clicked Cancel, abort
    if (resendNote === null) return

    try {
      const response = await fetch('/api/kds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemIds: [itemId],
          action: 'resend',
          resendNote: resendNote.trim() || undefined,
        }),
      })

      if (response.ok) {
        const noteMsg = resendNote.trim() ? `\nNote: "${resendNote.trim()}"` : ''
        alert(`"${itemName}" resent to kitchen!${noteMsg}\n\nIt will appear with a RESEND badge on KDS.`)
      } else {
        alert('Failed to resend item')
      }
    } catch (error) {
      console.error('Failed to resend item:', error)
      alert('Failed to resend item')
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

    // Close the panel
    setShowTabsPanel(false)
  }

  // Payment handlers
  const handleOpenPayment = async () => {
    // Allow payment if there are items OR if the order has a total (split orders)
    const hasItems = currentOrder?.items.length && currentOrder.items.length > 0
    const hasSplitTotal = currentOrder?.total && currentOrder.total > 0 && !hasItems
    if (!hasItems && !hasSplitTotal) return

    // If order hasn't been saved yet, save it first
    let orderId = savedOrderId
    if (!orderId) {
      setIsSendingOrder(true)
      try {
        orderId = await saveOrderToDatabase()
        if (orderId) {
          setSavedOrderId(orderId)
        }
      } finally {
        setIsSendingOrder(false)
      }
    }

    if (orderId) {
      setOrderToPayId(orderId)
      setShowPaymentModal(true)
    }
  }

  const handlePaymentComplete = () => {
    // Check if we're doing an even split with more guests
    if (evenSplitAmounts && currentSplitIndex < evenSplitAmounts.length - 1) {
      // Move to next guest
      setCurrentSplitIndex(prev => prev + 1)
      setSplitPaymentAmount(evenSplitAmounts[currentSplitIndex + 1].amount)
      // Keep payment modal open for next guest
      return
    }

    // All payments complete - show receipt
    const paidOrderId = orderToPayId || savedOrderId
    setShowPaymentModal(false)

    if (paidOrderId) {
      setReceiptOrderId(paidOrderId)
      setShowReceiptModal(true)
    }

    // Reset payment state
    setOrderToPayId(null)
    setSplitPaymentAmount(null)
    setEvenSplitAmounts(null)
    setCurrentSplitIndex(0)
    setTabsRefreshTrigger(prev => prev + 1)
  }

  const handleReceiptClose = () => {
    setShowReceiptModal(false)
    setReceiptOrderId(null)
    // Clear order after receipt is dismissed
    setSavedOrderId(null)
    setOrderSent(false)
    clearOrder()
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
    type: 'even' | 'by_item' | 'custom_amount' | 'split_item'
    originalOrderId: string
    splits?: { splitNumber: number; amount: number }[]
    newOrderId?: string
    newOrderNumber?: number
    splitAmount?: number
    itemSplits?: { itemId: string; itemName: string; splitNumber: number; amount: number }[]
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
      alert(`New check #${result.newOrderNumber} created with selected items.\n\nView it in Open Orders.`)
      setTabsRefreshTrigger(prev => prev + 1)
      // Clear current order since items were moved
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
        tabName: orderData.tabName || undefined,
        guestCount: orderData.guestCount || 1,
        status: orderData.status,
        items: orderData.items.map((item: {
          id: string
          menuItemId: string
          name: string
          price: number
          quantity: number
          specialNotes?: string
          isCompleted?: boolean
          seatNumber?: number
          sentToKitchen?: boolean
          modifiers?: { id: string; modifierId: string; name: string; price: number; preModifier?: string }[]
        }) => ({
          id: item.id,
          menuItemId: item.menuItemId,
          name: item.name,
          price: Number(item.price),
          quantity: item.quantity,
          specialNotes: item.specialNotes || '',
          isCompleted: item.isCompleted || false,
          seatNumber: item.seatNumber,
          sentToKitchen: item.sentToKitchen || false,
          modifiers: (item.modifiers || []).map(mod => ({
            id: mod.id,
            modifierId: mod.modifierId,
            name: mod.name,
            price: Number(mod.price),
            preModifier: mod.preModifier,
          })),
        })),
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
      alert('Failed to load split order')
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
        orderId = await saveOrderToDatabase()
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
        orderId = await saveOrderToDatabase()
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
        orderId = await saveOrderToDatabase()
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
  const handleOpenCompVoid = async (item: {
    id: string
    name: string
    quantity: number
    price: number
    modifiers: { id: string; name: string; price: number }[]
    status?: string
    voidReason?: string
  }) => {
    // If order hasn't been saved yet, save it first
    let orderId = savedOrderId
    if (!orderId) {
      setIsSendingOrder(true)
      try {
        orderId = await saveOrderToDatabase()
        if (orderId) {
          setSavedOrderId(orderId)
        }
      } finally {
        setIsSendingOrder(false)
      }
    }

    if (orderId) {
      setOrderToPayId(orderId)
      setCompVoidItem({
        ...item,
        modifiers: item.modifiers.map(m => ({ name: m.name, price: m.price })),
      })
      setShowCompVoidModal(true)
    }
  }

  const handleCompVoidComplete = (result: {
    action: 'comp' | 'void' | 'restore'
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
    setCompVoidItem(null)
  }

  // Tab handlers
  const handleNewTab = () => {
    setShowNewTabModal(true)
  }

  const handleCreateTab = async (data: {
    tabName?: string
    preAuth?: {
      cardBrand: string
      cardLast4: string
      amount?: number
    }
  }) => {
    if (!employee) throw new Error('Not logged in')

    const response = await fetch('/api/tabs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: employee.id,
        ...data,
      }),
    })

    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || 'Failed to create tab')
    }

    const newTab = await response.json()
    setTabsRefreshTrigger(prev => prev + 1)
    // Optionally select the new tab
    setSelectedTabId(newTab.id)
    setShowTabDetailModal(true)
  }

  const handleSelectTab = (tabId: string) => {
    setSelectedTabId(tabId)
    setShowTabDetailModal(true)
  }

  const handleAddItemsToTab = async (tabId: string) => {
    // Fetch the existing tab/order details
    try {
      const response = await fetch(`/api/orders/${tabId}`)
      if (!response.ok) {
        throw new Error('Failed to fetch tab details')
      }
      const tabData = await response.json()

      // Load the tab into the current order
      loadOrder({
        id: tabData.id,
        orderNumber: tabData.orderNumber,
        orderType: tabData.orderType,
        tableId: tabData.tableId || undefined,
        tabName: tabData.tabName || undefined,
        guestCount: tabData.guestCount,
        items: tabData.items,
        subtotal: tabData.subtotal,
        taxTotal: tabData.taxTotal,
        total: tabData.total,
        notes: tabData.notes,
      })

      // Track that this is an existing saved order (allow updates)
      setSavedOrderId(tabId)
      setOrderSent(false) // Allow sending updates to kitchen

      // Close modals
      setShowTabDetailModal(false)
      setShowTabsPanel(false)
    } catch (error) {
      console.error('Failed to load tab:', error)
      alert('Failed to load tab. Please try again.')
    }
  }

  const handlePayTab = (tabId: string) => {
    setOrderToPayId(tabId)
    setShowPaymentModal(true)
  }

  const handleTransferTab = (tabId: string, tabName?: string) => {
    setSelectedTabId(tabId)
    setSelectedTabName(tabName || null)
    setShowTabTransferModal(true)
  }

  const handleTabTransferComplete = (newEmployee: { id: string; name: string }) => {
    // Refresh tabs panel to show updated assignment
    setTabsRefreshTrigger((prev) => prev + 1)
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
      // If item is in use, show waitlist modal instead
      if (item.entertainmentStatus === 'in_use') {
        setWaitlistMenuItem(item)
        setShowWaitlistModal(true)
        return
      }
      // Otherwise show the normal rental modal
      setSelectedTimedItem(item)
      setSelectedRateType('perHour')
      setShowTimedRentalModal(true)
      return
    }

    // Check if item has modifiers
    if (item.modifierGroupCount && item.modifierGroupCount > 0) {
      setSelectedItem(item)
      setLoadingModifiers(true)
      setShowModifierModal(true)

      try {
        const response = await fetch(`/api/menu/items/${item.id}/modifiers`)
        if (response.ok) {
          const data = await response.json()
          setItemModifierGroups(data.modifierGroups || [])
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

  const handleAddItemWithModifiers = (modifiers: SelectedModifier[], specialNotes?: string) => {
    if (!selectedItem) return

    const modifierTotal = modifiers.reduce((sum, mod) => sum + mod.price, 0)

    addItem({
      menuItemId: selectedItem.id,
      name: selectedItem.name,
      price: selectedItem.price,
      quantity: 1,
      specialNotes,
      modifiers: modifiers.map(mod => ({
        id: mod.id,
        name: mod.preModifier
          ? `${mod.preModifier.charAt(0).toUpperCase() + mod.preModifier.slice(1)} ${mod.name}`
          : mod.name,
        price: mod.price,
        preModifier: mod.preModifier,
        depth: mod.depth,
        parentModifierId: mod.parentModifierId,
      })),
    })

    setShowModifierModal(false)
    setSelectedItem(null)
    setItemModifierGroups([])
    setEditingOrderItem(null)
  }

  // Handle adding combo to order
  const handleAddComboToOrder = () => {
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
        const componentSelections = comboSelections[component.id] || {}
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
        const selections = (comboSelections[component.id] as unknown as string[]) || []
        for (const optionId of selections) {
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

  // Handle starting a timed rental session
  const handleStartTimedSession = async () => {
    if (!selectedTimedItem || !employee?.location?.id) return

    const pricing = selectedTimedItem.timedPricing as { per15Min?: number; per30Min?: number; perHour?: number; minimum?: number } | null

    // Get the rate - try selected type first, then fall back
    let rateAmount = selectedTimedItem.price
    if (pricing) {
      rateAmount = pricing[selectedRateType] || pricing.perHour || pricing.per30Min || pricing.per15Min || selectedTimedItem.price
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
        loadMenu()
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to start session')
      }
    } catch (error) {
      console.error('Failed to start timed session:', error)
      alert('Failed to start session')
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
        loadMenu()
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to stop session')
      }
    } catch (error) {
      console.error('Failed to stop session:', error)
      alert('Failed to stop session')
    }
  }

  // Handle editing an existing order item
  const handleEditOrderItem = async (orderItem: NonNullable<typeof currentOrder>['items'][0]) => {
    // Find the menu item
    const menuItem = menuItems.find(m => m.id === orderItem.menuItemId)
    if (!menuItem) return

    if (menuItem.modifierGroupCount && menuItem.modifierGroupCount > 0) {
      setSelectedItem(menuItem)
      setEditingOrderItem({
        ...orderItem,
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

  const handleUpdateItemWithModifiers = (modifiers: SelectedModifier[], specialNotes?: string) => {
    if (!selectedItem || !editingOrderItem) return

    const modifierTotal = modifiers.reduce((sum, mod) => sum + mod.price, 0)

    updateItem(editingOrderItem.id, {
      price: selectedItem.price,
      specialNotes,
      modifiers: modifiers.map(mod => ({
        id: mod.id,
        name: mod.preModifier
          ? `${mod.preModifier.charAt(0).toUpperCase() + mod.preModifier.slice(1)} ${mod.name}`
          : mod.name,
        price: mod.price,
        preModifier: mod.preModifier,
        depth: mod.depth,
        parentModifierId: mod.parentModifierId,
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
    // Stored price is cash price, calculate card price
    const cashPrice = storedPrice
    const cardPrice = calculateCardPrice(storedPrice, discountPercent)
    return (
      <span className="text-xs">
        <span className="text-gray-700">{formatCurrency(cardPrice)}</span>
        <span className="text-gray-400 mx-1">-</span>
        <span className="text-green-600">{formatCurrency(cashPrice)}</span>
      </span>
    )
  }

  if (!isAuthenticated || !employee) {
    return null
  }

  return (
    <div className="h-screen bg-gray-100 flex overflow-hidden">
      {/* Left Panel - Menu */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <header className="bg-white border-b px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">GWI</span>
            </div>
            <div>
              <p className="font-semibold text-gray-900">{employee.displayName}</p>
              <p className="text-sm text-gray-500">{employee.role.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant={showTabsPanel ? 'primary' : openOrdersCount > 0 ? 'outline' : 'ghost'}
              size="sm"
              onClick={() => setShowTabsPanel(!showTabsPanel)}
              className={`relative ${openOrdersCount > 0 ? 'border-blue-500 text-blue-600' : ''}`}
            >
              <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Open Orders
              {openOrdersCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {openOrdersCount}
                </span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowMenu(!showMenu)}
              className="relative"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </Button>
            <span className="text-sm text-gray-500">{formatTime(new Date())}</span>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              Clock Out
            </Button>
          </div>
        </header>

        {/* Dropdown Menu */}
        {showMenu && (
          <div className="absolute top-16 right-4 bg-white rounded-lg shadow-lg border z-50 py-2 min-w-[200px]">
            <button
              className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
              onClick={() => {
                router.push('/menu')
                setShowMenu(false)
              }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              Menu Management
            </button>
            <button
              className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
              onClick={() => {
                router.push('/employees')
                setShowMenu(false)
              }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              Employees
            </button>
            <button
              className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
              onClick={() => {
                router.push('/reports/sales')
                setShowMenu(false)
              }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Sales Report
            </button>
            <button
              className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
              onClick={() => {
                router.push('/reports/commission')
                setShowMenu(false)
              }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Commission Report
            </button>
            <hr className="my-1" />
            <button
              className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
              onClick={() => {
                setShowTimeClockModal(true)
                setShowMenu(false)
              }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Time Clock
            </button>
            {currentShift && (
              <button
                className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2 text-orange-600"
                onClick={() => {
                  setShowShiftCloseoutModal(true)
                  setShowMenu(false)
                }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                Close Shift
              </button>
            )}
            <button
              className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
              onClick={() => {
                router.push('/kds')
                setShowMenu(false)
              }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Kitchen Display (KDS)
            </button>
            <button
              className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
              onClick={() => {
                router.push('/prep-stations')
                setShowMenu(false)
              }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              Prep Stations
            </button>
            <button
              className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
              onClick={() => {
                router.push('/tables')
                setShowMenu(false)
              }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
              Tables
            </button>
            <button
              className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
              onClick={() => {
                router.push('/settings')
                setShowMenu(false)
              }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </button>
          </div>
        )}

        {/* Categories */}
        <div className="bg-white border-b px-4 py-2 flex gap-2 overflow-x-auto">
          {isLoading ? (
            <div className="text-gray-400 py-2">Loading menu...</div>
          ) : (
            categories.map(category => (
              <Button
                key={category.id}
                variant={selectedCategory === category.id ? 'primary' : 'outline'}
                size="md"
                onClick={() => setSelectedCategory(category.id)}
                style={{
                  backgroundColor: selectedCategory === category.id ? category.color : undefined,
                  borderColor: category.color,
                  color: selectedCategory === category.id ? 'white' : category.color,
                }}
              >
                {category.name}
              </Button>
            ))
          )}
        </div>

        {/* Menu Items Grid */}
        <div className="flex-1 p-4 overflow-y-auto">
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {filteredItems.map(item => {
              const isInUse = item.itemType === 'timed_rental' && item.entertainmentStatus === 'in_use'
              return (
                <Button
                  key={item.id}
                  variant="outline"
                  className={`h-28 flex flex-col items-center justify-center gap-1 relative ${
                    isInUse
                      ? 'bg-red-50 border-red-300 hover:bg-red-100 hover:border-red-400'
                      : 'hover:bg-blue-50 hover:border-blue-500'
                  }`}
                  onClick={() => handleAddItem(item)}
                >
                  {isInUse && (
                    <span className="absolute top-1 right-1 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded font-medium">
                      IN USE
                    </span>
                  )}
                  <span className={`font-semibold text-center leading-tight ${isInUse ? 'text-red-800' : 'text-gray-900'}`}>
                    {item.name}
                  </span>
                  {formatItemPrice(item.price)}
                </Button>
              )
            })}
            {unavailableItems.map(item => (
              <Button
                key={item.id}
                variant="outline"
                className="h-28 flex flex-col items-center justify-center gap-1 opacity-50 cursor-not-allowed relative"
                disabled
              >
                <span className="font-semibold text-gray-900 text-center leading-tight">{item.name}</span>
                {formatItemPrice(item.price)}
                <span className="absolute top-1 right-1 bg-red-500 text-white text-xs px-1 rounded">86</span>
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Right Panel - Order */}
      <div className="w-80 bg-white border-l flex flex-col h-full overflow-hidden">
        {/* Order Header */}
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            {savedOrderId && currentOrder ? (
              // Show order identifier for existing orders - CLICKABLE to edit settings
              <div
                className="cursor-pointer hover:bg-gray-100 rounded-lg p-2 -m-2 transition-colors group"
                onClick={() => setShowOrderSettingsModal(true)}
              >
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-lg">
                    {currentOrder.tabName || `Order #${currentOrder.orderNumber || savedOrderId.slice(-6).toUpperCase()}`}
                  </h2>
                  <svg className="w-4 h-4 text-gray-400 group-hover:text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </div>
                <span className="text-sm text-gray-500 capitalize">
                  {currentOrder.orderType.replace('_', ' ')}
                  {currentOrder.guestCount > 1 && ` • ${currentOrder.guestCount} guests`}
                </span>
              </div>
            ) : (
              // Show "New Order" for new orders
              <div>
                <h2 className="font-semibold text-lg">New Order</h2>
                <span className="text-sm text-gray-500 capitalize">
                  {currentOrder?.orderType.replace('_', ' ') || 'Select type'}
                </span>
              </div>
            )}
            {savedOrderId && (
              <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                Open
              </span>
            )}
          </div>
          {!savedOrderId && (
            <div className="flex items-center gap-2 mt-2">
              <Button
                variant={currentOrder?.orderType === 'dine_in' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => startOrder('dine_in')}
              >
                Table
              </Button>
              <Button
                variant={currentOrder?.orderType === 'bar_tab' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => startOrder('bar_tab')}
              >
                Quick Tab
              </Button>
              <Button
                variant={currentOrder?.orderType === 'takeout' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => startOrder('takeout')}
              >
                Takeout
              </Button>
            </div>
          )}
        </div>

        {/* Order Items */}
        <div className="flex-1 overflow-y-auto p-4">
          {currentOrder?.items.length === 0 ? (
            currentOrder?.total && currentOrder.total > 0 ? (
              // Split order with no items - show split info
              <div className="text-center py-8">
                <div className="bg-blue-50 rounded-lg p-4 mb-4">
                  <p className="text-blue-800 font-semibold text-lg">Split Check</p>
                  <p className="text-blue-600 text-sm">Order #{currentOrder.orderNumber}</p>
                </div>
                <p className="text-2xl font-bold text-gray-800">{formatCurrency(currentOrder.total)}</p>
                <p className="text-sm text-gray-500 mt-2">This is a split portion of the original order</p>
              </div>
            ) : (
              <div className="text-center text-gray-400 py-8">
                <p>No items yet</p>
                <p className="text-sm">Tap menu items to add</p>
              </div>
            )
          ) : (
            <div className="space-y-2">
              {currentOrder?.items.map(item => {
                // Group modifiers by depth for hierarchical display
                const topLevelMods = item.modifiers.filter(m => !m.depth || m.depth === 0)
                const childMods = item.modifiers.filter(m => m.depth && m.depth > 0)
                const hasModifiers = item.modifiers.length > 0
                const menuItemInfo = menuItems.find(m => m.id === item.menuItemId)
                const canEdit = menuItemInfo?.modifierGroupCount && menuItemInfo.modifierGroupCount > 0

                return (
                  <Card key={item.id} className={`p-3 ${item.sentToKitchen ? 'bg-gray-50 border-l-4 border-l-green-500' : ''}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          {/* Sent indicator */}
                          {item.sentToKitchen ? (
                            <div className="flex items-center gap-1">
                              <span className="text-green-600" title="Sent to kitchen">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              </span>
                              <span className="w-6 text-center font-medium text-gray-500">{item.quantity}</span>
                              {/* Printer icon to resend */}
                              <button
                                className="w-5 h-5 text-gray-400 hover:text-blue-600"
                                onClick={() => handleResendItem(item.id, item.name)}
                                title="Resend to kitchen"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                </svg>
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <button
                                className="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600"
                                onClick={() => updateQuantity(item.id, item.quantity - 1)}
                              >
                                -
                              </button>
                              <span className="w-6 text-center font-medium">{item.quantity}</span>
                              <button
                                className="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600"
                                onClick={() => updateQuantity(item.id, item.quantity + 1)}
                              >
                                +
                              </button>
                            </div>
                          )}
                          <button
                            className={`font-medium text-left ${item.sentToKitchen ? 'text-gray-600' : ''} ${canEdit && !item.sentToKitchen ? 'hover:text-blue-600 cursor-pointer' : ''}`}
                            onClick={() => canEdit && !item.sentToKitchen && handleEditOrderItem(item)}
                            disabled={!canEdit || item.sentToKitchen}
                          >
                            {item.name}
                            {/* Inline badges for seat/course/hold */}
                            <ItemBadges
                              seatNumber={item.seatNumber}
                              courseNumber={item.courseNumber}
                              courseStatus={item.courseStatus}
                              isHeld={item.isHeld}
                            />
                            {item.sentToKitchen && !item.isCompleted && !item.isHeld && (
                              <span className="ml-2 text-xs text-green-600 font-normal">Sent</span>
                            )}
                            {item.isCompleted && (
                              <span className="ml-2 px-1.5 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded">
                                ✓ MADE
                                {item.completedAt && (
                                  <span className="ml-1 text-green-600">
                                    {new Date(item.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                )}
                              </span>
                            )}
                            {canEdit && !item.sentToKitchen && (
                              <svg className="w-3 h-3 inline ml-1 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            )}
                          </button>
                        </div>
                        {/* Display modifiers with hierarchy */}
                        {hasModifiers && (
                          <div
                            className={`ml-[72px] mt-1 ${canEdit ? 'cursor-pointer' : ''}`}
                            onClick={() => canEdit && handleEditOrderItem(item)}
                          >
                            {/* Top-level modifiers */}
                            {topLevelMods.map((mod, idx) => (
                              <div key={mod.id || idx} className="text-sm text-gray-600">
                                • {mod.name}{mod.price > 0 && <span className="text-green-600 ml-1">+{formatCurrency(mod.price)}</span>}
                              </div>
                            ))}
                            {/* Child modifiers (indented) */}
                            {childMods.map((mod, idx) => (
                              <div
                                key={mod.id || `child-${idx}`}
                                className="text-sm text-gray-500"
                                style={{ marginLeft: `${(mod.depth || 1) * 12}px` }}
                              >
                                └ {mod.name}{mod.price > 0 && <span className="text-green-600 ml-1">+{formatCurrency(mod.price)}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                        {item.specialNotes && (
                          <div className="text-sm text-orange-600 ml-[72px]">
                            Note: {item.specialNotes}
                          </div>
                        )}
                        {/* Seat/Course/Hold Controls */}
                        {savedOrderId && (
                          <SeatCourseHoldControls
                            orderId={savedOrderId}
                            itemId={item.id}
                            itemName={item.name}
                            seatNumber={item.seatNumber}
                            courseNumber={item.courseNumber}
                            courseStatus={item.courseStatus}
                            isHeld={item.isHeld}
                            holdUntil={item.holdUntil}
                            firedAt={item.firedAt}
                            sentToKitchen={item.sentToKitchen}
                            guestCount={currentOrder?.guestCount || 4}
                            onUpdate={(updates) => {
                              updateItem(item.id, updates)
                            }}
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {formatCurrency((item.price + item.modifiers.reduce((sum, m) => sum + m.price, 0)) * item.quantity)}
                        </span>
                        {/* Notes button */}
                        {!item.sentToKitchen && (
                          <button
                            className={`p-1 ${item.specialNotes ? 'text-orange-500 hover:text-orange-700' : 'text-gray-400 hover:text-gray-600'}`}
                            onClick={() => handleOpenNotesEditor(item.id, item.specialNotes)}
                            title={item.specialNotes ? 'Edit note' : 'Add note'}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                            </svg>
                          </button>
                        )}
                        {/* Comp/Void button for sent items */}
                        {item.sentToKitchen && (
                          <button
                            className="text-orange-500 hover:text-orange-700 p-1"
                            onClick={() => handleOpenCompVoid(item)}
                            title="Comp or Void"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                        )}
                        {/* Delete button (only for unsent items) */}
                        {!item.sentToKitchen && (
                          <button
                            className="text-red-500 hover:text-red-700 p-1"
                            onClick={() => removeItem(item.id)}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}

        </div>

        {/* Course Manager Panel */}
        {savedOrderId && currentOrder && (
          <CourseOverviewPanel
            orderId={savedOrderId}
            onCourseUpdate={() => {
              // Refresh the order to get updated course statuses
              if (savedOrderId) {
                fetch(`/api/orders/${savedOrderId}`)
                  .then(res => res.json())
                  .then(data => {
                    if (data.items) {
                      // Update items in the store with new course statuses
                      data.items.forEach((item: { id: string; courseStatus?: string; isHeld?: boolean; firedAt?: string }) => {
                        updateItem(item.id, {
                          courseStatus: item.courseStatus as 'pending' | 'fired' | 'ready' | 'served' | undefined,
                          isHeld: item.isHeld,
                          firedAt: item.firedAt,
                        })
                      })
                    }
                  })
                  .catch(console.error)
              }
            }}
          />
        )}

        {/* Payment Method Toggle with Totals */}
        {dualPricing.enabled && (
          <div className="border-t p-3 bg-gray-50">
            {(() => {
              // Calculate both totals for display on buttons
              const storedSubtotal = currentOrder?.subtotal || 0
              const discountPct = dualPricing.cashDiscountPercent || 4.0
              const cardSubtotal = calculateCardPrice(storedSubtotal, discountPct)
              const discount = currentOrder?.discountTotal || 0

              // Card total calculation
              const cardTaxableAmount = cardSubtotal - discount
              const cardTax = cardTaxableAmount * taxRate
              const cardUnroundedTotal = cardTaxableAmount + cardTax
              const cardTotal = applyPriceRounding(cardUnroundedTotal, priceRounding, 'card')

              // Cash total calculation (with cash discount)
              const cashDiscountAmount = cardSubtotal - storedSubtotal
              const cashTaxableAmount = cardSubtotal - cashDiscountAmount - discount
              const cashTax = cashTaxableAmount * taxRate
              const cashUnroundedTotal = cashTaxableAmount + cashTax
              const cashTotal = applyPriceRounding(cashUnroundedTotal, priceRounding, 'cash')

              return (
                <div className="flex gap-2">
                  <Button
                    variant={paymentMethod === 'cash' ? 'primary' : 'ghost'}
                    size="sm"
                    className={`flex-1 flex-col py-2 h-auto ${paymentMethod === 'cash' ? 'bg-green-600 hover:bg-green-700' : ''}`}
                    onClick={() => setPaymentMethod('cash')}
                  >
                    <div className="flex items-center">
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      Cash
                    </div>
                    <div className={`text-sm font-bold ${paymentMethod === 'cash' ? 'text-white' : 'text-green-600'}`}>
                      {formatCurrency(cashTotal)}
                    </div>
                  </Button>
                  <Button
                    variant={paymentMethod === 'card' ? 'primary' : 'ghost'}
                    size="sm"
                    className="flex-1 flex-col py-2 h-auto"
                    onClick={() => setPaymentMethod('card')}
                  >
                    <div className="flex items-center">
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                      </svg>
                      Card
                    </div>
                    <div className={`text-sm font-bold ${paymentMethod === 'card' ? 'text-white' : 'text-blue-600'}`}>
                      {formatCurrency(cardTotal)}
                    </div>
                  </Button>
                </div>
              )
            })()}
          </div>
        )}

        {/* Order Totals - Card price is displayed, cash gets discount */}
        <div className="border-t p-4 space-y-2">
          {(() => {
            const storedSubtotal = currentOrder?.subtotal || 0  // Stored as cash price
            const discountPct = dualPricing.cashDiscountPercent || 4.0
            // Convert to card price for display
            const cardSubtotal = dualPricing.enabled
              ? calculateCardPrice(storedSubtotal, discountPct)
              : storedSubtotal
            // Cash discount brings it back to original price
            const cashDiscountAmount = dualPricing.enabled && paymentMethod === 'cash'
              ? cardSubtotal - storedSubtotal
              : 0
            const discount = currentOrder?.discountTotal || 0
            const taxableAmount = cardSubtotal - cashDiscountAmount - discount
            const tax = taxableAmount * taxRate
            const gratuity = currentOrder?.tipTotal || 0
            const unroundedTotal = taxableAmount + tax + gratuity
            // Apply price rounding if enabled
            const total = applyPriceRounding(unroundedTotal, priceRounding, paymentMethod)
            const roundingAdjustment = total - unroundedTotal

            return (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Subtotal</span>
                  <span>{formatCurrency(cardSubtotal)}</span>
                </div>
                {dualPricing.enabled && paymentMethod === 'cash' && cashDiscountAmount > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Cash Discount ({discountPct}%)</span>
                    <span>-{formatCurrency(cashDiscountAmount)}</span>
                  </div>
                )}
                {discount > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Discount</span>
                    <span>-{formatCurrency(discount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Tax ({(taxRate * 100).toFixed(1)}%)</span>
                  <span>{formatCurrency(tax)}</span>
                </div>
                {(currentOrder?.tipTotal || 0) > 0 && (
                  <div className="flex justify-between text-sm text-blue-600">
                    <span>Gratuity</span>
                    <span>{formatCurrency(currentOrder?.tipTotal || 0)}</span>
                  </div>
                )}
                {priceRounding.enabled && Math.abs(roundingAdjustment) > 0.001 && (
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>Rounding</span>
                    <span>{roundingAdjustment >= 0 ? '+' : ''}{formatCurrency(roundingAdjustment)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-lg pt-2 border-t">
                  <span>Total</span>
                  <span className={paymentMethod === 'cash' && dualPricing.enabled ? 'text-green-600' : ''}>
                    {formatCurrency(total)}
                  </span>
                </div>
                {dualPricing.enabled && dualPricing.showSavingsMessage && paymentMethod === 'cash' && storedSubtotal > 0 && (
                  <div className="text-xs text-green-600 text-center">
                    You save {formatCurrency(cashDiscountAmount)} by paying with cash!
                  </div>
                )}
              </>
            )
          })()}
        </div>

        {/* Action Buttons */}
        <div className="p-4 border-t space-y-2">
          {(() => {
            const newItemCount = currentOrder?.items.filter(i => !i.sentToKitchen).length || 0
            const hasNewItems = newItemCount > 0
            const isExistingOrder = !!savedOrderId

            return (
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                disabled={!currentOrder?.items.length || isSendingOrder || (isExistingOrder && !hasNewItems)}
                onClick={handleSendToKitchen}
              >
                {isSendingOrder ? 'Sending...' :
                  isExistingOrder ?
                    (hasNewItems ? `Send ${newItemCount} New Item${newItemCount > 1 ? 's' : ''} to Kitchen` : 'No New Items')
                    : 'Send to Kitchen'}
              </Button>
            )
          })()}
          <div className="grid grid-cols-5 gap-2">
            <Button
              variant="outline"
              size="md"
              disabled={!currentOrder?.items.length}
              onClick={handleOpenDiscount}
              className="text-sm"
            >
              Disc
            </Button>
            <Button
              variant="outline"
              size="md"
              disabled={!currentOrder?.items.length || !savedOrderId}
              onClick={() => setShowItemTransferModal(true)}
              className="text-sm"
            >
              Move
            </Button>
            <Button
              variant="outline"
              size="md"
              disabled={!currentOrder?.items.length || !savedOrderId}
              onClick={handleOpenSplitTicket}
              className="text-sm"
              title="Split order into separate tickets"
            >
              Split
            </Button>
            <Button
              variant="outline"
              size="md"
              disabled={!currentOrder?.items.length && !(currentOrder?.total && currentOrder.total > 0)}
              onClick={handleOpenPayment}
            >
              Pay
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => {
                clearOrder()
                setSavedOrderId(null)
                setOrderSent(false)
                setAppliedDiscounts([])
              }}
              disabled={!currentOrder?.items.length}
            >
              Clear
            </Button>
          </div>
        </div>
      </div>

      {/* Click outside to close menu */}
      {showMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowMenu(false)}
        />
      )}

      {/* Modifier Selection Modal */}
      {showModifierModal && selectedItem && (
        <ModifierModal
          item={selectedItem}
          modifierGroups={itemModifierGroups}
          loading={loadingModifiers}
          editingItem={editingOrderItem}
          dualPricing={dualPricing}
          initialNotes={editingOrderItem?.specialNotes}
          onConfirm={editingOrderItem ? handleUpdateItemWithModifiers : handleAddItemWithModifiers}
          onCancel={() => {
            setShowModifierModal(false)
            setSelectedItem(null)
            setItemModifierGroups([])
            setEditingOrderItem(null)
          }}
        />
      )}

      {/* Combo Selection Modal */}
      {showComboModal && selectedComboItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden">
            <div className="p-4 border-b bg-orange-50">
              <h2 className="text-lg font-bold text-orange-800">{selectedComboItem.name}</h2>
              <p className="text-sm text-orange-600">
                {comboTemplate?.comparePrice && (
                  <span className="line-through mr-2">{formatCurrency(comboTemplate.comparePrice)}</span>
                )}
                <span className="font-bold">{formatCurrency(comboTemplate?.basePrice || selectedComboItem.price)}</span>
                {comboTemplate?.comparePrice && (
                  <span className="ml-2 text-green-600">
                    Save {formatCurrency(comboTemplate.comparePrice - (comboTemplate?.basePrice || 0))}!
                  </span>
                )}
              </p>
            </div>
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              {!comboTemplate ? (
                <p className="text-gray-500 text-center py-8">Loading combo options...</p>
              ) : comboTemplate.components.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No customization options</p>
              ) : (
                <div className="space-y-6">
                  {comboTemplate.components.map(component => {
                    // New structure: component has menuItem with modifierGroups
                    if (component.menuItem) {
                      return (
                        <div key={component.id} className="border rounded-lg p-3 bg-gray-50">
                          <h3 className="font-semibold text-gray-800 mb-3 flex items-center">
                            <span className="bg-orange-500 text-white px-2 py-0.5 rounded text-sm mr-2">
                              {component.displayName}
                            </span>
                            {component.itemPriceOverride !== null && component.itemPriceOverride !== undefined && (
                              <span className="text-sm font-normal text-green-600">
                                (Included)
                              </span>
                            )}
                          </h3>

                          {/* Show modifier groups for this item */}
                          {component.menuItem.modifierGroups && component.menuItem.modifierGroups.length > 0 ? (
                            <div className="space-y-4">
                              {component.menuItem.modifierGroups.map(mg => {
                                const group = mg.modifierGroup
                                const componentSelections = comboSelections[component.id] || {}
                                const groupSelections = componentSelections[group.id] || []

                                return (
                                  <div key={group.id}>
                                    <p className="text-sm text-gray-600 mb-2">
                                      {group.displayName || group.name}
                                      {group.isRequired && <span className="text-red-500 ml-1">*</span>}
                                      {group.maxSelections > 1 && (
                                        <span className="text-xs text-gray-400 ml-1">
                                          (up to {group.maxSelections})
                                        </span>
                                      )}
                                    </p>
                                    <div className="grid grid-cols-2 gap-2">
                                      {group.modifiers.map(mod => {
                                        const isSelected = groupSelections.includes(mod.id)
                                        // In combos, modifiers are included ($0) unless explicitly set as upcharge
                                        const overridePrice = component.modifierPriceOverrides?.[mod.id]
                                        const displayPrice = overridePrice !== undefined ? overridePrice : 0

                                        return (
                                          <button
                                            key={mod.id}
                                            onClick={() => {
                                              setComboSelections(prev => {
                                                const compSelections = prev[component.id] || {}
                                                const current = compSelections[group.id] || []

                                                let newGroupSelections: string[]
                                                if (isSelected) {
                                                  newGroupSelections = current.filter(id => id !== mod.id)
                                                } else if (group.maxSelections === 1) {
                                                  newGroupSelections = [mod.id]
                                                } else if (current.length < group.maxSelections) {
                                                  newGroupSelections = [...current, mod.id]
                                                } else {
                                                  return prev
                                                }

                                                return {
                                                  ...prev,
                                                  [component.id]: {
                                                    ...compSelections,
                                                    [group.id]: newGroupSelections,
                                                  },
                                                }
                                              })
                                            }}
                                            className={`p-2 rounded border-2 text-left text-sm transition-colors ${
                                              isSelected
                                                ? 'border-orange-500 bg-orange-50'
                                                : 'border-gray-200 hover:border-gray-300 bg-white'
                                            }`}
                                          >
                                            <span className="font-medium">{mod.name}</span>
                                            {displayPrice > 0 && (
                                              <span className="text-green-600 text-xs ml-1">
                                                +{formatCurrency(displayPrice)}
                                              </span>
                                            )}
                                          </button>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-400 italic">No modifiers for this item</p>
                          )}
                        </div>
                      )
                    }

                    // Legacy: use options array
                    if (component.options && component.options.length > 0) {
                      return (
                        <div key={component.id}>
                          <h3 className="font-semibold text-gray-800 mb-2">
                            {component.displayName}
                            {component.isRequired && <span className="text-red-500 ml-1">*</span>}
                          </h3>
                          <div className="grid grid-cols-2 gap-2">
                            {component.options.map(option => {
                              const legacySelections = (comboSelections[component.id] as unknown as string[]) || []
                              const isSelected = legacySelections.includes(option.id)
                              return (
                                <button
                                  key={option.id}
                                  onClick={() => {
                                    setComboSelections(prev => {
                                      const current = (prev[component.id] as unknown as string[]) || []
                                      let newSelections: string[]
                                      if (isSelected) {
                                        newSelections = current.filter(id => id !== option.id)
                                      } else if (component.maxSelections === 1) {
                                        newSelections = [option.id]
                                      } else if (current.length < component.maxSelections) {
                                        newSelections = [...current, option.id]
                                      } else {
                                        return prev
                                      }
                                      return { ...prev, [component.id]: newSelections as unknown as Record<string, string[]> }
                                    })
                                  }}
                                  className={`p-3 rounded-lg border-2 text-left transition-colors ${
                                    isSelected
                                      ? 'border-orange-500 bg-orange-50'
                                      : 'border-gray-200 hover:border-gray-300'
                                  }`}
                                >
                                  <span className="font-medium">{option.name}</span>
                                  {option.upcharge > 0 && (
                                    <span className="text-green-600 text-sm ml-1">+{formatCurrency(option.upcharge)}</span>
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    }

                    return null
                  })}
                </div>
              )}
            </div>
            <div className="p-4 border-t bg-gray-50 flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setShowComboModal(false)
                  setSelectedComboItem(null)
                  setComboTemplate(null)
                  setComboSelections({})
                }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddComboToOrder}
                className="flex-1 bg-orange-500 hover:bg-orange-600"
              >
                Add to Order
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Timed Rental Modal */}
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
                  {/* Show available rates from timedPricing, or fallback to base price */}
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
                  {/* Fallback: If no timedPricing rates, show base price per hour */}
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

      {/* Entertainment Waitlist Modal */}
      {showWaitlistModal && waitlistMenuItem && (
        <AddToWaitlistModal
          isOpen={showWaitlistModal}
          onClose={() => {
            setShowWaitlistModal(false)
            setWaitlistMenuItem(null)
          }}
          locationId={employee?.location?.id}
          employeeId={employee?.id}
          menuItemId={waitlistMenuItem.id}
          menuItemName={waitlistMenuItem.name}
          onSuccess={() => {
            // Optionally refresh menu or show success message
          }}
        />
      )}

      {/* Open Orders Panel Slide-out */}
      {showTabsPanel && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setShowTabsPanel(false)}
          />
          <div className="fixed left-0 top-0 bottom-0 w-80 bg-white shadow-xl z-50">
            <OpenOrdersPanel
              locationId={employee?.location?.id}
              employeeId={employee?.id}
              onSelectOrder={handleSelectOpenOrder}
              onNewTab={handleNewTab}
              refreshTrigger={tabsRefreshTrigger}
              onViewReceipt={(orderId) => {
                setReceiptOrderId(orderId)
                setShowReceiptModal(true)
              }}
            />
          </div>
        </>
      )}

      {/* New Tab Modal */}
      <NewTabModal
        isOpen={showNewTabModal}
        onClose={() => setShowNewTabModal(false)}
        onCreateTab={handleCreateTab}
        employeeId={employee?.id || ''}
        defaultPreAuthAmount={paymentSettings.defaultPreAuthAmount}
      />

      {/* Tab Detail Modal */}
      <TabDetailModal
        isOpen={showTabDetailModal}
        onClose={() => {
          setShowTabDetailModal(false)
          setSelectedTabId(null)
        }}
        tabId={selectedTabId}
        onAddItems={handleAddItemsToTab}
        onPayTab={handlePayTab}
        onTransferTab={(tabId) => {
          setShowTabDetailModal(false)
          handleTransferTab(tabId)
        }}
      />

      {/* Tab Transfer Modal */}
      <TabTransferModal
        isOpen={showTabTransferModal}
        onClose={() => {
          setShowTabTransferModal(false)
          setSelectedTabId(null)
          setSelectedTabName(null)
        }}
        tabId={selectedTabId || ''}
        tabName={selectedTabName}
        currentEmployeeId={employee?.id || ''}
        locationId={employee?.location?.id || ''}
        onTransferComplete={handleTabTransferComplete}
      />

      {/* Quick Notes Modal */}
      {editingNotesItemId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="p-4 border-b bg-gray-50">
              <h2 className="text-lg font-bold">Special Instructions</h2>
              <p className="text-sm text-gray-500">Add notes for the kitchen</p>
            </div>
            <div className="p-4">
              <textarea
                value={editingNotesText}
                onChange={(e) => setEditingNotesText(e.target.value)}
                placeholder="E.g., no onions, extra sauce, allergy info..."
                className="w-full p-3 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={3}
                maxLength={200}
                autoFocus
              />
              <div className="text-xs text-gray-400 text-right mt-1">
                {editingNotesText.length}/200
              </div>
            </div>
            <div className="p-4 border-t bg-gray-50 flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setEditingNotesItemId(null)
                  setEditingNotesText('')
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={handleSaveNotes}
              >
                Save Note
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && (
        <PaymentModal
          isOpen={showPaymentModal}
          onClose={() => {
            setShowPaymentModal(false)
            setOrderToPayId(null)
            setSplitPaymentAmount(null)
            setEvenSplitAmounts(null)
            setCurrentSplitIndex(0)
          }}
          orderId={orderToPayId}
          orderTotal={(() => {
            // If we have a split payment amount, use that
            if (splitPaymentAmount !== null) {
              return splitPaymentAmount
            }
            // For split orders (no items but has total), use the stored total
            if (currentOrder && currentOrder.items.length === 0 && currentOrder.total > 0) {
              return currentOrder.total
            }
            const storedSubtotal = currentOrder?.subtotal || 0  // Stored as cash price
            const discountPct = dualPricing.cashDiscountPercent || 4.0
            const cardSubtotal = dualPricing.enabled ? calculateCardPrice(storedSubtotal, discountPct) : storedSubtotal
            const cashDiscountAmount = dualPricing.enabled && paymentMethod === 'cash' ? cardSubtotal - storedSubtotal : 0
            const discount = currentOrder?.discountTotal || 0
            const taxableAmount = cardSubtotal - cashDiscountAmount - discount
            const tax = taxableAmount * taxRate
            return taxableAmount + tax
          })()}
          remainingBalance={(() => {
            if (splitPaymentAmount !== null) {
              return splitPaymentAmount
            }
            const storedSubtotal = currentOrder?.subtotal || 0  // Stored as cash price
            const discountPct = dualPricing.cashDiscountPercent || 4.0
            const cardSubtotal = dualPricing.enabled ? calculateCardPrice(storedSubtotal, discountPct) : storedSubtotal
            const cashDiscountAmount = dualPricing.enabled && paymentMethod === 'cash' ? cardSubtotal - storedSubtotal : 0
            const discount = currentOrder?.discountTotal || 0
            const taxableAmount = cardSubtotal - cashDiscountAmount - discount
            const tax = taxableAmount * taxRate
            return taxableAmount + tax
          })()}
          dualPricing={dualPricing}
          paymentSettings={paymentSettings}
          onPaymentComplete={handlePaymentComplete}
        />
      )}

      {/* Order Settings Modal */}
      {showOrderSettingsModal && savedOrderId && currentOrder && (
        <OrderSettingsModal
          isOpen={showOrderSettingsModal}
          onClose={() => setShowOrderSettingsModal(false)}
          orderId={savedOrderId}
          currentTabName={currentOrder.tabName || ''}
          currentGuestCount={currentOrder.guestCount}
          currentTipTotal={currentOrder.tipTotal || 0}
          currentSeparateChecks={false}
          orderTotal={currentOrder.subtotal || 0}
          onSave={handleOrderSettingsSave}
        />
      )}

      {/* Split Check Modal */}
      {showSplitModal && currentOrder && savedOrderId && (
        <SplitCheckModal
          isOpen={showSplitModal}
          onClose={() => {
            setShowSplitModal(false)
          }}
          orderId={savedOrderId}
          orderNumber={currentOrder.orderNumber || 0}
          orderTotal={(() => {
            const subtotal = currentOrder.subtotal || 0
            const tax = subtotal * taxRate
            return subtotal + tax
          })()}
          paidAmount={0}
          items={currentOrder.items.map(item => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            itemTotal: (item.price + item.modifiers.reduce((sum, m) => sum + m.price, 0)) * item.quantity,
            modifiers: item.modifiers.map(m => ({ name: m.name, price: m.price })),
          }))}
          onSplitComplete={handleSplitComplete}
          onNavigateToSplit={handleNavigateToSplit}
        />
      )}

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
      {showCompVoidModal && savedOrderId && compVoidItem && employee && (
        <CompVoidModal
          isOpen={showCompVoidModal}
          onClose={() => {
            setShowCompVoidModal(false)
            setCompVoidItem(null)
          }}
          orderId={savedOrderId}
          item={compVoidItem}
          employeeId={employee.id}
          onComplete={handleCompVoidComplete}
        />
      )}

      {/* Item Transfer Modal */}
      {showItemTransferModal && savedOrderId && employee && (
        <ItemTransferModal
          isOpen={showItemTransferModal}
          onClose={() => setShowItemTransferModal(false)}
          currentOrderId={savedOrderId}
          items={currentOrder?.items.map((item) => ({
            id: item.id,
            tempId: item.id, // Use id as tempId for compatibility
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
            // Reload the order from the database to get updated items
            try {
              const response = await fetch(`/api/orders/${savedOrderId}`)
              if (response.ok) {
                const orderData = await response.json()
                loadOrder({
                  id: orderData.id,
                  orderNumber: orderData.orderNumber,
                  orderType: orderData.orderType,
                  tableId: orderData.tableId || undefined,
                  tabName: orderData.tabName || undefined,
                  guestCount: orderData.guestCount,
                  items: orderData.items,
                  subtotal: orderData.subtotal,
                  taxTotal: orderData.taxTotal,
                  total: orderData.total,
                  notes: orderData.notes,
                })
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
              name: mod.name,
              price: mod.price,
            })),
          }))}
          orderDiscount={appliedDiscounts.reduce((sum, d) => sum + d.amount, 0)}
          taxRate={taxRate}
          roundTo={priceRounding.enabled ? priceRounding.increment : 'none'}
          onSplitComplete={handleSplitTicketComplete}
        />
      )}

      {/* Time Clock Modal */}
      <TimeClockModal
        isOpen={showTimeClockModal}
        onClose={() => setShowTimeClockModal(false)}
        employeeId={employee?.id || ''}
        employeeName={employee?.displayName || `${employee?.firstName} ${employee?.lastName}` || ''}
        locationId={employee?.location?.id || ''}
      />

      {/* Shift Start Modal */}
      <ShiftStartModal
        isOpen={showShiftStartModal}
        onClose={() => setShowShiftStartModal(false)}
        employeeId={employee?.id || ''}
        employeeName={employee?.displayName || `${employee?.firstName} ${employee?.lastName}` || ''}
        locationId={employee?.location?.id || ''}
        onShiftStarted={(shiftId) => {
          // Fetch the shift data
          fetch(`/api/shifts/${shiftId}`)
            .then(res => res.json())
            .then(data => {
              setCurrentShift({
                id: data.shift.id,
                startedAt: data.shift.startedAt,
                startingCash: data.shift.startingCash,
                employee: data.shift.employee,
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
            // Optionally log out or redirect
          }}
        />
      )}

      {/* Receipt Modal */}
      <ReceiptModal
        isOpen={showReceiptModal}
        onClose={handleReceiptClose}
        orderId={receiptOrderId}
        locationId={employee?.location?.id || ''}
        receiptSettings={receiptSettings}
      />
    </div>
  )
}
