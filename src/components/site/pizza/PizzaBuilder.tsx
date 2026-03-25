'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import type {
  PizzaConfig,
  PizzaSize,
  PizzaCrust,
  PizzaSauce,
  PizzaCheese,
  PizzaTopping,
  PizzaSpecialty,
} from '@/types'
import { getSectionPreset } from '@/lib/pizza-section-utils'
import { calculatePizzaPriceEstimate, type PizzaPriceInput } from '@/lib/pizza-price-utils'
import { SizeSelector } from './SizeSelector'
import { CrustSelector } from './CrustSelector'
import { SectionSelector } from './SectionSelector'
import { SauceCheesePanel } from './SauceCheesePanel'
import { ToppingGrid } from './ToppingGrid'
import { PizzaSummary } from './PizzaSummary'

type Amount = 'none' | 'light' | 'regular' | 'extra'

interface SelectedTopping {
  toppingId: string
  name: string
  sections: number[]
  amount: 'regular' | 'extra'
  price: number
  basePrice: number
}

/** Per-section condiment selection (sauce or cheese) */
export interface CondimentSelection {
  id: string
  amount: Amount
  sections: number[]  // which sections this applies to
}

/** Full pizza builder state, to be passed to cart when "Add to Cart" is clicked */
export interface PizzaBuilderResult {
  sizeId: string
  crustId: string
  sauceSelections: CondimentSelection[]
  cheeseSelections: CondimentSelection[]
  // Legacy single sauce/cheese fields for backward compat
  sauceId: string | null
  cheeseId: string | null
  sauceAmount: Amount
  cheeseAmount: Amount
  sectionMode: number
  toppings: SelectedTopping[]
  estimatedTotal: number
}

interface PizzaBuilderProps {
  config: PizzaConfig
  sizes: PizzaSize[]
  crusts: PizzaCrust[]
  sauces: PizzaSauce[]
  cheeses: PizzaCheese[]
  toppings: PizzaTopping[]
  /** If present, this is a specialty pizza with preset defaults and editability controls */
  specialty?: PizzaSpecialty | null
  /** Called when customer confirms their pizza build. Wired to cart in Phase C. */
  onComplete: (result: PizzaBuilderResult) => void
  /** Called when customer cancels / goes back */
  onCancel: () => void
  /** Called whenever the estimated total changes (for parent to update "Add to Cart" button) */
  onPriceChange?: (total: number) => void
}

export function PizzaBuilder({
  config,
  sizes,
  crusts,
  sauces,
  cheeses,
  toppings,
  specialty,
  onComplete,
  onCancel,
  onPriceChange,
}: PizzaBuilderProps) {
  const isSpecialty = !!specialty

  // --- Resolve defaults ---
  const defaultSize = sizes.find((s) => s.isDefault && s.isActive) || sizes.find((s) => s.isActive) || null
  const defaultCrust = isSpecialty && specialty.defaultCrustId
    ? crusts.find((c) => c.id === specialty.defaultCrustId) ?? null
    : crusts.find((c) => c.isDefault && c.isActive) || crusts.find((c) => c.isActive) || null
  const defaultSauce = isSpecialty && specialty.defaultSauceId
    ? sauces.find((s) => s.id === specialty.defaultSauceId) ?? null
    : sauces.find((s) => s.isDefault && s.isActive) || sauces.find((s) => s.isActive) || null
  const defaultCheese = isSpecialty && specialty.defaultCheeseId
    ? cheeses.find((c) => c.id === specialty.defaultCheeseId) ?? null
    : cheeses.find((c) => c.isDefault && c.isActive) || cheeses.find((c) => c.isActive) || null

  const allowCondimentSections = config.allowCondimentSections ?? false

  // --- State ---
  const [selectedSize, setSelectedSize] = useState<PizzaSize | null>(defaultSize)
  const [selectedCrust, setSelectedCrust] = useState<PizzaCrust | null>(defaultCrust)
  const [sectionMode, setSectionMode] = useState<number>(config.defaultSections || 1)

  // Per-section sauce/cheese selections
  const wholeSections = useMemo(() => getSectionPreset(1, 0), [])
  const [sauceSelections, setSauceSelections] = useState<CondimentSelection[]>(() => {
    if (!defaultSauce) return []
    const defaultAmount: Amount = isSpecialty ? specialty.sauceAmount : 'regular'
    return [{ id: defaultSauce.id, amount: defaultAmount, sections: getSectionPreset(1, 0) }]
  })
  const [cheeseSelections, setCheeseSelections] = useState<CondimentSelection[]>(() => {
    if (!defaultCheese) return []
    const defaultAmount: Amount = isSpecialty ? specialty.cheeseAmount : 'regular'
    return [{ id: defaultCheese.id, amount: defaultAmount, sections: getSectionPreset(1, 0) }]
  })

  const [selectedToppings, setSelectedToppings] = useState<SelectedTopping[]>(() => {
    if (!isSpecialty) return []
    return specialty.toppings.map((t) => {
      const toppingDef = toppings.find((td) => td.id === t.toppingId)
      return {
        toppingId: t.toppingId,
        name: t.name,
        sections: t.sections,
        amount: t.amount === 'light' ? 'regular' : t.amount,
        price: toppingDef?.price ?? 0,
        basePrice: toppingDef?.price ?? 0,
      }
    })
  })

  // --- Derived: primary sauce/cheese for pricing & summary ---
  const primarySauce = sauceSelections.length > 0
    ? sauces.find((s) => s.id === sauceSelections[0].id) ?? null
    : null
  const primaryCheese = cheeseSelections.length > 0
    ? cheeses.find((c) => c.id === cheeseSelections[0].id) ?? null
    : null
  const primarySauceAmount = sauceSelections[0]?.amount ?? 'regular'
  const primaryCheeseAmount = cheeseSelections[0]?.amount ?? 'regular'

  // --- Handlers ---
  const handleAddTopping = useCallback((topping: SelectedTopping) => {
    setSelectedToppings((prev) => [...prev, topping])
  }, [])

  const handleRemoveTopping = useCallback((toppingId: string) => {
    setSelectedToppings((prev) => prev.filter((t) => t.toppingId !== toppingId))
  }, [])

  const handleUpdateTopping = useCallback(
    (toppingId: string, updates: Partial<Pick<SelectedTopping, 'sections' | 'amount'>>) => {
      setSelectedToppings((prev) =>
        prev.map((t) => (t.toppingId === toppingId ? { ...t, ...updates } : t))
      )
    },
    []
  )

  const handleSectionModeChange = useCallback((mode: number) => {
    setSectionMode(mode)
    const whole = getSectionPreset(1, 0)
    setSelectedToppings((prev) =>
      prev.map((t) => ({ ...t, sections: whole }))
    )
    // Reset condiment section placements when mode changes
    if (mode === 1 || !allowCondimentSections) {
      setSauceSelections((prev) => prev.map((s) => ({ ...s, sections: whole })))
      setCheeseSelections((prev) => prev.map((c) => ({ ...c, sections: whole })))
    }
  }, [allowCondimentSections])

  // --- Price estimate input ---
  const priceInput: PizzaPriceInput | null = useMemo(() => {
    if (!selectedSize) return null
    return {
      sizeBasePrice: selectedSize.basePrice,
      sizeToppingMultiplier: selectedSize.toppingMultiplier,
      crustPrice: selectedCrust?.price ?? 0,
      saucePrice: primarySauce?.price ?? 0,
      cheesePrice: primaryCheese?.price ?? 0,
      sauceAmount: primarySauceAmount,
      cheeseAmount: primaryCheeseAmount,
      sauceExtraPrice: primarySauce?.extraPrice ?? 0,
      cheeseExtraPrice: primaryCheese?.extraPrice ?? 0,
      toppings: selectedToppings.map((t) => ({
        price: t.basePrice,
        extraPrice: toppings.find((td) => td.id === t.toppingId)?.extraPrice ?? undefined,
        sections: t.sections,
        amount: t.amount,
      })),
      pricingMode: config.pricingMode,
      freeToppingsCount: config.freeToppingsEnabled
        ? config.freeToppingsMode === 'per_size' && selectedSize
          ? selectedSize.freeToppings
          : config.freeToppingsCount
        : 0,
      freeToppingsMode: config.freeToppingsMode,
    }
  }, [
    selectedSize, selectedCrust, primarySauce, primaryCheese,
    primarySauceAmount, primaryCheeseAmount, selectedToppings, config, toppings,
  ])

  // --- FIX 3: Report price changes to parent ---
  useEffect(() => {
    if (!priceInput || !onPriceChange) return
    const estimate = calculatePizzaPriceEstimate(priceInput)
    onPriceChange(estimate.totalPrice)
  }, [priceInput, onPriceChange])

  // --- Validation ---
  const canComplete = !!selectedSize && !!selectedCrust

  const handleComplete = useCallback(() => {
    if (!selectedSize || !selectedCrust || !priceInput) return
    const estimate = calculatePizzaPriceEstimate(priceInput)
    onComplete({
      sizeId: selectedSize.id,
      crustId: selectedCrust.id,
      sauceSelections,
      cheeseSelections,
      sauceId: sauceSelections[0]?.id ?? null,
      cheeseId: cheeseSelections[0]?.id ?? null,
      sauceAmount: primarySauceAmount,
      cheeseAmount: primaryCheeseAmount,
      sectionMode,
      toppings: selectedToppings,
      estimatedTotal: estimate.totalPrice,
    })
  }, [
    selectedSize, selectedCrust, sauceSelections, cheeseSelections,
    primarySauceAmount, primaryCheeseAmount, sectionMode, selectedToppings, priceInput, onComplete,
  ])

  // --- Specialty editability ---
  const sizeDisabled = isSpecialty && !specialty.allowSizeChange
  const crustDisabled = isSpecialty && !specialty.allowCrustChange
  const sauceDisabled = isSpecialty && !specialty.allowSauceChange
  const cheeseDisabled = isSpecialty && !specialty.allowCheeseChange
  const toppingsDisabled = isSpecialty && !specialty.allowToppingMods

  return (
    <div className="divide-y divide-gray-100">
      {/* Size */}
      <SizeSelector
        sizes={sizes}
        selectedId={selectedSize?.id ?? null}
        onSelect={setSelectedSize}
        disabled={sizeDisabled}
      />

      {/* Crust */}
      <CrustSelector
        crusts={crusts}
        selectedId={selectedCrust?.id ?? null}
        onSelect={setSelectedCrust}
        disabled={crustDisabled}
      />

      {/* Section mode */}
      <SectionSelector
        sectionOptions={config.sectionOptions}
        selectedMode={sectionMode}
        onModeChange={handleSectionModeChange}
      />

      {/* Sauce & Cheese */}
      <SauceCheesePanel
        sauces={sauces}
        cheeses={cheeses}
        sauceSelections={sauceSelections}
        cheeseSelections={cheeseSelections}
        onSauceChange={setSauceSelections}
        onCheeseChange={setCheeseSelections}
        allowCondimentSections={allowCondimentSections}
        condimentDivisionMax={config.condimentDivisionMax ?? 2}
        sectionMode={sectionMode}
        sauceDisabled={sauceDisabled}
        cheeseDisabled={cheeseDisabled}
      />

      {/* Toppings */}
      <ToppingGrid
        toppings={toppings}
        selectedToppings={selectedToppings}
        sectionMode={sectionMode}
        sizeToppingMultiplier={selectedSize?.toppingMultiplier ?? 1}
        onAdd={handleAddTopping}
        onRemove={handleRemoveTopping}
        onUpdate={handleUpdateTopping}
        disabled={toppingsDisabled}
      />

      {/* Summary with running price estimate */}
      <PizzaSummary
        sizeName={selectedSize ? (selectedSize.displayName || selectedSize.name) : null}
        crustName={selectedCrust ? (selectedCrust.displayName || selectedCrust.name) : null}
        sauceName={primarySauce ? (primarySauce.displayName || primarySauce.name) : null}
        cheeseName={primaryCheese ? (primaryCheese.displayName || primaryCheese.name) : null}
        sauceAmount={primarySauceAmount}
        cheeseAmount={primaryCheeseAmount}
        sauceSelections={sauceSelections}
        cheeseSelections={cheeseSelections}
        sauces={sauces}
        cheeses={cheeses}
        allowCondimentSections={allowCondimentSections}
        sectionMode={sectionMode}
        toppings={selectedToppings}
        priceInput={priceInput}
      />

      {/* Actions */}
      <div className="flex gap-3 py-4">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl border-2 border-gray-200 py-3 text-sm font-semibold text-gray-700 transition-all hover:border-gray-300 min-h-[44px]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleComplete}
          disabled={!canComplete}
          className={`flex-1 rounded-xl py-3 text-sm font-semibold text-white transition-all min-h-[44px] ${!canComplete ? 'cursor-not-allowed opacity-40' : ''}`}
          style={{ backgroundColor: 'var(--site-brand)' }}
        >
          Add to Order
        </button>
      </div>
    </div>
  )
}
