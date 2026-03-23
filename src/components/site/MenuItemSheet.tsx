'use client'

/**
 * MenuItemSheet — Item detail bottom sheet (mobile) / modal (desktop).
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

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

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

function ItemSkeleton() {
  return (
    <div className="animate-pulse">
      {/* Image placeholder */}
      <div
        className="w-full aspect-[16/10] rounded-xl"
        style={{ backgroundColor: 'var(--site-border)' }}
      />
      {/* Title */}
      <div className="mt-4 space-y-3">
        <div className="h-6 rounded-lg w-2/3" style={{ backgroundColor: 'var(--site-border)' }} />
        <div className="h-4 rounded-lg w-full" style={{ backgroundColor: 'var(--site-border)' }} />
        <div className="h-4 rounded-lg w-3/4" style={{ backgroundColor: 'var(--site-border)' }} />
      </div>
      {/* Modifier placeholders */}
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
}: {
  quantity: number
  onChange: (q: number) => void
}) {
  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, quantity - 1))}
        disabled={quantity <= 1}
        className="flex items-center justify-center rounded-full border-2 text-lg font-bold transition-all disabled:opacity-30"
        style={{
          width: 40,
          height: 40,
          borderColor: 'var(--site-border)',
          color: 'var(--site-text)',
        }}
      >
        −
      </button>
      <span
        className="text-lg font-semibold w-8 text-center"
        style={{ color: 'var(--site-text)' }}
      >
        {quantity}
      </span>
      <button
        type="button"
        onClick={() => onChange(quantity + 1)}
        className="flex items-center justify-center rounded-full border-2 text-lg font-bold transition-all"
        style={{
          width: 40,
          height: 40,
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

// ── Main component ────────────────────────────────────────────────────────────

export function MenuItemSheet({ itemId, slug, onClose, onAdd }: MenuItemSheetProps) {
  const [item, setItem] = useState<ItemDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [selections, setSelections] = useState<Map<string, SelectedModifier[]>>(new Map())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [PizzaBuilderComponent, setPizzaBuilderComponent] = useState<ComponentType<any> | null>(null)
  const [pizzaBuildResult, setPizzaBuildResult] = useState<PizzaBuilderResult | null>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
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
        .catch(() => {
          // Pizza builder not yet available — show standard modifiers instead
        })
    }
  }, [item?.itemType])

  // ── Lock body scroll while sheet is open ────────────────────────────────

  useEffect(() => {
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [])

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

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) {
      onClose()
    }
  }

  function handleAddToCart() {
    if (!item || !onAdd) return
    if (!areRequiredGroupsMet(selections, item.modifierGroups)) return

    // Flatten selections for cart
    const flatMods: Array<{ modifierId: string; name: string; price: number; quantity: number; preModifier: string | null }> = []
    for (const [, groupSels] of selections) {
      for (const sel of groupSels) {
        if (sel.isNoneSelection) continue
        flatMods.push({
          modifierId: sel.modifierId,
          name: sel.name,
          price: sel.price,
          quantity: sel.quantity,
          preModifier: sel.preModifier,
        })
      }
    }

    const total = calculateTotal(item.price, quantity, selections, item.modifierGroups)

    onAdd({
      menuItemId: item.id,
      name: item.name,
      price: total,
      quantity,
      modifiers: flatMods,
      pizzaConfig: item.itemType === 'pizza' ? pizzaBuildResult : undefined,
    })

    onClose()
  }

  const canAdd = item
    ? areRequiredGroupsMet(selections, item.modifierGroups) && item.stockStatus !== 'out_of_stock'
    : false

  const total = item
    ? calculateTotal(item.price, quantity, selections, item.modifierGroups)
    : 0

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[60] flex items-end md:items-center md:justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
    >
      <div
        ref={sheetRef}
        className="relative w-full max-h-[90vh] md:max-w-lg md:max-h-[85vh] md:rounded-2xl rounded-t-2xl overflow-hidden flex flex-col animate-in slide-in-from-bottom md:slide-in-from-bottom-4 md:zoom-in-95 duration-300"
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
          <div className="px-4 pb-4 md:px-6 md:pb-6">
            {loading && <ItemSkeleton />}
            {error && <ItemError onRetry={fetchItem} />}
            {!loading && !error && item && (
              <>
                {/* Item image */}
                {item.imageUrl && (
                  <div className="relative w-full aspect-[16/10] rounded-xl overflow-hidden -mx-4 md:-mx-6 mb-4" style={{ width: 'calc(100% + 2rem)' }}>
                    <Image
                      src={item.imageUrl}
                      alt={item.name}
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 100vw, 512px"
                      priority
                    />
                  </div>
                )}

                {/* Name + price */}
                <div className="flex items-start justify-between gap-3 mt-2">
                  <h2
                    className="text-xl font-bold"
                    style={{
                      fontFamily: 'var(--site-heading-font)',
                      fontWeight: 'var(--site-heading-weight)',
                      color: 'var(--site-text)',
                    }}
                  >
                    {item.name}
                  </h2>
                  <span
                    className="text-lg font-semibold shrink-0"
                    style={{ color: 'var(--site-brand)' }}
                  >
                    {formatPrice(item.price)}
                  </span>
                </div>

                {/* Description */}
                {item.description && (
                  <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--site-text-muted)' }}>
                    {item.description}
                  </p>
                )}

                {/* Stock status */}
                {item.stockStatus === 'out_of_stock' && (
                  <div
                    className="mt-3 rounded-lg px-3 py-2 text-sm font-medium"
                    style={{
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      color: '#ef4444',
                    }}
                  >
                    Currently unavailable
                  </div>
                )}
                {item.stockStatus === 'low_stock' && (
                  <div
                    className="mt-3 rounded-lg px-3 py-2 text-sm font-medium"
                    style={{
                      backgroundColor: 'rgba(245, 158, 11, 0.1)',
                      color: '#f59e0b',
                    }}
                  >
                    Limited availability
                  </div>
                )}

                {/* Allergens */}
                {item.allergens && item.allergens.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {item.allergens.map((a) => (
                      <AllergenBadge key={a} allergen={a} />
                    ))}
                  </div>
                )}

                {/* Divider */}
                <hr className="my-4" style={{ borderColor: 'var(--site-border)' }} />

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
                    onComplete={(result: PizzaBuilderResult) => setPizzaBuildResult(result)}
                    onCancel={onClose}
                  />
                ) : (
                  item.modifierGroups.map((group) => (
                    <ModifierGroupRenderer
                      key={group.id}
                      group={group}
                      selections={selections}
                      onSelectionChange={handleSelectionChange}
                    />
                  ))
                )}
              </>
            )}
          </div>
        </div>

        {/* Bottom bar: quantity + add to cart */}
        {!loading && !error && item && (
          <div
            className="shrink-0 border-t px-4 py-3 md:px-6"
            style={{ borderColor: 'var(--site-border)' }}
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
                  : `Add to Cart — ${formatPrice(total)}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
