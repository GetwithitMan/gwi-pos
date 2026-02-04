'use client'

import { useState } from 'react'
import type { Ingredient, IngredientCategory } from './IngredientLibrary'

interface DeletedItemsPanelProps {
  deletedIngredients: Ingredient[]
  ingredients: Ingredient[]
  categories: IngredientCategory[]
  restoringItem: Ingredient | null
  restoreStep: 'type' | 'category' | 'parent'
  restoreAsType: 'inventory' | 'prep' | null
  restoreCategoryId: string | null
  onSetRestoringItem: (item: Ingredient | null) => void
  onSetRestoreStep: (step: 'type' | 'category' | 'parent') => void
  onSetRestoreAsType: (type: 'inventory' | 'prep' | null) => void
  onSetRestoreCategoryId: (id: string | null) => void
  onRestoreIngredient: (ingredient: Ingredient, destination: {
    type: 'uncategorized' | 'category' | 'inventory-item' | 'previous'
    targetId?: string
    targetName?: string
  }) => void
  onPermanentDelete: (ingredient: Ingredient) => void
}

export function DeletedItemsPanel({
  deletedIngredients,
  ingredients,
  categories,
  restoringItem,
  restoreStep,
  restoreAsType,
  restoreCategoryId,
  onSetRestoringItem,
  onSetRestoreStep,
  onSetRestoreAsType,
  onSetRestoreCategoryId,
  onRestoreIngredient,
  onPermanentDelete,
}: DeletedItemsPanelProps) {
  const [showDeleted, setShowDeleted] = useState(false)

  if (deletedIngredients.length === 0) return null

  const baseIngredients = ingredients.filter(i => !i.parentIngredientId && i.isBaseIngredient !== false)

  return (
    <div className="mt-8 border-t-2 border-red-200 pt-4">
      <button
        onClick={() => setShowDeleted(!showDeleted)}
        className="w-full flex items-center justify-between p-3 bg-red-50 hover:bg-red-100 rounded-lg border border-red-200 transition-colors"
        aria-expanded={showDeleted}
      >
        <div className="flex items-center gap-2">
          <span className="text-red-500" role="img" aria-label="Deleted">🗑️</span>
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

            // Check if previous location is still valid
            const hasPreviousLocation = Boolean(
              ingredient.parentIngredient || ingredient.categoryRelation
            )

            return (
              <div
                key={ingredient.id}
                className={`p-3 bg-white rounded border ${isRestoring ? 'border-green-400 ring-2 ring-green-200' : 'border-red-200'}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-red-400" role="img" aria-label="Deleted">🗑️</span>
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
                        {hasPreviousLocation && (
                          <button
                            onClick={() => {
                              onRestoreIngredient(ingredient, { type: 'previous' })
                            }}
                            className="px-3 py-1 text-sm bg-blue-100 text-blue-700 hover:bg-blue-200 rounded transition-colors"
                            title="Restore to previous location"
                          >
                            ⏮️ Previous
                          </button>
                        )}
                        <button
                          onClick={() => {
                            onSetRestoringItem(ingredient)
                            onSetRestoreStep('type')
                            onSetRestoreAsType(null)
                            onSetRestoreCategoryId(null)
                          }}
                          className="px-3 py-1 text-sm bg-green-100 text-green-700 hover:bg-green-200 rounded transition-colors"
                        >
                          ↩️ Restore
                        </button>
                        <button
                          onClick={() => {
                            if (!confirm(`⚠️ PERMANENT DELETE\n\nAre you sure you want to permanently delete "${ingredient.name}"?\n\nThis cannot be undone!`)) return
                            if (!confirm(`Final confirmation: Delete "${ingredient.name}" forever?`)) return
                            onPermanentDelete(ingredient)
                          }}
                          className="px-3 py-1 text-sm bg-red-100 text-red-700 hover:bg-red-200 rounded transition-colors"
                        >
                          🗑️ Forever
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => {
                          onSetRestoringItem(null)
                          onSetRestoreStep('type')
                          onSetRestoreAsType(null)
                          onSetRestoreCategoryId(null)
                        }}
                        className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                      >
                        ✕ Cancel
                      </button>
                    )}
                  </div>
                </div>

                {/* Restore destination wizard */}
                {isRestoring && (
                  <div className="mt-3 pt-3 border-t border-green-200">
                    {/* Step 1: Choose type */}
                    {restoreStep === 'type' && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-green-900">Restore as:</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              onSetRestoreAsType('inventory')
                              onSetRestoreStep('category')
                            }}
                            className="flex-1 px-4 py-3 bg-blue-50 hover:bg-blue-100 rounded-lg border-2 border-blue-300 transition-colors"
                          >
                            <div className="text-blue-700 font-medium">📦 Inventory Item</div>
                            <div className="text-xs text-blue-600">Standalone ingredient</div>
                          </button>
                          <button
                            onClick={() => {
                              onSetRestoreAsType('prep')
                              onSetRestoreStep('parent')
                            }}
                            className="flex-1 px-4 py-3 bg-green-50 hover:bg-green-100 rounded-lg border-2 border-green-300 transition-colors"
                          >
                            <div className="text-green-700 font-medium">🥘 Prep Item</div>
                            <div className="text-xs text-green-600">Under inventory item</div>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Step 2a: Choose category (for inventory) */}
                    {restoreStep === 'category' && restoreAsType === 'inventory' && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-blue-900">Choose category:</p>
                        <div className="space-y-1">
                          <button
                            onClick={() => {
                              onRestoreIngredient(ingredient, { type: 'uncategorized' })
                            }}
                            className="w-full px-3 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded border transition-colors"
                          >
                            ❓ Uncategorized
                          </button>
                          {categories.filter(c => c.isActive).map(cat => (
                            <button
                              key={cat.id}
                              onClick={() => {
                                onRestoreIngredient(ingredient, {
                                  type: 'category',
                                  targetId: cat.id,
                                  targetName: cat.name,
                                })
                              }}
                              className="w-full px-3 py-2 text-left bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition-colors"
                            >
                              {cat.icon} {cat.name}
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={() => onSetRestoreStep('type')}
                          className="text-xs text-gray-500 hover:text-gray-700 underline"
                        >
                          ← Back
                        </button>
                      </div>
                    )}

                    {/* Step 2b: Choose parent (for prep) */}
                    {restoreStep === 'parent' && restoreAsType === 'prep' && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-green-900">Choose inventory item:</p>
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {baseIngredients.map(inv => (
                            <button
                              key={inv.id}
                              onClick={() => {
                                onRestoreIngredient(ingredient, {
                                  type: 'inventory-item',
                                  targetId: inv.id,
                                  targetName: inv.name,
                                })
                              }}
                              className="w-full px-3 py-2 text-left bg-green-50 hover:bg-green-100 rounded border border-green-200 transition-colors"
                            >
                              {inv.name}
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={() => onSetRestoreStep('type')}
                          className="text-xs text-gray-500 hover:text-gray-700 underline"
                        >
                          ← Back
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
