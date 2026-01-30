'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useOrderStore } from '@/stores/order-store'
import { useDevStore } from '@/stores/dev-store'
import { useOrderSettings } from '@/hooks/useOrderSettings'
import { usePOSDisplay } from '@/hooks/usePOSDisplay'
import { usePOSLayout } from '@/hooks/usePOSLayout'
import { POSDisplaySettingsModal } from '@/components/orders/POSDisplaySettings'
import { ModeToggle } from '@/components/pos/ModeToggle'
import { SortableCategoryButton } from '@/components/pos/SortableCategoryButton'
import { FavoritesBar } from '@/components/pos/FavoritesBar'
import { CategoryColorPicker } from '@/components/pos/CategoryColorPicker'
import { MenuItemColorPicker } from '@/components/pos/MenuItemColorPicker'
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
import { OrderTypeSelector, OrderTypeBadge } from '@/components/orders/OrderTypeSelector'
import type { OrderTypeConfig, OrderCustomFields, WorkflowRules } from '@/types/order-types'
import { EntertainmentSessionControls } from '@/components/orders/EntertainmentSessionControls'
import { CourseOverviewPanel } from '@/components/orders/CourseOverviewPanel'
import { ModifierModal } from '@/components/modifiers/ModifierModal'
import { PizzaBuilderModal } from '@/components/pizza/PizzaBuilderModal'
import { AddToWaitlistModal } from '@/components/entertainment/AddToWaitlistModal'
import { OrderSettingsModal } from '@/components/orders/OrderSettingsModal'
import { AdminNav } from '@/components/admin/AdminNav'
import { TablePickerModal } from '@/components/orders/TablePickerModal'
import { FloorPlanHome } from '@/components/floor-plan'
import type { Category, MenuItem, ModifierGroup, SelectedModifier, PizzaOrderConfig } from '@/types'

export default function OrdersPage() {
  const router = useRouter()
  const { employee, isAuthenticated, logout } = useAuthStore()
  const { currentOrder, startOrder, updateOrderType, loadOrder, addItem, updateItem, removeItem, updateQuantity, clearOrder } = useOrderStore()
  const { hasDevAccess, setHasDevAccess } = useDevStore()
  const [categories, setCategories] = useState<Category[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showMenu, setShowMenu] = useState(false)
  const [showAdminNav, setShowAdminNav] = useState(false)
  const [showTablePicker, setShowTablePicker] = useState(false)
  const [showTotalBreakdown, setShowTotalBreakdown] = useState(false)

  // Floor Plan integration (T019)
  // viewMode: 'floor-plan' = default HOME view, 'order-entry' = traditional POS screen
  const isBartender = employee?.role?.name?.toLowerCase() === 'bartender'
  const [viewMode, setViewMode] = useState<'floor-plan' | 'order-entry'>(isBartender ? 'order-entry' : 'floor-plan')

  // Check if user has admin/manager permissions
  // Handle both array permissions (new format) and role name check
  const permissionsArray = Array.isArray(employee?.permissions) ? employee.permissions : []
  const isManager = employee?.role?.name && ['Manager', 'Owner', 'Admin'].includes(employee.role.name) ||
    permissionsArray.some(p => ['admin', 'manage_menu', 'manage_employees'].includes(p))

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
    pizzaConfig?: PizzaOrderConfig
  } | null>(null)

  // Pizza builder state
  const [showPizzaModal, setShowPizzaModal] = useState(false)
  const [selectedPizzaItem, setSelectedPizzaItem] = useState<MenuItem | null>(null)
  const [editingPizzaItem, setEditingPizzaItem] = useState<{
    id: string
    pizzaConfig?: PizzaOrderConfig
  } | null>(null)

  // Settings loaded from API via custom hook
  const { dualPricing, paymentSettings, priceRounding, taxRate, receiptSettings } = useOrderSettings()
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
  } = usePOSLayout({
    employeeId: employee?.id,
    locationId: employee?.location?.id,
    permissions: hasLayoutPermission ? { posLayout: ['customize_personal'] } : undefined,
  })

  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash')

  // Display settings modal
  const [showDisplaySettings, setShowDisplaySettings] = useState(false)
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false)
  const [isEditingFavorites, setIsEditingFavorites] = useState(false)
  const [isEditingMenuItems, setIsEditingMenuItems] = useState(false)

  // Category color picker state
  const [colorPickerCategory, setColorPickerCategory] = useState<Category | null>(null)

  // Menu item color picker state
  const [colorPickerMenuItem, setColorPickerMenuItem] = useState<MenuItem | null>(null)

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

  // Resend modal state (replaces blocking prompt/alert)
  const [resendModal, setResendModal] = useState<{ itemId: string; itemName: string } | null>(null)
  const [resendNote, setResendNote] = useState('')
  const [resendLoading, setResendLoading] = useState(false)
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

  // Load menu with cache-busting
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
        if (data.categories.length > 0 && !selectedCategory) {
          setSelectedCategory(data.categories[0].id)
        }
      }
    } catch (error) {
      console.error('Failed to load menu:', error)
    } finally {
      setIsLoading(false)
    }
  }, [employee?.location?.id, selectedCategory])

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

  // Auto-refresh menu when viewing Entertainment category (for real-time status)
  const selectedCategoryData = categories.find(c => c.id === selectedCategory)
  useEffect(() => {
    if (selectedCategoryData?.categoryType !== 'entertainment') return

    // Poll every 3 seconds for entertainment status changes
    const interval = setInterval(() => {
      loadMenu()
    }, 3000)

    // Also refresh on visibility/focus changes
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadMenu()
      }
    }
    const handleFocus = () => loadMenu()

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
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

  const handleLogout = () => {
    clearOrder()
    setHasDevAccess(false)  // Clear dev access on logout
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
                depth: mod.depth || 0,
              })),
              ingredientModifications: item.ingredientModifications?.map(ing => ({
                ingredientId: ing.ingredientId,
                name: ing.name,
                modificationType: ing.modificationType,
                priceAdjustment: ing.priceAdjustment,
                swappedTo: ing.swappedTo,
              })),
              specialNotes: item.specialNotes,
              pizzaConfig: item.pizzaConfig, // Include pizza configuration
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
          orderTypeId: currentOrder.orderTypeId,
          tableId: currentOrder.tableId,
          tabName: currentOrder.tabName || currentOrder.tableName,
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
              depth: mod.depth || 0,
            })),
            ingredientModifications: item.ingredientModifications?.map(ing => ({
              ingredientId: ing.ingredientId,
              name: ing.name,
              modificationType: ing.modificationType,
              priceAdjustment: ing.priceAdjustment,
              swappedTo: ing.swappedTo,
            })),
            specialNotes: item.specialNotes,
            pizzaConfig: item.pizzaConfig, // Include pizza configuration
          })),
          notes: currentOrder.notes,
          customFields: currentOrder.customFields || orderCustomFields,
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

  // Handle order type selection
  const handleOrderTypeSelect = (orderType: OrderTypeConfig, customFields?: OrderCustomFields) => {
    setSelectedOrderType(orderType)
    if (customFields) {
      setOrderCustomFields(customFields)
    }

    // If order type requires table selection, open table picker
    const workflowRules = (orderType.workflowRules || {}) as WorkflowRules
    if (workflowRules.requireTableSelection) {
      setShowTablePicker(true)
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

    // Check table selection requirement
    if (workflowRules.requireTableSelection && !currentOrder.tableId) {
      return { valid: false, message: 'Please select a table before sending to kitchen' }
    }

    // Check customer name requirement
    if (workflowRules.requireCustomerName && !currentOrder.tabName && !orderCustomFields.customerName) {
      return { valid: false, message: 'Please enter a customer name before sending to kitchen' }
    }

    // Check payment requirement (for takeout/delivery)
    if (workflowRules.requirePaymentBeforeSend) {
      // This would check if payment has been made
      // For now, we'll prompt user to pay first
      return { valid: false, message: 'Payment is required before sending this order type to kitchen. Please collect payment first.' }
    }

    return { valid: true }
  }

  // Send to Kitchen handler
  const handleSendToKitchen = async () => {
    if (!currentOrder?.items.length) return

    // Validate based on workflow rules
    const validation = validateBeforeSend()
    if (!validation.valid) {
      alert(validation.message)
      // If payment is required, open payment modal
      const orderTypeConfig = orderTypes.find(t => t.slug === currentOrder.orderType)
      const workflowRules = (orderTypeConfig?.workflowRules || {}) as WorkflowRules
      if (workflowRules.requirePaymentBeforeSend) {
        handleOpenPayment()
      }
      return
    }

    setIsSendingOrder(true)
    try {
      const orderId = await saveOrderToDatabase()
      if (orderId) {
        // Start timers for any entertainment/timed rental items
        await startEntertainmentTimers(orderId)

        // Print kitchen ticket
        await printKitchenTicket(orderId)

        // Show brief confirmation
        const orderNum = orderId.slice(-6).toUpperCase()

        // Clear the order so user can start the next one
        clearOrder()
        setSavedOrderId(null)
        setOrderSent(false)
        setSelectedOrderType(null)
        setOrderCustomFields({})

        // Refresh the open orders panel and count
        setTabsRefreshTrigger(prev => prev + 1)

        // Return to floor plan (if not bartender)
        if (!isBartender) {
          setViewMode('floor-plan')
        }

        // Show confirmation with instructions
        alert(`Order #${orderNum} sent to kitchen!\n\nClick "Open Orders" button to view or add more items.`)
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
  const startEntertainmentTimers = async (orderId: string) => {
    try {
      // Fetch the order to get item IDs
      const response = await fetch(`/api/orders/${orderId}`)
      if (!response.ok) return

      const orderData = await response.json()

      // Find entertainment items that need timers started
      for (const item of orderData.items || []) {
        const menuItem = menuItems.find(m => m.id === item.menuItemId)

        // Check if this is a timed_rental item without block time started
        if (menuItem?.itemType === 'timed_rental' && !item.blockTimeStartedAt) {
          const blockMinutes = menuItem.blockTimeMinutes || 60

          // Start the block time
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
    type: 'even' | 'by_item' | 'by_seat' | 'custom_amount' | 'split_item'
    originalOrderId: string
    splits?: { splitNumber: number; amount: number }[]
    newOrderId?: string
    newOrderNumber?: number
    splitAmount?: number
    itemSplits?: { itemId: string; itemName: string; splitNumber: number; amount: number }[]
    seatSplits?: { seatNumber: number; total: number; splitOrderId: string }[]
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
    } else if (result.type === 'by_seat' && result.seatSplits) {
      // Split by seat - multiple checks created
      const seatCount = result.seatSplits.length
      alert(`${seatCount} separate checks created (one per seat).\n\nView them in Open Orders.`)
      setTabsRefreshTrigger(prev => prev + 1)
      // Clear current order since items were moved to seat-specific checks
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
        tableName: tabData.tableName || undefined,
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

  const handleAddItemWithModifiers = (modifiers: SelectedModifier[], specialNotes?: string, pourSize?: string, pourMultiplier?: number, ingredientModifications?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]) => {
    if (!selectedItem) return

    // Apply pour multiplier to base price
    const basePrice = pourMultiplier ? selectedItem.price * pourMultiplier : selectedItem.price
    const applyToMods = selectedItem.applyPourToModifiers && pourMultiplier

    // Add ingredient modification prices to base
    const ingredientTotal = ingredientModifications?.reduce((sum, mod) => sum + mod.priceAdjustment, 0) || 0

    // Build item name with pour size
    const itemName = pourSize
      ? `${selectedItem.name} (${pourSize.charAt(0).toUpperCase() + pourSize.slice(1)})`
      : selectedItem.name

    addItem({
      menuItemId: selectedItem.id,
      name: itemName,
      price: basePrice + ingredientTotal,
      quantity: 1,
      specialNotes,
      modifiers: modifiers.map(mod => ({
        id: mod.id,
        name: mod.preModifier
          ? `${mod.preModifier.charAt(0).toUpperCase() + mod.preModifier.slice(1)} ${mod.name}`
          : mod.name,
        price: applyToMods ? mod.price * pourMultiplier : mod.price,
        preModifier: mod.preModifier,
        depth: mod.depth,
        parentModifierId: mod.parentModifierId,
      })),
      ingredientModifications: ingredientModifications?.map(mod => ({
        ingredientId: mod.ingredientId,
        name: mod.name,
        modificationType: mod.modificationType as 'no' | 'lite' | 'on_side' | 'extra' | 'swap',
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

    if (editingPizzaItem) {
      // Update existing item
      updateItem(editingPizzaItem.id, {
        name: itemName,
        price: config.totalPrice,
        specialNotes: config.specialNotes,
        modifiers: pizzaModifiers,
        pizzaConfig: config,
      })
    } else {
      // Add new item
      addItem({
        menuItemId: selectedPizzaItem.id,
        name: itemName,
        price: config.totalPrice,
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

  const handleUpdateItemWithModifiers = (modifiers: SelectedModifier[], specialNotes?: string, pourSize?: string, pourMultiplier?: number, ingredientModifications?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]) => {
    if (!selectedItem || !editingOrderItem) return

    // Apply pour multiplier to base price
    const basePrice = pourMultiplier ? selectedItem.price * pourMultiplier : selectedItem.price
    const applyToMods = selectedItem.applyPourToModifiers && pourMultiplier

    // Add ingredient modification prices to base
    const ingredientTotal = ingredientModifications?.reduce((sum, mod) => sum + mod.priceAdjustment, 0) || 0

    // Build item name with pour size
    const itemName = pourSize
      ? `${selectedItem.name} (${pourSize.charAt(0).toUpperCase() + pourSize.slice(1)})`
      : selectedItem.name

    updateItem(editingOrderItem.id, {
      name: itemName,
      price: basePrice + ingredientTotal,
      specialNotes,
      modifiers: modifiers.map(mod => ({
        id: mod.id,
        name: mod.preModifier
          ? `${mod.preModifier.charAt(0).toUpperCase() + mod.preModifier.slice(1)} ${mod.name}`
          : mod.name,
        price: applyToMods ? mod.price * pourMultiplier : mod.price,
        preModifier: mod.preModifier,
        depth: mod.depth,
        parentModifierId: mod.parentModifierId,
      })),
      ingredientModifications: ingredientModifications?.map(mod => ({
        ingredientId: mod.ingredientId,
        name: mod.name,
        modificationType: mod.modificationType as 'no' | 'lite' | 'on_side' | 'extra' | 'swap',
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

  // Floor Plan HOME view (T019)
  if (viewMode === 'floor-plan' && employee.location?.id) {
    return (
      <>
        <FloorPlanHome
          locationId={employee.location.id}
          employeeId={employee.id}
          employeeName={employee.displayName}
          employeeRole={employee.role?.name}
          isManager={isManager}
          onNavigateToOrders={async (tableId, orderId) => {
            // Table workflow: open order entry with table context
            if (orderId) {
              // Load existing order from API
              try {
                const res = await fetch(`/api/orders/${orderId}`)
                if (res.ok) {
                  const orderData = await res.json()
                  loadOrder(orderData)
                }
              } catch (error) {
                console.error('Failed to load order:', error)
              }
            } else if (tableId) {
              // Start a new dine-in order attached to this table
              startOrder('dine_in')
              // TODO: Associate order with table via table picker or direct assignment
            }
            setViewMode('order-entry')
          }}
          onStartNewTab={() => {
            // Tab workflow: start a bar tab with no table
            startOrder('bar_tab')
            setViewMode('order-entry')
          }}
          onCategoryClick={(categoryId) => {
            // Tab workflow: tap category first → start bar tab with that category selected
            startOrder('bar_tab')
            setSelectedCategory(categoryId)
            setViewMode('order-entry')
          }}
          onLogout={logout}
          onOpenSettings={() => setShowDisplaySettings(true)}
          onOpenAdminNav={() => setShowAdminNav(true)}
        />
        {/* Admin Nav Sidebar */}
        {showAdminNav && (
          <AdminNav onClose={() => setShowAdminNav(false)} />
        )}
        {/* Display Settings Modal */}
        <POSDisplaySettingsModal
          isOpen={showDisplaySettings}
          onClose={() => setShowDisplaySettings(false)}
          settings={displaySettings}
          onUpdate={updateSetting}
          onBatchUpdate={updateSettings}
        />
      </>
    )
  }

  return (
    <div className={`h-screen flex overflow-hidden transition-colors duration-500 ${
      currentMode === 'bar'
        ? 'bg-gradient-to-br from-slate-100 via-blue-50 to-cyan-50'
        : 'bg-gradient-to-br from-slate-100 via-orange-50 to-amber-50'
    }`}>
      {/* Left Panel - Menu */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <header className="bg-white/80 backdrop-blur-xl border-b border-white/30 shadow-lg shadow-black/5 px-6 py-4 flex items-center justify-between overflow-visible relative z-50">
          <div className="flex items-center gap-4">
            {/* GWI Icon - clickable for managers/owners to open admin sidebar */}
            {isManager ? (
              <button
                onClick={() => setShowAdminNav(!showAdminNav)}
                className="flex items-center gap-4 hover:opacity-90 transition-all duration-200"
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-lg transition-all duration-300 ${
                  currentMode === 'bar'
                    ? 'bg-gradient-to-br from-blue-500 to-cyan-500 shadow-blue-500/30'
                    : 'bg-gradient-to-br from-orange-500 to-amber-500 shadow-orange-500/30'
                }`}>
                  <span className="text-white font-bold text-sm drop-shadow">GWI</span>
                </div>
                <div className="text-left">
                  <p className="font-semibold text-gray-900">{employee.displayName}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-gray-500">{employee.role.name}</p>
                    {hasDevAccess && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-500 text-amber-950 rounded uppercase tracking-wider">
                        DEV
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ) : (
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-lg transition-all duration-300 ${
                  currentMode === 'bar'
                    ? 'bg-gradient-to-br from-blue-500 to-cyan-500 shadow-blue-500/30'
                    : 'bg-gradient-to-br from-orange-500 to-amber-500 shadow-orange-500/30'
                }`}>
                  <span className="text-white font-bold text-sm drop-shadow">GWI</span>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{employee.displayName}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-gray-500">{employee.role.name}</p>
                    {hasDevAccess && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-500 text-amber-950 rounded uppercase tracking-wider">
                        DEV
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Back to Floor Plan button (T019) - only for non-bartenders */}
            {!isBartender && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMode('floor-plan')}
                className="ml-2"
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Floor Plan
              </Button>
            )}
          </div>

          {/* Bar/Food Mode Toggle */}
          <ModeToggle
            currentMode={currentMode}
            onModeChange={setMode}
          />

          <div className="flex items-center gap-3 overflow-visible">
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
            <div className="relative">
              <Button
                variant={showSettingsDropdown || isEditingFavorites || isEditingCategories || isEditingMenuItems ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setShowSettingsDropdown(!showSettingsDropdown)}
                title="Layout Settings"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </Button>

              {/* Settings Dropdown */}
              {showSettingsDropdown && (
                <div className="absolute top-full right-0 mt-2 bg-white rounded-2xl shadow-2xl shadow-black/20 border border-gray-200 z-[9999] py-3 min-w-[220px]">
                  <button
                    type="button"
                    className="w-full px-4 py-2.5 text-left hover:bg-gray-100 flex items-center gap-3 text-sm font-medium"
                    onClick={() => {
                      setShowDisplaySettings(true)
                      setShowSettingsDropdown(false)
                    }}
                  >
                    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    Display Settings
                  </button>

                  {canCustomize && (
                    <>
                      <div className="border-t border-gray-200 my-2" />
                      <button
                        type="button"
                        className={`w-full px-4 py-2.5 text-left hover:bg-gray-100 flex items-center gap-3 text-sm font-medium ${isEditingFavorites ? 'bg-blue-50 text-blue-600' : ''}`}
                        onClick={() => {
                          setIsEditingFavorites(!isEditingFavorites)
                          setIsEditingCategories(false)
                          setShowSettingsDropdown(false)
                        }}
                      >
                        <svg className={`w-5 h-5 ${isEditingFavorites ? 'text-blue-500' : 'text-gray-500'}`} fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                        {isEditingFavorites ? '✓ Done Editing Favorites' : 'Edit Favorites'}
                      </button>
                      <button
                        type="button"
                        className={`w-full px-4 py-2.5 text-left hover:bg-gray-100 flex items-center gap-3 text-sm font-medium ${isEditingCategories ? 'bg-blue-50 text-blue-600' : ''}`}
                        onClick={() => {
                          setIsEditingCategories(!isEditingCategories)
                          setIsEditingFavorites(false)
                          setShowSettingsDropdown(false)
                        }}
                      >
                        <svg className={`w-5 h-5 ${isEditingCategories ? 'text-blue-500' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                        </svg>
                        {isEditingCategories ? '✓ Done Reordering' : 'Reorder Categories'}
                      </button>

                      {/* Customize Menu Items */}
                      <button
                        type="button"
                        className={`w-full px-4 py-2.5 text-left hover:bg-gray-100 flex items-center gap-3 text-sm font-medium ${isEditingMenuItems ? 'bg-purple-50 text-purple-600' : ''}`}
                        onClick={() => {
                          setIsEditingMenuItems(!isEditingMenuItems)
                          setIsEditingCategories(false)
                          setIsEditingFavorites(false)
                          setShowSettingsDropdown(false)
                        }}
                      >
                        <svg className={`w-5 h-5 ${isEditingMenuItems ? 'text-purple-500' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                        </svg>
                        {isEditingMenuItems ? '✓ Done Customizing Items' : 'Customize Item Colors'}
                      </button>

                      {/* Divider */}
                      <div className="my-2 border-t border-gray-200" />

                      {/* Reset All Category Colors */}
                      <button
                        type="button"
                        className="w-full px-4 py-2.5 text-left hover:bg-red-50 flex items-center gap-3 text-sm font-medium text-red-600"
                        onClick={() => {
                          resetAllCategoryColors()
                          setShowSettingsDropdown(false)
                        }}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Reset All Category Colors
                      </button>

                      {/* Reset All Item Styles */}
                      <button
                        type="button"
                        className="w-full px-4 py-2.5 text-left hover:bg-red-50 flex items-center gap-3 text-sm font-medium text-red-600"
                        onClick={() => {
                          resetAllMenuItemStyles()
                          setShowSettingsDropdown(false)
                        }}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Reset All Item Styles
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
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

        {/* Dropdown Menu - Employee items only (admin items moved to AdminNav) */}
        {showMenu && (
          <div className="absolute top-20 right-6 bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl shadow-black/15 border border-white/30 z-50 py-3 min-w-[220px]">
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
          </div>
        )}

        {/* Favorites Bar */}
        {layout.showFavoritesBar && (
          <FavoritesBar
            favoriteIds={favorites}
            menuItems={menuItems}
            onItemClick={handleAddItem}
            onReorder={reorderFavorites}
            onRemove={removeFavorite}
            canEdit={canCustomize}
            currentMode={currentMode}
            showPrices={showPriceOnMenuItems}
            isEditing={isEditingFavorites}
          />
        )}

        {/* Categories - Mode Buttons Left, Categories Right */}
        <div className="bg-white/60 backdrop-blur-md border-b border-white/30 px-4 py-3">
          <div className="flex gap-4">
            {/* Mode Buttons - Stacked Vertically */}
            <div className="flex flex-col gap-2 shrink-0">
              <button
                onClick={() => setMode('bar')}
                className={`
                  flex items-center justify-center gap-2 px-5 py-2 rounded-xl font-semibold text-sm
                  transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]
                  min-w-[90px]
                  ${currentMode === 'bar'
                    ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-500/30 border border-white/20'
                    : 'bg-white/70 backdrop-blur-sm text-blue-600 border border-blue-300/50 hover:bg-blue-50/80'
                  }
                `}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                BAR
              </button>
              <button
                onClick={() => setMode('food')}
                className={`
                  flex items-center justify-center gap-2 px-5 py-2 rounded-xl font-semibold text-sm
                  transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]
                  min-w-[90px]
                  ${currentMode === 'food'
                    ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/30 border border-white/20'
                    : 'bg-white/70 backdrop-blur-sm text-orange-600 border border-orange-300/50 hover:bg-orange-50/80'
                  }
                `}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                </svg>
                FOOD
              </button>
            </div>

            {/* Divider */}
            <div className="w-px bg-gray-300/50 self-stretch" />

            {/* Category Buttons - Draggable when editing */}
            <div className="flex-1 flex flex-col gap-2">
              <DndContext
                sensors={categorySensors}
                collisionDetection={closestCenter}
                onDragEnd={handleCategoryDragEnd}
              >
                <SortableContext
                  items={sortedCategories.map(c => c.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="flex flex-col gap-2">
                    {isLoading ? (
                      <div className="text-gray-400 py-2">Loading menu...</div>
                    ) : (
                      <>
                        {/* Priority Row - First 7 categories with bigger buttons */}
                        <div className="flex flex-wrap gap-2">
                          {sortedCategories.slice(0, 7).map((category, index) => {
                            const isSelected = selectedCategory === category.id
                            // Check for per-category custom colors first, then global, then category default
                            const customColors = categoryColors[category.id]
                            const baseColor = customColors?.bgColor || categoryButtonBgColor || category.color || '#3B82F6'
                            const textColor = customColors?.textColor || categoryButtonTextColor
                            const unselectedBgColor = customColors?.unselectedBgColor
                            const unselectedTextColor = customColors?.unselectedTextColor
                            const hasCustomColor = !!(customColors?.bgColor || customColors?.textColor || customColors?.unselectedBgColor || customColors?.unselectedTextColor)

                            // Calculate styles based on color mode - with glass enhancements
                            const getCategoryStyles = (isPriority: boolean) => {
                              const baseStyles = {
                                transition: 'all 0.2s ease-out',
                                width: isPriority ? '140px' : '100px', // Bigger width for priority
                                minHeight: isPriority ? '48px' : '36px',
                              }

                              switch (categoryColorMode) {
                                case 'subtle':
                                  return {
                                    ...baseStyles,
                                    backgroundColor: isSelected ? baseColor : (unselectedBgColor || `${baseColor}15`),
                                    borderColor: isSelected ? baseColor : `${baseColor}40`,
                                    color: isSelected ? (textColor || 'white') : (unselectedTextColor || textColor || baseColor),
                                    boxShadow: isSelected ? `0 10px 40px ${baseColor}30` : (unselectedBgColor ? `0 4px 15px ${baseColor}20` : undefined),
                                  }
                                case 'outline':
                                  return {
                                    ...baseStyles,
                                    backgroundColor: isSelected ? `${baseColor}15` : (unselectedBgColor || 'rgba(255,255,255,0.6)'),
                                    borderColor: baseColor,
                                    color: isSelected ? (textColor || baseColor) : (unselectedTextColor || textColor || baseColor),
                                    boxShadow: isSelected ? `inset 0 0 0 2px ${baseColor}, 0 4px 20px ${baseColor}20` : (unselectedBgColor ? `0 4px 15px ${baseColor}15` : undefined),
                                  }
                                default: // 'solid' - now with gradient and glow
                                  return {
                                    ...baseStyles,
                                    background: isSelected
                                      ? `linear-gradient(135deg, ${baseColor} 0%, ${baseColor}dd 100%)`
                                      : (unselectedBgColor || 'rgba(255,255,255,0.7)'),
                                    borderColor: isSelected ? 'transparent' : `${baseColor}50`,
                                    color: isSelected ? (textColor || 'white') : (unselectedTextColor || textColor || baseColor),
                                    boxShadow: isSelected ? `0 10px 40px ${baseColor}35` : (unselectedBgColor ? `0 4px 15px ${baseColor}20` : '0 2px 8px rgba(0,0,0,0.05)'),
                                    backdropFilter: isSelected ? undefined : (unselectedBgColor ? undefined : 'blur(8px)'),
                                  }
                              }
                            }

                            return (
                              <SortableCategoryButton
                                key={category.id}
                                category={category}
                                isSelected={isSelected}
                                isEditing={isEditingCategories}
                                categorySize={categorySize}
                                isPriority={true}
                                getCategoryStyles={getCategoryStyles}
                                onClick={() => !isEditingCategories && setSelectedCategory(category.id)}
                                onColorClick={() => setColorPickerCategory(category)}
                                hasCustomColor={hasCustomColor}
                              />
                            )
                          })}
                        </div>

                        {/* Secondary Row - Remaining categories with smaller buttons */}
                        {sortedCategories.length > 7 && (
                          <div className="flex flex-wrap gap-1.5">
                            {sortedCategories.slice(7).map((category, index) => {
                              const isSelected = selectedCategory === category.id
                              // Check for per-category custom colors first, then global, then category default
                              const customColors = categoryColors[category.id]
                              const baseColor = customColors?.bgColor || categoryButtonBgColor || category.color || '#3B82F6'
                              const textColor = customColors?.textColor || categoryButtonTextColor
                              const unselectedBgColor = customColors?.unselectedBgColor
                              const unselectedTextColor = customColors?.unselectedTextColor
                              const hasCustomColor = !!(customColors?.bgColor || customColors?.textColor || customColors?.unselectedBgColor || customColors?.unselectedTextColor)

                              // Calculate styles based on color mode - with glass enhancements
                              const getCategoryStyles = (isPriority: boolean) => {
                                const baseStyles = {
                                  transition: 'all 0.2s ease-out',
                                  width: isPriority ? '140px' : '100px', // Smaller width for secondary
                                  minHeight: isPriority ? '48px' : '36px',
                                }

                                switch (categoryColorMode) {
                                  case 'subtle':
                                    return {
                                      ...baseStyles,
                                      backgroundColor: isSelected ? baseColor : (unselectedBgColor || `${baseColor}10`),
                                      borderColor: isSelected ? baseColor : `${baseColor}30`,
                                      color: isSelected ? (textColor || 'white') : (unselectedTextColor || textColor || baseColor),
                                      boxShadow: isSelected ? `0 8px 30px ${baseColor}25` : (unselectedBgColor ? `0 3px 12px ${baseColor}15` : undefined),
                                    }
                                  case 'outline':
                                    return {
                                      ...baseStyles,
                                      backgroundColor: isSelected ? `${baseColor}10` : (unselectedBgColor || 'rgba(255,255,255,0.5)'),
                                      borderColor: `${baseColor}80`,
                                      color: isSelected ? (textColor || baseColor) : (unselectedTextColor || textColor || baseColor),
                                      boxShadow: isSelected ? `inset 0 0 0 2px ${baseColor}, 0 4px 15px ${baseColor}15` : (unselectedBgColor ? `0 3px 12px ${baseColor}10` : undefined),
                                    }
                                  default: // 'solid'
                                    return {
                                      ...baseStyles,
                                      background: isSelected
                                        ? `linear-gradient(135deg, ${baseColor} 0%, ${baseColor}dd 100%)`
                                        : (unselectedBgColor || 'rgba(255,255,255,0.6)'),
                                      borderColor: isSelected ? 'transparent' : `${baseColor}40`,
                                      color: isSelected ? (textColor || 'white') : (unselectedTextColor || textColor || baseColor),
                                      boxShadow: isSelected ? `0 8px 30px ${baseColor}30` : (unselectedBgColor ? `0 3px 12px ${baseColor}15` : '0 1px 4px rgba(0,0,0,0.04)'),
                                      backdropFilter: isSelected ? undefined : (unselectedBgColor ? undefined : 'blur(6px)'),
                                    }
                                }
                              }

                              return (
                                <SortableCategoryButton
                                  key={category.id}
                                  category={category}
                                  isSelected={isSelected}
                                  isEditing={isEditingCategories}
                                  categorySize={categorySize}
                                  isPriority={false}
                                  getCategoryStyles={getCategoryStyles}
                                  onClick={() => !isEditingCategories && setSelectedCategory(category.id)}
                                  onColorClick={() => setColorPickerCategory(category)}
                                  hasCustomColor={hasCustomColor}
                                />
                              )
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </SortableContext>
              </DndContext>

            </div>
          </div>
        </div>

        {/* Menu Items Grid */}
        <div className="flex-1 p-4 overflow-y-auto">
          <div className={`grid ${gridColsClass} gap-3`}>
            {filteredItems.map(item => {
              const isInUse = item.itemType === 'timed_rental' && item.entertainmentStatus === 'in_use'
              const isFavorite = favorites.includes(item.id)
              const hoverColor = currentMode === 'bar' ? 'blue' : 'orange'

              // Get custom styles for this menu item
              const customStyle = menuItemColors[item.id]
              const hasCustomStyle = !!(customStyle?.bgColor || customStyle?.textColor || customStyle?.popEffect)

              // Calculate custom button styles
              const getItemStyles = (): React.CSSProperties => {
                if (!customStyle) return {}

                const styles: React.CSSProperties = {}
                const effectColor = customStyle.glowColor || customStyle.bgColor || '#3B82F6'

                if (customStyle.bgColor) {
                  styles.backgroundColor = customStyle.bgColor
                }
                if (customStyle.textColor) {
                  styles.color = customStyle.textColor
                }

                // Apply pop effects
                if (customStyle.popEffect === 'glow' || customStyle.popEffect === 'all') {
                  styles.boxShadow = `0 8px 25px ${effectColor}50`
                }
                if (customStyle.popEffect === 'border' || customStyle.popEffect === 'all') {
                  styles.borderColor = effectColor
                  styles.borderWidth = '2px'
                }
                if (customStyle.popEffect === 'larger' || customStyle.popEffect === 'all') {
                  styles.transform = 'scale(1.08)'
                  styles.zIndex = 10
                }

                return styles
              }

              return (
                <div key={item.id} className="relative">
                  <Button
                    variant="glassOutline"
                    className={`${menuItemClass} w-full flex flex-col items-center justify-center gap-1 relative
                      ${!customStyle?.bgColor ? 'bg-white/70 backdrop-blur-sm' : ''}
                      ${!customStyle?.popEffect?.includes('border') ? 'border border-white/40' : ''}
                      shadow-md shadow-black/5
                      hover:bg-white/90 hover:shadow-lg hover:scale-[1.02]
                      active:scale-[0.98] transition-all duration-200
                      ${isInUse
                        ? 'bg-red-50/80 border-red-300/50 shadow-red-500/10 hover:bg-red-100/80'
                        : `hover:border-${hoverColor}-300/50 hover:shadow-${hoverColor}-500/10`
                      }`}
                    style={getItemStyles()}
                    onClick={() => !isEditingMenuItems && handleAddItem(item)}
                    onContextMenu={(e) => {
                      if (!canCustomize) return
                      e.preventDefault()
                      if (isFavorite) {
                        removeFavorite(item.id)
                      } else {
                        addFavorite(item.id)
                      }
                    }}
                  >
                    {/* Favorite star indicator with glow */}
                    {isFavorite && (
                      <span className="absolute top-2 left-2 text-amber-400 drop-shadow-[0_0_4px_rgba(251,191,36,0.6)]">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                      </span>
                    )}
                    {isInUse && (
                      <span className="absolute top-2 right-2 bg-gradient-to-r from-red-500 to-red-600 text-white text-xs px-2 py-0.5 rounded-full font-semibold shadow-lg shadow-red-500/30">
                        IN USE
                      </span>
                    )}
                    <span className={`font-semibold text-center leading-tight ${isInUse ? 'text-red-800' : ''}`} style={customStyle?.textColor ? { color: customStyle.textColor } : {}}>
                      {item.name}
                    </span>
                    {showPriceOnMenuItems && formatItemPrice(item.price)}
                  </Button>

                  {/* Edit button when in edit mode */}
                  {isEditingMenuItems && (
                    <button
                      type="button"
                      onClick={() => setColorPickerMenuItem(item)}
                      className={`absolute -top-2 -right-2 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs shadow-lg z-20 ${
                        hasCustomStyle ? 'bg-purple-500 hover:bg-purple-600' : 'bg-gray-500 hover:bg-gray-600'
                      }`}
                      title="Customize style"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                      </svg>
                    </button>
                  )}
                </div>
              )
            })}
            {unavailableItems.map(item => (
              <Button
                key={item.id}
                variant="glassOutline"
                className={`${menuItemClass} flex flex-col items-center justify-center gap-1 opacity-50 cursor-not-allowed relative
                  bg-white/40 backdrop-blur-sm border border-white/30`}
                disabled
              >
                <span className="font-semibold text-gray-900 text-center leading-tight">{item.name}</span>
                {showPriceOnMenuItems && formatItemPrice(item.price)}
                <span className="absolute top-2 right-2 bg-gradient-to-r from-red-500 to-red-600 text-white text-xs px-2 py-0.5 rounded-full font-semibold shadow-md">86</span>
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Right Panel - Order */}
      <div className={`${orderPanelClass} bg-white/80 backdrop-blur-xl border-l border-white/30 shadow-xl shadow-black/5 flex flex-col h-full overflow-hidden`}>
        {/* Order Header */}
        <div className="p-5 border-b border-white/30 bg-gradient-to-r from-gray-50/50 to-white/50">
          <div className="flex items-center justify-between">
            {savedOrderId && currentOrder ? (
              // Show order identifier for existing orders - CLICKABLE to edit settings
              <div
                className="cursor-pointer hover:bg-gray-100 rounded-lg p-2 -m-2 transition-colors group"
                onClick={() => setShowOrderSettingsModal(true)}
              >
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-lg">
                    {currentOrder.tableName
                      ? `Table ${currentOrder.tableName}`
                      : currentOrder.tabName || `Order #${currentOrder.orderNumber || savedOrderId.slice(-6).toUpperCase()}`}
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
              // Show "New Order" for new orders - display table name if selected
              <div>
                <h2 className="font-semibold text-lg">
                  {currentOrder?.tableName ? `Table ${currentOrder.tableName}` : 'New Order'}
                </h2>
                <span className="text-sm text-gray-500 capitalize">
                  {currentOrder?.orderType.replace('_', ' ') || 'Select type'}
                  {currentOrder?.guestCount && currentOrder.guestCount > 1 && ` • ${currentOrder.guestCount} guests`}
                </span>
              </div>
            )}
            {savedOrderId && (
              <span className={`px-3 py-1 text-xs font-semibold rounded-full shadow-md ${
                currentMode === 'bar'
                  ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-blue-500/25'
                  : 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-orange-500/25'
              }`}>
                Open
              </span>
            )}
          </div>
          {!savedOrderId && (
            <div className="mt-3">
              {orderTypes.length > 0 ? (
                <OrderTypeSelector
                  locationId={employee?.location?.id || ''}
                  selectedType={currentOrder?.orderType}
                  onSelectType={handleOrderTypeSelect}
                />
              ) : (
                // Fallback to hardcoded buttons if no order types configured
                <div className="flex items-center gap-2">
                  <button
                    className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                      currentOrder?.orderType === 'dine_in'
                        ? currentMode === 'bar'
                          ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-md shadow-blue-500/25'
                          : 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/25'
                        : 'bg-white/60 hover:bg-white/80 text-gray-700 border border-white/40 hover:shadow-md'
                    }`}
                    onClick={() => setShowTablePicker(true)}
                  >
                    Table
                  </button>
                  <button
                    className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                      currentOrder?.orderType === 'bar_tab'
                        ? currentMode === 'bar'
                          ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-md shadow-blue-500/25'
                          : 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/25'
                        : 'bg-white/60 hover:bg-white/80 text-gray-700 border border-white/40 hover:shadow-md'
                    }`}
                    onClick={() => startOrder('bar_tab')}
                  >
                    Quick Tab
                  </button>
                  <button
                    className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                      currentOrder?.orderType === 'takeout'
                        ? currentMode === 'bar'
                          ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-md shadow-blue-500/25'
                          : 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/25'
                        : 'bg-white/60 hover:bg-white/80 text-gray-700 border border-white/40 hover:shadow-md'
                    }`}
                    onClick={() => startOrder('takeout')}
                  >
                    Takeout
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Order Items */}
        <div className={`flex-1 overflow-y-auto p-4 ${
          currentMode === 'bar'
            ? 'bg-gradient-to-b from-blue-50/30 via-transparent to-transparent'
            : 'bg-gradient-to-b from-orange-50/30 via-transparent to-transparent'
        }`}>
          {currentOrder?.items.length === 0 ? (
            currentOrder?.total && currentOrder.total > 0 ? (
              // Split order with no items - show split info
              <div className="text-center py-8">
                <div className={`rounded-2xl p-5 mb-4 backdrop-blur-sm ${
                  currentMode === 'bar'
                    ? 'bg-gradient-to-br from-blue-100/80 to-cyan-100/60 border border-blue-200/50'
                    : 'bg-gradient-to-br from-orange-100/80 to-amber-100/60 border border-orange-200/50'
                }`}>
                  <p className={`font-bold text-lg ${currentMode === 'bar' ? 'text-blue-800' : 'text-orange-800'}`}>Split Check</p>
                  <p className={`text-sm ${currentMode === 'bar' ? 'text-blue-600' : 'text-orange-600'}`}>Order #{currentOrder.orderNumber}</p>
                </div>
                <p className={`text-3xl font-bold ${
                  currentMode === 'bar' ? 'text-blue-600' : 'text-orange-600'
                }`}>{formatCurrency(currentOrder.total)}</p>
                <p className="text-sm text-gray-500 mt-2">This is a split portion of the original order</p>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className={`w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center ${
                  currentMode === 'bar'
                    ? 'bg-gradient-to-br from-blue-100 to-cyan-100'
                    : 'bg-gradient-to-br from-orange-100 to-amber-100'
                }`}>
                  <svg className={`w-8 h-8 ${currentMode === 'bar' ? 'text-blue-400' : 'text-orange-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <p className="text-gray-500 font-medium">No items yet</p>
                <p className="text-sm text-gray-400 mt-1">Tap menu items to add</p>
              </div>
            )
          ) : (
            <div className="space-y-1.5">
              {currentOrder?.items.map(item => {
                // Group modifiers by depth for hierarchical display
                const topLevelMods = item.modifiers.filter(m => !m.depth || m.depth === 0)
                const childMods = item.modifiers.filter(m => m.depth && m.depth > 0)
                const hasModifiers = item.modifiers.length > 0
                const menuItemInfo = menuItems.find(m => m.id === item.menuItemId)
                const canEdit = (menuItemInfo?.modifierGroupCount && menuItemInfo.modifierGroupCount > 0) || item.pizzaConfig

                return (
                  <Card key={item.id} variant="glassSubtle" className={`p-2 ${
                    item.sentToKitchen
                      ? 'bg-gradient-to-r from-emerald-50/80 to-green-50/60 border-l-3 border-l-emerald-500 shadow-emerald-500/10'
                      : 'hover:bg-white/80 transition-all duration-200'
                  }`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          {/* Sent indicator */}
                          {item.sentToKitchen ? (
                            <div className="flex items-center gap-0.5">
                              <span className="w-4 h-4 rounded bg-emerald-500 flex items-center justify-center" title="Sent to kitchen">
                                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              </span>
                              <span className="w-5 text-center text-sm font-semibold text-gray-600">{item.quantity}</span>
                              {/* Printer icon to resend */}
                              <button
                                className="w-5 h-5 rounded bg-gray-100/80 flex items-center justify-center text-gray-400 hover:bg-blue-100 hover:text-blue-600 transition-colors"
                                onClick={() => handleResendItem(item.id, item.name)}
                                title="Resend to kitchen"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                </svg>
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-0.5">
                              <button
                                className={`w-5 h-5 rounded flex items-center justify-center text-xs font-semibold transition-colors ${
                                  currentMode === 'bar'
                                    ? 'bg-blue-100/80 hover:bg-blue-200 text-blue-700'
                                    : 'bg-orange-100/80 hover:bg-orange-200 text-orange-700'
                                }`}
                                onClick={() => updateQuantity(item.id, item.quantity - 1)}
                              >
                                -
                              </button>
                              <span className="w-5 text-center text-sm font-semibold text-gray-800">{item.quantity}</span>
                              <button
                                className={`w-5 h-5 rounded flex items-center justify-center text-xs font-semibold transition-colors ${
                                  currentMode === 'bar'
                                    ? 'bg-blue-100/80 hover:bg-blue-200 text-blue-700'
                                    : 'bg-orange-100/80 hover:bg-orange-200 text-orange-700'
                                }`}
                                onClick={() => updateQuantity(item.id, item.quantity + 1)}
                              >
                                +
                              </button>
                            </div>
                          )}
                          <button
                            className={`text-sm font-medium text-left ${item.sentToKitchen ? 'text-gray-600' : 'text-gray-800'} ${canEdit && !item.sentToKitchen ? 'hover:text-blue-600 cursor-pointer' : ''}`}
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
                              <span className="ml-1 text-[10px] text-blue-500 font-medium">Sent</span>
                            )}
                            {item.isCompleted && (
                              <span className="ml-1 text-[10px] text-emerald-600 font-bold">
                                ✓ MADE
                                {item.completedAt && (
                                  <span className="ml-0.5 text-emerald-500">
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
                        {/* Display ingredient modifications */}
                        {item.ingredientModifications && item.ingredientModifications.length > 0 && (
                          <div
                            className={`ml-[52px] mt-0.5 ${canEdit && !item.sentToKitchen ? 'cursor-pointer' : ''}`}
                            onClick={() => canEdit && !item.sentToKitchen && handleEditOrderItem(item)}
                          >
                            {item.ingredientModifications.map((ing, idx) => (
                              <div
                                key={ing.ingredientId || idx}
                                className={`text-xs leading-tight font-medium ${
                                  ing.modificationType === 'no' ? 'text-red-500' :
                                  ing.modificationType === 'lite' ? 'text-amber-600' :
                                  ing.modificationType === 'on_side' ? 'text-blue-500' :
                                  ing.modificationType === 'extra' ? 'text-green-600' :
                                  ing.modificationType === 'swap' ? 'text-purple-500' : 'text-gray-500'
                                }`}
                              >
                                {ing.modificationType === 'no' && `❌ NO ${ing.name}`}
                                {ing.modificationType === 'lite' && `⬇ LITE ${ing.name}`}
                                {ing.modificationType === 'on_side' && `📦 SIDE ${ing.name}`}
                                {ing.modificationType === 'extra' && `⬆ EXTRA ${ing.name}`}
                                {ing.modificationType === 'swap' && `🔄 ${ing.name} → ${ing.swappedTo?.name}`}
                                {ing.priceAdjustment > 0 && <span className="text-emerald-600 ml-1">+{formatCurrency(ing.priceAdjustment)}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Display modifiers with hierarchy using dashes */}
                        {hasModifiers && (
                          <div
                            className={`ml-[52px] mt-0.5 ${canEdit && !item.sentToKitchen ? 'cursor-pointer' : ''}`}
                            onClick={() => canEdit && !item.sentToKitchen && handleEditOrderItem(item)}
                          >
                            {/* All modifiers with dash hierarchy */}
                            {item.modifiers.map((mod, idx) => {
                              const depth = mod.depth || 0
                              const dashes = depth > 0 ? '-'.repeat(depth) + ' ' : ''
                              return (
                                <div
                                  key={mod.id || idx}
                                  className={`text-xs leading-tight ${depth === 0 ? 'text-gray-500' : 'text-gray-400'}`}
                                >
                                  {depth === 0 ? '• ' : dashes}{mod.name}{mod.price > 0 && <span className="text-emerald-600 ml-1">+{formatCurrency(mod.price)}</span>}
                                </div>
                              )
                            })}
                          </div>
                        )}
                        {item.specialNotes && (
                          <div className="ml-[52px] mt-0.5 text-xs text-amber-600">
                            <span className="font-medium">Note:</span> {item.specialNotes}
                          </div>
                        )}
                        {/* Seat/Course/Hold Controls - show for all items */}
                        {!item.sentToKitchen && (
                          <div className="ml-[52px] mt-1 flex items-center gap-2">
                            {item.isHeld ? (
                              <button
                                className="px-2 py-0.5 text-[10px] rounded bg-emerald-500 text-white hover:bg-emerald-600 font-medium"
                                onClick={() => updateItem(item.id, { isHeld: false })}
                              >
                                Fire
                              </button>
                            ) : (
                              <button
                                className="px-2 py-0.5 text-[10px] rounded bg-amber-100 text-amber-700 hover:bg-amber-200 font-medium"
                                onClick={() => updateItem(item.id, { isHeld: true })}
                              >
                                Hold
                              </button>
                            )}
                          </div>
                        )}
                        {savedOrderId && item.sentToKitchen && (
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
                      <div className="flex items-center gap-1">
                        <span className={`font-semibold text-xs ${
                          item.sentToKitchen ? 'text-emerald-700' : 'text-gray-700'
                        }`}>
                          {formatCurrency((item.price + item.modifiers.reduce((sum, m) => sum + m.price, 0)) * item.quantity)}
                        </span>
                        {/* Notes button */}
                        {!item.sentToKitchen && (
                          <button
                            className={`p-1 rounded transition-colors ${
                              item.specialNotes
                                ? 'text-amber-500 hover:text-amber-600'
                                : 'text-gray-300 hover:text-gray-500'
                            }`}
                            onClick={() => handleOpenNotesEditor(item.id, item.specialNotes)}
                            title={item.specialNotes ? 'Edit note' : 'Add note'}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                            </svg>
                          </button>
                        )}
                        {/* Comp/Void button for sent items */}
                        {item.sentToKitchen && (
                          <button
                            className="p-1 rounded text-amber-500 hover:text-amber-600 transition-colors"
                            onClick={() => handleOpenCompVoid(item)}
                            title="Comp or Void"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                        )}
                        {/* Delete button (only for unsent items) */}
                        {!item.sentToKitchen && (
                          <button
                            className="p-1 rounded text-red-400 hover:text-red-600 transition-colors"
                            onClick={() => removeItem(item.id)}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Entertainment Session Controls - for timed rental items */}
                    {(item.blockTimeMinutes || item.blockTimeStartedAt || item.blockTimeExpiresAt || menuItemInfo?.itemType === 'timed_rental') && (
                      <EntertainmentSessionControls
                        orderItemId={item.id}
                        menuItemId={item.menuItemId}
                        itemName={item.name}
                        blockTimeMinutes={item.blockTimeMinutes || null}
                        blockTimeStartedAt={item.blockTimeStartedAt || null}
                        blockTimeExpiresAt={item.blockTimeExpiresAt || null}
                        isTimedRental={menuItemInfo?.itemType === 'timed_rental'}
                        defaultBlockMinutes={menuItemInfo?.blockTimeMinutes || 60}
                        onSessionEnded={() => {
                          // Refresh the order using loadOrder
                          if (savedOrderId) {
                            fetch(`/api/orders/${savedOrderId}`)
                              .then(res => res.json())
                              .then(data => {
                                if (data.id) {
                                  loadOrder(data)
                                }
                              })
                              .catch(console.error)
                          }
                        }}
                        onTimerStarted={() => {
                          // Refresh the order using loadOrder
                          if (savedOrderId) {
                            fetch(`/api/orders/${savedOrderId}`)
                              .then(res => res.json())
                              .then(data => {
                                if (data.id) {
                                  loadOrder(data)
                                }
                              })
                              .catch(console.error)
                          }
                        }}
                        onTimeExtended={() => {
                          // Refresh the order using loadOrder
                          if (savedOrderId) {
                            fetch(`/api/orders/${savedOrderId}`)
                              .then(res => res.json())
                              .then(data => {
                                if (data.id) {
                                  loadOrder(data)
                                }
                              })
                              .catch(console.error)
                          }
                        }}
                      />
                    )}
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
          <div className="border-t border-white/30 p-3 bg-gradient-to-r from-gray-50/80 to-white/60 backdrop-blur-sm">
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
                  <button
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                      paymentMethod === 'cash'
                        ? 'bg-emerald-500 text-white'
                        : 'bg-white/60 text-gray-600 hover:bg-white/80'
                    }`}
                    onClick={() => setPaymentMethod('cash')}
                  >
                    <span>Cash</span>
                    <span className={`font-bold ${paymentMethod === 'cash' ? 'text-white' : 'text-emerald-600'}`}>
                      {formatCurrency(cashTotal)}
                    </span>
                  </button>
                  <button
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                      paymentMethod === 'card'
                        ? 'bg-blue-500 text-white'
                        : 'bg-white/60 text-gray-600 hover:bg-white/80'
                    }`}
                    onClick={() => setPaymentMethod('card')}
                  >
                    <span>Card</span>
                    <span className={`font-bold ${paymentMethod === 'card' ? 'text-white' : 'text-blue-600'}`}>
                      {formatCurrency(cardTotal)}
                    </span>
                  </button>
                </div>
              )
            })()}
          </div>
        )}

        {/* Order Totals - Clickable to expand item breakdown */}
        <div className="border-t border-white/30 bg-gradient-to-b from-white/40 to-white/60 backdrop-blur-sm">
          {(() => {
            const storedSubtotal = currentOrder?.subtotal || 0
            const discountPct = dualPricing.cashDiscountPercent || 4.0
            const cardSubtotal = dualPricing.enabled
              ? calculateCardPrice(storedSubtotal, discountPct)
              : storedSubtotal
            const cashDiscountAmount = dualPricing.enabled && paymentMethod === 'cash'
              ? cardSubtotal - storedSubtotal
              : 0
            const discount = currentOrder?.discountTotal || 0
            const taxableAmount = cardSubtotal - cashDiscountAmount - discount
            const tax = taxableAmount * taxRate
            const gratuity = currentOrder?.tipTotal || 0
            const unroundedTotal = taxableAmount + tax + gratuity
            const total = applyPriceRounding(unroundedTotal, priceRounding, paymentMethod)
            const roundingAdjustment = total - unroundedTotal

            return (
              <>
                {/* Clickable Total Row */}
                <button
                  className="w-full p-3 flex justify-between items-center hover:bg-white/30 transition-colors"
                  onClick={() => setShowTotalBreakdown(!showTotalBreakdown)}
                >
                  <div className="flex items-center gap-2">
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${showTotalBreakdown ? 'rotate-90' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="font-bold text-gray-700">Total</span>
                    <span className="text-xs text-gray-400">({currentOrder?.items.length || 0} items)</span>
                  </div>
                  <span className={`px-3 py-1 rounded-lg font-bold text-lg ${
                    dualPricing.enabled && paymentMethod === 'cash'
                      ? 'bg-emerald-500 text-white'
                      : dualPricing.enabled
                        ? 'bg-blue-500 text-white'
                        : currentMode === 'bar'
                          ? 'bg-blue-500 text-white'
                          : 'bg-orange-500 text-white'
                  }`}>
                    {formatCurrency(total)}
                  </span>
                </button>

                {/* Expanded Breakdown */}
                {showTotalBreakdown && (
                  <div className="px-3 pb-3 space-y-1 text-xs border-t border-white/30">
                    {/* Item-by-item breakdown */}
                    <div className="pt-2 space-y-0.5">
                      {currentOrder?.items.map((item, idx) => {
                        const itemTotal = (item.price + item.modifiers.reduce((sum, m) => sum + m.price, 0)) * item.quantity
                        return (
                          <div key={item.id}>
                            <div className="flex justify-between text-gray-600">
                              <span>{item.quantity}x {item.name}</span>
                              <span>{formatCurrency(itemTotal)}</span>
                            </div>
                            {item.modifiers.length > 0 && (
                              <div className="ml-4 text-gray-400">
                                {item.modifiers.map((mod, midx) => {
                                  const depth = mod.depth || 0
                                  const prefix = depth === 0 ? '+ ' : '-'.repeat(depth + 1) + ' '
                                  return (
                                    <div key={mod.id || midx} className="flex justify-between">
                                      <span>{prefix}{mod.name}</span>
                                      {mod.price > 0 && <span>{formatCurrency(mod.price * item.quantity)}</span>}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* Subtotal */}
                    <div className="flex justify-between pt-2 border-t border-gray-200/50 text-gray-600 font-medium">
                      <span>Subtotal</span>
                      <span>{formatCurrency(cardSubtotal)}</span>
                    </div>

                    {/* Cash discount */}
                    {dualPricing.enabled && paymentMethod === 'cash' && cashDiscountAmount > 0 && (
                      <div className="flex justify-between text-emerald-600">
                        <span>Cash Discount ({discountPct}%)</span>
                        <span>-{formatCurrency(cashDiscountAmount)}</span>
                      </div>
                    )}

                    {/* Discounts */}
                    {discount > 0 && (
                      <div className="flex justify-between text-emerald-600">
                        <span>Discount</span>
                        <span>-{formatCurrency(discount)}</span>
                      </div>
                    )}

                    {/* Tax */}
                    <div className="flex justify-between text-gray-600">
                      <span>Tax ({(taxRate * 100).toFixed(1)}%)</span>
                      <span>{formatCurrency(tax)}</span>
                    </div>

                    {/* Gratuity */}
                    {gratuity > 0 && (
                      <div className="flex justify-between text-blue-600">
                        <span>Gratuity</span>
                        <span>{formatCurrency(gratuity)}</span>
                      </div>
                    )}

                    {/* Rounding */}
                    {priceRounding.enabled && Math.abs(roundingAdjustment) > 0.001 && (
                      <div className="flex justify-between text-gray-400">
                        <span>Rounding</span>
                        <span>{roundingAdjustment >= 0 ? '+' : ''}{formatCurrency(roundingAdjustment)}</span>
                      </div>
                    )}

                    {/* Final Total */}
                    <div className={`flex justify-between pt-2 border-t font-bold ${
                      dualPricing.enabled && paymentMethod === 'cash'
                        ? 'border-emerald-200 text-emerald-700'
                        : 'border-gray-200/50 text-gray-700'
                    }`}>
                      <span>Total</span>
                      <span>{formatCurrency(total)}</span>
                    </div>

                    {/* Savings message */}
                    {dualPricing.enabled && dualPricing.showSavingsMessage && paymentMethod === 'cash' && storedSubtotal > 0 && (
                      <div className="text-center text-emerald-600 pt-1">
                        You save {formatCurrency(cashDiscountAmount)} with cash!
                      </div>
                    )}
                  </div>
                )}
              </>
            )
          })()}
        </div>

        {/* Action Buttons */}
        <div className="p-4 border-t border-white/30 space-y-3 bg-gradient-to-b from-white/50 to-white/70 backdrop-blur-sm">
          {(() => {
            const newItemCount = currentOrder?.items.filter(i => !i.sentToKitchen).length || 0
            const hasNewItems = newItemCount > 0
            const isExistingOrder = !!savedOrderId

            return (
              <button
                className={`w-full py-4 rounded-xl font-bold text-lg text-white transition-all duration-200 ${
                  (!currentOrder?.items.length || isSendingOrder || (isExistingOrder && !hasNewItems))
                    ? 'bg-gray-300 cursor-not-allowed'
                    : currentMode === 'bar'
                      ? 'bg-gradient-to-r from-blue-500 to-cyan-500 shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 hover:scale-[1.01] active:scale-[0.99]'
                      : 'bg-gradient-to-r from-orange-500 to-amber-500 shadow-lg shadow-orange-500/30 hover:shadow-xl hover:shadow-orange-500/40 hover:scale-[1.01] active:scale-[0.99]'
                }`}
                disabled={!currentOrder?.items.length || isSendingOrder || (isExistingOrder && !hasNewItems)}
                onClick={handleSendToKitchen}
              >
                {isSendingOrder ? 'Sending...' :
                  isExistingOrder ?
                    (hasNewItems ? `Send ${newItemCount} New Item${newItemCount > 1 ? 's' : ''} to Kitchen` : 'No New Items')
                    : 'Send to Kitchen'}
              </button>
            )
          })()}
          <div className="grid grid-cols-5 gap-2">
            <button
              className={`py-2.5 px-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                !currentOrder?.items.length
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-white/70 hover:bg-white/90 text-gray-700 border border-white/40 hover:shadow-md hover:border-purple-300 hover:text-purple-700'
              }`}
              disabled={!currentOrder?.items.length}
              onClick={handleOpenDiscount}
            >
              Disc
            </button>
            <button
              className={`py-2.5 px-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                !currentOrder?.items.length || !savedOrderId
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-white/70 hover:bg-white/90 text-gray-700 border border-white/40 hover:shadow-md hover:border-blue-300 hover:text-blue-700'
              }`}
              disabled={!currentOrder?.items.length || !savedOrderId}
              onClick={() => setShowItemTransferModal(true)}
            >
              Move
            </button>
            <button
              className={`py-2.5 px-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                !currentOrder?.items.length || !savedOrderId
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-white/70 hover:bg-white/90 text-gray-700 border border-white/40 hover:shadow-md hover:border-cyan-300 hover:text-cyan-700'
              }`}
              disabled={!currentOrder?.items.length || !savedOrderId}
              onClick={handleOpenSplitTicket}
              title="Split order into separate tickets"
            >
              Split
            </button>
            <button
              className={`py-2.5 px-2 rounded-xl text-sm font-bold transition-all duration-200 ${
                !currentOrder?.items.length && !(currentOrder?.total && currentOrder.total > 0)
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-md shadow-emerald-500/25 hover:shadow-lg hover:shadow-emerald-500/35 hover:scale-[1.02]'
              }`}
              disabled={!currentOrder?.items.length && !(currentOrder?.total && currentOrder.total > 0)}
              onClick={handleOpenPayment}
            >
              Pay
            </button>
            <button
              className={`py-2.5 px-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                !currentOrder?.items.length
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-red-500 to-rose-500 text-white shadow-md shadow-red-500/25 hover:shadow-lg hover:shadow-red-500/35 hover:scale-[1.02]'
              }`}
              onClick={() => {
                clearOrder()
                setSavedOrderId(null)
                setOrderSent(false)
                setAppliedDiscounts([])
              }}
              disabled={!currentOrder?.items.length}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* Admin Navigation Sidebar */}
      {showAdminNav && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setShowAdminNav(false)}
          />
          {/* Admin Nav - positioned over the overlay */}
          <AdminNav forceOpen={true} onClose={() => setShowAdminNav(false)} permissions={employee?.permissions || []} />
        </>
      )}

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

      {/* Pizza Builder Modal */}
      {showPizzaModal && selectedPizzaItem && (
        <PizzaBuilderModal
          item={selectedPizzaItem}
          editingItem={editingPizzaItem}
          onConfirm={handleAddPizzaToOrder}
          onCancel={() => {
            setShowPizzaModal(false)
            setSelectedPizzaItem(null)
            setEditingPizzaItem(null)
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

      {/* Table Picker Modal */}
      {showTablePicker && employee?.location?.id && (
        <TablePickerModal
          locationId={employee.location.id}
          onSelect={(tableId, tableName, guestCount) => {
            // Use selected order type if available, otherwise default to dine_in
            const orderTypeSlug = selectedOrderType?.slug || 'dine_in'
            const orderTypeId = selectedOrderType?.id
            // Include any custom fields that were collected
            const cleanFields: Record<string, string> = {}
            if (orderCustomFields) {
              Object.entries(orderCustomFields).forEach(([key, value]) => {
                if (value !== undefined) {
                  cleanFields[key] = value
                }
              })
            }
            // If there's an existing order with items, update order type instead of starting fresh
            if (currentOrder?.items.length) {
              updateOrderType(orderTypeSlug, {
                tableId,
                tableName,
                guestCount,
                orderTypeId,
                customFields: Object.keys(cleanFields).length > 0 ? cleanFields : undefined,
              })
            } else {
              startOrder(orderTypeSlug, {
                tableId,
                tableName,
                guestCount,
                orderTypeId,
                customFields: Object.keys(cleanFields).length > 0 ? cleanFields : undefined,
              })
            }
            setShowTablePicker(false)
          }}
          onCancel={() => setShowTablePicker(false)}
        />
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
          employeeId={employee?.id}
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
            seatNumber: item.seatNumber,
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
                  tableName: orderData.tableName || undefined,
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
            // Optionally log out or redirect
          }}
          permissions={permissionsArray}
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

      {/* POS Display Settings Modal */}
      <POSDisplaySettingsModal
        isOpen={showDisplaySettings}
        onClose={() => setShowDisplaySettings(false)}
        settings={displaySettings}
        onUpdate={updateSetting}
        onBatchUpdate={updateSettings}
      />

      {/* Category Color Picker Modal */}
      {colorPickerCategory && (
        <CategoryColorPicker
          isOpen={true}
          onClose={() => setColorPickerCategory(null)}
          categoryName={colorPickerCategory.name}
          currentColors={categoryColors[colorPickerCategory.id] || {}}
          defaultColor={colorPickerCategory.color || '#3B82F6'}
          onSave={(colors) => {
            setCategoryColor(colorPickerCategory.id, colors)
          }}
          onReset={() => {
            resetCategoryColor(colorPickerCategory.id)
          }}
        />
      )}

      {/* Menu Item Color Picker Modal */}
      {colorPickerMenuItem && (
        <MenuItemColorPicker
          isOpen={true}
          onClose={() => setColorPickerMenuItem(null)}
          itemName={colorPickerMenuItem.name}
          currentStyle={menuItemColors[colorPickerMenuItem.id] || {}}
          onSave={(style) => {
            setMenuItemStyle(colorPickerMenuItem.id, style)
          }}
          onReset={() => {
            resetMenuItemStyle(colorPickerMenuItem.id)
          }}
        />
      )}
    </div>
  )
}
