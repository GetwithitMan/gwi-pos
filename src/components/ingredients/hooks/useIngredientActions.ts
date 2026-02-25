'use client'

import { useState, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import type { Ingredient, IngredientCategory, RestoreDestination, DeleteCategoryInfo } from '../types'

interface UseIngredientActionsParams {
  locationId: string
  loadCategories: () => Promise<void>
  loadIngredients: () => Promise<void>
  loadDeletedIngredients: () => Promise<void>
}

export function useIngredientActions({
  locationId,
  loadCategories,
  loadIngredients,
  loadDeletedIngredients,
}: UseIngredientActionsParams) {
  // Modal states
  const [showIngredientModal, setShowIngredientModal] = useState(false)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [showPreparationModal, setShowPreparationModal] = useState(false)
  const [editingIngredient, setEditingIngredient] = useState<Ingredient | null>(null)
  const [editingCategory, setEditingCategory] = useState<IngredientCategory | null>(null)
  const [preparationParent, setPreparationParent] = useState<Ingredient | null>(null)

  // Delete category state
  const [deletingCategory, setDeletingCategory] = useState<IngredientCategory | null>(null)
  const [deleteCategoryInfo, setDeleteCategoryInfo] = useState<DeleteCategoryInfo | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Restore state
  const [restoringItem, setRestoringItem] = useState<Ingredient | null>(null)
  const [restoreInProgress, setRestoreInProgress] = useState(false)
  const [restoreStep, setRestoreStep] = useState<'type' | 'category' | 'parent'>('type')
  const [restoreAsType, setRestoreAsType] = useState<'inventory' | 'prep' | null>(null)
  const [restoreCategoryId, setRestoreCategoryId] = useState<string | null>(null)

  // Category handlers
  const handleCreateCategory = useCallback(() => {
    setEditingCategory(null)
    setShowCategoryModal(true)
  }, [])

  const handleEditCategory = useCallback((category: IngredientCategory) => {
    setEditingCategory(category)
    setShowCategoryModal(true)
  }, [])

  const handleSaveCategory = useCallback(async (data: Partial<IngredientCategory>) => {
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
  }, [editingCategory, locationId, loadCategories])

  const handleDeleteCategory = useCallback(async (category: IngredientCategory) => {
    // First, probe the API to check if items exist
    try {
      const response = await fetch(`/api/ingredient-categories/${category.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (response.ok) {
        // No items -- deleted directly
        toast.success(`Category "${category.name}" deleted`)
        await Promise.all([loadCategories(), loadIngredients(), loadDeletedIngredients()])
        return
      }

      const raw = await response.json()
      const data = raw.data ?? raw
      if (data.requiresConfirmation) {
        // Has items -- show confirmation modal
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
  }, [loadCategories, loadIngredients, loadDeletedIngredients])

  const handleConfirmDeleteCategory = useCallback(async () => {
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
  }, [deletingCategory, deleteConfirmText, loadCategories, loadIngredients, loadDeletedIngredients])

  const handleDismissDeleteCategory = useCallback(() => {
    setDeletingCategory(null)
    setDeleteCategoryInfo(null)
    setDeleteConfirmText('')
  }, [])

  // Ingredient handlers
  const handleCreateIngredient = useCallback(() => {
    setEditingIngredient(null)
    setShowIngredientModal(true)
  }, [])

  const handleEditIngredient = useCallback((ingredient: Ingredient) => {
    setEditingIngredient(ingredient)
    setShowIngredientModal(true)
  }, [])

  const handleSaveIngredient = useCallback(async (data: Partial<Ingredient>) => {
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
  }, [editingIngredient, locationId, loadIngredients, loadCategories])

  const handleDeleteIngredient = useCallback(async (ingredient: Ingredient) => {
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
  }, [loadIngredients, loadCategories, loadDeletedIngredients])

  const handleToggleActive = useCallback(async (ingredient: Ingredient) => {
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
  }, [loadIngredients])

  const handleVerifyIngredient = useCallback(async (ingredient: Ingredient) => {
    try {
      const response = await fetch(`/api/ingredients/${ingredient.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          needsVerification: false,
          verifiedAt: new Date().toISOString(),
          // DEFERRED: Add verifiedBy with employee ID -- requires auth context in this component -- tracked in PM-TASK-BOARD.md
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
  }, [loadIngredients])

  const handleVerifyCategory = useCallback(async (category: { id: string; name: string }) => {
    try {
      const response = await fetch(`/api/ingredient-categories/${category.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ needsVerification: false }),
      })

      if (!response.ok) {
        const error = await response.json()
        toast.error(error.error || 'Failed to verify category')
        return
      }

      toast.success(`Category "${category.name}" verified`)
      await loadCategories()
    } catch (error) {
      console.error('Error verifying category:', error)
      toast.error('Failed to verify category')
    }
  }, [loadCategories])

  // Preparation handlers
  const handleAddPreparation = useCallback((parent: Ingredient) => {
    setPreparationParent(parent)
    setShowPreparationModal(true)
  }, [])

  const handleSavePreparation = useCallback(async (data: {
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
  }, [preparationParent, locationId, loadIngredients, loadCategories])

  // Restore handlers
  const handleRestoreIngredient = useCallback(async (ingredient: Ingredient, destination: RestoreDestination) => {
    if (restoreInProgress) return // Prevent double-clicks
    setRestoreInProgress(true)
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
    } finally {
      setRestoreInProgress(false)
    }
  }, [restoreInProgress, loadIngredients, loadCategories, loadDeletedIngredients])

  const handlePermanentDelete = useCallback(async (ingredient: Ingredient) => {
    // Permanent delete - requires double confirmation
    if (!confirm(`\u26A0\uFE0F PERMANENT DELETE\n\nAre you sure you want to permanently delete "${ingredient.name}"?\n\nThis cannot be undone!`)) return
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
  }, [loadDeletedIngredients])

  const handleCloseIngredientModal = useCallback(() => {
    setShowIngredientModal(false)
    setEditingIngredient(null)
  }, [])

  const handleCloseCategoryModal = useCallback(() => {
    setShowCategoryModal(false)
    setEditingCategory(null)
  }, [])

  const handleClosePreparationModal = useCallback(() => {
    setShowPreparationModal(false)
    setPreparationParent(null)
  }, [])

  return {
    // Modal states
    showIngredientModal,
    showCategoryModal,
    showPreparationModal,
    editingIngredient,
    editingCategory,
    preparationParent,

    // Delete category states
    deletingCategory,
    deleteCategoryInfo,
    deleteConfirmText,
    setDeleteConfirmText,
    deleteLoading,

    // Restore states
    restoringItem,
    setRestoringItem,
    restoreInProgress,
    restoreStep,
    setRestoreStep,
    restoreAsType,
    setRestoreAsType,
    restoreCategoryId,
    setRestoreCategoryId,

    // Category handlers
    handleCreateCategory,
    handleEditCategory,
    handleSaveCategory,
    handleDeleteCategory,
    handleConfirmDeleteCategory,
    handleDismissDeleteCategory,

    // Ingredient handlers
    handleCreateIngredient,
    handleEditIngredient,
    handleSaveIngredient,
    handleDeleteIngredient,
    handleToggleActive,
    handleVerifyIngredient,
    handleVerifyCategory,

    // Preparation handlers
    handleAddPreparation,
    handleSavePreparation,

    // Restore handlers
    handleRestoreIngredient,
    handlePermanentDelete,

    // Modal close handlers
    handleCloseIngredientModal,
    handleCloseCategoryModal,
    handleClosePreparationModal,
  }
}
