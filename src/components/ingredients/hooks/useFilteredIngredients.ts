'use client'

import { useMemo } from 'react'
import type { Ingredient, IngredientCategory } from '../types'

export interface GroupedIngredients {
  category: IngredientCategory
  ingredients: Ingredient[]
}

export function useFilteredIngredients(
  categories: IngredientCategory[],
  ingredients: Ingredient[],
  search: string,
  selectedCategory: string,
) {
  // Group ingredients by category
  const groupedIngredients = useMemo(() => {
    const groups = categories.map(category => ({
      category,
      ingredients: ingredients.filter(ing => ing.categoryId === category.id),
    }))

    // Add uncategorized group
    const uncategorized = ingredients.filter(ing => !ing.categoryId)
    if (uncategorized.length > 0) {
      groups.push({
        category: {
          id: 'uncategorized',
          code: 999,
          name: 'Uncategorized',
          icon: '?',
          color: '#6b7280',
          sortOrder: 9999,
          isActive: true,
        },
        ingredients: uncategorized,
      })
    }

    return groups
  }, [categories, ingredients])

  // Filter by search and selected category
  const filteredGroups = useMemo(() => {
    const searchLower = search.toLowerCase()

    // Check if ingredient or any of its children match the search
    const matchesSearch = (ing: Ingredient): boolean => {
      if (!search) return true
      if (ing.name.toLowerCase().includes(searchLower)) return true
      // Also search child (prep) ingredient names
      if (ing.childIngredients?.some(child => child.name.toLowerCase().includes(searchLower))) return true
      return false
    }

    return groupedIngredients
      .filter(group => !selectedCategory || group.category.id === selectedCategory)
      .map(group => ({
        ...group,
        ingredients: group.ingredients.filter(matchesSearch),
      }))
      .filter(group => group.ingredients.length > 0 || !search)
  }, [groupedIngredients, selectedCategory, search])

  // Filtered ingredients for hierarchy view (applies same search + category filters)
  const filteredIngredients = useMemo(() => {
    return filteredGroups.flatMap(group => group.ingredients)
  }, [filteredGroups])

  return {
    filteredGroups,
    filteredIngredients,
  }
}
