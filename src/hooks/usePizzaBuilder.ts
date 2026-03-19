'use client'

import { useState } from 'react'
import type { PizzaOrderConfig, PizzaSpecialty } from '@/types'

export function usePizzaBuilder() {
  const [showPizzaModal, setShowPizzaModal] = useState(false)
  const [selectedPizzaItem, setSelectedPizzaItem] = useState<import('@/types').MenuItem | null>(null)
  const [selectedPizzaSpecialty, setSelectedPizzaSpecialty] = useState<PizzaSpecialty | null>(null)
  const [editingPizzaItem, setEditingPizzaItem] = useState<{
    id: string
    pizzaConfig?: PizzaOrderConfig
  } | null>(null)

  return {
    showPizzaModal,
    setShowPizzaModal,
    selectedPizzaItem,
    setSelectedPizzaItem,
    selectedPizzaSpecialty,
    setSelectedPizzaSpecialty,
    editingPizzaItem,
    setEditingPizzaItem,
  }
}
