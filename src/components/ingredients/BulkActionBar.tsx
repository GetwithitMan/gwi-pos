'use client'

import type { Ingredient, IngredientCategory } from './IngredientLibrary'

interface BulkActionBarProps {
  selectedIds: Set<string>
  ingredients: Ingredient[]
  categories: IngredientCategory[]
  onBulkMove: (targetCategoryId: string) => void
  onBulkMoveUnderParent: (parentId: string | null) => void
  onClearSelection: () => void
}

export function BulkActionBar({
  selectedIds,
  ingredients,
  categories,
  onBulkMove,
  onBulkMoveUnderParent,
  onClearSelection,
}: BulkActionBarProps) {
  if (selectedIds.size === 0) return null

  // Analyze selected items
  const allItems: Ingredient[] = []
  const collectItems = (items: Ingredient[]) => {
    for (const item of items) {
      if (selectedIds.has(item.id)) allItems.push(item)
      if (item.childIngredients) collectItems(item.childIngredients)
    }
  }
  collectItems(ingredients)

  const hasPrepItems = allItems.some(i => i.parentIngredientId)
  const hasInventoryItems = allItems.some(i => !i.parentIngredientId)
  const allPrepItems = allItems.length > 0 && allItems.every(i => i.parentIngredientId)
  const allInventoryItems = allItems.length > 0 && allItems.every(i => !i.parentIngredientId)

  // Get base ingredients for "Move to Inventory Item" option
  const baseIngredients = ingredients.filter(i => !i.parentIngredientId && i.isBaseIngredient !== false)

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-900/90 backdrop-blur-sm rounded-lg px-4 py-3 flex items-center gap-3 shadow-xl border border-gray-700 z-50 max-w-[95vw]">
      <span className="text-white font-medium flex items-center gap-2">
        <span className="text-blue-400">☑</span>
        {selectedIds.size} selected
        {allPrepItems && <span className="text-green-400 text-xs">(prep)</span>}
        {allInventoryItems && <span className="text-blue-400 text-xs">(inventory)</span>}
        {hasPrepItems && hasInventoryItems && <span className="text-yellow-400 text-xs">(mixed)</span>}
      </span>

      {/* Move to Category - for inventory items */}
      {hasInventoryItems && (
        <select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value === '__uncategorized__') {
              onBulkMove('')
            } else if (e.target.value) {
              onBulkMove(e.target.value)
            }
            e.target.value = ''
          }}
          className="bg-blue-700 text-white rounded px-3 py-1.5 border border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
          aria-label="Move to category"
        >
          <option value="">📁 Category...</option>
          <option value="__uncategorized__">❓ Uncategorized</option>
          {categories.filter(c => c.isActive).map(c => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
      )}

      {/* Move to different Inventory Item - for prep items */}
      {hasPrepItems && (
        <select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value === '__uncategorized__') {
              onBulkMoveUnderParent(null)
            } else if (e.target.value) {
              onBulkMoveUnderParent(e.target.value)
            }
            e.target.value = ''
          }}
          className="bg-green-700 text-white rounded px-3 py-1.5 border border-green-500 focus:outline-none focus:ring-2 focus:ring-green-400 text-sm"
          aria-label="Move under inventory item"
        >
          <option value="">📦 Move under...</option>
          <option value="__uncategorized__">❓ Uncategorized</option>
          {baseIngredients.map(inv => (
            <option key={inv.id} value={inv.id}>
              {inv.name}
            </option>
          ))}
        </select>
      )}

      <button
        onClick={onClearSelection}
        className="text-gray-400 hover:text-white transition-colors text-sm"
        aria-label="Clear selection"
      >
        ✕ Clear
      </button>
    </div>
  )
}
