'use client'

/**
 * useScale — React hook for real-time scale weight readings via Socket.io.
 *
 * Subscribes to `scale:{scaleId}` room for live weight events.
 * Falls back to HTTP polling when socket is disconnected.
 *
 * Usage:
 *   const { weight, unit, stable, connected, tare, captureWeight } = useScale(scaleId)
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import { toast } from '@/stores/toast-store'

export interface WeightReadingState {
  weight: number | null
  unit: string
  stable: boolean
  grossNet: 'gross' | 'net'
  overCapacity: boolean
}

interface UseScaleReturn {
  /** Current weight value (null if no reading) */
  weight: number | null
  /** Unit of measurement (lb, kg, oz, g) */
  unit: string
  /** Whether the reading is stable (not fluctuating) */
  stable: boolean
  /** Whether the scale is connected */
  connected: boolean
  /** Gross or net weight mode */
  grossNet: 'gross' | 'net'
  /** Scale is over its maximum capacity */
  overCapacity: boolean
  /** Last weight reading received while in gross mode (used to compute tare weight) */
  lastGrossWeight: number | null
  /** Send tare (zero) command to scale */
  tare: () => Promise<void>
  /** Capture current reading if stable; returns null if unstable or no reading */
  captureWeight: () => WeightReadingState | null
}

export function useScale(scaleId: string | null | undefined): UseScaleReturn {
  const [reading, setReading] = useState<WeightReadingState>({
    weight: null,
    unit: 'lb',
    stable: false,
    grossNet: 'gross',
    overCapacity: false,
  })
  // `connected` reflects whether the scale device is responding (via scale:status events),
  // NOT whether the socket transport is connected.
  const [scaleConnected, setScaleConnected] = useState(false)
  const readingRef = useRef(reading)
  readingRef.current = reading
  const lastGrossWeightRef = useRef<number | null>(null)
  // Track last scale:weight timestamp — if no reading within heartbeat window, mark disconnected
  const lastWeightAtRef = useRef<number>(0)

  useEffect(() => {
    if (!scaleId) return

    const socket = getSharedSocket()

    // Join the scale room
    socket.emit('subscribe', `scale:${scaleId}`)

    const onWeight = (data: {
      scaleId: string
      weight: number
      unit: string
      stable: boolean
      grossNet: 'gross' | 'net'
      overCapacity: boolean
    }) => {
      if (data.scaleId !== scaleId) return
      lastWeightAtRef.current = Date.now()
      // Scale is sending data — it's connected
      if (!scaleConnected) setScaleConnected(true)
      // Track last gross weight for tare computation
      if (data.grossNet === 'gross') {
        lastGrossWeightRef.current = data.weight
      }
      setReading({
        weight: data.weight,
        unit: data.unit,
        stable: data.stable,
        grossNet: data.grossNet,
        overCapacity: data.overCapacity,
      })
    }

    const onStatus = (data: {
      scaleId: string
      connected: boolean
      error?: string | null
    }) => {
      if (data.scaleId !== scaleId) return
      setScaleConnected(data.connected)
      if (data.error) {
        console.warn(`[useScale] Scale ${scaleId} error:`, data.error)
      }
    }

    const onConnect = () => {
      // Re-join room after reconnection
      socket.emit('subscribe', `scale:${scaleId}`)
    }

    socket.on('scale:weight', onWeight)
    socket.on('scale:status', onStatus)
    socket.on('connect', onConnect)

    // Heartbeat: if no weight reading in 10s, mark scale as disconnected
    const HEARTBEAT_INTERVAL = 5000
    const HEARTBEAT_TIMEOUT = 10000
    const heartbeat = setInterval(() => {
      if (lastWeightAtRef.current > 0 && Date.now() - lastWeightAtRef.current > HEARTBEAT_TIMEOUT) {
        setScaleConnected(false)
      }
    }, HEARTBEAT_INTERVAL)

    return () => {
      clearInterval(heartbeat)
      socket.emit('unsubscribe', `scale:${scaleId}`)
      socket.off('scale:weight', onWeight)
      socket.off('scale:status', onStatus)
      socket.off('connect', onConnect)
      releaseSharedSocket()
    }
  }, [scaleId])

  const tare = useCallback(async () => {
    if (!scaleId) return
    try {
      const res = await fetch(`/api/scales/${scaleId}/tare`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Tare failed' }))
        toast.error(err.error || 'Failed to tare scale')
        return
      }
      toast.success('Scale tared')
    } catch {
      toast.error('Failed to tare scale')
    }
  }, [scaleId])

  const captureWeight = useCallback((): WeightReadingState | null => {
    const current = readingRef.current
    if (current.weight === null || !current.stable) return null
    if (current.weight <= 0) return null
    return { ...current }
  }, [])

  // No scale bound — return disconnected defaults
  if (!scaleId) {
    return {
      weight: null,
      unit: 'lb',
      stable: false,
      connected: false,
      grossNet: 'gross',
      overCapacity: false,
      lastGrossWeight: null,
      tare: async () => {},
      captureWeight: () => null,
    }
  }

  return {
    weight: reading.weight,
    unit: reading.unit,
    stable: reading.stable,
    connected: scaleConnected,
    grossNet: reading.grossNet,
    overCapacity: reading.overCapacity,
    lastGrossWeight: lastGrossWeightRef.current,
    tare,
    captureWeight,
  }
}
