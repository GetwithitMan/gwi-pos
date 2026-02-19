'use client'

import { memo } from 'react'

// Favorite item for custom bar
export interface FavoriteItemData {
  menuItemId: string
  name: string
  price: number
  hasModifiers?: boolean
}

interface FavoriteItemProps {
  fav: FavoriteItemData
  isEditingFavorites: boolean
  onTap: (fav: FavoriteItemData) => void
  onRemove: (menuItemId: string) => void
}

export const FavoriteItem = memo(function FavoriteItem({ fav, isEditingFavorites, onTap, onRemove }: FavoriteItemProps) {
  return (
    <button
      onClick={() => !isEditingFavorites && onTap(fav)}
      className={`relative flex-shrink-0 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
        isEditingFavorites
          ? 'bg-red-900/30 border border-red-500/30 text-red-300'
          : 'bg-amber-600/30 border border-amber-500/30 text-amber-200 hover:bg-amber-600/50 active:scale-95'
      }`}
    >
      {isEditingFavorites && (
        <span
          onClick={(e) => {
            e.stopPropagation()
            onRemove(fav.menuItemId)
          }}
          className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 rounded-full text-white text-xs flex items-center justify-center cursor-pointer"
        >
          ×
        </span>
      )}
      {fav.name}
    </button>
  )
})
