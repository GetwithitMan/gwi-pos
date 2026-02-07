'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { TopBar } from '@/components/pos/TopBar'
import { formatCurrency } from '@/lib/utils'
import { io, Socket } from 'socket.io-client'
import { OrderPanel, type OrderPanelItemData } from '@/components/orders/OrderPanel'
import { Virtuoso } from 'react-virtuoso'
import { useMenuSearch } from '@/hooks/useMenuSearch'
import { MenuSearchInput, MenuSearchResults } from '@/components/search'
import { toast } from '@/stores/toast-store'
import type { BarTabSettings } from '@/lib/settings'

interface Category {
  id: string
  name: string
  sortOrder: number
}

interface MenuItem {
  id: string
  name: string
  price: number
  categoryId: string
}

interface OpenTab {
  id: string
  orderNumber: number
  tabName: string | null
  tableName?: string | null  // For dine_in orders from tables
  tableId?: string | null
  orderType: string
  total: number
  itemCount: number
  createdAt: string
  updatedAt: string
  employeeId: string
  hasCard?: boolean  // Whether tab has a card on file
}

export default function BarPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()

  // Data state
  const [categories, setCategories] = useState<Category[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [barTabSettings, setBarTabSettings] = useState<BarTabSettings>({
    requireCardForTab: false,
    pullCustomerFromCard: true,
    allowNameOnlyTab: true,
    tabTimeoutMinutes: 240,
  })

  // Socket state
  const [isConnected, setIsConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)

  // Helper function to sort tabs by most recently updated first
  const sortTabsByRecent = (tabs: OpenTab[]): OpenTab[] => {
    return [...tabs].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  }

  // UI state
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showNewTabModal, setShowNewTabModal] = useState(false)

  // Active order state (for the permanent OrderPanel)
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null)
  const [activeOrderNumber, setActiveOrderNumber] = useState<number | undefined>()
  const [activeOrderType, setActiveOrderType] = useState<string | undefined>()
  const [activeTabName, setActiveTabName] = useState<string | undefined>()
  const [activeOrderItems, setActiveOrderItems] = useState<OrderPanelItemData[]>([])
  const [activeOrderTotals, setActiveOrderTotals] = useState({ subtotal: 0, tax: 0, discounts: 0, total: 0 })
  const [isSendingOrder, setIsSendingOrder] = useState(false)
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)

  // Menu search
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    isSearching,
    results: searchResults,
    clearSearch
  } = useMenuSearch({
    locationId: employee?.location?.id,
    menuItems: menuItems.map(item => ({
      id: item.id,
      name: item.name,
      price: Number(item.price),
      categoryId: item.categoryId,
    })),
    enabled: true
  })

  // Auth check
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/bar')
    }
  }, [isAuthenticated, router])

  // Load initial data
  useEffect(() => {
    if (!employee?.location?.id) return

    const loadData = async () => {
      try {
        setIsLoading(true)

        // Load settings
        const settingsRes = await fetch('/api/settings')
        if (settingsRes.ok) {
          const settingsData = await settingsRes.json()
          if (settingsData.settings?.barTabs) {
            setBarTabSettings(settingsData.settings.barTabs)
          }
        }

        // Load menu
        const menuRes = await fetch(`/api/menu?locationId=${employee.location.id}`)
        if (menuRes.ok) {
          const menuData = await menuRes.json()
          setCategories(menuData.categories || [])
          setMenuItems(menuData.items || [])

          // Auto-select first category
          if (menuData.categories?.length > 0) {
            setSelectedCategoryId(menuData.categories[0].id)
          }
        }

        // Load ALL open orders (bar tabs + table orders)
        const tabsRes = await fetch(`/api/orders/open?locationId=${employee.location.id}`)
        if (tabsRes.ok) {
          const tabsData = await tabsRes.json()
          // Sort tabs by most recently updated first
          const sortedTabs = sortTabsByRecent(tabsData.orders || [])
          setOpenTabs(sortedTabs)
        }
      } catch (error) {
        console.error('Failed to load bar data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [employee?.location?.id])

  // Socket.io real-time updates
  useEffect(() => {
    if (!employee?.location?.id) return

    const locationId = employee.location.id

    // Connect to socket server
    const socket = io({
      path: '/api/socket',
      query: { locationId },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    })

    socketRef.current = socket

    // Connection status handlers
    socket.on('connect', () => {
      setIsConnected(true)
      console.log('[Bar] Socket connected')
    })

    socket.on('disconnect', () => {
      setIsConnected(false)
      console.log('[Bar] Socket disconnected')
    })

    // Order event handlers
    socket.on('order:created', (data: { locationId: string; order: OpenTab }) => {
      if (data.locationId === locationId && data.order) {
        // Check if it's a bar tab
        const orderType = (data.order as any).orderType
        if (orderType === 'bar_tab') {
          console.log('[Bar] New tab created:', data.order)
          setOpenTabs(prev => {
            // Avoid duplicates
            if (prev.some(tab => tab.id === data.order.id)) {
              return prev
            }
            // Add new tab at the beginning (most recent)
            return [data.order, ...prev]
          })
        }
      }
    })

    socket.on('order:updated', (data: { locationId: string; order: OpenTab }) => {
      if (data.locationId === locationId && data.order) {
        console.log('[Bar] Tab updated:', data.order)
        setOpenTabs(prev => {
          // Update existing tab or add if doesn't exist
          const exists = prev.some(tab => tab.id === data.order.id)
          if (exists) {
            // Update and re-sort by most recent
            return sortTabsByRecent(
              prev.map(tab => (tab.id === data.order.id ? { ...tab, ...data.order } : tab))
            )
          } else {
            // New tab - add at beginning
            return [data.order, ...prev]
          }
        })
      }
    })

    socket.on('order:closed', (data: { locationId: string; orderId: string }) => {
      if (data.locationId === locationId && data.orderId) {
        console.log('[Bar] Tab closed:', data.orderId)
        setOpenTabs(prev => prev.filter(tab => tab.id !== data.orderId))
      }
    })

    // Cleanup on unmount
    return () => {
      console.log('[Bar] Cleaning up socket')
      socket.off('connect')
      socket.off('disconnect')
      socket.off('order:created')
      socket.off('order:updated')
      socket.off('order:closed')
      socket.disconnect()
      socketRef.current = null
    }
  }, [employee?.location?.id])

  // Close search when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        clearSearch()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [clearSearch])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && searchQuery) {
        clearSearch()
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        const searchInput = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement
        searchInput?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [searchQuery, clearSearch])

  // Handle quick tab creation
  const handleQuickTab = async () => {
    if (!employee?.location?.id) return

    // Check if card is required for tabs
    if (barTabSettings.requireCardForTab) {
      toast.warning('Card required to start tab. Please swipe card first.')
      // TODO: Show card swipe modal (future task)
      return
    }

    try {
      const tabName = `Quick Tab ${new Date().toLocaleTimeString()}`
      const tempId = 'temp-' + Date.now()

      // Optimistic update
      const optimisticTab: OpenTab = {
        id: tempId,
        orderNumber: 0,
        tabName,
        orderType: 'bar_tab',
        total: 0,
        itemCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        employeeId: employee.id,
        hasCard: false,  // Quick tabs don't have cards yet
      }
      setOpenTabs(prev => [optimisticTab, ...prev])
      setSelectedTabId(tempId)

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: employee.location.id,
          employeeId: employee.id,
          orderType: 'bar_tab',
          tabName,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const newTab: OpenTab = {
          id: data.order.id,
          orderNumber: data.order.orderNumber,
          tabName: data.order.tabName,
          orderType: data.order.orderType || 'bar_tab',
          total: 0,
          itemCount: 0,
          createdAt: data.order.createdAt,
          updatedAt: data.order.updatedAt || data.order.createdAt,
          employeeId: data.order.employeeId || employee.id,
          hasCard: false,  // Quick tabs don't have cards yet
        }
        // Replace optimistic tab with real data
        setOpenTabs(prev => prev.map(tab => (tab.id === tempId ? newTab : tab)))
        setSelectedTabId(newTab.id)
        // Socket will broadcast to all other clients
      } else {
        // Rollback optimistic update on error
        setOpenTabs(prev => prev.filter(tab => tab.id !== tempId))
        setSelectedTabId(null)
      }
    } catch (error) {
      console.error('Failed to create quick tab:', error)
      // Rollback on error
      setOpenTabs(prev => prev.filter(tab => !tab.id.startsWith('temp-')))
      setSelectedTabId(null)
    }
  }

  // Handle adding item to selected tab
  const handleAddItem = async (item: MenuItem) => {
    if (!selectedTabId) {
      // No tab selected - create quick tab first
      await handleQuickTab()
      // Note: In production, you'd want to wait for tab creation then add item
      return
    }

    try {
      // Optimistic update - update the tab's total and item count locally
      setOpenTabs(prev =>
        sortTabsByRecent(
          prev.map(tab =>
            tab.id === selectedTabId
              ? {
                  ...tab,
                  total: tab.total + item.price,
                  itemCount: tab.itemCount + 1,
                  updatedAt: new Date().toISOString(),
                }
              : tab
          )
        )
      )

      const res = await fetch(`/api/orders/${selectedTabId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            {
              menuItemId: item.id,
              quantity: 1,
              unitPrice: item.price,
              name: item.name,
            },
          ],
        }),
      })

      if (res.ok) {
        // If this tab is showing in the OrderPanel, refresh it
        if (selectedTabId === activeOrderId) {
          await loadOrderForPanel(selectedTabId)
        }
      } else {
        // Rollback optimistic update on error
        await refreshTabs()
      }
      // Socket will sync the real data across all clients
    } catch (error) {
      console.error('Failed to add item:', error)
      // Rollback on error
      await refreshTabs()
    }
  }

  // Handle search result selection
  const handleSearchSelect = (item: { id: string; name: string; price: number; categoryId: string }) => {
    const menuItem = menuItems.find(m => m.id === item.id)
    if (menuItem) {
      handleAddItem(menuItem)
      clearSearch()
    }
  }

  // Load full order data into the permanent OrderPanel
  const loadOrderForPanel = async (tabId: string) => {
    try {
      const res = await fetch(`/api/orders/${tabId}`)
      if (!res.ok) {
        console.error('Failed to load order for panel')
        return
      }

      const data = await res.json()
      const order = data.order

      setActiveOrderId(order.id)
      setActiveOrderNumber(order.orderNumber)
      setActiveOrderType(order.orderType)
      setActiveTabName(order.tabName)

      // Map order items to OrderPanelItemData format
      const items: OrderPanelItemData[] = (order.items || []).map((item: any) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        price: Number(item.unitPrice),
        modifiers: (item.modifiers || []).map((mod: any) => ({
          name: mod.name,
          price: Number(mod.price),
        })),
        specialNotes: item.specialNotes,
        kitchenStatus: item.isCompleted ? 'ready' : item.sentToKitchen ? 'sent' : 'pending',
        isHeld: item.isHeld,
        isTimedRental: item.isTimedRental || false,
        menuItemId: item.menuItemId,
        blockTimeMinutes: item.blockTimeMinutes ?? undefined,
        blockTimeStartedAt: item.blockTimeStartedAt ?? undefined,
        blockTimeExpiresAt: item.blockTimeExpiresAt ?? undefined,
        seatNumber: item.seatNumber ?? undefined,
        courseNumber: item.courseNumber ?? undefined,
        courseStatus: item.courseStatus ?? undefined,
        sentToKitchen: item.sentToKitchen ?? false,
        resendCount: item.resendCount ?? undefined,
        completedAt: item.completedAt ?? undefined,
        createdAt: item.createdAt ?? undefined,
      }))

      setActiveOrderItems(items)
      setActiveOrderTotals({
        subtotal: Number(order.subtotal || 0),
        tax: Number(order.tax || 0),
        discounts: Number(order.discounts || 0),
        total: Number(order.total || 0),
      })
    } catch (error) {
      console.error('Failed to load order for panel:', error)
    }
  }

  // Handle payment — loads tab into panel so the inline Datacap processor can be used
  const handlePayTab = (tabId: string) => {
    setSelectedTabId(tabId)
    loadOrderForPanel(tabId)
  }

  // Send order to kitchen
  const handleSendToKitchen = async () => {
    if (!activeOrderId) return
    setIsSendingOrder(true)
    try {
      const res = await fetch(`/api/orders/${activeOrderId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: employee?.id }),
      })
      if (res.ok) {
        toast.success('Order sent to kitchen')
        await loadOrderForPanel(activeOrderId)
      } else {
        toast.error('Failed to send order')
      }
    } catch (error) {
      console.error('Send to kitchen failed:', error)
      toast.error('Failed to send order')
    } finally {
      setIsSendingOrder(false)
    }
  }

  // Remove item from order
  const handleRemoveItem = async (itemId: string) => {
    if (!activeOrderId) return
    try {
      const res = await fetch(`/api/orders/${activeOrderId}/items/${itemId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setActiveOrderItems(prev => prev.filter(item => item.id !== itemId))
        await loadOrderForPanel(activeOrderId)
        await refreshTabs()
      }
    } catch (error) {
      console.error('Failed to remove item:', error)
    }
  }

  // Update item quantity
  const handleQuantityChange = async (itemId: string, delta: number) => {
    if (!activeOrderId) return
    const item = activeOrderItems.find(i => i.id === itemId)
    if (!item) return
    const newQty = item.quantity + delta
    if (newQty < 1) {
      await handleRemoveItem(itemId)
      return
    }
    try {
      const res = await fetch(`/api/orders/${activeOrderId}/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: newQty }),
      })
      if (res.ok) {
        setActiveOrderItems(prev => prev.map(i =>
          i.id === itemId ? { ...i, quantity: newQty } : i
        ))
        await loadOrderForPanel(activeOrderId)
        await refreshTabs()
      }
    } catch (error) {
      console.error('Failed to update quantity:', error)
    }
  }

  // Clear the active order from the panel (deselect)
  const handleClearPanel = () => {
    setActiveOrderId(null)
    setActiveOrderNumber(undefined)
    setActiveOrderType(undefined)
    setActiveTabName(undefined)
    setActiveOrderItems([])
    setActiveOrderTotals({ subtotal: 0, tax: 0, discounts: 0, total: 0 })
    setSelectedTabId(null)
  }

  // Toggle hold on an item
  const handleHoldToggle = async (itemId: string) => {
    if (!activeOrderId) return
    const item = activeOrderItems.find(i => i.id === itemId)
    if (!item) return
    try {
      const res = await fetch(`/api/orders/${activeOrderId}/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isHeld: !item.isHeld }),
      })
      if (res.ok) {
        setActiveOrderItems(prev => prev.map(i =>
          i.id === itemId ? { ...i, isHeld: !i.isHeld } : i
        ))
      }
    } catch (error) {
      console.error('Failed to toggle hold:', error)
    }
  }

  // Edit note on an item
  const handleNoteEdit = async (itemId: string, currentNote?: string) => {
    const note = window.prompt('Kitchen note:', currentNote || '')
    if (note === null) return
    if (!activeOrderId) return
    try {
      const res = await fetch(`/api/orders/${activeOrderId}/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specialNotes: note || null }),
      })
      if (res.ok) {
        setActiveOrderItems(prev => prev.map(i =>
          i.id === itemId ? { ...i, specialNotes: note || undefined } : i
        ))
      }
    } catch (error) {
      console.error('Failed to update note:', error)
    }
  }

  // Change course on an item
  const handleCourseChange = async (itemId: string, course: number | null) => {
    if (!activeOrderId) return
    try {
      const res = await fetch(`/api/orders/${activeOrderId}/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseNumber: course }),
      })
      if (res.ok) {
        setActiveOrderItems(prev => prev.map(i =>
          i.id === itemId ? { ...i, courseNumber: course ?? undefined } : i
        ))
      }
    } catch (error) {
      console.error('Failed to update course:', error)
    }
  }

  // Change seat assignment on an item
  const handleSeatChange = async (itemId: string, seat: number | null) => {
    if (!activeOrderId) return
    try {
      const res = await fetch(`/api/orders/${activeOrderId}/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seatNumber: seat }),
      })
      if (res.ok) {
        setActiveOrderItems(prev => prev.map(i =>
          i.id === itemId ? { ...i, seatNumber: seat ?? undefined } : i
        ))
      }
    } catch (error) {
      console.error('Failed to update seat:', error)
    }
  }

  // Toggle expanded ▶ More controls for an item
  const handleToggleExpand = (itemId: string) => {
    setExpandedItemId(prev => prev === itemId ? null : itemId)
  }

  // Edit modifiers on an item
  const handleEditModifiers = (itemId: string) => {
    // TODO: Open modifier edit modal for this item
    toast.info('Modifier editing coming soon')
  }

  // Comp/Void an item
  const handleCompVoid = (itemId: string) => {
    // TODO: Open comp/void modal for this item
    toast.info('Comp/Void coming soon')
  }

  // Resend item to kitchen
  const handleResend = async (itemId: string) => {
    if (!activeOrderId) return
    try {
      const res = await fetch(`/api/orders/${activeOrderId}/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resendToKitchen: true }),
      })
      if (res.ok) {
        toast.success('Item resent to kitchen')
        await loadOrderForPanel(activeOrderId)
      } else {
        toast.error('Failed to resend item')
      }
    } catch (error) {
      console.error('Failed to resend item:', error)
      toast.error('Failed to resend item')
    }
  }

  // Split item to another check
  const handleSplit = (itemId: string) => {
    // TODO: Open split ticket manager
    toast.info('Split check coming soon')
  }

  // Helper to refresh tabs list
  const refreshTabs = async () => {
    if (!employee?.location?.id) return
    try {
      const tabsRes = await fetch(`/api/orders/open?locationId=${employee.location.id}`)
      if (tabsRes.ok) {
        const tabsData = await tabsRes.json()
        setOpenTabs(sortTabsByRecent(tabsData.orders || []))
      }
    } catch (error) {
      console.error('Failed to refresh tabs:', error)
    }
  }

  // Filter items by selected category
  const filteredItems = selectedCategoryId
    ? menuItems.filter(item => item.categoryId === selectedCategoryId)
    : menuItems

  if (!isAuthenticated) return null

  // TopBar handlers (placeholders for now)
  const handleOpenAdminNav = () => {
    // TODO: Implement admin navigation
  }

  const handleOpenTimeClock = () => {
    // TODO: Implement time clock modal
  }

  const handleOpenDrawer = () => {
    // TODO: Implement drawer modal
  }

  const handleLogout = () => {
    router.push('/login')
  }

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* TopBar */}
      {employee && (
        <TopBar
          employee={{
            id: employee.id,
            name: employee.displayName,
            role: employee.role,
          }}
          currentRoute="bar"
          onOpenAdminNav={handleOpenAdminNav}
          onOpenNewTab={handleQuickTab}
          onOpenTimeClock={handleOpenTimeClock}
          onOpenDrawer={handleOpenDrawer}
          onLogout={handleLogout}
        />
      )}

      {/* Search Bar */}
      <div className="px-4 py-2 bg-gray-900 border-b border-gray-800" ref={searchContainerRef}>
        <div className="relative max-w-xl mx-auto">
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
          />
        </div>
      </div>

      {/* Main Content - 3 Column Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side - Categories + Items */}
        <div className="flex-1 flex flex-col p-4 overflow-hidden">
          {/* Categories - Horizontal */}
          <div className="mb-4 flex gap-2 overflow-x-auto pb-2">
            {categories.map(category => (
              <button
                key={category.id}
                onClick={() => setSelectedCategoryId(category.id)}
                className={`px-6 py-3 rounded-lg font-medium whitespace-nowrap transition-colors ${
                  selectedCategoryId === category.id
                    ? 'bg-blue-500 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {category.name}
              </button>
            ))}
          </div>

          {/* Items Grid */}
          <div className="flex-1 overflow-y-auto">
            {searchQuery ? (
              <div className="flex items-center justify-center h-full text-gray-500">
                <p>Use the search results above to find items</p>
              </div>
            ) : isLoading ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-500">Loading menu...</p>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-500">No items in this category</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredItems.map(item => (
                  <button
                    key={item.id}
                    onClick={() => handleAddItem(item)}
                    className="bg-white rounded-lg p-4 shadow hover:shadow-lg transition-shadow text-left min-h-[64px] flex flex-col justify-between"
                  >
                    <div className="font-medium text-gray-900">{item.name}</div>
                    <div className="text-blue-600 font-bold mt-2">
                      {formatCurrency(item.price)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Middle - Tabs List */}
        <div className="w-72 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col">
          <div className="p-4 border-b bg-gray-50">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Open Tabs</h2>
              {/* Connection status indicator */}
              {isConnected ? (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                  Live
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-red-600">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  Offline
                </span>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-hidden">
            {openTabs.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No open tabs</p>
            ) : (
              <Virtuoso
                style={{ height: '100%' }}
                data={openTabs}
                overscan={10}
                itemContent={(_index, tab) => {
                  const isMyTab = tab.employeeId === employee?.id
                  const isSelected = selectedTabId === tab.id

                  return (
                    <div className="px-3 py-1.5">
                      <div
                        className={`p-3 rounded-lg border-2 transition-all cursor-pointer ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50'
                            : isMyTab
                            ? 'border-emerald-500/50 bg-white hover:border-emerald-500 shadow-lg shadow-emerald-500/20'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                        onClick={() => {
                          setSelectedTabId(tab.id)
                          loadOrderForPanel(tab.id)
                        }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="font-medium text-gray-900 text-sm">
                            {tab.tableName || tab.tabName || `Tab #${tab.orderNumber}`}
                          </div>
                          <div className="flex items-center gap-1">
                            {tab.orderType === 'dine_in' && (
                              <span className="text-[10px] bg-indigo-500/30 text-indigo-700 px-1.5 py-0.5 rounded font-medium" title="Table order">
                                🍽️
                              </span>
                            )}
                            {isMyTab && (
                              <span className="text-[10px] bg-emerald-500/30 text-emerald-700 px-1.5 py-0.5 rounded font-medium">
                                Mine
                              </span>
                            )}
                            {tab.hasCard && (
                              <span className="text-[10px] bg-blue-500/30 text-blue-700 px-1.5 py-0.5 rounded font-medium" title="Card on file">
                                💳
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-sm text-gray-500 mb-2">
                          {formatCurrency(tab.total)} • {tab.itemCount} items
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handlePayTab(tab.id)
                            }}
                            className="flex-1 px-3 py-2 bg-green-500 hover:bg-green-600 text-white rounded text-sm font-medium"
                          >
                            Pay
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                }}
              />
            )}
          </div>

          {/* Quick Tab Button */}
          <div className="p-3 border-t bg-gray-50">
            <button
              onClick={handleQuickTab}
              className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors min-h-[56px]"
            >
              + QUICK TAB
            </button>
          </div>
        </div>

        {/* Right Panel - Permanent OrderPanel (matches order-entry exactly) */}
        <div className="w-96 flex-shrink-0 flex flex-col h-full overflow-hidden">
          {/* OrderPanel — full functionality, identical to orders page */}
          <OrderPanel
            orderId={activeOrderId}
            orderNumber={activeOrderNumber}
            orderType={activeOrderType}
            tabName={activeTabName}
            locationId={employee?.location?.id}
            items={activeOrderItems}
            subtotal={activeOrderTotals.subtotal}
            tax={activeOrderTotals.tax}
            discounts={activeOrderTotals.discounts}
            total={activeOrderTotals.total}
            showItemControls={true}
            showEntertainmentTimers={true}
            onItemRemove={handleRemoveItem}
            onQuantityChange={handleQuantityChange}
            onSend={handleSendToKitchen}
            onDiscount={() => { /* TODO: wire discount modal */ }}
            onClear={handleClearPanel}
            onItemHoldToggle={handleHoldToggle}
            onItemNoteEdit={handleNoteEdit}
            onItemCourseChange={handleCourseChange}
            onItemEditModifiers={handleEditModifiers}
            onItemCompVoid={handleCompVoid}
            onItemResend={handleResend}
            onItemSplit={handleSplit}
            expandedItemId={expandedItemId}
            onItemToggleExpand={handleToggleExpand}
            onItemSeatChange={handleSeatChange}
            isSending={isSendingOrder}
            className="flex-1"
            terminalId="terminal-1"
            employeeId={employee?.id}
            onPaymentSuccess={async (result) => {
              toast.success(`Payment approved! Card: ****${result.cardLast4 || '****'}`)

              // Record the payment in the database and mark order as paid/closed
              if (activeOrderId) {
                try {
                  await fetch(`/api/orders/${activeOrderId}/pay`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      payments: [{
                        method: 'credit',
                        amount: activeOrderTotals.total,
                        tipAmount: result.tipAmount || 0,
                        cardBrand: result.cardBrand,
                        cardLast4: result.cardLast4,
                      }],
                      employeeId: employee?.id,
                    }),
                  })
                } catch (err) {
                  console.error('[BarPage] Failed to record payment:', err)
                }
              }

              // Refresh tabs and clear panel after payment
              refreshTabs()
              handleClearPanel()
            }}
          />
        </div>
      </div>
    </div>
  )
}
