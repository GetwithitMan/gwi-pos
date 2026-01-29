'use client'

import { useState, useEffect, useCallback } from 'react'
import type { POSDisplaySettings } from '@/lib/settings'

const DEFAULT_POS_DISPLAY: POSDisplaySettings = {
  menuItemSize: 'normal',
  menuItemsPerRow: 5,
  categorySize: 'md',
  orderPanelWidth: 'normal',
  categoryColorMode: 'solid',
  categoryButtonBgColor: null,
  categoryButtonTextColor: null,
  showPriceOnMenuItems: true,
}

// CSS class mappings for each setting
const MENU_ITEM_CLASSES = {
  compact: 'h-16 text-sm',       // 64px - maximum items visible
  normal: 'h-20 text-base',      // 80px - balanced view
  large: 'h-28 text-base',       // 112px - current/legacy size
} as const

const GRID_COLS_CLASSES = {
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
} as const

const ORDER_PANEL_CLASSES = {
  narrow: 'w-64',    // 256px
  normal: 'w-80',    // 320px (current)
  wide: 'w-96',      // 384px
} as const

export function usePOSDisplay() {
  const [settings, setSettings] = useState<POSDisplaySettings>(DEFAULT_POS_DISPLAY)
  const [isLoading, setIsLoading] = useState(true)

  const loadSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/settings')
      if (response.ok) {
        const data = await response.json()
        const posDisplay = data.settings?.posDisplay || data.posDisplay
        if (posDisplay) {
          setSettings({ ...DEFAULT_POS_DISPLAY, ...posDisplay })
        }
      }
    } catch (error) {
      console.error('Failed to load POS display settings:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const saveSettings = useCallback(async (newSettings: POSDisplaySettings) => {
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ posDisplay: newSettings }),
      })
      if (response.ok) {
        setSettings(newSettings)
        return true
      }
    } catch (error) {
      console.error('Failed to save POS display settings:', error)
    }
    return false
  }, [])

  const updateSetting = useCallback(<K extends keyof POSDisplaySettings>(
    key: K,
    value: POSDisplaySettings[K]
  ) => {
    const newSettings = { ...settings, [key]: value }
    setSettings(newSettings)
    saveSettings(newSettings)
  }, [settings, saveSettings])

  // Batch update multiple settings at once
  const updateSettings = useCallback((updates: Partial<POSDisplaySettings>) => {
    const newSettings = { ...settings, ...updates }
    setSettings(newSettings)
    saveSettings(newSettings)
  }, [settings, saveSettings])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // Computed CSS classes based on settings
  const menuItemClass = MENU_ITEM_CLASSES[settings.menuItemSize]
  const gridColsClass = GRID_COLS_CLASSES[settings.menuItemsPerRow]
  const orderPanelClass = ORDER_PANEL_CLASSES[settings.orderPanelWidth]

  return {
    settings,
    isLoading,
    reloadSettings: loadSettings,
    saveSettings,
    updateSetting,
    updateSettings,
    // Pre-computed classes for easy use
    menuItemClass,
    gridColsClass,
    orderPanelClass,
    categorySize: settings.categorySize,
    categoryColorMode: settings.categoryColorMode,
    categoryButtonBgColor: settings.categoryButtonBgColor,
    categoryButtonTextColor: settings.categoryButtonTextColor,
    showPriceOnMenuItems: settings.showPriceOnMenuItems,
  }
}

// Export types for external use
export type { POSDisplaySettings }
