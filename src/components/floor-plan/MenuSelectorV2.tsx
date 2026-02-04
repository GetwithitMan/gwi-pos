// src/components/floor-plan/MenuSelectorV2.tsx
'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFloorPlanStore, OrderItem } from './useFloorPlanStore'
import type { MenuItem, PizzaOrderConfig } from '@/types'

interface Category {
  id: string
  name: string
  color: string | null
  categoryType: string | null
}

interface MenuSelectorV2Props {
  locationId: string
  onItemSelect: (item: MenuItem) => void
  onOpenModifiers?: (
    item: MenuItem,
    onComplete: (modifiers: { id: string; name: string; price: number }[]) => void
  ) => void
  onOpenTimedRental?: (
    item: MenuItem,
    onComplete: (price: number, blockMinutes: number) => void
  ) => void
  onOpenPizzaBuilder?: (
    item: MenuItem,
    onComplete: (config: PizzaOrderConfig) => void
  ) => void
}

// Category types for grouping
const BAR_TYPES = ['liquor', 'drinks', 'cocktails', 'beer', 'wine']

/**
 * MenuSelectorV2 - Bottom panel for selecting menu items.
 * Shows when order panel is open.
 */
export const MenuSelectorV2: React.FC<MenuSelectorV2Props> = ({
  locationId,
  onItemSelect,
  onOpenModifiers,
  onOpenTimedRental,
  onOpenPizzaBuilder,
}) => {
  const { showOrderPanel, activeSeatNumber, activeSourceTableId, addOrderItem } = useFloorPlanStore()

  const [categories, setCategories] = useState<Category[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Load categories and menu items
  useEffect(() => {
    if (!locationId) return

    const load = async () => {
      setIsLoading(true)
      try {
        const res = await fetch(`/api/menu?locationId=${locationId}`)
        if (res.ok) {
          const data = await res.json()
          setCategories(data.categories || [])
          setMenuItems(data.items || [])
        }
      } catch (err) {
        console.error('Failed to load menu:', err)
      } finally {
        setIsLoading(false)
      }
    }

    load()
  }, [locationId])

  // Split categories into bar and food
  const { barCategories, foodCategories } = useMemo(() => {
    const bar: Category[] = []
    const food: Category[] = []

    categories.forEach(cat => {
      if (cat.categoryType && BAR_TYPES.includes(cat.categoryType)) {
        bar.push(cat)
      } else {
        food.push(cat)
      }
    })

    return { barCategories: bar, foodCategories: food }
  }, [categories])

  // Filter items by selected category
  const filteredItems = useMemo(() => {
    if (!selectedCategoryId) return []
    return menuItems.filter(item => item.categoryId === selectedCategoryId)
  }, [menuItems, selectedCategoryId])

  // Handle item click
  const handleItemClick = (item: MenuItem) => {
    // Timed rental items need special handling
    if (item.itemType === 'timed_rental' && onOpenTimedRental) {
      onOpenTimedRental(item, (price, blockMinutes) => {
        const newItem: OrderItem = {
          id: `temp-${crypto.randomUUID()}`,
          menuItemId: item.id,
          name: item.name,
          price,
          quantity: 1,
          modifiers: [],
          seatNumber: activeSeatNumber,
          sourceTableId: activeSourceTableId,
          blockTimeMinutes: blockMinutes,
        }
        addOrderItem(newItem)
      })
      return
    }

    // Pizza items need pizza builder (check itemType for pizza items)
    if (item.itemType === 'pizza' && onOpenPizzaBuilder) {
      onOpenPizzaBuilder(item, (config) => {
        // Pizza builder will handle creating the order item
        console.log('Pizza config:', config)
      })
      return
    }

    // Items with modifiers need modifier modal (check modifierGroupCount)
    const hasModifiers = (item.modifierGroupCount ?? 0) > 0
    if (hasModifiers && onOpenModifiers) {
      onOpenModifiers(item, (modifiers) => {
        const newItem: OrderItem = {
          id: `temp-${crypto.randomUUID()}`,
          menuItemId: item.id,
          name: item.name,
          price: item.price,
          quantity: 1,
          modifiers,
          seatNumber: activeSeatNumber,
          sourceTableId: activeSourceTableId,
        }
        addOrderItem(newItem)
      })
      return
    }

    // Simple item - add directly
    const newItem: OrderItem = {
      id: `temp-${crypto.randomUUID()}`,
      menuItemId: item.id,
      name: item.name,
      price: item.price,
      quantity: 1,
      modifiers: [],
      seatNumber: activeSeatNumber,
      sourceTableId: activeSourceTableId,
    }
    addOrderItem(newItem)

    // Also call onItemSelect for any additional handling
    onItemSelect(item)
  }

  // Format currency
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(price)
  }

  if (!showOrderPanel) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed bottom-0 left-0 right-96 bg-slate-800/95 backdrop-blur-sm border-t border-slate-700 z-30"
        style={{ maxHeight: '40vh' }}
      >
        {/* Categories */}
        <div className="border-b border-slate-700">
          {/* Food categories */}
          <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto">
            <span className="text-orange-400 text-xs font-semibold uppercase flex items-center gap-1 flex-shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              Food
            </span>
            {foodCategories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategoryId(cat.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${
                  selectedCategoryId === cat.id
                    ? 'bg-orange-600/30 text-orange-300 border border-orange-500/50'
                    : 'bg-slate-700/50 text-slate-300 hover:bg-slate-600/50 border border-transparent'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Bar categories */}
          {barCategories.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto border-t border-slate-700/50">
              <span className="text-blue-400 text-xs font-semibold uppercase flex items-center gap-1 flex-shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Bar
              </span>
              {barCategories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${
                    selectedCategoryId === cat.id
                      ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                      : 'bg-slate-700/50 text-slate-300 hover:bg-slate-600/50 border border-transparent'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Menu Items */}
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(40vh - 100px)' }}>
          {isLoading ? (
            <div className="p-8 text-center text-slate-400">Loading menu...</div>
          ) : !selectedCategoryId ? (
            <div className="p-8 text-center text-slate-400">
              Select a category to view items
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              No items in this category
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 p-4">
              {filteredItems.map(item => (
                <motion.button
                  key={item.id}
                  onClick={() => handleItemClick(item)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="p-3 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg text-left transition-colors border border-slate-600/50"
                >
                  <div className="text-sm font-medium text-white truncate">
                    {item.name}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-slate-400">
                      {formatPrice(item.price)}
                    </span>
                    {(item.modifierGroupCount ?? 0) > 0 && (
                      <span className="text-[10px] text-cyan-400">+mods</span>
                    )}
                    {item.itemType === 'timed_rental' && (
                      <span className="text-[10px] text-amber-400">timer</span>
                    )}
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
