'use client'

import { MenuSearchResultItem } from './MenuSearchResultItem'

interface MenuItem {
  id: string
  name: string
  price: number
  categoryId: string
  is86d?: boolean
}

interface IngredientMatch {
  ingredientType: 'spirit' | 'food'
  ingredientName: string
  ingredientId: string
  items: MenuItem[]
}

interface SearchResults {
  directMatches: MenuItem[]
  ingredientMatches: IngredientMatch[]
  totalMatches: number
}

interface MenuSearchResultsProps {
  results: SearchResults | null
  query: string
  isSearching: boolean
  onSelectItem: (item: MenuItem) => void
  onClose: () => void
}

export function MenuSearchResults({
  results,
  query,
  isSearching,
  onSelectItem,
  onClose
}: MenuSearchResultsProps) {
  if (!query || query.length < 2) return null

  return (
    <div className="absolute top-full left-0 right-0 mt-2 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl z-50 max-h-[70vh] overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 bg-gray-900 border-b border-gray-700 p-3 flex items-center justify-between">
        <span className="text-gray-400 text-sm">
          Results for "{query}"
          {results && ` (${results.totalMatches} found)`}
        </span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white p-1"
          aria-label="Close search"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Loading */}
      {isSearching && !results && (
        <div className="p-8 text-center text-gray-400">Searching...</div>
      )}

      {/* No Results */}
      {!isSearching && results && results.totalMatches === 0 && (
        <div className="p-8 text-center text-gray-400">No items found for "{query}"</div>
      )}

      {/* Results */}
      {results && results.totalMatches > 0 && (
        <div className="p-3 space-y-4">
          {/* Direct Matches */}
          {results.directMatches.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Menu Items ({results.directMatches.length})
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {results.directMatches.map(item => (
                  <MenuSearchResultItem
                    key={item.id}
                    item={item}
                    onClick={() => onSelectItem(item)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Ingredient Matches */}
          {results.ingredientMatches.map(group => (
            <div key={group.ingredientId}>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <span>{group.ingredientType === 'spirit' ? '🥃' : '🍴'}</span>
                Contains {group.ingredientName} ({group.items.length})
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {group.items.map(item => (
                  <MenuSearchResultItem
                    key={item.id}
                    item={item}
                    onClick={() => onSelectItem(item)}
                    badge={group.ingredientType}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
