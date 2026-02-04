'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatCurrency } from '@/lib/utils'
import type {
  MenuItem,
  PizzaConfig,
  PizzaSize,
  PizzaCrust,
  PizzaSauce,
  PizzaCheese,
  PizzaTopping,
  PizzaToppingSelection,
  PizzaSpecialty,
  PizzaOrderConfig,
} from '@/types'
import type { PizzaBuilderData, SauceSelection, CheeseSelection, ToppingAmount } from './use-pizza-order'

// Topping category colors and icons
const CATEGORY_CONFIG: Record<string, { color: string; icon: string; label: string }> = {
  meat: { color: '#dc2626', icon: '🥩', label: 'Meats' },
  veggie: { color: '#16a34a', icon: '🥬', label: 'Veggies' },
  cheese: { color: '#ca8a04', icon: '🧀', label: 'Cheese' },
  premium: { color: '#7c3aed', icon: '⭐', label: 'Premium' },
  seafood: { color: '#0891b2', icon: '🦐', label: 'Seafood' },
  standard: { color: '#525252', icon: '🍕', label: 'Other' },
}

interface PizzaQuickBuilderProps {
  item: MenuItem
  specialty?: PizzaSpecialty | null
  editingItem?: {
    id: string
    pizzaConfig?: PizzaOrderConfig
  } | null
  onConfirm: (config: PizzaOrderConfig) => void
  onCancel: () => void
  onSwitchMode?: () => void
  showModeSwitch?: boolean
}

export function PizzaQuickBuilder({
  item,
  specialty,
  editingItem,
  onConfirm,
  onCancel,
  onSwitchMode,
  showModeSwitch = true,
}: PizzaQuickBuilderProps) {
  const [data, setData] = useState<PizzaBuilderData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Selections
  const [selectedSize, setSelectedSize] = useState<PizzaSize | null>(null)
  const [selectedCrust, setSelectedCrust] = useState<PizzaCrust | null>(null)
  const [selectedSauces, setSelectedSauces] = useState<SauceSelection[]>([])
  const [selectedCheeses, setSelectedCheeses] = useState<CheeseSelection[]>([])
  const [selectedToppings, setSelectedToppings] = useState<PizzaToppingSelection[]>([])
  const [specialNotes, setSpecialNotes] = useState('')

  // Half & Half mode
  const [isHalfAndHalf, setIsHalfAndHalf] = useState(false)
  const [activeHalf, setActiveHalf] = useState<'left' | 'right'>('left')

  // Active topping category tab
  const [activeCategory, setActiveCategory] = useState<string>('meat')

  // Load data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/pizza')
        if (!response.ok) throw new Error('Failed to load pizza data')
        const result = await response.json()
        setData(result)

        // Set defaults
        const defaultSize = result.sizes.find((s: PizzaSize) => s.isDefault) || result.sizes[0]
        const defaultCrust = result.crusts.find((c: PizzaCrust) => c.isDefault) || result.crusts[0]
        const defaultSauce = result.sauces.find((s: PizzaSauce) => s.isDefault) || result.sauces[0]
        const defaultCheese = result.cheeses.find((c: PizzaCheese) => c.isDefault) || result.cheeses[0]
        const maxSections = result.config?.maxSections || 8
        const allSections = Array.from({ length: maxSections }, (_, i) => i)

        setSelectedSize(defaultSize || null)
        setSelectedCrust(defaultCrust || null)

        // Initialize with default sauce on whole pizza
        if (defaultSauce) {
          setSelectedSauces([{
            sauceId: defaultSauce.id,
            name: defaultSauce.name,
            sections: allSections,
            amount: 'regular',
            price: defaultSauce.price || 0,
          }])
        }

        // Initialize with default cheese on whole pizza
        if (defaultCheese) {
          setSelectedCheeses([{
            cheeseId: defaultCheese.id,
            name: defaultCheese.name,
            sections: allSections,
            amount: 'regular',
            price: defaultCheese.price || 0,
          }])
        }

        // Set first available category as active
        if (result.toppingCategories?.length > 0) {
          setActiveCategory(result.toppingCategories[0])
        }

        // Handle specialty or editing
        if (specialty) {
          if (specialty.defaultCrust) setSelectedCrust(specialty.defaultCrust)
          // Apply specialty toppings, sauce, cheese...
          if (specialty.toppings) {
            const initialToppings: PizzaToppingSelection[] = specialty.toppings.map(t => {
              const topping = result.toppings.find((top: PizzaTopping) => top.id === t.toppingId)
              return {
                toppingId: t.toppingId,
                name: t.name,
                sections: t.sections,
                amount: t.amount,
                price: 0,
                basePrice: topping?.price || 0,
              }
            })
            setSelectedToppings(initialToppings)
          }
        }

        if (editingItem?.pizzaConfig) {
          const config = editingItem.pizzaConfig
          const size = result.sizes.find((s: PizzaSize) => s.id === config.sizeId)
          const crust = result.crusts.find((c: PizzaCrust) => c.id === config.crustId)
          if (size) setSelectedSize(size)
          if (crust) setSelectedCrust(crust)
          if (config.sauces) setSelectedSauces(config.sauces as SauceSelection[])
          if (config.cheeses) setSelectedCheeses(config.cheeses as CheeseSelection[])
          if (config.toppings) setSelectedToppings(config.toppings as PizzaToppingSelection[])
          setSpecialNotes(config.specialNotes || '')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load pizza data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [specialty, editingItem])

  // Get sections for whole or half
  const getSections = useCallback((half?: 'left' | 'right'): number[] => {
    const maxSections = data?.config.maxSections || 8
    if (!half || !isHalfAndHalf) {
      return Array.from({ length: maxSections }, (_, i) => i)
    }
    const halfSize = maxSections / 2
    if (half === 'left') {
      return Array.from({ length: halfSize }, (_, i) => halfSize + i)
    }
    return Array.from({ length: halfSize }, (_, i) => i)
  }, [data, isHalfAndHalf])

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

    let priceMultiplier = coverage
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

  // Toggle topping
  const handleToppingClick = useCallback((topping: PizzaTopping) => {
    const sections = getSections(isHalfAndHalf ? activeHalf : undefined)
    const existing = selectedToppings.find(t => t.toppingId === topping.id)

    if (existing) {
      // Check if same sections - remove if so
      const sameSections = existing.sections.length === sections.length &&
        existing.sections.every(s => sections.includes(s))

      if (sameSections) {
        setSelectedToppings(prev => prev.filter(t => t.toppingId !== topping.id))
      } else if (isHalfAndHalf) {
        // In half & half mode, if clicking on opposite half, add to that half too
        const combinedSections = [...new Set([...existing.sections, ...sections])]
        setSelectedToppings(prev => prev.map(t =>
          t.toppingId === topping.id ? { ...t, sections: combinedSections } : t
        ))
      } else {
        setSelectedToppings(prev => prev.filter(t => t.toppingId !== topping.id))
      }
    } else {
      const newTopping: PizzaToppingSelection = {
        toppingId: topping.id,
        name: topping.name,
        sections,
        amount: 'regular',
        price: calculateToppingPrice(topping.price, sections, 'regular'),
        basePrice: topping.price,
      }
      setSelectedToppings(prev => [...prev, newTopping])
    }
  }, [getSections, isHalfAndHalf, activeHalf, selectedToppings, calculateToppingPrice])

  // Get topping status for display
  const getToppingStatus = useCallback((toppingId: string): 'none' | 'whole' | 'left' | 'right' | 'both' => {
    const topping = selectedToppings.find(t => t.toppingId === toppingId)
    if (!topping) return 'none'

    const maxSections = data?.config.maxSections || 8
    const halfSize = maxSections / 2

    if (topping.sections.length === maxSections) return 'whole'

    const hasLeft = topping.sections.some(s => s >= halfSize)
    const hasRight = topping.sections.some(s => s < halfSize)

    if (hasLeft && hasRight) return 'both'
    if (hasLeft) return 'left'
    if (hasRight) return 'right'
    return 'none'
  }, [selectedToppings, data])

  // Calculate total price
  const priceBreakdown = useMemo(() => {
    if (!data || !selectedSize || !selectedCrust) {
      return { sizePrice: 0, crustPrice: 0, saucePrice: 0, cheesePrice: 0, toppingsPrice: 0, total: 0 }
    }

    const maxSections = data.config.maxSections
    const sizePrice = selectedSize.basePrice
    const crustPrice = selectedCrust.price

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

  // Build summary text
  const summaryText = useMemo(() => {
    const parts: string[] = []
    if (selectedSize) parts.push(selectedSize.name)
    if (selectedCrust) parts.push(selectedCrust.name)

    if (selectedToppings.length > 0) {
      const maxSections = data?.config.maxSections || 8
      const halfSize = maxSections / 2

      if (isHalfAndHalf) {
        const leftToppings = selectedToppings.filter(t => t.sections.some(s => s >= halfSize))
        const rightToppings = selectedToppings.filter(t => t.sections.some(s => s < halfSize))

        if (leftToppings.length > 0) {
          parts.push(`Left: ${leftToppings.map(t => t.name).join(', ')}`)
        }
        if (rightToppings.length > 0) {
          parts.push(`Right: ${rightToppings.map(t => t.name).join(', ')}`)
        }
      } else {
        parts.push(selectedToppings.map(t => t.name).join(', '))
      }
    }

    return parts.join(' - ')
  }, [selectedSize, selectedCrust, selectedToppings, isHalfAndHalf, data])

  // Handle confirm
  const handleConfirm = () => {
    if (!selectedSize || !selectedCrust) return
    onConfirm({
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
    })
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-6 shadow-2xl">
          <div className="animate-spin w-6 h-6 border-3 border-orange-500 border-t-transparent rounded-full mx-auto" />
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-6 shadow-2xl">
          <p className="text-red-600">{error}</p>
          <button onClick={onCancel} className="mt-3 px-4 py-2 bg-gray-100 rounded-lg">Close</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-2">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl w-full max-w-4xl max-h-[95vh] flex flex-col border border-white/30 overflow-hidden"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-500 to-red-500 px-4 py-3 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold">{specialty ? item.name : 'Build Your Pizza'}</h2>
            {showModeSwitch && onSwitchMode && (
              <button
                onClick={onSwitchMode}
                className="text-xs bg-white/20 hover:bg-white/30 px-2 py-1 rounded transition-colors"
              >
                Visual Mode
              </button>
            )}
          </div>
          <div className="text-2xl font-bold">{formatCurrency(priceBreakdown.total)}</div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-hidden flex flex-col p-4 gap-4">
          {/* Size & Crust Row */}
          <div className="flex gap-4">
            {/* Size Selection */}
            <div className="flex-1">
              <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Size</h3>
              <div className="flex gap-2">
                {data.sizes.map(size => (
                  <button
                    key={size.id}
                    onClick={() => setSelectedSize(size)}
                    className={`flex-1 py-3 px-2 rounded-xl text-center transition-all ${
                      selectedSize?.id === size.id
                        ? 'bg-orange-500 text-white shadow-lg scale-105'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                    }`}
                  >
                    <div className="font-bold text-sm">{size.name}</div>
                    <div className={`text-xs ${selectedSize?.id === size.id ? 'text-orange-100' : 'text-gray-500'}`}>
                      {formatCurrency(size.basePrice)}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Crust Selection */}
            <div className="flex-1">
              <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Crust</h3>
              <div className="flex gap-2 flex-wrap">
                {data.crusts.map(crust => (
                  <button
                    key={crust.id}
                    onClick={() => setSelectedCrust(crust)}
                    className={`py-2 px-4 rounded-xl transition-all ${
                      selectedCrust?.id === crust.id
                        ? 'bg-orange-500 text-white shadow-lg'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                    }`}
                  >
                    <span className="font-medium text-sm">{crust.name}</span>
                    {crust.price > 0 && (
                      <span className={`text-xs ml-1 ${selectedCrust?.id === crust.id ? 'text-orange-100' : 'text-gray-500'}`}>
                        +{formatCurrency(crust.price)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Half & Half Toggle */}
          <div className="flex items-center gap-4 py-2 border-y border-gray-200">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isHalfAndHalf}
                onChange={(e) => {
                  setIsHalfAndHalf(e.target.checked)
                  if (!e.target.checked) {
                    // Convert all toppings to whole pizza
                    const maxSections = data.config.maxSections
                    const allSections = Array.from({ length: maxSections }, (_, i) => i)
                    setSelectedToppings(prev => prev.map(t => ({ ...t, sections: allSections })))
                  }
                }}
                className="w-5 h-5 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
              />
              <span className="font-medium text-gray-700">Half & Half</span>
            </label>

            {isHalfAndHalf && (
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveHalf('left')}
                  className={`px-4 py-2 rounded-lg font-medium transition-all ${
                    activeHalf === 'left'
                      ? 'bg-blue-500 text-white shadow'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  Left Half
                </button>
                <button
                  onClick={() => setActiveHalf('right')}
                  className={`px-4 py-2 rounded-lg font-medium transition-all ${
                    activeHalf === 'right'
                      ? 'bg-green-500 text-white shadow'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  Right Half
                </button>
              </div>
            )}

            {isHalfAndHalf && (
              <span className="text-sm text-gray-500 ml-auto">
                Adding toppings to: <span className={activeHalf === 'left' ? 'text-blue-600 font-bold' : 'text-green-600 font-bold'}>
                  {activeHalf === 'left' ? 'Left Half' : 'Right Half'}
                </span>
              </span>
            )}
          </div>

          {/* Toppings */}
          <div className="flex-1 flex flex-col min-h-0">
            <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Toppings</h3>

            {/* Category Tabs */}
            <div className="flex gap-1 mb-3 overflow-x-auto pb-1">
              {data.toppingCategories.map(cat => {
                const config = CATEGORY_CONFIG[cat] || CATEGORY_CONFIG.standard
                const count = selectedToppings.filter(t => {
                  const topping = data.toppings.find(tp => tp.id === t.toppingId)
                  return topping?.category === cat
                }).length

                return (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={`flex items-center gap-1 px-3 py-2 rounded-lg font-medium text-sm whitespace-nowrap transition-all ${
                      activeCategory === cat
                        ? 'text-white shadow-lg'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    style={{
                      backgroundColor: activeCategory === cat ? config.color : undefined,
                    }}
                  >
                    <span>{config.icon}</span>
                    <span>{config.label}</span>
                    {count > 0 && (
                      <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${
                        activeCategory === cat ? 'bg-white/30' : 'bg-gray-300'
                      }`}>
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Topping Grid */}
            <div className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {data.toppingsByCategory[activeCategory]?.map(topping => {
                  const status = getToppingStatus(topping.id)
                  const config = CATEGORY_CONFIG[topping.category] || CATEGORY_CONFIG.standard
                  const isSelected = status !== 'none'

                  return (
                    <button
                      key={topping.id}
                      onClick={() => handleToppingClick(topping)}
                      className={`relative p-3 rounded-xl text-left transition-all min-h-[60px] ${
                        isSelected
                          ? 'text-white shadow-lg scale-[1.02]'
                          : 'bg-white border-2 border-gray-200 hover:border-gray-300 hover:shadow'
                      }`}
                      style={{
                        backgroundColor: isSelected ? config.color : undefined,
                      }}
                    >
                      <div className="font-semibold text-sm leading-tight">{topping.name}</div>
                      {topping.price > 0 && (
                        <div className={`text-xs mt-1 ${isSelected ? 'text-white/80' : 'text-gray-500'}`}>
                          +{formatCurrency(topping.price)}
                        </div>
                      )}

                      {/* Half indicator badges */}
                      {isHalfAndHalf && status !== 'none' && status !== 'whole' && (
                        <div className="absolute top-1 right-1 flex gap-0.5">
                          {(status === 'left' || status === 'both') && (
                            <span className="w-4 h-4 bg-blue-500 rounded text-[10px] text-white flex items-center justify-center font-bold">L</span>
                          )}
                          {(status === 'right' || status === 'both') && (
                            <span className="w-4 h-4 bg-green-500 rounded text-[10px] text-white flex items-center justify-center font-bold">R</span>
                          )}
                        </div>
                      )}

                      {/* Whole pizza indicator */}
                      {status === 'whole' && (
                        <div className="absolute top-1 right-1">
                          <span className="w-5 h-5 bg-white/30 rounded-full text-xs flex items-center justify-center">✓</span>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-gray-50 rounded-xl p-3">
            <div className="text-sm text-gray-600 line-clamp-2">
              {summaryText || 'Select size, crust, and toppings'}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t bg-gray-50 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <input
              type="text"
              value={specialNotes}
              onChange={(e) => setSpecialNotes(e.target.value)}
              placeholder="Special instructions..."
              className="px-3 py-2 text-sm border rounded-lg w-56 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onCancel}
              className="px-6 py-2.5 rounded-xl border-2 border-gray-300 text-gray-700 font-medium hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selectedSize || !selectedCrust}
              className="px-8 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              Add to Order {formatCurrency(priceBreakdown.total)}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
