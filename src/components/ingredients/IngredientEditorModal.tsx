'use client'

import { useState, useEffect } from 'react'
import { PrepItemEditor } from './PrepItemEditor'
import { InventoryItemEditor } from './InventoryItemEditor'
import { Modal } from '@/components/ui/modal'
import type { Ingredient, IngredientCategory, SwapGroup, InventoryItemRef, PrepItemRef } from './IngredientLibrary'

interface IngredientEditorModalProps {
  ingredient: Ingredient | null
  categories: IngredientCategory[]
  swapGroups: SwapGroup[]
  inventoryItems: InventoryItemRef[]
  prepItems: PrepItemRef[]
  locationId: string
  onSave: (data: Partial<Ingredient>) => void
  onClose: () => void
}

// Base ingredients that can be parents for prep items
interface BaseIngredient {
  id: string
  name: string
  standardQuantity?: number | null
  standardUnit?: string | null
  categoryId?: string | null
  categoryRelation?: { name: string; icon?: string | null } | null
}

export function IngredientEditorModal({
  ingredient,
  categories,
  swapGroups: _swapGroups, // Kept for backwards compatibility
  inventoryItems,
  prepItems,
  locationId,
  onSave,
  onClose,
}: IngredientEditorModalProps) {
  const isEditing = !!ingredient
  const isChildIngredient = ingredient?.parentIngredientId != null
  const isUncategorized = isEditing && !ingredient?.categoryId && !isChildIngredient

  // Determine initial type
  // - Editing existing prep item (has parent): 'prep'
  // - Editing existing inventory item (has category, no parent): 'inventory'
  // - Editing uncategorized item (no category, no parent): null (show type selection)
  // - New item: null (show type selection)
  const getInitialType = (): 'inventory' | 'prep' | null => {
    if (isEditing) {
      if (isChildIngredient) return 'prep'
      if (isUncategorized) return null // Force type selection for uncategorized items
      return 'inventory'
    }
    return null // New item, show type selection
  }

  const [itemType, setItemType] = useState<'inventory' | 'prep' | null>(getInitialType())
  const [selectedParentId, setSelectedParentId] = useState<string>('')
  const [baseIngredients, setBaseIngredients] = useState<BaseIngredient[]>([])
  const [loadingBases, setLoadingBases] = useState(false)
  const [showCreateNewParent, setShowCreateNewParent] = useState(false)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [wantsToChangeParent, setWantsToChangeParent] = useState(false) // For existing prep items changing parent

  // Load base ingredients when prep type is selected
  useEffect(() => {
    if (itemType === 'prep' && baseIngredients.length === 0 && !loadingBases) {
      setLoadingBases(true)
      // Fetch base ingredients (inventory items that can be parents)
      fetch(`/api/ingredients?locationId=${locationId}&baseOnly=true&includeInactive=false`)
        .then(res => res.json())
        .then(raw => {
          const data = raw.data ?? raw
          setBaseIngredients(data.data || [])
        })
        .catch(err => console.error('Failed to load base ingredients:', err))
        .finally(() => setLoadingBases(false))
    }
  }, [itemType, baseIngredients.length, loadingBases])

  // Handle type change (when user wants to switch types while editing)
  // Both go back to type selection screen so user can confirm their choice
  const handleChangeToInventory = () => {
    setItemType(null) // Show type selection first
    setSelectedParentId('')
  }

  const handleChangeToPrep = () => {
    setItemType(null) // Show type selection first
    setSelectedParentId('')
  }

  // Handle parent selection for prep items
  const handleSelectParent = (parentId: string) => {
    setSelectedParentId(parentId)
    setWantsToChangeParent(false) // Reset when parent is selected
  }

  // Show "Create New Parent" flow
  const handleCreateNewParent = () => {
    setShowCreateNewParent(true)
  }

  // Group base ingredients by category for easier selection
  const groupedBaseIngredients = baseIngredients.reduce((acc, ing) => {
    const catName = ing.categoryRelation?.name || 'Uncategorized'
    if (!acc[catName]) acc[catName] = []
    acc[catName].push(ing)
    return acc
  }, {} as Record<string, BaseIngredient[]>)

  // Check if we need parent selection for prep items
  // Show parent selection when:
  // 1. New prep item without parent selected, OR
  // 2. Existing item converting to prep (not already a child), OR
  // 3. Existing prep item that wants to change parent
  const needsParentSelection = itemType === 'prep' && (
    (!isChildIngredient && !selectedParentId) || // New or converting to prep
    wantsToChangeParent // Existing prep item changing parent
  )

  return (
    <Modal isOpen={true} onClose={onClose} size="2xl" variant="default">

        {/* Type Selection (for new items OR uncategorized items being edited) */}
        {itemType === null && (
          <div className="p-6">
            <div className="text-center mb-6">
              {isUncategorized ? (
                <>
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-gray-200 text-gray-700 rounded-full text-sm mb-3">
                    <span>❓</span> Unclassified Item
                  </div>
                  <h2 className="text-xl font-bold text-gray-900 mb-2">
                    What kind of item is "{ingredient?.name}"?
                  </h2>
                  <p className="text-gray-600">Help us classify this item correctly</p>
                </>
              ) : isEditing ? (
                <>
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm mb-3">
                    <span>🔄</span> Change Item Type
                  </div>
                  <h2 className="text-xl font-bold text-gray-900 mb-2">
                    Convert "{ingredient?.name}" to:
                  </h2>
                  <p className="text-gray-600">Choose the new item type</p>
                </>
              ) : (
                <>
                  <h2 className="text-xl font-bold text-gray-900 mb-2">
                    What kind of item is this?
                  </h2>
                  <p className="text-gray-600">This helps us show you the right options</p>
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              {/* Inventory Item */}
              <button
                type="button"
                onClick={() => setItemType('inventory')}
                className="p-6 border-2 border-blue-300 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-colors text-left group"
              >
                <div className="text-4xl mb-3">📦</div>
                <h4 className="text-lg font-bold text-blue-900 group-hover:text-blue-700">
                  Inventory Item
                </h4>
                <p className="text-sm text-gray-600 mt-1">
                  Purchased from vendors
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  Flour, cheese, raw chicken, tomatoes...
                </p>
              </button>

              {/* Prep Item */}
              <button
                type="button"
                onClick={() => setItemType('prep')}
                className="p-6 border-2 border-green-300 rounded-xl hover:border-green-500 hover:bg-green-50 transition-colors text-left group"
              >
                <div className="text-4xl mb-3">👨‍🍳</div>
                <h4 className="text-lg font-bold text-green-900 group-hover:text-green-700">
                  Prep Item
                </h4>
                <p className="text-sm text-gray-600 mt-1">
                  Made from other ingredients
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  Sliced cheese, dough balls, shredded chicken...
                </p>
              </button>
            </div>

            {/* Move to Uncategorized option (only for existing items that are categorized) */}
            {isEditing && !isUncategorized && (
              <div className="mb-4 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => {
                    // Save with cleared category and parent to make it uncategorized
                    onSave({
                      categoryId: null,
                      parentIngredientId: null,
                      isBaseIngredient: true, // Treat as base so it shows in uncategorized
                    })
                  }}
                  className="w-full p-4 border-2 border-dashed border-gray-300 rounded-xl hover:border-gray-400 hover:bg-gray-50 transition-colors text-left group"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">❓</span>
                    <div>
                      <h4 className="font-bold text-gray-700 group-hover:text-gray-900">
                        Move to Uncategorized
                      </h4>
                      <p className="text-sm text-gray-500">
                        Remove classification - item will appear in Uncategorized section
                      </p>
                    </div>
                  </div>
                </button>
              </div>
            )}

            <div className="flex justify-center">
              <button
                type="button"
                onClick={onClose}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Parent Selection (for prep items that need a parent) */}
        {needsParentSelection && !showCreateNewParent && (
          <div className="p-6">
            {/* Back button */}
            <button
              type="button"
              onClick={() => {
                if (wantsToChangeParent) {
                  // Go back to prep editor with original parent
                  setWantsToChangeParent(false)
                  setSelectedParentId(ingredient?.parentIngredientId || '')
                } else {
                  // Go back to type selection
                  setItemType(null)
                }
              }}
              className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-4"
            >
              ← {wantsToChangeParent ? 'Cancel parent change' : 'Back to type selection'}
            </button>

            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm mb-3">
                <span>👨‍🍳</span> {wantsToChangeParent ? 'Change Parent' : 'Prep Item'}
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                {wantsToChangeParent
                  ? `Move "${ingredient?.name}" under which inventory item?`
                  : 'What inventory item is this made from?'
                }
              </h2>
              <p className="text-gray-600">
                {wantsToChangeParent
                  ? 'Select the new parent inventory item'
                  : isEditing
                    ? `Select the parent for "${ingredient?.name}"`
                    : 'Select or create the parent inventory item'
                }
              </p>
            </div>

            {loadingBases ? (
              <div className="text-center py-8 text-gray-500">Loading inventory items...</div>
            ) : baseIngredients.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 mb-4">No inventory items found</p>
                <button
                  type="button"
                  onClick={handleCreateNewParent}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  + Create Inventory Item First
                </button>
              </div>
            ) : (
              <>
                {/* Collapsible category list */}
                <div className="max-h-[40vh] overflow-y-auto border rounded-lg">
                  {Object.entries(groupedBaseIngredients)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([categoryName, ingredients]) => {
                      const isExpanded = expandedCategories.has(categoryName)
                      return (
                        <div key={categoryName} className="border-b last:border-b-0">
                          {/* Category header - clickable to expand/collapse */}
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedCategories(prev => {
                                const next = new Set(prev)
                                if (next.has(categoryName)) {
                                  next.delete(categoryName)
                                } else {
                                  next.add(categoryName)
                                }
                                return next
                              })
                            }}
                            className="w-full sticky top-0 bg-gray-100 px-3 py-2 text-left hover:bg-gray-200 flex items-center justify-between transition-colors"
                          >
                            <span className="text-sm font-semibold text-gray-700">
                              {categoryName}
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">
                                {ingredients.length} items
                              </span>
                              <span className="text-gray-400">
                                {isExpanded ? '▼' : '▶'}
                              </span>
                            </span>
                          </button>
                          {/* Ingredients list - only show when expanded */}
                          {isExpanded && (
                            <div className="bg-white">
                              {ingredients
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map(ing => (
                                  <button
                                    key={ing.id}
                                    type="button"
                                    onClick={() => handleSelectParent(ing.id)}
                                    className="w-full px-4 py-2 text-left hover:bg-blue-50 border-t flex items-center justify-between"
                                  >
                                    <span className="font-medium text-gray-900">{ing.name}</span>
                                    {ing.standardQuantity && ing.standardUnit && (
                                      <span className="text-xs text-gray-400">
                                        {ing.standardQuantity} {ing.standardUnit}
                                      </span>
                                    )}
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                </div>

                <div className="mt-4 pt-4 border-t">
                  <button
                    type="button"
                    onClick={handleCreateNewParent}
                    className="w-full px-4 py-3 border-2 border-dashed border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 hover:border-blue-400 transition-colors"
                  >
                    + Create New Inventory Item
                  </button>
                </div>
              </>
            )}

            <div className="flex justify-center mt-4">
              <button
                type="button"
                onClick={onClose}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Create New Parent Flow */}
        {showCreateNewParent && (
          <div className="relative">
            {/* Back button */}
            <div className="absolute top-4 left-4 z-20">
              <button
                type="button"
                onClick={() => setShowCreateNewParent(false)}
                className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                ← Back to parent selection
              </button>
            </div>

            <InventoryItemEditor
              ingredient={null}
              categories={categories}
              inventoryItems={inventoryItems}
              prepItems={prepItems}
              onSave={async (data) => {
                // Save the new inventory item, then use it as parent
                try {
                  const res = await fetch('/api/ingredients', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...data, locationId, isBaseIngredient: true }),
                  })
                  const rawResult = await res.json()
                  const result = rawResult.data ?? rawResult
                  if (result.data?.id) {
                    // Add to base ingredients and select it
                    setBaseIngredients(prev => [...prev, result.data])
                    setSelectedParentId(result.data.id)
                    setShowCreateNewParent(false)
                  }
                } catch (err) {
                  console.error('Failed to create inventory item:', err)
                }
              }}
              onClose={() => setShowCreateNewParent(false)}
              onChangeType={() => {}}
            />
          </div>
        )}

        {/* Back button for type-selected state (when not in parent selection) */}
        {itemType !== null && !needsParentSelection && !showCreateNewParent && (
          <div className="absolute top-4 left-4 z-20">
            <button
              type="button"
              onClick={() => {
                setItemType(null)
                setSelectedParentId('')
              }}
              className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              ← Change type
            </button>
          </div>
        )}

        {/* Prep Item Editor (after parent is selected) */}
        {itemType === 'prep' && (isChildIngredient || selectedParentId) && !showCreateNewParent && (
          <PrepItemEditor
            ingredient={ingredient}
            categories={categories}
            inventoryItems={inventoryItems}
            locationId={locationId}
            selectedParentId={selectedParentId || ingredient?.parentIngredientId || ''}
            onSave={onSave}
            onClose={onClose}
            onChangeType={handleChangeToInventory}
            onChangeParent={() => {
              setSelectedParentId('')
              setWantsToChangeParent(true)
            }}
          />
        )}

        {/* Inventory Item Editor */}
        {itemType === 'inventory' && !showCreateNewParent && (
          <InventoryItemEditor
            ingredient={ingredient}
            categories={categories}
            inventoryItems={inventoryItems}
            prepItems={prepItems}
            onSave={onSave}
            onClose={onClose}
            onChangeType={handleChangeToPrep}
          />
        )}
    </Modal>
  )
}
