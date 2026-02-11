'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import { ItemTreeView } from '@/components/menu/ItemTreeView'
import { ItemEditor, IngredientLibraryItem } from '@/components/menu/ItemEditor'
import { ModifierFlowEditor } from '@/components/menu/ModifierFlowEditor'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { io, Socket } from 'socket.io-client'

// Category types for reporting and item builder selection
const CATEGORY_TYPES = [
  { value: 'food', label: 'Food', color: '#22c55e', description: 'Kitchen items, appetizers, entrees' },
  { value: 'drinks', label: 'Drinks', color: '#3b82f6', description: 'Non-alcoholic beverages' },
  { value: 'liquor', label: 'Liquor', color: '#8b5cf6', description: 'Beer, wine, spirits' },
  { value: 'pizza', label: 'Pizza', color: '#ef4444', description: 'Pizza items with sectional toppings builder' },
  { value: 'entertainment', label: 'Entertainment', color: '#f97316', description: 'Pool tables, darts, games - timed billing' },
  { value: 'combos', label: 'Combos', color: '#ec4899', description: 'Bundled items' },
]

interface Category {
  id: string
  name: string
  color: string
  categoryType: string
  categoryShow: string // 'bar' | 'food' | 'entertainment' | 'all'
  itemCount: number
  isActive: boolean
  printerIds?: string[] | null
}

// Bartender view section options
const CATEGORY_SHOW_OPTIONS = [
  { value: 'bar', label: 'Bar', color: '#3b82f6', description: 'Shows in Bar section only' },
  { value: 'food', label: 'Food', color: '#f97316', description: 'Shows in Food section only' },
  { value: 'entertainment', label: 'Entertainment', color: '#8b5cf6', description: 'Shows in Entertainment mode' },
  { value: 'all', label: 'All', color: '#22c55e', description: 'Shows in both Bar and Food sections' },
]

interface Printer {
  id: string
  name: string
  printerRole: 'receipt' | 'kitchen' | 'bar'
  isActive: boolean
}

interface KDSScreen {
  id: string
  name: string
  screenType: 'kds' | 'entertainment'
  isActive: boolean
}

// Combined type for print destinations (printers + KDS screens)
interface PrintDestination {
  id: string
  name: string
  type: 'printer' | 'kds'
  role?: string
  isActive: boolean
}

interface MenuItem {
  id: string
  name: string
  price: number
  categoryId: string
  description?: string
  isActive: boolean
  isAvailable: boolean
  itemType?: string
  timedPricing?: { per15Min?: number; per30Min?: number; perHour?: number; minimum?: number } | null
  minimumMinutes?: number | null
  modifierGroupCount?: number
  modifierGroups?: { id: string; showOnline: boolean }[]
  commissionType?: string | null
  commissionValue?: number | null
  // Liquor Builder fields
  isLiquorItem?: boolean
  hasRecipe?: boolean
  recipeIngredientCount?: number
  totalPourCost?: number | null
  profitMargin?: number | null
  // Pour size options (new format with labels)
  pourSizes?: Record<string, number | { label: string; multiplier: number }> | null
  defaultPourSize?: string | null
  applyPourToModifiers?: boolean
  // Entertainment fields
  entertainmentStatus?: 'available' | 'in_use' | 'maintenance' | 'reserved' | null
  currentOrderId?: string | null
  blockTimeMinutes?: number | null
  // Printer routing
  printerIds?: string[] | null
  backupPrinterIds?: string[] | null
  // Combo print mode
  comboPrintMode?: 'individual' | 'primary' | 'all' | null
}

interface ModifierGroup {
  id: string
  name: string
  displayName?: string
  modifierTypes: string[]
  minSelections: number
  maxSelections: number
  isRequired: boolean
  modifiers: { id: string; name: string; price: number }[]
}

// IngredientLibraryItem imported from '@/components/menu/ItemEditor'

interface IngredientCategory {
  id: string
  code: number
  name: string
  icon: string | null
  color: string | null
  sortOrder: number
  isActive: boolean
  ingredientCount: number
}

interface MenuItemIngredient {
  id: string
  ingredientId: string
  name: string
  category: string | null
  isIncluded: boolean
  sortOrder: number
  extraPrice: number
  allowNo: boolean
  allowLite: boolean
  allowOnSide: boolean
  allowExtra: boolean
  allowSwap: boolean
  swapUpcharge: number
}

// Modifier type definitions for filtering
const MODIFIER_TYPES = [
  { value: 'universal', label: 'Universal', color: '#6b7280' },
  { value: 'food', label: 'Food', color: '#22c55e' },
  { value: 'liquor', label: 'Liquor', color: '#8b5cf6' },
  { value: 'retail', label: 'Retail', color: '#f59e0b' },
  { value: 'entertainment', label: 'Entertainment', color: '#f97316' },
  { value: 'combo', label: 'Combo', color: '#ec4899' },
]

// Map category types to their primary modifier type
const CATEGORY_TO_MODIFIER_TYPE: Record<string, string> = {
  food: 'food',
  drinks: 'food',
  liquor: 'liquor',
  entertainment: 'entertainment',
  combos: 'combo',
  retail: 'retail',
}

// Pour size configurations for liquor items
const DEFAULT_POUR_SIZES: Record<string, { label: string; multiplier: number }> = {
  standard: { label: 'Standard Pour', multiplier: 1.0 },
  shot: { label: 'Shot', multiplier: 1.0 },
  double: { label: 'Double', multiplier: 2.0 },
  tall: { label: 'Tall', multiplier: 1.5 },
  short: { label: 'Short', multiplier: 0.75 },
}

// Helper to convert old format (Record<string, number>) to new format
function normalizePourSizes(data: Record<string, number | { label: string; multiplier: number }> | null): Record<string, { label: string; multiplier: number }> {
  // Return empty object if no data - nothing selected by default
  if (!data) return {}

  const result: Record<string, { label: string; multiplier: number }> = {}
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'number') {
      // Old format: just a multiplier number
      result[key] = {
        label: DEFAULT_POUR_SIZES[key]?.label || key.charAt(0).toUpperCase() + key.slice(1),
        multiplier: value
      }
    } else {
      // New format: { label, multiplier }
      result[key] = value
    }
  }
  return result
}

export default function MenuManagementPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([])
  const [ingredientsLibrary, setIngredientsLibrary] = useState<IngredientLibraryItem[]>([])
  const [ingredientCategories, setIngredientCategories] = useState<IngredientCategory[]>([])
  const [printers, setPrinters] = useState<Printer[]>([])
  const [kdsScreens, setKdsScreens] = useState<KDSScreen[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [selectedItemForEditor, setSelectedItemForEditor] = useState<MenuItem | null>(null)
  const [selectedTreeNode, setSelectedTreeNode] = useState<{ type: string; id: string } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null)

  // Refs for scroll containers
  const categoriesScrollRef = useRef<HTMLDivElement>(null)
  const itemsScrollRef = useRef<HTMLDivElement>(null)

  // Define loadMenu first so it can be used in useEffects
  const loadMenu = useCallback(async () => {
    try {
      // Add cache-busting for fresh entertainment status
      const timestamp = Date.now()

      const locationId = employee?.location?.id
      const [menuResponse, ingredientsResponse, ingredientCategoriesResponse, printersResponse, kdsResponse] = await Promise.all([
        fetch(`/api/menu?_t=${timestamp}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
          }
        }),
        locationId ? fetch(`/api/ingredients?locationId=${locationId}`) : Promise.resolve(null),
        locationId ? fetch(`/api/ingredient-categories?locationId=${locationId}`) : Promise.resolve(null),
        locationId ? fetch(`/api/hardware/printers?locationId=${locationId}`) : Promise.resolve(null),
        locationId ? fetch(`/api/hardware/kds-screens?locationId=${locationId}`) : Promise.resolve(null)
      ])

      if (menuResponse.ok) {
        const data = await menuResponse.json()
        // Filter out liquor and drinks categories - they belong in Liquor Builder
        const foodCategories = data.categories.filter((c: Category) =>
          c.categoryType !== 'liquor' && c.categoryType !== 'drinks'
        )
        setCategories(foodCategories)
        // Force new array reference to ensure React re-renders
        setItems([...data.items])
      }

      // Shared modifier groups are deprecated — modifiers are now item-owned
      // Modifier management is handled in ItemEditor
      setModifierGroups([])

      if (ingredientsResponse?.ok) {
        const ingData = await ingredientsResponse.json()
        const ingredients = (ingData.data || []).map((ing: any) => ({
          ...ing,
          categoryName: ing.categoryRelation?.name || ing.category || null,
          categoryId: ing.categoryId || null,
          parentName: ing.parentIngredient?.name || null,
          needsVerification: ing.needsVerification || false,
        }))
        setIngredientsLibrary(ingredients)
      }

      if (ingredientCategoriesResponse?.ok) {
        const catData = await ingredientCategoriesResponse.json()
        setIngredientCategories(catData.data || [])
      }

      if (printersResponse?.ok) {
        const printerData = await printersResponse.json()
        setPrinters(printerData.printers || [])
      }

      if (kdsResponse?.ok) {
        const kdsData = await kdsResponse.json()
        setKdsScreens(kdsData.screens || [])
      }
    } catch (error) {
      console.error('Failed to load menu:', error)
    } finally {
      setIsLoading(false)
    }
  }, [employee?.location?.id])

  // Create ref to avoid stale closures
  const loadMenuRef = useRef(loadMenu)
  loadMenuRef.current = loadMenu

  // Initial load
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/menu')
      return
    }
    loadMenuRef.current()
  }, [isAuthenticated, router])

  // Refresh menu when switching categories (especially for entertainment status updates)
  useEffect(() => {
    if (selectedCategory) {
      loadMenuRef.current()
    }
  }, [selectedCategory])

  // Real-time entertainment status updates via socket (replaces polling)
  const selectedCategoryType = categories.find(c => c.id === selectedCategory)?.categoryType
  useEffect(() => {
    if (selectedCategoryType !== 'entertainment' || !employee?.location?.id) return

    const socket: Socket = io()
    const locationId = employee.location.id

    // Join location-specific room for entertainment updates
    socket.emit('join-location', locationId)

    // Listen for real-time entertainment status changes
    socket.on('entertainment:status-changed', (event: {
      itemId: string
      entertainmentStatus: 'available' | 'in_use' | 'reserved' | 'maintenance'
      currentOrderId: string | null
      expiresAt: string | null
    }) => {
      // Patch local items array with updated status
      setItems(prev => prev.map(item =>
        item.id === event.itemId
          ? {
              ...item,
              entertainmentStatus: event.entertainmentStatus,
              currentOrderId: event.currentOrderId,
            }
          : item
      ))
    })

    // Still refresh on visibility/focus changes (useful when tab returns)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadMenuRef.current()
      }
    }
    const handleFocus = () => {
      loadMenuRef.current()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)

    return () => {
      socket.off('entertainment:status-changed')
      socket.disconnect()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
    }
  }, [selectedCategoryType, employee?.location?.id])

  // Socket.io for real-time ingredient library updates
  useEffect(() => {
    const socket: Socket = io()

    socket.on('ingredient:library-update', (data: { ingredient: IngredientLibraryItem }) => {
      setIngredientsLibrary(prev => {
        // Check if ingredient already exists (prevent duplicates)
        const exists = prev.some(ing => ing.id === data.ingredient.id)
        if (exists) return prev

        // Add new ingredient to library
        return [...prev, data.ingredient]
      })
    })

    return () => {
      socket.off('ingredient:library-update')
      socket.disconnect()
    }
  }, [])

  // Handler for cross-item modifier group copy
  const handleCopyModifierGroup = async (groupId: string, sourceItemId: string, targetItemId: string, groupName: string) => {
    try {
      const response = await fetch(`/api/menu/items/${targetItemId}/modifier-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          duplicateFromGroupId: groupId,
          copyFromItemId: sourceItemId,
        }),
      })

      if (response.ok) {
        // Show success toast
        const targetItem = items.find(i => i.id === targetItemId)
        toast.success(`Copied "${groupName}" to "${targetItem?.name}"`)

        // Refresh menu
        await loadMenu()
        setRefreshKey(prev => prev + 1)

        // If the target item is currently selected, refresh will show the new group
      } else {
        const errData = await response.json().catch(() => ({}))
        toast.error(errData.error || 'Failed to copy modifier group')
      }
    } catch (error) {
      console.error('Error copying modifier group:', error)
      toast.error('Failed to copy modifier group')
    }
  }

  const handleSaveCategory = async (categoryData: Partial<Category>) => {
    try {
      const method = editingCategory ? 'PUT' : 'POST'
      const url = editingCategory
        ? `/api/menu/categories/${editingCategory.id}`
        : '/api/menu/categories'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(categoryData),
      })

      if (response.ok) {
        loadMenu()
        setShowCategoryModal(false)
        setEditingCategory(null)
      }
    } catch (error) {
      console.error('Failed to save category:', error)
      toast.error('Failed to save category')
    }
  }


  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Delete this category and all its items?')) return
    try {
      await fetch(`/api/menu/categories/${id}`, { method: 'DELETE' })
      loadMenu()
      if (selectedCategory === id) {
        setSelectedCategory(categories[0]?.id || null)
      }
    } catch (error) {
      console.error('Failed to delete category:', error)
      toast.error('Failed to delete category')
    }
  }

  const handleDeleteItem = async (id: string) => {
    if (!confirm('Delete this item?')) return
    try {
      await fetch(`/api/menu/items/${id}`, { method: 'DELETE' })
      loadMenu()
    } catch (error) {
      console.error('Failed to delete item:', error)
      toast.error('Failed to delete item')
    }
  }

  const handleToggleItem86 = async (item: MenuItem) => {
    try {
      await fetch(`/api/menu/items/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAvailable: !item.isAvailable }),
      })
      loadMenu()
    } catch (error) {
      console.error('Failed to toggle 86:', error)
      toast.error('Failed to update 86 status')
    }
  }

  const handleIngredientCreated = useCallback((ingredient: IngredientLibraryItem) => {
    // Optimistic local update
    setIngredientsLibrary(prev => {
      const exists = prev.some(ing => ing.id === ingredient.id)
      if (exists) return prev
      return [...prev, ingredient]
    })

    // Dispatch socket event to other terminals
    fetch('/api/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'ingredient:library-update',
        data: { ingredient },
      }),
    }).catch(err => {
      console.error('Failed to broadcast ingredient update:', err)
    })
  }, [])

  const filteredItems = items.filter(item => item.categoryId === selectedCategory)
  const selectedCategoryData = categories.find(c => c.id === selectedCategory)

  if (!isAuthenticated) return null

  return (
    <div className="h-screen bg-gray-100 flex flex-col overflow-hidden">
      {/* Header - compact: override mb-6 from shared components */}
      <div className="bg-white border-b shrink-0 px-4 py-1 [&>div]:!mb-1 [&>.flex]:!mb-1">
        <AdminPageHeader
          title="Menu Items"
        />
      </div>

      {/* Categories Bar - Horizontal Scroll */}
      <div className="bg-white border-b px-4 py-1.5 shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-gray-500">Categories</span>
          <Button
            variant="ghost"
            size="sm"
            className="text-blue-600 h-6 text-xs px-2"
            onClick={() => {
              setEditingCategory(null)
              setShowCategoryModal(true)
            }}
          >
            + Add
          </Button>
        </div>
        <div
          ref={categoriesScrollRef}
          className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-gray-300"
        >
          {isLoading ? (
            <div className="text-gray-400 py-2">Loading...</div>
          ) : categories.length === 0 ? (
            <div className="text-gray-400 py-2">No categories - click + Add to create one</div>
          ) : (
            categories.map(category => {
              const typeInfo = CATEGORY_TYPES.find(t => t.value === category.categoryType)
              const isSelected = selectedCategory === category.id
              return (
                <button
                  key={category.id}
                  onClick={() => {
                    setSelectedCategory(category.id)
                    setSelectedItemForEditor(null)
                    setSelectedGroupId(null)
                  }}
                  className={`shrink-0 px-3 py-1.5 rounded-lg border-2 transition-all flex items-center gap-1.5 text-sm ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-transparent bg-gray-100 hover:bg-gray-200'
                  }`}
                >
                  <div
                    className="w-3 h-3 rounded"
                    style={{ backgroundColor: category.color }}
                  />
                  <span className={`font-medium whitespace-nowrap ${isSelected ? 'text-blue-700' : ''}`}>
                    {category.name}
                  </span>
                  <span className={`text-sm ${isSelected ? 'text-blue-500' : 'text-gray-400'}`}>
                    ({category.itemCount})
                  </span>
                  {isSelected && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingCategory(category)
                        setShowCategoryModal(true)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation()
                          setEditingCategory(category)
                          setShowCategoryModal(true)
                        }
                      }}
                      className="ml-1 p-1 hover:bg-blue-100 rounded cursor-pointer"
                    >
                      <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Items Bar - Horizontal Scroll */}
      {selectedCategory && (
        <div className="bg-white border-b px-4 py-1.5 shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-gray-500">
              {selectedCategoryData?.name} Items
            </span>
            {selectedCategoryData?.categoryType === 'liquor' && (
              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                → Opens in Liquor Builder
              </span>
            )}
            {selectedCategoryData?.categoryType === 'entertainment' && (
              <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                → Opens in Entertainment Builder
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-blue-600 h-6 text-xs px-2"
              onClick={async () => {
                // Route liquor categories to the Liquor Builder
                if (selectedCategoryData?.categoryType === 'liquor') {
                  router.push('/liquor-builder')
                } else if (selectedCategoryData?.categoryType === 'entertainment') {
                  router.push('/timed-rentals')
                } else {
                  // Create a new blank item and open it in ItemEditor
                  try {
                    const response = await fetch('/api/menu/items', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        name: 'New Item',
                        price: 0,
                        categoryId: selectedCategory,
                      }),
                    })
                    if (response.ok) {
                      const newItem = await response.json()
                      loadMenu()
                      // Select the new item to open it in ItemEditor
                      setSelectedItemForEditor(newItem)
                      setSelectedGroupId(null)
                    } else {
                      toast.error('Failed to create item')
                    }
                  } catch (error) {
                    console.error('Failed to create item:', error)
                    toast.error('Failed to create item')
                  }
                }
              }}
            >
              + Add Item
            </Button>
          </div>
          <div
            ref={itemsScrollRef}
            className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-gray-300"
          >
            {filteredItems.length === 0 ? (
              <div className="text-gray-400 py-2">No items - click + Add Item to create one</div>
            ) : (
              filteredItems.map(item => {
                const isSelected = selectedItemForEditor?.id === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      // Route liquor items to the Liquor Builder
                      if (selectedCategoryData?.categoryType === 'liquor') {
                        router.push(`/liquor-builder?item=${item.id}`)
                      } else if (selectedCategoryData?.categoryType === 'entertainment') {
                        router.push(`/timed-rentals?item=${item.id}`)
                      } else {
                        setSelectedItemForEditor(item)
                        setSelectedGroupId(null)
                      }
                    }}
                    onDragOver={(e) => {
                      // Only accept modifier group drags
                      if (e.dataTransfer.types.includes('application/x-modifier-group')) {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'copy'
                        setDragOverItemId(item.id)
                      }
                    }}
                    onDragLeave={() => {
                      setDragOverItemId(null)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragOverItemId(null)
                      const data = e.dataTransfer.getData('application/x-modifier-group')
                      if (data) {
                        const { groupId, sourceItemId, groupName } = JSON.parse(data)
                        if (sourceItemId !== item.id) {
                          // Call the cross-item copy handler
                          handleCopyModifierGroup(groupId, sourceItemId, item.id, groupName)
                        }
                      }
                    }}
                    className={`shrink-0 px-3 py-1.5 rounded-lg border-2 transition-all text-left min-w-[120px] ${
                      dragOverItemId === item.id
                        ? 'ring-2 ring-indigo-400 bg-indigo-50'
                        : isSelected
                        ? 'border-blue-500 bg-blue-50'
                        : !item.isAvailable
                        ? 'border-transparent bg-gray-100 opacity-50'
                        : 'border-transparent bg-gray-100 hover:bg-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={`font-medium text-xs ${isSelected ? 'text-blue-700' : ''}`}>
                        {item.name}
                      </span>
                      {!item.isAvailable && (
                        <span className="text-[9px] bg-red-100 text-red-700 px-1 rounded">86</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${isSelected ? 'text-blue-600' : 'text-green-600'}`}>
                        {formatCurrency(item.price)}
                      </span>
                      {item.modifierGroupCount && item.modifierGroupCount > 0 && (
                        <span className="text-[9px] text-purple-600">
                          {item.modifierGroupCount} mod
                        </span>
                      )}
                    </div>
                    {item.itemType === 'timed_rental' && (
                      <div className={`text-[9px] ${
                        item.entertainmentStatus === 'in_use' ? 'text-red-600' : 'text-green-600'
                      }`}>
                        {item.entertainmentStatus === 'in_use' ? '● IN USE' : '● AVAILABLE'}
                      </div>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* Main Content Area - 3 Columns: Tree View + Editor + Modifier Groups Builder */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT: Tree View - Navigation map */}
        <div className={`shrink-0 transition-all duration-300 overflow-hidden ${
          selectedItemForEditor ? 'w-56' : 'w-0'
        }`}>
          <ItemTreeView
            item={selectedItemForEditor}
            refreshKey={refreshKey}
            selectedNode={selectedTreeNode}
            onSelectNode={(type, id) => setSelectedTreeNode({ type, id })}
          />
        </div>

        {/* CENTER: Item Editor (what's live on the front end) */}
        <div className="flex-1 overflow-hidden border-l">
          {!selectedCategory ? (
            <div className="h-full flex items-center justify-center text-gray-400 bg-gray-50">
              <div className="text-center">
                <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <p className="font-medium">Select a category</p>
                <p className="text-xs mt-1">Click on a category above</p>
              </div>
            </div>
          ) : !selectedItemForEditor ? (
            <div className="h-full flex items-center justify-center text-gray-400 bg-gray-50">
              <div className="text-center">
                <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p className="font-medium">Select an item</p>
                <p className="text-xs mt-1">Click on an item above</p>
              </div>
            </div>
          ) : (
            <ItemEditor
              item={selectedItemForEditor}
              ingredientsLibrary={ingredientsLibrary}
              ingredientCategories={ingredientCategories}
              locationId={employee?.location?.id || ''}
              refreshKey={refreshKey}
              onSelectGroup={setSelectedGroupId}
              onItemUpdated={() => {
                loadMenu()
                setRefreshKey(prev => prev + 1)
              }}
              onIngredientCreated={handleIngredientCreated}
              onToggle86={handleToggleItem86}
              onDelete={(itemId) => {
                handleDeleteItem(itemId)
                setSelectedItemForEditor(null)
                setSelectedGroupId(null)
              }}
            />
          )}
        </div>

        {/* RIGHT: Modifier Flow Editor */}
        <div className={`shrink-0 transition-all duration-300 overflow-hidden border-l ${
          selectedItemForEditor ? 'w-96' : 'w-0'
        }`}>
          <ModifierFlowEditor
            item={selectedItemForEditor}
            selectedGroupId={selectedGroupId}
            refreshKey={refreshKey}
            onGroupUpdated={() => {
              loadMenu()
              setRefreshKey(prev => prev + 1)
            }}
          />
        </div>
      </div>

      {/* Category Modal */}
      {showCategoryModal && (
        <CategoryModal
          category={editingCategory}
          printers={printers}
          kdsScreens={kdsScreens}
          onSave={handleSaveCategory}
          onClose={() => {
            setShowCategoryModal(false)
            setEditingCategory(null)
          }}
        />
      )}

    </div>
  )
}

// Category Modal Component
function CategoryModal({
  category,
  printers,
  kdsScreens,
  onSave,
  onClose
}: {
  category: Category | null
  printers: Printer[]
  kdsScreens: KDSScreen[]
  onSave: (data: Partial<Category>) => void
  onClose: () => void
}) {
  const [name, setName] = useState(category?.name || '')
  const [color, setColor] = useState(category?.color || '#3b82f6')
  const [categoryType, setCategoryType] = useState(category?.categoryType || 'food')
  const [printerIds, setPrinterIds] = useState<string[]>(category?.printerIds || [])
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)

  // Combine printers and KDS screens into destinations
  const printDestinations: PrintDestination[] = [
    ...printers.filter(p => p.isActive).map(p => ({
      id: p.id,
      name: p.name,
      type: 'printer' as const,
      role: p.printerRole,
      isActive: p.isActive
    })),
    ...kdsScreens.filter(k => k.isActive).map(k => ({
      id: k.id,
      name: k.name,
      type: 'kds' as const,
      role: k.screenType,
      isActive: k.isActive
    }))
  ]

  const selectedDestinations = printDestinations.filter(d => printerIds.includes(d.id))

  const colors = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'
  ]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{category ? 'Edit Category' : 'New Category'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Appetizers"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Category Type</label>
            <div className="space-y-2">
              {CATEGORY_TYPES.map(type => (
                <label
                  key={type.value}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer border-2 transition-all ${
                    categoryType === type.value
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="categoryType"
                    value={type.value}
                    checked={categoryType === type.value}
                    onChange={(e) => setCategoryType(e.target.value)}
                    className="w-4 h-4"
                  />
                  <div
                    className="w-4 h-4 rounded"
                    style={{ backgroundColor: type.color }}
                  />
                  <div className="flex-1">
                    <p className="font-medium text-sm">{type.label}</p>
                    <p className="text-xs text-gray-500">{type.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Print Destinations - Multiple (Dropdown with checkboxes) */}
          {printDestinations.length > 0 && (
            <div className="relative">
              <label className="block text-sm font-medium mb-2">Default Print Destinations</label>
              <button
                type="button"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="w-full px-3 py-2 border rounded-lg text-left flex items-center justify-between bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <span className={selectedDestinations.length === 0 ? 'text-gray-500' : ''}>
                  {selectedDestinations.length === 0
                    ? 'Select destinations...'
                    : selectedDestinations.map(d => d.name).join(', ')}
                </span>
                <span className="text-gray-400">{isDropdownOpen ? '▲' : '▼'}</span>
              </button>

              {isDropdownOpen && (
                <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-60 overflow-auto">
                  {printDestinations.length === 0 ? (
                    <div className="px-3 py-2 text-gray-500 text-sm">No destinations available</div>
                  ) : (
                    <>
                      {printers.filter(p => p.isActive).length > 0 && (
                        <div className="px-3 py-1 text-xs font-semibold text-gray-500 bg-gray-50 border-b">
                          Printers
                        </div>
                      )}
                      {printers.filter(p => p.isActive).map(printer => (
                        <label
                          key={printer.id}
                          className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={printerIds.includes(printer.id)}
                            onChange={() => {
                              setPrinterIds(prev =>
                                prev.includes(printer.id)
                                  ? prev.filter(id => id !== printer.id)
                                  : [...prev, printer.id]
                              )
                            }}
                            className="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                          />
                          <span className="flex-1">{printer.name}</span>
                          <span className="text-xs text-gray-400">{printer.printerRole}</span>
                        </label>
                      ))}
                      {kdsScreens.filter(k => k.isActive).length > 0 && (
                        <div className="px-3 py-1 text-xs font-semibold text-gray-500 bg-gray-50 border-b border-t">
                          KDS Screens
                        </div>
                      )}
                      {kdsScreens.filter(k => k.isActive).map(screen => (
                        <label
                          key={screen.id}
                          className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={printerIds.includes(screen.id)}
                            onChange={() => {
                              setPrinterIds(prev =>
                                prev.includes(screen.id)
                                  ? prev.filter(id => id !== screen.id)
                                  : [...prev, screen.id]
                              )
                            }}
                            className="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                          />
                          <span className="flex-1">{screen.name}</span>
                          <span className="text-xs text-gray-400">{screen.screenType}</span>
                        </label>
                      ))}
                    </>
                  )}
                </div>
              )}
              <p className="text-xs text-gray-500 mt-1">
                {printerIds.length === 0
                  ? 'Using system default'
                  : `Sending to ${printerIds.length} destination(s)`}
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-2">Color</label>
            <div className="flex gap-2 flex-wrap">
              {colors.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`w-10 h-10 rounded-lg ${color === c ? 'ring-2 ring-offset-2 ring-blue-500' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={!name.trim()}
              onClick={() => onSave({ name, color, categoryType, printerIds: printerIds.length > 0 ? printerIds : null })}
            >
              {category ? 'Save Changes' : 'Create Category'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

