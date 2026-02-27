'use client'

import { useCallback, useEffect, useRef } from 'react'
import { usePOSLayout } from '@/hooks/usePOSLayout'
import type {
  BartenderPreferences,
  BartenderCategorySettings,
  BartenderItemSettings,
  BartenderItemCustomization,
  FavoriteItemRef,
} from '@/lib/settings'
import {
  getFavoritesKey,
  getCategorySettingsKey,
  getItemSettingsKey,
  getItemCustomizationsKey,
  getItemOrderKey,
  DEFAULT_CATEGORY_SETTINGS,
  DEFAULT_ITEM_SETTINGS,
} from '@/components/bartender/bartender-settings'

interface UseBartenderPreferencesOptions {
  employeeId?: string
  locationId?: string
  permissions?: { posLayout?: string[] }
}

const EMPTY_PREFS: BartenderPreferences = {
  favorites: [],
  categorySettings: DEFAULT_CATEGORY_SETTINGS,
  categoryOrder: [],
  itemSettings: DEFAULT_ITEM_SETTINGS,
  itemOrder: {},
  itemCustomizations: {},
}

export function useBartenderPreferences(options: UseBartenderPreferencesOptions) {
  const { employeeId } = options
  const { layout, isLoading, updateSetting } = usePOSLayout(options)
  const migratedRef = useRef(false)

  const prefs = layout.bartender ?? EMPTY_PREFS

  // --- One-time migration from localStorage ---
  useEffect(() => {
    if (!employeeId || isLoading || migratedRef.current) return
    if (layout.bartender) { migratedRef.current = true; return }

    // Check if there's any legacy data
    const favKey = getFavoritesKey(employeeId)
    const hasFavorites = localStorage.getItem(favKey)
    const hasCatSettings = localStorage.getItem(getCategorySettingsKey(employeeId))
    const hasItemSettings = localStorage.getItem(getItemSettingsKey(employeeId))
    const hasItemCustomizations = localStorage.getItem(getItemCustomizationsKey(employeeId))

    if (!hasFavorites && !hasCatSettings && !hasItemSettings && !hasItemCustomizations) {
      migratedRef.current = true
      return
    }

    try {
      const migrated: BartenderPreferences = { ...EMPTY_PREFS }

      if (hasFavorites) migrated.favorites = JSON.parse(hasFavorites)
      if (hasCatSettings) migrated.categorySettings = JSON.parse(hasCatSettings)
      if (hasItemSettings) migrated.itemSettings = JSON.parse(hasItemSettings)
      if (hasItemCustomizations) migrated.itemCustomizations = JSON.parse(hasItemCustomizations)

      // Migrate category order (stored in a separate key pattern)
      const catOrderKey = `bartender_category_order_${employeeId}`
      const catOrder = localStorage.getItem(catOrderKey)
      if (catOrder) migrated.categoryOrder = JSON.parse(catOrder)

      // Migrate per-category item orders — scan localStorage keys
      const itemOrderPrefix = `bartender_item_order_${employeeId}_`
      const itemOrders: Record<string, string[]> = {}
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith(itemOrderPrefix)) {
          const catId = key.slice(itemOrderPrefix.length)
          const val = localStorage.getItem(key)
          if (val) itemOrders[catId] = JSON.parse(val)
        }
      }
      if (Object.keys(itemOrders).length > 0) migrated.itemOrder = itemOrders

      updateSetting('bartender', migrated)

      // Clear legacy keys
      localStorage.removeItem(favKey)
      localStorage.removeItem(getCategorySettingsKey(employeeId))
      localStorage.removeItem(getItemSettingsKey(employeeId))
      localStorage.removeItem(getItemCustomizationsKey(employeeId))
      localStorage.removeItem(catOrderKey)
      for (const key of Object.keys(itemOrders)) {
        localStorage.removeItem(`${itemOrderPrefix}${key}`)
      }

      console.log('[BartenderPrefs] Migrated localStorage → server for', employeeId)
    } catch (e) {
      console.error('[BartenderPrefs] Migration failed:', e)
    }

    migratedRef.current = true
  }, [employeeId, isLoading, layout.bartender, updateSetting])

  // --- Helpers to update a sub-key inside bartender prefs ---
  const update = useCallback((patch: Partial<BartenderPreferences>) => {
    const current = layout.bartender ?? EMPTY_PREFS
    updateSetting('bartender', { ...current, ...patch })
  }, [layout.bartender, updateSetting])

  // --- Typed setters ---
  const setFavorites = useCallback((favorites: FavoriteItemRef[]) => {
    update({ favorites })
  }, [update])

  const setCategorySettings = useCallback((categorySettings: BartenderCategorySettings) => {
    update({ categorySettings })
  }, [update])

  const setCategoryOrder = useCallback((categoryOrder: string[]) => {
    update({ categoryOrder })
  }, [update])

  const setItemSettings = useCallback((itemSettings: BartenderItemSettings) => {
    update({ itemSettings })
  }, [update])

  const setItemCustomization = useCallback((menuItemId: string, customization: BartenderItemCustomization | null) => {
    const current = layout.bartender?.itemCustomizations ?? {}
    const updated = { ...current }
    if (customization === null) {
      delete updated[menuItemId]
    } else {
      updated[menuItemId] = customization
    }
    update({ itemCustomizations: updated })
  }, [layout.bartender?.itemCustomizations, update])

  const setItemOrder = useCallback((categoryId: string, order: string[]) => {
    const current = layout.bartender?.itemOrder ?? {}
    update({ itemOrder: { ...current, [categoryId]: order } })
  }, [layout.bartender?.itemOrder, update])

  const resetItemOrder = useCallback((categoryId: string) => {
    const current = layout.bartender?.itemOrder ?? {}
    const updated = { ...current }
    delete updated[categoryId]
    update({ itemOrder: updated })
  }, [layout.bartender?.itemOrder, update])

  const resetAllItemCustomizations = useCallback(() => {
    update({ itemCustomizations: {} })
  }, [update])

  return {
    isLoading,
    favorites: prefs.favorites,
    categorySettings: prefs.categorySettings,
    categoryOrder: prefs.categoryOrder,
    itemSettings: prefs.itemSettings,
    itemCustomizations: prefs.itemCustomizations,
    itemOrder: prefs.itemOrder,
    getItemOrder: (categoryId: string) => prefs.itemOrder[categoryId] ?? [],
    setFavorites,
    setCategorySettings,
    setCategoryOrder,
    setItemSettings,
    setItemCustomization,
    setItemOrder,
    resetItemOrder,
    resetAllItemCustomizations,
  }
}
