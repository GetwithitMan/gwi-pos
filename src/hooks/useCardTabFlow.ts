'use client'

import { useState, useEffect, useRef } from 'react'

export function useCardTabFlow(currentOrder: { id?: string } | null) {
  const [showCardTabFlow, setShowCardTabFlow] = useState(false)
  const [cardTabOrderId, setCardTabOrderId] = useState<string | null>(null)
  const [tabCardInfo, setTabCardInfo] = useState<{ cardholderName?: string; cardLast4?: string; cardType?: string } | null>(null)

  // Clear tab card info only when order transitions FROM something TO null
  // (not when currentOrder is already null — avoids race with async order loading)
  const prevOrderRef = useRef(currentOrder)
  useEffect(() => {
    if (prevOrderRef.current && !currentOrder) {
      setTabCardInfo(null)
      setCardTabOrderId(null)
    }
    prevOrderRef.current = currentOrder
  }, [currentOrder])

  return {
    showCardTabFlow,
    setShowCardTabFlow,
    cardTabOrderId,
    setCardTabOrderId,
    tabCardInfo,
    setTabCardInfo,
  }
}
