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
    <div className="py-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
        Choose Crust
      </h3>
      <div className="flex gap-2 overflow-x-auto">
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
                px-4 py-3 rounded-xl border-2 text-center transition-all min-h-[44px] flex-shrink-0
                ${isSelected
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 hover:border-gray-300'}
                ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
              `}
            >
              <div className={`text-sm font-medium ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                {crust.displayName || crust.name}
              </div>
              {hasUpcharge && (
                <div className={`mt-1 text-xs ${isSelected ? 'text-blue-500' : 'text-gray-400'}`}>
                  +{formatCurrency(crust.price)}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
