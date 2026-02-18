'use client'

import { useState } from 'react'
import type { MenuItem } from '@/types'
import type { PrepaidPackage } from '@/lib/entertainment-pricing'

export function useTimedRentals() {
  const [showTimedRentalModal, setShowTimedRentalModal] = useState(false)
  const [selectedTimedItem, setSelectedTimedItem] = useState<MenuItem | null>(null)
  const [selectedRateType, setSelectedRateType] = useState<'per15Min' | 'per30Min' | 'perHour'>('perHour')
  const [activeSessions, setActiveSessions] = useState<{
    id: string
    menuItemId: string
    menuItemName: string
    startedAt: string
    rateType: string
    rateAmount: number
    orderItemId?: string
  }[]>([])
  const [loadingSession, setLoadingSession] = useState(false)
  const [showEntertainmentStart, setShowEntertainmentStart] = useState(false)
  const [entertainmentItem, setEntertainmentItem] = useState<{
    id: string
    name: string
    ratePerMinute?: number
    prepaidPackages?: PrepaidPackage[]
    happyHourEnabled?: boolean
    happyHourPrice?: number
  } | null>(null)

  return {
    showTimedRentalModal,
    setShowTimedRentalModal,
    selectedTimedItem,
    setSelectedTimedItem,
    selectedRateType,
    setSelectedRateType,
    activeSessions,
    setActiveSessions,
    loadingSession,
    setLoadingSession,
    showEntertainmentStart,
    setShowEntertainmentStart,
    entertainmentItem,
    setEntertainmentItem,
  }
}
