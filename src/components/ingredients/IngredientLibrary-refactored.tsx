'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { CategorySection } from './CategorySection'
import { IngredientEditorModal } from './IngredientEditorModal'
import { CategoryEditorModal } from './CategoryEditorModal'
import { AddPreparationModal } from './AddPreparationModal'
import { GroupedIngredientHierarchy } from './IngredientHierarchy'
import { BulkActionBar } from './BulkActionBar'
import { DeletedItemsPanel } from './DeletedItemsPanel'
import { useIngredientLibrary } from '@/hooks/useIngredientLibrary'
import { useDebounce } from '@/hooks/useDebounce'

// Export types for use in other components
export type {
  Ingredient,
  IngredientCategory,
  SwapGroup,
  InventoryItemRef,
  PrepItemRef,
} from './IngredientLibrary'

interface IngredientLibraryProps {
  locationId: string
}

export function IngredientLibrary({ locationId }: IngredientLibraryProps) {
  // Local UI state
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [showInactive, setShowInactive] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'hierarchy'>('hierarchy')

  // Modal states
  const [showIngredientModal, setShowIngredientModal] = useState(false)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [showPreparationModal, setShowPreparationModal] = useState(false)
  const [editingIngredient, setEditingIngredient] = useState<any>(null)
  const [editingCategory, setEditingCategory] = useState<any>(null)
  const [preparationParent, setPreparationParent] = useState<any>(null)

  // Debounce search
  const debouncedSearch = useDebounce(search, 300)

  // Use the custom hook
  const {
    categories,
    ingredients,
    swapGroups,
    inventoryItems,
    prepItems,
    deletedIngredients,
    isLoading,
    selectedIds,
    setSelectedIds,
    restoringItem,
    setRestoringItem,
    restoreStep,
    setRestoreStep,
    restoreAsType,
    setRestoreAsType,
    restoreCategoryId,
    setRestoreCategoryId,
    setIsLoading,
    loadStaticData,
    loadIngredients,
    loadCategories,
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
  } = useIngredientLibrary({ locationId, showInactive, viewMode })

  // Load data on mount and when dependencies change
  useEffect(() => {
    const loadAll = async () => {
      setIsLoading(true)
      await loadStaticData()
      await loadIngredients()
      setIsLoading(false)
    }
    loadAll()
  }, [loadStaticData, loadIngredients, setIsLoading])

  // Reload ingredients when view mode or showInactive changes
  useEffect(() => {
    loadIngredients()
  }, [viewMode, showInactive, loadIngredients])

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
  }, [setSelectedIds])

  const handleSelectAllInCategory = useCallback((categoryId: string, ingredientIds: string[]) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      const allSelected = ingredientIds.every(id => next.has(id))

      if (allSelected) {
        ingredientIds.forEach(id => next.delete(id))
      } else {
        ingredientIds.forEach(id => next.add(id))
      }
      return next
    })
  }, [setSelectedIds])

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [setSelectedIds])

  // Bulk action wrappers that bind selectedIds
  const handleBulkMove = useCallback((targetCategoryId: string) => {
    bulkMove(Array.from(selectedIds), targetCategoryId)
  }, [bulkMove, selectedIds])

  const handleBulkMoveUnderParent = useCallback((parentId: string | null) => {
    bulkMoveUnderParent(Array.from(selectedIds), parentId)
  }, [bulkMoveUnderParent, selectedIds])

  // Category handlers
  const handleCreateCategory = () => {
    setEditingCategory(null)
    setShowCategoryModal(true)
  }

  const handleEditCategory = (category: any) => {
    setEditingCategory(category)
    setShowCategoryModal(true)
  }

  const handleSaveCategory = async (data: any) => {
    const success = await saveCategory(data, editingCategory)
    if (success) {
      setShowCategoryModal(false)
      setEditingCategory(null)
    }
  }

  const handleDeleteCategory = async (category: any) => {
    if (!confirm(`Are you sure you want to delete "${category.name}"?`)) return
    await deleteCategory(category)
  }

  // Ingredient handlers
  const handleCreateIngredient = () => {
    setEditingIngredient(null)
    setShowIngredientModal(true)
  }

  const handleEditIngredient = (ingredient: any) => {
    setEditingIngredient(ingredient)
    setShowIngredientModal(true)
  }

  const handleSaveIngredient = async (data: any) => {
    const success = await saveIngredient(data, editingIngredient)
    if (success) {
      setShowIngredientModal(false)
      setEditingIngredient(null)
    }
  }

  const handleAddPreparation = (parent: any) => {
    setPreparationParent(parent)
    setShowPreparationModal(true)
  }

  const handleSavePreparation = async (data: any) => {
    if (!preparationParent) return
    const success = await addPreparation(preparationParent.id, data)
    if (success) {
      setShowPreparationModal(false)
      setPreparationParent(null)
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
        } as any,
        ingredients: uncategorized,
      })
    }

    return groups
  }, [categories, ingredients])

  // Filter by search and selected category
  const filteredGroups = useMemo(() => {
    return groupedIngredients
      .filter(group => !selectedCategory || group.category.id === selectedCategory)
      .map(group => ({
        ...group,
        ingredients: group.ingredients.filter(ing =>
          !debouncedSearch || ing.name.toLowerCase().includes(debouncedSearch.toLowerCase())
        ),
      }))
      .filter(group => group.ingredients.length > 0 || !debouncedSearch)
  }, [groupedIngredients, selectedCategory, debouncedSearch])

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
      setSelectedIds(prev => {
        const next = new Set(prev)
        visibleIngredientIds.forEach(id => next.delete(id))
        return next
      })
    } else {
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
              aria-pressed={viewMode === 'list'}
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
              aria-pressed={viewMode === 'hierarchy'}
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
            aria-label="Select all visible ingredients"
            aria-checked={someVisibleSelected ? 'mixed' : allVisibleSelected}
          />
          <span className="text-sm text-gray-600">All</span>
        </div>

        <input
          type="text"
          placeholder="Search ingredients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Search ingredients"
        />
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="px-4 py-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Filter by category"
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
        <GroupedIngredientHierarchy
          categories={categories}
          ingredients={ingredients}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onSelectAllInCategory={handleSelectAllInCategory}
          onEdit={handleEditIngredient}
          onDelete={deleteIngredient}
          onAddPreparation={handleAddPreparation}
          onToggleActive={toggleActive}
          onEditCategory={handleEditCategory}
        />
      ) : (
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
              onDeleteIngredient={deleteIngredient}
              onToggleActive={toggleActive}
            />
          ))}
        </div>
      )}

      {/* Bulk Action Bar */}
      <BulkActionBar
        selectedIds={selectedIds}
        ingredients={ingredients}
        categories={categories}
        onBulkMove={handleBulkMove}
        onBulkMoveUnderParent={handleBulkMoveUnderParent}
        onClearSelection={handleClearSelection}
      />

      {/* Deleted Items Panel */}
      <DeletedItemsPanel
        deletedIngredients={deletedIngredients}
        ingredients={ingredients}
        categories={categories}
        restoringItem={restoringItem}
        restoreStep={restoreStep}
        restoreAsType={restoreAsType}
        restoreCategoryId={restoreCategoryId}
        onSetRestoringItem={setRestoringItem}
        onSetRestoreStep={setRestoreStep}
        onSetRestoreAsType={setRestoreAsType}
        onSetRestoreCategoryId={setRestoreCategoryId}
        onRestoreIngredient={restoreIngredient}
        onPermanentDelete={permanentDelete}
      />

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
    </div>
  )
}
