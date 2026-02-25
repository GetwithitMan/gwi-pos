'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CategorySection } from './CategorySection'
import { IngredientEditorModal } from './IngredientEditorModal'
import { CategoryEditorModal } from './CategoryEditorModal'
import { AddPreparationModal } from './AddPreparationModal'
import { GroupedIngredientHierarchy } from './IngredientHierarchy'
import { IngredientHeader } from './IngredientHeader'
import { IngredientFilters } from './IngredientFilters'
import { DeleteCategoryModal } from './DeleteCategoryModal'
import { DeletedItemsPanel } from './DeletedItemsPanel'
import { BulkActionBar } from './BulkActionBar'
import { useIngredientData } from './hooks/useIngredientData'
import { useIngredientActions } from './hooks/useIngredientActions'
import { useIngredientSelection } from './hooks/useIngredientSelection'
import { useFilteredIngredients } from './hooks/useFilteredIngredients'

// Re-export types for backward compatibility
export type {
  Ingredient,
  IngredientCategory,
  SwapGroup,
  InventoryItemRef,
  PrepItemRef,
} from './types'

interface IngredientLibraryProps {
  locationId: string
}

export function IngredientLibrary({ locationId }: IngredientLibraryProps) {
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [showInactive, setShowInactive] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'hierarchy'>('hierarchy')

  // Data fetching
  const {
    categories,
    ingredients,
    swapGroups,
    inventoryItems,
    prepItems,
    deletedIngredients,
    isLoading,
    loadCategories,
    loadIngredients,
    loadDeletedIngredients,
  } = useIngredientData({ locationId, showInactive, viewMode })

  // Filtering & grouping
  const { filteredGroups, filteredIngredients } = useFilteredIngredients(
    categories, ingredients, search, selectedCategory,
  )

  // Selection management
  const {
    selectedIds,
    handleToggleSelect,
    handleSelectAllInCategory,
    handleClearSelection,
    handleBulkMove,
    handleBulkMoveUnderParent,
    handleSelectAll,
    allVisibleSelected,
    someVisibleSelected,
  } = useIngredientSelection(ingredients, categories, filteredGroups, loadIngredients, loadCategories)

  // CRUD actions
  const actions = useIngredientActions({
    locationId,
    loadCategories,
    loadIngredients,
    loadDeletedIngredients,
  })

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
      <IngredientHeader
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onCreateCategory={actions.handleCreateCategory}
        onCreateIngredient={actions.handleCreateIngredient}
      />

      {/* Filters */}
      <IngredientFilters
        search={search}
        onSearchChange={setSearch}
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
        showInactive={showInactive}
        onShowInactiveChange={setShowInactive}
        categories={categories}
        allVisibleSelected={allVisibleSelected}
        someVisibleSelected={someVisibleSelected}
        onSelectAll={handleSelectAll}
      />

      {/* Category Sections */}
      {filteredGroups.length === 0 && ingredients.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>No ingredients found</p>
          <Button className="mt-4" onClick={actions.handleCreateIngredient}>
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
          onEdit={actions.handleEditIngredient}
          onDelete={actions.handleDeleteIngredient}
          onAddPreparation={actions.handleAddPreparation}
          onToggleActive={actions.handleToggleActive}
          onVerify={actions.handleVerifyIngredient}
          onVerifyCategory={actions.handleVerifyCategory}
          onEditCategory={(cat) => actions.handleEditCategory(cat as import('./types').IngredientCategory)}
          onDeleteCategory={(cat) => actions.handleDeleteCategory(cat as import('./types').IngredientCategory)}
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
              onEditCategory={group.category.id !== 'uncategorized' ? () => actions.handleEditCategory(group.category) : undefined}
              onDeleteCategory={group.category.id !== 'uncategorized' ? () => actions.handleDeleteCategory(group.category) : undefined}
              onEditIngredient={actions.handleEditIngredient}
              onDeleteIngredient={actions.handleDeleteIngredient}
              onToggleActive={actions.handleToggleActive}
              onVerify={actions.handleVerifyIngredient}
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

      {/* Deleted Section */}
      <DeletedItemsPanel
        deletedIngredients={deletedIngredients}
        ingredients={ingredients}
        categories={categories}
        restoringItem={actions.restoringItem}
        restoreStep={actions.restoreStep}
        restoreAsType={actions.restoreAsType}
        restoreCategoryId={actions.restoreCategoryId}
        onSetRestoringItem={actions.setRestoringItem}
        onSetRestoreStep={actions.setRestoreStep}
        onSetRestoreAsType={actions.setRestoreAsType}
        onSetRestoreCategoryId={actions.setRestoreCategoryId}
        onRestoreIngredient={(ingredient, destination) => {
          if (destination.type === 'previous') {
            // Handle "previous" restore - determine actual destination
            if (ingredient.parentIngredientId) {
              actions.handleRestoreIngredient(ingredient, {
                type: 'inventory-item',
                targetId: ingredient.parentIngredientId,
                targetName: `under ${ingredient.parentIngredient?.name || 'previous parent'}`,
              })
            } else if (ingredient.categoryId) {
              actions.handleRestoreIngredient(ingredient, {
                type: 'category',
                targetId: ingredient.categoryId,
                targetName: ingredient.categoryRelation?.name || 'previous category',
              })
            }
          } else {
            actions.handleRestoreIngredient(ingredient, destination as import('./types').RestoreDestination)
          }
        }}
        onPermanentDelete={actions.handlePermanentDelete}
      />

      {/* Modals */}
      {actions.showCategoryModal && (
        <CategoryEditorModal
          category={actions.editingCategory}
          onSave={actions.handleSaveCategory}
          onClose={actions.handleCloseCategoryModal}
        />
      )}

      {actions.showIngredientModal && (
        <IngredientEditorModal
          ingredient={actions.editingIngredient}
          categories={categories.filter(c => c.isActive)}
          swapGroups={swapGroups}
          inventoryItems={inventoryItems}
          prepItems={prepItems}
          locationId={locationId}
          onSave={actions.handleSaveIngredient}
          onClose={actions.handleCloseIngredientModal}
        />
      )}

      {actions.showPreparationModal && actions.preparationParent && (
        <AddPreparationModal
          parentIngredient={actions.preparationParent}
          inventoryItems={inventoryItems}
          prepItems={prepItems}
          onSave={actions.handleSavePreparation}
          onClose={actions.handleClosePreparationModal}
        />
      )}

      {/* Delete Category Confirmation Modal */}
      {actions.deletingCategory && actions.deleteCategoryInfo && (
        <DeleteCategoryModal
          category={actions.deletingCategory}
          info={actions.deleteCategoryInfo}
          confirmText={actions.deleteConfirmText}
          onConfirmTextChange={actions.setDeleteConfirmText}
          loading={actions.deleteLoading}
          onConfirm={actions.handleConfirmDeleteCategory}
          onClose={actions.handleDismissDeleteCategory}
        />
      )}
    </div>
  )
}
