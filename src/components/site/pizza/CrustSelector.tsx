'use client'

import type { PizzaCrust } from '@/types'
import { formatCurrency } from '@/lib/utils'

interface CrustSelectorProps {
  crusts: PizzaCrust[]
  selectedId: string | null
  onSelect: (crust: PizzaCrust) => void
  disabled?: boolean
}

export function CrustSelector({ crusts, selectedId, onSelect, disabled }: CrustSelectorProps) {
  const activeCrusts = crusts
    .filter((c) => c.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--site-text-muted)' }}>
        Choose Crust
      </h3>
      <div className="flex flex-wrap gap-2">
        {activeCrusts.map((crust) => {
          const isSelected = crust.id === selectedId
          const hasUpcharge = crust.price > 0
          return (
            <button
              key={crust.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(crust)}
              className={`
                rounded-full border-2 px-4 py-2 text-sm font-medium transition-all
                ${isSelected
                  ? 'border-[var(--site-brand)] bg-[var(--site-brand)] text-[var(--site-text-on-brand)]'
                  : 'border-[var(--site-border)] bg-[var(--site-bg)] hover:border-[var(--site-brand)]/50'}
                ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
              `}
              style={!isSelected ? { color: 'var(--site-text)' } : undefined}
            >
              {crust.displayName || crust.name}
              {hasUpcharge && (
                <span className="ml-1 opacity-75">+{formatCurrency(crust.price)}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
