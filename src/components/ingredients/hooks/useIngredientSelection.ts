'use client'

import { useState, useCallback, useMemo } from 'react'
import { toast } from '@/stores/toast-store'
import type { Ingredient, IngredientCategory } from '../types'

interface GroupedIngredients {
  category: IngredientCategory
  ingredients: Ingredient[]
}

export function useIngredientSelection(
  ingredients: Ingredient[],
  categories: IngredientCategory[],
  filteredGroups: GroupedIngredients[],
  loadIngredients: () => Promise<void>,
  loadCategories: () => Promise<void>,
) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

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
        const raw = await response.json()
        const data = raw.data ?? raw
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

  const handleBulkMoveUnderParent = useCallback(async (parentId: string | null) => {
    const allItems: Ingredient[] = []
    const collectItems = (items: Ingredient[]) => {
      for (const item of items) {
        if (selectedIds.has(item.id)) allItems.push(item)
        if (item.childIngredients) collectItems(item.childIngredients)
      }
    }
    collectItems(ingredients)

    const prepIds = allItems.filter(i => i.parentIngredientId).map(i => i.id)

    if (parentId === null) {
      // Move to uncategorized (remove parent)
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
    } else {
      // Move to different inventory item
      for (const id of prepIds) {
        await fetch(`/api/ingredients/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parentIngredientId: parentId,
          }),
        })
      }
      const baseIngredients = ingredients.filter(i => !i.parentIngredientId && i.isBaseIngredient !== false)
      const targetName = baseIngredients.find(b => b.id === parentId)?.name || 'new parent'
      toast.success(`Moved ${prepIds.length} prep items under ${targetName}`)
    }

    setSelectedIds(new Set())
    await loadIngredients()
  }, [selectedIds, ingredients, loadIngredients])

  // Calculate total visible ingredients for "Select All"
  const visibleIngredientIds = useMemo(() => {
    return filteredGroups.flatMap(group => group.ingredients.map(i => i.id))
  }, [filteredGroups])

  const allVisibleSelected = visibleIngredientIds.length > 0 &&
    visibleIngredientIds.every(id => selectedIds.has(id))
  const someVisibleSelected = selectedIds.size > 0 &&
    visibleIngredientIds.some(id => selectedIds.has(id)) && !allVisibleSelected

  const handleSelectAll = useCallback(() => {
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
  }, [allVisibleSelected, visibleIngredientIds])

  return {
    selectedIds,
    handleToggleSelect,
    handleSelectAllInCategory,
    handleClearSelection,
    handleBulkMove,
    handleBulkMoveUnderParent,
    handleSelectAll,
    allVisibleSelected,
    someVisibleSelected,
  }
}
