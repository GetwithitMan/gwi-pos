'use client'

import { useMemo, useState } from 'react'
import {
  useSensor,
  useSensors,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { Category, MenuItem } from '../types'

interface UseMenuCategoriesOptions {
  categories: Category[]
  menuItems: MenuItem[]
  selectedCategory: string | null
  currentMode: 'bar' | 'food'
  categoryOrder: string[] | null
  setCategoryOrder: (order: string[]) => void
}

export function useMenuCategories(options: UseMenuCategoriesOptions) {
  const {
    categories,
    menuItems,
    selectedCategory,
    currentMode,
    categoryOrder,
    setCategoryOrder,
  } = options

  const [isEditingCategories, setIsEditingCategories] = useState(false)

  // DnD sensors for category reordering
  const categorySensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Sort categories based on custom order or default mode-based sorting
  const sortedCategories = useMemo(() => {
    if (categoryOrder && categoryOrder.length > 0) {
      const orderedCategories: Category[] = []
      const remainingCategories = [...categories]

      for (const id of categoryOrder) {
        const index = remainingCategories.findIndex(c => c.id === id)
        if (index !== -1) {
          orderedCategories.push(remainingCategories[index])
          remainingCategories.splice(index, 1)
        }
      }

      return [...orderedCategories, ...remainingCategories]
    }

    const barTypes = ['liquor', 'drinks', 'cocktails', 'beer', 'wine']
    const foodTypes = ['food', 'combos', 'appetizers', 'entrees']

    return [...categories].sort((a, b) => {
      const aType = a.categoryType || 'food'
      const bType = b.categoryType || 'food'

      if (currentMode === 'bar') {
        const aIsBar = barTypes.includes(aType)
        const bIsBar = barTypes.includes(bType)
        if (aIsBar && !bIsBar) return -1
        if (!aIsBar && bIsBar) return 1
      } else {
        const aIsFood = foodTypes.includes(aType) || !barTypes.includes(aType)
        const bIsFood = foodTypes.includes(bType) || !barTypes.includes(bType)
        if (aIsFood && !bIsFood) return -1
        if (!aIsFood && bIsFood) return 1
      }

      return 0
    })
  }, [categories, currentMode, categoryOrder])

  // Handle category drag end
  const handleCategoryDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = sortedCategories.findIndex(c => c.id === active.id)
      const newIndex = sortedCategories.findIndex(c => c.id === over.id)
      const newOrder = arrayMove(sortedCategories, oldIndex, newIndex).map(c => c.id)
      setCategoryOrder(newOrder)
    }
  }

  // Filtered items for the selected category (memoized to avoid O(n) filter on every render)
  // Pizza category guard: when a pizza category is selected, also include pizza items
  // from other pizza categories (prevents items from disappearing if miscategorized)
  const selectedCategoryData = categories.find(c => c.id === selectedCategory)
  const isPizzaCategorySelected = selectedCategoryData?.categoryType === 'pizza'
  const pizzaCategoryIds = useMemo(() => {
    if (!isPizzaCategorySelected) return new Set<string>()
    return new Set(categories.filter(c => c.categoryType === 'pizza').map(c => c.id))
  }, [categories, isPizzaCategorySelected])

  const { filteredItems, unavailableItems, uncategorizedPizzaItems } = useMemo(() => {
    const filtered = menuItems.filter(item => {
      if (item.categoryId === selectedCategory) return item.isAvailable
      // Pizza guard: include pizza items (itemType === 'pizza') that belong to any pizza category
      if (isPizzaCategorySelected && item.itemType === 'pizza' && item.isAvailable) {
        // Include pizza items that have no category or belong to another pizza category
        if (!item.categoryId || pizzaCategoryIds.has(item.categoryId)) return true
      }
      return false
    })
    const unavailable = menuItems.filter(
      item => item.categoryId === selectedCategory && !item.isAvailable
    )
    // Track uncategorized pizza items for admin warning
    const uncategorizedPizza = menuItems.filter(
      item => item.itemType === 'pizza' && !item.categoryId
    )
    return { filteredItems: filtered, unavailableItems: unavailable, uncategorizedPizzaItems: uncategorizedPizza }
  }, [menuItems, selectedCategory, isPizzaCategorySelected, pizzaCategoryIds])

  return {
    isEditingCategories,
    setIsEditingCategories,
    categorySensors,
    sortedCategories,
    handleCategoryDragEnd,
    filteredItems,
    unavailableItems,
    selectedCategoryData,
    uncategorizedPizzaItems,
  }
}
