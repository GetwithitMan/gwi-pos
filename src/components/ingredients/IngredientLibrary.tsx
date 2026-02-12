'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { CategorySection } from './CategorySection'
import { IngredientEditorModal } from './IngredientEditorModal'
import { CategoryEditorModal } from './CategoryEditorModal'
import { AddPreparationModal } from './AddPreparationModal'
import { GroupedIngredientHierarchy } from './IngredientHierarchy'
import { toast } from '@/stores/toast-store'

export interface IngredientCategory {
  id: string
  code: number
  name: string
  description?: string | null
  icon?: string | null
  color?: string | null
  sortOrder: number
  isActive: boolean
  ingredientCount?: number
}

export interface InventoryItemRef {
  id: string
  name: string
  storageUnit: string
}

export interface PrepItemRef {
  id: string
  name: string
  outputUnit: string
}

export interface SwapGroup {
  id: string
  name: string
}

export interface Ingredient {
  id: string
  locationId: string
  name: string
  description?: string | null
  category?: string | null // Legacy
  categoryId?: string | null
  categoryRelation?: IngredientCategory | null
  inventoryItemId?: string | null
  inventoryItem?: InventoryItemRef | null
  prepItemId?: string | null
  prepItem?: PrepItemRef | null
  standardQuantity?: number | null
  standardUnit?: string | null
  allowNo: boolean
  allowLite: boolean
  allowExtra: boolean
  allowOnSide: boolean
  extraPrice: number
  liteMultiplier: number
  extraMultiplier: number
  allowSwap: boolean
  swapGroupId?: string | null
  swapGroup?: SwapGroup | null
  swapUpcharge: number
  visibility: string
  sortOrder: number
  isActive: boolean
  usedByCount?: number

  // Hierarchy fields
  parentIngredientId?: string | null
  parentIngredient?: { id: string; name: string; standardQuantity?: number | null; standardUnit?: string | null } | null
  preparationType?: string | null
  yieldPercent?: number | null
  isBaseIngredient?: boolean
  childIngredients?: Ingredient[]
  childCount?: number

  // Explicit Input → Output (for prep items)
  inputQuantity?: number | null    // How much of parent is consumed
  inputUnit?: string | null        // Unit for input (e.g., "oz")
  outputQuantity?: number | null   // How much is produced
  outputUnit?: string | null       // Unit for output (e.g., "oz" or "each")

  // Recipe batch yield (for inventory items with recipes)
  recipeYieldQuantity?: number | null  // How much one recipe batch makes
  recipeYieldUnit?: string | null      // Unit for recipe yield

  // Daily count settings (for prep items)
  isDailyCountItem?: boolean
  countPrecision?: 'whole' | 'decimal'
  currentPrepStock?: number
  lastCountedAt?: string
  lowStockThreshold?: number | null
  criticalStockThreshold?: number | null
  onlineStockThreshold?: number | null

  // Legacy fields (deprecated, use inputQuantity/inputUnit)
  portionSize?: number | null
  portionUnit?: string | null
  batchYield?: number | null
  batchYieldUnit?: string | null

  // Verification (items created from menu builder)
  needsVerification?: boolean
  verifiedAt?: string | null
  verifiedBy?: string | null

  // Linked modifier count (from Modifier.ingredientId)
  linkedModifierCount?: number

  // Source type: delivered vs made in-house
  sourceType?: string

  // Purchase info (for delivered items)
  purchaseUnit?: string | null
  purchaseCost?: number | null
  unitsPerPurchase?: number | null
  showOnQuick86?: boolean
}

interface IngredientLibraryProps {
  locationId: string
}

export function IngredientLibrary({ locationId }: IngredientLibraryProps) {
  const [categories, setCategories] = useState<IngredientCategory[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [swapGroups, setSwapGroups] = useState<SwapGroup[]>([])
  const [inventoryItems, setInventoryItems] = useState<InventoryItemRef[]>([])
  const [prepItems, setPrepItems] = useState<PrepItemRef[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [showInactive, setShowInactive] = useState(false)

  // View mode: 'list' (flat) or 'hierarchy' (tree)
  const [viewMode, setViewMode] = useState<'list' | 'hierarchy'>('hierarchy')

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Deleted items section
  const [deletedIngredients, setDeletedIngredients] = useState<Ingredient[]>([])
  const [showDeleted, setShowDeleted] = useState(false)
  const [restoringItem, setRestoringItem] = useState<Ingredient | null>(null) // Item being restored
  const [restoreStep, setRestoreStep] = useState<'type' | 'category' | 'parent'>('type')
  const [restoreAsType, setRestoreAsType] = useState<'inventory' | 'prep' | null>(null)
  const [restoreCategoryId, setRestoreCategoryId] = useState<string | null>(null)

  // Modal states
  const [showIngredientModal, setShowIngredientModal] = useState(false)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [showPreparationModal, setShowPreparationModal] = useState(false)
  const [editingIngredient, setEditingIngredient] = useState<Ingredient | null>(null)
  const [editingCategory, setEditingCategory] = useState<IngredientCategory | null>(null)
  const [preparationParent, setPreparationParent] = useState<Ingredient | null>(null)

  const loadCategories = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        locationId,
        includeInactive: 'true',
      })
      const response = await fetch(`/api/ingredient-categories?${params}`)
      if (response.ok) {
        const data = await response.json()
        setCategories(data.data || [])
      }
    } catch (error) {
      console.error('Failed to load categories:', error)
    }
  }, [locationId])

  const loadIngredients = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        locationId,
        includeInactive: showInactive ? 'true' : 'false',
        visibility: 'all',
        // When in hierarchy mode, only fetch root ingredients with their children
        hierarchy: viewMode === 'hierarchy' ? 'true' : 'false',
      })
      const response = await fetch(`/api/ingredients?${params}`)
      if (response.ok) {
        const data = await response.json()
        setIngredients(data.data || [])
      }
    } catch (error) {
      console.error('Failed to load ingredients:', error)
    }
  }, [locationId, showInactive, viewMode])

  const loadSwapGroups = useCallback(async () => {
    try {
      const params = new URLSearchParams({ locationId })
      const response = await fetch(`/api/ingredient-swap-groups?${params}`)
      if (response.ok) {
        const data = await response.json()
        setSwapGroups(data.data || [])
      }
    } catch (error) {
      console.error('Failed to load swap groups:', error)
    }
  }, [locationId])

  const loadInventoryItems = useCallback(async () => {
    try {
      const params = new URLSearchParams({ locationId })
      const response = await fetch(`/api/inventory/items?${params}`)
      if (response.ok) {
        const data = await response.json()
        setInventoryItems(data.data || [])
      }
    } catch (error) {
      console.error('Failed to load inventory items:', error)
    }
  }, [locationId])

  const loadPrepItems = useCallback(async () => {
    try {
      const params = new URLSearchParams({ locationId })
      const response = await fetch(`/api/inventory/prep-items?${params}`)
      if (response.ok) {
        const data = await response.json()
        setPrepItems(data.data || [])
      }
    } catch (error) {
      console.error('Failed to load prep items:', error)
    }
  }, [locationId])

  const loadDeletedIngredients = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        locationId,
        deletedOnly: 'true',
      })
      const response = await fetch(`/api/ingredients?${params}`)
      if (response.ok) {
        const data = await response.json()
        setDeletedIngredients(data.data || [])
      }
    } catch (error) {
      console.error('Failed to load deleted ingredients:', error)
    }
  }, [locationId])

  useEffect(() => {
    const loadAll = async () => {
      setIsLoading(true)
      await Promise.all([
        loadCategories(),
        loadIngredients(),
        loadSwapGroups(),
        loadInventoryItems(),
        loadPrepItems(),
        loadDeletedIngredients(),
      ])
      setIsLoading(false)
    }
    loadAll()
  }, [loadCategories, loadIngredients, loadSwapGroups, loadInventoryItems, loadPrepItems, loadDeletedIngredients])

  // Selection handlers
  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleSelectAllInCategory = useCallback((categoryId: string, ingredientIds: string[]) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      // Check if all in category are already selected
      const allSelected = ingredientIds.every(id => next.has(id))

      if (allSelected) {
        // Deselect all in category
        ingredientIds.forEach(id => next.delete(id))
      } else {
        // Select all in category
        ingredientIds.forEach(id => next.add(id))
      }
      return next
    })
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const handleBulkMove = useCallback(async (targetCategoryId: string) => {
    if (selectedIds.size === 0) return

    try {
      const response = await fetch('/api/ingredients/bulk-move', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredientIds: Array.from(selectedIds),
          categoryId: targetCategoryId || null,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const targetCategory = categories.find(c => c.id === targetCategoryId)
        const categoryName = targetCategory?.name || 'Uncategorized'
        toast.success(`Moved ${data.movedCount} ingredients to ${categoryName}`)

        // Clear selection and reload data
        setSelectedIds(new Set())
        await Promise.all([loadIngredients(), loadCategories()])
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to move ingredients')
      }
    } catch (error) {
      console.error('Failed to bulk move:', error)
      toast.error('Failed to move ingredients')
    }
  }, [selectedIds, categories, loadIngredients, loadCategories])

  const handleCreateCategory = () => {
    setEditingCategory(null)
    setShowCategoryModal(true)
  }

  const handleEditCategory = (category: IngredientCategory) => {
    setEditingCategory(category)
    setShowCategoryModal(true)
  }

  const handleCreateIngredient = () => {
    setEditingIngredient(null)
    setShowIngredientModal(true)
  }

  const handleEditIngredient = (ingredient: Ingredient) => {
    setEditingIngredient(ingredient)
    setShowIngredientModal(true)
  }

  const handleSaveCategory = async (data: Partial<IngredientCategory>) => {
    try {
      const url = editingCategory
        ? `/api/ingredient-categories/${editingCategory.id}`
        : '/api/ingredient-categories'
      const method = editingCategory ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, locationId }),
      })

      if (response.ok) {
        await loadCategories()
        setShowCategoryModal(false)
        setEditingCategory(null)
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to save category')
      }
    } catch (error) {
      console.error('Failed to save category:', error)
      toast.error('Failed to save category')
    }
  }

  // Delete category state
  const [deletingCategory, setDeletingCategory] = useState<IngredientCategory | null>(null)
  const [deleteCategoryInfo, setDeleteCategoryInfo] = useState<{ ingredientCount: number; childCount: number; totalCount: number } | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)

  const handleDeleteCategory = async (category: IngredientCategory) => {
    // First, probe the API to check if items exist
    try {
      const response = await fetch(`/api/ingredient-categories/${category.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (response.ok) {
        // No items — deleted directly
        toast.success(`Category "${category.name}" deleted`)
        await Promise.all([loadCategories(), loadIngredients(), loadDeletedIngredients()])
        return
      }

      const data = await response.json()
      if (data.requiresConfirmation) {
        // Has items — show confirmation modal
        setDeletingCategory(category)
        setDeleteCategoryInfo({
          ingredientCount: data.ingredientCount,
          childCount: data.childCount,
          totalCount: data.totalCount,
        })
        setDeleteConfirmText('')
      } else {
        toast.error(data.error || 'Failed to delete category')
      }
    } catch (error) {
      console.error('Failed to delete category:', error)
      toast.error('Failed to delete category')
    }
  }

  const handleConfirmDeleteCategory = async () => {
    if (!deletingCategory || deleteConfirmText !== 'DELETE') return
    setDeleteLoading(true)
    try {
      const response = await fetch(`/api/ingredient-categories/${deletingCategory.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmDelete: 'DELETE' }),
      })

      if (response.ok) {
        const data = await response.json()
        toast.success(data.data?.message || `Category "${deletingCategory.name}" deleted`)
        setDeletingCategory(null)
        setDeleteCategoryInfo(null)
        setDeleteConfirmText('')
        await Promise.all([loadCategories(), loadIngredients(), loadDeletedIngredients()])
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to delete category')
      }
    } catch (error) {
      console.error('Failed to delete category:', error)
      toast.error('Failed to delete category')
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleSaveIngredient = async (data: Partial<Ingredient>) => {
    try {
      const url = editingIngredient
        ? `/api/ingredients/${editingIngredient.id}`
        : '/api/ingredients'
      const method = editingIngredient ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, locationId }),
      })

      if (response.ok) {
        await Promise.all([loadIngredients(), loadCategories()])
        setShowIngredientModal(false)
        setEditingIngredient(null)
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to save ingredient')
      }
    } catch (error) {
      console.error('Failed to save ingredient:', error)
      toast.error('Failed to save ingredient')
    }
  }

  const handleDeleteIngredient = async (ingredient: Ingredient) => {
    // Soft delete - moves to "Deleted" section
    try {
      const response = await fetch(`/api/ingredients/${ingredient.id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        toast.success(`"${ingredient.name}" moved to Deleted section`)
        await Promise.all([loadIngredients(), loadCategories(), loadDeletedIngredients()])
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to delete ingredient')
      }
    } catch (error) {
      console.error('Failed to delete ingredient:', error)
      toast.error('Failed to delete ingredient')
    }
  }

  const handleRestoreIngredient = async (ingredient: Ingredient, destination: {
    type: 'uncategorized' | 'category' | 'inventory-item'
    targetId?: string
    targetName?: string
  }) => {
    try {
      const updateData: Record<string, unknown> = {
        deletedAt: null, // Clear deletion
      }

      if (destination.type === 'uncategorized') {
        updateData.categoryId = null
        updateData.parentIngredientId = null
        updateData.isBaseIngredient = true
      } else if (destination.type === 'category') {
        updateData.categoryId = destination.targetId
        updateData.parentIngredientId = null
        updateData.isBaseIngredient = true
      } else if (destination.type === 'inventory-item') {
        updateData.parentIngredientId = destination.targetId
        updateData.isBaseIngredient = false
      }

      const response = await fetch(`/api/ingredients/${ingredient.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })

      if (response.ok) {
        const destLabel = destination.type === 'uncategorized'
          ? 'Uncategorized'
          : destination.targetName || 'destination'
        toast.success(`"${ingredient.name}" restored to ${destLabel}`)
        setRestoringItem(null)
        setRestoreStep('type')
        setRestoreAsType(null)
        setRestoreCategoryId(null)
        await Promise.all([loadIngredients(), loadCategories(), loadDeletedIngredients()])
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to restore ingredient')
      }
    } catch (error) {
      console.error('Failed to restore ingredient:', error)
      toast.error('Failed to restore ingredient')
    }
  }

  const handlePermanentDelete = async (ingredient: Ingredient) => {
    // Permanent delete - requires double confirmation
    if (!confirm(`⚠️ PERMANENT DELETE\n\nAre you sure you want to permanently delete "${ingredient.name}"?\n\nThis cannot be undone!`)) return
    if (!confirm(`Final confirmation: Delete "${ingredient.name}" forever?`)) return

    try {
      const response = await fetch(`/api/ingredients/${ingredient.id}?permanent=true`, {
        method: 'DELETE',
      })

      if (response.ok) {
        toast.success(`"${ingredient.name}" permanently deleted`)
        await loadDeletedIngredients()
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to permanently delete')
      }
    } catch (error) {
      console.error('Failed to permanently delete:', error)
      toast.error('Failed to permanently delete')
    }
  }

  const handleToggleActive = async (ingredient: Ingredient) => {
    try {
      const response = await fetch(`/api/ingredients/${ingredient.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !ingredient.isActive }),
      })

      if (response.ok) {
        await loadIngredients()
      }
    } catch (error) {
      console.error('Failed to toggle active:', error)
    }
  }

  const handleVerifyIngredient = async (ingredient: Ingredient) => {
    try {
      const response = await fetch(`/api/ingredients/${ingredient.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          needsVerification: false,
          verifiedAt: new Date().toISOString(),
          // TODO: Add verifiedBy with employee ID when available
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        toast.error(error.error || 'Failed to verify ingredient')
        return
      }

      toast.success('Ingredient verified')
      await loadIngredients()
    } catch (error) {
      console.error('Error verifying ingredient:', error)
      toast.error('Failed to verify ingredient')
    }
  }

  const handleAddPreparation = (parent: Ingredient) => {
    setPreparationParent(parent)
    setShowPreparationModal(true)
  }

  const handleSavePreparation = async (data: {
    name: string
    preparationType: string
    yieldPercent: number | null
    inventoryItemId: string | null
    prepItemId: string | null
    standardQuantity: number | null
    standardUnit: string | null
  }) => {
    if (!preparationParent) return

    try {
      const response = await fetch('/api/ingredients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          name: data.name,
          parentIngredientId: preparationParent.id,
          preparationType: data.preparationType,
          yieldPercent: data.yieldPercent,
          inventoryItemId: data.inventoryItemId,
          prepItemId: data.prepItemId,
          standardQuantity: data.standardQuantity,
          standardUnit: data.standardUnit,
          isBaseIngredient: false,
        }),
      })

      if (response.ok) {
        toast.success(`Created preparation: ${data.name}`)
        await Promise.all([loadIngredients(), loadCategories()])
        setShowPreparationModal(false)
        setPreparationParent(null)
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to create preparation')
      }
    } catch (error) {
      console.error('Failed to create preparation:', error)
      toast.error('Failed to create preparation')
    }
  }

  // Group ingredients by category
  const groupedIngredients = useMemo(() => {
    const groups = categories.map(category => ({
      category,
      ingredients: ingredients.filter(ing => ing.categoryId === category.id),
    }))

    // Add uncategorized group
    const uncategorized = ingredients.filter(ing => !ing.categoryId)
    if (uncategorized.length > 0) {
      groups.push({
        category: {
          id: 'uncategorized',
          code: 999,
          name: 'Uncategorized',
          icon: '?',
          color: '#6b7280',
          sortOrder: 9999,
          isActive: true,
        },
        ingredients: uncategorized,
      })
    }

    return groups
  }, [categories, ingredients])

  // Filter by search and selected category
  const filteredGroups = useMemo(() => {
    const searchLower = search.toLowerCase()

    // Check if ingredient or any of its children match the search
    const matchesSearch = (ing: Ingredient): boolean => {
      if (!search) return true
      if (ing.name.toLowerCase().includes(searchLower)) return true
      // Also search child (prep) ingredient names
      if (ing.childIngredients?.some(child => child.name.toLowerCase().includes(searchLower))) return true
      return false
    }

    return groupedIngredients
      .filter(group => !selectedCategory || group.category.id === selectedCategory)
      .map(group => ({
        ...group,
        ingredients: group.ingredients.filter(matchesSearch),
      }))
      .filter(group => group.ingredients.length > 0 || !search)
  }, [groupedIngredients, selectedCategory, search])

  // Filtered ingredients for hierarchy view (applies same search + category filters)
  const filteredIngredients = useMemo(() => {
    return filteredGroups.flatMap(group => group.ingredients)
  }, [filteredGroups])

  // Calculate total visible ingredients for "Select All"
  const visibleIngredientIds = useMemo(() => {
    return filteredGroups.flatMap(group => group.ingredients.map(i => i.id))
  }, [filteredGroups])

  const allVisibleSelected = visibleIngredientIds.length > 0 &&
    visibleIngredientIds.every(id => selectedIds.has(id))
  const someVisibleSelected = selectedIds.size > 0 &&
    visibleIngredientIds.some(id => selectedIds.has(id)) && !allVisibleSelected

  const handleSelectAll = () => {
    if (allVisibleSelected) {
      // Deselect all visible
      setSelectedIds(prev => {
        const next = new Set(prev)
        visibleIngredientIds.forEach(id => next.delete(id))
        return next
      })
    } else {
      // Select all visible
      setSelectedIds(prev => {
        const next = new Set(prev)
        visibleIngredientIds.forEach(id => next.add(id))
        return next
      })
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading ingredient library...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Food Inventory</h1>
          <p className="text-gray-600">
            <span className="inline-flex items-center gap-2">
              <span className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs font-bold">INVENTORY ITEM</span>
              <span>= What you order</span>
              <span className="mx-2">→</span>
              <span className="px-2 py-0.5 bg-green-600 text-white rounded text-xs font-bold">PREP ITEM</span>
              <span>= What goes on menu items</span>
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          {/* View Toggle */}
          <div className="flex rounded-lg border overflow-hidden">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                viewMode === 'list'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              List
            </button>
            <button
              onClick={() => setViewMode('hierarchy')}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                viewMode === 'hierarchy'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Hierarchy
            </button>
          </div>

          <Button variant="outline" onClick={handleCreateCategory}>
            + Category
          </Button>
          <Button onClick={handleCreateIngredient} className="bg-blue-600 hover:bg-blue-700">
            + Inventory Item
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center">
        {/* Select All Checkbox */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            ref={(el) => {
              if (el) el.indeterminate = someVisibleSelected
            }}
            onChange={handleSelectAll}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            title="Select all visible ingredients"
          />
          <span className="text-sm text-gray-600">All</span>
        </div>

        <input
          type="text"
          placeholder="Search ingredients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="px-4 py-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Categories</option>
          {categories.map(cat => (
            <option key={cat.id} value={cat.id}>
              {cat.icon} {cat.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-sm text-gray-600">Show Inactive</span>
        </label>
      </div>

      {/* Category Sections */}
      {filteredGroups.length === 0 && ingredients.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>No ingredients found</p>
          <Button className="mt-4" onClick={handleCreateIngredient}>
            Create your first ingredient
          </Button>
        </div>
      ) : viewMode === 'hierarchy' ? (
        /* Hierarchy View */
        <GroupedIngredientHierarchy
          categories={categories}
          ingredients={filteredIngredients}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onSelectAllInCategory={handleSelectAllInCategory}
          onEdit={handleEditIngredient}
          onDelete={handleDeleteIngredient}
          onAddPreparation={handleAddPreparation}
          onToggleActive={handleToggleActive}
          onVerify={handleVerifyIngredient}
          onEditCategory={(cat) => handleEditCategory(cat as IngredientCategory)}
          onDeleteCategory={(cat) => handleDeleteCategory(cat as IngredientCategory)}
        />
      ) : (
        /* Flat List View */
        <div className="space-y-4">
          {filteredGroups.map(group => (
            <CategorySection
              key={group.category.id}
              category={group.category}
              ingredients={group.ingredients}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onSelectAllInCategory={handleSelectAllInCategory}
              onEditCategory={group.category.id !== 'uncategorized' ? () => handleEditCategory(group.category) : undefined}
              onDeleteCategory={group.category.id !== 'uncategorized' ? () => handleDeleteCategory(group.category) : undefined}
              onEditIngredient={handleEditIngredient}
              onDeleteIngredient={handleDeleteIngredient}
              onToggleActive={handleToggleActive}
              onVerify={handleVerifyIngredient}
            />
          ))}
        </div>
      )}

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (() => {
        // Analyze selected items
        const selectedItems = ingredients.filter(i => selectedIds.has(i.id))
        // Also check child ingredients
        const allItems: Ingredient[] = []
        const collectItems = (items: Ingredient[]) => {
          for (const item of items) {
            if (selectedIds.has(item.id)) allItems.push(item)
            if (item.childIngredients) collectItems(item.childIngredients)
          }
        }
        collectItems(ingredients)

        const hasPrepItems = allItems.some(i => i.parentIngredientId)
        const hasInventoryItems = allItems.some(i => !i.parentIngredientId)
        const allPrepItems = allItems.length > 0 && allItems.every(i => i.parentIngredientId)
        const allInventoryItems = allItems.length > 0 && allItems.every(i => !i.parentIngredientId)

        // Get base ingredients for "Move to Inventory Item" option
        const baseIngredients = ingredients.filter(i => !i.parentIngredientId && i.isBaseIngredient !== false)

        return (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-900/90 backdrop-blur-sm rounded-lg px-4 py-3 flex items-center gap-3 shadow-xl border border-gray-700 z-50">
            <span className="text-white font-medium flex items-center gap-2">
              <span className="text-blue-400">☑</span>
              {selectedIds.size} selected
              {allPrepItems && <span className="text-green-400 text-xs">(prep)</span>}
              {allInventoryItems && <span className="text-blue-400 text-xs">(inventory)</span>}
              {hasPrepItems && hasInventoryItems && <span className="text-yellow-400 text-xs">(mixed)</span>}
            </span>

            {/* Move to Category - for inventory items */}
            {hasInventoryItems && (
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value === '__uncategorized__') {
                    handleBulkMove('')
                  } else if (e.target.value) {
                    handleBulkMove(e.target.value)
                  }
                  e.target.value = ''
                }}
                className="bg-blue-700 text-white rounded px-3 py-1.5 border border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
              >
                <option value="">📁 Category...</option>
                <option value="__uncategorized__">❓ Uncategorized</option>
                {categories.filter(c => c.isActive).map(c => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>
            )}

            {/* Move to different Inventory Item - for prep items */}
            {hasPrepItems && (
              <select
                defaultValue=""
                onChange={async (e) => {
                  if (e.target.value === '__uncategorized__') {
                    // Move to uncategorized (remove parent)
                    const prepIds = allItems.filter(i => i.parentIngredientId).map(i => i.id)
                    for (const id of prepIds) {
                      await fetch(`/api/ingredients/${id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          parentIngredientId: null,
                          categoryId: null,
                          isBaseIngredient: true,
                        }),
                      })
                    }
                    toast.success(`Moved ${prepIds.length} prep items to Uncategorized`)
                    setSelectedIds(new Set())
                    await loadIngredients()
                  } else if (e.target.value) {
                    // Move to different inventory item
                    const prepIds = allItems.filter(i => i.parentIngredientId).map(i => i.id)
                    for (const id of prepIds) {
                      await fetch(`/api/ingredients/${id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          parentIngredientId: e.target.value,
                        }),
                      })
                    }
                    const targetName = baseIngredients.find(b => b.id === e.target.value)?.name || 'new parent'
                    toast.success(`Moved ${prepIds.length} prep items under ${targetName}`)
                    setSelectedIds(new Set())
                    await loadIngredients()
                  }
                  e.target.value = ''
                }}
                className="bg-green-700 text-white rounded px-3 py-1.5 border border-green-500 focus:outline-none focus:ring-2 focus:ring-green-400 text-sm"
              >
                <option value="">📦 Move under...</option>
                <option value="__uncategorized__">❓ Uncategorized</option>
                {baseIngredients.map(inv => (
                  <option key={inv.id} value={inv.id}>
                    {inv.name}
                  </option>
                ))}
              </select>
            )}

            <button
              onClick={handleClearSelection}
              className="text-gray-400 hover:text-white transition-colors text-sm"
            >
              ✕ Clear
            </button>
          </div>
        )
      })()}

      {/* Deleted Section */}
      {deletedIngredients.length > 0 && (
        <div className="mt-8 border-t-2 border-red-200 pt-4">
          <button
            onClick={() => setShowDeleted(!showDeleted)}
            className="w-full flex items-center justify-between p-3 bg-red-50 hover:bg-red-100 rounded-lg border border-red-200 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-red-500">🗑️</span>
              <span className="font-semibold text-red-800">
                Deleted Items ({deletedIngredients.length})
              </span>
              <span className="text-xs text-red-600">
                Click to {showDeleted ? 'hide' : 'show'} - Restore or permanently delete
              </span>
            </div>
            <span className="text-red-500">{showDeleted ? '▼' : '▶'}</span>
          </button>

          {showDeleted && (
            <div className="mt-2 space-y-2 p-3 bg-red-50/50 rounded-lg border border-red-100">
              {deletedIngredients.map(ingredient => {
                const isRestoring = restoringItem?.id === ingredient.id
                const baseIngredients = ingredients.filter(i => !i.parentIngredientId && i.isBaseIngredient !== false)

                return (
                  <div
                    key={ingredient.id}
                    className={`p-3 bg-white rounded border ${isRestoring ? 'border-green-400 ring-2 ring-green-200' : 'border-red-200'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-red-400">🗑️</span>
                        <div>
                          <span className="font-medium text-gray-700">{ingredient.name}</span>
                          {ingredient.parentIngredient && (
                            <span className="text-xs text-gray-400 ml-2">
                              (was prep under {ingredient.parentIngredient.name})
                            </span>
                          )}
                          {ingredient.categoryRelation && !ingredient.parentIngredient && (
                            <span className="text-xs text-gray-400 ml-2">
                              (was in {ingredient.categoryRelation.name})
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {!isRestoring ? (
                          <>
                            <button
                              onClick={() => {
                                setRestoringItem(ingredient)
                                setRestoreStep('type')
                                setRestoreAsType(null)
                                setRestoreCategoryId(null)
                              }}
                              className="px-3 py-1 text-sm bg-green-100 text-green-700 hover:bg-green-200 rounded transition-colors"
                            >
                              ↩️ Restore
                            </button>
                            <button
                              onClick={() => handlePermanentDelete(ingredient)}
                              className="px-3 py-1 text-sm bg-red-100 text-red-700 hover:bg-red-200 rounded transition-colors"
                            >
                              🗑️ Forever
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => {
                              setRestoringItem(null)
                              setRestoreStep('type')
                              setRestoreAsType(null)
                              setRestoreCategoryId(null)
                            }}
                            className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                          >
                            ✕ Cancel
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Restore destination picker - Two-step flow */}
                    {isRestoring && (
                      <div className="mt-3 pt-3 border-t border-green-200">
                        {/* Step 1: Is this an Inventory Item or Prep Item? */}
                        {restoreStep === 'type' && (
                          <>
                            {/* Quick restore to previous location */}
                            {(ingredient.categoryId || ingredient.parentIngredientId) && (
                              <div className="mb-4 pb-3 border-b border-green-100">
                                <button
                                  onClick={() => {
                                    if (ingredient.parentIngredientId) {
                                      // Was a prep item - restore under its parent
                                      handleRestoreIngredient(ingredient, {
                                        type: 'inventory-item',
                                        targetId: ingredient.parentIngredientId,
                                        targetName: `under ${ingredient.parentIngredient?.name || 'previous parent'}`
                                      })
                                    } else if (ingredient.categoryId) {
                                      // Was an inventory item - restore to its category
                                      handleRestoreIngredient(ingredient, {
                                        type: 'category',
                                        targetId: ingredient.categoryId,
                                        targetName: ingredient.categoryRelation?.name || 'previous category'
                                      })
                                    }
                                  }}
                                  className="w-full px-4 py-3 text-sm bg-yellow-50 text-yellow-800 hover:bg-yellow-100 rounded-lg border-2 border-yellow-300 transition-colors font-medium flex items-center justify-center gap-2"
                                >
                                  <span>⏪</span>
                                  <span>
                                    Restore to Previous
                                    <span className="font-normal text-yellow-600 ml-1">
                                      ({ingredient.parentIngredient
                                        ? `under ${ingredient.parentIngredient.name}`
                                        : ingredient.categoryRelation?.name || 'previous location'})
                                    </span>
                                  </span>
                                </button>
                              </div>
                            )}

                            <p className="text-sm font-medium text-green-800 mb-3">
                              {ingredient.categoryId || ingredient.parentIngredientId
                                ? 'Or choose a new location:'
                                : `Is "${ingredient.name}" an Inventory Item or Prep Item?`}
                            </p>
                            <div className="flex gap-3">
                              <button
                                onClick={() => {
                                  setRestoreAsType('inventory')
                                  setRestoreStep('category')
                                }}
                                className="flex-1 px-4 py-3 text-sm bg-blue-100 text-blue-800 hover:bg-blue-200 rounded-lg border-2 border-blue-300 transition-colors font-medium"
                              >
                                <span className="block text-lg mb-1">📦</span>
                                Inventory Item
                                <span className="block text-xs text-blue-600 mt-1">What you order from suppliers</span>
                              </button>
                              <button
                                onClick={() => {
                                  setRestoreAsType('prep')
                                  setRestoreStep('category')
                                }}
                                className="flex-1 px-4 py-3 text-sm bg-green-100 text-green-800 hover:bg-green-200 rounded-lg border-2 border-green-300 transition-colors font-medium"
                              >
                                <span className="block text-lg mb-1">🍳</span>
                                Prep Item
                                <span className="block text-xs text-green-600 mt-1">Made from an inventory item</span>
                              </button>
                            </div>
                          </>
                        )}

                        {/* Step 2a: For Inventory Items - Which category? */}
                        {restoreStep === 'category' && restoreAsType === 'inventory' && (
                          <>
                            <div className="flex items-center gap-2 mb-3">
                              <button
                                onClick={() => {
                                  setRestoreStep('type')
                                  setRestoreAsType(null)
                                }}
                                className="text-gray-500 hover:text-gray-700 text-sm"
                              >
                                ← Back
                              </button>
                              <p className="text-sm font-medium text-green-800">
                                Which category for "{ingredient.name}"?
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {/* Uncategorized option */}
                              <button
                                onClick={() => handleRestoreIngredient(ingredient, { type: 'uncategorized' })}
                                className="px-3 py-2 text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg border border-gray-300 transition-colors"
                              >
                                ❓ Uncategorized
                              </button>

                              {/* Category buttons */}
                              {categories.filter(c => c.isActive).map(c => (
                                <button
                                  key={c.id}
                                  onClick={() => {
                                    handleRestoreIngredient(ingredient, {
                                      type: 'category',
                                      targetId: c.id,
                                      targetName: c.name
                                    })
                                  }}
                                  className="px-3 py-2 text-sm bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors"
                                >
                                  {c.icon} {c.name}
                                </button>
                              ))}
                            </div>
                          </>
                        )}

                        {/* Step 2b: For Prep Items - Which category? */}
                        {restoreStep === 'category' && restoreAsType === 'prep' && (
                          <>
                            <div className="flex items-center gap-2 mb-3">
                              <button
                                onClick={() => {
                                  setRestoreStep('type')
                                  setRestoreAsType(null)
                                }}
                                className="text-gray-500 hover:text-gray-700 text-sm"
                              >
                                ← Back
                              </button>
                              <p className="text-sm font-medium text-green-800">
                                Which category is "{ingredient.name}" in?
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {categories.filter(c => c.isActive).map(c => (
                                <button
                                  key={c.id}
                                  onClick={() => {
                                    setRestoreCategoryId(c.id)
                                    setRestoreStep('parent')
                                  }}
                                  className="px-3 py-2 text-sm bg-green-50 text-green-700 hover:bg-green-100 rounded-lg border border-green-200 transition-colors"
                                >
                                  {c.icon} {c.name}
                                </button>
                              ))}
                            </div>
                          </>
                        )}

                        {/* Step 3: For Prep Items - Which inventory item does it go under? */}
                        {restoreStep === 'parent' && restoreAsType === 'prep' && (
                          <>
                            <div className="flex items-center gap-2 mb-3">
                              <button
                                onClick={() => {
                                  setRestoreStep('category')
                                  setRestoreCategoryId(null)
                                }}
                                className="text-gray-500 hover:text-gray-700 text-sm"
                              >
                                ← Back
                              </button>
                              <p className="text-sm font-medium text-green-800">
                                Which inventory item does "{ingredient.name}" come from?
                              </p>
                            </div>
                            {(() => {
                              // Filter inventory items by the selected category
                              const categoryInventoryItems = baseIngredients.filter(
                                inv => inv.categoryId === restoreCategoryId
                              )
                              const selectedCategory = categories.find(c => c.id === restoreCategoryId)

                              if (categoryInventoryItems.length === 0) {
                                return (
                                  <div className="text-sm text-gray-500 italic p-3 bg-gray-50 rounded-lg">
                                    No inventory items in {selectedCategory?.name || 'this category'}.
                                    <button
                                      onClick={() => {
                                        setRestoreStep('category')
                                        setRestoreCategoryId(null)
                                      }}
                                      className="ml-2 text-blue-600 hover:underline"
                                    >
                                      Choose another category
                                    </button>
                                  </div>
                                )
                              }

                              return (
                                <div className="flex flex-wrap gap-2">
                                  {categoryInventoryItems.map(inv => (
                                    <button
                                      key={inv.id}
                                      onClick={() => {
                                        handleRestoreIngredient(ingredient, {
                                          type: 'inventory-item',
                                          targetId: inv.id,
                                          targetName: `under ${inv.name}`
                                        })
                                      }}
                                      className="px-3 py-2 text-sm bg-green-100 text-green-800 hover:bg-green-200 rounded-lg border border-green-300 transition-colors"
                                    >
                                      📦 {inv.name}
                                    </button>
                                  ))}
                                </div>
                              )
                            })()}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showCategoryModal && (
        <CategoryEditorModal
          category={editingCategory}
          onSave={handleSaveCategory}
          onClose={() => { setShowCategoryModal(false); setEditingCategory(null) }}
        />
      )}

      {showIngredientModal && (
        <IngredientEditorModal
          ingredient={editingIngredient}
          categories={categories.filter(c => c.isActive)}
          swapGroups={swapGroups}
          inventoryItems={inventoryItems}
          prepItems={prepItems}
          onSave={handleSaveIngredient}
          onClose={() => { setShowIngredientModal(false); setEditingIngredient(null) }}
        />
      )}

      {showPreparationModal && preparationParent && (
        <AddPreparationModal
          parentIngredient={preparationParent}
          inventoryItems={inventoryItems}
          prepItems={prepItems}
          onSave={handleSavePreparation}
          onClose={() => { setShowPreparationModal(false); setPreparationParent(null) }}
        />
      )}

      {/* Delete Category Confirmation Modal */}
      {deletingCategory && deleteCategoryInfo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4">
            <div className="p-6 border-b bg-red-50">
              <h2 className="text-xl font-bold text-red-800">
                Delete &ldquo;{deletingCategory.name}&rdquo;?
              </h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
                <p className="font-semibold text-amber-900 mb-2">
                  This category contains:
                </p>
                <ul className="text-sm text-amber-800 space-y-1">
                  {deleteCategoryInfo.ingredientCount > 0 && (
                    <li>
                      {deleteCategoryInfo.ingredientCount} inventory item{deleteCategoryInfo.ingredientCount !== 1 ? 's' : ''}
                    </li>
                  )}
                  {deleteCategoryInfo.childCount > 0 && (
                    <li>
                      {deleteCategoryInfo.childCount} prep item{deleteCategoryInfo.childCount !== 1 ? 's' : ''}
                    </li>
                  )}
                </ul>
                <p className="text-sm text-red-700 font-medium mt-3">
                  All {deleteCategoryInfo.totalCount} item{deleteCategoryInfo.totalCount !== 1 ? 's' : ''} will be moved to the Deleted section.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type <span className="font-bold text-red-600">DELETE</span> to confirm
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-red-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  placeholder="Type DELETE here"
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setDeletingCategory(null)
                    setDeleteCategoryInfo(null)
                    setDeleteConfirmText('')
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleConfirmDeleteCategory}
                  disabled={deleteConfirmText !== 'DELETE' || deleteLoading}
                  className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                >
                  {deleteLoading ? 'Deleting...' : `Delete Category + ${deleteCategoryInfo.totalCount} Item${deleteCategoryInfo.totalCount !== 1 ? 's' : ''}`}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
