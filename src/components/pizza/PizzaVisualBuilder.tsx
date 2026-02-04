'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
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

// Section amount types
type SauceCheeseAmount = 'none' | 'light' | 'regular' | 'extra'
type ToppingAmount = 'light' | 'regular' | 'extra'

// Sauce/Cheese selection with sections (like toppings)
interface SauceSelection {
  sauceId: string
  name: string
  sections: number[]
  amount: SauceCheeseAmount
  price: number
}

interface CheeseSelection {
  cheeseId: string
  name: string
  sections: number[]
  amount: SauceCheeseAmount
  price: number
}

// Topping category colors
const CATEGORY_COLORS: Record<string, string> = {
  meat: '#dc2626',
  veggie: '#16a34a',
  cheese: '#ca8a04',
  premium: '#7c3aed',
  seafood: '#0891b2',
  standard: '#525252',
}

interface PizzaVisualBuilderProps {
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

interface PizzaBuilderData {
  config: PizzaConfig
  sizes: PizzaSize[]
  crusts: PizzaCrust[]
  sauces: PizzaSauce[]
  cheeses: PizzaCheese[]
  toppings: PizzaTopping[]
  toppingsByCategory: Record<string, PizzaTopping[]>
  toppingCategories: string[]
}

export function PizzaVisualBuilder({
  item,
  specialty,
  editingItem,
  onConfirm,
  onCancel,
  onSwitchMode,
  showModeSwitch = true,
}: PizzaVisualBuilderProps) {
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

  // UI state
  const [sectionMode, setSectionMode] = useState<number>(2)
  const [activeSections, setActiveSections] = useState<number[]>([])

  // Load data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/pizza')
        if (!response.ok) throw new Error('Failed to load pizza data')
        const result = await response.json()
        setData(result)

        if (result.config) {
          setSectionMode(result.config.defaultSections || 2)
        }

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

        if (specialty) {
          if (specialty.defaultCrust) setSelectedCrust(specialty.defaultCrust)
          if (specialty.defaultSauce) {
            setSelectedSauces([{
              sauceId: specialty.defaultSauce.id,
              name: specialty.defaultSauce.name,
              sections: allSections,
              amount: specialty.sauceAmount,
              price: specialty.defaultSauce.price || 0,
            }])
          }
          if (specialty.defaultCheese) {
            setSelectedCheeses([{
              cheeseId: specialty.defaultCheese.id,
              name: specialty.defaultCheese.name,
              sections: allSections,
              amount: specialty.cheeseAmount,
              price: specialty.defaultCheese.price || 0,
            }])
          }

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

        if (editingItem?.pizzaConfig) {
          const config = editingItem.pizzaConfig
          const size = result.sizes.find((s: PizzaSize) => s.id === config.sizeId)
          const crust = result.crusts.find((c: PizzaCrust) => c.id === config.crustId)

          if (size) setSelectedSize(size)
          if (crust) setSelectedCrust(crust)

          // Handle legacy single sauce/cheese or new array format
          if (config.sauces) {
            setSelectedSauces(config.sauces as SauceSelection[])
          } else if (config.sauceId) {
            const sauce = result.sauces.find((s: PizzaSauce) => s.id === config.sauceId)
            if (sauce) {
              setSelectedSauces([{
                sauceId: sauce.id,
                name: sauce.name,
                sections: allSections,
                amount: config.sauceAmount,
                price: sauce.price || 0,
              }])
            }
          }

          if (config.cheeses) {
            setSelectedCheeses(config.cheeses as CheeseSelection[])
          } else if (config.cheeseId) {
            const cheese = result.cheeses.find((c: PizzaCheese) => c.id === config.cheeseId)
            if (cheese) {
              setSelectedCheeses([{
                cheeseId: cheese.id,
                name: cheese.name,
                sections: allSections,
                amount: config.cheeseAmount,
                price: cheese.price || 0,
              }])
            }
          }

          setSelectedToppings(config.toppings as PizzaToppingSelection[])
          setSpecialNotes(config.specialNotes || '')

          // Detect section mode from loaded items (find smallest sections used)
          const maxSections = result.config.maxSections || 24
          const halfSize = maxSections / 2
          const quarterSize = maxSections / 4
          const sixthSize = maxSections / 6
          const eighthSize = maxSections / 8

          let detectedMode = 1 // Default to whole
          const allItems = [
            ...(config.sauces || []).map((s: { sections: number[] }) => s.sections),
            ...(config.cheeses || []).map((c: { sections: number[] }) => c.sections),
            ...(config.toppings || []).map((t: { sections: number[] }) => t.sections),
          ]

          allItems.forEach(sections => {
            if (sections && sections.length < maxSections) {
              if (sections.length <= eighthSize) detectedMode = Math.max(detectedMode, 8)
              else if (sections.length <= sixthSize) detectedMode = Math.max(detectedMode, 6)
              else if (sections.length <= quarterSize) detectedMode = Math.max(detectedMode, 4)
              else if (sections.length <= halfSize) detectedMode = Math.max(detectedMode, 2)
            }
          })

          setSectionMode(detectedMode)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load pizza data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [specialty, editingItem])

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

  // Calculate total
  const priceBreakdown = useMemo(() => {
    if (!data || !selectedSize || !selectedCrust) {
      return { sizePrice: 0, crustPrice: 0, saucePrice: 0, cheesePrice: 0, toppingsPrice: 0, total: 0 }
    }

    const maxSections = data.config.maxSections
    const sizePrice = selectedSize.basePrice
    const crustPrice = selectedCrust.price

    // Calculate sauce price (fractional based on coverage)
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

    // Calculate cheese price (fractional based on coverage)
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

    return { sizePrice, crustPrice, saucePrice, cheesePrice, toppingsPrice, total: sizePrice + crustPrice + saucePrice + cheesePrice + toppingsPrice }
  }, [data, selectedSize, selectedCrust, selectedSauces, selectedCheeses, selectedToppings, calculateToppingPrice])

  // Section helpers
  const getSectionsForMode = (mode: number): number[][] => {
    const maxSections = data?.config.maxSections || 8
    const sections: number[][] = []
    const sectionsPerGroup = maxSections / mode
    for (let i = 0; i < mode; i++) {
      const group: number[] = []
      for (let j = 0; j < sectionsPerGroup; j++) {
        group.push(i * sectionsPerGroup + j)
      }
      sections.push(group)
    }
    return sections
  }

  const handleToppingClick = (topping: PizzaTopping) => {
    const existing = selectedToppings.find(t => t.toppingId === topping.id)
    const maxSections = data?.config.maxSections || 8
    let sectionsToAdd = activeSections.length > 0 ? [...activeSections] : Array.from({ length: maxSections }, (_, i) => i)

    if (existing) {
      const sameSections = existing.sections.length === sectionsToAdd.length &&
        existing.sections.every(s => sectionsToAdd.includes(s))
      if (sameSections) {
        setSelectedToppings(prev => prev.filter(t => t.toppingId !== topping.id))
      } else {
        setSelectedToppings(prev => prev.map(t =>
          t.toppingId === topping.id ? { ...t, sections: sectionsToAdd } : t
        ))
      }
    } else {
      const newTopping: PizzaToppingSelection = {
        toppingId: topping.id,
        name: topping.name,
        sections: sectionsToAdd,
        amount: 'regular',
        price: calculateToppingPrice(topping.price, sectionsToAdd, 'regular'),
        basePrice: topping.price,
      }
      setSelectedToppings(prev => [...prev, newTopping])
    }
    // Keep sections selected - don't clear them
  }

  const handleSectionClick = (sectionIndex: number) => {
    const sectionGroups = getSectionsForMode(sectionMode)
    const clickedGroup = sectionGroups.find(group => group.includes(sectionIndex))
    if (!clickedGroup) return

    const isActive = clickedGroup.every(s => activeSections.includes(s))
    if (isActive) {
      setActiveSections(prev => prev.filter(s => !clickedGroup.includes(s)))
    } else {
      setActiveSections(prev => [...prev.filter(s => !clickedGroup.includes(s)), ...clickedGroup])
    }
  }

  const removeTopping = (toppingId: string) => {
    setSelectedToppings(prev => prev.filter(t => t.toppingId !== toppingId))
  }

  // Handle sauce click - works like toppings with sections
  const handleSauceClick = (sauce: PizzaSauce) => {
    const maxSections = data?.config.maxSections || 8
    let sectionsToAdd = activeSections.length > 0 ? [...activeSections] : Array.from({ length: maxSections }, (_, i) => i)

    const existing = selectedSauces.find(s => s.sauceId === sauce.id)

    if (existing) {
      const sameSections = existing.sections.length === sectionsToAdd.length &&
        existing.sections.every(s => sectionsToAdd.includes(s))
      if (sameSections) {
        // Remove this sauce
        setSelectedSauces(prev => prev.filter(s => s.sauceId !== sauce.id))
      } else {
        // Update sections
        setSelectedSauces(prev => prev.map(s =>
          s.sauceId === sauce.id ? { ...s, sections: sectionsToAdd } : s
        ))
      }
    } else {
      // Add new sauce selection
      setSelectedSauces(prev => [...prev, {
        sauceId: sauce.id,
        name: sauce.name,
        sections: sectionsToAdd,
        amount: 'regular',
        price: sauce.price || 0,
      }])
    }
    // Keep sections selected - don't clear them
  }

  const removeSauce = (sauceId: string) => {
    setSelectedSauces(prev => prev.filter(s => s.sauceId !== sauceId))
  }

  // Handle cheese click - works like toppings with sections
  const handleCheeseClick = (cheese: PizzaCheese) => {
    const maxSections = data?.config.maxSections || 8
    let sectionsToAdd = activeSections.length > 0 ? [...activeSections] : Array.from({ length: maxSections }, (_, i) => i)

    const existing = selectedCheeses.find(c => c.cheeseId === cheese.id)

    if (existing) {
      const sameSections = existing.sections.length === sectionsToAdd.length &&
        existing.sections.every(s => sectionsToAdd.includes(s))
      if (sameSections) {
        // Remove this cheese
        setSelectedCheeses(prev => prev.filter(c => c.cheeseId !== cheese.id))
      } else {
        // Update sections
        setSelectedCheeses(prev => prev.map(c =>
          c.cheeseId === cheese.id ? { ...c, sections: sectionsToAdd } : c
        ))
      }
    } else {
      // Add new cheese selection
      setSelectedCheeses(prev => [...prev, {
        cheeseId: cheese.id,
        name: cheese.name,
        sections: sectionsToAdd,
        amount: 'regular',
        price: cheese.price || 0,
      }])
    }
    // Keep sections selected - don't clear them
  }

  const removeCheese = (cheeseId: string) => {
    setSelectedCheeses(prev => prev.filter(c => c.cheeseId !== cheeseId))
  }

  const handleConfirm = () => {
    if (!selectedSize || !selectedCrust) return
    onConfirm({
      sizeId: selectedSize.id,
      crustId: selectedCrust.id,
      // Legacy fields for backwards compatibility
      sauceId: selectedSauces[0]?.sauceId || null,
      cheeseId: selectedCheeses[0]?.cheeseId || null,
      sauceAmount: selectedSauces[0]?.amount || 'none',
      cheeseAmount: selectedCheeses[0]?.amount || 'none',
      // New sectional arrays
      sauces: selectedSauces,
      cheeses: selectedCheeses,
      toppings: selectedToppings,
      specialNotes: specialNotes.trim() || undefined,
      totalPrice: priceBreakdown.total,
      priceBreakdown,
    })
  }

  // Get descriptive position label for sections - SMART: auto-combine to larger sections
  const getSectionLabel = (sections: number[], mode: number, max: number): string => {
    const sorted = [...sections].sort((a, b) => a - b)
    const coverage = sections.length / max

    // Check for Whole
    if (coverage === 1) return 'Whole'

    // Define section ranges for each grouping (based on max=24)
    const halfSize = max / 2        // 12 sections per half
    const quarterSize = max / 4     // 6 sections per quarter
    const sixthSize = max / 6       // 4 sections per sixth
    const eighthSize = max / 8      // 3 sections per eighth

    // Helper to check if sections exactly match a range
    const matchesRange = (start: number, size: number): boolean => {
      if (sections.length !== size) return false
      const expected = Array.from({ length: size }, (_, i) => start + i)
      return expected.every(s => sorted.includes(s)) && sorted.length === size
    }

    // Check for halves (12 sections each)
    if (matchesRange(0, halfSize)) return 'Right Half'
    if (matchesRange(halfSize, halfSize)) return 'Left Half'

    // Check for quarters (6 sections each)
    if (matchesRange(0, quarterSize)) return 'Top Right'
    if (matchesRange(quarterSize, quarterSize)) return 'Bottom Right'
    if (matchesRange(quarterSize * 2, quarterSize)) return 'Bottom Left'
    if (matchesRange(quarterSize * 3, quarterSize)) return 'Top Left'

    // Check for sixths (4 sections each)
    for (let i = 0; i < 6; i++) {
      if (matchesRange(i * sixthSize, sixthSize)) return `1/6-${i + 1}`
    }

    // Check for eighths (3 sections each)
    for (let i = 0; i < 8; i++) {
      if (matchesRange(i * eighthSize, eighthSize)) return `1/8-${i + 1}`
    }

    // Fallback: use current mode to determine label
    const firstSection = sorted[0]
    const sectionsPerSlice = max / mode
    const sliceIndex = Math.floor(firstSection / sectionsPerSlice)

    if (mode === 2) {
      return sliceIndex === 0 ? 'Right Half' : 'Left Half'
    } else if (mode === 4) {
      const labels = ['Top Right', 'Bottom Right', 'Bottom Left', 'Top Left']
      return labels[sliceIndex] || 'Quarter'
    } else if (mode === 6) {
      return `1/6-${sliceIndex + 1}`
    } else if (mode === 8) {
      return `1/8-${sliceIndex + 1}`
    }

    return `${Math.round(coverage * 100)}%`
  }

  const getCoverageLabel = (sections: number[], max: number): string => {
    const c = sections.length / max
    if (c === 1) return 'W'
    if (c === 0.5) return '½'
    if (c === 0.25) return '¼'
    return `${Math.round(c * 100)}%`
  }

  // Large Visual Pizza with topping names inside sections
  const renderPizzaVisual = () => {
    const maxSections = data?.config.maxSections || 8
    const sectionGroups = getSectionsForMode(sectionMode)
    const size = 340
    const center = size / 2
    const radius = size / 2 - 12
    const innerRadius = radius * 0.15

    const getToppingsInSection = (sectionIndex: number) => {
      return selectedToppings.filter(t => t.sections.includes(sectionIndex))
    }

    const getSaucesInSection = (sectionIndex: number) => {
      return selectedSauces.filter(s => s.sections.includes(sectionIndex))
    }

    const getCheesesInSection = (sectionIndex: number) => {
      return selectedCheeses.filter(c => c.sections.includes(sectionIndex))
    }

    // Get all items (sauce, cheese, toppings) in a section for display
    const getAllItemsInSection = (sectionIndex: number): { name: string; color: string; type: string }[] => {
      const items: { name: string; color: string; type: string }[] = []
      getSaucesInSection(sectionIndex).forEach(s => items.push({ name: s.name, color: '#dc2626', type: 'sauce' }))
      getCheesesInSection(sectionIndex).forEach(c => items.push({ name: c.name, color: '#ca8a04', type: 'cheese' }))
      getToppingsInSection(sectionIndex).forEach(t => {
        const td = data?.toppings.find(tp => tp.id === t.toppingId)
        items.push({ name: t.name, color: CATEGORY_COLORS[td?.category || 'standard'], type: 'topping' })
      })
      return items
    }

    const getArcPath = (groupIndex: number) => {
      const numGroups = sectionMode
      const startAngle = (groupIndex * 360 / numGroups - 90) * Math.PI / 180
      const endAngle = ((groupIndex + 1) * 360 / numGroups - 90) * Math.PI / 180
      const x1 = center + radius * Math.cos(startAngle)
      const y1 = center + radius * Math.sin(startAngle)
      const x2 = center + radius * Math.cos(endAngle)
      const y2 = center + radius * Math.sin(endAngle)
      const ix1 = center + innerRadius * Math.cos(startAngle)
      const iy1 = center + innerRadius * Math.sin(startAngle)
      const ix2 = center + innerRadius * Math.cos(endAngle)
      const iy2 = center + innerRadius * Math.sin(endAngle)
      const largeArc = 360 / numGroups > 180 ? 1 : 0
      return `M ${ix1} ${iy1} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix1} ${iy1} Z`
    }

    const getLabelPosition = (groupIndex: number, distance: number = 0.55) => {
      const midAngle = ((groupIndex + 0.5) * 360 / sectionMode - 90) * Math.PI / 180
      return { x: center + radius * distance * Math.cos(midAngle), y: center + radius * distance * Math.sin(midAngle) }
    }

    // Get section name for display on pizza (clockwise from top)
    const getSectionName = (idx: number): string => {
      if (sectionMode === 1) return ''
      if (sectionMode === 2) return idx === 0 ? 'RIGHT' : 'LEFT'
      if (sectionMode === 4) return ['TOP RIGHT', 'BOT RIGHT', 'BOT LEFT', 'TOP LEFT'][idx]
      if (sectionMode === 6) return `1/6-${idx + 1}`
      return `1/8-${idx + 1}`
    }

    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="drop-shadow-lg">
        {/* Crust */}
        <circle cx={center} cy={center} r={radius} fill="#D4A574" stroke="#8B6914" strokeWidth="3" />
        {/* Cheese base */}
        <circle cx={center} cy={center} r={radius - 12} fill="#FCD34D" stroke="#F59E0B" strokeWidth="2" />

        {sectionGroups.map((group, idx) => {
          const allItems = getAllItemsInSection(group[0])
          const isActive = group.every(s => activeSections.includes(s))
          const pos = getLabelPosition(idx)

          return (
            <g key={idx}>
              {/* Section overlay */}
              <path
                d={getArcPath(idx)}
                fill={isActive ? '#3B82F640' : 'transparent'}
                stroke={isActive ? '#3B82F6' : '#00000015'}
                strokeWidth={isActive ? 3 : 1}
                className="cursor-pointer hover:fill-blue-500/20"
                onClick={() => handleSectionClick(group[0])}
              />

              {/* Section label at top */}
              {sectionMode > 1 && (
                <text
                  x={pos.x}
                  y={pos.y - (allItems.length > 0 ? Math.min(allItems.length, 5) * 7 + 10 : 0)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="text-[11px] font-black fill-gray-500 pointer-events-none select-none"
                >
                  {getSectionName(idx)}
                </text>
              )}

              {/* Item names (sauce, cheese, toppings) stacked vertically */}
              {allItems.slice(0, 5).map((item, i) => {
                return (
                  <g key={`${item.type}-${item.name}-${i}`}>
                    <text
                      x={pos.x}
                      y={pos.y + (i * 14) - ((Math.min(allItems.length, 5) - 1) * 7)}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="text-[11px] font-bold pointer-events-none select-none"
                      fill={item.color}
                      stroke="white"
                      strokeWidth="2"
                      paintOrder="stroke"
                    >
                      {item.name.length > 12 ? item.name.slice(0, 10) + '..' : item.name}
                    </text>
                  </g>
                )
              })}
              {allItems.length > 5 && (
                <text
                  x={pos.x}
                  y={pos.y + 42}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="text-[10px] font-bold fill-gray-600 pointer-events-none"
                >
                  +{allItems.length - 5} more
                </text>
              )}
            </g>
          )
        })}

        {/* Center hole */}
        <circle cx={center} cy={center} r={innerRadius} fill="#FEF3C7" stroke="#F59E0B" strokeWidth="2" />
      </svg>
    )
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
        className="bg-white/95 backdrop-blur-xl rounded-xl shadow-2xl w-full max-w-6xl h-[calc(100vh-1rem)] flex flex-col border border-white/30"
      >
        {/* Header - Compact */}
        <div className="bg-gradient-to-r from-orange-500 to-red-500 px-4 py-2 text-white flex items-center justify-between rounded-t-xl">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold">{specialty ? item.name : 'Build Your Pizza'}</h2>
            {showModeSwitch && onSwitchMode && (
              <button
                onClick={onSwitchMode}
                className="text-xs bg-white/20 hover:bg-white/30 px-2 py-1 rounded transition-colors"
              >
                Quick Mode
              </button>
            )}
          </div>
          <div className="text-right">
            <span className="text-2xl font-bold">{formatCurrency(priceBreakdown.total)}</span>
          </div>
        </div>

        {/* Main Content - 3 Column Layout */}
        <div className="flex-1 flex gap-3 p-3 min-h-0">
          {/* LEFT: Size, Crust, Sauce, Cheese */}
          <div className="w-48 flex flex-col gap-2 shrink-0">
            {/* Size */}
            <div className="bg-gray-50 rounded-lg p-2">
              <h3 className="text-xs font-bold text-gray-600 mb-1">SIZE</h3>
              <div className="space-y-1">
                {data.sizes.map(size => (
                  <button
                    key={size.id}
                    onClick={() => setSelectedSize(size)}
                    className={`w-full py-1.5 px-2 rounded text-left text-sm transition-all flex justify-between ${
                      selectedSize?.id === size.id
                        ? 'bg-orange-500 text-white font-medium'
                        : 'bg-white hover:bg-orange-50 border border-gray-200'
                    }`}
                  >
                    <span>{size.name}</span>
                    <span className={selectedSize?.id === size.id ? 'text-white' : 'text-orange-600'}>{formatCurrency(size.basePrice)}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Crust */}
            <div className="bg-gray-50 rounded-lg p-2">
              <h3 className="text-xs font-bold text-gray-600 mb-1">CRUST</h3>
              <div className="space-y-1">
                {data.crusts.map(crust => (
                  <button
                    key={crust.id}
                    onClick={() => setSelectedCrust(crust)}
                    className={`w-full py-1 px-2 rounded text-left text-xs transition-all flex justify-between ${
                      selectedCrust?.id === crust.id
                        ? 'bg-orange-500 text-white'
                        : 'bg-white hover:bg-orange-50 border border-gray-200'
                    }`}
                  >
                    <span>{crust.name}</span>
                    {crust.price > 0 && <span>+{formatCurrency(crust.price)}</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Sauce - now with sectional support */}
            <div className="bg-gray-50 rounded-lg p-2">
              <h3 className="text-xs font-bold text-gray-600 mb-1">SAUCE</h3>
              <div className="space-y-1">
                {data.sauces.map(sauce => {
                  const selected = selectedSauces.find(s => s.sauceId === sauce.id)
                  return (
                    <button
                      key={sauce.id}
                      onClick={() => handleSauceClick(sauce)}
                      className={`w-full py-1 px-2 rounded text-left text-xs transition-all ${
                        selected
                          ? 'bg-red-500 text-white'
                          : 'bg-white hover:bg-red-50 border border-gray-200'
                      }`}
                    >
                      {sauce.name}
                      {selected && (
                        <span className="ml-1 opacity-80">
                          ({getSectionLabel(selected.sections, sectionMode, data.config.maxSections)})
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Cheese - now with sectional support */}
            <div className="bg-gray-50 rounded-lg p-2">
              <h3 className="text-xs font-bold text-gray-600 mb-1">CHEESE</h3>
              <div className="space-y-1">
                {data.cheeses.map(cheese => {
                  const selected = selectedCheeses.find(c => c.cheeseId === cheese.id)
                  return (
                    <button
                      key={cheese.id}
                      onClick={() => handleCheeseClick(cheese)}
                      className={`w-full py-1 px-2 rounded text-left text-xs transition-all ${
                        selected
                          ? 'bg-yellow-500 text-white'
                          : 'bg-white hover:bg-yellow-50 border border-gray-200'
                      }`}
                    >
                      {cheese.name}
                      {selected && (
                        <span className="ml-1 opacity-80">
                          ({getSectionLabel(selected.sections, sectionMode, data.config.maxSections)})
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* CENTER: Large Visual Pizza */}
          <div className="flex-1 flex flex-col items-center min-w-[360px]">
            {/* Section Mode Toggle */}
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xs text-gray-500">Sections:</span>
              <div className="flex bg-gray-100 rounded-lg p-0.5">
                {data.config.sectionOptions.map(mode => (
                  <button
                    key={mode}
                    onClick={() => { setSectionMode(mode); setActiveSections([]) }}
                    className={`w-10 h-7 text-sm font-bold rounded transition-all ${
                      sectionMode === mode ? 'bg-orange-500 text-white' : 'text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {mode === 1 ? 'W' : mode}
                  </button>
                ))}
              </div>
              {activeSections.length > 0 && (
                <div className="text-sm text-blue-600 bg-blue-50 px-3 py-1 rounded font-medium">
                  Adding to: {getSectionLabel(activeSections, sectionMode, data.config.maxSections)}
                  <button onClick={() => setActiveSections([])} className="ml-2 text-blue-700 underline">×</button>
                </div>
              )}
            </div>

            {/* Large Pizza Visual */}
            {renderPizzaVisual()}

            {activeSections.length === 0 && selectedToppings.length === 0 && (
              <div className="text-xs text-gray-400 mt-2">
                Tap a section on the pizza, then tap toppings to add
              </div>
            )}

            {/* Text summary - organized rows from Whole down to current section mode */}
            <div className="mt-3 w-full space-y-2">
              {(() => {
                const maxSections = data.config.maxSections
                type ItemWithSection = { type: 'sauce' | 'cheese' | 'topping'; id: string; name: string; sections: number[]; color: string; price: number }
                const allItems: ItemWithSection[] = []

                // Add sauces - calculate price based on coverage
                selectedSauces.forEach(s => {
                  const sauce = data.sauces.find(sc => sc.id === s.sauceId)
                  const coverage = s.sections.length / maxSections
                  let price = ((sauce?.price || 0) * coverage)
                  if (s.amount === 'extra' && sauce?.extraPrice) price += sauce.extraPrice * coverage
                  allItems.push({ type: 'sauce', id: s.sauceId, name: s.name, sections: s.sections, color: '#dc2626', price })
                })

                // Add cheeses - calculate price based on coverage
                selectedCheeses.forEach(c => {
                  const cheese = data.cheeses.find(ch => ch.id === c.cheeseId)
                  const coverage = c.sections.length / maxSections
                  let price = ((cheese?.price || 0) * coverage)
                  if (c.amount === 'extra' && cheese?.extraPrice) price += cheese.extraPrice * coverage
                  allItems.push({ type: 'cheese', id: c.cheeseId, name: c.name, sections: c.sections, color: '#ca8a04', price })
                })

                // Add toppings - price already calculated with pricing mode
                selectedToppings.forEach(t => {
                  const td = data.toppings.find(tp => tp.id === t.toppingId)
                  allItems.push({ type: 'topping', id: t.toppingId, name: t.name, sections: t.sections, color: CATEGORY_COLORS[td?.category || 'standard'], price: t.price })
                })

                // Define section ranges for each box (based on max=24)
                const halfSize = maxSections / 2      // 12
                const quarterSize = maxSections / 4   // 6
                const sixthSize = maxSections / 6     // 4
                const eighthSize = maxSections / 8    // 3

                const boxSections: Record<string, number[]> = {
                  'Whole': Array.from({ length: maxSections }, (_, i) => i),
                  'Right Half': Array.from({ length: halfSize }, (_, i) => i),
                  'Left Half': Array.from({ length: halfSize }, (_, i) => halfSize + i),
                  'Top Right': Array.from({ length: quarterSize }, (_, i) => i),
                  'Bottom Right': Array.from({ length: quarterSize }, (_, i) => quarterSize + i),
                  'Bottom Left': Array.from({ length: quarterSize }, (_, i) => quarterSize * 2 + i),
                  'Top Left': Array.from({ length: quarterSize }, (_, i) => quarterSize * 3 + i),
                }
                // Add sixths
                for (let i = 0; i < 6; i++) {
                  boxSections[`1/6-${i + 1}`] = Array.from({ length: sixthSize }, (_, j) => i * sixthSize + j)
                }
                // Add eighths
                for (let i = 0; i < 8; i++) {
                  boxSections[`1/8-${i + 1}`] = Array.from({ length: eighthSize }, (_, j) => i * eighthSize + j)
                }

                // For each item, find the BEST (largest) box it exactly fits
                // Then also track which smaller boxes it covers for display
                const getBestLabel = (sections: number[]): string => {
                  return getSectionLabel(sections, sectionMode, maxSections)
                }

                // Check if item's sections exactly cover a box's sections
                const exactlyCovers = (itemSections: number[], boxName: string): boolean => {
                  const boxSecs = boxSections[boxName]
                  if (!boxSecs || itemSections.length !== boxSecs.length) return false
                  const sorted = [...itemSections].sort((a, b) => a - b)
                  return boxSecs.every((s, i) => sorted[i] === s)
                }

                // Check if item's sections partially overlap with a box (but don't exactly cover a larger box)
                const partiallyCovers = (itemSections: number[], boxName: string): boolean => {
                  const boxSecs = boxSections[boxName]
                  if (!boxSecs) return false
                  return boxSecs.some(s => itemSections.includes(s))
                }

                // Group items: first by best label (exact match to largest), then show in smaller boxes if partial
                const groups: Record<string, ItemWithSection[]> = {}

                allItems.forEach(item => {
                  const bestLabel = getBestLabel(item.sections)

                  // If it exactly matches a box, put it there
                  if (exactlyCovers(item.sections, bestLabel)) {
                    if (!groups[bestLabel]) groups[bestLabel] = []
                    groups[bestLabel].push(item)
                  } else {
                    // Doesn't exactly match any standard box - show in each small box it covers
                    // Find the smallest level boxes and show in each one the item covers
                    let smallestBoxes: string[] = []
                    if (sectionMode >= 8) {
                      smallestBoxes = Object.keys(boxSections).filter(k => k.startsWith('1/8-'))
                    } else if (sectionMode >= 6) {
                      smallestBoxes = Object.keys(boxSections).filter(k => k.startsWith('1/6-'))
                    } else if (sectionMode >= 4) {
                      smallestBoxes = ['Top Right', 'Bottom Right', 'Bottom Left', 'Top Left']
                    } else if (sectionMode >= 2) {
                      smallestBoxes = ['Right Half', 'Left Half']
                    } else {
                      smallestBoxes = ['Whole']
                    }

                    smallestBoxes.forEach(boxName => {
                      if (exactlyCovers(item.sections, boxName)) {
                        if (!groups[boxName]) groups[boxName] = []
                        groups[boxName].push(item)
                      } else if (partiallyCovers(item.sections, boxName)) {
                        // Check if this box's sections are entirely within the item's sections
                        const boxSecs = boxSections[boxName]
                        if (boxSecs && boxSecs.every(s => item.sections.includes(s))) {
                          if (!groups[boxName]) groups[boxName] = []
                          groups[boxName].push(item)
                        }
                      }
                    })
                  }
                })

                // Define rows in the order specified
                const rows: { show: boolean; boxes: string[] }[] = [
                  { show: true, boxes: ['Whole', 'Left Half', 'Right Half'] },
                  { show: sectionMode >= 4, boxes: ['Top Left', 'Top Right', 'Bottom Left', 'Bottom Right'] },
                  { show: sectionMode >= 6, boxes: ['1/6-1', '1/6-2', '1/6-3', '1/6-4', '1/6-5', '1/6-6'] },
                  { show: sectionMode >= 8, boxes: ['1/8-1', '1/8-2', '1/8-3', '1/8-4'] },
                  { show: sectionMode >= 8, boxes: ['1/8-5', '1/8-6', '1/8-7', '1/8-8'] },
                ]

                // Helper to render a box
                const renderBox = (label: string) => {
                  // Skip halves if in mode 1
                  if (sectionMode === 1 && (label === 'Left Half' || label === 'Right Half')) return null

                  const hasItems = groups[label]?.length > 0
                  return (
                    <div
                      key={label}
                      className={`rounded-lg p-2 min-w-[90px] flex-1 max-w-[120px] shadow-sm ${
                        hasItems
                          ? 'bg-white border-2 border-gray-300'
                          : 'bg-gray-50 border border-dashed border-gray-300'
                      }`}
                    >
                      <div className={`text-[10px] font-bold uppercase border-b pb-1 mb-1 ${
                        hasItems ? 'text-gray-700 border-gray-300' : 'text-gray-400 border-gray-200'
                      }`}>
                        {label}
                      </div>
                      <div className="space-y-0.5 min-h-[18px]">
                        {hasItems ? (
                          groups[label].map((item) => (
                            <div key={`${item.type}-${item.id}`} className="flex items-center justify-between text-xs gap-1">
                              <span style={{ color: item.color }} className="font-medium truncate">{item.name}</span>
                              <div className="flex items-center shrink-0">
                                {item.price > 0 && (
                                  <span className="text-green-600 text-[10px] mr-1">${item.price.toFixed(2)}</span>
                                )}
                                <button
                                  onClick={() => {
                                    if (item.type === 'sauce') removeSauce(item.id)
                                    else if (item.type === 'cheese') removeCheese(item.id)
                                    else removeTopping(item.id)
                                  }}
                                  className="text-red-400 hover:text-red-600 font-bold"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-[10px] text-gray-300 italic">-</div>
                        )}
                      </div>
                    </div>
                  )
                }

                return rows.filter(row => row.show).map((row, rowIdx) => (
                  <div key={rowIdx} className="flex flex-wrap gap-2 justify-center">
                    {row.boxes.map(label => renderBox(label))}
                  </div>
                ))
              })()}
            </div>
          </div>

          {/* RIGHT: Toppings Grid - Compact */}
          <div className="w-64 flex flex-col shrink-0">
            <h3 className="text-xs font-bold text-gray-600 mb-1">TOPPINGS</h3>
            <div className="flex-1 overflow-y-auto space-y-2">
              {data.toppingCategories.map(cat => (
                <div key={cat}>
                  <div className="flex items-center gap-1 mb-0.5">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[cat] }} />
                    <span className="text-[10px] font-bold uppercase" style={{ color: CATEGORY_COLORS[cat] }}>{cat}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-0.5">
                    {data.toppingsByCategory[cat]?.map(topping => {
                      const selected = selectedToppings.find(t => t.toppingId === topping.id)
                      return (
                        <button
                          key={topping.id}
                          onClick={() => handleToppingClick(topping)}
                          className={`py-1 px-1.5 rounded text-[11px] text-left transition-all ${
                            selected
                              ? 'text-white shadow-md'
                              : 'bg-white hover:bg-gray-100 border border-gray-200'
                          }`}
                          style={{
                            backgroundColor: selected ? CATEGORY_COLORS[topping.category] : undefined,
                          }}
                        >
                          <span className="font-medium truncate block">{topping.name}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer - Compact */}
        <div className="px-4 py-2 border-t bg-gray-50 rounded-b-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span>{selectedSize?.name}: {formatCurrency(priceBreakdown.sizePrice)}</span>
              {priceBreakdown.crustPrice > 0 && <span>Crust: +{formatCurrency(priceBreakdown.crustPrice)}</span>}
              {priceBreakdown.toppingsPrice > 0 && <span>Toppings: +{formatCurrency(priceBreakdown.toppingsPrice)}</span>}
            </div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={specialNotes}
                onChange={(e) => setSpecialNotes(e.target.value)}
                placeholder="Special notes..."
                className="px-2 py-1 text-sm border rounded w-48"
              />
              <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-100">
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!selectedSize || !selectedCrust}
                className="px-6 py-2 rounded-lg bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold shadow-lg hover:shadow-xl disabled:opacity-50"
              >
                Add {formatCurrency(priceBreakdown.total)}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
