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
import { AdminSubNav, menuSubNav } from '@/components/admin/AdminSubNav'
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
  entertainmentStatus?: 'available' | 'in_use' | 'maintenance' | null
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
  const [showItemModal, setShowItemModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
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
      // ItemModal will see an empty list; modifier management is in ItemEditor
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

  // Auto-refresh when viewing entertainment category (for real-time status updates)
  const selectedCategoryType = categories.find(c => c.id === selectedCategory)?.categoryType
  useEffect(() => {
    if (selectedCategoryType !== 'entertainment') return

    // Poll every 3 seconds for entertainment status changes
    const interval = setInterval(() => {
      loadMenuRef.current()
    }, 3000)

    // Also refresh on visibility/focus changes
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
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
    }
  }, [selectedCategoryType])

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

  const handleSaveItem = async (itemData: Omit<Partial<MenuItem>, 'modifierGroups'> & { modifierGroups?: { id: string; showOnline: boolean }[]; ingredientIds?: { ingredientId: string; isIncluded?: boolean }[] }) => {
    try {
      const method = editingItem ? 'PUT' : 'POST'
      const url = editingItem
        ? `/api/menu/items/${editingItem.id}`
        : '/api/menu/items'

      const { modifierGroups: modifierGroupsData, ingredientIds, ...itemFields } = itemData

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...itemFields, categoryId: selectedCategory }),
      })

      if (response.ok) {
        const savedItem = await response.json()
        const itemId = editingItem?.id || savedItem.id

        // Save modifier group links if provided (new format with showOnline)
        if (modifierGroupsData !== undefined && itemId) {
          await fetch(`/api/menu/items/${itemId}/modifiers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modifierGroups: modifierGroupsData }),
          })
        }

        // Save ingredient links if provided
        if (ingredientIds !== undefined && itemId) {
          await fetch(`/api/menu/items/${itemId}/ingredients`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ingredients: ingredientIds }),
          })
        }

        loadMenu()
        setShowItemModal(false)
        setEditingItem(null)
      }
    } catch (error) {
      console.error('Failed to save item:', error)
      toast.error('Failed to save item')
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
          backHref="/orders"
        />
        <AdminSubNav items={menuSubNav} basePath="/menu" />
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
              onClick={() => {
                // Route liquor categories to the Liquor Builder
                if (selectedCategoryData?.categoryType === 'liquor') {
                  router.push('/liquor-builder')
                } else if (selectedCategoryData?.categoryType === 'entertainment') {
                  router.push('/timed-rentals')
                } else {
                  setEditingItem(null)
                  setShowItemModal(true)
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

      {/* Item Modal */}
      {showItemModal && selectedCategoryData && (
        <ItemModal
          item={editingItem}
          categoryType={selectedCategoryData.categoryType}
          modifierGroups={modifierGroups}
          ingredientsLibrary={ingredientsLibrary}
          printers={printers}
          kdsScreens={kdsScreens}
          locationId={employee?.location?.id || ''}
          onSave={handleSaveItem}
          onClose={() => {
            setShowItemModal(false)
            setEditingItem(null)
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

// Item Modal Component
function ItemModal({
  item,
  categoryType,
  modifierGroups,
  ingredientsLibrary,
  printers,
  kdsScreens,
  locationId,
  onSave,
  onClose
}: {
  item: MenuItem | null
  categoryType: string
  modifierGroups: ModifierGroup[]
  ingredientsLibrary: IngredientLibraryItem[]
  printers: Printer[]
  kdsScreens: KDSScreen[]
  locationId: string
  onSave: (data: Omit<Partial<MenuItem>, 'modifierGroups'> & { modifierGroups?: { id: string; showOnline: boolean }[]; ingredientIds?: { ingredientId: string; isIncluded?: boolean }[] }) => void
  onClose: () => void
}) {
  const [name, setName] = useState(item?.name || '')
  const [price, setPrice] = useState(item?.price?.toString() || '')
  const [description, setDescription] = useState(item?.description || '')
  const [commissionType, setCommissionType] = useState<string>(item?.commissionType || '')
  const [commissionValue, setCommissionValue] = useState<string>(
    item?.commissionValue?.toString() || ''
  )
  const [printerIds, setPrinterIds] = useState<string[]>(item?.printerIds || [])
  const [backupPrinterIds, setBackupPrinterIds] = useState<string[]>(item?.backupPrinterIds || [])
  const [comboPrintMode, setComboPrintMode] = useState<'individual' | 'primary' | 'all'>(item?.comboPrintMode || 'individual')
  const [isPrinterDropdownOpen, setIsPrinterDropdownOpen] = useState(false)
  const [isBackupDropdownOpen, setIsBackupDropdownOpen] = useState(false)

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
  const selectedBackupDestinations = printDestinations.filter(d => backupPrinterIds.includes(d.id))
  const [selectedModifierGroups, setSelectedModifierGroups] = useState<{ id: string; showOnline: boolean }[]>(
    item?.modifierGroups?.map(g => ({ id: g.id, showOnline: true })) || []
  )
  const [isLoadingModifiers, setIsLoadingModifiers] = useState(false)

  // Ingredients state - includes pre-modifier overrides
  const [selectedIngredients, setSelectedIngredients] = useState<{
    ingredientId: string
    isIncluded: boolean
    allowNo?: boolean
    allowLite?: boolean
    allowExtra?: boolean
    allowOnSide?: boolean
  }[]>([])
  const [isLoadingIngredients, setIsLoadingIngredients] = useState(false)
  const [showIngredientPicker, setShowIngredientPicker] = useState(false)

  // Modifier type filters - for liquor, default to liquor only; others get primary + universal
  const primaryModType = CATEGORY_TO_MODIFIER_TYPE[categoryType] || 'food'
  const isLiquorCategory = categoryType === 'liquor'
  const isComboCategory = categoryType === 'combos'
  const [enabledModifierTypes, setEnabledModifierTypes] = useState<string[]>(
    isLiquorCategory ? ['liquor'] :
    isComboCategory ? ['universal', 'combo', 'food'] : // Combos can use food modifiers too
    ['universal', primaryModType]
  )

  // Filter modifier groups by enabled types (check if any of group's types match enabled types)
  const filteredModifierGroups = modifierGroups.filter(
    group => {
      const groupTypes = group.modifierTypes || ['universal']
      return groupTypes.some(type => enabledModifierTypes.includes(type))
    }
  )

  // Pour size options for liquor items - now stores { label, multiplier } for each
  const [enabledPourSizes, setEnabledPourSizes] = useState<Record<string, { label: string; multiplier: number }>>(
    normalizePourSizes(item?.pourSizes as Record<string, number | { label: string; multiplier: number }> | null)
  )
  const [defaultPourSize, setDefaultPourSize] = useState(item?.defaultPourSize || 'standard')
  const [applyPourToModifiers, setApplyPourToModifiers] = useState(item?.applyPourToModifiers || false)

  // Timed pricing for entertainment items
  const [isTimedItem, setIsTimedItem] = useState(item?.itemType === 'timed_rental')
  const [per15Min, setPer15Min] = useState(item?.timedPricing?.per15Min?.toString() || '')
  const [per30Min, setPer30Min] = useState(item?.timedPricing?.per30Min?.toString() || '')
  const [perHour, setPerHour] = useState(item?.timedPricing?.perHour?.toString() || '')
  const [minimumMinutes, setMinimumMinutes] = useState(item?.minimumMinutes?.toString() || '15')

  // Show entertainment builder if category is entertainment OR item is already a timed rental
  const isEntertainment = categoryType === 'entertainment' || item?.itemType === 'timed_rental'

  // Load existing modifier group links when editing
  useEffect(() => {
    if (item?.id) {
      setIsLoadingModifiers(true)
      fetch(`/api/menu/items/${item.id}/modifiers`)
        .then(res => res.json())
        .then(data => {
          if (data.modifierGroups) {
            setSelectedModifierGroups(data.modifierGroups.map((g: { id: string; showOnline?: boolean }) => ({
              id: g.id,
              showOnline: g.showOnline ?? true
            })))
          }
        })
        .catch((e) => {
          console.error('Failed to load modifier groups:', e)
          toast.error('Failed to load modifier groups')
        })
        .finally(() => setIsLoadingModifiers(false))
    }
  }, [item?.id])

  // Load existing ingredients when editing
  useEffect(() => {
    if (item?.id) {
      setIsLoadingIngredients(true)
      fetch(`/api/menu/items/${item.id}/ingredients`)
        .then(res => res.json())
        .then(data => {
          if (data.data) {
            setSelectedIngredients(data.data.map((ing: MenuItemIngredient) => ({
              ingredientId: ing.ingredientId,
              isIncluded: ing.isIncluded,
              allowNo: ing.allowNo,
              allowLite: ing.allowLite,
              allowExtra: ing.allowExtra,
              allowOnSide: ing.allowOnSide,
            })))
          }
        })
        .catch((e) => {
          console.error('Failed to load ingredients:', e)
          toast.error('Failed to load ingredients')
        })
        .finally(() => setIsLoadingIngredients(false))
    }
  }, [item?.id])

  const toggleModifierGroup = (groupId: string) => {
    setSelectedModifierGroups(prev => {
      const existing = prev.find(g => g.id === groupId)
      if (existing) {
        return prev.filter(g => g.id !== groupId)
      } else {
        return [...prev, { id: groupId, showOnline: true }]
      }
    })
  }

  const toggleModifierGroupOnline = (groupId: string) => {
    setSelectedModifierGroups(prev =>
      prev.map(g => g.id === groupId ? { ...g, showOnline: !g.showOnline } : g)
    )
  }

  const selectedModifierGroupIds = selectedModifierGroups.map(g => g.id)

  const handleSave = () => {
    const timedPricing = isEntertainment && isTimedItem
      ? {
          per15Min: per15Min ? parseFloat(per15Min) : undefined,
          per30Min: per30Min ? parseFloat(per30Min) : undefined,
          perHour: perHour ? parseFloat(perHour) : undefined,
        }
      : null

    // Pour sizes only for liquor items - save in new format with labels
    const pourSizesData = isLiquorCategory && Object.keys(enabledPourSizes).length > 0
      ? enabledPourSizes
      : null

    onSave({
      name,
      price: parseFloat(price),
      description: description || undefined,
      itemType: isEntertainment && isTimedItem ? 'timed_rental' : 'standard',
      timedPricing,
      minimumMinutes: isEntertainment && isTimedItem && minimumMinutes ? parseInt(minimumMinutes) : null,
      commissionType: commissionType || null,
      commissionValue: commissionValue ? parseFloat(commissionValue) : null,
      modifierGroups: selectedModifierGroups,
      // Liquor pour sizes
      pourSizes: pourSizesData,
      defaultPourSize: isLiquorCategory ? defaultPourSize : null,
      applyPourToModifiers: isLiquorCategory ? applyPourToModifiers : false,
      // Ingredients
      ingredientIds: selectedIngredients,
      // Printer routing
      printerIds: printerIds.length > 0 ? printerIds : null,
      backupPrinterIds: backupPrinterIds.length > 0 ? backupPrinterIds : null,
      // Combo print mode
      comboPrintMode: isComboCategory ? comboPrintMode : null,
    })
  }

  const addIngredient = (ingredientId: string) => {
    if (!selectedIngredients.find(i => i.ingredientId === ingredientId)) {
      setSelectedIngredients([...selectedIngredients, { ingredientId, isIncluded: true }])
    }
    setShowIngredientPicker(false)
  }

  const removeIngredient = (ingredientId: string) => {
    setSelectedIngredients(selectedIngredients.filter(i => i.ingredientId !== ingredientId))
  }

  const toggleIngredientIncluded = (ingredientId: string) => {
    setSelectedIngredients(selectedIngredients.map(i =>
      i.ingredientId === ingredientId ? { ...i, isIncluded: !i.isIncluded } : i
    ))
  }

  const updateIngredientOption = (ingredientId: string, option: 'allowNo' | 'allowLite' | 'allowExtra' | 'allowOnSide', value: boolean) => {
    setSelectedIngredients(selectedIngredients.map(i =>
      i.ingredientId === ingredientId ? { ...i, [option]: value } : i
    ))
  }

  // Show ingredients for food and drinks items (not liquor, entertainment, combos)
  const showIngredientsSection = categoryType === 'food' || categoryType === 'drinks'

  const togglePourSize = (size: string) => {
    const newSizes = { ...enabledPourSizes }
    if (newSizes[size]) {
      delete newSizes[size]
      // If we removed the default, set a new default
      if (defaultPourSize === size && Object.keys(newSizes).length > 0) {
        setDefaultPourSize(Object.keys(newSizes)[0])
      }
    } else {
      // Add with default values
      newSizes[size] = { ...DEFAULT_POUR_SIZES[size] }
    }
    setEnabledPourSizes(newSizes)
  }

  const updatePourSizeLabel = (size: string, label: string) => {
    setEnabledPourSizes(prev => ({
      ...prev,
      [size]: { ...prev[size], label }
    }))
  }

  const updatePourSizeMultiplier = (size: string, multiplier: number) => {
    setEnabledPourSizes(prev => ({
      ...prev,
      [size]: { ...prev[size], multiplier }
    }))
  }

  const resetPourSizeToDefault = (size: string) => {
    setEnabledPourSizes(prev => ({
      ...prev,
      [size]: { ...DEFAULT_POUR_SIZES[size] }
    }))
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <CardTitle>{item ? 'Edit Item' : 'New Item'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={isEntertainment ? 'e.g., Pool Table 1' : 'e.g., Buffalo Wings'}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Base Price</label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-gray-500">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full pl-7 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Entertainment/Timed Pricing Section */}
          {isEntertainment && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <label className="flex items-center gap-2 cursor-pointer mb-3">
                <input
                  type="checkbox"
                  checked={isTimedItem}
                  onChange={(e) => setIsTimedItem(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="font-medium text-orange-800">Enable Timed Billing</span>
              </label>

              {isTimedItem && (
                <div className="space-y-3">
                  <p className="text-sm text-orange-700">
                    Set rates for different time increments. Leave blank to skip that option.
                  </p>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-orange-700 mb-1">Per 15 min</label>
                      <div className="relative">
                        <span className="absolute left-2 top-2 text-gray-500 text-sm">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={per15Min}
                          onChange={(e) => setPer15Min(e.target.value)}
                          className="w-full pl-6 pr-2 py-2 border rounded text-sm"
                          placeholder="5.00"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-orange-700 mb-1">Per 30 min</label>
                      <div className="relative">
                        <span className="absolute left-2 top-2 text-gray-500 text-sm">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={per30Min}
                          onChange={(e) => setPer30Min(e.target.value)}
                          className="w-full pl-6 pr-2 py-2 border rounded text-sm"
                          placeholder="8.00"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-orange-700 mb-1">Per Hour</label>
                      <div className="relative">
                        <span className="absolute left-2 top-2 text-gray-500 text-sm">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={perHour}
                          onChange={(e) => setPerHour(e.target.value)}
                          className="w-full pl-6 pr-2 py-2 border rounded text-sm"
                          placeholder="15.00"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-orange-700 mb-1">Minimum Minutes</label>
                    <select
                      value={minimumMinutes}
                      onChange={(e) => setMinimumMinutes(e.target.value)}
                      className="w-full px-3 py-2 border rounded text-sm"
                    >
                      <option value="15">15 minutes</option>
                      <option value="30">30 minutes</option>
                      <option value="60">1 hour</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Brief description..."
              rows={2}
            />
          </div>

          {/* Commission Section */}
          <div>
            <label className="block text-sm font-medium mb-2">Commission (optional)</label>
            <div className="flex gap-3 items-start">
              <div className="flex-1">
                <select
                  value={commissionType}
                  onChange={(e) => {
                    setCommissionType(e.target.value)
                    if (!e.target.value) setCommissionValue('')
                  }}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">No commission</option>
                  <option value="fixed">Fixed amount ($)</option>
                  <option value="percent">Percentage (%)</option>
                </select>
              </div>
              {commissionType && (
                <div className="w-32">
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-gray-500">
                      {commissionType === 'fixed' ? '$' : '%'}
                    </span>
                    <input
                      type="number"
                      step={commissionType === 'fixed' ? '0.01' : '0.1'}
                      min="0"
                      value={commissionValue}
                      onChange={(e) => setCommissionValue(e.target.value)}
                      className="w-full pl-7 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="0"
                    />
                  </div>
                </div>
              )}
            </div>
            {commissionType && (
              <p className="text-xs text-gray-500 mt-1">
                {commissionType === 'fixed'
                  ? 'Employee earns this fixed amount per sale'
                  : 'Employee earns this percentage of the sale price'}
              </p>
            )}
          </div>

          {/* Pour Size Options - only for liquor items */}
          {isLiquorCategory && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <label className="block text-sm font-medium mb-2 text-purple-800">
                Pour Size Quick Buttons
              </label>
              <p className="text-xs text-purple-600 mb-3">
                Enable quick pour options for this drink. Customize names and multipliers as needed.
              </p>

              <div className="space-y-2 mb-3">
                {Object.entries(DEFAULT_POUR_SIZES).map(([sizeKey, defaults]) => {
                  const isEnabled = enabledPourSizes[sizeKey] !== undefined
                  const currentConfig = enabledPourSizes[sizeKey]
                  const isCustomized = currentConfig && (
                    currentConfig.label !== defaults.label ||
                    currentConfig.multiplier !== defaults.multiplier
                  )

                  return (
                    <div
                      key={sizeKey}
                      className={`p-3 border rounded-lg transition-colors ${
                        isEnabled
                          ? 'border-purple-500 bg-purple-100'
                          : 'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {/* Enable checkbox */}
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={() => togglePourSize(sizeKey)}
                          className="w-4 h-4 text-purple-600 flex-shrink-0"
                        />

                        {isEnabled ? (
                          <>
                            {/* Editable label */}
                            <input
                              type="text"
                              value={currentConfig?.label || ''}
                              onChange={(e) => updatePourSizeLabel(sizeKey, e.target.value)}
                              className="flex-1 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-purple-500 bg-white"
                              placeholder="Button label"
                            />

                            {/* Editable multiplier */}
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <input
                                type="text"
                                inputMode="decimal"
                                key={`${sizeKey}-${currentConfig?.multiplier}`}
                                defaultValue={currentConfig?.multiplier || 1}
                                onBlur={(e) => {
                                  const num = parseFloat(e.target.value)
                                  if (!isNaN(num) && num > 0) {
                                    updatePourSizeMultiplier(sizeKey, num)
                                  } else {
                                    e.target.value = String(currentConfig?.multiplier || 1)
                                  }
                                }}
                                className="w-14 px-1 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-purple-500 text-center bg-white"
                                placeholder="1.0"
                              />
                              <span className="text-xs text-purple-600">×</span>
                            </div>

                            {/* Reset checkbox */}
                            {isCustomized && (
                              <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer flex-shrink-0" title="Reset to default">
                                <input
                                  type="checkbox"
                                  checked={false}
                                  onChange={() => resetPourSizeToDefault(sizeKey)}
                                  className="w-3 h-3"
                                />
                                <span>Reset</span>
                              </label>
                            )}
                          </>
                        ) : (
                          <div className="flex-1 flex items-center justify-between text-gray-400">
                            <span className="text-sm">{defaults.label}</span>
                            <span className="text-xs">{defaults.multiplier}×</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {Object.keys(enabledPourSizes).length > 1 && (
                <div className="mb-3">
                  <label className="block text-xs font-medium mb-1 text-purple-700">Default Pour</label>
                  <select
                    value={defaultPourSize}
                    onChange={(e) => setDefaultPourSize(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    {Object.entries(enabledPourSizes).map(([sizeKey, config]) => (
                      <option key={sizeKey} value={sizeKey}>
                        {config.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={applyPourToModifiers}
                  onChange={(e) => setApplyPourToModifiers(e.target.checked)}
                  className="w-4 h-4 text-purple-600"
                />
                <span className="text-sm text-purple-800">Apply multiplier to spirit modifiers too</span>
              </label>
              <p className="text-xs text-purple-600 mt-1 ml-6">
                When checked, a double will also double the upcharge for premium spirits
              </p>
            </div>
          )}

          {/* Ingredients Section - for food and drinks items */}
          {showIngredientsSection && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Ingredients (What&apos;s In It)</label>
                <div className="flex items-center gap-2">
                  <a
                    href="/ingredients"
                    target="_blank"
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Manage Library
                  </a>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowIngredientPicker(!showIngredientPicker)}
                  >
                    + Add Ingredient
                  </Button>
                </div>
              </div>

              {isLoadingIngredients ? (
                <p className="text-sm text-gray-500">Loading ingredients...</p>
              ) : ingredientsLibrary.length === 0 ? (
                <div className="text-sm text-gray-500 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="font-medium text-amber-800">No ingredients in library</p>
                  <p className="mt-1">
                    <a href="/ingredients" className="text-blue-600 hover:underline font-medium">
                      → Go to Ingredients
                    </a>{' '}
                    to create ingredients like Lettuce, Tomato, Bacon, etc.
                  </p>
                </div>
              ) : selectedIngredients.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No ingredients added. Click &quot;+ Add Ingredient&quot; above, or{' '}
                  <a href="/ingredients" className="text-blue-600 hover:underline">create new ingredients</a>.
                </p>
              ) : (
                <div className="space-y-2 border rounded-lg p-2">
                  {selectedIngredients.map(sel => {
                    const ing = ingredientsLibrary.find(i => i.id === sel.ingredientId)
                    if (!ing) return null
                    return (
                      <div
                        key={sel.ingredientId}
                        className="p-2 bg-gray-50 rounded space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={sel.isIncluded}
                                onChange={() => toggleIngredientIncluded(sel.ingredientId)}
                                className="w-4 h-4"
                              />
                              <span className={`font-medium ${sel.isIncluded ? '' : 'text-gray-400 line-through'}`}>
                                {ing.name}
                              </span>
                            </label>
                            {ing.category && (
                              <span className="text-xs text-gray-400">{ing.category}</span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeIngredient(sel.ingredientId)}
                            className="text-red-500 hover:text-red-700 text-sm"
                          >
                            Remove
                          </button>
                        </div>
                        {/* Pre-modifier options - colored toggle buttons */}
                        <div className="flex items-center gap-2 ml-6">
                          <button
                            type="button"
                            onClick={() => updateIngredientOption(sel.ingredientId, 'allowNo', !(sel.allowNo ?? ing.allowNo))}
                            className={`px-2 py-1 text-xs rounded transition-all ${
                              (sel.allowNo ?? ing.allowNo)
                                ? 'bg-red-500 text-white'
                                : 'bg-red-100 text-red-700 hover:bg-red-200'
                            }`}
                          >
                            No
                          </button>
                          <button
                            type="button"
                            onClick={() => updateIngredientOption(sel.ingredientId, 'allowLite', !(sel.allowLite ?? ing.allowLite))}
                            className={`px-2 py-1 text-xs rounded transition-all ${
                              (sel.allowLite ?? ing.allowLite)
                                ? 'bg-yellow-500 text-white'
                                : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                            }`}
                          >
                            Lite
                          </button>
                          <button
                            type="button"
                            onClick={() => updateIngredientOption(sel.ingredientId, 'allowOnSide', !(sel.allowOnSide ?? ing.allowOnSide))}
                            className={`px-2 py-1 text-xs rounded transition-all ${
                              (sel.allowOnSide ?? ing.allowOnSide)
                                ? 'bg-blue-500 text-white'
                                : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                            }`}
                          >
                            Side
                          </button>
                          <button
                            type="button"
                            onClick={() => updateIngredientOption(sel.ingredientId, 'allowExtra', !(sel.allowExtra ?? ing.allowExtra))}
                            className={`px-2 py-1 text-xs rounded transition-all ${
                              (sel.allowExtra ?? ing.allowExtra)
                                ? 'bg-green-500 text-white'
                                : 'bg-green-100 text-green-700 hover:bg-green-200'
                            }`}
                          >
                            Ex
                          </button>
                          {(sel.allowExtra ?? ing.allowExtra) && ing.extraPrice > 0 && (
                            <span className="text-green-600 ml-2">
                              Extra +{formatCurrency(ing.extraPrice)}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Ingredient Picker Dropdown */}
              {showIngredientPicker && (
                <div className="mt-2 border rounded-lg p-2 bg-white shadow-lg max-h-48 overflow-y-auto">
                  {ingredientsLibrary.filter(ing =>
                    !selectedIngredients.find(s => s.ingredientId === ing.id)
                  ).length === 0 ? (
                    <p className="text-sm text-gray-500 p-2">
                      All ingredients added. <a href="/ingredients" className="text-blue-600 hover:underline">Create more</a>
                    </p>
                  ) : (
                    ingredientsLibrary
                      .filter(ing => !selectedIngredients.find(s => s.ingredientId === ing.id))
                      .map(ing => (
                        <button
                          key={ing.id}
                          type="button"
                          onClick={() => addIngredient(ing.id)}
                          className="w-full text-left p-2 hover:bg-gray-50 rounded flex items-center justify-between"
                        >
                          <span>{ing.name}</span>
                          {ing.category && (
                            <span className="text-xs text-gray-400">{ing.category}</span>
                          )}
                        </button>
                      ))
                  )}
                </div>
              )}

              {selectedIngredients.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  {selectedIngredients.filter(i => i.isIncluded).length} included by default,{' '}
                  {selectedIngredients.filter(i => !i.isIncluded).length} optional
                </p>
              )}
            </div>
          )}

          {/* Print Destinations - override category default (Dropdown with checkboxes) */}
          {printDestinations.length > 0 && (
            <div className="space-y-3">
              <div className="relative">
                <label className="block text-sm font-medium mb-2">Print Destinations (override category)</label>
                <button
                  type="button"
                  onClick={() => setIsPrinterDropdownOpen(!isPrinterDropdownOpen)}
                  className="w-full px-3 py-2 border rounded-lg text-left flex items-center justify-between bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <span className={selectedDestinations.length === 0 ? 'text-gray-500' : ''}>
                    {selectedDestinations.length === 0
                      ? 'Use category default...'
                      : selectedDestinations.map(d => d.name).join(', ')}
                  </span>
                  <span className="text-gray-400">{isPrinterDropdownOpen ? '▲' : '▼'}</span>
                </button>

                {isPrinterDropdownOpen && (
                  <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-60 overflow-auto">
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
                  </div>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  {printerIds.length === 0
                    ? 'Using category default destinations'
                    : `Sending to ${printerIds.length} destination(s)`}
                </p>
              </div>

              {/* Backup Destinations - only show if primary destinations are selected */}
              {printerIds.length > 0 && (
                <div className="relative">
                  <label className="block text-sm font-medium mb-2">Backup Destinations (failover)</label>
                  <button
                    type="button"
                    onClick={() => setIsBackupDropdownOpen(!isBackupDropdownOpen)}
                    className="w-full px-3 py-2 border rounded-lg text-left flex items-center justify-between bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    <span className={selectedBackupDestinations.length === 0 ? 'text-gray-500' : ''}>
                      {selectedBackupDestinations.length === 0
                        ? 'Select backup destinations...'
                        : selectedBackupDestinations.map(d => d.name).join(', ')}
                    </span>
                    <span className="text-gray-400">{isBackupDropdownOpen ? '▲' : '▼'}</span>
                  </button>

                  {isBackupDropdownOpen && (
                    <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-60 overflow-auto">
                      {printers.filter(p => p.isActive && !printerIds.includes(p.id)).length > 0 && (
                        <div className="px-3 py-1 text-xs font-semibold text-gray-500 bg-gray-50 border-b">
                          Printers
                        </div>
                      )}
                      {printers.filter(p => p.isActive && !printerIds.includes(p.id)).map(printer => (
                        <label
                          key={printer.id}
                          className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={backupPrinterIds.includes(printer.id)}
                            onChange={() => {
                              setBackupPrinterIds(prev =>
                                prev.includes(printer.id)
                                  ? prev.filter(id => id !== printer.id)
                                  : [...prev, printer.id]
                              )
                            }}
                            className="w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                          />
                          <span className="flex-1">{printer.name}</span>
                          <span className="text-xs text-gray-400">{printer.printerRole}</span>
                        </label>
                      ))}
                      {kdsScreens.filter(k => k.isActive && !printerIds.includes(k.id)).length > 0 && (
                        <div className="px-3 py-1 text-xs font-semibold text-gray-500 bg-gray-50 border-b border-t">
                          KDS Screens
                        </div>
                      )}
                      {kdsScreens.filter(k => k.isActive && !printerIds.includes(k.id)).map(screen => (
                        <label
                          key={screen.id}
                          className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={backupPrinterIds.includes(screen.id)}
                            onChange={() => {
                              setBackupPrinterIds(prev =>
                                prev.includes(screen.id)
                                  ? prev.filter(id => id !== screen.id)
                                  : [...prev, screen.id]
                              )
                            }}
                            className="w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                          />
                          <span className="flex-1">{screen.name}</span>
                          <span className="text-xs text-gray-400">{screen.screenType}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-1">Used if primary destinations fail</p>
                </div>
              )}
            </div>
          )}

          {/* Combo Print Mode - only for combo items */}
          {isComboCategory && printers.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-2">Combo Printing</label>
              <div className="space-y-2">
                <label className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer border-2 transition-all ${
                  comboPrintMode === 'individual' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input
                    type="radio"
                    name="comboPrintMode"
                    value="individual"
                    checked={comboPrintMode === 'individual'}
                    onChange={(e) => setComboPrintMode(e.target.value as 'individual' | 'primary' | 'all')}
                    className="mt-1"
                  />
                  <div>
                    <p className="font-medium text-sm">Individual Routing</p>
                    <p className="text-xs text-gray-500">Each item follows its own print rules (burger→kitchen, drink→bar)</p>
                  </div>
                </label>
                <label className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer border-2 transition-all ${
                  comboPrintMode === 'primary' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input
                    type="radio"
                    name="comboPrintMode"
                    value="primary"
                    checked={comboPrintMode === 'primary'}
                    onChange={(e) => setComboPrintMode(e.target.value as 'individual' | 'primary' | 'all')}
                    className="mt-1"
                  />
                  <div>
                    <p className="font-medium text-sm">Single Printer</p>
                    <p className="text-xs text-gray-500">Entire combo prints to one printer for assembly coordination</p>
                  </div>
                </label>
                <label className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer border-2 transition-all ${
                  comboPrintMode === 'all' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input
                    type="radio"
                    name="comboPrintMode"
                    value="all"
                    checked={comboPrintMode === 'all'}
                    onChange={(e) => setComboPrintMode(e.target.value as 'individual' | 'primary' | 'all')}
                    className="mt-1"
                  />
                  <div>
                    <p className="font-medium text-sm">All Printers</p>
                    <p className="text-xs text-gray-500">Full combo ticket prints at ALL relevant stations</p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Modifier Groups Section - only for non-entertainment or non-timed items */}
          {(!isEntertainment || !isTimedItem) && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Modifier Groups</label>
                {/* Compact type filter - dropdown to add more types */}
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {enabledModifierTypes.map(type => {
                      const typeInfo = MODIFIER_TYPES.find(t => t.value === type)
                      if (!typeInfo) return null
                      return (
                        <span
                          key={type}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full text-white"
                          style={{ backgroundColor: typeInfo.color }}
                        >
                          {typeInfo.label}
                          {enabledModifierTypes.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setEnabledModifierTypes(enabledModifierTypes.filter(t => t !== type))}
                              className="hover:bg-white/20 rounded-full p-0.5"
                            >
                              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </span>
                      )
                    })}
                  </div>
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value && !enabledModifierTypes.includes(e.target.value)) {
                        setEnabledModifierTypes([...enabledModifierTypes, e.target.value])
                      }
                    }}
                    className="text-xs px-2 py-1 border rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">+ Add type</option>
                    {MODIFIER_TYPES.filter(t => !enabledModifierTypes.includes(t.value)).map(type => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {isLoadingModifiers ? (
                <p className="text-sm text-gray-500">Loading modifiers...</p>
              ) : filteredModifierGroups.length === 0 ? (
                <p className="text-sm text-gray-500">
                  {modifierGroups.length === 0
                    ? 'No modifier groups available. Create them in the Modifiers section.'
                    : 'No modifier groups match the selected types.'}
                </p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto border rounded-lg p-2">
                  {filteredModifierGroups.map(group => {
                    const groupTypes = group.modifierTypes || ['universal']
                    return (
                      <label
                        key={group.id}
                        className={`flex items-center gap-3 p-2 rounded cursor-pointer hover:bg-gray-50 ${
                          selectedModifierGroupIds.includes(group.id) ? 'bg-blue-50 border border-blue-200' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedModifierGroupIds.includes(group.id)}
                          onChange={() => toggleModifierGroup(group.id)}
                          className="w-4 h-4"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-1">
                            <p className="font-medium text-sm">{group.name}</p>
                            {groupTypes.slice(0, 2).map(type => {
                              const typeInfo = MODIFIER_TYPES.find(t => t.value === type) || MODIFIER_TYPES[0]
                              return (
                                <span
                                  key={type}
                                  className="px-1 py-0.5 text-[9px] font-medium rounded text-white"
                                  style={{ backgroundColor: typeInfo.color }}
                                >
                                  {typeInfo.label}
                                </span>
                              )
                            })}
                            {groupTypes.length > 2 && (
                              <span className="text-[9px] text-gray-400">+{groupTypes.length - 2}</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500">
                            {group.modifiers.length} options
                            {group.isRequired && <span className="text-red-500 ml-1">(Required)</span>}
                          </p>
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
              {selectedModifierGroupIds.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  {selectedModifierGroupIds.length} modifier group(s) selected
                </p>
              )}

              {/* Online Modifier Groups - show which groups appear for online ordering */}
              {selectedModifierGroups.length > 0 && (
                <div className="mt-4 border-t pt-4">
                  <label className="text-sm font-medium text-purple-700">Online Modifier Groups</label>
                  <p className="text-xs text-gray-500 mb-2">
                    Select which modifier groups appear for online orders
                  </p>
                  <div className="space-y-2 border rounded-lg p-2 bg-purple-50/50">
                    {selectedModifierGroups.map(selected => {
                      const group = modifierGroups.find(g => g.id === selected.id)
                      if (!group) return null
                      return (
                        <label
                          key={selected.id}
                          className={`flex items-center gap-3 p-2 rounded cursor-pointer ${
                            selected.showOnline ? 'bg-purple-100 border border-purple-300' : 'bg-white border border-gray-200'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selected.showOnline}
                            onChange={() => toggleModifierGroupOnline(selected.id)}
                            className="w-4 h-4 accent-purple-600"
                          />
                          <div className="flex-1">
                            <p className={`font-medium text-sm ${selected.showOnline ? 'text-purple-800' : 'text-gray-500'}`}>
                              {group.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {group.modifiers.length} options
                              {group.isRequired && <span className="text-red-500 ml-1">(Required)</span>}
                            </p>
                          </div>
                          {!selected.showOnline && (
                            <span className="text-xs text-amber-600 font-medium">Hidden online</span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {selectedModifierGroups.filter(g => g.showOnline).length} of {selectedModifierGroups.length} groups visible online
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={!name.trim() || !price}
              onClick={handleSave}
            >
              {item ? 'Save Changes' : 'Create Item'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
