'use client'

import { useState } from 'react'

interface ShiftData {
  id: string
  startedAt: string
  startingCash: number
  employee: { id: string; name: string; roleId?: string }
  locationId?: string
}

export function useShiftManagement() {
  const [showTimeClockModal, setShowTimeClockModal] = useState(false)
  const [currentShift, setCurrentShift] = useState<ShiftData | null>(null)
  const [showShiftStartModal, setShowShiftStartModal] = useState(false)
  const [showShiftCloseoutModal, setShowShiftCloseoutModal] = useState(false)
  const [shiftChecked, setShiftChecked] = useState(false)

  return {
    showTimeClockModal,
    setShowTimeClockModal,
    currentShift,
    setCurrentShift,
    showShiftStartModal,
    setShowShiftStartModal,
    showShiftCloseoutModal,
    setShowShiftCloseoutModal,
    shiftChecked,
    setShiftChecked,
  }
}
