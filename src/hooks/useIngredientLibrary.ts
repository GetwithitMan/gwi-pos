import { useState, useCallback, useRef } from 'react'
import { toast } from '@/stores/toast-store'
import type { Ingredient, IngredientCategory, SwapGroup, InventoryItemRef, PrepItemRef } from '@/components/ingredients/IngredientLibrary'

interface UseIngredientLibraryProps {
  locationId: string
  showInactive: boolean
  viewMode: 'list' | 'hierarchy'
}

export function useIngredientLibrary({ locationId, showInactive, viewMode }: UseIngredientLibraryProps) {
  // Data state
  const [categories, setCategories] = useState<IngredientCategory[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [swapGroups, setSwapGroups] = useState<SwapGroup[]>([])
  const [inventoryItems, setInventoryItems] = useState<InventoryItemRef[]>([])
  const [prepItems, setPrepItems] = useState<PrepItemRef[]>([])
  const [deletedIngredients, setDeletedIngredients] = useState<Ingredient[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Deleted items restore state
  const [restoringItem, setRestoringItem] = useState<Ingredient | null>(null)
  const [restoreStep, setRestoreStep] = useState<'type' | 'category' | 'parent'>('type')
  const [restoreAsType, setRestoreAsType] = useState<'inventory' | 'prep' | null>(null)
  const [restoreCategoryId, setRestoreCategoryId] = useState<string | null>(null)

  // Race condition protection for loadIngredients
  const loadRequestIdRef = useRef(0)

  // Load functions
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
      } else {
        toast.error('Failed to load categories')
      }
    } catch (error) {
      console.error('Failed to load categories:', error)
      toast.error('Failed to load categories')
    }
  }, [locationId])

  const loadIngredients = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current

    try {
      const params = new URLSearchParams({
        locationId,
        includeInactive: showInactive ? 'true' : 'false',
        visibility: 'all',
        hierarchy: viewMode === 'hierarchy' ? 'true' : 'false',
      })
      const response = await fetch(`/api/ingredients?${params}`)

      // Check if this request is still current
      if (requestId !== loadRequestIdRef.current) {
        return // Discard stale response
      }

      if (response.ok) {
        const data = await response.json()
        setIngredients(data.data || [])
      } else {
        toast.error('Failed to load ingredients')
      }
    } catch (error) {
      // Check if this request is still current
      if (requestId !== loadRequestIdRef.current) {
        return
      }
      console.error('Failed to load ingredients:', error)
      toast.error('Failed to load ingredients')
    }
  }, [locationId, showInactive, viewMode])

  const loadSwapGroups = useCallback(async () => {
    try {
      const params = new URLSearchParams({ locationId })
      const response = await fetch(`/api/ingredient-swap-groups?${params}`)
      if (response.ok) {
        const data = await response.json()
        setSwapGroups(data.data || [])
      } else {
        toast.error('Failed to load swap groups')
      }
    } catch (error) {
      console.error('Failed to load swap groups:', error)
      toast.error('Failed to load swap groups')
    }
  }, [locationId])

  const loadInventoryItems = useCallback(async () => {
    try {
      const params = new URLSearchParams({ locationId })
      const response = await fetch(`/api/inventory/items?${params}`)
      if (response.ok) {
        const data = await response.json()
        setInventoryItems(data.data || [])
      } else {
        toast.error('Failed to load inventory items')
      }
    } catch (error) {
      console.error('Failed to load inventory items:', error)
      toast.error('Failed to load inventory items')
    }
  }, [locationId])

  const loadPrepItems = useCallback(async () => {
    try {
      const params = new URLSearchParams({ locationId })
      const response = await fetch(`/api/inventory/prep-items?${params}`)
      if (response.ok) {
        const data = await response.json()
        setPrepItems(data.data || [])
      } else {
        toast.error('Failed to load prep items')
      }
    } catch (error) {
      console.error('Failed to load prep items:', error)
      toast.error('Failed to load prep items')
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
      } else {
        toast.error('Failed to load deleted ingredients')
      }
    } catch (error) {
      console.error('Failed to load deleted ingredients:', error)
      toast.error('Failed to load deleted ingredients')
    }
  }, [locationId])

  // Initial load (everything except ingredients)
  const loadStaticData = useCallback(async () => {
    await Promise.all([
      loadCategories(),
      loadSwapGroups(),
      loadInventoryItems(),
      loadPrepItems(),
      loadDeletedIngredients(),
    ])
  }, [loadCategories, loadSwapGroups, loadInventoryItems, loadPrepItems, loadDeletedIngredients])

  // Mutation functions
  const saveCategory = useCallback(async (categoryData: Partial<IngredientCategory>, editingCategory: IngredientCategory | null) => {
    try {
      const url = editingCategory
        ? `/api/ingredient-categories/${editingCategory.id}`
        : '/api/ingredient-categories'
      const method = editingCategory ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...categoryData, locationId }),
      })

      if (response.ok) {
        await loadCategories()
        toast.success(editingCategory ? 'Category updated' : 'Category created')
        return true
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to save category')
        return false
      }
    } catch (error) {
      console.error('Failed to save category:', error)
      toast.error('Failed to save category')
      return false
    }
  }, [locationId, loadCategories])

  const deleteCategory = useCallback(async (category: IngredientCategory) => {
    try {
      const response = await fetch(`/api/ingredient-categories/${category.id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        await loadCategories()
        toast.success('Category deleted')
        return true
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to delete category')
        return false
      }
    } catch (error) {
      console.error('Failed to delete category:', error)
      toast.error('Failed to delete category')
      return false
    }
  }, [loadCategories])

  const saveIngredient = useCallback(async (ingredientData: Partial<Ingredient>, editingIngredient: Ingredient | null) => {
    try {
      const url = editingIngredient
        ? `/api/ingredients/${editingIngredient.id}`
        : '/api/ingredients'
      const method = editingIngredient ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...ingredientData, locationId }),
      })

      if (response.ok) {
        await Promise.all([loadIngredients(), loadCategories()])
        toast.success(editingIngredient ? 'Ingredient updated' : 'Ingredient created')
        setSelectedIds(new Set()) // Clear selection after create/update
        return true
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to save ingredient')
        return false
      }
    } catch (error) {
      console.error('Failed to save ingredient:', error)
      toast.error('Failed to save ingredient')
      return false
    }
  }, [locationId, loadIngredients, loadCategories])

  const deleteIngredient = useCallback(async (ingredient: Ingredient) => {
    try {
      const response = await fetch(`/api/ingredients/${ingredient.id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        toast.success(`"${ingredient.name}" moved to Deleted section`)
        await Promise.all([loadIngredients(), loadCategories(), loadDeletedIngredients()])
        setSelectedIds(new Set()) // Clear selection after delete
        return true
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to delete ingredient')
        return false
      }
    } catch (error) {
      console.error('Failed to delete ingredient:', error)
      toast.error('Failed to delete ingredient')
      return false
    }
  }, [loadIngredients, loadCategories, loadDeletedIngredients])

  const restoreIngredient = useCallback(async (ingredient: Ingredient, destination: {
    type: 'uncategorized' | 'category' | 'inventory-item' | 'previous'
    targetId?: string
    targetName?: string
  }) => {
    try {
      // Validation for inventory-item type
      if (destination.type === 'inventory-item' && !destination.targetId) {
        toast.error('Please select an inventory item to restore under')
        return false
      }

      const updateData: Record<string, unknown> = {
        deletedAt: null,
      }

      if (destination.type === 'previous') {
        // Restore to previous location
        if (ingredient.parentIngredientId) {
          updateData.parentIngredientId = ingredient.parentIngredientId
          updateData.isBaseIngredient = false
        } else if (ingredient.categoryId) {
          updateData.categoryId = ingredient.categoryId
          updateData.parentIngredientId = null
          updateData.isBaseIngredient = true
        } else {
          updateData.categoryId = null
          updateData.parentIngredientId = null
          updateData.isBaseIngredient = true
        }
      } else if (destination.type === 'uncategorized') {
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
        const destLabel = destination.type === 'previous'
          ? 'previous location'
          : destination.type === 'uncategorized'
            ? 'Uncategorized'
            : destination.targetName || 'destination'
        toast.success(`"${ingredient.name}" restored to ${destLabel}`)
        setRestoringItem(null)
        setRestoreStep('type')
        setRestoreAsType(null)
        setRestoreCategoryId(null)
        await Promise.all([loadIngredients(), loadCategories(), loadDeletedIngredients()])
        return true
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to restore ingredient')
        return false
      }
    } catch (error) {
      console.error('Failed to restore ingredient:', error)
      toast.error('Failed to restore ingredient')
      return false
    }
  }, [loadIngredients, loadCategories, loadDeletedIngredients])

  const permanentDelete = useCallback(async (ingredient: Ingredient) => {
    try {
      const response = await fetch(`/api/ingredients/${ingredient.id}?permanent=true`, {
        method: 'DELETE',
      })

      if (response.ok) {
        toast.success(`"${ingredient.name}" permanently deleted`)
        await loadDeletedIngredients()
        return true
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to permanently delete')
        return false
      }
    } catch (error) {
      console.error('Failed to permanently delete:', error)
      toast.error('Failed to permanently delete')
      return false
    }
  }, [loadDeletedIngredients])

  const toggleActive = useCallback(async (ingredient: Ingredient) => {
    try {
      const response = await fetch(`/api/ingredients/${ingredient.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !ingredient.isActive }),
      })

      if (response.ok) {
        await loadIngredients()
        return true
      } else {
        toast.error('Failed to toggle active status')
        return false
      }
    } catch (error) {
      console.error('Failed to toggle active:', error)
      toast.error('Failed to toggle active status')
      return false
    }
  }, [loadIngredients])

  const bulkMove = useCallback(async (ingredientIds: string[], targetCategoryId: string) => {
    if (ingredientIds.length === 0) return false

    try {
      const response = await fetch('/api/ingredients/bulk-move', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredientIds,
          categoryId: targetCategoryId || null,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const targetCategory = categories.find(c => c.id === targetCategoryId)
        const categoryName = targetCategory?.name || 'Uncategorized'
        toast.success(`Moved ${data.movedCount} ingredients to ${categoryName}`)
        setSelectedIds(new Set()) // Clear selection after bulk move
        await Promise.all([loadIngredients(), loadCategories()])
        return true
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to move ingredients')
        return false
      }
    } catch (error) {
      console.error('Failed to bulk move:', error)
      toast.error('Failed to move ingredients')
      return false
    }
  }, [categories, loadIngredients, loadCategories])

  const bulkMoveUnderParent = useCallback(async (ingredientIds: string[], parentIngredientId: string | null) => {
    if (ingredientIds.length === 0) return false

    try {
      const response = await fetch('/api/ingredients/bulk-parent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredientIds,
          parentIngredientId,
          categoryId: parentIngredientId ? undefined : null,
          isBaseIngredient: !parentIngredientId,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const targetName = parentIngredientId
          ? ingredients.find(i => i.id === parentIngredientId)?.name || 'new parent'
          : 'Uncategorized'
        toast.success(`Moved ${data.movedCount} prep items under ${targetName}`)
        setSelectedIds(new Set()) // Clear selection after bulk move
        await loadIngredients()
        return true
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to move prep items')
        return false
      }
    } catch (error) {
      console.error('Failed to bulk move prep items:', error)
      toast.error('Failed to move prep items')
      return false
    }
  }, [ingredients, loadIngredients])

  const addPreparation = useCallback(async (parentId: string, data: {
    name: string
    preparationType: string
    yieldPercent: number | null
    inventoryItemId: string | null
    prepItemId: string | null
    standardQuantity: number | null
    standardUnit: string | null
  }) => {
    try {
      const response = await fetch('/api/ingredients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          name: data.name,
          parentIngredientId: parentId,
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
        setSelectedIds(new Set()) // Clear selection after create
        return true
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to create preparation')
        return false
      }
    } catch (error) {
      console.error('Failed to create preparation:', error)
      toast.error('Failed to create preparation')
      return false
    }
  }, [locationId, loadIngredients, loadCategories])

  return {
    // Data
    categories,
    ingredients,
    swapGroups,
    inventoryItems,
    prepItems,
    deletedIngredients,
    isLoading,

    // Selection
    selectedIds,
    setSelectedIds,

    // Restore state
    restoringItem,
    setRestoringItem,
    restoreStep,
    setRestoreStep,
    restoreAsType,
    setRestoreAsType,
    restoreCategoryId,
    setRestoreCategoryId,

    // Load functions
    setIsLoading,
    loadStaticData,
    loadIngredients,
    loadCategories,

    // Mutations
    saveCategory,
    deleteCategory,
    saveIngredient,
    deleteIngredient,
    restoreIngredient,
    permanentDelete,
    toggleActive,
    bulkMove,
    bulkMoveUnderParent,
    addPreparation,
  }
}
