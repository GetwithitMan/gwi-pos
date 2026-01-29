'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'

// Category types for reporting and item builder selection
const CATEGORY_TYPES = [
  { value: 'food', label: 'Food', color: '#22c55e', description: 'Kitchen items, appetizers, entrees' },
  { value: 'drinks', label: 'Drinks', color: '#3b82f6', description: 'Non-alcoholic beverages' },
  { value: 'liquor', label: 'Liquor', color: '#8b5cf6', description: 'Beer, wine, spirits' },
  { value: 'entertainment', label: 'Entertainment', color: '#f97316', description: 'Pool tables, darts, games - timed billing' },
  { value: 'combos', label: 'Combos', color: '#ec4899', description: 'Bundled items' },
]

interface Category {
  id: string
  name: string
  color: string
  categoryType: string
  itemCount: number
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
  modifierGroups?: { id: string; name: string }[]
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
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [showItemModal, setShowItemModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)

  // Define loadMenu first so it can be used in useEffects
  const loadMenu = useCallback(async () => {
    try {
      // Add cache-busting for fresh entertainment status
      const timestamp = Date.now()
      console.log('[Menu] Loading menu data...', timestamp)

      const [menuResponse, modifiersResponse] = await Promise.all([
        fetch(`/api/menu?_t=${timestamp}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
          }
        }),
        fetch('/api/menu/modifiers')
      ])

      if (menuResponse.ok) {
        const data = await menuResponse.json()
        // Log entertainment item statuses for debugging
        const entertainmentItems = data.items.filter((i: MenuItem) => i.itemType === 'timed_rental')
        if (entertainmentItems.length > 0) {
          console.log('[Menu] Entertainment items:', entertainmentItems.map((i: MenuItem) => ({
            name: i.name,
            status: i.entertainmentStatus
          })))
        }
        setCategories(data.categories)
        // Force new array reference to ensure React re-renders
        setItems([...data.items])
      }

      if (modifiersResponse.ok) {
        const modData = await modifiersResponse.json()
        setModifierGroups(modData.modifierGroups)
      }
    } catch (error) {
      console.error('Failed to load menu:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/menu')
      return
    }
    loadMenu()
  }, [isAuthenticated, router, loadMenu])

  // Refresh menu when switching categories (especially for entertainment status updates)
  useEffect(() => {
    if (selectedCategory && !isLoading) {
      console.log('[Menu] Category changed, refreshing')
      loadMenu()
    }
  }, [selectedCategory, isLoading, loadMenu])

  // Auto-refresh when viewing entertainment category (for real-time status updates)
  const selectedCategoryType = categories.find(c => c.id === selectedCategory)?.categoryType
  useEffect(() => {
    if (selectedCategoryType !== 'entertainment') return

    console.log('[Menu] Entertainment category selected, starting auto-refresh')

    // Poll every 3 seconds for entertainment status changes
    const interval = setInterval(() => {
      console.log('[Menu] Auto-refresh triggered')
      loadMenu()
    }, 3000)

    // Also refresh on visibility/focus changes
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[Menu] Page visible, refreshing')
        loadMenu()
      }
    }
    const handleFocus = () => {
      console.log('[Menu] Window focused, refreshing')
      loadMenu()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
    }
  }, [selectedCategoryType, loadMenu])

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
    }
  }

  const handleSaveItem = async (itemData: Partial<MenuItem> & { modifierGroupIds?: string[] }) => {
    try {
      const method = editingItem ? 'PUT' : 'POST'
      const url = editingItem
        ? `/api/menu/items/${editingItem.id}`
        : '/api/menu/items'

      const { modifierGroupIds, ...itemFields } = itemData

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...itemFields, categoryId: selectedCategory }),
      })

      if (response.ok) {
        const savedItem = await response.json()
        const itemId = editingItem?.id || savedItem.id

        // Save modifier group links if provided
        if (modifierGroupIds !== undefined && itemId) {
          await fetch(`/api/menu/items/${itemId}/modifiers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modifierGroupIds }),
          })
        }

        loadMenu()
        setShowItemModal(false)
        setEditingItem(null)
      }
    } catch (error) {
      console.error('Failed to save item:', error)
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
    }
  }

  const handleDeleteItem = async (id: string) => {
    if (!confirm('Delete this item?')) return
    try {
      await fetch(`/api/menu/items/${id}`, { method: 'DELETE' })
      loadMenu()
    } catch (error) {
      console.error('Failed to delete item:', error)
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
    }
  }

  const filteredItems = items.filter(item => item.categoryId === selectedCategory)
  const selectedCategoryData = categories.find(c => c.id === selectedCategory)

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.push('/orders')}>
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to POS
          </Button>
          <h1 className="text-2xl font-bold">Menu Management</h1>
        </div>
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => router.push('/modifiers')}>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            Modifiers
          </Button>
          <Button variant="outline" onClick={() => router.push('/liquor-builder')}>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
            Liquor Builder
          </Button>
          <div className="text-sm text-gray-500">
            {employee?.displayName} · {employee?.role.name}
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Categories Sidebar */}
        <div className="w-72 bg-white border-r p-4 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-lg">Categories</h2>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setEditingCategory(null)
                setShowCategoryModal(true)
              }}
            >
              + Add
            </Button>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-gray-400">Loading...</div>
          ) : categories.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <p>No categories yet</p>
              <p className="text-sm">Click + Add to create one</p>
            </div>
          ) : (
            <div className="space-y-2">
              {categories.map(category => {
                const typeInfo = CATEGORY_TYPES.find(t => t.value === category.categoryType)
                return (
                  <div
                    key={category.id}
                    className={`p-3 rounded-lg cursor-pointer transition-all ${
                      selectedCategory === category.id
                        ? 'bg-blue-50 border-2 border-blue-500'
                        : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                    }`}
                    onClick={() => setSelectedCategory(category.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-4 h-4 rounded"
                          style={{ backgroundColor: category.color }}
                        />
                        <span className="font-medium">{category.name}</span>
                      </div>
                      <span className="text-sm text-gray-500">{category.itemCount}</span>
                    </div>
                    {typeInfo && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded mt-1 inline-block"
                        style={{ backgroundColor: typeInfo.color + '20', color: typeInfo.color }}
                      >
                        {typeInfo.label}
                      </span>
                    )}
                    {selectedCategory === category.id && (
                      <div className="flex gap-2 mt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingCategory(category)
                            setShowCategoryModal(true)
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-700"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteCategory(category.id)
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Items Grid */}
        <div className="flex-1 p-6 overflow-y-auto">
          {selectedCategory ? (
            <>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-semibold">
                    {selectedCategoryData?.name} Items
                  </h2>
                  {selectedCategoryData?.categoryType === 'entertainment' && (
                    <p className="text-sm text-orange-600">Entertainment items support timed billing</p>
                  )}
                  {selectedCategoryData?.categoryType === 'liquor' && (
                    <p className="text-sm text-purple-600">
                      Liquor items support recipe tracking.{' '}
                      <button
                        onClick={() => router.push('/liquor-builder')}
                        className="underline hover:text-purple-800"
                      >
                        Manage in Liquor Builder
                      </button>
                    </p>
                  )}
                </div>
                <Button
                  variant="primary"
                  onClick={() => {
                    setEditingItem(null)
                    setShowItemModal(true)
                  }}
                >
                  + Add Item
                </Button>
              </div>

              {filteredItems.length === 0 ? (
                <Card className="p-8 text-center">
                  <p className="text-gray-400">No items in this category</p>
                  <p className="text-sm text-gray-400">Click + Add Item to create one</p>
                </Card>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {filteredItems.map(item => (
                    <Card
                      key={item.id}
                      className={`overflow-hidden ${!item.isAvailable ? 'opacity-60' : ''}`}
                    >
                      <CardContent className="p-4">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-semibold">{item.name}</h3>
                          {!item.isAvailable && (
                            <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded">
                              86'd
                            </span>
                          )}
                        </div>
                        <p className="text-lg font-bold text-blue-600 mb-2">
                          {formatCurrency(item.price)}
                        </p>
                        {/* Entertainment status indicator */}
                        {item.itemType === 'timed_rental' && (
                          <div className={`text-xs font-bold mb-2 px-2 py-1 rounded inline-block ${
                            item.entertainmentStatus === 'in_use'
                              ? 'bg-red-100 text-red-700'
                              : item.entertainmentStatus === 'maintenance'
                              ? 'bg-gray-100 text-gray-700'
                              : 'bg-green-100 text-green-700'
                          }`}>
                            {item.entertainmentStatus === 'in_use' ? '● IN USE' :
                             item.entertainmentStatus === 'maintenance' ? '● MAINTENANCE' :
                             '● AVAILABLE'}
                          </div>
                        )}
                        {/* Timed pricing display */}
                        {item.itemType === 'timed_rental' && item.timedPricing && (
                          <div className="text-xs text-orange-600 mb-2 space-y-0.5">
                            {item.timedPricing.per15Min && (
                              <p>15 min: {formatCurrency(item.timedPricing.per15Min)}</p>
                            )}
                            {item.timedPricing.per30Min && (
                              <p>30 min: {formatCurrency(item.timedPricing.per30Min)}</p>
                            )}
                            {item.timedPricing.perHour && (
                              <p>Hour: {formatCurrency(item.timedPricing.perHour)}</p>
                            )}
                          </div>
                        )}
                        {item.modifierGroupCount && item.modifierGroupCount > 0 && (
                          <p className="text-xs text-purple-600 mb-2">
                            <svg className="w-3 h-3 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                            </svg>
                            {item.modifierGroupCount} modifier group{item.modifierGroupCount > 1 ? 's' : ''}
                          </p>
                        )}
                        {item.commissionType && item.commissionValue && (
                          <p className="text-xs text-indigo-600 mb-2">
                            <svg className="w-3 h-3 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Comm: {item.commissionType === 'fixed' ? formatCurrency(item.commissionValue) : `${item.commissionValue}%`}
                          </p>
                        )}
                        {/* Liquor item recipe info */}
                        {item.isLiquorItem && (
                          <div className="mb-2">
                            {item.hasRecipe ? (
                              <div className="bg-purple-50 rounded p-2 text-xs">
                                <div className="flex items-center justify-between text-purple-700">
                                  <span>{item.recipeIngredientCount} ingredient{item.recipeIngredientCount !== 1 ? 's' : ''}</span>
                                  <span className={`font-medium ${
                                    (item.profitMargin || 0) >= 70 ? 'text-green-600' :
                                    (item.profitMargin || 0) >= 50 ? 'text-yellow-600' : 'text-red-600'
                                  }`}>
                                    {item.profitMargin}% margin
                                  </span>
                                </div>
                                <div className="flex items-center justify-between mt-1 text-purple-600">
                                  <span>Pour cost: {formatCurrency(item.totalPourCost || 0)}</span>
                                  <span>Profit: {formatCurrency(item.price - (item.totalPourCost || 0))}</span>
                                </div>
                              </div>
                            ) : (
                              <p className="text-xs text-orange-600">
                                <svg className="w-3 h-3 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                No recipe set
                              </p>
                            )}
                          </div>
                        )}
                        {item.description && (
                          <p className="text-sm text-gray-500 mb-3 line-clamp-2">
                            {item.description}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingItem(item)
                              setShowItemModal(true)
                            }}
                          >
                            Edit
                          </Button>
                          {item.isLiquorItem && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-purple-600 border-purple-300 hover:bg-purple-50"
                              onClick={() => router.push(`/liquor-builder?item=${item.id}`)}
                            >
                              Recipe
                            </Button>
                          )}
                          <Button
                            variant={item.isAvailable ? 'outline' : 'primary'}
                            size="sm"
                            onClick={() => handleToggleItem86(item)}
                          >
                            {item.isAvailable ? '86 It' : 'Restore'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500"
                            onClick={() => handleDeleteItem(item.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          ) : (
            <Card className="p-8 text-center">
              <p className="text-gray-400">Select a category to view items</p>
            </Card>
          )}
        </div>
      </div>

      {/* Category Modal */}
      {showCategoryModal && (
        <CategoryModal
          category={editingCategory}
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
  onSave,
  onClose
}: {
  category: Category | null
  onSave: (data: Partial<Category>) => void
  onClose: () => void
}) {
  const [name, setName] = useState(category?.name || '')
  const [color, setColor] = useState(category?.color || '#3b82f6')
  const [categoryType, setCategoryType] = useState(category?.categoryType || 'food')

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
              onClick={() => onSave({ name, color, categoryType })}
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
  onSave,
  onClose
}: {
  item: MenuItem | null
  categoryType: string
  modifierGroups: ModifierGroup[]
  onSave: (data: Partial<MenuItem> & { modifierGroupIds?: string[] }) => void
  onClose: () => void
}) {
  const [name, setName] = useState(item?.name || '')
  const [price, setPrice] = useState(item?.price?.toString() || '')
  const [description, setDescription] = useState(item?.description || '')
  const [commissionType, setCommissionType] = useState<string>(item?.commissionType || '')
  const [commissionValue, setCommissionValue] = useState<string>(
    item?.commissionValue?.toString() || ''
  )
  const [selectedModifierGroupIds, setSelectedModifierGroupIds] = useState<string[]>(
    item?.modifierGroups?.map(g => g.id) || []
  )
  const [isLoadingModifiers, setIsLoadingModifiers] = useState(false)

  // Modifier type filters - for liquor, default to liquor only; others get primary + universal
  const primaryModType = CATEGORY_TO_MODIFIER_TYPE[categoryType] || 'food'
  const isLiquorCategory = categoryType === 'liquor'
  const [enabledModifierTypes, setEnabledModifierTypes] = useState<string[]>(
    isLiquorCategory ? ['liquor'] : ['universal', primaryModType]
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
            setSelectedModifierGroupIds(data.modifierGroups.map((g: { id: string }) => g.id))
          }
        })
        .catch(console.error)
        .finally(() => setIsLoadingModifiers(false))
    }
  }, [item?.id])

  const toggleModifierGroup = (groupId: string) => {
    setSelectedModifierGroupIds(prev =>
      prev.includes(groupId)
        ? prev.filter(id => id !== groupId)
        : [...prev, groupId]
    )
  }

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
      modifierGroupIds: selectedModifierGroupIds,
      // Liquor pour sizes
      pourSizes: pourSizesData,
      defaultPourSize: isLiquorCategory ? defaultPourSize : null,
      applyPourToModifiers: isLiquorCategory ? applyPourToModifiers : false,
    })
  }

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
