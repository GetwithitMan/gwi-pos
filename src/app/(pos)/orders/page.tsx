'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useOrderStore } from '@/stores/order-store'
import { formatCurrency, formatTime } from '@/lib/utils'
import { calculateCardPrice } from '@/lib/pricing'
import { PaymentModal } from '@/components/payment/PaymentModal'
import { OpenOrdersPanel, type OpenOrder } from '@/components/orders/OpenOrdersPanel'
import { NewTabModal } from '@/components/tabs/NewTabModal'
import { TabDetailModal } from '@/components/tabs/TabDetailModal'
import type { DualPricingSettings, PaymentSettings } from '@/lib/settings'

interface Category {
  id: string
  name: string
  color: string
}

interface MenuItem {
  id: string
  categoryId: string
  name: string
  price: number
  isAvailable: boolean
  modifierGroupCount?: number
}

interface ModifierGroup {
  id: string
  name: string
  displayName?: string
  minSelections: number
  maxSelections: number
  isRequired: boolean
  modifiers: {
    id: string
    name: string
    price: number
    upsellPrice?: number | null
    allowedPreModifiers?: string[] | null
    extraPrice?: number | null
    isDefault: boolean
    childModifierGroupId?: string | null
  }[]
}

interface SelectedModifier {
  id: string
  name: string
  price: number
  preModifier?: string
  childModifierGroupId?: string | null
  depth: number  // 0 = top-level, 1 = child, 2 = grandchild, etc.
  parentModifierId?: string  // ID of parent modifier if this is a child
}

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

  // Dual pricing state
  const [dualPricing, setDualPricing] = useState<DualPricingSettings>({
    enabled: true,
    model: 'card_surcharge',
    cardSurchargePercent: 4.0,
    applyToCredit: true,
    applyToDebit: true,
    showBothPrices: true,
    showSavingsMessage: true,
  })
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings>({
    acceptCash: true,
    acceptCredit: true,
    acceptDebit: true,
    acceptGiftCards: false,
    acceptHouseAccounts: false,
    cashRounding: 'none',
    roundingDirection: 'nearest',
    enablePreAuth: true,
    defaultPreAuthAmount: 50,
    preAuthExpirationDays: 7,
    processor: 'none',
    testMode: true,
  })
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash')

  // Payment modal state
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [orderToPayId, setOrderToPayId] = useState<string | null>(null)

  // Tabs panel state
  const [showTabsPanel, setShowTabsPanel] = useState(false)
  const [showNewTabModal, setShowNewTabModal] = useState(false)
  const [showTabDetailModal, setShowTabDetailModal] = useState(false)
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null)
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

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login')
    }
  }, [isAuthenticated, router])

  useEffect(() => {
    loadMenu()
    loadSettings()
  }, [])

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

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/settings')
      if (response.ok) {
        const data = await response.json()
        if (data.dualPricing) {
          setDualPricing(data.dualPricing)
        }
        if (data.payments) {
          setPaymentSettings(data.payments)
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }

  useEffect(() => {
    if (!currentOrder) {
      startOrder('dine_in', { guestCount: 1 })
    }
  }, [currentOrder, startOrder])

  const loadMenu = async () => {
    try {
      const response = await fetch('/api/menu')
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
      setShowPaymentModal(true)
    }
  }

  const handlePaymentComplete = () => {
    setShowPaymentModal(false)
    setOrderToPayId(null)
    setSavedOrderId(null)
    setOrderSent(false)
    clearOrder()
    setTabsRefreshTrigger(prev => prev + 1)
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

  const handleAddItem = async (item: MenuItem) => {
    if (!item.isAvailable) return

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

  // Helper to format dual price display
  const formatDualPrice = (cashPrice: number) => {
    if (!dualPricing.enabled || !dualPricing.showBothPrices) {
      return formatCurrency(cashPrice)
    }
    const cardPrice = calculateCardPrice(cashPrice, dualPricing.cardSurchargePercent)
    return (
      <span className="flex flex-col items-center text-xs">
        <span className="text-green-600">{formatCurrency(cashPrice)} cash</span>
        <span className="text-gray-500">{formatCurrency(cardPrice)} card</span>
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
                router.push('/reports/commission')
                setShowMenu(false)
              }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Commission Report
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
            {filteredItems.map(item => (
              <Button
                key={item.id}
                variant="outline"
                className="h-28 flex flex-col items-center justify-center gap-1 hover:bg-blue-50 hover:border-blue-500"
                onClick={() => handleAddItem(item)}
              >
                <span className="font-semibold text-gray-900 text-center leading-tight">{item.name}</span>
                {formatDualPrice(item.price)}
              </Button>
            ))}
            {unavailableItems.map(item => (
              <Button
                key={item.id}
                variant="outline"
                className="h-28 flex flex-col items-center justify-center gap-1 opacity-50 cursor-not-allowed relative"
                disabled
              >
                <span className="font-semibold text-gray-900 text-center leading-tight">{item.name}</span>
                {formatDualPrice(item.price)}
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
              // Show order identifier for existing orders
              <div>
                <h2 className="font-semibold text-lg">
                  {currentOrder.tabName || `Order #${currentOrder.orderNumber || savedOrderId.slice(-6).toUpperCase()}`}
                </h2>
                <span className="text-sm text-gray-500 capitalize">
                  {currentOrder.orderType.replace('_', ' ')}
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
            <div className="text-center text-gray-400 py-8">
              <p>No items yet</p>
              <p className="text-sm">Tap menu items to add</p>
            </div>
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
                                onClick={() => alert(`Resend "${item.name}" to kitchen\n\n(KDS integration coming soon)`)}
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
                            {item.sentToKitchen && (
                              <span className="ml-2 text-xs text-green-600 font-normal">Sent</span>
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
                        <button
                          className="text-red-500 hover:text-red-700 p-1"
                          onClick={() => removeItem(item.id)}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>

        {/* Payment Method Toggle */}
        {dualPricing.enabled && (
          <div className="border-t p-3 bg-gray-50">
            <div className="flex gap-2">
              <Button
                variant={paymentMethod === 'cash' ? 'primary' : 'ghost'}
                size="sm"
                className={`flex-1 ${paymentMethod === 'cash' ? 'bg-green-600 hover:bg-green-700' : ''}`}
                onClick={() => setPaymentMethod('cash')}
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                Cash
              </Button>
              <Button
                variant={paymentMethod === 'card' ? 'primary' : 'ghost'}
                size="sm"
                className="flex-1"
                onClick={() => setPaymentMethod('card')}
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                Card (+{dualPricing.cardSurchargePercent}%)
              </Button>
            </div>
          </div>
        )}

        {/* Order Totals */}
        <div className="border-t p-4 space-y-2">
          {(() => {
            const subtotal = currentOrder?.subtotal || 0
            const cardSubtotal = dualPricing.enabled && paymentMethod === 'card'
              ? calculateCardPrice(subtotal, dualPricing.cardSurchargePercent)
              : subtotal
            const discount = currentOrder?.discountTotal || 0
            const taxableAmount = cardSubtotal - discount
            const tax = taxableAmount * 0.08
            const total = taxableAmount + tax

            return (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Subtotal</span>
                  <div className="text-right">
                    {dualPricing.enabled && paymentMethod === 'card' && subtotal !== cardSubtotal ? (
                      <>
                        <span className="line-through text-gray-400 mr-2">{formatCurrency(subtotal)}</span>
                        <span>{formatCurrency(cardSubtotal)}</span>
                      </>
                    ) : (
                      <span>{formatCurrency(subtotal)}</span>
                    )}
                  </div>
                </div>
                {dualPricing.enabled && paymentMethod === 'card' && (
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>Card surcharge ({dualPricing.cardSurchargePercent}%)</span>
                    <span>+{formatCurrency(cardSubtotal - subtotal)}</span>
                  </div>
                )}
                {discount > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Discount</span>
                    <span>-{formatCurrency(discount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Tax (8%)</span>
                  <span>{formatCurrency(tax)}</span>
                </div>
                <div className="flex justify-between font-bold text-lg pt-2 border-t">
                  <span>Total</span>
                  <span className={paymentMethod === 'cash' && dualPricing.enabled ? 'text-green-600' : ''}>
                    {formatCurrency(total)}
                  </span>
                </div>
                {dualPricing.enabled && dualPricing.showSavingsMessage && paymentMethod === 'cash' && subtotal > 0 && (
                  <div className="text-xs text-green-600 text-center">
                    You save {formatCurrency(calculateCardPrice(subtotal, dualPricing.cardSurchargePercent) - subtotal)} by paying with cash!
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
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="md"
              disabled={!currentOrder?.items.length}
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
          }}
          orderId={orderToPayId}
          orderTotal={(() => {
            const subtotal = currentOrder?.subtotal || 0
            const cardSubtotal = dualPricing.enabled && paymentMethod === 'card'
              ? calculateCardPrice(subtotal, dualPricing.cardSurchargePercent)
              : subtotal
            const discount = currentOrder?.discountTotal || 0
            const taxableAmount = cardSubtotal - discount
            const tax = taxableAmount * 0.08
            return taxableAmount + tax
          })()}
          remainingBalance={(() => {
            const subtotal = currentOrder?.subtotal || 0
            const cardSubtotal = dualPricing.enabled && paymentMethod === 'card'
              ? calculateCardPrice(subtotal, dualPricing.cardSurchargePercent)
              : subtotal
            const discount = currentOrder?.discountTotal || 0
            const taxableAmount = cardSubtotal - discount
            const tax = taxableAmount * 0.08
            return taxableAmount + tax
          })()}
          dualPricing={dualPricing}
          paymentSettings={paymentSettings}
          onPaymentComplete={handlePaymentComplete}
        />
      )}
    </div>
  )
}

// Modifier Selection Modal Component with nested child support
function ModifierModal({
  item,
  modifierGroups,
  loading,
  editingItem,
  dualPricing,
  onConfirm,
  onCancel,
  initialNotes,
}: {
  item: MenuItem
  modifierGroups: ModifierGroup[]
  loading: boolean
  editingItem?: {
    id: string
    menuItemId: string
    modifiers: { id: string; name: string; price: number; preModifier?: string; depth: number; parentModifierId?: string }[]
  } | null
  dualPricing: DualPricingSettings
  onConfirm: (modifiers: SelectedModifier[], specialNotes?: string) => void
  onCancel: () => void
  initialNotes?: string
}) {
  // Helper to format price with dual pricing
  const formatModPrice = (price: number) => {
    if (price === 0) return 'Included'
    if (!dualPricing.enabled || !dualPricing.showBothPrices) {
      return `+${formatCurrency(price)}`
    }
    const cardPrice = calculateCardPrice(price, dualPricing.cardSurchargePercent)
    return (
      <span className="text-xs">
        <span className="text-green-600">+{formatCurrency(price)}</span>
        <span className="text-gray-400"> / </span>
        <span className="text-gray-500">+{formatCurrency(cardPrice)}</span>
      </span>
    )
  }
  // All selections keyed by groupId
  const [selections, setSelections] = useState<Record<string, SelectedModifier[]>>({})
  // Cache of loaded child modifier groups
  const [childGroups, setChildGroups] = useState<Record<string, ModifierGroup>>({})
  // Track which child groups are currently loading
  const [loadingChildren, setLoadingChildren] = useState<Record<string, boolean>>({})
  // Track if we've initialized from editing item
  const [initialized, setInitialized] = useState(false)
  // Special notes/instructions for the item
  const [specialNotes, setSpecialNotes] = useState(initialNotes || '')

  // Initialize with existing modifiers when editing, or defaults for new items
  useEffect(() => {
    if (initialized || modifierGroups.length === 0) return

    const initial: Record<string, SelectedModifier[]> = {}

    if (editingItem && editingItem.modifiers.length > 0) {
      // Pre-populate from existing order item modifiers
      // We need to match modifiers to their groups
      editingItem.modifiers.forEach(existingMod => {
        // Find which group this modifier belongs to
        for (const group of modifierGroups) {
          const matchingMod = group.modifiers.find(m => m.id === existingMod.id)
          if (matchingMod) {
            if (!initial[group.id]) initial[group.id] = []
            initial[group.id].push({
              id: existingMod.id,
              name: matchingMod.name, // Use the original name without preModifier
              price: existingMod.price,
              preModifier: existingMod.preModifier,
              childModifierGroupId: matchingMod.childModifierGroupId,
              depth: existingMod.depth || 0,
              parentModifierId: existingMod.parentModifierId,
            })
            break
          }
        }
        // Also check child groups that might already be loaded
        for (const [groupId, childGroup] of Object.entries(childGroups)) {
          const matchingMod = childGroup.modifiers.find(m => m.id === existingMod.id)
          if (matchingMod) {
            if (!initial[groupId]) initial[groupId] = []
            initial[groupId].push({
              id: existingMod.id,
              name: matchingMod.name,
              price: existingMod.price,
              preModifier: existingMod.preModifier,
              childModifierGroupId: matchingMod.childModifierGroupId,
              depth: existingMod.depth || 0,
              parentModifierId: existingMod.parentModifierId,
            })
            break
          }
        }
      })
    } else {
      // New item - use defaults
      modifierGroups.forEach(group => {
        const defaults = group.modifiers
          .filter(mod => mod.isDefault)
          .map(mod => ({
            id: mod.id,
            name: mod.name,
            price: mod.price,
            childModifierGroupId: mod.childModifierGroupId,
            depth: 0,
            parentModifierId: undefined,
          }))
        if (defaults.length > 0) {
          initial[group.id] = defaults
        }
      })
    }

    setSelections(initial)
    setInitialized(true)
  }, [modifierGroups, editingItem, childGroups, initialized])

  // Load a child modifier group by ID
  const loadChildGroup = async (groupId: string) => {
    if (childGroups[groupId] || loadingChildren[groupId]) return

    setLoadingChildren(prev => ({ ...prev, [groupId]: true }))
    try {
      const response = await fetch(`/api/menu/modifiers/${groupId}`)
      if (response.ok) {
        const data = await response.json()
        setChildGroups(prev => ({ ...prev, [groupId]: data }))
      }
    } catch (error) {
      console.error('Failed to load child modifier group:', error)
    } finally {
      setLoadingChildren(prev => ({ ...prev, [groupId]: false }))
    }
  }

  // When a modifier with a child is selected, load the child group
  useEffect(() => {
    Object.values(selections).flat().forEach(sel => {
      if (sel.childModifierGroupId && !childGroups[sel.childModifierGroupId]) {
        loadChildGroup(sel.childModifierGroupId)
      }
    })
  }, [selections])

  // When editing, match child modifiers once their groups are loaded
  useEffect(() => {
    if (!editingItem || !initialized) return

    // Find unmatched child modifiers (depth > 0 that aren't yet in selections)
    const unmatchedChildMods = editingItem.modifiers.filter(existingMod => {
      if ((existingMod.depth || 0) === 0) return false // Skip top-level
      // Check if already matched
      for (const sels of Object.values(selections)) {
        if (sels.some(s => s.id === existingMod.id)) return false
      }
      return true
    })

    if (unmatchedChildMods.length === 0) return

    // Try to match them to loaded child groups
    const newSelections = { ...selections }
    let changed = false

    unmatchedChildMods.forEach(existingMod => {
      for (const [groupId, childGroup] of Object.entries(childGroups)) {
        const matchingMod = childGroup.modifiers.find(m => m.id === existingMod.id)
        if (matchingMod) {
          if (!newSelections[groupId]) newSelections[groupId] = []
          // Check if not already added
          if (!newSelections[groupId].some(s => s.id === existingMod.id)) {
            newSelections[groupId].push({
              id: existingMod.id,
              name: matchingMod.name,
              price: existingMod.price,
              preModifier: existingMod.preModifier,
              childModifierGroupId: matchingMod.childModifierGroupId,
              depth: existingMod.depth || 0,
              parentModifierId: existingMod.parentModifierId,
            })
            changed = true
          }
          break
        }
      }
    })

    if (changed) {
      setSelections(newSelections)
    }
  }, [childGroups, editingItem, initialized, selections])

  // Calculate the depth of a group (0 for top-level, 1+ for children)
  const getGroupDepth = (groupId: string): number => {
    // Check if this is a top-level group
    if (modifierGroups.some(g => g.id === groupId)) {
      return 0
    }
    // It's a child group, find its parent
    for (const [parentGroupId, sels] of Object.entries(selections)) {
      for (const sel of sels) {
        if (sel.childModifierGroupId === groupId) {
          return getGroupDepth(parentGroupId) + 1
        }
      }
    }
    return 0
  }

  // Find the parent modifier ID for a group
  const getParentModifierId = (groupId: string): string | undefined => {
    for (const [, sels] of Object.entries(selections)) {
      for (const sel of sels) {
        if (sel.childModifierGroupId === groupId) {
          return sel.id
        }
      }
    }
    return undefined
  }

  const toggleModifier = (
    group: ModifierGroup,
    modifier: ModifierGroup['modifiers'][0],
    preModifier?: string
  ) => {
    const current = selections[group.id] || []
    const existingIndex = current.findIndex(s => s.id === modifier.id)

    let price = modifier.price
    if (preModifier === 'extra' && modifier.extraPrice) {
      price = modifier.extraPrice
    } else if (preModifier === 'no') {
      price = 0
    }

    // Calculate depth and parent for this modifier
    const depth = getGroupDepth(group.id)
    const parentModifierId = getParentModifierId(group.id)

    if (existingIndex >= 0) {
      // Remove if already selected - also remove any child selections
      const removedMod = current[existingIndex]
      const newSelections = { ...selections }
      newSelections[group.id] = current.filter(s => s.id !== modifier.id)

      // Remove child group selections if any
      if (removedMod.childModifierGroupId) {
        delete newSelections[removedMod.childModifierGroupId]
        // Recursively remove nested children
        const removeNestedChildren = (parentGroupId: string) => {
          const parentSelections = newSelections[parentGroupId] || []
          parentSelections.forEach(sel => {
            if (sel.childModifierGroupId) {
              delete newSelections[sel.childModifierGroupId]
              removeNestedChildren(sel.childModifierGroupId)
            }
          })
        }
        removeNestedChildren(removedMod.childModifierGroupId)
      }

      setSelections(newSelections)
    } else {
      // Add modifier with depth and parent info
      const newMod: SelectedModifier = {
        id: modifier.id,
        name: modifier.name,
        price,
        preModifier,
        childModifierGroupId: modifier.childModifierGroupId,
        depth,
        parentModifierId,
      }

      if (group.maxSelections === 1) {
        // Single select - replace and remove old child selections
        const oldSelection = current[0]
        const newSelections = { ...selections }

        if (oldSelection?.childModifierGroupId) {
          delete newSelections[oldSelection.childModifierGroupId]
        }

        newSelections[group.id] = [newMod]
        setSelections(newSelections)
      } else if (current.length < group.maxSelections) {
        // Multi-select - add if under max
        setSelections({
          ...selections,
          [group.id]: [...current, newMod],
        })
      }
    }
  }

  const updatePreModifier = (groupId: string, modifierId: string, preModifier: string, modifier: ModifierGroup['modifiers'][0]) => {
    const current = selections[groupId] || []
    const updated = current.map(s => {
      if (s.id === modifierId) {
        let price = modifier.price
        if (preModifier === 'extra' && modifier.extraPrice) {
          price = modifier.extraPrice
        } else if (preModifier === 'no') {
          price = 0
        }
        // Maintain depth and parentModifierId
        return { ...s, preModifier, price, depth: s.depth, parentModifierId: s.parentModifierId }
      }
      return s
    })
    setSelections({ ...selections, [groupId]: updated })
  }

  const isSelected = (groupId: string, modifierId: string) => {
    return (selections[groupId] || []).some(s => s.id === modifierId)
  }

  const getSelectedModifier = (groupId: string, modifierId: string) => {
    return (selections[groupId] || []).find(s => s.id === modifierId)
  }

  // Get all active child groups that should be displayed
  const getActiveChildGroups = (): { group: ModifierGroup; parentModifierName: string; depth: number }[] => {
    const result: { group: ModifierGroup; parentModifierName: string; depth: number }[] = []

    const findChildren = (groupId: string, parentName: string, depth: number) => {
      const groupSelections = selections[groupId] || []
      groupSelections.forEach(sel => {
        if (sel.childModifierGroupId && childGroups[sel.childModifierGroupId]) {
          const childGroup = childGroups[sel.childModifierGroupId]
          result.push({ group: childGroup, parentModifierName: sel.name, depth })
          // Recursively find children of children
          findChildren(sel.childModifierGroupId, sel.name, depth + 1)
        }
      })
    }

    // Start from top-level groups
    modifierGroups.forEach(group => {
      findChildren(group.id, '', 1)
    })

    return result
  }

  const canConfirm = () => {
    // Check all top-level required groups
    const topLevelOk = modifierGroups.every(group => {
      if (!group.isRequired) return true
      const selected = selections[group.id] || []
      return selected.length >= group.minSelections
    })

    // Check all active child groups that are required
    const activeChildren = getActiveChildGroups()
    const childrenOk = activeChildren.every(({ group }) => {
      if (!group.isRequired) return true
      const selected = selections[group.id] || []
      return selected.length >= group.minSelections
    })

    return topLevelOk && childrenOk
  }

  const getAllSelectedModifiers = (): SelectedModifier[] => {
    return Object.values(selections).flat()
  }

  const totalPrice = item.price + getAllSelectedModifiers().reduce((sum, mod) => sum + mod.price, 0)

  const activeChildGroups = getActiveChildGroups()

  // Render a single modifier group
  const renderModifierGroup = (group: ModifierGroup, indent: number = 0, parentLabel?: string) => (
    <div key={group.id} className={indent > 0 ? 'ml-4 pl-4 border-l-2 border-blue-200' : ''}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">
          {parentLabel && (
            <span className="text-blue-600 text-sm mr-2">{parentLabel} →</span>
          )}
          {group.displayName || group.name}
          {group.isRequired && <span className="text-red-500 ml-1">*</span>}
        </h3>
        <span className="text-sm text-gray-500">
          {group.minSelections === group.maxSelections
            ? `Select ${group.minSelections}`
            : `Select ${group.minSelections}-${group.maxSelections}`}
        </span>
      </div>
      <div className="space-y-2">
        {group.modifiers.map(modifier => {
          const selected = isSelected(group.id, modifier.id)
          const selectedMod = getSelectedModifier(group.id, modifier.id)
          const hasPreModifiers = modifier.allowedPreModifiers && modifier.allowedPreModifiers.length > 0
          const hasChild = modifier.childModifierGroupId
          const childLoading = modifier.childModifierGroupId ? loadingChildren[modifier.childModifierGroupId] : false

          return (
            <div key={modifier.id}>
              <button
                className={`w-full p-3 rounded-lg border text-left transition-colors ${
                  selected
                    ? 'bg-blue-50 border-blue-500'
                    : 'bg-white border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => toggleModifier(group, modifier)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={selected ? 'font-medium text-blue-700' : ''}>
                      {modifier.name}
                    </span>
                    {hasChild && (
                      <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                        + options
                      </span>
                    )}
                  </div>
                  <span className={modifier.price > 0 ? '' : 'text-gray-400'}>
                    {formatModPrice(modifier.price)}
                  </span>
                </div>
              </button>

              {/* Pre-modifier buttons when selected */}
              {selected && hasPreModifiers && (
                <div className="flex gap-2 mt-2 ml-4">
                  {modifier.allowedPreModifiers?.map(pre => (
                    <button
                      key={pre}
                      className={`px-3 py-1 rounded text-sm border ${
                        selectedMod?.preModifier === pre
                          ? 'bg-purple-100 border-purple-500 text-purple-700'
                          : 'bg-gray-50 border-gray-300 hover:bg-gray-100'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation()
                        updatePreModifier(group.id, modifier.id, pre, modifier)
                      }}
                    >
                      {pre.charAt(0).toUpperCase() + pre.slice(1)}
                      {pre === 'extra' && modifier.extraPrice && (
                        <span className="ml-1 text-green-600">+{formatCurrency(modifier.extraPrice)}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Loading indicator for child group */}
              {selected && hasChild && childLoading && (
                <div className="ml-4 mt-2 text-sm text-gray-500">Loading options...</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b bg-gray-50">
          <h2 className="text-xl font-bold">{item.name}</h2>
          <p className="text-gray-500">{formatCurrency(item.price)}</p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading modifiers...</div>
          ) : modifierGroups.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No modifiers available</div>
          ) : (
            <div className="space-y-6">
              {/* Top-level modifier groups */}
              {modifierGroups.map(group => renderModifierGroup(group))}

              {/* Child modifier groups (nested) */}
              {activeChildGroups.map(({ group, parentModifierName, depth }) => (
                <div key={group.id} className="pt-4 border-t">
                  {renderModifierGroup(group, depth, parentModifierName)}
                </div>
              ))}

              {/* Special Notes/Instructions */}
              <div className="pt-4 border-t">
                <label className="block font-semibold mb-2">
                  Special Instructions
                  <span className="text-gray-400 text-sm font-normal ml-2">(optional)</span>
                </label>
                <textarea
                  value={specialNotes}
                  onChange={(e) => setSpecialNotes(e.target.value)}
                  placeholder="E.g., no onions, extra sauce, allergy info..."
                  className="w-full p-3 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={2}
                  maxLength={200}
                />
                <div className="text-xs text-gray-400 text-right mt-1">
                  {specialNotes.length}/200
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <span className="font-semibold">Total</span>
            {dualPricing.enabled && dualPricing.showBothPrices ? (
              <div className="text-right">
                <div className="text-lg font-bold text-green-600">{formatCurrency(totalPrice)} cash</div>
                <div className="text-sm text-gray-500">{formatCurrency(calculateCardPrice(totalPrice, dualPricing.cardSurchargePercent))} card</div>
              </div>
            ) : (
              <span className="text-xl font-bold text-blue-600">{formatCurrency(totalPrice)}</span>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={!canConfirm()}
              onClick={() => onConfirm(getAllSelectedModifiers(), specialNotes.trim() || undefined)}
            >
              {editingItem ? 'Update Order' : 'Add to Order'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
