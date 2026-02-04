'use client'

/**
 * useSeating Hook
 *
 * Manages seat assignment and status for tables.
 */

import { useState, useCallback, useEffect } from 'react'
import type { Seat } from '../types'
import * as SeatService from '../services/seat-service'

interface UseSeatingOptions {
  tableId: string
  autoLoad?: boolean
}

export function useSeating({ tableId, autoLoad = true }: UseSeatingOptions) {
  const [seats, setSeats] = useState<Seat[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null)

  // Load seats
  const loadSeats = useCallback(async () => {
    if (!tableId) return

    setIsLoading(true)
    setError(null)

    try {
      const loadedSeats = await SeatService.getSeatsForTable(tableId)
      setSeats(loadedSeats)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load seats')
    } finally {
      setIsLoading(false)
    }
  }, [tableId])

  // Auto-load on mount
  useEffect(() => {
    if (autoLoad) {
      loadSeats()
    }
  }, [autoLoad, loadSeats])

  // Get selected seat
  const selectedSeat = selectedSeatId
    ? seats.find((s) => s.id === selectedSeatId) || null
    : null

  // Select a seat
  const selectSeat = useCallback((seatId: string | null) => {
    setSelectedSeatId(seatId)
  }, [])

  // Select seat by number
  const selectSeatByNumber = useCallback(
    (seatNumber: number) => {
      const seat = seats.find((s) => s.number === seatNumber)
      setSelectedSeatId(seat?.id || null)
    },
    [seats]
  )

  // Auto-generate seats
  const regenerateSeats = useCallback(
    async (capacity: number, shape: string) => {
      setIsLoading(true)
      setError(null)

      try {
        const newSeats = await SeatService.autoGenerateSeats(tableId, capacity, shape)
        setSeats(newSeats)
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to generate seats')
        return false
      } finally {
        setIsLoading(false)
      }
    },
    [tableId]
  )

  // Add virtual seat
  const addVirtualSeat = useCallback(
    async (position: { x: number; y: number; angle: number }) => {
      setIsLoading(true)
      setError(null)

      try {
        const newSeat = await SeatService.addVirtualSeat(tableId, {
          x: position.x,
          y: position.y,
          angle: position.angle,
          distance: 0.5,
        })
        setSeats((prev) => [...prev, newSeat])
        return newSeat
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add seat')
        return null
      } finally {
        setIsLoading(false)
      }
    },
    [tableId]
  )

  // Get seat count
  const seatCount = seats.length
  const occupiedCount = seats.filter((s) => s.isOccupied).length
  const availableCount = seatCount - occupiedCount

  return {
    // State
    seats,
    isLoading,
    error,
    selectedSeat,
    selectedSeatId,
    seatCount,
    occupiedCount,
    availableCount,

    // Actions
    loadSeats,
    selectSeat,
    selectSeatByNumber,
    regenerateSeats,
    addVirtualSeat,
  }
}

export default useSeating
