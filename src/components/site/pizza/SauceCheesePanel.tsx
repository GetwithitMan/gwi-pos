'use client'

/**
 * SauceCheesePanel — Sauce and cheese each get their OWN independent split mode.
 *
 * Flow (matches Android register):
 * 1. Sauce section: Split selector (Whole / Halves / Thirds) → per-section sauce picker + amount
 * 2. Cheese section: Same independent split → per-section cheese picker + amount
 *
 * Sauce/cheese splits are INDEPENDENT of the pizza's topping split mode.
 * Limited by condimentDivisionMax (1=whole only, 2=halves, 3=thirds).
 */

import { useState } from 'react'
import type { PizzaSauce, PizzaCheese } from '@/types'
import { formatCurrency } from '@/lib/utils'
import { getAllSectionPresetsForMode, getSectionPreset } from '@/lib/pizza-section-utils'
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
  /** Max condiment split: 1=whole only, 2=halves, 3=thirds */
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
  sauceDisabled,
  cheeseDisabled,
}: SauceCheesePanelProps) {
  const activeSauces = sauces.filter((s) => s.isActive).sort((a, b) => a.sortOrder - b.sortOrder)
  const activeCheeses = cheeses.filter((c) => c.isActive).sort((a, b) => a.sortOrder - b.sortOrder)
  const maxSplit = allowCondimentSections ? (condimentDivisionMax || 2) : 1

  return (
    <div className="py-4 space-y-6">
      <CondimentSection
        label="Sauce"
        items={activeSauces}
        selections={sauceSelections}
        onChange={onSauceChange}
        maxSplit={maxSplit}
        disabled={sauceDisabled}
      />
      <CondimentSection
        label="Cheese"
        items={activeCheeses}
        selections={cheeseSelections}
        onChange={onCheeseChange}
        maxSplit={maxSplit}
        disabled={cheeseDisabled}
      />
    </div>
  )
}

// ─── Condiment Section (sauce OR cheese) ───────────────────────────────────

interface CondimentSectionProps {
  label: string
  items: Array<PizzaSauce | PizzaCheese>
  selections: CondimentSelection[]
  onChange: (selections: CondimentSelection[]) => void
  /** Max split for this condiment: 1=whole, 2=halves, 3=thirds */
  maxSplit: number
  disabled?: boolean
}

function CondimentSection({ label, items, selections, onChange, maxSplit, disabled }: CondimentSectionProps) {
  // Each condiment has its OWN split mode, independent of pizza split
  const [splitMode, setSplitMode] = useState<number>(1) // 1=whole, 2=halves, 3=thirds
  const wholeSections = getSectionPreset(1, 0)

  const handleSplitChange = (mode: number) => {
    setSplitMode(mode)
    // Reset selections when split changes
    if (mode === 1) {
      // Whole: keep first selection, set to whole
      const first = selections[0]
      onChange(first ? [{ ...first, sections: wholeSections }] : [])
    } else {
      // Halves/Thirds: create a selection per section, default to first item
      const presets = getAllSectionPresetsForMode(mode)
      const defaultItem = items[0]
      if (defaultItem) {
        onChange(presets.map(p => ({ id: defaultItem.id, amount: 'regular' as Amount, sections: p.sections })))
      } else {
        onChange([])
      }
    }
  }

  const handleSectionItemChange = (sectionSections: number[], itemId: string) => {
    const updated = selections.map(s => {
      if (arraysMatch(s.sections, sectionSections)) {
        return { ...s, id: itemId }
      }
      return s
    })
    // If no existing selection for this section, add one
    if (!updated.find(s => arraysMatch(s.sections, sectionSections))) {
      updated.push({ id: itemId, amount: 'regular', sections: sectionSections })
    }
    onChange(updated)
  }

  const handleSectionAmountChange = (sectionSections: number[], amount: Amount) => {
    onChange(selections.map(s => {
      if (arraysMatch(s.sections, sectionSections)) {
        return { ...s, amount }
      }
      return s
    }))
  }

  // Build split mode options: [1] always, [1,2] if max>=2, [1,2,3] if max>=3
  const splitOptions: Array<{ mode: number; label: string }> = [{ mode: 1, label: 'Whole' }]
  if (maxSplit >= 2) splitOptions.push({ mode: 2, label: 'Halves' })
  if (maxSplit >= 3) splitOptions.push({ mode: 3, label: 'Thirds' })

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</h3>

      {/* Split mode selector (only if max > 1) */}
      {maxSplit > 1 && (
        <div className="flex gap-1">
          {splitOptions.map(opt => (
            <button
              key={opt.mode}
              type="button"
              onClick={() => handleSplitChange(opt.mode)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-all min-h-[36px] ${
                splitMode !== opt.mode ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'text-white'
              }`}
              style={splitMode === opt.mode ? { backgroundColor: 'var(--site-brand)' } : undefined}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Per-section pickers */}
      {splitMode === 1 ? (
        <SinglePicker
          items={items}
          selection={selections[0] ?? null}
          onItemChange={(id) => onChange([{ id, amount: selections[0]?.amount ?? 'regular', sections: wholeSections }])}
          onAmountChange={(amount) => {
            if (selections[0]) onChange([{ ...selections[0], amount }])
          }}
          disabled={disabled}
        />
      ) : (
        <SplitPickers
          items={items}
          selections={selections}
          splitMode={splitMode}
          onItemChange={handleSectionItemChange}
          onAmountChange={handleSectionAmountChange}
          disabled={disabled}
        />
      )}
    </div>
  )
}

// ─── Single picker (whole) ─────────────────────────────────────────────────

function SinglePicker({
  items,
  selection,
  onItemChange,
  onAmountChange,
  disabled,
}: {
  items: Array<PizzaSauce | PizzaCheese>
  selection: CondimentSelection | null
  onItemChange: (id: string) => void
  onAmountChange: (amount: Amount) => void
  disabled?: boolean
}) {
  const selectedItem = selection ? items.find(i => i.id === selection.id) ?? null : null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {items.map(item => {
          const isSelected = item.id === selection?.id
          return (
            <ItemPill
              key={item.id}
              item={item}
              isSelected={isSelected}
              disabled={disabled}
              onClick={() => onItemChange(item.id)}
            />
          )
        })}
      </div>
      {selection && (
        <AmountRow
          amount={selection.amount}
          item={selectedItem}
          onChange={onAmountChange}
        />
      )}
    </div>
  )
}

// ─── Split pickers (halves/thirds) ─────────────────────────────────────────

function SplitPickers({
  items,
  selections,
  splitMode,
  onItemChange,
  onAmountChange,
  disabled,
}: {
  items: Array<PizzaSauce | PizzaCheese>
  selections: CondimentSelection[]
  splitMode: number
  onItemChange: (sections: number[], id: string) => void
  onAmountChange: (sections: number[], amount: Amount) => void
  disabled?: boolean
}) {
  const presets = getAllSectionPresetsForMode(splitMode)

  return (
    <div className="space-y-3">
      {presets.map(preset => {
        const sel = selections.find(s => arraysMatch(s.sections, preset.sections)) ?? null
        const selectedItem = sel ? items.find(i => i.id === sel.id) ?? null : null

        return (
          <div key={preset.position} className="rounded-lg border border-gray-100 bg-gray-50/50 p-3 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--site-brand)' }}>
              {preset.label}
            </div>
            <div className="flex flex-wrap gap-2">
              {items.map(item => {
                const isSelected = item.id === sel?.id
                return (
                  <ItemPill
                    key={item.id}
                    item={item}
                    isSelected={isSelected}
                    disabled={disabled}
                    onClick={() => onItemChange(preset.sections, item.id)}
                    compact
                  />
                )
              })}
            </div>
            {sel && (
              <AmountRow
                amount={sel.amount}
                item={selectedItem}
                onChange={(amount) => onAmountChange(preset.sections, amount)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Shared components ─────────────────────────────────────────────────────

function ItemPill({
  item,
  isSelected,
  disabled,
  onClick,
  compact,
}: {
  item: PizzaSauce | PizzaCheese
  isSelected: boolean
  disabled?: boolean
  onClick: () => void
  compact?: boolean
}) {
  const hasPrice = Number(item.price) > 0
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border-2 ${compact ? 'px-3 py-2 text-xs' : 'px-4 py-2.5 text-sm'} font-medium transition-all min-h-[44px] ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      } ${!isSelected ? 'border-gray-200 text-gray-700 hover:border-gray-300' : 'text-white'}`}
      style={isSelected ? { borderColor: 'var(--site-brand)', backgroundColor: 'var(--site-brand)' } : undefined}
    >
      {item.displayName || item.name}
      {hasPrice && <span className="ml-1 opacity-75">+{formatCurrency(Number(item.price))}</span>}
    </button>
  )
}

function AmountRow({
  amount,
  item,
  onChange,
}: {
  amount: Amount
  item: (PizzaSauce | PizzaCheese) | null
  onChange: (amount: Amount) => void
}) {
  const allowLight = item && 'allowLight' in item ? item.allowLight : true
  const allowExtra = item && 'allowExtra' in item ? item.allowExtra : true
  const extraPrice = item && 'extraPrice' in item ? Number(item.extraPrice) : 0

  return (
    <div className="flex gap-1 flex-wrap">
      <AmountButton current={amount} value="none" label="None" onClick={onChange} />
      {allowLight && <AmountButton current={amount} value="light" label="Light" onClick={onChange} />}
      <AmountButton current={amount} value="regular" label="Regular" onClick={onChange} />
      {allowExtra && (
        <AmountButton
          current={amount}
          value="extra"
          label={extraPrice > 0 ? `Extra +${formatCurrency(extraPrice)}` : 'Extra'}
          onClick={onChange}
        />
      )}
    </div>
  )
}

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

function arraysMatch(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort((x, y) => x - y)
  const sb = [...b].sort((x, y) => x - y)
  return sa.every((v, i) => v === sb[i])
}
