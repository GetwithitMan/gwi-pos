'use client'

import { formatCurrency } from '@/lib/utils'

interface MenuItem {
  id: string
  name: string
  price: number
  is86d?: boolean
}

interface MenuSearchResultItemProps {
  item: MenuItem
  onClick: () => void
  badge?: 'spirit' | 'food'
  cardPriceMultiplier?: number
}

export function MenuSearchResultItem({ item, onClick, badge, cardPriceMultiplier }: MenuSearchResultItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={item.is86d}
      className={`relative p-3 rounded-lg text-left transition-all ${
        item.is86d
          ? 'bg-red-900/30 border border-red-500/50 cursor-not-allowed opacity-60'
          : 'bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600'
      }`}
    >
      {badge && (
        <span className="absolute top-1 right-1 text-xs">
          {badge === 'spirit' ? '🥃' : '🍴'}
        </span>
      )}

      {item.is86d && (
        <span className="absolute top-1 left-1 bg-red-500 text-white text-[10px] px-1 rounded font-bold">
          86
        </span>
      )}

      <div className={`font-medium text-white text-sm truncate ${item.is86d ? 'line-through' : ''}`}>
        {item.name}
      </div>
      <div className="text-blue-400 text-sm font-bold mt-1">
        {formatCurrency(item.price * (cardPriceMultiplier || 1))}
      </div>
    </button>
  )
}
