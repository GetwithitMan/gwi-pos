'use client'

import { memo } from 'react'
import { FavoriteItem } from '@/components/bartender/FavoriteItem'
import type { FavoriteItemData } from '@/components/bartender/FavoriteItem'

// ============================================================================
// TYPES
// ============================================================================

interface BartenderFavoritesProps {
  favorites: FavoriteItemData[]
  isEditing: boolean
  onFavoriteTap: (fav: FavoriteItemData) => void
  onRemoveFavorite: (menuItemId: string) => void
  onClearAll: () => void
  onStopEditing: () => void
  // Long-press binding for the vertical label
  favoritesLongPressProps: Record<string, any>
}

// ============================================================================
// COMPONENT
// ============================================================================

export const BartenderFavorites = memo(function BartenderFavorites({
  favorites,
  isEditing,
  onFavoriteTap,
  onRemoveFavorite,
  onClearAll,
  onStopEditing,
  favoritesLongPressProps,
}: BartenderFavoritesProps) {
  return (
    <div className="flex-shrink-0 bg-gradient-to-r from-amber-900/20 to-orange-900/20 border-b border-amber-500/20 p-2">
      <div className="flex items-center gap-2">
        {/* Vertical Label - Long press to edit */}
        <div
          className="flex-shrink-0 w-6 flex items-center justify-center cursor-pointer select-none"
          {...favoritesLongPressProps}
          title={favorites.length > 0 ? 'Long-press to edit favorites' : ''}
        >
          <span
            className={`text-[10px] font-bold tracking-wider ${isEditing ? 'text-red-400' : 'text-amber-400'}`}
            style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
          >
            {isEditing ? 'EDIT' : 'MY BAR'}
          </span>
        </div>

        {/* Favorites Items */}
        {favorites.length === 0 ? (
          <div className="flex-1 text-slate-500 text-sm italic">
            Long-press menu items to add favorites
          </div>
        ) : (
          <div className="flex-1 flex gap-2 overflow-x-auto">
            {favorites.map(fav => (
              <FavoriteItem
                key={fav.menuItemId}
                fav={fav}
                isEditingFavorites={isEditing}
                onTap={onFavoriteTap}
                onRemove={onRemoveFavorite}
              />
            ))}
          </div>
        )}

        {/* Edit mode buttons */}
        {isEditing && (
          <div className="flex items-center gap-2">
            {favorites.length > 0 && (
              <button
                onClick={onClearAll}
                className="text-xs px-2 py-1 bg-red-600/50 text-red-200 rounded hover:bg-red-600 transition-colors"
              >
                Clear All
              </button>
            )}
            <button
              onClick={onStopEditing}
              className="text-xs px-3 py-1 bg-green-600 text-white font-bold rounded hover:bg-green-500 transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
})
