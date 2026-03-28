'use client'

/**
 * MenuItemSheet — Item detail view.
 *
 * Two modes:
 *   inline=false (default): Bottom sheet (mobile) / modal overlay
 *   inline=true: Full-pane inline view for desktop split-screen layout
 *
 * Fetches item detail from the public API, renders image, description,
 * allergens, modifier groups (or pizza builder), quantity selector,
 * and an "Add to Cart" button showing the calculated total.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import { ModifierGroupRenderer } from './modifiers/ModifierGroupRenderer'
import type { ModifierGroupData, SelectedModifier } from './modifiers/modifier-types'
import { getModifierPrice } from './modifiers/modifier-types'
import { formatCurrency } from '@/lib/utils'
import type { PizzaBuilderResult } from './pizza/PizzaBuilder'

// Lazy-imported by conditional render
import type { ComponentType } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ItemDetail {
  id: string
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock'
  itemType: string
  allergens: string[] | null
  modifierGroups: ModifierGroupData[]
  // Pizza fields (present when itemType === 'pizza')
  pizzaConfig?: unknown
  pizzaSizes?: unknown[]
  pizzaCrusts?: unknown[]
  pizzaSauces?: unknown[]
  pizzaCheeses?: unknown[]
  pizzaToppings?: unknown[]
  pizzaSpecialty?: unknown
}

interface MenuItemSheetProps {
  itemId: string
  slug: string
  onClose: () => void
  /** When true, renders as full-pane inline view instead of modal overlay */
  inline?: boolean
  onAdd?: (item: {
    menuItemId: string
    name: string
    price: number
    quantity: number
    modifiers: Array<{ modifierId: string; name: string; price: number; quantity: number; preModifier: string | null }>
    specialInstructions?: string
    pizzaConfig?: unknown
  }) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Calculate total price from base price + all modifier selections (recursive) */
function calculateTotal(
  basePrice: number,
  quantity: number,
  selections: Map<string, SelectedModifier[]>,
  modifierGroups: ModifierGroupData[]
): number {
  let modTotal = 0

  for (const group of modifierGroups) {
    const groupSels = selections.get(group.id) ?? []
    for (const sel of groupSels) {
      if (sel.isNoneSelection) continue
      // Find the option data for this selection to get extraPrice etc.
      const option = group.options.find((o) => o.id === sel.modifierId)
      if (option) {
        modTotal += getModifierPrice(option, sel.preModifier, sel.quantity)
        // Add child modifier costs (recurse)
        if (sel.childSelections && option.childModifierGroup) {
          const childGroups = option.childModifierGroup ? [option.childModifierGroup] : []
          modTotal += calculateTotal(0, 1, sel.childSelections, childGroups)
        }
      }
    }
  }

  return (basePrice + modTotal) * quantity
}

/** Check if all required modifier groups are satisfied */
function areRequiredGroupsMet(
  selections: Map<string, SelectedModifier[]>,
  modifierGroups: ModifierGroupData[]
): boolean {
  for (const group of modifierGroups) {
    if (!group.isRequired) continue
    const groupSels = selections.get(group.id) ?? []
    const isNone = groupSels.some((s) => s.isNoneSelection)
    if (isNone && group.allowNone) continue
    const count = groupSels.filter((s) => !s.isNoneSelection).length
    if (count < group.minSelections) return false
  }
  return true
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function ItemSkeleton({ wide }: { wide?: boolean }) {
  return (
    <div className="animate-pulse">
      <div
        className={`w-full rounded-xl ${wide ? 'aspect-[3/1] max-h-64' : 'aspect-[16/10]'}`}
        style={{ backgroundColor: 'var(--site-border)' }}
      />
      <div className="mt-4 space-y-3">
        <div className="h-6 rounded-lg w-2/3" style={{ backgroundColor: 'var(--site-border)' }} />
        <div className="h-4 rounded-lg w-full" style={{ backgroundColor: 'var(--site-border)' }} />
        <div className="h-4 rounded-lg w-3/4" style={{ backgroundColor: 'var(--site-border)' }} />
      </div>
      <div className="mt-6 space-y-4">
        {[1, 2].map((i) => (
          <div key={i}>
            <div className="h-4 rounded w-1/3 mb-2" style={{ backgroundColor: 'var(--site-border)' }} />
            <div className="space-y-2">
              <div className="h-12 rounded-lg" style={{ backgroundColor: 'var(--site-border)' }} />
              <div className="h-12 rounded-lg" style={{ backgroundColor: 'var(--site-border)' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Error state ───────────────────────────────────────────────────────────────

function ItemError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <svg
        className="w-12 h-12"
        style={{ color: 'var(--site-text-muted)' }}
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
        />
      </svg>
      <p className="text-sm" style={{ color: 'var(--site-text-muted)' }}>
        Unable to load item details
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg px-6 py-2.5 text-sm font-medium transition-colors"
        style={{
          minHeight: 44,
          backgroundColor: 'var(--site-brand)',
          color: '#fff',
        }}
      >
        Try Again
      </button>
    </div>
  )
}

// ── Quantity selector ─────────────────────────────────────────────────────────

function QuantitySelector({
  quantity,
  onChange,
  large,
}: {
  quantity: number
  onChange: (q: number) => void
  large?: boolean
}) {
  const size = large ? 48 : 40
  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, quantity - 1))}
        disabled={quantity <= 1}
        className="flex items-center justify-center rounded-full border-2 text-lg font-bold transition-all disabled:opacity-30"
        style={{
          width: size,
          height: size,
          borderColor: 'var(--site-border)',
          color: 'var(--site-text)',
        }}
      >
        −
      </button>
      <span
        className={`${large ? 'text-xl' : 'text-lg'} font-semibold w-8 text-center`}
        style={{ color: 'var(--site-text)' }}
      >
        {quantity}
      </span>
      <button
        type="button"
        onClick={() => onChange(quantity + 1)}
        className="flex items-center justify-center rounded-full border-2 text-lg font-bold transition-all"
        style={{
          width: size,
          height: size,
          borderColor: 'var(--site-brand)',
          backgroundColor: 'var(--site-brand)',
          color: '#fff',
        }}
      >
        +
      </button>
    </div>
  )
}

// ── Allergen badge ────────────────────────────────────────────────────────────

function AllergenBadge({ allergen }: { allergen: string }) {
  return (
    <span
      className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide"
      style={{
        backgroundColor: 'rgba(var(--site-brand-rgb), 0.08)',
        color: 'var(--site-brand)',
      }}
    >
      {allergen}
    </span>
  )
}

// ── Shared item content ─────────────────────────────────────────────────────

interface ItemContentProps {
  item: ItemDetail
  inline: boolean
   
  PizzaBuilderComponent: ComponentType<any> | null
  selections: Map<string, SelectedModifier[]>
  onSelectionChange: (groupId: string, sels: SelectedModifier[]) => void
  specialInstructions: string
  onSpecialInstructionsChange: (v: string) => void
  onPizzaComplete: (result: PizzaBuilderResult) => void
  onPizzaPriceChange: (price: number) => void
  onClose: () => void
}

function ItemContent({
  item,
  inline,
  PizzaBuilderComponent,
  selections,
  onSelectionChange,
  specialInstructions,
  onSpecialInstructionsChange,
  onPizzaComplete,
  onPizzaPriceChange,
  onClose,
}: ItemContentProps) {
  return (
    <>
      {/* Item image */}
      {item.imageUrl ? (
        <div className={`relative w-full ${inline ? 'h-48 lg:h-56 xl:h-64 rounded-xl overflow-hidden' : 'h-48 sm:h-56'}`}>
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            className="object-cover"
            sizes={inline ? '(max-width: 1024px) 100vw, 60vw' : '(max-width: 768px) 100vw, 512px'}
            priority
          />
        </div>
      ) : (
        <div
          className={`flex items-center justify-center ${inline ? 'h-32 lg:h-40 rounded-xl' : 'h-32'}`}
          style={{
            background: 'linear-gradient(135deg, var(--site-border) 0%, rgba(0,0,0,0.06) 100%)',
          }}
        >
          <span className="text-5xl opacity-20">
            {item.itemType === 'pizza' ? '🍕' : '🍽️'}
          </span>
        </div>
      )}

      {/* Header: name + price */}
      <div
        className={`flex items-start justify-between gap-3 ${inline ? 'pt-5 pb-4' : 'px-4 pt-4 pb-3 md:px-6'} border-b`}
        style={{ borderColor: 'var(--site-border)' }}
      >
        <div className="min-w-0">
          <h2
            className={`font-bold ${inline ? 'text-2xl' : 'text-xl'}`}
            style={{
              fontFamily: 'var(--site-heading-font)',
              fontWeight: 'var(--site-heading-weight)',
              color: 'var(--site-text)',
            }}
          >
            {item.name}
          </h2>
          {item.description && (
            <p className={`mt-1 leading-relaxed ${inline ? 'text-base' : 'text-sm'}`} style={{ color: 'var(--site-text-muted)' }}>
              {item.description}
            </p>
          )}
        </div>
        <span
          className={`font-semibold shrink-0 ${inline ? 'text-xl' : 'text-lg'}`}
          style={{ color: 'var(--site-brand)' }}
        >
          {formatCurrency(item.price)}
        </span>
      </div>

      {/* Body content */}
      <div className={inline ? 'py-4' : 'px-4 py-4 md:px-6'}>
        {/* Stock status */}
        {item.stockStatus === 'out_of_stock' && (
          <div
            className="mb-3 rounded-lg px-3 py-2 text-sm font-medium"
            style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}
          >
            Currently unavailable
          </div>
        )}
        {item.stockStatus === 'low_stock' && (
          <div
            className="mb-3 rounded-lg px-3 py-2 text-sm font-medium"
            style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }}
          >
            Limited availability
          </div>
        )}

        {/* Allergens */}
        {item.allergens && item.allergens.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {item.allergens.map((a) => (
              <AllergenBadge key={a} allergen={a} />
            ))}
          </div>
        )}

        {/* Pizza builder or standard modifiers */}
        {item.itemType === 'pizza' && PizzaBuilderComponent && item.pizzaConfig ? (
          <PizzaBuilderComponent
            config={item.pizzaConfig}
            sizes={item.pizzaSizes ?? []}
            crusts={item.pizzaCrusts ?? []}
            sauces={item.pizzaSauces ?? []}
            cheeses={item.pizzaCheeses ?? []}
            toppings={item.pizzaToppings ?? []}
            specialty={item.pizzaSpecialty ?? null}
            onComplete={onPizzaComplete}
            onCancel={onClose}
            onPriceChange={onPizzaPriceChange}
            wide={inline}
          />
        ) : (
          item.modifierGroups.map((group) => (
            <ModifierGroupRenderer
              key={group.id}
              group={group}
              selections={selections}
              onSelectionChange={onSelectionChange}
            />
          ))
        )}
      </div>

      {/* Special Instructions */}
      <div className={`py-3 border-t ${inline ? '' : 'px-4'}`} style={{ borderColor: 'var(--site-border)' }}>
        <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--site-text-secondary)' }}>
          Special Instructions
        </label>
        <textarea
          value={specialInstructions}
          onChange={(e) => onSpecialInstructionsChange(e.target.value)}
          placeholder="Any special requests? (allergies, preferences...)"
          maxLength={200}
          rows={2}
          className="w-full mt-2 px-3 py-2 rounded-lg border text-sm resize-none"
          style={{ borderColor: 'var(--site-border)', backgroundColor: 'var(--site-surface)' }}
        />
      </div>
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function MenuItemSheet({ itemId, slug, onClose, onAdd, inline = false }: MenuItemSheetProps) {
  const [item, setItem] = useState<ItemDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [selections, setSelections] = useState<Map<string, SelectedModifier[]>>(new Map())
   
  const [PizzaBuilderComponent, setPizzaBuilderComponent] = useState<ComponentType<any> | null>(null)
  const [pizzaBuildResult, setPizzaBuildResult] = useState<PizzaBuilderResult | null>(null)
  const [pizzaTotal, setPizzaTotal] = useState<number | null>(null)
  const [specialInstructions, setSpecialInstructions] = useState('')
  const sheetRef = useRef<HTMLDivElement>(null)

  // ── Fetch item detail ───────────────────────────────────────────────────

  const fetchItem = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(`/api/online/menu/${itemId}?slug=${encodeURIComponent(slug)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const data = json.data as ItemDetail
      setItem(data)

      // Pre-select default modifiers
      const defaultSelections = new Map<string, SelectedModifier[]>()
      for (const group of data.modifierGroups) {
        const defaults = group.options
          .filter((o) => o.isDefault)
          .map((o): SelectedModifier => ({
            modifierId: o.id,
            name: o.name,
            price: o.price,
            quantity: 1,
            preModifier: null,
            depth: 0,
            childSelections: o.childModifierGroup ? new Map() : undefined,
          }))
        if (defaults.length > 0) {
          defaultSelections.set(group.id, defaults)
        }
      }
      setSelections(defaultSelections)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [itemId, slug])

  useEffect(() => {
    fetchItem()
  }, [fetchItem])

  // ── Load PizzaBuilder dynamically when needed ───────────────────────────

  useEffect(() => {
    if (item?.itemType === 'pizza') {
      import('@/components/site/pizza/PizzaBuilder')
        .then((mod) => setPizzaBuilderComponent(() => mod.PizzaBuilder))
        .catch(err => {
          console.warn('pizza builder lazy load failed:', err)
        })
    }
  }, [item?.itemType])

  // ── Lock body scroll while sheet is open (modal mode only) ────────────

  useEffect(() => {
    if (inline) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [inline])

  // ── Escape key to close ─────────────────────────────────────────────────

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // ── Handlers ────────────────────────────────────────────────────────────

  function handleSelectionChange(groupId: string, groupSelections: SelectedModifier[]) {
    setSelections((prev) => {
      const next = new Map(prev)
      if (groupSelections.length === 0) {
        next.delete(groupId)
      } else {
        next.set(groupId, groupSelections)
      }
      return next
    })
  }

  function flattenSelections(sels: Map<string, SelectedModifier[]>): Array<{ modifierId: string; name: string; price: number; quantity: number; preModifier: string | null }> {
    const result: Array<{ modifierId: string; name: string; price: number; quantity: number; preModifier: string | null }> = []
    for (const [, groupSels] of sels) {
      for (const sel of groupSels) {
        if (sel.isNoneSelection) continue
        if (sel.isCustomEntry) {
          result.push({ modifierId: '', name: sel.customEntryText || 'Custom', price: 0, quantity: 1, preModifier: null })
          continue
        }
        result.push({
          modifierId: sel.modifierId,
          name: sel.name,
          price: getModifierPrice(
            { price: sel.price, extraPrice: 0 } as Parameters<typeof getModifierPrice>[0],
            sel.preModifier,
            sel.quantity || 1,
          ),
          quantity: sel.quantity || 1,
          preModifier: sel.preModifier || null,
        })
        // Recurse into child selections
        if (sel.childSelections && sel.childSelections.size > 0) {
          result.push(...flattenSelections(sel.childSelections))
        }
      }
    }
    return result
  }

  function handleAddToCart() {
    if (!item || !onAdd) return
    if (!areRequiredGroupsMet(selections, item.modifierGroups)) return

    const flatMods = flattenSelections(selections)

    const isPizza = item.itemType === 'pizza' && pizzaTotal != null
    const finalTotal = isPizza ? pizzaTotal * quantity : calculateTotal(item.price, quantity, selections, item.modifierGroups)

    onAdd({
      menuItemId: item.id,
      name: item.name,
      price: finalTotal,
      quantity,
      modifiers: flatMods,
      specialInstructions: specialInstructions.trim() || undefined,
      pizzaConfig: item.itemType === 'pizza' ? pizzaBuildResult : undefined,
    })

    onClose()
  }

  const canAdd = item
    ? areRequiredGroupsMet(selections, item.modifierGroups) && item.stockStatus !== 'out_of_stock'
    : false

  const isPizza = item?.itemType === 'pizza' && pizzaTotal != null
  const total = item
    ? isPizza ? pizzaTotal * quantity : calculateTotal(item.price, quantity, selections, item.modifierGroups)
    : 0

  // ── Inline render (desktop full-pane) ─────────────────────────────────

  if (inline) {
    return (
      <div className="flex flex-col h-full">
        {/* Back button */}
        <div className="shrink-0 px-6 lg:px-8 pt-4 pb-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 text-sm font-medium transition-colors hover:opacity-80"
            style={{ color: 'var(--site-brand)' }}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back to Menu
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 lg:px-8 pb-4">
          {loading && <ItemSkeleton wide />}
          {error && <ItemError onRetry={fetchItem} />}
          {!loading && !error && item && (
            <ItemContent
              item={item}
              inline
              PizzaBuilderComponent={PizzaBuilderComponent}
              selections={selections}
              onSelectionChange={handleSelectionChange}
              specialInstructions={specialInstructions}
              onSpecialInstructionsChange={setSpecialInstructions}
              onPizzaComplete={(result) => setPizzaBuildResult(result)}
              onPizzaPriceChange={(price) => setPizzaTotal(price)}
              onClose={onClose}
            />
          )}
        </div>

        {/* Sticky footer: quantity + add to cart */}
        {!loading && !error && item && (
          <div
            className="shrink-0 border-t px-6 lg:px-8 py-4"
            style={{
              borderColor: 'var(--site-border)',
              backgroundColor: 'var(--site-bg)',
            }}
          >
            <div className="flex items-center gap-6 max-w-2xl">
              <QuantitySelector quantity={quantity} onChange={setQuantity} large />
              <button
                type="button"
                onClick={handleAddToCart}
                disabled={!canAdd}
                className="flex-1 rounded-xl py-4 text-base font-bold transition-all disabled:opacity-40"
                style={{
                  minHeight: 56,
                  backgroundColor: 'var(--site-brand)',
                  color: '#fff',
                }}
              >
                {item.stockStatus === 'out_of_stock'
                  ? 'Unavailable'
                  : `Add to Order — ${formatCurrency(total)}`}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Modal/sheet render (mobile) ───────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Backdrop overlay */}
      <div
        className="absolute inset-0 backdrop-blur-sm"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
        onClick={onClose}
      />

      {/* Sheet positioning: bottom-sheet on mobile, centered modal on desktop */}
      <div className="absolute inset-x-0 bottom-0 md:inset-0 md:flex md:items-center md:justify-center md:p-4">
        <div
          ref={sheetRef}
          className="relative w-full md:max-w-lg max-h-[90vh] md:max-h-[85vh] rounded-t-2xl md:rounded-2xl overflow-hidden flex flex-col shadow-2xl animate-in slide-in-from-bottom md:slide-in-from-bottom-4 md:zoom-in-95 duration-300"
          style={{ backgroundColor: 'var(--site-bg)' }}
          role="dialog"
          aria-modal="true"
          aria-label={item?.name ?? 'Item details'}
        >
          {/* Drag handle (mobile) */}
          <div className="md:hidden flex justify-center pt-3 pb-1">
            <div
              className="w-10 h-1 rounded-full"
              style={{ backgroundColor: 'var(--site-border)' }}
            />
          </div>

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 z-10 flex items-center justify-center rounded-full backdrop-blur-sm transition-colors"
            style={{
              width: 36,
              height: 36,
              backgroundColor: 'rgba(0, 0, 0, 0.4)',
              color: '#fff',
            }}
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {loading && (
              <div className="px-4 pb-4 md:px-6 md:pb-6">
                <ItemSkeleton />
              </div>
            )}
            {error && (
              <div className="px-4 pb-4 md:px-6 md:pb-6">
                <ItemError onRetry={fetchItem} />
              </div>
            )}
            {!loading && !error && item && (
              <ItemContent
                item={item}
                inline={false}
                PizzaBuilderComponent={PizzaBuilderComponent}
                selections={selections}
                onSelectionChange={handleSelectionChange}
                specialInstructions={specialInstructions}
                onSpecialInstructionsChange={setSpecialInstructions}
                onPizzaComplete={(result) => setPizzaBuildResult(result)}
                onPizzaPriceChange={(price) => setPizzaTotal(price)}
                onClose={onClose}
              />
            )}
          </div>

          {/* Fixed footer: quantity + add to cart */}
          {!loading && !error && item && (
            <div
              className="shrink-0 border-t px-4 py-3 md:px-6"
              style={{
                borderColor: 'var(--site-border)',
                backgroundColor: 'var(--site-bg)',
              }}
            >
              <div className="flex items-center gap-4">
                <QuantitySelector quantity={quantity} onChange={setQuantity} />
                <button
                  type="button"
                  onClick={handleAddToCart}
                  disabled={!canAdd}
                  className="flex-1 rounded-xl py-3.5 text-sm font-bold transition-all disabled:opacity-40"
                  style={{
                    minHeight: 48,
                    backgroundColor: 'var(--site-brand)',
                    color: '#fff',
                  }}
                >
                  {item.stockStatus === 'out_of_stock'
                    ? 'Unavailable'
                    : `Add to Cart — ${formatCurrency(total)}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
