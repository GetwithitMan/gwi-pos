'use client'

/**
 * SauceCheesePanel — Sauce and cheese selection with placement + amount controls.
 *
 * When the pizza is split (halves/quarters) and the venue allows condiment sections:
 * - Customer selects a sauce, then picks placement (Whole / Left / Right / quarters)
 * - Same for cheese
 * - Matches Android register behavior: select the item, then choose where it goes
 *
 * When whole pizza or condiment sections disabled:
 * - Simple single sauce + amount selection
 */

import { useState } from 'react'
import type { PizzaSauce, PizzaCheese } from '@/types'
import { formatCurrency } from '@/lib/utils'
import { getSectionPreset } from '@/lib/pizza-section-utils'
import { ToppingPlacementPicker } from './ToppingPlacementPicker'
import type { CondimentSelection } from './PizzaBuilder'

type Amount = 'none' | 'light' | 'regular' | 'extra'

interface SauceCheesePanelProps {
  sauces: PizzaSauce[]
  cheeses: PizzaCheese[]
  sauceSelections: CondimentSelection[]
  cheeseSelections: CondimentSelection[]
  onSauceChange: (selections: CondimentSelection[]) => void
  onCheeseChange: (selections: CondimentSelection[]) => void
  allowCondimentSections: boolean
  /** Max division for sauce/cheese placement (1=whole only, 2=halves, 3=thirds). Default: 2 */
  condimentDivisionMax: number
  sectionMode: number
  sauceDisabled?: boolean
  cheeseDisabled?: boolean
}

export function SauceCheesePanel({
  sauces,
  cheeses,
  sauceSelections,
  cheeseSelections,
  onSauceChange,
  onCheeseChange,
  allowCondimentSections,
  condimentDivisionMax,
  sectionMode,
  sauceDisabled,
  cheeseDisabled,
}: SauceCheesePanelProps) {
  const activeSauces = sauces.filter((s) => s.isActive).sort((a, b) => a.sortOrder - b.sortOrder)
  const activeCheeses = cheeses.filter((c) => c.isActive).sort((a, b) => a.sortOrder - b.sortOrder)
  const showPlacement = allowCondimentSections && sectionMode >= 2
  // Sauce/cheese placement is limited by condimentDivisionMax (e.g., max halves or thirds)
  // Toppings use the full sectionMode (quarters, sixths, eighths)
  const condimentMaxDivision = condimentDivisionMax || 2

  return (
    <div className="py-4 space-y-5">
      <CondimentSelector
        label="Sauce"
        items={activeSauces}
        selections={sauceSelections}
        onChange={onSauceChange}
        showPlacement={showPlacement}
        sectionMode={sectionMode}
        maxDivision={condimentMaxDivision}
        disabled={sauceDisabled}
      />
      <CondimentSelector
        label="Cheese"
        items={activeCheeses}
        selections={cheeseSelections}
        onChange={onCheeseChange}
        showPlacement={showPlacement}
        sectionMode={sectionMode}
        maxDivision={condimentMaxDivision}
        disabled={cheeseDisabled}
      />
    </div>
  )
}

// ─── Condiment Selector (sauce or cheese) ──────────────────────────────────

interface CondimentSelectorProps {
  label: string
  items: Array<PizzaSauce | PizzaCheese>
  selections: CondimentSelection[]
  onChange: (selections: CondimentSelection[]) => void
  showPlacement: boolean
  sectionMode: number
  /** Max division for placement picker (2=halves, 3=thirds). Limits sauce/cheese splits. */
  maxDivision: number
  disabled?: boolean
}

function CondimentSelector({
  label,
  items,
  selections,
  onChange,
  showPlacement,
  sectionMode,
  maxDivision,
  disabled,
}: CondimentSelectorProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const wholeSections = getSectionPreset(1, 0)

  // Current primary selection (for whole-pizza mode there's just one)
  const primarySel = selections[0] ?? null
  const selectedItem = primarySel ? items.find(i => i.id === primarySel.id) ?? null : null

  const handleSelect = (item: PizzaSauce | PizzaCheese) => {
    if (primarySel?.id === item.id) {
      // Already selected — toggle expand for placement
      if (showPlacement) {
        setExpandedId(expandedId === item.id ? null : item.id)
      }
      return
    }
    // New selection — default to whole pizza placement
    onChange([{ id: item.id, amount: 'regular', sections: wholeSections }])
    if (showPlacement) setExpandedId(item.id)
  }

  const handleAmountChange = (amount: Amount) => {
    if (!primarySel) return
    onChange(selections.map(s => s.id === primarySel.id ? { ...s, amount } : s))
  }

  const handlePlacementChange = (sections: number[]) => {
    if (!primarySel) return
    onChange(selections.map(s => s.id === primarySel.id ? { ...s, sections } : s))
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
        {label}
      </h3>

      {/* Item selection pills */}
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const isSelected = item.id === primarySel?.id
          const hasPrice = Number(item.price) > 0
          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              onClick={() => handleSelect(item)}
              className={`rounded-full border-2 px-4 py-2.5 text-sm font-medium transition-all min-h-[44px] ${
                disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
              } ${!isSelected ? 'border-gray-200 text-gray-700 hover:border-gray-300' : 'text-white'}`}
              style={isSelected ? {
                borderColor: 'var(--site-brand)',
                backgroundColor: 'var(--site-brand)',
              } : undefined}
            >
              {item.displayName || item.name}
              {hasPrice && <span className="ml-1 opacity-75">+{formatCurrency(Number(item.price))}</span>}
            </button>
          )
        })}
      </div>

      {/* Controls for selected item: amount + placement */}
      {primarySel && (
        <div className="space-y-2 rounded-lg border border-gray-100 bg-gray-50/50 p-3">
          {/* Amount row */}
          <div className="flex gap-1 flex-wrap">
            <AmountButton current={primarySel.amount} value="none" label="None" onClick={handleAmountChange} />
            {(selectedItem && 'allowLight' in selectedItem ? selectedItem.allowLight : true) && (
              <AmountButton current={primarySel.amount} value="light" label="Light" onClick={handleAmountChange} />
            )}
            <AmountButton current={primarySel.amount} value="regular" label="Regular" onClick={handleAmountChange} />
            {(selectedItem && 'allowExtra' in selectedItem ? selectedItem.allowExtra : true) && (
              <AmountButton
                current={primarySel.amount}
                value="extra"
                label={
                  selectedItem && 'extraPrice' in selectedItem && Number(selectedItem.extraPrice) > 0
                    ? `Extra +${formatCurrency(Number(selectedItem.extraPrice))}`
                    : 'Extra'
                }
                onClick={handleAmountChange}
              />
            )}
          </div>

          {/* Placement picker (Whole / Left Half / Right Half — limited by condimentDivisionMax) */}
          {showPlacement && (
            <ToppingPlacementPicker
              sectionMode={sectionMode}
              selectedSections={primarySel.sections}
              onChange={handlePlacementChange}
              maxDivision={maxDivision}
              multiSelect={false}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Amount button ─────────────────────────────────────────────────────────

function AmountButton({
  current,
  value,
  label,
  onClick,
}: {
  current: Amount
  value: Amount
  label: string
  onClick: (amount: Amount) => void
}) {
  const isActive = current === value
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all min-h-[36px] ${
        !isActive ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'text-white'
      }`}
      style={isActive ? { backgroundColor: 'var(--site-brand)' } : undefined}
    >
      {label}
    </button>
  )
}
