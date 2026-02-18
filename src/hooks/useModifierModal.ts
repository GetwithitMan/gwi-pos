'use client'

import { useState } from 'react'
import type { MenuItem, ModifierGroup, PizzaOrderConfig } from '@/types'

export function useModifierModal() {
  const [showModifierModal, setShowModifierModal] = useState(false)
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null)
  const [itemModifierGroups, setItemModifierGroups] = useState<ModifierGroup[]>([])
  const [loadingModifiers, setLoadingModifiers] = useState(false)
  const [editingOrderItem, setEditingOrderItem] = useState<{
    id: string
    menuItemId: string
    modifiers: { id: string; name: string; price: number; depth: number; parentModifierId?: string }[]
    ingredientModifications?: { ingredientId: string; name: string; modificationType: 'no' | 'lite' | 'on_side' | 'extra' | 'swap'; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]
    specialNotes?: string
    pizzaConfig?: PizzaOrderConfig
  } | null>(null)

  return {
    showModifierModal,
    setShowModifierModal,
    selectedItem,
    setSelectedItem,
    itemModifierGroups,
    setItemModifierGroups,
    loadingModifiers,
    setLoadingModifiers,
    editingOrderItem,
    setEditingOrderItem,
  }
}
