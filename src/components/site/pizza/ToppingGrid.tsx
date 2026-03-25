'use client'

import { useState } from 'react'
import type { PizzaTopping } from '@/types'
import { formatCurrency } from '@/lib/utils'
import { getSectionPreset } from '@/lib/pizza-section-utils'
import { ToppingPlacementPicker } from './ToppingPlacementPicker'

interface SelectedTopping {
  toppingId: string
  name: string
  sections: number[]
  amount: 'regular' | 'extra'
  price: number
  basePrice: number
}

interface ToppingGridProps {
  toppings: PizzaTopping[]
  selectedToppings: SelectedTopping[]
  sectionMode: number
  sizeToppingMultiplier: number
  onAdd: (topping: SelectedTopping) => void
  onRemove: (toppingId: string) => void
  onUpdate: (toppingId: string, updates: Partial<Pick<SelectedTopping, 'sections' | 'amount'>>) => void
  disabled?: boolean
}

const CATEGORY_ORDER: Record<string, number> = {
  meat: 0,
  veggie: 1,
  cheese: 2,
  premium: 3,
  seafood: 4,
  standard: 5,
}

const CATEGORY_LABELS: Record<string, string> = {
  meat: 'Meats',
  veggie: 'Vegetables',
  cheese: 'Cheeses',
  premium: 'Premium',
  seafood: 'Seafood',
  standard: 'Standard',
}

export function ToppingGrid({
  toppings,
  selectedToppings,
  sectionMode,
  sizeToppingMultiplier,
  onAdd,
  onRemove,
  onUpdate,
  disabled,
}: ToppingGridProps) {
  const [expandedTopping, setExpandedTopping] = useState<string | null>(null)

  const activeToppings = toppings.filter((t) => t.isActive).sort((a, b) => a.sortOrder - b.sortOrder)

  // Group by category
  const grouped = new Map<string, PizzaTopping[]>()
  for (const t of activeToppings) {
    const cat = t.category || 'standard'
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push(t)
  }

  // Sort categories
  const sortedCategories = Array.from(grouped.entries()).sort(
    ([a], [b]) => (CATEGORY_ORDER[a] ?? 99) - (CATEGORY_ORDER[b] ?? 99)
  )

  const selectedMap = new Map(selectedToppings.map((t) => [t.toppingId, t]))

  return (
    <div className="py-4 space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
        Toppings
      </h3>

      {sortedCategories.map(([category, items]) => (
        <div key={category} className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wider text-gray-400">
            {CATEGORY_LABELS[category] || category}
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {items.map((topping) => {
              const selected = selectedMap.get(topping.id)
              const isSelected = !!selected
              const isExpanded = expandedTopping === topping.id
              const displayPrice = Math.round(topping.price * sizeToppingMultiplier * 100) / 100

              return (
                <div key={topping.id} className="space-y-1">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (isSelected) {
                        onRemove(topping.id)
                        if (isExpanded) setExpandedTopping(null)
                      } else {
                        const wholeSections = getSectionPreset(1, 0)
                        onAdd({
                          toppingId: topping.id,
                          name: topping.displayName || topping.name,
                          sections: wholeSections,
                          amount: 'regular',
                          price: topping.price,
                          basePrice: topping.price,
                        })
                        if (sectionMode > 1) setExpandedTopping(topping.id)
                      }
                    }}
                    className={`
                      w-full p-3 rounded-xl border-2 text-left text-sm transition-all min-h-[44px]
                      ${isSelected
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'}
                      ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
                    `}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate font-medium ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                        {isSelected && <span className="mr-1 text-blue-500">&#10003;</span>}
                        {topping.displayName || topping.name}
                      </span>
                      <span className="shrink-0 text-xs text-gray-400">
                        +{formatCurrency(displayPrice)}
                      </span>
                    </div>
                  </button>

                  {/* Expanded controls for selected topping */}
                  {isSelected && isExpanded && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 space-y-2">
                      {/* Amount toggle */}
                      <div className="flex gap-1">
                        <AmountToggle
                          current={selected.amount}
                          value="regular"
                          label="Regular"
                          onClick={() => onUpdate(topping.id, { amount: 'regular' })}
                        />
                        <AmountToggle
                          current={selected.amount}
                          value="extra"
                          label={topping.extraPrice ? `Extra +${formatCurrency(topping.extraPrice)}` : 'Extra'}
                          onClick={() => onUpdate(topping.id, { amount: 'extra' })}
                        />
                      </div>

                      {/* Section placement */}
                      {sectionMode > 1 && (
                        <ToppingPlacementPicker
                          sectionMode={sectionMode}
                          selectedSections={selected.sections}
                          onChange={(sections) => onUpdate(topping.id, { sections })}
                        />
                      )}
                    </div>
                  )}

                  {/* Tap to expand/collapse for selected toppings */}
                  {isSelected && !isExpanded && sectionMode > 1 && (
                    <button
                      type="button"
                      onClick={() => setExpandedTopping(topping.id)}
                      className="w-full text-center text-xs py-0.5 text-blue-500 min-h-[44px] flex items-center justify-center"
                    >
                      Customize placement
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function AmountToggle({
  current,
  value,
  label,
  onClick,
}: {
  current: string
  value: string
  label: string
  onClick: () => void
}) {
  const isActive = current === value
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        px-3 py-1.5 rounded-lg text-xs font-medium transition-all
        ${isActive
          ? 'bg-blue-500 text-white'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}
      `}
    >
      {label}
    </button>
  )
}
