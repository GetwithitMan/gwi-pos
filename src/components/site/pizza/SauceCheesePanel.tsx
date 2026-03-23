'use client'

import type { PizzaSauce, PizzaCheese } from '@/types'
import { formatCurrency } from '@/lib/utils'

type Amount = 'none' | 'light' | 'regular' | 'extra'

interface SauceCheesePanelProps {
  sauces: PizzaSauce[]
  cheeses: PizzaCheese[]
  selectedSauceId: string | null
  selectedCheeseId: string | null
  sauceAmount: Amount
  cheeseAmount: Amount
  onSauceSelect: (sauce: PizzaSauce) => void
  onCheeseSelect: (cheese: PizzaCheese) => void
  onSauceAmountChange: (amount: Amount) => void
  onCheeseAmountChange: (amount: Amount) => void
  sauceDisabled?: boolean
  cheeseDisabled?: boolean
}

export function SauceCheesePanel({
  sauces,
  cheeses,
  selectedSauceId,
  selectedCheeseId,
  sauceAmount,
  cheeseAmount,
  onSauceSelect,
  onCheeseSelect,
  onSauceAmountChange,
  onCheeseAmountChange,
  sauceDisabled,
  cheeseDisabled,
}: SauceCheesePanelProps) {
  const activeSauces = sauces.filter((s) => s.isActive).sort((a, b) => a.sortOrder - b.sortOrder)
  const activeCheeses = cheeses.filter((c) => c.isActive).sort((a, b) => a.sortOrder - b.sortOrder)

  const selectedSauce = activeSauces.find((s) => s.id === selectedSauceId) ?? null
  const selectedCheese = activeCheeses.find((c) => c.id === selectedCheeseId) ?? null

  return (
    <div className="space-y-6">
      {/* Sauce */}
      <CondimentSection
        label="Sauce"
        items={activeSauces}
        selectedId={selectedSauceId}
        amount={sauceAmount}
        onSelect={(item) => onSauceSelect(item as PizzaSauce)}
        onAmountChange={onSauceAmountChange}
        allowLight={selectedSauce?.allowLight ?? true}
        allowExtra={selectedSauce?.allowExtra ?? true}
        extraPrice={selectedSauce?.extraPrice ?? 0}
        disabled={sauceDisabled}
      />

      {/* Cheese */}
      <CondimentSection
        label="Cheese"
        items={activeCheeses}
        selectedId={selectedCheeseId}
        amount={cheeseAmount}
        onSelect={(item) => onCheeseSelect(item as PizzaCheese)}
        onAmountChange={onCheeseAmountChange}
        allowLight={selectedCheese?.allowLight ?? true}
        allowExtra={selectedCheese?.allowExtra ?? true}
        extraPrice={selectedCheese?.extraPrice ?? 0}
        disabled={cheeseDisabled}
      />
    </div>
  )
}

interface CondimentSectionProps {
  label: string
  items: Array<{ id: string; name: string; displayName?: string | null; price: number }>
  selectedId: string | null
  amount: Amount
  onSelect: (item: { id: string; name: string; displayName?: string | null; price: number }) => void
  onAmountChange: (amount: Amount) => void
  allowLight: boolean
  allowExtra: boolean
  extraPrice: number
  disabled?: boolean
}

function CondimentSection({
  label,
  items,
  selectedId,
  amount,
  onSelect,
  onAmountChange,
  allowLight,
  allowExtra,
  extraPrice,
  disabled,
}: CondimentSectionProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--site-text-muted)' }}>
        {label}
      </h3>

      {/* Selection */}
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const isSelected = item.id === selectedId
          const hasPrice = item.price > 0
          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(item)}
              className={`
                rounded-full border-2 px-4 py-2 text-sm font-medium transition-all
                ${isSelected
                  ? 'border-[var(--site-brand)] bg-[var(--site-brand)] text-[var(--site-text-on-brand)]'
                  : 'border-[var(--site-border)] bg-[var(--site-bg)] hover:border-[var(--site-brand)]/50'}
                ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
              `}
              style={!isSelected ? { color: 'var(--site-text)' } : undefined}
            >
              {item.displayName || item.name}
              {hasPrice && <span className="ml-1 opacity-75">+{formatCurrency(item.price)}</span>}
            </button>
          )
        })}
      </div>

      {/* Amount controls */}
      {selectedId && (
        <div className="flex flex-wrap gap-1.5">
          <AmountButton current={amount} value="none" label="None" onClick={onAmountChange} />
          {allowLight && (
            <AmountButton current={amount} value="light" label="Light" onClick={onAmountChange} />
          )}
          <AmountButton current={amount} value="regular" label="Regular" onClick={onAmountChange} />
          {allowExtra && (
            <AmountButton
              current={amount}
              value="extra"
              label={extraPrice > 0 ? `Extra +${formatCurrency(extraPrice)}` : 'Extra'}
              onClick={onAmountChange}
            />
          )}
        </div>
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
      className={`
        rounded-md border px-3 py-1 text-xs font-medium transition-all
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
