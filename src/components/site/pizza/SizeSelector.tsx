'use client'

import type { PizzaSize } from '@/types'
import { formatCurrency } from '@/lib/utils'

interface SizeSelectorProps {
  sizes: PizzaSize[]
  selectedId: string | null
  onSelect: (size: PizzaSize) => void
  disabled?: boolean
}

export function SizeSelector({ sizes, selectedId, onSelect, disabled }: SizeSelectorProps) {
  const activeSizes = sizes
    .filter((s) => s.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div className="py-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
        Choose Size
      </h3>
      <div className="flex gap-2 overflow-x-auto">
        {activeSizes.map((size) => {
          const isSelected = size.id === selectedId
          return (
            <button
              key={size.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(size)}
              className={`
                px-4 py-3 rounded-xl border-2 text-center transition-all min-h-[44px] min-w-[100px] flex-shrink-0
                ${isSelected
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 hover:border-gray-300'}
                ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
              `}
            >
              {size.inches && (
                <div className={`text-2xl font-bold ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                  {size.inches}&quot;
                </div>
              )}
              <div className={`text-sm font-medium ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                {size.displayName || size.name}
              </div>
              <div className={`mt-1 text-sm font-semibold ${isSelected ? 'text-blue-600' : 'text-blue-500'}`}>
                {formatCurrency(size.basePrice)}
              </div>
              {size.slices > 0 && (
                <div className="mt-0.5 text-xs text-gray-400">
                  {size.slices} slices
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
