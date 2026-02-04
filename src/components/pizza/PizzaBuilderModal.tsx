'use client'

import { useState, useEffect } from 'react'
import type {
  MenuItem,
  PizzaSpecialty,
  PizzaOrderConfig,
  PizzaConfig,
} from '@/types'
import { PizzaQuickBuilder } from './PizzaQuickBuilder'
import { PizzaVisualBuilder } from './PizzaVisualBuilder'

type BuilderMode = 'quick' | 'visual'

interface PizzaBuilderModalProps {
  item: MenuItem
  specialty?: PizzaSpecialty | null
  editingItem?: {
    id: string
    pizzaConfig?: PizzaOrderConfig
  } | null
  onConfirm: (config: PizzaOrderConfig) => void
  onCancel: () => void
}

/**
 * Pizza Builder Modal - Container component that switches between Quick and Visual modes
 *
 * Mode is determined by:
 * 1. Location's builderMode setting (quick, visual, or both)
 * 2. Location's defaultBuilderMode setting
 * 3. User can switch modes if allowModeSwitch is enabled
 */
export function PizzaBuilderModal({
  item,
  specialty,
  editingItem,
  onConfirm,
  onCancel,
}: PizzaBuilderModalProps) {
  const [mode, setMode] = useState<BuilderMode>('quick')
  const [config, setConfig] = useState<PizzaConfig | null>(null)
  const [loading, setLoading] = useState(true)

  // Load config to determine available modes
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch('/api/pizza/config')
        if (response.ok) {
          const data = await response.json()
          setConfig(data)

          // Set initial mode based on config
          const builderMode = data.builderMode || 'both'
          const defaultMode = data.defaultBuilderMode || 'quick'

          if (builderMode === 'quick') {
            setMode('quick')
          } else if (builderMode === 'visual') {
            setMode('visual')
          } else {
            // 'both' mode - use default
            setMode(defaultMode)
          }
        }
      } catch (error) {
        console.error('Failed to load pizza config:', error)
        // Default to quick mode on error
        setMode('quick')
      } finally {
        setLoading(false)
      }
    }

    fetchConfig()
  }, [])

  // Determine if mode switching is allowed
  const canSwitchMode = config?.builderMode === 'both' && config?.allowModeSwitch !== false

  // Handle mode switch
  const handleSwitchMode = () => {
    setMode(current => current === 'quick' ? 'visual' : 'quick')
  }

  // Show loading state briefly
  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-6 shadow-2xl">
          <div className="animate-spin w-6 h-6 border-3 border-orange-500 border-t-transparent rounded-full mx-auto" />
        </div>
      </div>
    )
  }

  // Render the appropriate builder
  if (mode === 'visual') {
    return (
      <PizzaVisualBuilder
        item={item}
        specialty={specialty}
        editingItem={editingItem}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onSwitchMode={canSwitchMode ? handleSwitchMode : undefined}
        showModeSwitch={canSwitchMode}
      />
    )
  }

  return (
    <PizzaQuickBuilder
      item={item}
      specialty={specialty}
      editingItem={editingItem}
      onConfirm={onConfirm}
      onCancel={onCancel}
      onSwitchMode={canSwitchMode ? handleSwitchMode : undefined}
      showModeSwitch={canSwitchMode}
    />
  )
}
