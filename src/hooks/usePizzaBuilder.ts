'use client'

import { useState } from 'react'
import type { PizzaOrderConfig } from '@/types'

export function usePizzaBuilder() {
  const [showPizzaModal, setShowPizzaModal] = useState(false)
  const [selectedPizzaItem, setSelectedPizzaItem] = useState<import('@/types').MenuItem | null>(null)
  const [editingPizzaItem, setEditingPizzaItem] = useState<{
    id: string
    pizzaConfig?: PizzaOrderConfig
  } | null>(null)

  return {
    showPizzaModal,
    setShowPizzaModal,
    selectedPizzaItem,
    setSelectedPizzaItem,
    editingPizzaItem,
    setEditingPizzaItem,
  }
}
