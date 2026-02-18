'use client'

import { useState } from 'react'

export function useItemOperations() {
  // Comp/Void modal state
  const [showCompVoidModal, setShowCompVoidModal] = useState(false)

  // Resend modal state (replaces blocking prompt/alert)
  const [resendModal, setResendModal] = useState<{ itemId: string; itemName: string } | null>(null)
  const [resendNote, setResendNote] = useState('')
  const [resendLoading, setResendLoading] = useState(false)
  const [compVoidItem, setCompVoidItem] = useState<{
    id: string
    menuItemId?: string
    name: string
    quantity: number
    price: number
    modifiers: { id: string; name: string; price: number; depth?: number; preModifier?: string | null; modifierId?: string | null; spiritTier?: string | null; linkedBottleProductId?: string | null; parentModifierId?: string | null }[]
    status?: string
    voidReason?: string
  } | null>(null)

  return {
    showCompVoidModal, setShowCompVoidModal,
    resendModal, setResendModal,
    resendNote, setResendNote,
    resendLoading, setResendLoading,
    compVoidItem, setCompVoidItem,
  }
}
