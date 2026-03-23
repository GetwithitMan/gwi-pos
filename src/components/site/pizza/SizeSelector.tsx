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
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--site-text-muted)' }}>
        Choose Size
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {activeSizes.map((size) => {
          const isSelected = size.id === selectedId
          return (
            <button
              key={size.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(size)}
              className={`
                relative rounded-xl border-2 p-4 text-center transition-all
                ${isSelected
                  ? 'border-[var(--site-brand)] bg-[var(--site-brand)]/10 shadow-md'
                  : 'border-[var(--site-border)] bg-[var(--site-bg)] hover:border-[var(--site-brand)]/50'}
                ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
              `}
            >
              {size.inches && (
                <div className="text-2xl font-bold" style={{ color: isSelected ? 'var(--site-brand)' : 'var(--site-text)' }}>
                  {size.inches}&quot;
                </div>
              )}
              <div className="text-sm font-medium" style={{ color: 'var(--site-text)' }}>
                {size.displayName || size.name}
              </div>
              <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--site-brand)' }}>
                {formatCurrency(size.basePrice)}
              </div>
              {size.slices > 0 && (
                <div className="mt-0.5 text-xs" style={{ color: 'var(--site-text-muted)' }}>
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
