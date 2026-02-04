'use client'

import { useCallback } from 'react'

// Inline SVG icons
const StarIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg width="16" height="16" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
  </svg>
)

const XIcon = () => (
  <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
  </svg>
)

interface QuickBarItem {
  id: string
  name: string
  price: number
  bgColor?: string | null
  textColor?: string | null
}

interface QuickAccessBarProps {
  items: QuickBarItem[]
  onItemClick: (itemId: string) => void
  onRemoveItem: (itemId: string) => void
  isEditMode?: boolean
}

export function QuickAccessBar({
  items,
  onItemClick,
  onRemoveItem,
  isEditMode = false,
}: QuickAccessBarProps) {
  const handleClick = useCallback((itemId: string) => {
    if (!isEditMode) {
      onItemClick(itemId)
    }
  }, [isEditMode, onItemClick])

  if (items.length === 0 && !isEditMode) {
    return null
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-amber-500/10 to-orange-500/10 border-b border-amber-500/20">
      <div className="flex items-center gap-1 text-amber-400">
        <StarIcon filled />
        <span className="text-xs font-medium">Quick</span>
      </div>

      <div className="flex-1 flex items-center gap-2 overflow-x-auto scrollbar-hide">
        {items.length === 0 ? (
          <span className="text-xs text-white/40 italic">
            Right-click items to add to Quick Bar
          </span>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              onClick={() => handleClick(item.id)}
              className={`
                relative flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium
                transition-all duration-150
                ${isEditMode
                  ? 'ring-2 ring-red-500/50 animate-pulse'
                  : 'hover:scale-105 active:scale-95'
                }
              `}
              style={{
                backgroundColor: item.bgColor || 'rgba(251, 191, 36, 0.2)',
                color: item.textColor || '#fbbf24',
              }}
            >
              {item.name}
              {isEditMode && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveItem(item.id)
                  }}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full
                    flex items-center justify-center shadow-lg hover:bg-red-600 text-white"
                >
                  <XIcon />
                </button>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
