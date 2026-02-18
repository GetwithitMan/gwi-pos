'use client'

import { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react'
import { motion } from 'framer-motion'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import { usePricing } from '@/hooks/usePricing'
import { getDualPrices } from '@/lib/pricing'
import { useOrderStore } from '@/stores/order-store'
import { useActiveOrder } from '@/hooks/useActiveOrder'
import { useOrderingEngine } from '@/hooks/useOrderingEngine'
import type { EngineMenuItem, EngineModifier, EngineIngredientMod } from '@/hooks/useOrderingEngine'
import { useLongPress } from '@/hooks/useLongPress'
import { useTabCreation } from '@/hooks/useTabCreation'
import ModeSelector from '@/components/orders/ModeSelector'
import { OpenOrdersPanel } from '@/components/orders/OpenOrdersPanel'
import { NewTabModal } from '@/components/bartender/NewTabModal'
import { SpiritSelectionModal } from '@/components/bartender/SpiritSelectionModal'

// ============================================================================
// TYPES
// ============================================================================


interface Category {
  id: string
  name: string
  color?: string
  itemCount?: number
  categoryType?: string // 'drinks' | 'liquor' | 'food' | 'entertainment' | etc.
  categoryShow?: string // 'bar' | 'food' | 'entertainment' | 'all'
}

interface SpiritOption {
  id: string
  name: string
  price: number
}

interface SpiritTiers {
  well: SpiritOption[]
  call: SpiritOption[]
  premium: SpiritOption[]
  top_shelf: SpiritOption[]
}

interface MenuItem {
  id: string
  name: string
  price: number
  categoryId: string
  hasModifiers?: boolean
  hasOtherModifiers?: boolean // Has non-spirit modifier groups
  pourSizes?: Record<string, number | { label: string; multiplier: number }> | null // { shot: 1.0, double: 2.0, tall: 1.5, short: 0.75 }
  defaultPourSize?: string | null
  spiritTiers?: SpiritTiers | null // Spirit upgrade options by tier
}

// Spirit tier display config - distinct colors for each tier
const SPIRIT_TIER_CONFIG: Record<string, { label: string; color: string; hoverColor: string }> = {
  well: { label: 'Well', color: 'bg-zinc-600', hoverColor: 'hover:bg-zinc-500' },
  call: { label: 'Call', color: 'bg-sky-600', hoverColor: 'hover:bg-sky-500' },
  premium: { label: 'Prem', color: 'bg-violet-600', hoverColor: 'hover:bg-violet-500' },
  top_shelf: { label: 'Top', color: 'bg-amber-500', hoverColor: 'hover:bg-amber-400' },
}

// Pour size display config - cohesive teal gradient
const POUR_SIZE_CONFIG: Record<string, { label: string; short: string; color: string }> = {
  shot: { label: 'Shot', short: '1x', color: 'bg-teal-700' },
  double: { label: 'Dbl', short: '2x', color: 'bg-teal-600' },
  tall: { label: 'Tall', short: '1.5x', color: 'bg-teal-500' },
  short: { label: 'Shrt', short: '.75x', color: 'bg-teal-800' },
}



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
  // Settings
  requireNameWithoutCard?: boolean
  // Dual pricing from parent (avoids duplicate useOrderSettings call)
  dualPricing?: { enabled: boolean; cashDiscountPercent: number; applyToCredit: boolean; applyToDebit: boolean; showSavingsMessage: boolean }
  // Pre-loaded menu data from parent (avoids duplicate /api/menu fetch)
  initialCategories?: Category[]
  initialMenuItems?: MenuItem[]
  // OrderPanel rendered by parent, passed as children
  children?: React.ReactNode
  // Ref to allow parent to deselect current tab (e.g., "Hide" button)
  onRegisterDeselectTab?: (fn: () => void) => void
  // External refresh trigger (e.g., parent increments after payment)
  refreshTrigger?: number
  // Notify parent when a tab is selected/deselected so savedOrderId stays in sync
  onSelectedTabChange?: (tabId: string | null) => void
}

// Menu sections - bar, food, or entertainment (standalone)
type MenuSection = 'bar' | 'food' | 'entertainment'

// Favorite item for custom bar
interface FavoriteItem {
  menuItemId: string
  name: string
  price: number
  hasModifiers?: boolean
}

// Category display settings
type CategoryRows = 1 | 2
type CategorySize = 'xsmall' | 'small' | 'medium' | 'large' | 'xlarge' | 'blind'

interface CategoryDisplaySettings {
  rows: CategoryRows
  size: CategorySize
}

const CATEGORY_SIZES: { value: CategorySize; label: string; px: number; text: string }[] = [
  { value: 'xsmall', label: 'XS', px: 60, text: 'text-[9px]' },
  { value: 'small', label: 'S', px: 80, text: 'text-[10px]' },
  { value: 'medium', label: 'M', px: 100, text: 'text-xs' },
  { value: 'large', label: 'L', px: 125, text: 'text-sm' },
  { value: 'xlarge', label: 'XL', px: 150, text: 'text-base' },
  { value: 'blind', label: '👁️', px: 200, text: 'text-2xl' },
]

const DEFAULT_CATEGORY_SETTINGS: CategoryDisplaySettings = { rows: 2, size: 'large' }

// Item display settings
type ItemSize = 'compact' | 'normal' | 'large' | 'xlarge'
type ItemsPerRow = 'auto' | 3 | 4 | 5 | 6

interface ItemDisplaySettings {
  size: ItemSize
  itemsPerRow: ItemsPerRow
  showPrices: boolean
  showDualPricing: boolean // Show both cash and card prices from system settings
  showQuickPours: boolean // Show quick pour size buttons on liquor items
  useScrolling: boolean // Use scrolling instead of pagination
}

interface ItemCustomization {
  backgroundColor?: string
  textColor?: string
  highlight?: 'none' | 'glow' | 'border' | 'larger'
  sortOrder?: number // Custom sort order within category
  // New fun options
  fontStyle?: 'normal' | 'bold' | 'italic' | 'boldItalic'
  fontFamily?: 'default' | 'rounded' | 'mono' | 'serif' | 'handwritten'
  glowColor?: string // Custom glow color
  borderColor?: string // Custom border color
  effect?: 'none' | 'pulse' | 'shimmer' | 'rainbow' | 'neon'
}

// Font family options
const FONT_FAMILIES: { value: string; label: string; className: string }[] = [
  { value: 'default', label: 'Default', className: '' },
  { value: 'rounded', label: 'Rounded', className: 'font-[system-ui]' },
  { value: 'mono', label: 'Mono', className: 'font-mono' },
  { value: 'serif', label: 'Serif', className: 'font-serif' },
  { value: 'handwritten', label: 'Script', className: 'italic' },
]

// Effect presets for quick styling
const EFFECT_PRESETS: { value: string; label: string; emoji: string }[] = [
  { value: 'none', label: 'None', emoji: '○' },
  { value: 'pulse', label: 'Pulse', emoji: '💫' },
  { value: 'shimmer', label: 'Shimmer', emoji: '✨' },
  { value: 'rainbow', label: 'Rainbow', emoji: '🌈' },
  { value: 'neon', label: 'Neon', emoji: '💡' },
]

// Quick color presets for glow/border
const GLOW_COLORS = [
  { color: '#3b82f6', label: 'Blue' },
  { color: '#8b5cf6', label: 'Purple' },
  { color: '#ec4899', label: 'Pink' },
  { color: '#10b981', label: 'Green' },
  { color: '#f59e0b', label: 'Amber' },
  { color: '#ef4444', label: 'Red' },
  { color: '#06b6d4', label: 'Cyan' },
  { color: '#ffffff', label: 'White' },
]

const ITEM_SIZES: { value: ItemSize; label: string; minWidth: number; height: number; text: string }[] = [
  { value: 'compact', label: 'Compact', minWidth: 80, height: 60, text: 'text-xs' },
  { value: 'normal', label: 'Normal', minWidth: 100, height: 80, text: 'text-sm' },
  { value: 'large', label: 'Large', minWidth: 120, height: 100, text: 'text-base' },
  { value: 'xlarge', label: 'X-Large', minWidth: 150, height: 120, text: 'text-lg' },
]

const DEFAULT_ITEM_SETTINGS: ItemDisplaySettings = {
  size: 'normal',
  itemsPerRow: 'auto',
  showPrices: true,
  showDualPricing: false, // Show both cash and card prices
  showQuickPours: true, // Show quick pour size buttons on liquor items
  useScrolling: false, // Use pagination by default
}

// Helper to determine if a color is light or dark for text contrast
function isLightColor(hexColor: string): boolean {
  if (!hexColor || !hexColor.startsWith('#')) return false
  const hex = hexColor.replace('#', '')
  const r = parseInt(hex.substr(0, 2), 16)
  const g = parseInt(hex.substr(2, 2), 16)
  const b = parseInt(hex.substr(4, 2), 16)
  // Using relative luminance formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5
}

// Local storage keys
const getFavoritesKey = (employeeId: string) => `bartender_favorites_${employeeId}`
const getCategorySettingsKey = (employeeId: string) => `bartender_category_settings_${employeeId}`
const getItemSettingsKey = (employeeId: string) => `bartender_item_settings_${employeeId}`
const getItemCustomizationsKey = (employeeId: string) => `bartender_item_customizations_${employeeId}`
const getItemOrderKey = (employeeId: string, categoryId: string) => `bartender_item_order_${employeeId}_${categoryId}`


// ============================================================================
// MEMOIZED SUB-COMPONENTS
// ============================================================================

interface FavoriteItemProps {
  fav: FavoriteItem
  isEditingFavorites: boolean
  onTap: (fav: FavoriteItem) => void
  onRemove: (menuItemId: string) => void
}

const FavoriteItem = memo(function FavoriteItem({ fav, isEditingFavorites, onTap, onRemove }: FavoriteItemProps) {
  return (
    <button
      onClick={() => !isEditingFavorites && onTap(fav)}
      className={`relative flex-shrink-0 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
        isEditingFavorites
          ? 'bg-red-900/30 border border-red-500/30 text-red-300'
          : 'bg-amber-600/30 border border-amber-500/30 text-amber-200 hover:bg-amber-600/50 active:scale-95'
      }`}
    >
      {isEditingFavorites && (
        <span
          onClick={(e) => {
            e.stopPropagation()
            onRemove(fav.menuItemId)
          }}
          className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 rounded-full text-white text-xs flex items-center justify-center cursor-pointer"
        >
          ×
        </span>
      )}
      {fav.name}
    </button>
  )
})

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
}: BartenderViewProps) {
  // ---------------------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------------------

  // Tabs
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null)

  // Tab panel expansion
  const [isTabPanelExpanded, setIsTabPanelExpanded] = useState(false)
  const [tabRefreshTrigger, setTabRefreshTrigger] = useState(0)

  // Menu section (Bar / Food / My Bar)
  const [menuSection, setMenuSection] = useState<MenuSection>('bar')

  // Categories & Menu — initialized from parent props when available
  const [categories, setCategories] = useState<Category[]>(initialCategories || [])
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [allMenuItems, setAllMenuItems] = useState<MenuItem[]>(initialMenuItems || []) // Full menu, loaded once
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])       // Filtered by category
  const [isLoadingMenu, setIsLoadingMenu] = useState(false)
  const [menuPage, setMenuPage] = useState(1)

  // Refs for stable callbacks
  const allMenuItemsRef = useRef(allMenuItems)
  allMenuItemsRef.current = allMenuItems
  const selectedCategoryIdRef = useRef(selectedCategoryId)
  selectedCategoryIdRef.current = selectedCategoryId

  // Sync from parent when props update (e.g., parent's loadMenu completes after mount)
  useEffect(() => {
    if (initialCategories && initialCategories.length > 0) {
      setCategories(initialCategories)
    }
  }, [initialCategories])

  useEffect(() => {
    if (initialMenuItems && initialMenuItems.length > 0) {
      setAllMenuItems(initialMenuItems)
      // If a category is selected, refresh its filtered view
      if (selectedCategoryIdRef.current) {
        setMenuItems(initialMenuItems.filter(
          item => item.categoryId === selectedCategoryIdRef.current
        ))
      }
    }
  }, [initialMenuItems])

  // Custom favorites bar
  const [favorites, setFavorites] = useState<FavoriteItem[]>([])
  const showFavorites = true
  const [isEditingFavorites, setIsEditingFavorites] = useState(false)

  // Category display settings
  const [categorySettings, setCategorySettings] = useState<CategoryDisplaySettings>(DEFAULT_CATEGORY_SETTINGS)
  const [isEditingCategories, setIsEditingCategories] = useState(false)
  const [categoryOrder, setCategoryOrder] = useState<string[]>([]) // Custom order of category IDs
  const [draggedCategoryId, setDraggedCategoryId] = useState<string | null>(null)

  // Item display settings
  const [itemSettings, setItemSettings] = useState<ItemDisplaySettings>(DEFAULT_ITEM_SETTINGS)
  const [isEditingItems, setIsEditingItems] = useState(false)
  const [itemCustomizations, setItemCustomizations] = useState<Record<string, ItemCustomization>>({})
  const [itemOrder, setItemOrder] = useState<Record<string, string[]>>({}) // categoryId -> menuItemId[]
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null)
  const [editingItemId, setEditingItemId] = useState<string | null>(null) // Item being customized

  // === Shared order hook (single source of truth for order items) ===
  const activeOrder = useActiveOrder({
    locationId,
    employeeId,
  })

  // === Shared ordering engine (item add, modifier modal coordination) ===
  const engine = useOrderingEngine({
    locationId,
    employeeId,
    defaultOrderType: 'bar_tab',
    onOpenModifiers: onOpenModifiers as ((
      item: EngineMenuItem,
      onComplete: (modifiers: { id: string; name: string; price: number; depth?: number; preModifier?: string | null }[], ingredientMods?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]) => void,
      existingModifiers?: { id: string; name: string; price: number; depth?: number; preModifier?: string | null }[],
      existingIngredientMods?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]
    ) => void) | undefined,
  })

  // orderItems — read-only projection from Zustand store via useActiveOrder hook
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
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrder.items])

  // Tab creation (shared POST logic between "New Tab" modal and quick-tab button)

  // Spirit tier popup state
  const [spiritPopupItem, setSpiritPopupItem] = useState<MenuItem | null>(null)
  const [selectedSpiritTier, setSelectedSpiritTier] = useState<string | null>(null)

  // Refs
  const categoryScrollRef = useRef<HTMLDivElement>(null)

  // Get category order storage key
  const getCategoryOrderKey = (employeeId: string) => `bartender_category_order_${employeeId}`

  // ---------------------------------------------------------------------------
  // COMPUTED
  // ---------------------------------------------------------------------------


  // Filter categories by categoryShow field
  const filteredCategories = useMemo(() => {
    return categories.filter(cat => {
      const show = (cat.categoryShow || 'all').toLowerCase()

      if (menuSection === 'entertainment') {
        // Entertainment mode: only show entertainment categories
        return show === 'entertainment'
      } else if (menuSection === 'bar') {
        // Bar mode: show bar categories and 'all' categories
        return show === 'bar' || show === 'all'
      } else {
        // Food mode: show food categories and 'all' categories
        return show === 'food' || show === 'all'
      }
    })
  }, [categories, menuSection])

  // Category display helpers
  const currentSizeConfig = CATEGORY_SIZES.find(s => s.value === categorySettings.size) || CATEGORY_SIZES[3]

  // Order categories based on custom order
  const orderedCategories = useMemo(() => {
    if (categoryOrder.length === 0) return filteredCategories

    // Sort by custom order, put unordered ones at the end
    return [...filteredCategories].sort((a, b) => {
      const aIndex = categoryOrder.indexOf(a.id)
      const bIndex = categoryOrder.indexOf(b.id)
      if (aIndex === -1 && bIndex === -1) return 0
      if (aIndex === -1) return 1
      if (bIndex === -1) return -1
      return aIndex - bIndex
    })
  }, [filteredCategories, categoryOrder])

  // Reset scroll position when section changes
  useEffect(() => {
    if (categoryScrollRef.current) {
      categoryScrollRef.current.scrollTo({ left: 0, behavior: 'smooth' })
    }
  }, [menuSection])

  // Filtered and sorted tabs
  // Calculate subtotal from local items for usePricing
  const orderSubtotal = useMemo(() => {
    return orderItems.reduce((sum, item) => {
      const itemTotal = item.price * item.quantity
      const modTotal = (item.modifiers || []).reduce((m, mod) => m + mod.price, 0) * item.quantity
      return sum + itemTotal + modTotal
    }, 0)
  }, [orderItems])

  // Use the shared pricing hook (same as FloorPlanHome and /orders)
  const pricing = usePricing({ subtotal: orderSubtotal })
  const orderTotals = {
    subtotal: pricing.subtotal,
    tax: pricing.tax,
    discounts: pricing.discounts,
    total: pricing.total,
  }

  // Backward compatibility - keep orderTotal for existing code
  const orderTotal = orderTotals.total

  const unsavedItemCount = useMemo(() => {
    return orderItems.filter(i => !i.sentToKitchen).length
  }, [orderItems])

  // Item display helpers
  const currentItemSizeConfig = ITEM_SIZES.find(s => s.value === itemSettings.size) || ITEM_SIZES[1]

  // Calculate items per row and page based on settings
  const effectiveItemsPerRow = useMemo(() => {
    if (itemSettings.itemsPerRow !== 'auto') return itemSettings.itemsPerRow
    // Auto: calculate based on size
    switch (itemSettings.size) {
      case 'compact': return 5
      case 'normal': return 4
      case 'large': return 4
      case 'xlarge': return 3
      default: return 4
    }
  }, [itemSettings.itemsPerRow, itemSettings.size])

  const itemsPerPage = effectiveItemsPerRow * 4 // 4 rows

  // Order menu items based on custom order
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

  // Paginated or scrollable menu items
  const totalMenuPages = itemSettings.useScrolling ? 1 : Math.ceil(orderedMenuItems.length / itemsPerPage)
  const displayedMenuItems = useMemo(() => {
    if (itemSettings.useScrolling) {
      return orderedMenuItems // Show all items for scrolling
    }
    const start = (menuPage - 1) * itemsPerPage
    return orderedMenuItems.slice(start, start + itemsPerPage)
  }, [orderedMenuItems, menuPage, itemsPerPage, itemSettings.useScrolling])


  // ---------------------------------------------------------------------------
  // DATA LOADING
  // ---------------------------------------------------------------------------

  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch(`/api/menu?locationId=${locationId}`)
      if (res.ok) {
        const data = await res.json()
        const cats = data.data?.categories || []
        setCategories(cats)
        setAllMenuItems(data.data?.items || [])
      }
    } catch (error) {
      console.error('[BartenderView] Failed to load categories:', error)
    }
  }, [locationId])

  // Client-side category filter — no API call needed
  const filterMenuItemsByCategory = useCallback((categoryId: string) => {
    setMenuPage(1)
    setMenuItems(allMenuItemsRef.current.filter(item => item.categoryId === categoryId))
  }, [])

  // Initial load — skip if parent owns menu data (prop defined, even if empty while loading)
  useEffect(() => {
    if (initialCategories === undefined) {
      loadCategories()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId])

  // Items from FloorPlanHome are automatically available via Zustand store
  // No mount-time sync needed — the store IS the source of truth
  // If the store has an order with a real ID, auto-select the matching tab
  useEffect(() => {
    const storeOrder = useOrderStore.getState().currentOrder
    if (storeOrder?.id && !storeOrder.id.startsWith('local-') && storeOrder.items.length > 0) {
      setSelectedTabId(storeOrder.id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run on mount

  // Load favorites from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(getFavoritesKey(employeeId))
      if (stored) {
        setFavorites(JSON.parse(stored))
      }
    } catch (e) {
      console.error('Failed to load favorites:', e)
    }
  }, [employeeId])

  // Load category settings from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(getCategorySettingsKey(employeeId))
      if (stored) {
        setCategorySettings(JSON.parse(stored))
      }
    } catch (e) {
      console.error('Failed to load category settings:', e)
    }
  }, [employeeId])

  // Save category settings to localStorage
  const saveCategorySettings = useCallback((settings: CategoryDisplaySettings) => {
    try {
      localStorage.setItem(getCategorySettingsKey(employeeId), JSON.stringify(settings))
      setCategorySettings(settings)
    } catch (e) {
      console.error('Failed to save category settings:', e)
    }
  }, [employeeId])

  // Load category order from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(getCategoryOrderKey(employeeId))
      if (stored) {
        setCategoryOrder(JSON.parse(stored))
      }
    } catch (e) {
      console.error('Failed to load category order:', e)
    }
  }, [employeeId])

  // Save category order to localStorage
  const saveCategoryOrder = useCallback((order: string[]) => {
    try {
      localStorage.setItem(getCategoryOrderKey(employeeId), JSON.stringify(order))
      setCategoryOrder(order)
    } catch (e) {
      console.error('Failed to save category order:', e)
    }
  }, [employeeId])

  // Load item settings from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(getItemSettingsKey(employeeId))
      if (stored) {
        setItemSettings(JSON.parse(stored))
      }
    } catch (e) {
      console.error('Failed to load item settings:', e)
    }
  }, [employeeId])

  // Load item customizations from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(getItemCustomizationsKey(employeeId))
      if (stored) {
        setItemCustomizations(JSON.parse(stored))
      }
    } catch (e) {
      console.error('Failed to load item customizations:', e)
    }
  }, [employeeId])

  // Save item settings to localStorage
  const saveItemSettings = useCallback((settings: ItemDisplaySettings) => {
    try {
      localStorage.setItem(getItemSettingsKey(employeeId), JSON.stringify(settings))
      setItemSettings(settings)
    } catch (e) {
      console.error('Failed to save item settings:', e)
    }
  }, [employeeId])

  // Save item customizations to localStorage
  const saveItemCustomization = useCallback((menuItemId: string, customization: ItemCustomization | null) => {
    try {
      const updated = { ...itemCustomizations }
      if (customization === null) {
        delete updated[menuItemId]
      } else {
        updated[menuItemId] = customization
      }
      localStorage.setItem(getItemCustomizationsKey(employeeId), JSON.stringify(updated))
      setItemCustomizations(updated)
    } catch (e) {
      console.error('Failed to save item customization:', e)
    }
  }, [employeeId, itemCustomizations])

  // Save item order for a category
  const saveItemOrder = useCallback((categoryId: string, order: string[]) => {
    try {
      localStorage.setItem(getItemOrderKey(employeeId, categoryId), JSON.stringify(order))
      setItemOrder(prev => ({ ...prev, [categoryId]: order }))
    } catch (e) {
      console.error('Failed to save item order:', e)
    }
  }, [employeeId])

  // Load item order for current category
  useEffect(() => {
    if (!selectedCategoryId) return
    try {
      const stored = localStorage.getItem(getItemOrderKey(employeeId, selectedCategoryId))
      if (stored) {
        setItemOrder(prev => ({ ...prev, [selectedCategoryId]: JSON.parse(stored) }))
      }
    } catch (e) {
      console.error('Failed to load item order:', e)
    }
  }, [employeeId, selectedCategoryId])

  // Handle category drag start
  const handleCategoryDragStart = useCallback((categoryId: string) => {
    setDraggedCategoryId(categoryId)
  }, [])

  // Handle category drag over
  const handleCategoryDragOver = useCallback((targetCategoryId: string) => {
    if (!draggedCategoryId || draggedCategoryId === targetCategoryId) return

    const currentOrder = categoryOrder.length > 0
      ? [...categoryOrder]
      : orderedCategories.map(c => c.id)

    const draggedIndex = currentOrder.indexOf(draggedCategoryId)
    const targetIndex = currentOrder.indexOf(targetCategoryId)

    if (draggedIndex === -1 || targetIndex === -1) return

    // Remove dragged item and insert at target position
    currentOrder.splice(draggedIndex, 1)
    currentOrder.splice(targetIndex, 0, draggedCategoryId)

    saveCategoryOrder(currentOrder)
  }, [draggedCategoryId, categoryOrder, orderedCategories, saveCategoryOrder])

  // Handle category drag end
  const handleCategoryDragEnd = useCallback(() => {
    setDraggedCategoryId(null)
  }, [])

  // Handle item drag start
  const handleItemDragStart = useCallback((itemId: string) => {
    setDraggedItemId(itemId)
  }, [])

  // Handle item drag over
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

  // Handle item drag end
  const handleItemDragEnd = useCallback(() => {
    setDraggedItemId(null)
  }, [])

  // Save favorites to localStorage
  const saveFavorites = useCallback((items: FavoriteItem[]) => {
    try {
      localStorage.setItem(getFavoritesKey(employeeId), JSON.stringify(items))
      setFavorites(items)
    } catch (e) {
      console.error('Failed to save favorites:', e)
    }
  }, [employeeId])

  // Add item to favorites
  const addToFavorites = useCallback((item: MenuItem) => {
    const existing = favorites.find(f => f.menuItemId === item.id)
    if (existing) {
      toast.info('Already in favorites')
      return
    }
    const newFavorites = [...favorites, {
      menuItemId: item.id,
      name: item.name,
      price: item.price,
      hasModifiers: item.hasModifiers,
    }]
    saveFavorites(newFavorites)
    toast.success(`Added ${item.name} to favorites`)
  }, [favorites, saveFavorites])

  // Remove item from favorites
  const removeFromFavorites = useCallback((menuItemId: string) => {
    const newFavorites = favorites.filter(f => f.menuItemId !== menuItemId)
    saveFavorites(newFavorites)
  }, [favorites, saveFavorites])

  // Clear all favorites
  const clearFavorites = useCallback(() => {
    saveFavorites([])
    toast.success('Favorites cleared')
    setIsEditingFavorites(false)
  }, [saveFavorites])

  // Filter items for all entertainment categories — instant client-side
  const loadEntertainmentItems = useCallback(() => {
    if (filteredCategories.length === 0) {
      setMenuItems([])
      return
    }
    setMenuPage(1)
    const catIds = new Set(filteredCategories.map(c => c.id))
    setMenuItems(allMenuItemsRef.current.filter(item => catIds.has(item.categoryId)))
  }, [filteredCategories])

  // Auto-select first category when section changes (or load all for entertainment)
  useEffect(() => {
    if (menuSection === 'entertainment') {
      // Entertainment mode: show all entertainment items
      setSelectedCategoryId(null)
      loadEntertainmentItems()
    } else if (filteredCategories.length > 0) {
      const firstCat = filteredCategories[0]
      setSelectedCategoryId(firstCat.id)
      filterMenuItemsByCategory(firstCat.id)
    }
  }, [menuSection, filteredCategories, filterMenuItemsByCategory, loadEntertainmentItems])

  // Track which tab ID we last loaded items for (to prevent overwriting local changes)
  const loadedTabIdRef = useRef<string | null>(null)

  // Register deselect function so parent can trigger "Hide" (deselect current tab)
  useEffect(() => {
    if (onRegisterDeselectTab) {
      onRegisterDeselectTab(() => {
        setSelectedTabId(null)
        loadedTabIdRef.current = null
        useOrderStore.getState().clearOrder()
      })
    }
  }, [onRegisterDeselectTab])

  // Load order into Zustand store when selecting a DIFFERENT tab via direct API fetch
  useEffect(() => {
    if (selectedTabId) {
      // Only reload if switching to a DIFFERENT tab
      if (loadedTabIdRef.current === selectedTabId) return
      loadedTabIdRef.current = selectedTabId

      // Notify parent so savedOrderId stays in sync (fixes split pay-all in bar mode)
      onSelectedTabChange?.(selectedTabId)

      // Fetch order details and load into store
      fetch(`/api/orders/${selectedTabId}?locationId=${locationId}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (!data) return
          const order = data.data || data
          const store = useOrderStore.getState()
          store.loadOrder({
            id: order.id,
            orderNumber: order.orderNumber,
            orderType: order.orderType || 'bar_tab',
            tableId: order.tableId || undefined,
            tableName: order.tableName || order.table?.name || undefined,
            tabName: order.tabName || undefined,
            guestCount: order.guestCount || 1,
            status: order.status || 'open',
            // store.loadOrder handles all item field mapping — one path, no duplication
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

  // ---------------------------------------------------------------------------
  // HANDLERS
  // ---------------------------------------------------------------------------

  // handleSwitchToFloorPlan removed — view switching now in UnifiedPOSHeader

  const handleSelectTab = useCallback((tabId: string) => {
    setSelectedTabId(tabId)
    if (isTabPanelExpanded) {
      setIsTabPanelExpanded(false)
    }
  }, [isTabPanelExpanded])

  const handleCategoryClick = useCallback((categoryId: string) => {
    setSelectedCategoryId(categoryId)
    filterMenuItemsByCategory(categoryId)
  }, [filterMenuItemsByCategory])

  const handleMenuItemTap = useCallback((item: MenuItem) => {
    // Convert local MenuItem to EngineMenuItem and delegate to engine
    const engineItem: EngineMenuItem = {
      id: item.id,
      name: item.name,
      price: item.price,
      categoryId: item.categoryId,
      hasModifiers: item.hasModifiers,
    }
    engine.handleMenuItemTap(engineItem)
  }, [engine])

  // Handle tapping a favorite item
  const handleFavoriteTap = useCallback((fav: FavoriteItem) => {
    const engineItem: EngineMenuItem = {
      id: fav.menuItemId,
      name: fav.name,
      price: fav.price,
      categoryId: '',
      hasModifiers: fav.hasModifiers,
    }
    engine.handleMenuItemTap(engineItem)
  }, [engine])

  // Handle clicking a spirit tier button on a cocktail item
  const handleSpiritTierClick = useCallback((item: MenuItem, tier: string) => {
    const tierOptions = item.spiritTiers?.[tier as keyof SpiritTiers]
    if (!tierOptions || tierOptions.length === 0) return

    // If only one option in this tier, add it directly
    if (tierOptions.length === 1) {
      const spirit = tierOptions[0]
      engine.addItemDirectly({
        menuItemId: item.id,
        name: item.name,
        price: item.price,
        modifiers: [{ id: spirit.id, name: spirit.name, price: spirit.price }],
      })
      return
    }

    // Multiple options - show popup
    setSpiritPopupItem(item)
    setSelectedSpiritTier(tier)
  }, [engine])

  // Handle selecting a specific spirit from the popup
  const handleSpiritSelect = useCallback((spirit: SpiritOption) => {
    if (!spiritPopupItem) return

    engine.addItemDirectly({
      menuItemId: spiritPopupItem.id,
      name: spiritPopupItem.name,
      price: spiritPopupItem.price,
      modifiers: [{ id: spirit.id, name: spirit.name, price: spirit.price }],
    })

    // Close popup
    setSpiritPopupItem(null)
    setSelectedSpiritTier(null)
  }, [spiritPopupItem, engine])

  // Close spirit popup
  const handleCloseSpiritPopup = useCallback(() => {
    setSpiritPopupItem(null)
    setSelectedSpiritTier(null)
  }, [])

  const sendItemsToTab = useCallback(async (orderId: string) => {
    const unsavedItems = orderItems.filter(i => !i.sentToKitchen)
    if (unsavedItems.length === 0) return

    const itemsPayload = unsavedItems.map(item => ({
      menuItemId: item.menuItemId,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      modifiers: item.modifiers?.map(m => ({
        modifierId: m.id,
        name: m.name,
        price: m.price,
      })) || [],
    }))

    // Close UI instantly — don't wait for API calls
    toast.success('Order sent')
    useOrderStore.getState().clearOrder()
    setSelectedTabId(null)
    loadedTabIdRef.current = null

    // Fire-and-forget: append items then send to kitchen in background
    void (async () => {
      try {
        const appendRes = await fetch(`/api/orders/${orderId}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: itemsPayload }),
        })

        if (!appendRes.ok) {
          const errorData = await appendRes.json().catch(() => ({}))
          throw new Error(errorData.error || 'Failed to add items')
        }

        const sendRes = await fetch(`/api/orders/${orderId}/send`, { method: 'POST' })
        if (!sendRes.ok) {
          console.error('[BartenderView] Send to kitchen error:', await sendRes.json().catch(() => ({})))
        }
      } catch (error) {
        console.error('[BartenderView] Background send failed:', error)
        toast.error('Send failed — items may not have reached kitchen')
      } finally {
        setTabRefreshTrigger(t => t + 1)
      }
    })()
  }, [orderItems])

  // --- Tab creation hook (replaces handleCreateTab + handleQuickTab) ---
  const {
    handleCreateTab,
    handleQuickTab,
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
    onSendToTab: sendItemsToTab,
    onTabCreated: useCallback((tab) => {
      const store = useOrderStore.getState()
      store.loadOrder({
        id: tab.id,
        orderNumber: tab.orderNumber,
        orderType: 'bar_tab',
        tabName: tab.tabName || undefined,
        guestCount: 1,
        status: tab.status || 'open',
        items: [],
        subtotal: 0,
        discountTotal: 0,
        taxTotal: 0,
        tipTotal: 0,
        total: 0,
      })
      loadedTabIdRef.current = tab.id
      setSelectedTabId(tab.id)
      onSelectedTabChange?.(tab.id)
    }, [onSelectedTabChange]),
    onRefresh: useCallback(() => setTabRefreshTrigger(t => t + 1), []),
  })

  const handleSend = useCallback(async () => {
    const unsavedItems = orderItems.filter(i => !i.sentToKitchen)
    if (unsavedItems.length === 0) return

    // If no tab selected, prompt for tab name first
    if (!selectedTabId) {
      openNewTabModal(true)
      return
    }

    // sendItemsToTab clears UI instantly and sends in background
    await sendItemsToTab(selectedTabId)
  }, [orderItems, selectedTabId, sendItemsToTab, openNewTabModal])

  const handlePay = useCallback(() => {
    if (selectedTabId && onOpenPayment) {
      onOpenPayment(selectedTabId)
    }
  }, [selectedTabId, onOpenPayment])

  // --- Long press hooks ---
  const categoryLongPress = useLongPress(
    useCallback(() => setIsEditingCategories(true), []),
    { onTap: useCallback(() => categoryScrollRef.current?.scrollTo({ left: 0, behavior: 'smooth' }), []) },
  )

  const favoritesLongPress = useLongPress(
    useCallback(() => {
      if (favorites.length === 0) return
      setIsEditingFavorites(prev => !prev)
    }, [favorites.length]),
  )

  const itemsLongPress = useLongPress(
    useCallback(() => setIsEditingItems(prev => !prev), []),
  )

  // Reset category order
  const resetCategoryOrder = useCallback(() => {
    saveCategoryOrder([])
    toast.success('Category order reset')
  }, [saveCategoryOrder])

  // Reset item order for current category
  const resetItemOrder = useCallback(() => {
    if (!selectedCategoryId) return
    localStorage.removeItem(getItemOrderKey(employeeId, selectedCategoryId))
    setItemOrder(prev => {
      const updated = { ...prev }
      delete updated[selectedCategoryId]
      return updated
    })
    toast.success('Item order reset')
  }, [selectedCategoryId, employeeId])

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------

  return (
    <div className="flex-1 min-h-0 bg-slate-900 flex flex-col overflow-hidden">
      {/* Header removed — now rendered by UnifiedPOSHeader in orders/page.tsx */}

      {/* BAR / FOOD / ENT sub-navigation */}
      <div className="flex-shrink-0 bg-slate-800/50 border-b border-white/10 px-4 py-2 flex justify-center">
        <ModeSelector value={menuSection} onChange={setMenuSection} />
      </div>

      {/* ====== MAIN CONTENT (row-reverse: OrderPanel left, Menu center, Tabs right) ====== */}
      <div className="flex-1 flex flex-row-reverse overflow-hidden">
        {/* ====== RIGHT: TABS PANEL (Unified OpenOrdersPanel) ====== */}
        <motion.div
          key={isTabPanelExpanded ? 'expanded' : 'collapsed'}
          initial={false}
          animate={{ width: isTabPanelExpanded ? '100%' : 288 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="flex-shrink-0 flex flex-col"
        >
          <OpenOrdersPanel
            locationId={locationId}
            employeeId={employeeId}
            employeePermissions={employeePermissions}
            isExpanded={isTabPanelExpanded}
            onToggleExpand={() => setIsTabPanelExpanded(!isTabPanelExpanded)}
            forceDark={true}
            currentOrderId={selectedTabId || undefined}
            onSelectOrder={(order) => { handleSelectTab(order.id) }}
            onViewOrder={(order) => { handleSelectTab(order.id) }}
            onNewTab={handleQuickTab}
            onClosedOrderAction={() => setTabRefreshTrigger(t => t + 1)}
            refreshTrigger={tabRefreshTrigger + (externalRefreshTrigger || 0)}
          />
        </motion.div>

        {/* ====== CENTER: MENU GRID (hidden when tabs expanded) ====== */}
        {!isTabPanelExpanded && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Categories Section - Hidden in Entertainment mode */}
            {menuSection !== 'entertainment' && (
              <div className="flex-shrink-0 bg-slate-800/30 border-b border-white/10 p-2">
                {/* Settings Panel - shown when editing */}
                {isEditingCategories && (
                  <div className="mb-2 p-2 bg-slate-700/30 rounded-lg flex items-center gap-4 flex-wrap">
                    {/* Rows */}
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-xs">Rows:</span>
                      <div className="flex gap-1">
                        {[1, 2].map(r => (
                          <button
                            key={r}
                            onClick={() => saveCategorySettings({ ...categorySettings, rows: r as CategoryRows })}
                            className={`w-8 h-8 rounded text-sm font-bold transition-all ${
                              categorySettings.rows === r
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                            }`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Size */}
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-xs">Size:</span>
                      <div className="flex gap-1">
                        {CATEGORY_SIZES.map(s => (
                          <button
                            key={s.value}
                            onClick={() => saveCategorySettings({ ...categorySettings, size: s.value })}
                            className={`px-2 h-8 rounded text-xs font-bold transition-all ${
                              categorySettings.size === s.value
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                            }`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Reset Order */}
                    {categoryOrder.length > 0 && (
                      <button
                        onClick={resetCategoryOrder}
                        className="px-2 h-8 rounded text-xs font-bold bg-orange-600 text-white hover:bg-orange-500 transition-all"
                      >
                        Reset Order
                      </button>
                    )}

                    <span className="text-slate-500 text-xs italic">Drag categories to reorder</span>

                    <button
                      onClick={() => setIsEditingCategories(false)}
                      className="ml-auto px-3 py-1 bg-green-600 text-white text-xs font-bold rounded hover:bg-green-500"
                    >
                      Done
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  {/* Vertical Label - Long press to edit */}
                  <div
                    className="flex-shrink-0 w-6 flex items-center justify-center cursor-pointer select-none"
                    {...categoryLongPress}
                    title="Long-press to edit display"
                  >
                    <span
                      className="text-slate-500 text-[10px] font-bold tracking-wider"
                      style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                    >
                      {menuSection === 'bar' ? 'BAR' : 'FOOD'}
                    </span>
                  </div>

                  {/* Categories Grid - Horizontal scroll with dynamic rows */}
                  <div
                    ref={categoryScrollRef}
                    className="flex-1 grid grid-flow-col gap-2 overflow-x-auto overflow-y-hidden scroll-smooth [&::-webkit-scrollbar]:hidden"
                    style={{
                      gridTemplateRows: `repeat(${categorySettings.rows}, 1fr)`,
                      gridAutoColumns: `${currentSizeConfig.px}px`,
                      scrollbarWidth: 'none',
                    }}
                  >
                    {orderedCategories.map(cat => (
                      <button
                        key={cat.id}
                        onClick={() => !isEditingCategories && handleCategoryClick(cat.id)}
                        draggable={isEditingCategories}
                        onDragStart={() => handleCategoryDragStart(cat.id)}
                        onDragOver={(e) => {
                          e.preventDefault()
                          handleCategoryDragOver(cat.id)
                        }}
                        onDragEnd={handleCategoryDragEnd}
                        onTouchStart={(e) => {
                          if (isEditingCategories) {
                            // Start drag on touch for mobile
                            handleCategoryDragStart(cat.id)
                          }
                        }}
                        onTouchMove={(e) => {
                          if (isEditingCategories && draggedCategoryId) {
                            // Find element under touch
                            const touch = e.touches[0]
                            const element = document.elementFromPoint(touch.clientX, touch.clientY)
                            const catButton = element?.closest('[data-category-id]') as HTMLElement
                            if (catButton) {
                              const targetId = catButton.dataset.categoryId
                              if (targetId) handleCategoryDragOver(targetId)
                            }
                          }
                        }}
                        onTouchEnd={() => {
                          if (isEditingCategories) {
                            handleCategoryDragEnd()
                          }
                        }}
                        data-category-id={cat.id}
                        className={`relative rounded-xl font-bold flex items-center justify-center text-center leading-tight p-2 transition-all duration-200 border-2 ${currentSizeConfig.text} ${
                          isEditingCategories
                            ? draggedCategoryId === cat.id
                              ? 'opacity-50 ring-2 ring-indigo-400 scale-95'
                              : 'ring-1 ring-dashed ring-slate-500 cursor-grab'
                            : selectedCategoryId === cat.id
                              ? 'scale-110 ring-4 ring-white/50 shadow-2xl border-white'
                              : 'hover:scale-105 hover:brightness-110 border-black/20 shadow-lg'
                        }`}
                        style={{
                          width: `${currentSizeConfig.px}px`,
                          height: `${currentSizeConfig.px}px`,
                          backgroundColor: cat.color || '#475569',
                          color: isLightColor(cat.color || '') ? '#1e293b' : '#ffffff',
                          textShadow: isLightColor(cat.color || '') ? 'none' : '0 1px 2px rgba(0,0,0,0.5)',
                          ...(selectedCategoryId === cat.id && !isEditingCategories ? {
                            boxShadow: `0 0 20px ${cat.color || '#6366f1'}, 0 0 40px ${cat.color || '#6366f1'}50`,
                          } : {})
                        }}
                      >
                        {isEditingCategories && (
                          <span className="absolute top-0.5 left-0.5 text-[8px] text-slate-400">⋮⋮</span>
                        )}
                        <span className="line-clamp-2">{cat.name}</span>
                      </button>
                    ))}
                  </div>

                  {/* Right Arrow - scrolls right */}
                  {orderedCategories.length > 3 && (
                    <button
                      onClick={() => {
                        if (categoryScrollRef.current) {
                          const scrollAmount = currentSizeConfig.px * 3
                          categoryScrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' })
                        }
                      }}
                      className="flex-shrink-0 w-8 h-full rounded-lg flex items-center justify-center transition-all bg-slate-700/60 text-white hover:bg-slate-600 active:scale-95"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  )}
                </div>

                {filteredCategories.length === 0 && (
                  <div className="text-center py-3 text-slate-500 text-sm">
                    No {menuSection === 'bar' ? 'bar' : 'food'} categories configured
                  </div>
                )}
              </div>
            )}

            {/* My Favorites Bar */}
            {showFavorites && menuSection !== 'entertainment' && (
              <div className="flex-shrink-0 bg-gradient-to-r from-amber-900/20 to-orange-900/20 border-b border-amber-500/20 p-2">
                <div className="flex items-center gap-2">
                  {/* Vertical Label - Long press to edit */}
                  <div
                    className="flex-shrink-0 w-6 flex items-center justify-center cursor-pointer select-none"
                    {...favoritesLongPress}
                    title={favorites.length > 0 ? 'Long-press to edit favorites' : ''}
                  >
                    <span
                      className={`text-[10px] font-bold tracking-wider ${isEditingFavorites ? 'text-red-400' : 'text-amber-400'}`}
                      style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                    >
                      {isEditingFavorites ? 'EDIT' : 'MY BAR'}
                    </span>
                  </div>

                  {/* Favorites Items */}
                  {favorites.length === 0 ? (
                    <div className="flex-1 text-slate-500 text-sm italic">
                      Long-press menu items to add favorites
                    </div>
                  ) : (
                    <div className="flex-1 flex gap-2 overflow-x-auto">
                      {favorites.map(fav => (
                        <FavoriteItem
                          key={fav.menuItemId}
                          fav={fav}
                          isEditingFavorites={isEditingFavorites}
                          onTap={handleFavoriteTap}
                          onRemove={removeFromFavorites}
                        />
                      ))}
                    </div>
                  )}

                  {/* Edit mode buttons */}
                  {isEditingFavorites && (
                    <div className="flex items-center gap-2">
                      {favorites.length > 0 && (
                        <button
                          onClick={clearFavorites}
                          className="text-xs px-2 py-1 bg-red-600/50 text-red-200 rounded hover:bg-red-600 transition-colors"
                        >
                          Clear All
                        </button>
                      )}
                      <button
                        onClick={() => setIsEditingFavorites(false)}
                        className="text-xs px-3 py-1 bg-green-600 text-white font-bold rounded hover:bg-green-500 transition-colors"
                      >
                        Done
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Entertainment Mode Header */}
            {menuSection === 'entertainment' && (
              <div className="flex-shrink-0 bg-purple-900/30 border-b border-purple-500/20 p-3">
                <div className="flex items-center gap-2 text-purple-300">
                  <span className="text-xl">🎱</span>
                  <span className="font-bold">Entertainment</span>
                  <span className="text-purple-400 text-sm ml-auto">{filteredCategories.length} categories</span>
                </div>
              </div>
            )}

            {/* Menu Items Grid */}
            <div className="flex-1 overflow-hidden p-3 flex flex-col">
              {/* Item Settings Panel - shown when editing */}
              {isEditingItems && (
                <div className="flex-shrink-0 mb-2 p-3 bg-slate-700/50 rounded-lg border border-indigo-500/30">
                  <div className="flex items-center gap-4 flex-wrap">
                    {/* Size */}
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-xs">Size:</span>
                      <div className="flex gap-1">
                        {ITEM_SIZES.map(s => (
                          <button
                            key={s.value}
                            onClick={() => saveItemSettings({ ...itemSettings, size: s.value })}
                            className={`px-2 h-7 rounded text-xs font-bold transition-all ${
                              itemSettings.size === s.value
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                            }`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Items Per Row */}
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-xs">Per Row:</span>
                      <div className="flex gap-1">
                        {(['auto', 3, 4, 5, 6] as ItemsPerRow[]).map(n => (
                          <button
                            key={n}
                            onClick={() => saveItemSettings({ ...itemSettings, itemsPerRow: n })}
                            className={`w-8 h-7 rounded text-xs font-bold transition-all ${
                              itemSettings.itemsPerRow === n
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                            }`}
                          >
                            {n === 'auto' ? 'A' : n}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Show Prices Toggle */}
                    <button
                      onClick={() => saveItemSettings({ ...itemSettings, showPrices: !itemSettings.showPrices })}
                      className={`px-2 h-7 rounded text-xs font-bold transition-all ${
                        itemSettings.showPrices
                          ? 'bg-green-600 text-white'
                          : 'bg-slate-600 text-slate-300'
                      }`}
                    >
                      {itemSettings.showPrices ? '$ On' : '$ Off'}
                    </button>

                    {/* Show Dual Pricing Toggle (Cash/Card from system settings) */}
                    {dualPricing.enabled && (
                      <button
                        onClick={() => saveItemSettings({ ...itemSettings, showDualPricing: !itemSettings.showDualPricing })}
                        className={`px-2 h-7 rounded text-xs font-bold transition-all flex items-center gap-1 ${
                          itemSettings.showDualPricing
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-600 text-slate-300'
                        }`}
                        title={`Cash discount: ${dualPricing.cashDiscountPercent}%`}
                      >
                        💵/💳 {itemSettings.showDualPricing ? 'On' : 'Off'}
                      </button>
                    )}

                    {/* Quick Pour Buttons Toggle */}
                    <button
                      onClick={() => saveItemSettings({ ...itemSettings, showQuickPours: !itemSettings.showQuickPours })}
                      className={`px-2 h-7 rounded text-xs font-bold transition-all ${
                        itemSettings.showQuickPours
                          ? 'bg-purple-600 text-white'
                          : 'bg-slate-600 text-slate-300'
                      }`}
                      title="Show quick pour size buttons on liquor items"
                    >
                      🥃 Pours {itemSettings.showQuickPours ? 'On' : 'Off'}
                    </button>

                    {/* Scrolling vs Pagination Toggle */}
                    <button
                      onClick={() => saveItemSettings({ ...itemSettings, useScrolling: !itemSettings.useScrolling })}
                      className={`px-2 h-7 rounded text-xs font-bold transition-all ${
                        itemSettings.useScrolling
                          ? 'bg-cyan-600 text-white'
                          : 'bg-slate-600 text-slate-300'
                      }`}
                      title="Toggle between scrolling and pagination"
                    >
                      {itemSettings.useScrolling ? '📜 Scroll' : '📄 Pages'}
                    </button>

                    {/* Reset Customizations */}
                    {Object.keys(itemCustomizations).length > 0 && (
                      <button
                        onClick={() => {
                          localStorage.removeItem(getItemCustomizationsKey(employeeId))
                          setItemCustomizations({})
                          toast.success('Item styles reset')
                        }}
                        className="px-2 h-7 rounded text-xs font-bold bg-orange-600 text-white hover:bg-orange-500 transition-all"
                      >
                        Reset Styles
                      </button>
                    )}

                    {/* Reset Order for current category */}
                    {selectedCategoryId && itemOrder[selectedCategoryId]?.length > 0 && (
                      <button
                        onClick={resetItemOrder}
                        className="px-2 h-7 rounded text-xs font-bold bg-orange-600 text-white hover:bg-orange-500 transition-all"
                      >
                        Reset Order
                      </button>
                    )}

                    <span className="text-slate-500 text-xs italic">Tap item to customize • Drag to reorder</span>

                    <button
                      onClick={() => {
                        setIsEditingItems(false)
                        setEditingItemId(null)
                      }}
                      className="ml-auto px-3 py-1 bg-green-600 text-white text-xs font-bold rounded hover:bg-green-500"
                    >
                      Done
                    </button>
                  </div>

                  {/* Individual Item Customization Panel */}
                  {editingItemId && (() => {
                    const editingItem = menuItems.find(i => i.id === editingItemId)
                    const currentCustomization = itemCustomizations[editingItemId] || {}
                    if (!editingItem) return null
                    return (
                      <div className="mt-3 pt-3 border-t border-slate-600 space-y-2">
                        {/* Row 1: Item name & Colors */}
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-white font-medium text-sm">{editingItem.name}</span>
                          <div className="flex items-center gap-1">
                            <span className="text-slate-500 text-[10px]">BG</span>
                            <input
                              type="color"
                              value={currentCustomization.backgroundColor || '#334155'}
                              onChange={(e) => saveItemCustomization(editingItemId, { ...currentCustomization, backgroundColor: e.target.value })}
                              className="w-6 h-6 rounded cursor-pointer"
                            />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-slate-500 text-[10px]">Text</span>
                            <input
                              type="color"
                              value={currentCustomization.textColor || '#ffffff'}
                              onChange={(e) => saveItemCustomization(editingItemId, { ...currentCustomization, textColor: e.target.value })}
                              className="w-6 h-6 rounded cursor-pointer"
                            />
                          </div>
                          <button
                            onClick={() => {
                              saveItemCustomization(editingItemId, null)
                              setEditingItemId(null)
                            }}
                            className="ml-auto px-2 h-5 rounded text-[9px] font-bold bg-red-600/40 text-red-300 hover:bg-red-600"
                          >
                            Clear All
                          </button>
                        </div>

                        {/* Row 2: Font Style & Family */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-slate-500 text-[10px]">Font:</span>
                          {(['normal', 'bold', 'italic', 'boldItalic'] as const).map(style => (
                            <button
                              key={style}
                              onClick={() => saveItemCustomization(editingItemId, { ...currentCustomization, fontStyle: style })}
                              className={`px-1.5 h-5 rounded text-[9px] transition-all ${
                                (currentCustomization.fontStyle || 'normal') === style
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                              } ${style === 'bold' || style === 'boldItalic' ? 'font-bold' : ''} ${style === 'italic' || style === 'boldItalic' ? 'italic' : ''}`}
                            >
                              {style === 'boldItalic' ? 'B+I' : style.charAt(0).toUpperCase() + style.slice(1)}
                            </button>
                          ))}
                          <span className="text-slate-600">|</span>
                          {FONT_FAMILIES.map(font => (
                            <button
                              key={font.value}
                              onClick={() => saveItemCustomization(editingItemId, { ...currentCustomization, fontFamily: font.value as ItemCustomization['fontFamily'] })}
                              className={`px-1.5 h-5 rounded text-[9px] transition-all ${font.className} ${
                                (currentCustomization.fontFamily || 'default') === font.value
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                              }`}
                            >
                              {font.label}
                            </button>
                          ))}
                        </div>

                        {/* Row 3: Highlight & Glow Color */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-slate-500 text-[10px]">Pop:</span>
                          {(['none', 'glow', 'border', 'larger'] as const).map(effect => (
                            <button
                              key={effect}
                              onClick={() => saveItemCustomization(editingItemId, { ...currentCustomization, highlight: effect })}
                              className={`px-1.5 h-5 rounded text-[9px] font-medium transition-all ${
                                (currentCustomization.highlight || 'none') === effect
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                              }`}
                            >
                              {effect}
                            </button>
                          ))}
                          {(currentCustomization.highlight === 'glow' || currentCustomization.highlight === 'border') && (
                            <>
                              <span className="text-slate-600">|</span>
                              <span className="text-slate-500 text-[10px]">Color:</span>
                              {GLOW_COLORS.map(gc => (
                                <button
                                  key={gc.color}
                                  onClick={() => saveItemCustomization(editingItemId, {
                                    ...currentCustomization,
                                    glowColor: currentCustomization.highlight === 'glow' ? gc.color : currentCustomization.glowColor,
                                    borderColor: currentCustomization.highlight === 'border' ? gc.color : currentCustomization.borderColor
                                  })}
                                  className={`w-5 h-5 rounded-full border-2 transition-all ${
                                    (currentCustomization.highlight === 'glow' ? currentCustomization.glowColor : currentCustomization.borderColor) === gc.color
                                      ? 'border-white scale-110'
                                      : 'border-transparent hover:scale-110'
                                  }`}
                                  style={{ backgroundColor: gc.color }}
                                  title={gc.label}
                                />
                              ))}
                            </>
                          )}
                        </div>

                        {/* Row 4: Animation Effects */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-slate-500 text-[10px]">Animate:</span>
                          {EFFECT_PRESETS.map(effect => (
                            <button
                              key={effect.value}
                              onClick={() => saveItemCustomization(editingItemId, { ...currentCustomization, effect: effect.value as ItemCustomization['effect'] })}
                              className={`px-1.5 h-5 rounded text-[9px] transition-all flex items-center gap-0.5 ${
                                (currentCustomization.effect || 'none') === effect.value
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                              }`}
                            >
                              <span>{effect.emoji}</span>
                              <span>{effect.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}

              {isLoadingMenu ? (
                <div className="flex-1 flex items-center justify-center text-slate-500">Loading...</div>
              ) : menuItems.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-slate-500">
                  {selectedCategoryId ? 'No items in this category' : 'Select a category'}
                </div>
              ) : (
                <>
                  {/* Items Grid - Dynamic based on settings */}
                  <div
                    className={`flex-1 grid gap-2 min-h-0 ${itemSettings.useScrolling ? 'overflow-y-auto content-start scrollbar-hide' : 'auto-rows-fr'}`}
                    style={{ gridTemplateColumns: `repeat(${effectiveItemsPerRow}, 1fr)` }}
                  >
                    {displayedMenuItems.map(item => {
                      const customization = itemCustomizations[item.id] || {}
                      const isHighlighted = customization.highlight && customization.highlight !== 'none'
                      const isFavorite = favorites.some(f => f.menuItemId === item.id)

                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            if (isEditingItems) {
                              setEditingItemId(editingItemId === item.id ? null : item.id)
                            } else {
                              handleMenuItemTap(item)
                            }
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            if (!isEditingItems) addToFavorites(item)
                          }}
                          draggable={isEditingItems}
                          onDragStart={() => handleItemDragStart(item.id)}
                          onDragOver={(e) => {
                            e.preventDefault()
                            handleItemDragOver(item.id)
                          }}
                          onDragEnd={handleItemDragEnd}
                          className={`relative p-2 rounded-xl text-left transition-all flex flex-col justify-between min-h-0 ${
                            isEditingItems
                              ? editingItemId === item.id
                                ? 'ring-2 ring-indigo-500 bg-indigo-900/30'
                                : 'bg-slate-700/50 hover:bg-slate-700 cursor-move'
                              : 'bg-slate-700/50 hover:bg-slate-700 active:scale-95'
                          } ${
                            customization.highlight === 'border' ? 'border-2' : 'border border-white/5'
                          } ${
                            customization.highlight === 'larger' ? 'scale-105 z-10' : ''
                          } ${
                            customization.effect === 'pulse' ? 'effect-pulse' : ''
                          } ${
                            customization.effect === 'shimmer' ? 'effect-shimmer' : ''
                          } ${
                            customization.effect === 'rainbow' ? 'effect-rainbow' : ''
                          } ${
                            customization.effect === 'neon' ? 'effect-neon' : ''
                          } ${
                            FONT_FAMILIES.find(f => f.value === customization.fontFamily)?.className || ''
                          }`}
                          style={{
                            backgroundColor: customization.backgroundColor || undefined,
                            color: customization.textColor || undefined,
                            boxShadow: customization.highlight === 'glow'
                              ? `0 0 20px ${customization.glowColor || customization.backgroundColor || '#6366f1'}, 0 0 40px ${customization.glowColor || customization.backgroundColor || '#6366f1'}50`
                              : customization.effect === 'neon' && customization.glowColor
                                ? `0 0 10px ${customization.glowColor}, 0 0 20px ${customization.glowColor}80, 0 0 30px ${customization.glowColor}40`
                                : undefined,
                            borderColor: customization.highlight === 'border' ? (customization.borderColor || '#fbbf24') : undefined,
                            minHeight: `${currentItemSizeConfig.height}px`,
                          }}
                        >
                          <div
                            className={`leading-tight ${currentItemSizeConfig.text} ${
                              customization.fontStyle === 'bold' || customization.fontStyle === 'boldItalic' ? 'font-bold' : 'font-semibold'
                            } ${
                              customization.fontStyle === 'italic' || customization.fontStyle === 'boldItalic' ? 'italic' : ''
                            }`}
                            style={{ color: customization.textColor || 'white' }}
                          >
                            {item.name}
                          </div>
                          {/* Price display - hide if quick pours are shown */}
                          {itemSettings.showPrices && !(itemSettings.showQuickPours && item.pourSizes && Object.keys(item.pourSizes).length > 0) && (() => {
                            const prices = getDualPrices(item.price, dualPricing)
                            return (
                              <div className="mt-1">
                                {itemSettings.showDualPricing && dualPricing.enabled ? (
                                  <div className="flex flex-col">
                                    <div
                                      className={`font-semibold ${currentItemSizeConfig.text}`}
                                      style={{ color: customization.textColor ? customization.textColor : '#60a5fa' }}
                                    >
                                      {formatCurrency(prices.cardPrice)}
                                    </div>
                                    <div
                                      className={`font-semibold ${currentItemSizeConfig.text}`}
                                      style={{ color: customization.textColor ? customization.textColor : '#4ade80' }}
                                    >
                                      {formatCurrency(prices.cashPrice)}
                                    </div>
                                  </div>
                                ) : (
                                  <div
                                    className={`font-semibold ${currentItemSizeConfig.text}`}
                                    style={{ color: customization.textColor ? customization.textColor : '#4ade80' }}
                                  >
                                    {formatCurrency(dualPricing.enabled ? prices.cardPrice : prices.cashPrice)}
                                  </div>
                                )}
                              </div>
                            )
                          })()}

                          {/* Quick Pour Buttons - cohesive teal gradient */}
                          {itemSettings.showQuickPours && item.pourSizes && Object.keys(item.pourSizes).length > 0 && !isEditingItems && (
                            <div className="mt-auto pt-1 flex gap-0.5">
                              {Object.entries(item.pourSizes).map(([size, multiplier]) => {
                                const config = POUR_SIZE_CONFIG[size]
                                if (!config) return null
                                const pourPrice = item.price * (multiplier as number)
                                const prices = getDualPrices(pourPrice, dualPricing)
                                const displayPrice = dualPricing.enabled ? prices.cardPrice : prices.cashPrice
                                const isDefault = item.defaultPourSize === size
                                return (
                                  <div
                                    key={size}
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      engine.addItemDirectly({
                                        menuItemId: item.id,
                                        name: `${item.name} (${config.label})`,
                                        price: pourPrice,
                                      })
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.stopPropagation()
                                        engine.addItemDirectly({
                                          menuItemId: item.id,
                                          name: `${item.name} (${config.label})`,
                                          price: pourPrice,
                                        })
                                      }
                                    }}
                                    className={`flex-1 flex flex-col items-center px-1.5 py-1 rounded text-[12px] font-semibold transition-all cursor-pointer min-h-[36px] ${config.color} ${isDefault ? 'ring-1 ring-white/50' : ''} text-white hover:brightness-110`}
                                  >
                                    <span className="leading-tight">{config.label}</span>
                                    <span className="text-[10px] opacity-75">{formatCurrency(displayPrice)}</span>
                                  </div>
                                )
                              })}
                            </div>
                          )}

                          {/* Spirit Tier Buttons for cocktails - skip Well (default) */}
                          {item.spiritTiers && !isEditingItems && (
                            <div className="mt-auto pt-1 flex gap-0.5">
                              {(['call', 'premium', 'top_shelf'] as const).map((tier) => {
                                const config = SPIRIT_TIER_CONFIG[tier]
                                const tierOptions = item.spiritTiers?.[tier as keyof SpiritTiers]
                                if (!tierOptions || tierOptions.length === 0) return null
                                // Show the cheapest option's price as the tier price
                                const minPrice = Math.min(...tierOptions.map(o => o.price))
                                const prices = getDualPrices(item.price + minPrice, dualPricing)
                                const displayPrice = dualPricing.enabled ? prices.cardPrice : prices.cashPrice
                                return (
                                  <div
                                    key={tier}
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleSpiritTierClick(item, tier)
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.stopPropagation()
                                        handleSpiritTierClick(item, tier)
                                      }
                                    }}
                                    className={`flex-1 flex flex-col items-center px-1.5 py-1 rounded text-[12px] font-semibold transition-all min-h-[36px] ${config.color} ${config.hoverColor} text-white cursor-pointer`}
                                  >
                                    <span className="leading-tight">{config.label}</span>
                                    <span className="text-[10px] opacity-75">{formatCurrency(displayPrice)}{tierOptions.length > 1 ? '+' : ''}</span>
                                  </div>
                                )
                              })}
                            </div>
                          )}

                          {isFavorite && !isEditingItems && (
                            <span className="absolute top-1 right-1 text-amber-400 text-xs">⭐</span>
                          )}
                          {isEditingItems && (
                            <span className="absolute top-1 right-1 text-indigo-400 text-xs">✏️</span>
                          )}
                        </button>
                      )
                    })}
                  </div>

                  {/* Pagination & Items Button */}
                  <div className="flex-shrink-0 flex items-center justify-between pt-2">
                    {/* Items Edit Button - Subtle, long press to activate */}
                    <div
                      {...itemsLongPress}
                      className={`px-2 py-1 rounded text-[10px] transition-all select-none cursor-pointer ${
                        isEditingItems
                          ? 'bg-indigo-600/80 text-white'
                          : 'text-slate-600 hover:text-slate-400'
                      }`}
                    >
                      items
                    </div>

                    {/* Pagination - Center */}
                    {totalMenuPages > 1 && (
                      <div className="flex items-center gap-2">
                        {Array.from({ length: totalMenuPages }, (_, i) => i + 1).map(page => (
                          <button
                            key={page}
                            onClick={() => setMenuPage(page)}
                            className={`w-10 h-10 rounded-xl font-bold text-lg transition-colors ${
                              menuPage === page
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                                : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'
                            }`}
                          >
                            {page}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Spacer for balance */}
                    <div className="w-20" />
                  </div>
                </>
              )}
            </div>
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
        item={spiritPopupItem}
        selectedTier={selectedSpiritTier}
        dualPricing={dualPricing}
        onSelect={handleSpiritSelect}
        onClose={handleCloseSpiritPopup}
      />

    </div>
  )
}
