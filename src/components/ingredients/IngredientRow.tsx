'use client'

import { Button } from '@/components/ui/button'
import type { Ingredient } from './IngredientLibrary'

interface IngredientRowProps {
  ingredient: Ingredient
  isSelected?: boolean
  onToggleSelect?: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleActive: () => void
}

export function IngredientRow({
  ingredient,
  isSelected = false,
  onToggleSelect,
  onEdit,
  onDelete,
  onToggleActive,
}: IngredientRowProps) {
  return (
    <div
      className={`px-4 py-3 hover:bg-gray-50 transition-colors ${
        !ingredient.isActive ? 'opacity-60 bg-gray-50' : ''
      } ${isSelected ? 'bg-blue-50' : ''}`}
    >
      <div className="flex items-center justify-between">
        {/* Left: Checkbox and Name */}
        <div className="flex items-center gap-3 flex-1">
          {/* Checkbox */}
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              onClick={(e) => e.stopPropagation()}
            />
          )}

          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-gray-900">{ingredient.name}</span>

              {/* Status badges */}
              {!ingredient.isActive && (
                <Badge color="red" label="Inactive" />
              )}
              {ingredient.visibility === 'admin_only' && (
                <Badge color="orange" label="Admin Only" />
              )}
              {ingredient.visibility === 'hidden' && (
                <Badge color="gray" label="Hidden" />
              )}
            </div>

            {/* Inventory link */}
            {(ingredient.inventoryItem || ingredient.prepItem) && (
              <div className="mt-1 text-sm text-gray-500 flex items-center gap-1">
                <span>→</span>
                <span>
                  {ingredient.inventoryItem?.name || ingredient.prepItem?.name}
                </span>
                {ingredient.standardQuantity && ingredient.standardUnit && (
                  <span className="text-gray-400">
                    ({ingredient.standardQuantity} {ingredient.standardUnit})
                  </span>
                )}
              </div>
            )}

            {/* Description if present */}
            {ingredient.description && (
              <div className="mt-1 text-sm text-gray-500">
                {ingredient.description}
              </div>
            )}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 ml-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleActive}
          >
            {ingredient.isActive ? 'Deactivate' : 'Activate'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onEdit}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
            onClick={onDelete}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}

// Simple badge component
function Badge({ color, label }: { color: string; label: string }) {
  const colors: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    green: 'bg-green-100 text-green-700',
    blue: 'bg-blue-100 text-blue-700',
    purple: 'bg-purple-100 text-purple-700',
    red: 'bg-red-100 text-red-700',
    orange: 'bg-orange-100 text-orange-700',
  }

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[color] || colors.gray}`}>
      {label}
    </span>
  )
}
