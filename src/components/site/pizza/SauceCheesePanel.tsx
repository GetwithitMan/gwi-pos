'use client'

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
  sectionMode,
  sauceDisabled,
  cheeseDisabled,
}: SauceCheesePanelProps) {
  const activeSauces = sauces.filter((s) => s.isActive).sort((a, b) => a.sortOrder - b.sortOrder)
  const activeCheeses = cheeses.filter((c) => c.isActive).sort((a, b) => a.sortOrder - b.sortOrder)

  const perSection = allowCondimentSections && sectionMode >= 2

  return (
    <div className="py-4 space-y-4">
      {/* Sauce */}
      {perSection ? (
        <PerSectionCondiment
          label="Sauce"
          items={activeSauces}
          selections={sauceSelections}
          onChange={onSauceChange}
          sectionMode={sectionMode}
          disabled={sauceDisabled}
        />
      ) : (
        <SingleCondiment
          label="Sauce"
          items={activeSauces}
          selections={sauceSelections}
          onChange={onSauceChange}
          disabled={sauceDisabled}
        />
      )}

      {/* Cheese */}
      {perSection ? (
        <PerSectionCondiment
          label="Cheese"
          items={activeCheeses}
          selections={cheeseSelections}
          onChange={onCheeseChange}
          sectionMode={sectionMode}
          disabled={cheeseDisabled}
        />
      ) : (
        <SingleCondiment
          label="Cheese"
          items={activeCheeses}
          selections={cheeseSelections}
          onChange={onCheeseChange}
          disabled={cheeseDisabled}
        />
      )}
    </div>
  )
}

// ─── Single-selection mode (whole pizza) ─────────────────────────────────────

interface SingleCondimentProps {
  label: string
  items: Array<PizzaSauce | PizzaCheese>
  selections: CondimentSelection[]
  onChange: (selections: CondimentSelection[]) => void
  disabled?: boolean
}

function SingleCondiment({ label, items, selections, onChange, disabled }: SingleCondimentProps) {
  const wholeSections = getSectionPreset(1, 0)
  const current = selections[0] ?? null
  const selectedItem = current ? items.find((i) => i.id === current.id) ?? null : null

  const handleSelect = (item: PizzaSauce | PizzaCheese) => {
    if (current?.id === item.id) return
    onChange([{ id: item.id, amount: 'regular', sections: wholeSections }])
  }

  const handleAmountChange = (amount: Amount) => {
    if (!current) return
    onChange([{ ...current, amount }])
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
        {label}
      </h3>

      {/* Selection */}
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const isSelected = item.id === current?.id
          const hasPrice = item.price > 0
          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              onClick={() => handleSelect(item)}
              className={`rounded-full border-2 px-4 py-2.5 text-sm font-medium transition-all min-h-[44px] ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${!isSelected ? 'border-gray-200 text-gray-700 hover:border-gray-300' : 'text-white'}`}
              style={isSelected ? {
                borderColor: 'var(--site-brand)',
                backgroundColor: 'var(--site-brand)',
              } : undefined}
            >
              {item.displayName || item.name}
              {hasPrice && <span className="ml-1 opacity-75">+{formatCurrency(item.price)}</span>}
            </button>
          )
        })}
      </div>

      {/* Amount controls */}
      {current && (
        <div className="flex gap-1">
          <AmountButton current={current.amount} value="none" label="None" onClick={handleAmountChange} />
          {(selectedItem?.allowLight ?? true) && (
            <AmountButton current={current.amount} value="light" label="Light" onClick={handleAmountChange} />
          )}
          <AmountButton current={current.amount} value="regular" label="Regular" onClick={handleAmountChange} />
          {(selectedItem?.allowExtra ?? true) && (
            <AmountButton
              current={current.amount}
              value="extra"
              label={(selectedItem?.extraPrice ?? 0) > 0 ? `Extra +${formatCurrency(selectedItem!.extraPrice)}` : 'Extra'}
              onClick={handleAmountChange}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Per-section mode (halves/quarters) ──────────────────────────────────────

interface PerSectionCondimentProps {
  label: string
  items: Array<PizzaSauce | PizzaCheese>
  selections: CondimentSelection[]
  onChange: (selections: CondimentSelection[]) => void
  sectionMode: number
  disabled?: boolean
}

function PerSectionCondiment({ label, items, selections, onChange, sectionMode, disabled }: PerSectionCondimentProps) {
  const presets = getAllSectionPresetsForMode(sectionMode)

  // Build a lookup: position -> selection for that section
  const getSelectionForSection = (sectionIndices: number[]): CondimentSelection | null => {
    return selections.find((s) =>
      s.sections.length === sectionIndices.length &&
      sectionIndices.every((idx) => s.sections.includes(idx))
    ) ?? null
  }

  const handleSectionSelect = (sectionIndices: number[], item: PizzaSauce | PizzaCheese) => {
    const updated = selections.filter((s) =>
      !(s.sections.length === sectionIndices.length && sectionIndices.every((idx) => s.sections.includes(idx)))
    )
    // If it's the same item being re-selected, just toggle it off (keep filtered)
    const existing = getSelectionForSection(sectionIndices)
    if (existing?.id === item.id) {
      onChange(updated)
      return
    }
    updated.push({ id: item.id, amount: 'regular', sections: sectionIndices })
    onChange(updated)
  }

  const handleSectionAmountChange = (sectionIndices: number[], amount: Amount) => {
    onChange(
      selections.map((s) => {
        if (s.sections.length === sectionIndices.length && sectionIndices.every((idx) => s.sections.includes(idx))) {
          return { ...s, amount }
        }
        return s
      })
    )
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
        {label}
      </h3>

      {presets.map((preset) => {
        const sectionSel = getSelectionForSection(preset.sections)
        const selectedItem = sectionSel ? items.find((i) => i.id === sectionSel.id) ?? null : null

        return (
          <div key={preset.position} className="space-y-2 rounded-lg border border-gray-100 bg-gray-50/50 p-3">
            <div
              className="text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: 'var(--site-brand)' }}
            >
              {preset.label} {label}
            </div>

            {/* Item selection for this section */}
            <div className="flex flex-wrap gap-2">
              {items.map((item) => {
                const isSelected = item.id === sectionSel?.id
                const hasPrice = item.price > 0
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleSectionSelect(preset.sections, item)}
                    className={`rounded-full border-2 px-3 py-2 text-xs font-medium transition-all min-h-[44px] ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${!isSelected ? 'border-gray-200 text-gray-700 hover:border-gray-300' : 'text-white'}`}
                    style={isSelected ? {
                      borderColor: 'var(--site-brand)',
                      backgroundColor: 'var(--site-brand)',
                    } : undefined}
                  >
                    {item.displayName || item.name}
                    {hasPrice && <span className="ml-1 opacity-75">+{formatCurrency(item.price)}</span>}
                  </button>
                )
              })}
            </div>

            {/* Amount controls for this section */}
            {sectionSel && (
              <div className="flex gap-1">
                <AmountButton
                  current={sectionSel.amount}
                  value="none"
                  label="None"
                  onClick={(a) => handleSectionAmountChange(preset.sections, a)}
                />
                {(selectedItem?.allowLight ?? true) && (
                  <AmountButton
                    current={sectionSel.amount}
                    value="light"
                    label="Light"
                    onClick={(a) => handleSectionAmountChange(preset.sections, a)}
                  />
                )}
                <AmountButton
                  current={sectionSel.amount}
                  value="regular"
                  label="Regular"
                  onClick={(a) => handleSectionAmountChange(preset.sections, a)}
                />
                {(selectedItem?.allowExtra ?? true) && (
                  <AmountButton
                    current={sectionSel.amount}
                    value="extra"
                    label={(selectedItem?.extraPrice ?? 0) > 0 ? `Extra +${formatCurrency(selectedItem!.extraPrice)}` : 'Extra'}
                    onClick={(a) => handleSectionAmountChange(preset.sections, a)}
                  />
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Shared amount button ────────────────────────────────────────────────────

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
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${!isActive ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'text-white'}`}
      style={isActive ? { backgroundColor: 'var(--site-brand)' } : undefined}
    >
      {label}
    </button>
  )
}
