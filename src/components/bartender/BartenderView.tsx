'use client'

import { useEffect, useState, useCallback, useRef, useMemo, useTransition, useDeferredValue } from 'react'
import { toast } from '@/stores/toast-store'
import { usePricing } from '@/hooks/usePricing'
import { useOrderStore } from '@/stores/order-store'
import { useActiveOrder } from '@/hooks/useActiveOrder'
import { useLongPress } from '@/hooks/useLongPress'
import { hasPermission, isAdmin } from '@/lib/auth-utils'
import { useOrderEditing } from '@/hooks/useOrderEditing'
import { useTabCreation } from '@/hooks/useTabCreation'
import { useBartenderPreferences } from '@/hooks/useBartenderPreferences'
import { useBartenderOrdering } from '@/hooks/useBartenderOrdering'
import { useSocket } from '@/hooks/useSocket'
import ModeSelector from '@/components/orders/ModeSelector'
import { PricingOptionPicker } from '@/components/orders/PricingOptionPicker'
import { NewTabModal } from '@/components/bartender/NewTabModal'
import { SpiritSelectionModal } from '@/components/bartender/SpiritSelectionModal'
import { BartenderCategoryNav } from '@/components/bartender/BartenderCategoryNav'
import { BartenderFavorites } from '@/components/bartender/BartenderFavorites'
import { BartenderMenuGrid } from '@/components/bartender/BartenderMenuGrid'
import { BartenderTabPanel } from '@/components/bartender/BartenderTabPanel'
import type { FavoriteItemData } from '@/components/bartender/FavoriteItem'
import {
  type ItemCustomization,
  type BartenderMenuItem,
  COMMON_BAR_MODIFIERS,
} from '@/components/bartender/bartender-settings'
import type { CategoryFloorPlan as Category } from '@/types'

// ============================================================================
// TYPES
// ============================================================================

type MenuItem = BartenderMenuItem

// Menu sections - bar, food, or entertainment (standalone)
type MenuSection = 'bar' | 'food' | 'entertainment'

// FavoriteItem type alias for internal use
type FavoriteItem = FavoriteItemData

interface BartenderViewProps {
  locationId: string
  employeeId: string
  onOpenPayment?: (orderId: string) => void
  onOpenModifiers?: (
    item: MenuItem,
    onComplete: (modifiers: { id: string; name: string; price: number; depth?: number; preModifier?: string | null }[], ingredientModifications?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]) => void,
    existingModifiers?: { id: string; name: string; price: number; depth?: number; preModifier?: string | null }[],
    existingIngredientMods?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]
  ) => void
  onOpenCompVoid?: (item: { id: string; name: string; quantity: number; price: number; modifiers: { id: string; name: string; price: number }[]; status?: string; voidReason?: string }) => void
  employeePermissions?: string[]
  requireNameWithoutCard?: boolean
  dualPricing?: { enabled: boolean; cashDiscountPercent: number; applyToCredit: boolean; applyToDebit: boolean; showSavingsMessage: boolean }
  initialCategories?: Category[]
  initialMenuItems?: MenuItem[]
  children?: React.ReactNode
  onRegisterDeselectTab?: (fn: () => void) => void
  refreshTrigger?: number
  onSelectedTabChange?: (tabId: string | null) => void
  onOpenComboBuilder?: (item: MenuItem, onComplete: (modifiers: { id: string; name: string; price: number; depth?: number }[]) => void) => void
}

// ============================================================================
// COMPONENT
// ============================================================================

export function BartenderView({
  locationId,
  employeeId,
  onOpenPayment,
  onOpenModifiers,
  onOpenCompVoid,
  employeePermissions = [],
  requireNameWithoutCard = false,
  dualPricing = { enabled: true, cashDiscountPercent: 4.0, applyToCredit: true, applyToDebit: true, showSavingsMessage: true },
  initialCategories,
  initialMenuItems,
  children,
  onRegisterDeselectTab,
  refreshTrigger: externalRefreshTrigger,
  onSelectedTabChange,
  onOpenComboBuilder,
}: BartenderViewProps) {
  // ---------------------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------------------

  const canEditLayout = isAdmin(employeePermissions) ||
    hasPermission(employeePermissions, 'manager') ||
    hasPermission(employeePermissions, 'settings.edit') ||
    hasPermission(employeePermissions, 'settings.menu')

  // Tabs
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null)
  const [, startTabTransition] = useTransition()
  const selectedTabIdRef = useRef<string | null>(null)
  selectedTabIdRef.current = selectedTabId

  // Socket
  const { socket, isConnected } = useSocket()
  useOrderEditing(selectedTabId, locationId)

  // Tab panel expansion
  const [isTabPanelExpanded, setIsTabPanelExpanded] = useState(false)
  const [tabRefreshTrigger, setTabRefreshTrigger] = useState(0)

  // Menu section
  const [menuSection, setMenuSection] = useState<MenuSection>('bar')

  // Categories & Menu
  const [categories, setCategories] = useState<Category[]>(initialCategories || [])
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [allMenuItems, setAllMenuItems] = useState<MenuItem[]>(initialMenuItems || [])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [isLoadingMenu, setIsLoadingMenu] = useState(false)
  const [menuPage, setMenuPage] = useState(1)

  // Refs for stable callbacks
  const allMenuItemsRef = useRef(allMenuItems)
  allMenuItemsRef.current = allMenuItems
  const selectedCategoryIdRef = useRef(selectedCategoryId)
  selectedCategoryIdRef.current = selectedCategoryId

  // Sync from parent when props update
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

  // Server-synced bartender preferences
  const bartPrefs = useBartenderPreferences({ employeeId, locationId })

  // Favorites
  const favorites = bartPrefs.favorites as FavoriteItem[]
  const showFavorites = true
  const [isEditingFavorites, setIsEditingFavorites] = useState(false)

  // Category display settings
  const categorySettings = bartPrefs.categorySettings
  const [isEditingCategories, setIsEditingCategories] = useState(false)
  const categoryOrder = bartPrefs.categoryOrder
  const [draggedCategoryId, setDraggedCategoryId] = useState<string | null>(null)

  // Item display settings
  const itemSettings = bartPrefs.itemSettings
  const [isEditingItems, setIsEditingItems] = useState(false)
  const itemCustomizations = bartPrefs.itemCustomizations as Record<string, ItemCustomization>
  const itemOrder = bartPrefs.itemOrder
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)

  // Shared order hook
  const activeOrder = useActiveOrder({ locationId, employeeId })

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchExpanded, setIsSearchExpanded] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [isCategoryPending, startCategoryTransition] = useTransition()
  const deferredSearchQuery = useDeferredValue(searchQuery)

  // Hot modifier cache
  const [hotModifierCache, setHotModifierCache] = useState<Record<string, { id: string; name: string; price: number }[]>>({})
  const hotModifierFetchedCats = useRef<Set<string>>(new Set())

  // Refs
  const categoryScrollRef = useRef<HTMLDivElement>(null)
  const loadedTabIdRef = useRef<string | null>(null)

  // ---------------------------------------------------------------------------
  // ORDERING HOOK (extracted to useBartenderOrdering)
  // ---------------------------------------------------------------------------

  const ordering = useBartenderOrdering({
    locationId,
    employeeId,
    selectedTabId,
    selectedTabIdRef,
    onOpenModifiers,
    onOpenComboBuilder,
    onSelectedTabChange,
    loadedTabIdRef,
    onTabRefresh: useCallback(() => setTabRefreshTrigger(t => t + 1), []),
  })

  // ---------------------------------------------------------------------------
  // COMPUTED
  // ---------------------------------------------------------------------------

  // orderItems projection from Zustand store
  const orderItems = useMemo(() => {
    const storeItems = useOrderStore.getState().currentOrder?.items || []
    return storeItems.map(item => ({
      id: item.id,
      menuItemId: item.menuItemId,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      modifiers: item.modifiers?.map(m => ({ id: m.id, name: m.name, price: m.price, depth: m.depth, preModifier: m.preModifier })),
      specialNotes: item.specialNotes,
      sentToKitchen: item.sentToKitchen,
      isHeld: item.isHeld,
      isCompleted: item.isCompleted,
      seatNumber: item.seatNumber,
      courseNumber: item.courseNumber,
      courseStatus: item.courseStatus,
      resendCount: item.resendCount,
      blockTimeMinutes: item.blockTimeMinutes,
      blockTimeStartedAt: item.blockTimeStartedAt,
      blockTimeExpiresAt: item.blockTimeExpiresAt,
      delayMinutes: item.delayMinutes,
      delayStartedAt: item.delayStartedAt,
      delayFiredAt: item.delayFiredAt,
      status: item.status,
      voidReason: item.voidReason,
      wasMade: item.wasMade,
    }))
  }, [activeOrder.items])

  // Filter categories by section
  const filteredCategories = useMemo(() => {
    return categories.filter(cat => {
      const show = (cat.categoryShow || 'all').toLowerCase()
      if (menuSection === 'entertainment') return show === 'entertainment'
      else if (menuSection === 'bar') return show === 'bar' || show === 'all'
      else return show === 'food' || show === 'all'
    })
  }, [categories, menuSection])

  // Order categories based on custom order
  const orderedCategories = useMemo(() => {
    if (categoryOrder.length === 0) return filteredCategories
    return [...filteredCategories].sort((a, b) => {
      const aIndex = categoryOrder.indexOf(a.id)
      const bIndex = categoryOrder.indexOf(b.id)
      if (aIndex === -1 && bIndex === -1) return 0
      if (aIndex === -1) return 1
      if (bIndex === -1) return -1
      return aIndex - bIndex
    })
  }, [filteredCategories, categoryOrder])

  // Reset scroll on section change
  useEffect(() => {
    if (categoryScrollRef.current) {
      categoryScrollRef.current.scrollTo({ left: 0, behavior: 'smooth' })
    }
  }, [menuSection])

  // Order subtotal for pricing
  const orderSubtotal = useMemo(() => {
    return orderItems.reduce((sum, item) => {
      if (item.status === 'voided' || item.status === 'comped') return sum
      const itemTotal = item.price * item.quantity
      const modTotal = (item.modifiers || []).reduce((m, mod) => m + mod.price, 0) * item.quantity
      return sum + itemTotal + modTotal
    }, 0)
  }, [orderItems])

  const pricing = usePricing({ subtotal: orderSubtotal })

  // Items per row
  const effectiveItemsPerRow = useMemo(() => {
    if (itemSettings.itemsPerRow !== 'auto') return itemSettings.itemsPerRow
    switch (itemSettings.size) {
      case 'compact': return 5
      case 'normal': return 4
      case 'large': return 4
      case 'xlarge': return 3
      default: return 4
    }
  }, [itemSettings.itemsPerRow, itemSettings.size])

  const itemsPerPage = effectiveItemsPerRow * 4

  // Order menu items by custom order
  const orderedMenuItems = useMemo(() => {
    if (!selectedCategoryId) return menuItems
    const customOrder = itemOrder[selectedCategoryId]
    if (!customOrder || customOrder.length === 0) return menuItems
    return [...menuItems].sort((a, b) => {
      const aIdx = customOrder.indexOf(a.id)
      const bIdx = customOrder.indexOf(b.id)
      if (aIdx === -1 && bIdx === -1) return 0
      if (aIdx === -1) return 1
      if (bIdx === -1) return -1
      return aIdx - bIdx
    })
  }, [menuItems, selectedCategoryId, itemOrder])

  // Pagination
  const totalMenuPages = itemSettings.useScrolling ? 1 : Math.ceil(orderedMenuItems.length / itemsPerPage)
  const displayedMenuItems = useMemo(() => {
    if (itemSettings.useScrolling) return orderedMenuItems
    const start = (menuPage - 1) * itemsPerPage
    return orderedMenuItems.slice(start, start + itemsPerPage)
  }, [orderedMenuItems, menuPage, itemsPerPage, itemSettings.useScrolling])

  // Search-filtered items
  const searchFilteredItems = useMemo(() => {
    if (!deferredSearchQuery.trim()) return null
    const query = deferredSearchQuery.toLowerCase().trim()
    return allMenuItems.filter(item => item.name.toLowerCase().includes(query))
  }, [deferredSearchQuery, allMenuItems])

  const finalDisplayedItems = searchFilteredItems ?? displayedMenuItems

  // ---------------------------------------------------------------------------
  // DATA LOADING
  // ---------------------------------------------------------------------------

  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch(`/api/menu?locationId=${locationId}`)
      if (res.ok) {
        const data = await res.json()
        setCategories(data.data?.categories || [])
        setAllMenuItems(data.data?.items || [])
      }
    } catch (error) {
      console.error('[BartenderView] Failed to load categories:', error)
    }
  }, [locationId])

  const filterMenuItemsByCategory = useCallback((categoryId: string) => {
    setMenuPage(1)
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
  }, [categories])

  // Initial load
  useEffect(() => {
    if (initialCategories === undefined) {
      loadCategories()
    }
  }, [locationId])

  // Hot modifier fetch
  const fetchHotModifiersForCategory = useCallback(async (categoryId: string, items: MenuItem[]) => {
    if (hotModifierFetchedCats.current.has(categoryId)) return
    const liquorItems = items.filter(i => i.hasOtherModifiers && i.pourSizes && Object.keys(i.pourSizes).length > 0)
    if (liquorItems.length === 0) return
    hotModifierFetchedCats.current.add(categoryId)

    const itemsToFetch = liquorItems.slice(0, 20)
    const newCache: Record<string, { id: string; name: string; price: number }[]> = {}

    await Promise.all(itemsToFetch.map(async (item) => {
      try {
        const res = await fetch(`/api/menu/items/${item.id}/modifiers?channel=pos`)
        if (!res.ok) return
        const data = await res.json()
        const groups = data.data?.modifierGroups || []
        const matches: { id: string; name: string; price: number }[] = []
        for (const group of groups) {
          if (group.isSpiritGroup) continue
          for (const mod of (group.modifiers || [])) {
            const nameLower = mod.name.toLowerCase().trim()
            if (COMMON_BAR_MODIFIERS.includes(nameLower as typeof COMMON_BAR_MODIFIERS[number])) {
              matches.push({ id: mod.id, name: mod.name, price: Number(mod.price || 0) })
            }
          }
        }
        if (matches.length > 0) newCache[item.id] = matches
      } catch { /* skip */ }
    }))

    if (Object.keys(newCache).length > 0) {
      setHotModifierCache(prev => ({ ...prev, ...newCache }))
    }
  }, [])

  useEffect(() => {
    if (selectedCategoryId && menuItems.length > 0) {
      void fetchHotModifiersForCategory(selectedCategoryId, menuItems)
    }
  }, [selectedCategoryId, menuItems, fetchHotModifiersForCategory])

  // Auto-select store order on mount
  useEffect(() => {
    const storeOrder = useOrderStore.getState().currentOrder
    if (storeOrder?.id && !storeOrder.id.startsWith('local-') && storeOrder.items.length > 0) {
      setSelectedTabId(storeOrder.id)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // CATEGORY & ITEM DRAG HANDLERS
  // ---------------------------------------------------------------------------

  const saveCategorySettings = bartPrefs.setCategorySettings
  const saveCategoryOrder = bartPrefs.setCategoryOrder
  const saveItemSettings = bartPrefs.setItemSettings
  const saveItemCustomization = bartPrefs.setItemCustomization
  const saveItemOrder = bartPrefs.setItemOrder
  const saveFavorites = bartPrefs.setFavorites

  const handleCategoryDragStart = useCallback((categoryId: string) => {
    setDraggedCategoryId(categoryId)
  }, [])

  const handleCategoryDragOver = useCallback((targetCategoryId: string) => {
    if (!draggedCategoryId || draggedCategoryId === targetCategoryId) return
    const currentOrder = categoryOrder.length > 0
      ? [...categoryOrder]
      : orderedCategories.map(c => c.id)
    const draggedIndex = currentOrder.indexOf(draggedCategoryId)
    const targetIndex = currentOrder.indexOf(targetCategoryId)
    if (draggedIndex === -1 || targetIndex === -1) return
    currentOrder.splice(draggedIndex, 1)
    currentOrder.splice(targetIndex, 0, draggedCategoryId)
    saveCategoryOrder(currentOrder)
  }, [draggedCategoryId, categoryOrder, orderedCategories, saveCategoryOrder])

  const handleCategoryDragEnd = useCallback(() => {
    setDraggedCategoryId(null)
  }, [])

  const handleItemDragStart = useCallback((itemId: string) => {
    setDraggedItemId(itemId)
  }, [])

  const handleItemDragOver = useCallback((targetItemId: string) => {
    if (!draggedItemId || draggedItemId === targetItemId || !selectedCategoryId) return
    const currentOrder = itemOrder[selectedCategoryId]?.length > 0
      ? [...itemOrder[selectedCategoryId]]
      : orderedMenuItems.map(i => i.id)
    const draggedIdx = currentOrder.indexOf(draggedItemId)
    const targetIdx = currentOrder.indexOf(targetItemId)
    if (draggedIdx === -1 || targetIdx === -1) return
    currentOrder.splice(draggedIdx, 1)
    currentOrder.splice(targetIdx, 0, draggedItemId)
    saveItemOrder(selectedCategoryId, currentOrder)
  }, [draggedItemId, selectedCategoryId, itemOrder, orderedMenuItems, saveItemOrder])

  const handleItemDragEnd = useCallback(() => {
    setDraggedItemId(null)
  }, [])

  // ---------------------------------------------------------------------------
  // FAVORITES HANDLERS
  // ---------------------------------------------------------------------------

  const addToFavorites = useCallback((item: MenuItem) => {
    const existing = favorites.find(f => f.menuItemId === item.id)
    if (existing) { toast.info('Already in favorites'); return }
    saveFavorites([...favorites, {
      menuItemId: item.id, name: item.name, price: item.price, hasModifiers: item.hasModifiers,
    }])
    toast.success(`Added ${item.name} to favorites`)
  }, [favorites, saveFavorites])

  const removeFromFavorites = useCallback((menuItemId: string) => {
    saveFavorites(favorites.filter(f => f.menuItemId !== menuItemId))
  }, [favorites, saveFavorites])

  const clearFavorites = useCallback(() => {
    saveFavorites([])
    toast.success('Favorites cleared')
    setIsEditingFavorites(false)
  }, [saveFavorites])

  // ---------------------------------------------------------------------------
  // ENTERTAINMENT & SECTION CHANGE
  // ---------------------------------------------------------------------------

  const loadEntertainmentItems = useCallback(() => {
    if (filteredCategories.length === 0) { setMenuItems([]); return }
    setMenuPage(1)
    const catIds = new Set(filteredCategories.map(c => c.id))
    setMenuItems(allMenuItemsRef.current.filter(item => catIds.has(item.categoryId)))
  }, [filteredCategories])

  useEffect(() => {
    if (menuSection === 'entertainment') {
      setSelectedCategoryId(null)
      loadEntertainmentItems()
    } else if (filteredCategories.length > 0) {
      const firstCat = filteredCategories[0]
      setSelectedCategoryId(firstCat.id)
      filterMenuItemsByCategory(firstCat.id)
    }
  }, [menuSection, filteredCategories, filterMenuItemsByCategory, loadEntertainmentItems])

  // ---------------------------------------------------------------------------
  // TAB MANAGEMENT
  // ---------------------------------------------------------------------------

  // Register deselect for parent
  useEffect(() => {
    if (onRegisterDeselectTab) {
      onRegisterDeselectTab(() => {
        setSelectedTabId(null)
        loadedTabIdRef.current = null
        useOrderStore.getState().clearOrder()
      })
    }
  }, [onRegisterDeselectTab])

  // Load order into store when selecting a different tab
  useEffect(() => {
    if (selectedTabId) {
      if (loadedTabIdRef.current === selectedTabId) return
      loadedTabIdRef.current = selectedTabId
      onSelectedTabChange?.(selectedTabId)

      fetch(`/api/orders/${selectedTabId}?locationId=${locationId}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (!data) return
          const order = data.data || data
          useOrderStore.getState().loadOrder({
            id: order.id,
            orderNumber: order.orderNumber,
            orderType: order.orderType || 'bar_tab',
            tableId: order.tableId || undefined,
            tableName: order.tableName || order.table?.name || undefined,
            tabName: order.tabName || undefined,
            guestCount: order.guestCount || 1,
            status: order.status || 'open',
            items: order.items || [],
            subtotal: Number(order.subtotal) || 0,
            discountTotal: Number(order.discountTotal) || 0,
            taxTotal: Number(order.taxTotal) || 0,
            tipTotal: Number(order.tipTotal) || 0,
            total: Number(order.total) || 0,
          })
        })
        .catch(err => console.error('[BartenderView] Failed to load order:', err))
    } else {
      if (loadedTabIdRef.current !== null) {
        loadedTabIdRef.current = null
        onSelectedTabChange?.(null)
        useOrderStore.getState().clearOrder()
      }
    }
  }, [selectedTabId, locationId])

  // Socket: order:closed
  useEffect(() => {
    if (!socket || !isConnected) return
    const onOrderClosed = (data: any) => {
      const { orderId } = data || {}
      if (!orderId) return
      const currentTabId = selectedTabIdRef.current
      const storeOrderId = useOrderStore.getState().currentOrder?.id
      if (orderId === currentTabId || orderId === storeOrderId) {
        setSelectedTabId(null)
        loadedTabIdRef.current = null
        useOrderStore.getState().clearOrder()
        setTabRefreshTrigger(t => t + 1)
        toast.info('Order was closed on another terminal')
      }
    }
    socket.on('order:closed', onOrderClosed)
    return () => { socket.off('order:closed', onOrderClosed) }
  }, [socket, isConnected])

  // ---------------------------------------------------------------------------
  // HANDLERS
  // ---------------------------------------------------------------------------

  const handleSelectTab = useCallback((tabId: string) => {
    setSelectedTabId(tabId)
    if (isTabPanelExpanded) {
      startTabTransition(() => { setIsTabPanelExpanded(false) })
    }
  }, [isTabPanelExpanded])

  const handleCategoryClick = useCallback((categoryId: string) => {
    startCategoryTransition(() => {
      setSelectedCategoryId(categoryId)
      filterMenuItemsByCategory(categoryId)
    })
    if (searchQuery) {
      setSearchQuery('')
      setIsSearchExpanded(false)
    }
  }, [filterMenuItemsByCategory, searchQuery])

  const handleEditToggle = useCallback((itemId: string | null) => {
    setEditingItemId(itemId)
  }, [])

  const resetCategoryOrder = useCallback(() => {
    saveCategoryOrder([])
    toast.success('Category order reset')
  }, [saveCategoryOrder])

  const resetItemOrder = useCallback(() => {
    if (!selectedCategoryId) return
    bartPrefs.resetItemOrder(selectedCategoryId)
    toast.success('Item order reset')
  }, [selectedCategoryId, bartPrefs])

  // Tab creation hook
  const {
    handleCreateTab,
    handleQuickTab,
    handleAutoCreateTab,
    isCreatingTab,
    showNewTabModal,
    newTabName,
    setNewTabName,
    openNewTabModal,
    closeNewTabModal,
  } = useTabCreation({
    locationId,
    employeeId,
    requireNameWithoutCard,
    onSendToTab: ordering.sendItemsToTab,
    onTabCreated: useCallback((tab) => {
      useOrderStore.getState().loadOrder({
        id: tab.id, orderNumber: tab.orderNumber, orderType: 'bar_tab',
        tabName: tab.tabName || undefined, guestCount: 1, status: tab.status || 'open',
        items: [], subtotal: 0, discountTotal: 0, taxTotal: 0, tipTotal: 0, total: 0,
      })
      loadedTabIdRef.current = tab.id
      setSelectedTabId(tab.id)
      onSelectedTabChange?.(tab.id)
    }, [onSelectedTabChange]),
    onRefresh: useCallback(() => setTabRefreshTrigger(t => t + 1), []),
  })

  const handleSend = useCallback(async () => {
    const freshItems = useOrderStore.getState().currentOrder?.items || []
    const unsavedItems = freshItems.filter(i => !i.sentToKitchen)
    if (unsavedItems.length === 0) return

    if (!selectedTabId) {
      const tab = await handleAutoCreateTab()
      if (tab?.id) await ordering.sendItemsToTab(tab.id)
      return
    }
    await ordering.sendItemsToTab(selectedTabId)
  }, [selectedTabId, ordering.sendItemsToTab, handleAutoCreateTab])

  const handlePay = useCallback(() => {
    if (selectedTabId && onOpenPayment) onOpenPayment(selectedTabId)
  }, [selectedTabId, onOpenPayment])

  // Long press hooks
  const categoryLongPress = useLongPress(
    useCallback(() => { if (canEditLayout) setIsEditingCategories(true) }, [canEditLayout]),
    { onTap: useCallback(() => categoryScrollRef.current?.scrollTo({ left: 0, behavior: 'smooth' }), []) },
  )

  const favoritesLongPress = useLongPress(
    useCallback(() => {
      if (favorites.length === 0) return
      setIsEditingFavorites(prev => !prev)
    }, [favorites.length]),
  )

  const itemsLongPress = useLongPress(
    useCallback(() => { if (canEditLayout) setIsEditingItems(prev => !prev) }, [canEditLayout]),
  )

  const handleClearSearch = useCallback(() => {
    setSearchQuery('')
    setIsSearchExpanded(false)
  }, [])

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------

  return (
    <div className="flex-1 min-h-0 bg-slate-900 flex flex-col overflow-hidden">
      {/* BAR / FOOD / ENT sub-navigation + Search */}
      <div className="flex-shrink-0 bg-slate-800/50 border-b border-white/10 px-4 py-2 flex items-center justify-center gap-3">
        <ModeSelector value={menuSection} onChange={setMenuSection} />

        {/* Search input */}
        <div className="flex items-center">
          {isSearchExpanded ? (
            <div className="flex items-center gap-1 bg-slate-700/80 rounded-lg px-2 py-1 border border-white/10">
              <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search menu..."
                className="bg-transparent text-white text-sm outline-none w-40 placeholder:text-slate-500"
                autoFocus
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(''); searchInputRef.current?.focus() }}
                  className="text-slate-400 hover:text-white"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => { setSearchQuery(''); setIsSearchExpanded(false) }}
                className="text-slate-400 hover:text-white ml-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setIsSearchExpanded(true); setTimeout(() => searchInputRef.current?.focus(), 100) }}
              className="p-1.5 rounded-lg bg-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              title="Search menu items"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ====== MAIN CONTENT (row-reverse: OrderPanel left, Menu center, Tabs right) ====== */}
      <div className="flex-1 flex flex-row-reverse overflow-hidden">
        {/* ====== RIGHT: TABS PANEL ====== */}
        <BartenderTabPanel
          locationId={locationId}
          employeeId={employeeId}
          employeePermissions={employeePermissions}
          isExpanded={isTabPanelExpanded}
          onToggleExpand={() => setIsTabPanelExpanded(!isTabPanelExpanded)}
          selectedTabId={selectedTabId}
          onSelectOrder={(order) => handleSelectTab(order.id)}
          onNewTab={handleQuickTab}
          onClosedOrderAction={() => setTabRefreshTrigger(t => t + 1)}
          refreshTrigger={tabRefreshTrigger + (externalRefreshTrigger || 0)}
        />

        {/* ====== CENTER: MENU GRID (hidden when tabs expanded) ====== */}
        {!isTabPanelExpanded && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Categories - Hidden in Entertainment mode */}
            {menuSection !== 'entertainment' && (
              <BartenderCategoryNav
                categories={orderedCategories}
                selectedCategoryId={selectedCategoryId}
                categorySettings={categorySettings}
                categoryOrder={categoryOrder}
                isEditing={isEditingCategories}
                draggedCategoryId={draggedCategoryId}
                menuSection={menuSection}
                scrollRef={categoryScrollRef}
                onCategoryClick={handleCategoryClick}
                onDragStart={handleCategoryDragStart}
                onDragOver={handleCategoryDragOver}
                onDragEnd={handleCategoryDragEnd}
                onSaveCategorySettings={saveCategorySettings}
                onResetCategoryOrder={resetCategoryOrder}
                onStopEditing={() => setIsEditingCategories(false)}
                categoryLongPressProps={categoryLongPress}
              />
            )}

            {/* Favorites Bar */}
            {showFavorites && menuSection !== 'entertainment' && (
              <BartenderFavorites
                favorites={favorites}
                isEditing={isEditingFavorites}
                onFavoriteTap={ordering.handleFavoriteTap}
                onRemoveFavorite={removeFromFavorites}
                onClearAll={clearFavorites}
                onStopEditing={() => setIsEditingFavorites(false)}
                favoritesLongPressProps={favoritesLongPress}
              />
            )}

            {/* Entertainment Mode Header */}
            {menuSection === 'entertainment' && (
              <div className="flex-shrink-0 bg-purple-900/30 border-b border-purple-500/20 p-3">
                <div className="flex items-center gap-2 text-purple-300">
                  <span className="text-xl">{'🎱'}</span>
                  <span className="font-bold">Entertainment</span>
                  <span className="text-purple-400 text-sm ml-auto">{filteredCategories.length} categories</span>
                </div>
              </div>
            )}

            {/* Menu Items Grid */}
            <BartenderMenuGrid
              items={finalDisplayedItems}
              isLoading={isLoadingMenu}
              isCategoryPending={isCategoryPending}
              searchQuery={searchQuery}
              hasSelectedCategory={!!selectedCategoryId}
              selectedCategoryId={selectedCategoryId}
              itemSettings={itemSettings}
              effectiveItemsPerRow={effectiveItemsPerRow}
              itemCustomizations={itemCustomizations}
              favorites={favorites}
              hotModifierCache={hotModifierCache}
              dualPricing={dualPricing}
              isEditingItems={isEditingItems}
              editingItemId={editingItemId}
              allCategoryItems={menuItems}
              itemOrderForCategory={selectedCategoryId ? (itemOrder[selectedCategoryId] || []) : []}
              menuPage={menuPage}
              totalMenuPages={totalMenuPages}
              onSetMenuPage={setMenuPage}
              onMenuItemTap={ordering.handleMenuItemTap}
              onEditToggle={handleEditToggle}
              onAddToFavorites={addToFavorites}
              onItemDragStart={handleItemDragStart}
              onItemDragOver={handleItemDragOver}
              onItemDragEnd={handleItemDragEnd}
              onPourSizeClick={ordering.handlePourSizeClick}
              onSpiritTierClick={ordering.handleSpiritTierClick}
              onHotModifierClick={ordering.handleHotModifierClick}
              onPricingOptionClick={ordering.handlePricingOptionClick}
              onClearSearch={handleClearSearch}
              onSaveItemSettings={saveItemSettings}
              onSaveItemCustomization={saveItemCustomization}
              onResetAllItemCustomizations={bartPrefs.resetAllItemCustomizations}
              onResetItemOrder={resetItemOrder}
              onStopEditing={() => { setIsEditingItems(false); setEditingItemId(null) }}
              itemsLongPressProps={itemsLongPress}
            />
          </div>
        )}

        {/* OrderPanel slot — rendered by parent */}
        {!isTabPanelExpanded && children}
      </div>

      {/* ====== NEW TAB MODAL ====== */}
      <NewTabModal
        isOpen={showNewTabModal}
        onClose={closeNewTabModal}
        tabName={newTabName}
        onTabNameChange={setNewTabName}
        onSubmit={handleCreateTab}
        isCreating={isCreatingTab}
        requireName={requireNameWithoutCard}
      />

      {/* ====== SPIRIT SELECTION POPUP ====== */}
      <SpiritSelectionModal
        item={ordering.spiritPopupItem}
        selectedTier={ordering.selectedSpiritTier}
        dualPricing={dualPricing}
        onSelect={ordering.handleSpiritSelect}
        onClose={ordering.handleCloseSpiritPopup}
      />

      {/* ====== PRICING OPTION PICKER ====== */}
      <PricingOptionPicker
        item={ordering.pricingPickerItem}
        dualPricing={dualPricing}
        onSelect={ordering.handlePricingPickerSelect}
        onClose={ordering.handlePricingPickerClose}
      />
    </div>
  )
}
