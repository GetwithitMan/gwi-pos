'use client'

import { useState, useCallback, useMemo } from 'react'
import type {
  PizzaConfig,
  PizzaSize,
  PizzaCrust,
  PizzaSauce,
  PizzaCheese,
  PizzaTopping,
  PizzaToppingSelection,
  PizzaOrderConfig,
} from '@/types'

// Section amount types
export type SauceCheeseAmount = 'none' | 'light' | 'regular' | 'extra'
export type ToppingAmount = 'light' | 'regular' | 'extra'

// Sauce/Cheese selection with sections
export interface SauceSelection {
  sauceId: string
  name: string
  sections: number[]
  amount: SauceCheeseAmount
  price: number
}

export interface CheeseSelection {
  cheeseId: string
  name: string
  sections: number[]
  amount: SauceCheeseAmount
  price: number
}

export interface PizzaBuilderData {
  config: PizzaConfig
  sizes: PizzaSize[]
  crusts: PizzaCrust[]
  sauces: PizzaSauce[]
  cheeses: PizzaCheese[]
  toppings: PizzaTopping[]
  toppingsByCategory: Record<string, PizzaTopping[]>
  toppingCategories: string[]
}

export interface PriceBreakdown {
  sizePrice: number
  crustPrice: number
  saucePrice: number
  cheesePrice: number
  toppingsPrice: number
  total: number
}

export interface UsePizzaOrderReturn {
  // Selections
  selectedSize: PizzaSize | null
  selectedCrust: PizzaCrust | null
  selectedSauces: SauceSelection[]
  selectedCheeses: CheeseSelection[]
  selectedToppings: PizzaToppingSelection[]
  specialNotes: string

  // Half & Half mode
  isHalfAndHalf: boolean
  activeHalf: 'left' | 'right' | 'whole'

  // Setters
  setSelectedSize: (size: PizzaSize | null) => void
  setSelectedCrust: (crust: PizzaCrust | null) => void
  setSelectedSauces: React.Dispatch<React.SetStateAction<SauceSelection[]>>
  setSelectedCheeses: React.Dispatch<React.SetStateAction<CheeseSelection[]>>
  setSelectedToppings: React.Dispatch<React.SetStateAction<PizzaToppingSelection[]>>
  setSpecialNotes: (notes: string) => void
  setIsHalfAndHalf: (value: boolean) => void
  setActiveHalf: (half: 'left' | 'right' | 'whole') => void

  // Actions
  addTopping: (topping: PizzaTopping, half?: 'left' | 'right' | 'whole') => void
  removeTopping: (toppingId: string) => void
  toggleTopping: (topping: PizzaTopping, half?: 'left' | 'right' | 'whole') => void
  updateToppingAmount: (toppingId: string, amount: ToppingAmount) => void
  addSauce: (sauce: PizzaSauce, sections?: number[]) => void
  removeSauce: (sauceId: string) => void
  addCheese: (cheese: PizzaCheese, sections?: number[]) => void
  removeCheese: (cheeseId: string) => void
  clearAll: () => void

  // Pricing
  priceBreakdown: PriceBreakdown
  calculateToppingPrice: (basePrice: number, sections: number[], amount: ToppingAmount) => number

  // Build final config
  buildOrderConfig: () => PizzaOrderConfig | null
}

export function usePizzaOrder(
  data: PizzaBuilderData | null,
  initialConfig?: PizzaOrderConfig
): UsePizzaOrderReturn {
  // Core selections
  const [selectedSize, setSelectedSize] = useState<PizzaSize | null>(null)
  const [selectedCrust, setSelectedCrust] = useState<PizzaCrust | null>(null)
  const [selectedSauces, setSelectedSauces] = useState<SauceSelection[]>([])
  const [selectedCheeses, setSelectedCheeses] = useState<CheeseSelection[]>([])
  const [selectedToppings, setSelectedToppings] = useState<PizzaToppingSelection[]>([])
  const [specialNotes, setSpecialNotes] = useState('')

  // Half & Half mode
  const [isHalfAndHalf, setIsHalfAndHalf] = useState(false)
  const [activeHalf, setActiveHalf] = useState<'left' | 'right' | 'whole'>('whole')

  // Get sections for a half
  const getSectionsForHalf = useCallback((half: 'left' | 'right' | 'whole'): number[] => {
    const maxSections = data?.config.maxSections || 8
    if (half === 'whole') {
      return Array.from({ length: maxSections }, (_, i) => i)
    }
    const halfSize = maxSections / 2
    if (half === 'right') {
      return Array.from({ length: halfSize }, (_, i) => i)
    }
    return Array.from({ length: halfSize }, (_, i) => halfSize + i)
  }, [data])

  // Calculate topping price
  const calculateToppingPrice = useCallback((
    basePrice: number,
    sections: number[],
    amount: ToppingAmount
  ): number => {
    if (!data || !selectedSize || sections.length === 0) return 0

    const totalSections = data.config.maxSections
    const coverage = sections.length / totalSections
    const sizeMultiplier = selectedSize.toppingMultiplier

    let priceMultiplier = coverage // fractional by default
    if (data.config.pricingMode === 'flat') {
      priceMultiplier = 1.0
    } else if (data.config.pricingMode === 'hybrid' && data.config.hybridPricing) {
      if (coverage === 1) priceMultiplier = data.config.hybridPricing.whole
      else if (coverage >= 0.5) priceMultiplier = data.config.hybridPricing.half
      else if (coverage >= 0.25) priceMultiplier = data.config.hybridPricing.quarter
      else priceMultiplier = data.config.hybridPricing.eighth
    }

    const amountMultiplier = amount === 'extra' ? 1.5 : 1.0
    return basePrice * priceMultiplier * sizeMultiplier * amountMultiplier
  }, [data, selectedSize])

  // Add topping
  const addTopping = useCallback((topping: PizzaTopping, half: 'left' | 'right' | 'whole' = 'whole') => {
    const sections = isHalfAndHalf && half !== 'whole'
      ? getSectionsForHalf(half)
      : getSectionsForHalf('whole')

    const newTopping: PizzaToppingSelection = {
      toppingId: topping.id,
      name: topping.name,
      sections,
      amount: 'regular',
      price: calculateToppingPrice(topping.price, sections, 'regular'),
      basePrice: topping.price,
    }

    setSelectedToppings(prev => {
      const existing = prev.find(t => t.toppingId === topping.id)
      if (existing) {
        // Update sections if different
        if (JSON.stringify(existing.sections) !== JSON.stringify(sections)) {
          return prev.map(t => t.toppingId === topping.id ? { ...t, sections } : t)
        }
        return prev
      }
      return [...prev, newTopping]
    })
  }, [isHalfAndHalf, getSectionsForHalf, calculateToppingPrice])

  // Remove topping
  const removeTopping = useCallback((toppingId: string) => {
    setSelectedToppings(prev => prev.filter(t => t.toppingId !== toppingId))
  }, [])

  // Toggle topping (add if not present, remove if present with same sections)
  const toggleTopping = useCallback((topping: PizzaTopping, half: 'left' | 'right' | 'whole' = 'whole') => {
    const sections = isHalfAndHalf && half !== 'whole'
      ? getSectionsForHalf(half)
      : getSectionsForHalf('whole')

    const existing = selectedToppings.find(t => t.toppingId === topping.id)

    if (existing) {
      const sameSections = existing.sections.length === sections.length &&
        existing.sections.every(s => sections.includes(s))
      if (sameSections) {
        removeTopping(topping.id)
      } else {
        // Update to new sections
        setSelectedToppings(prev => prev.map(t =>
          t.toppingId === topping.id ? { ...t, sections } : t
        ))
      }
    } else {
      addTopping(topping, half)
    }
  }, [isHalfAndHalf, getSectionsForHalf, selectedToppings, addTopping, removeTopping])

  // Update topping amount
  const updateToppingAmount = useCallback((toppingId: string, amount: ToppingAmount) => {
    setSelectedToppings(prev => prev.map(t => {
      if (t.toppingId !== toppingId) return t
      return {
        ...t,
        amount,
        price: calculateToppingPrice(t.basePrice, t.sections, amount),
      }
    }))
  }, [calculateToppingPrice])

  // Add sauce
  const addSauce = useCallback((sauce: PizzaSauce, sections?: number[]) => {
    const allSections = sections || getSectionsForHalf('whole')
    setSelectedSauces(prev => {
      const existing = prev.find(s => s.sauceId === sauce.id)
      if (existing) {
        return prev.map(s => s.sauceId === sauce.id ? { ...s, sections: allSections } : s)
      }
      return [...prev, {
        sauceId: sauce.id,
        name: sauce.name,
        sections: allSections,
        amount: 'regular',
        price: sauce.price || 0,
      }]
    })
  }, [getSectionsForHalf])

  // Remove sauce
  const removeSauce = useCallback((sauceId: string) => {
    setSelectedSauces(prev => prev.filter(s => s.sauceId !== sauceId))
  }, [])

  // Add cheese
  const addCheese = useCallback((cheese: PizzaCheese, sections?: number[]) => {
    const allSections = sections || getSectionsForHalf('whole')
    setSelectedCheeses(prev => {
      const existing = prev.find(c => c.cheeseId === cheese.id)
      if (existing) {
        return prev.map(c => c.cheeseId === cheese.id ? { ...c, sections: allSections } : c)
      }
      return [...prev, {
        cheeseId: cheese.id,
        name: cheese.name,
        sections: allSections,
        amount: 'regular',
        price: cheese.price || 0,
      }]
    })
  }, [getSectionsForHalf])

  // Remove cheese
  const removeCheese = useCallback((cheeseId: string) => {
    setSelectedCheeses(prev => prev.filter(c => c.cheeseId !== cheeseId))
  }, [])

  // Clear all
  const clearAll = useCallback(() => {
    setSelectedToppings([])
    setSelectedSauces([])
    setSelectedCheeses([])
    setSpecialNotes('')
    setIsHalfAndHalf(false)
    setActiveHalf('whole')
  }, [])

  // Calculate total
  const priceBreakdown = useMemo((): PriceBreakdown => {
    if (!data || !selectedSize || !selectedCrust) {
      return { sizePrice: 0, crustPrice: 0, saucePrice: 0, cheesePrice: 0, toppingsPrice: 0, total: 0 }
    }

    const maxSections = data.config.maxSections
    const sizePrice = selectedSize.basePrice
    const crustPrice = selectedCrust.price

    // Calculate sauce price
    let saucePrice = 0
    selectedSauces.forEach(s => {
      const sauce = data.sauces.find(sc => sc.id === s.sauceId)
      if (sauce) {
        const coverage = s.sections.length / maxSections
        let price = (sauce.price || 0) * coverage
        if (s.amount === 'extra' && sauce.extraPrice) price += sauce.extraPrice * coverage
        saucePrice += price
      }
    })

    // Calculate cheese price
    let cheesePrice = 0
    selectedCheeses.forEach(c => {
      const cheese = data.cheeses.find(ch => ch.id === c.cheeseId)
      if (cheese) {
        const coverage = c.sections.length / maxSections
        let price = (cheese.price || 0) * coverage
        if (c.amount === 'extra' && cheese.extraPrice) price += cheese.extraPrice * coverage
        cheesePrice += price
      }
    })

    // Calculate toppings price with free toppings
    const freeToppingsCount = data.config.freeToppingsMode === 'per_size'
      ? selectedSize.freeToppings
      : (data.config.freeToppingsEnabled ? data.config.freeToppingsCount : 0)

    const sortedToppings = [...selectedToppings].sort((a, b) => b.basePrice - a.basePrice)
    let toppingsPrice = 0
    sortedToppings.forEach((topping, index) => {
      const isFree = data.config.freeToppingsEnabled && index < freeToppingsCount
      if (!isFree) {
        toppingsPrice += calculateToppingPrice(topping.basePrice, topping.sections, topping.amount)
      }
    })

    return {
      sizePrice,
      crustPrice,
      saucePrice,
      cheesePrice,
      toppingsPrice,
      total: sizePrice + crustPrice + saucePrice + cheesePrice + toppingsPrice
    }
  }, [data, selectedSize, selectedCrust, selectedSauces, selectedCheeses, selectedToppings, calculateToppingPrice])

  // Build final order config
  const buildOrderConfig = useCallback((): PizzaOrderConfig | null => {
    if (!selectedSize || !selectedCrust) return null

    return {
      sizeId: selectedSize.id,
      crustId: selectedCrust.id,
      sauceId: selectedSauces[0]?.sauceId || null,
      cheeseId: selectedCheeses[0]?.cheeseId || null,
      sauceAmount: selectedSauces[0]?.amount || 'none',
      cheeseAmount: selectedCheeses[0]?.amount || 'none',
      sauces: selectedSauces,
      cheeses: selectedCheeses,
      toppings: selectedToppings,
      specialNotes: specialNotes.trim() || undefined,
      totalPrice: priceBreakdown.total,
      priceBreakdown,
    }
  }, [selectedSize, selectedCrust, selectedSauces, selectedCheeses, selectedToppings, specialNotes, priceBreakdown])

  return {
    selectedSize,
    selectedCrust,
    selectedSauces,
    selectedCheeses,
    selectedToppings,
    specialNotes,
    isHalfAndHalf,
    activeHalf,
    setSelectedSize,
    setSelectedCrust,
    setSelectedSauces,
    setSelectedCheeses,
    setSelectedToppings,
    setSpecialNotes,
    setIsHalfAndHalf,
    setActiveHalf,
    addTopping,
    removeTopping,
    toggleTopping,
    updateToppingAmount,
    addSauce,
    removeSauce,
    addCheese,
    removeCheese,
    clearAll,
    priceBreakdown,
    calculateToppingPrice,
    buildOrderConfig,
  }
}
