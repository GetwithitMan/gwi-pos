'use client'

import { useState } from 'react'

export function usePaymentFlow() {
  // Payment method (feeds into usePricing)
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('card')

  // Payment modal state
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [initialPayMethod, setInitialPayMethod] = useState<'cash' | 'credit' | undefined>(undefined)
  const [orderToPayId, setOrderToPayId] = useState<string | null>(null)
  const [paymentTabCards, setPaymentTabCards] = useState<Array<{ id: string; cardType: string; cardLast4: string; cardholderName?: string | null; authAmount: number; isDefault: boolean }>>([])

  // Discount modal state
  const [showDiscountModal, setShowDiscountModal] = useState(false)
  const [appliedDiscounts, setAppliedDiscounts] = useState<{ id: string; name: string; amount: number; percent?: number | null }[]>([])

  return {
    paymentMethod,
    setPaymentMethod,
    showPaymentModal,
    setShowPaymentModal,
    initialPayMethod,
    setInitialPayMethod,
    orderToPayId,
    setOrderToPayId,
    paymentTabCards,
    setPaymentTabCards,
    showDiscountModal,
    setShowDiscountModal,
    appliedDiscounts,
    setAppliedDiscounts,
  }
}
