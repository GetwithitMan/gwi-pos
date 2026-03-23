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
    <div className="space-y-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--site-text-muted)' }}>
        Toppings
      </h3>

      {sortedCategories.map(([category, items]) => (
        <div key={category} className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--site-text-muted)' }}>
            {CATEGORY_LABELS[category] || category}
          </h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
                      w-full rounded-lg border-2 px-3 py-2.5 text-left text-sm transition-all
                      ${isSelected
                        ? 'border-[var(--site-brand)] bg-[var(--site-brand)]/10'
                        : 'border-[var(--site-border)] bg-[var(--site-bg)] hover:border-[var(--site-brand)]/50'}
                      ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
                    `}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="truncate font-medium"
                        style={{ color: isSelected ? 'var(--site-brand)' : 'var(--site-text)' }}
                      >
                        {isSelected && <span className="mr-1">&#10003;</span>}
                        {topping.displayName || topping.name}
                      </span>
                      <span className="shrink-0 text-xs" style={{ color: 'var(--site-text-muted)' }}>
                        +{formatCurrency(displayPrice)}
                      </span>
                    </div>
                  </button>

                  {/* Expanded controls for selected topping */}
                  {isSelected && isExpanded && (
                    <div
                      className="rounded-lg border p-2 space-y-2"
                      style={{ borderColor: 'var(--site-border)', backgroundColor: 'var(--site-bg-secondary)' }}
                    >
                      {/* Amount toggle */}
                      <div className="flex gap-1.5">
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
                      className="w-full text-center text-xs py-0.5"
                      style={{ color: 'var(--site-brand)' }}
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
        rounded-md border px-2.5 py-1 text-xs font-medium transition-all
        ${isActive
          ? 'border-[var(--site-brand)] bg-[var(--site-brand)]/15 text-[var(--site-brand)]'
          : 'border-[var(--site-border)] hover:border-[var(--site-brand)]/40'}
      `}
      style={!isActive ? { color: 'var(--site-text-muted)' } : undefined}
    >
      {label}
    </button>
  )
}
