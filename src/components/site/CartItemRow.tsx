'use client'

import { useState, useEffect } from 'react'
import { formatCurrency } from '@/lib/utils'
import { humanizeSections } from '@/lib/pizza-section-utils'
import type { CartItem, CartModifier } from '@/stores/site-cart-store'
import { useSiteCartStore } from '@/stores/site-cart-store'
import { flattenModifierPrice } from '@/stores/site-cart-store'

interface CartItemRowProps {
  item: CartItem
}

/** Format a pre-modifier label like "No onions", "Extra cheese (+$1.50)" */
function formatPreMod(mod: CartModifier): string {
  const prefix = mod.preModifier
    ? mod.preModifier.charAt(0).toUpperCase() + mod.preModifier.slice(1)
    : ''
  const priceStr =
    mod.preModifier !== 'no' && mod.price > 0
      ? ` (+${formatCurrency(mod.price * mod.quantity)})`
      : ''

  if (prefix && prefix !== 'Regular') {
    return `${prefix} ${mod.name}${priceStr}`
  }
  return `${mod.name}${priceStr}`
}

/** Recursively render modifier lines */
function renderModifiers(modifiers: CartModifier[], depth = 0): React.ReactNode[] {
  const lines: React.ReactNode[] = []
  for (const mod of modifiers) {
    if (mod.isNoneSelection) continue
    const indent = depth > 0 ? { paddingLeft: `${depth * 12}px` } : undefined
    lines.push(
      <div
        key={`${mod.modifierId}-${mod.preModifier}-${depth}`}
        className="text-xs opacity-70"
        style={{ ...indent, color: 'var(--site-text-muted)' }}
      >
        {mod.isCustomEntry ? mod.customEntryText || mod.name : formatPreMod(mod)}
      </div>
    )
    if (mod.childSelections?.length) {
      lines.push(...renderModifiers(mod.childSelections, depth + 1))
    }
  }
  return lines
}

/** Render pizza-specific details: size, crust, and per-section toppings */
function renderPizzaDetails(item: CartItem): React.ReactNode {
  const pd = item.pizzaData
  if (!pd) return null

  // Group toppings by section label
  const sectionGroups = new Map<string, string[]>()
  for (const t of pd.toppings) {
    const label = humanizeSections(t.sections, pd.sectionMode)
    const existing = sectionGroups.get(label) || []
    const toppingLabel = t.amount === 'extra' ? `${t.name} (extra)` : t.name
    existing.push(toppingLabel)
    sectionGroups.set(label, existing)
  }

  return (
    <div className="mt-1 space-y-0.5">
      <div className="text-xs opacity-70" style={{ color: 'var(--site-text-muted)' }}>
        {pd.sizeName} &middot; {pd.crustName}
      </div>
      {pd.sauceAmount !== 'none' && pd.sauceId && (
        <div className="text-xs opacity-70" style={{ color: 'var(--site-text-muted)' }}>
          Sauce: {pd.sauceAmount !== 'regular' ? `${pd.sauceAmount} ` : ''}
          {pd.saucePrice > 0 ? `(+${formatCurrency(pd.saucePrice)})` : ''}
        </div>
      )}
      {pd.cheeseAmount !== 'none' && pd.cheeseId && (
        <div className="text-xs opacity-70" style={{ color: 'var(--site-text-muted)' }}>
          Cheese: {pd.cheeseAmount !== 'regular' ? `${pd.cheeseAmount} ` : ''}
          {pd.cheesePrice > 0 ? `(+${formatCurrency(pd.cheesePrice)})` : ''}
        </div>
      )}
      {Array.from(sectionGroups.entries()).map(([label, toppings]) => (
        <div
          key={label}
          className="text-xs opacity-70"
          style={{ color: 'var(--site-text-muted)', paddingLeft: '4px' }}
        >
          {label !== 'Whole' && <span className="font-medium">{label}: </span>}
          {toppings.join(', ')}
        </div>
      ))}
    </div>
  )
}

export function CartItemRow({ item }: CartItemRowProps) {
  const [mounted, setMounted] = useState(false)
  const updateQuantity = useSiteCartStore((s) => s.updateQuantity)
  const removeItem = useSiteCartStore((s) => s.removeItem)

  useEffect(() => setMounted(true), [])

  if (!mounted) return null

  // Calculate line total
  let lineTotal: number
  if (item.pizzaData) {
    const pd = item.pizzaData
    lineTotal =
      (pd.sizePrice + pd.crustPrice + pd.saucePrice + pd.cheesePrice + pd.toppingsPrice) *
      item.quantity
  } else {
    lineTotal = (item.basePrice + flattenModifierPrice(item.modifiers)) * item.quantity
  }

  return (
    <div
      className="py-3 border-b last:border-b-0"
      style={{ borderColor: 'var(--site-border)' }}
    >
      <div className="flex items-start justify-between gap-2">
        {/* Left: name + details */}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm" style={{ color: 'var(--site-text)' }}>
            {item.name}
          </div>

          {/* Standard modifiers */}
          {item.itemType !== 'pizza' && item.modifiers.length > 0 && (
            <div className="mt-1 space-y-0.5">{renderModifiers(item.modifiers)}</div>
          )}

          {/* Pizza details */}
          {item.itemType === 'pizza' && renderPizzaDetails(item)}

          {/* Special instructions */}
          {item.specialInstructions && (
            <div
              className="mt-1 text-xs italic"
              style={{ color: 'var(--site-text-muted)' }}
            >
              {item.specialInstructions}
            </div>
          )}
        </div>

        {/* Right: price + remove */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-sm font-semibold" style={{ color: 'var(--site-text)' }}>
            {formatCurrency(lineTotal)}
          </span>
          <button
            onClick={() => removeItem(item.id)}
            className="p-1 rounded transition-colors hover:opacity-70"
            style={{ color: 'var(--site-text-muted)' }}
            aria-label={`Remove ${item.name}`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
          </button>
        </div>
      </div>

      {/* Quantity controls */}
      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={() => updateQuantity(item.id, item.quantity - 1)}
          className="flex items-center justify-center w-8 h-8 rounded-full border transition-colors hover:opacity-80"
          style={{
            borderColor: 'var(--site-border)',
            color: 'var(--site-text)',
            backgroundColor: 'var(--site-surface)',
          }}
          aria-label="Decrease quantity"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
          </svg>
        </button>
        <span className="text-sm font-medium w-6 text-center" style={{ color: 'var(--site-text)' }}>
          {item.quantity}
        </span>
        <button
          onClick={() => updateQuantity(item.id, item.quantity + 1)}
          className="flex items-center justify-center w-8 h-8 rounded-full border transition-colors hover:opacity-80"
          style={{
            borderColor: 'var(--site-border)',
            color: 'var(--site-text)',
            backgroundColor: 'var(--site-surface)',
          }}
          aria-label="Increase quantity"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      </div>
    </div>
  )
}
