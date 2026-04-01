'use client'

import { formatCurrency } from '@/lib/utils'

export interface DrinkListPanelProps {
  filteredDrinks: any[]
  selectedDrink: any | null
  selectedMenuCategoryId: string
  menuCategories: { id: string; name: string; itemCount: number; color: string }[]
  onSelectDrink: (drink: any) => void
  onToggleAvailability: (drink: any) => Promise<void>
  onRemoveDrink: (drink: any) => Promise<void>
  onNewItem: () => void
  onClearCategoryFilter: () => void
}

export function DrinkListPanel({
  filteredDrinks,
  selectedDrink,
  selectedMenuCategoryId,
  menuCategories,
  onSelectDrink,
  onToggleAvailability,
  onRemoveDrink,
  onNewItem,
  onClearCategoryFilter,
}: DrinkListPanelProps) {
  return (
    <div className="w-72 bg-white border-r flex flex-col shrink-0">
      {/* Header row: category name */}
      <div className="px-3 pt-2 pb-1 flex items-center justify-between border-b shrink-0">
        <span className="text-xs font-medium text-purple-700">
          {selectedMenuCategoryId
            ? `${menuCategories.find((c: any) => c.id === selectedMenuCategoryId)?.name} (${filteredDrinks.length})`
            : `All Drinks (${filteredDrinks.length})`
          }
        </span>
        {selectedMenuCategoryId && (
          <button
            onClick={onClearCategoryFilter}
            className="text-xs text-gray-600 hover:text-gray-800"
          >
            All
          </button>
        )}
      </div>
      {/* Primary "+ New Item" button - always visible */}
      <div className="px-3 py-2 border-b">
        <button
          onClick={onNewItem}
          className="w-full px-3 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <span className="text-lg leading-none">+</span> New Item
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {filteredDrinks.length === 0 ? (
          <p className="text-sm text-gray-600 text-center py-4">No items in this category</p>
        ) : (
          filteredDrinks.map((drink: any) => (
            <div
              key={drink.id}
              onClick={() => onSelectDrink(drink)}
              className={`p-3 rounded cursor-pointer transition-colors ${
                selectedDrink?.id === drink.id
                  ? 'bg-purple-50 border-2 border-purple-500'
                  : !drink.isAvailable
                  ? 'bg-gray-50 border-2 border-transparent opacity-50'
                  : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
              }`}
            >
              <div className="flex items-start justify-between gap-1">
                <div className="font-medium text-sm leading-tight">{drink.name}</div>
                <div className="flex items-center gap-1 shrink-0">
                  {!drink.isAvailable && (
                    <span className="text-[9px] bg-red-100 text-red-700 px-1 rounded font-medium">86</span>
                  )}
                  {/* 86 toggle */}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation()
                      await onToggleAvailability(drink)
                    }}
                    title={drink.isAvailable ? '86 this item' : 'Un-86 this item'}
                    className="text-gray-900 hover:text-orange-500 text-xs px-1 rounded"
                  >
                    {drink.isAvailable ? '⊘' : '✓'}
                  </button>
                  {/* Hide/delete */}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation()
                      await onRemoveDrink(drink)
                    }}
                    title="Remove from POS"
                    className="text-gray-900 hover:text-red-500 text-xs px-1 rounded"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="text-xs text-gray-600 mt-0.5">{formatCurrency(drink.price)}</div>
              {drink.hasRecipe && (
                <div className="text-xs text-green-600 mt-1">✓ {drink.recipeIngredientCount} bottles</div>
              )}
              {drink.linkedBottleProductName && (
                <div className="text-xs text-blue-600 mt-0.5 flex items-center gap-1">
                  <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium text-[10px]">LINKED</span>
                  <span className="truncate">{drink.linkedBottleProductName}</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
