'use client'

import { useState, useCallback } from 'react'

interface ShiftData {
  id: string
  startedAt: string
  startingCash: number
  employee: { id: string; name: string; roleId?: string }
  locationId?: string
}

const SHIFT_KEY = 'gwi_current_shift'
const SHIFT_CHECKED_KEY = 'gwi_shift_checked'

function readSessionShift(): ShiftData | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(SHIFT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function readSessionShiftChecked(): boolean {
  if (typeof window === 'undefined') return false
  return sessionStorage.getItem(SHIFT_CHECKED_KEY) === '1'
}

export function useShiftManagement() {
  const [showTimeClockModal, setShowTimeClockModal] = useState(false)
  const [currentShift, _setCurrentShift] = useState<ShiftData | null>(readSessionShift)
  const [showShiftStartModal, setShowShiftStartModal] = useState(false)
  const [showShiftCloseoutModal, setShowShiftCloseoutModal] = useState(false)
  const [shiftChecked, _setShiftChecked] = useState(readSessionShiftChecked)

  const setCurrentShift = useCallback((shift: ShiftData | null) => {
    _setCurrentShift(shift)
    try {
      if (shift) {
        sessionStorage.setItem(SHIFT_KEY, JSON.stringify(shift))
      } else {
        sessionStorage.removeItem(SHIFT_KEY)
        sessionStorage.removeItem(SHIFT_CHECKED_KEY)
      }
    } catch { /* SSR or quota */ }
  }, [])

  const setShiftChecked = useCallback((checked: boolean) => {
    _setShiftChecked(checked)
    try {
      if (checked) {
        sessionStorage.setItem(SHIFT_CHECKED_KEY, '1')
      } else {
        sessionStorage.removeItem(SHIFT_CHECKED_KEY)
      }
    } catch { /* SSR or quota */ }
  }, [])

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
