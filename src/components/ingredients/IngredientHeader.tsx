'use client'

import { Button } from '@/components/ui/button'

interface IngredientHeaderProps {
  viewMode: 'list' | 'hierarchy'
  onViewModeChange: (mode: 'list' | 'hierarchy') => void
  onCreateCategory: () => void
  onCreateIngredient: () => void
}

export function IngredientHeader({
  viewMode,
  onViewModeChange,
  onCreateCategory,
  onCreateIngredient,
}: IngredientHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Food Inventory</h1>
        <p className="text-gray-600">
          <span className="inline-flex items-center gap-2">
            <span className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs font-bold">INVENTORY ITEM</span>
            <span>= What you order</span>
            <span className="mx-2">&rarr;</span>
            <span className="px-2 py-0.5 bg-green-600 text-white rounded text-xs font-bold">PREP ITEM</span>
            <span>= What goes on menu items</span>
          </span>
        </p>
      </div>
      <div className="flex gap-2">
        {/* View Toggle */}
        <div className="flex rounded-lg border overflow-hidden">
          <button
            onClick={() => onViewModeChange('list')}
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              viewMode === 'list'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            List
          </button>
          <button
            onClick={() => onViewModeChange('hierarchy')}
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              viewMode === 'hierarchy'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            Hierarchy
          </button>
        </div>

        <Button variant="outline" onClick={onCreateCategory}>
          + Category
        </Button>
        <Button onClick={onCreateIngredient} className="bg-blue-600 hover:bg-blue-700">
          + Inventory Item
        </Button>
      </div>
    </div>
  )
}
