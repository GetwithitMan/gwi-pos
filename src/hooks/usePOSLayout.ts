'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { POSLayoutSettings, DEFAULT_LAYOUT_SETTINGS, CategoryColorOverride, MenuItemCustomization } from '@/lib/settings'

interface UsePOSLayoutOptions {
  employeeId?: string
  locationId?: string
  permissions?: {
    posLayout?: string[]
  }
}

interface UsePOSLayoutReturn {
  layout: POSLayoutSettings
  isLoading: boolean
  canCustomize: boolean      // Has permission to customize personal layout
  canCustomizeGlobal: boolean // Has permission to customize global (admin)

  // Mode controls
  currentMode: 'bar' | 'food'
  setMode: (mode: 'bar' | 'food') => void

  // Favorites controls
  favorites: string[]        // Current mode's favorites
  addFavorite: (menuItemId: string) => void
  removeFavorite: (menuItemId: string) => void
  reorderFavorites: (menuItemIds: string[]) => void

  // Quick Bar controls (mode-independent personal favorites)
  quickBar: string[]
  quickBarEnabled: boolean
  addToQuickBar: (menuItemId: string) => void
  removeFromQuickBar: (menuItemId: string) => void
  reorderQuickBar: (menuItemIds: string[]) => void
  toggleQuickBar: () => void
  isInQuickBar: (menuItemId: string) => boolean

  // Category controls
  categoryOrder: string[]    // Current mode's category order
  setCategoryOrder: (categoryIds: string[]) => void
  hiddenCategories: string[] // Current mode's hidden categories
  toggleCategoryVisibility: (categoryId: string) => void

  // Category color controls
  categoryColors: { [categoryId: string]: CategoryColorOverride }
  setCategoryColor: (categoryId: string, colors: CategoryColorOverride) => void
  resetCategoryColor: (categoryId: string) => void
  resetAllCategoryColors: () => void

  // Menu item customization controls
  menuItemColors: { [menuItemId: string]: MenuItemCustomization }
  setMenuItemStyle: (menuItemId: string, style: MenuItemCustomization) => void
  resetMenuItemStyle: (menuItemId: string) => void
  resetAllMenuItemStyles: () => void

  // Settings controls
  updateSetting: <K extends keyof POSLayoutSettings>(key: K, value: POSLayoutSettings[K]) => void
  saveLayout: () => Promise<boolean>
  resetToDefaults: () => void
}

export function usePOSLayout(options: UsePOSLayoutOptions = {}): UsePOSLayoutReturn {
  const { employeeId, locationId, permissions } = options

  const [layout, setLayout] = useState<POSLayoutSettings>(DEFAULT_LAYOUT_SETTINGS)
  const [isLoading, setIsLoading] = useState(true)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Use ref to track latest layout for saving without recreating callbacks
  const layoutRef = useRef(layout)
  useEffect(() => {
    layoutRef.current = layout
  }, [layout])

  // Check permissions
  const canCustomize = permissions?.posLayout?.includes('customize_personal') ||
                       permissions?.posLayout?.includes('customize_global') || false
  const canCustomizeGlobal = permissions?.posLayout?.includes('customize_global') || false

  // Load layout settings
  const loadLayout = useCallback(async () => {
    if (!employeeId) {
      console.log('[POS Layout] Load skipped - no employeeId')
      setIsLoading(false)
      return
    }

    try {
      console.log('[POS Layout] Loading layout for employee:', employeeId)
      const response = await fetch(`/api/employees/${employeeId}/layout`)
      if (response.ok) {
        const data = await response.json()
        console.log('[POS Layout] Loaded layout:', data)
        setLayout({ ...DEFAULT_LAYOUT_SETTINGS, ...data.layout })
      } else {
        console.error('[POS Layout] Load failed with status:', response.status)
      }
    } catch (error) {
      console.error('[POS Layout] Load error:', error)
    } finally {
      setIsLoading(false)
    }
  }, [employeeId])

  // Save layout settings - uses ref to get latest layout
  const saveLayout = useCallback(async (): Promise<boolean> => {
    if (!employeeId || !canCustomize) {
      console.log('[POS Layout] Save skipped - no employeeId or no permission', { employeeId, canCustomize })
      return false
    }

    const currentLayout = layoutRef.current
    try {
      console.log('[POS Layout] Saving layout...', { employeeId, layout: currentLayout })
      const response = await fetch(`/api/employees/${employeeId}/layout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: currentLayout }),
      })

      if (response.ok) {
        const data = await response.json()
        console.log('[POS Layout] Save successful', data)
        setHasUnsavedChanges(false)
        return true
      } else {
        const errorData = await response.json().catch(() => ({}))
        console.error('[POS Layout] Save failed with status', response.status, errorData)
      }
    } catch (error) {
      console.error('[POS Layout] Save error:', error)
    }
    return false
  }, [employeeId, canCustomize]) // Removed layout from deps - using ref instead

  // Auto-save when layout changes (debounced)
  useEffect(() => {
    if (!hasUnsavedChanges) {
      return
    }
    if (!canCustomize) {
      console.log('[POS Layout] Auto-save skipped - canCustomize is false')
      return
    }

    console.log('[POS Layout] Auto-save scheduled in 1 second...')
    const timer = setTimeout(() => {
      console.log('[POS Layout] Auto-save executing now...')
      saveLayout()
    }, 1000) // Debounce 1 second

    return () => {
      console.log('[POS Layout] Auto-save timer cleared')
      clearTimeout(timer)
    }
  }, [hasUnsavedChanges, saveLayout, canCustomize])

  // Load on mount
  useEffect(() => {
    loadLayout()
  }, [loadLayout])

  // Update a single setting
  const updateSetting = useCallback(<K extends keyof POSLayoutSettings>(
    key: K,
    value: POSLayoutSettings[K]
  ) => {
    setLayout(prev => ({ ...prev, [key]: value }))
    setHasUnsavedChanges(true)
  }, [])

  // Mode controls
  const setMode = useCallback((mode: 'bar' | 'food') => {
    updateSetting('currentMode', mode)
  }, [updateSetting])

  // Get current mode's favorites
  const favorites = layout.currentMode === 'bar' ? layout.barFavorites : layout.foodFavorites

  // Favorites controls
  const addFavorite = useCallback((menuItemId: string) => {
    const key = layout.currentMode === 'bar' ? 'barFavorites' : 'foodFavorites'
    const current = layout[key]

    if (current.includes(menuItemId)) return
    if (current.length >= layout.maxFavorites) return

    updateSetting(key, [...current, menuItemId])
  }, [layout, updateSetting])

  const removeFavorite = useCallback((menuItemId: string) => {
    const key = layout.currentMode === 'bar' ? 'barFavorites' : 'foodFavorites'
    const current = layout[key]

    updateSetting(key, current.filter(id => id !== menuItemId))
  }, [layout, updateSetting])

  const reorderFavorites = useCallback((menuItemIds: string[]) => {
    const key = layout.currentMode === 'bar' ? 'barFavorites' : 'foodFavorites'
    updateSetting(key, menuItemIds)
  }, [layout.currentMode, updateSetting])

  // Quick Bar controls (mode-independent)
  const quickBar = layout.quickBar || []
  const quickBarEnabled = layout.quickBarEnabled ?? true

  const addToQuickBar = useCallback((menuItemId: string) => {
    const current = layout.quickBar || []
    if (current.includes(menuItemId)) return
    if (current.length >= (layout.maxQuickBarItems || 12)) return
    updateSetting('quickBar', [...current, menuItemId])
  }, [layout.quickBar, layout.maxQuickBarItems, updateSetting])

  const removeFromQuickBar = useCallback((menuItemId: string) => {
    const current = layout.quickBar || []
    updateSetting('quickBar', current.filter(id => id !== menuItemId))
  }, [layout.quickBar, updateSetting])

  const reorderQuickBar = useCallback((menuItemIds: string[]) => {
    updateSetting('quickBar', menuItemIds)
  }, [updateSetting])

  const toggleQuickBar = useCallback(() => {
    updateSetting('quickBarEnabled', !layout.quickBarEnabled)
  }, [layout.quickBarEnabled, updateSetting])

  const isInQuickBar = useCallback((menuItemId: string) => {
    return (layout.quickBar || []).includes(menuItemId)
  }, [layout.quickBar])

  // Category controls
  const categoryOrder = layout.currentMode === 'bar' ? layout.barCategoryOrder : layout.foodCategoryOrder
  const hiddenCategories = layout.currentMode === 'bar' ? layout.barHiddenCategories : layout.foodHiddenCategories

  const setCategoryOrder = useCallback((categoryIds: string[]) => {
    const key = layout.currentMode === 'bar' ? 'barCategoryOrder' : 'foodCategoryOrder'
    updateSetting(key, categoryIds)
  }, [layout.currentMode, updateSetting])

  const toggleCategoryVisibility = useCallback((categoryId: string) => {
    const key = layout.currentMode === 'bar' ? 'barHiddenCategories' : 'foodHiddenCategories'
    const current = layout[key]

    if (current.includes(categoryId)) {
      updateSetting(key, current.filter(id => id !== categoryId))
    } else {
      updateSetting(key, [...current, categoryId])
    }
  }, [layout, updateSetting])

  // Category color controls
  const categoryColors = layout.categoryColors || {}

  const setCategoryColor = useCallback((categoryId: string, colors: CategoryColorOverride) => {
    const newColors = { ...layout.categoryColors, [categoryId]: colors }
    updateSetting('categoryColors', newColors)
  }, [layout.categoryColors, updateSetting])

  const resetCategoryColor = useCallback((categoryId: string) => {
    const newColors = { ...layout.categoryColors }
    delete newColors[categoryId]
    updateSetting('categoryColors', newColors)
  }, [layout.categoryColors, updateSetting])

  const resetAllCategoryColors = useCallback(() => {
    updateSetting('categoryColors', {})
  }, [updateSetting])

  // Menu item customization controls
  const menuItemColors = layout.menuItemColors || {}

  const setMenuItemStyle = useCallback((menuItemId: string, style: MenuItemCustomization) => {
    const newStyles = { ...layout.menuItemColors, [menuItemId]: style }
    updateSetting('menuItemColors', newStyles)
  }, [layout.menuItemColors, updateSetting])

  const resetMenuItemStyle = useCallback((menuItemId: string) => {
    const newStyles = { ...layout.menuItemColors }
    delete newStyles[menuItemId]
    updateSetting('menuItemColors', newStyles)
  }, [layout.menuItemColors, updateSetting])

  const resetAllMenuItemStyles = useCallback(() => {
    updateSetting('menuItemColors', {})
  }, [updateSetting])

  // Reset to defaults
  const resetToDefaults = useCallback(() => {
    setLayout(DEFAULT_LAYOUT_SETTINGS)
    setHasUnsavedChanges(true)
  }, [])

  return {
    layout,
    isLoading,
    canCustomize,
    canCustomizeGlobal,

    currentMode: layout.currentMode,
    setMode,

    favorites,
    addFavorite,
    removeFavorite,
    reorderFavorites,

    quickBar,
    quickBarEnabled,
    addToQuickBar,
    removeFromQuickBar,
    reorderQuickBar,
    toggleQuickBar,
    isInQuickBar,

    categoryOrder,
    setCategoryOrder,
    hiddenCategories,
    toggleCategoryVisibility,

    categoryColors,
    setCategoryColor,
    resetCategoryColor,
    resetAllCategoryColors,

    menuItemColors,
    setMenuItemStyle,
    resetMenuItemStyle,
    resetAllMenuItemStyles,

    updateSetting,
    saveLayout,
    resetToDefaults,
  }
}
