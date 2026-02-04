'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { SeatInfo, calculateAllSeatBalances, OrderItemForSeat, PaymentForSeat } from '@/lib/seat-utils'

interface SeatingState {
  baseSeatCount: number
  extraSeatCount: number
  totalSeats: number
  seatVersion: number
  seats: SeatInfo[]
  isLoading: boolean
  error: string | null
}

interface UseSeatingOptions {
  orderId: string | null
  items?: OrderItemForSeat[]
  payments?: PaymentForSeat[]
  taxRate?: number
  enabled?: boolean
}

interface UseSeatingReturn {
  // State
  seats: SeatInfo[]
  totalSeats: number
  seatVersion: number
  isLoading: boolean
  error: string | null

  // Actions
  addSeat: (afterPosition?: number) => Promise<boolean>
  removeSeat: (position: number) => Promise<boolean>
  refreshSeating: () => Promise<void>

  // Computed
  sharedItemsCount: number
  sharedItemsTotal: number
}

/**
 * useSeating - Manages atomic seat operations for an order
 *
 * Can work in two modes:
 * 1. API mode: Fetches seating info from server (default)
 * 2. Local mode: Calculates from provided items (when items prop is passed)
 */
export function useSeating(options: UseSeatingOptions): UseSeatingReturn {
  const { orderId, items, payments, taxRate = 0.08, enabled = true } = options

  const [state, setState] = useState<SeatingState>({
    baseSeatCount: 1,
    extraSeatCount: 0,
    totalSeats: 1,
    seatVersion: 0,
    seats: [],
    isLoading: false,
    error: null,
  })

  const [sharedItems, setSharedItems] = useState({ count: 0, total: 0 })

  // Track if we're using local calculation mode
  const isLocalMode = !!items
  const abortRef = useRef<AbortController | null>(null)

  /**
   * Fetch seating info from API
   */
  const fetchSeating = useCallback(async () => {
    if (!orderId || isLocalMode) return

    // Abort any in-flight request
    if (abortRef.current) {
      abortRef.current.abort()
    }

    const controller = new AbortController()
    abortRef.current = controller

    setState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      const response = await fetch(`/api/orders/${orderId}/seating`, {
        signal: controller.signal,
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to fetch seating')
      }

      const data = await response.json()

      setState({
        baseSeatCount: data.baseSeatCount,
        extraSeatCount: data.extraSeatCount,
        totalSeats: data.totalSeats,
        seatVersion: data.seatVersion,
        seats: data.seatBalances,
        isLoading: false,
        error: null,
      })

      setSharedItems({
        count: data.sharedItems?.itemCount || 0,
        total: data.sharedItems?.subtotal || 0,
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return // Request was cancelled
      }

      console.error('[useSeating] Failed to fetch:', err)
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch seating',
      }))
    }
  }, [orderId, isLocalMode])

  /**
   * Calculate seating locally from items
   */
  const calculateLocalSeating = useCallback(() => {
    if (!items) return

    // Determine total seats from items or default to max seatNumber
    const maxSeatFromItems = Math.max(
      1,
      ...items.map(item => item.seatNumber || 0)
    )

    const seats = calculateAllSeatBalances(
      items,
      maxSeatFromItems,
      payments || [],
      taxRate
    )

    // Calculate shared items (no seat number)
    const sharedItemsList = items.filter(item => !item.seatNumber)
    const sharedTotal = sharedItemsList.reduce((sum, item) => {
      const itemBase = Number(item.price) * item.quantity
      const modTotal = (item.modifiers || []).reduce((m, mod) => m + Number(mod.price), 0) * item.quantity
      return sum + itemBase + modTotal
    }, 0)

    setState(prev => ({
      ...prev,
      totalSeats: maxSeatFromItems,
      seats,
    }))

    setSharedItems({
      count: sharedItemsList.reduce((sum, item) => sum + item.quantity, 0),
      total: Math.round(sharedTotal * 100) / 100,
    })
  }, [items, payments, taxRate])

  // Effect: Fetch or calculate seating
  useEffect(() => {
    if (!enabled) return

    if (isLocalMode) {
      calculateLocalSeating()
    } else if (orderId) {
      fetchSeating()
    }

    return () => {
      if (abortRef.current) {
        abortRef.current.abort()
      }
    }
  }, [enabled, isLocalMode, orderId, calculateLocalSeating, fetchSeating])

  /**
   * Add a seat at a position (shifts higher seats up)
   */
  const addSeat = useCallback(async (afterPosition?: number): Promise<boolean> => {
    if (!orderId) return false

    const position = afterPosition || state.totalSeats + 1

    setState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      const response = await fetch(`/api/orders/${orderId}/seating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'INSERT',
          position,
          seatVersion: state.seatVersion,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to add seat')
      }

      // Refresh to get updated state
      await fetchSeating()
      return true
    } catch (err) {
      console.error('[useSeating] Failed to add seat:', err)
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to add seat',
      }))
      return false
    }
  }, [orderId, state.totalSeats, state.seatVersion, fetchSeating])

  /**
   * Remove a seat at a position (shifts lower seats down)
   */
  const removeSeat = useCallback(async (position: number): Promise<boolean> => {
    if (!orderId) return false

    if (state.totalSeats <= 1) {
      setState(prev => ({ ...prev, error: 'Cannot remove the last seat' }))
      return false
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      const response = await fetch(`/api/orders/${orderId}/seating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'REMOVE',
          position,
          seatVersion: state.seatVersion,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to remove seat')
      }

      // Refresh to get updated state
      await fetchSeating()
      return true
    } catch (err) {
      console.error('[useSeating] Failed to remove seat:', err)
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to remove seat',
      }))
      return false
    }
  }, [orderId, state.totalSeats, state.seatVersion, fetchSeating])

  /**
   * Manually refresh seating data
   */
  const refreshSeating = useCallback(async () => {
    if (isLocalMode) {
      calculateLocalSeating()
    } else {
      await fetchSeating()
    }
  }, [isLocalMode, calculateLocalSeating, fetchSeating])

  return {
    seats: state.seats,
    totalSeats: state.totalSeats,
    seatVersion: state.seatVersion,
    isLoading: state.isLoading,
    error: state.error,
    addSeat,
    removeSeat,
    refreshSeating,
    sharedItemsCount: sharedItems.count,
    sharedItemsTotal: sharedItems.total,
  }
}
