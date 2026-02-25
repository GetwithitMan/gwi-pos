'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Ingredient, IngredientCategory, SwapGroup, InventoryItemRef, PrepItemRef } from '../types'

interface UseIngredientDataParams {
  locationId: string
  showInactive: boolean
  viewMode: 'list' | 'hierarchy'
}

export function useIngredientData({ locationId, showInactive, viewMode }: UseIngredientDataParams) {
  const [categories, setCategories] = useState<IngredientCategory[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [swapGroups, setSwapGroups] = useState<SwapGroup[]>([])
  const [inventoryItems, setInventoryItems] = useState<InventoryItemRef[]>([])
  const [prepItems, setPrepItems] = useState<PrepItemRef[]>([])
  const [deletedIngredients, setDeletedIngredients] = useState<Ingredient[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadCategories = useCallback(async (signal?: AbortSignal) => {
    try {
      const params = new URLSearchParams({
        locationId,
        includeInactive: 'true',
      })
      const response = await fetch(`/api/ingredient-categories?${params}`, { signal })
      if (response.ok) {
        const data = await response.json()
        setCategories(data.data || [])
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      console.error('Failed to load categories:', error)
    }
  }, [locationId])

  const loadIngredients = useCallback(async (signal?: AbortSignal) => {
    try {
      const params = new URLSearchParams({
        locationId,
        includeInactive: showInactive ? 'true' : 'false',
        visibility: 'all',
        // When in hierarchy mode, only fetch root ingredients with their children
        hierarchy: viewMode === 'hierarchy' ? 'true' : 'false',
      })
      const response = await fetch(`/api/ingredients?${params}`, { signal })
      if (response.ok) {
        const data = await response.json()
        setIngredients(data.data || [])
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      console.error('Failed to load ingredients:', error)
    }
  }, [locationId, showInactive, viewMode])

  const loadSwapGroups = useCallback(async (signal?: AbortSignal) => {
    try {
      const params = new URLSearchParams({ locationId })
      const response = await fetch(`/api/ingredient-swap-groups?${params}`, { signal })
      if (response.ok) {
        const data = await response.json()
        setSwapGroups(data.data || [])
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      console.error('Failed to load swap groups:', error)
    }
  }, [locationId])

  const loadInventoryItems = useCallback(async (signal?: AbortSignal) => {
    try {
      const params = new URLSearchParams({ locationId })
      const response = await fetch(`/api/inventory/items?${params}`, { signal })
      if (response.ok) {
        const data = await response.json()
        setInventoryItems(data.data || [])
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      console.error('Failed to load inventory items:', error)
    }
  }, [locationId])

  const loadPrepItems = useCallback(async (signal?: AbortSignal) => {
    try {
      const params = new URLSearchParams({ locationId })
      const response = await fetch(`/api/inventory/prep-items?${params}`, { signal })
      if (response.ok) {
        const data = await response.json()
        setPrepItems(data.data || [])
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      console.error('Failed to load prep items:', error)
    }
  }, [locationId])

  const loadDeletedIngredients = useCallback(async (signal?: AbortSignal) => {
    try {
      const params = new URLSearchParams({
        locationId,
        deletedOnly: 'true',
      })
      const response = await fetch(`/api/ingredients?${params}`, { signal })
      if (response.ok) {
        const data = await response.json()
        setDeletedIngredients(data.data || [])
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      console.error('Failed to load deleted ingredients:', error)
    }
  }, [locationId])

  useEffect(() => {
    const controller = new AbortController()
    const loadAll = async () => {
      setIsLoading(true)
      await Promise.all([
        loadCategories(controller.signal),
        loadIngredients(controller.signal),
        loadSwapGroups(controller.signal),
        loadInventoryItems(controller.signal),
        loadPrepItems(controller.signal),
        loadDeletedIngredients(controller.signal),
      ])
      if (!controller.signal.aborted) setIsLoading(false)
    }
    loadAll()
    return () => controller.abort()
  }, [loadCategories, loadIngredients, loadSwapGroups, loadInventoryItems, loadPrepItems, loadDeletedIngredients])

  return {
    categories,
    ingredients,
    swapGroups,
    inventoryItems,
    prepItems,
    deletedIngredients,
    isLoading,
    loadCategories,
    loadIngredients,
    loadDeletedIngredients,
  }
}
