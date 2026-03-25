'use client'

import { useState, useCallback, useMemo } from 'react'
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

/** Full pizza builder state, to be passed to cart when "Add to Cart" is clicked */
export interface PizzaBuilderResult {
  sizeId: string
  crustId: string
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

  // --- State ---
  const [selectedSize, setSelectedSize] = useState<PizzaSize | null>(defaultSize)
  const [selectedCrust, setSelectedCrust] = useState<PizzaCrust | null>(defaultCrust)
  const [selectedSauce, setSelectedSauce] = useState<PizzaSauce | null>(defaultSauce)
  const [selectedCheese, setSelectedCheese] = useState<PizzaCheese | null>(defaultCheese)
  const [sauceAmount, setSauceAmount] = useState<Amount>(isSpecialty ? specialty.sauceAmount : 'regular')
  const [cheeseAmount, setCheeseAmount] = useState<Amount>(isSpecialty ? specialty.cheeseAmount : 'regular')
  const [sectionMode, setSectionMode] = useState<number>(config.defaultSections || 1)
  const [selectedToppings, setSelectedToppings] = useState<SelectedTopping[]>(() => {
    if (!isSpecialty) return []
    // Initialize from specialty defaults
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
    // Reset all topping placements to whole when mode changes
    const wholeSections = getSectionPreset(1, 0)
    setSelectedToppings((prev) =>
      prev.map((t) => ({ ...t, sections: wholeSections }))
    )
  }, [])

  // --- Price estimate input ---
  const priceInput: PizzaPriceInput | null = useMemo(() => {
    if (!selectedSize) return null
    return {
      sizeBasePrice: selectedSize.basePrice,
      sizeToppingMultiplier: selectedSize.toppingMultiplier,
      crustPrice: selectedCrust?.price ?? 0,
      saucePrice: selectedSauce?.price ?? 0,
      cheesePrice: selectedCheese?.price ?? 0,
      sauceAmount,
      cheeseAmount,
      sauceExtraPrice: selectedSauce?.extraPrice ?? 0,
      cheeseExtraPrice: selectedCheese?.extraPrice ?? 0,
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
    selectedSize, selectedCrust, selectedSauce, selectedCheese,
    sauceAmount, cheeseAmount, selectedToppings, config, toppings,
  ])

  // --- Validation ---
  const canComplete = !!selectedSize && !!selectedCrust

  const handleComplete = useCallback(() => {
    if (!selectedSize || !selectedCrust || !priceInput) return
    const estimate = calculatePizzaPriceEstimate(priceInput)
    onComplete({
      sizeId: selectedSize.id,
      crustId: selectedCrust.id,
      sauceId: selectedSauce?.id ?? null,
      cheeseId: selectedCheese?.id ?? null,
      sauceAmount,
      cheeseAmount,
      sectionMode,
      toppings: selectedToppings,
      estimatedTotal: estimate.totalPrice,
    })
  }, [
    selectedSize, selectedCrust, selectedSauce, selectedCheese,
    sauceAmount, cheeseAmount, sectionMode, selectedToppings, priceInput, onComplete,
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
        selectedSauceId={selectedSauce?.id ?? null}
        selectedCheeseId={selectedCheese?.id ?? null}
        sauceAmount={sauceAmount}
        cheeseAmount={cheeseAmount}
        onSauceSelect={(s) => setSelectedSauce(s)}
        onCheeseSelect={(c) => setSelectedCheese(c)}
        onSauceAmountChange={setSauceAmount}
        onCheeseAmountChange={setCheeseAmount}
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
        sauceName={selectedSauce ? (selectedSauce.displayName || selectedSauce.name) : null}
        cheeseName={selectedCheese ? (selectedCheese.displayName || selectedCheese.name) : null}
        sauceAmount={sauceAmount}
        cheeseAmount={cheeseAmount}
        toppings={selectedToppings}
        sectionMode={sectionMode}
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
          className={`
            flex-1 rounded-xl py-3 text-sm font-semibold transition-all min-h-[44px]
            ${canComplete
              ? 'bg-blue-500 text-white hover:bg-blue-600'
              : 'cursor-not-allowed opacity-40 bg-blue-500 text-white'}
          `}
        >
          Add to Order
        </button>
      </div>
    </div>
  )
}
