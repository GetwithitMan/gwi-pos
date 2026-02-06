'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { IngredientRow } from './IngredientRow'
import type { Ingredient, IngredientCategory } from './IngredientLibrary'

interface CategorySectionProps {
  category: IngredientCategory
  ingredients: Ingredient[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onSelectAllInCategory: (categoryId: string, ingredientIds: string[]) => void
  onEditCategory?: () => void
  onDeleteCategory?: () => void
  onEditIngredient: (ingredient: Ingredient) => void
  onDeleteIngredient: (ingredient: Ingredient) => void
  onToggleActive: (ingredient: Ingredient) => void
  onVerify?: (ingredient: Ingredient) => void
}

export function CategorySection({
  category,
  ingredients,
  selectedIds,
  onToggleSelect,
  onSelectAllInCategory,
  onEditCategory,
  onDeleteCategory,
  onEditIngredient,
  onDeleteIngredient,
  onToggleActive,
  onVerify,
}: CategorySectionProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  // Calculate selection state for this category
  const ingredientIds = useMemo(() => ingredients.map(i => i.id), [ingredients])
  const selectedInCategory = useMemo(
    () => ingredientIds.filter(id => selectedIds.has(id)).length,
    [ingredientIds, selectedIds]
  )
  const allSelectedInCategory = ingredientIds.length > 0 && selectedInCategory === ingredientIds.length
  const someSelectedInCategory = selectedInCategory > 0 && selectedInCategory < ingredientIds.length

  const handleSelectAllInCategory = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation()
    onSelectAllInCategory(category.id, ingredientIds)
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
      {/* Category Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ borderLeft: `4px solid ${category.color || '#6b7280'}` }}
      >
        <div className="flex items-center gap-3">
          {/* Select All in Category Checkbox */}
          {ingredientIds.length > 0 && (
            <input
              type="checkbox"
              checked={allSelectedInCategory}
              ref={(el) => {
                if (el) el.indeterminate = someSelectedInCategory
              }}
              onChange={handleSelectAllInCategory}
              onClick={(e) => e.stopPropagation()}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              title={`Select all ${ingredientIds.length} ingredients in ${category.name}`}
            />
          )}

          <span className="text-2xl">{category.icon || '?'}</span>
          <div>
            <h3 className="font-semibold text-gray-900">
              {category.name}
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({ingredients.length})
              </span>
              {selectedInCategory > 0 && (
                <span className="ml-2 text-sm font-normal text-blue-600">
                  - {selectedInCategory} selected
                </span>
              )}
            </h3>
            {category.description && (
              <p className="text-sm text-gray-500">{category.description}</p>
            )}
          </div>
          {!category.isActive && (
            <span className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-xs">
              Inactive
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onEditCategory && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onEditCategory() }}
            >
              Edit
            </Button>
          )}
          <span className="text-gray-400 text-xl">
            {isExpanded ? '▼' : '▶'}
          </span>
        </div>
      </div>

      {/* Ingredients List */}
      {isExpanded && (
        <div className="border-t divide-y">
          {ingredients.length === 0 ? (
            <div className="px-4 py-6 text-center text-gray-500">
              No ingredients in this category
            </div>
          ) : (
            ingredients.map(ingredient => (
              <IngredientRow
                key={ingredient.id}
                ingredient={ingredient}
                isSelected={selectedIds.has(ingredient.id)}
                onToggleSelect={() => onToggleSelect(ingredient.id)}
                onEdit={() => onEditIngredient(ingredient)}
                onDelete={() => onDeleteIngredient(ingredient)}
                onToggleActive={() => onToggleActive(ingredient)}
                onVerify={onVerify}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
