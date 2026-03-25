'use client'

import type { PizzaSize } from '@/types'
import { formatCurrency } from '@/lib/utils'

interface SizeSelectorProps {
  sizes: PizzaSize[]
  selectedId: string | null
  onSelect: (size: PizzaSize) => void
  disabled?: boolean
  /** When true, uses grid layout instead of horizontal scroll */
  wide?: boolean
}

export function SizeSelector({ sizes, selectedId, onSelect, disabled, wide = false }: SizeSelectorProps) {
  const activeSizes = sizes
    .filter((s) => s.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div className="py-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
        Choose Size
      </h3>
      <div className={wide ? 'grid grid-cols-2 xl:grid-cols-3 gap-2' : 'flex gap-2 overflow-x-auto'}>
        {activeSizes.map((size) => {
          const isSelected = size.id === selectedId
          return (
            <button
              key={size.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(size)}
              className={`px-4 py-3 rounded-xl border-2 text-center transition-all min-h-[44px] ${wide ? '' : 'min-w-[100px] flex-shrink-0'} ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${!isSelected ? 'border-gray-200 hover:border-gray-300' : ''}`}
              style={isSelected ? {
                borderColor: 'var(--site-brand)',
                backgroundColor: 'var(--site-primary-light)',
                color: 'var(--site-brand)',
              } : undefined}
            >
              {size.inches && (
                <div
                  className={`text-2xl font-bold ${!isSelected ? 'text-gray-900' : ''}`}
                  style={isSelected ? { color: 'var(--site-brand)' } : undefined}
                >
                  {size.inches}&quot;
                </div>
              )}
              <div
                className={`text-sm font-medium ${!isSelected ? 'text-gray-900' : ''}`}
                style={isSelected ? { color: 'var(--site-brand)' } : undefined}
              >
                {size.displayName || size.name}
              </div>
              <div
                className="mt-1 text-sm font-semibold"
                style={{ color: 'var(--site-brand)' }}
              >
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
