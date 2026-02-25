'use client'

import type { IngredientCategory } from './types'

interface IngredientFiltersProps {
  search: string
  onSearchChange: (value: string) => void
  selectedCategory: string
  onCategoryChange: (value: string) => void
  showInactive: boolean
  onShowInactiveChange: (value: boolean) => void
  categories: IngredientCategory[]
  allVisibleSelected: boolean
  someVisibleSelected: boolean
  onSelectAll: () => void
}

export function IngredientFilters({
  search,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  showInactive,
  onShowInactiveChange,
  categories,
  allVisibleSelected,
  someVisibleSelected,
  onSelectAll,
}: IngredientFiltersProps) {
  return (
    <div className="flex gap-4 items-center">
      {/* Select All Checkbox */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={allVisibleSelected}
          ref={(el) => {
            if (el) el.indeterminate = someVisibleSelected
          }}
          onChange={onSelectAll}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          title="Select all visible ingredients"
        />
        <span className="text-sm text-gray-600">All</span>
      </div>

      <input
        type="text"
        placeholder="Search ingredients..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <select
        value={selectedCategory}
        onChange={(e) => onCategoryChange(e.target.value)}
        className="px-4 py-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          onChange={(e) => onShowInactiveChange(e.target.checked)}
          className="w-4 h-4"
        />
        <span className="text-sm text-gray-600">Show Inactive</span>
      </label>
    </div>
  )
}
