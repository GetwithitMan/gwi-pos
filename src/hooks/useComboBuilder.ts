'use client'

import { useState } from 'react'
import type { MenuItem } from '@/types'

export interface ComboTemplate {
  id: string
  basePrice: number
  comparePrice?: number | null
  components: {
    id: string
    slotName: string
    displayName: string
    isRequired: boolean
    minSelections: number
    maxSelections: number
    menuItemId?: string | null
    menuItem?: {
      id: string
      name: string
      price: number
      modifierGroups?: {
        modifierGroup: {
          id: string
          name: string
          displayName?: string | null
          minSelections: number
          maxSelections: number
          isRequired: boolean
          modifiers: {
            id: string
            name: string
            price: number
            childModifierGroupId?: string | null
          }[]
        }
      }[]
    } | null
    itemPriceOverride?: number | null
    modifierPriceOverrides?: Record<string, number> | null
    // Legacy fields
    options: { id: string; menuItemId: string; name: string; upcharge: number; isAvailable: boolean }[]
  }[]
}

export function useComboBuilder() {
  const [showComboModal, setShowComboModal] = useState(false)
  const [selectedComboItem, setSelectedComboItem] = useState<MenuItem | null>(null)
  const [comboTemplate, setComboTemplate] = useState<ComboTemplate | null>(null)
  // comboSelections maps componentId -> groupId -> modifierIds
  const [comboSelections, setComboSelections] = useState<Record<string, Record<string, string[]>>>({})

  return {
    showComboModal,
    setShowComboModal,
    selectedComboItem,
    setSelectedComboItem,
    comboTemplate,
    setComboTemplate,
    comboSelections,
    setComboSelections,
  }
}
