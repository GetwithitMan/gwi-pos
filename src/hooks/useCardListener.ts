'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CardDetection {
  detectionId: string
  sessionId: string
  leaseVersion: number
  readerId: string
  detectedAt: string
  card: {
    brand: string | null
    last4: string | null
    holderName: string | null
    entryMethod: string | null
    walletType: string | null
  }
  match: {
    kind: 'open_tab_found' | 'no_open_tab' | 'ambiguous'
    orderId?: string
    orderNumber?: number
    tabName?: string
    amount?: number
    tabs?: Array<{ orderId: string; orderNumber: number; amount: number }>
  }
}

type LeaseStatus = 'none' | 'acquiring' | 'active' | 'conflict' | 'expired'

interface UseCardListenerOptions {
  readerId: string | null
  terminalId: string
  enabled: boolean
  onCardDetected?: (detection: CardDetection) => void
}

interface UseCardListenerReturn {
  isListening: boolean
  error: string | null
  leaseStatus: LeaseStatus
  startListening: () => void
  stopListening: () => void
}

// ─── Constants ──────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 8_000
const LISTEN_TIMEOUT_SECONDS = 10

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useCardListener({
  readerId,
  terminalId,
  enabled,
  onCardDetected,
}: UseCardListenerOptions): UseCardListenerReturn {
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [leaseStatus, setLeaseStatus] = useState<LeaseStatus>('none')

  // Refs for mutable state across renders
  const sessionIdRef = useRef<string | null>(null)
  const leaseVersionRef = useRef<number | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeRef = useRef(false) // tracks whether the listen loop should keep running
  const onCardDetectedRef = useRef(onCardDetected)
  const readerIdRef = useRef(readerId)
  const unmountedRef = useRef(false)

  // Keep refs fresh
  useEffect(() => { onCardDetectedRef.current = onCardDetected }, [onCardDetected])
  useEffect(() => { readerIdRef.current = readerId }, [readerId])

  // ── Heartbeat ─────────────────────────────────────────────────────────

  const sendHeartbeat = useCallback(async () => {
    const rid = readerIdRef.current
    if (!rid || !sessionIdRef.current || leaseVersionRef.current == null) return

    try {
      const res = await fetch(`/api/payment-readers/${rid}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          terminalId,
          sessionId: sessionIdRef.current,
          leaseVersion: leaseVersionRef.current,
        }),
      })

      if (res.status === 409) {
        // Lease lost
        setLeaseStatus('expired')
        setError('Reader claimed by another station')
        stopLoop()
      }
    } catch {
      // Network error — heartbeat is best-effort; lease TTL is the safety net
    }
  }, [terminalId])

  const startHeartbeat = useCallback(() => {
    stopHeartbeat()
    heartbeatIntervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)
  }, [sendHeartbeat])

  function stopHeartbeat() {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current)
      heartbeatIntervalRef.current = null
    }
  }

  // ── Release lease ─────────────────────────────────────────────────────

  const releaseLease = useCallback(async (reason: 'manual_cancel' | 'unmount' | 'navigation') => {
    const rid = readerIdRef.current
    if (!rid || !sessionIdRef.current) return

    try {
      await fetch(`/api/payment-readers/${rid}/release`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          terminalId,
          sessionId: sessionIdRef.current,
          reason,
        }),
      })
    } catch {
      // Best-effort — TTL expiry is the fallback
    }
  }, [terminalId])

  // ── Listen loop ───────────────────────────────────────────────────────

  function stopLoop() {
    activeRef.current = false
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    stopHeartbeat()
    if (!unmountedRef.current) {
      setIsListening(false)
    }
  }

  const listenLoop = useCallback(async () => {
    const rid = readerIdRef.current
    if (!rid) return

    activeRef.current = true
    setError(null)
    setLeaseStatus('acquiring')
    setIsListening(true)

    while (activeRef.current) {
      const controller = new AbortController()
      abortControllerRef.current = controller

      try {
        const body: Record<string, unknown> = {
          terminalId,
          timeoutSeconds: LISTEN_TIMEOUT_SECONDS,
        }

        // Continue existing lease if we have session info
        if (sessionIdRef.current && leaseVersionRef.current != null) {
          body.sessionId = sessionIdRef.current
          body.leaseVersion = leaseVersionRef.current
        }

        const res = await fetch(`/api/payment-readers/${rid}/listen`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })

        if (!activeRef.current) break

        if (res.status === 409) {
          setLeaseStatus('conflict')
          setError('Reader claimed by another station')
          stopLoop()
          return
        }

        if (!res.ok) {
          const errData = await res.json().catch(() => null)
          setError(errData?.error || `Reader error (${res.status})`)
          // Brief backoff then retry
          await new Promise(r => setTimeout(r, 2000))
          continue
        }

        const data = await res.json()

        // Store lease info from first successful response
        if (data.sessionId) {
          sessionIdRef.current = data.sessionId
        }
        if (data.leaseVersion != null) {
          leaseVersionRef.current = data.leaseVersion
        }

        // Mark lease as active after first successful response
        if (leaseStatus !== 'active' && !unmountedRef.current) {
          setLeaseStatus('active')
          startHeartbeat()
        }

        if (data.type === 'card_detected') {
          const detection: CardDetection = {
            detectionId: data.detectionId,
            sessionId: data.sessionId,
            leaseVersion: data.leaseVersion,
            readerId: data.readerId,
            detectedAt: data.detectedAt,
            card: data.card,
            match: data.match,
          }
          onCardDetectedRef.current?.(detection)
        }
        // type === 'timeout' or 'suppressed' → just loop again

      } catch (err) {
        if ((err as DOMException).name === 'AbortError') {
          // Expected when stopping — exit cleanly
          break
        }
        // Network error — brief backoff then retry
        if (!unmountedRef.current) {
          setError('Connection lost — retrying...')
        }
        await new Promise(r => setTimeout(r, 3000))
      }
    }
  }, [terminalId, leaseStatus, startHeartbeat])

  // ── Public controls ───────────────────────────────────────────────────

  const startListening = useCallback(() => {
    if (activeRef.current || !readerId) return
    sessionIdRef.current = null
    leaseVersionRef.current = null
    listenLoop()
  }, [readerId, listenLoop])

  const stopListening = useCallback(() => {
    stopLoop()
    releaseLease('manual_cancel')
    sessionIdRef.current = null
    leaseVersionRef.current = null
    setLeaseStatus('none')
    setError(null)
  }, [releaseLease])

  // ── Background-tab pause ──────────────────────────────────────────────

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab hidden — pause heartbeat and abort current listen
        stopHeartbeat()
        if (abortControllerRef.current) {
          abortControllerRef.current.abort()
          abortControllerRef.current = null
        }
      } else if (activeRef.current && sessionIdRef.current) {
        // Tab visible again — re-validate lease via heartbeat before resuming
        sendHeartbeat().then(() => {
          if (activeRef.current) {
            startHeartbeat()
            // Resume listen loop (it exited on abort)
            listenLoop()
          }
        })
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [sendHeartbeat, startHeartbeat, listenLoop])

  // ── Auto-stop when disabled or readerId changes ───────────────────────

  useEffect(() => {
    if (!enabled && activeRef.current) {
      stopLoop()
      releaseLease('navigation')
      sessionIdRef.current = null
      leaseVersionRef.current = null
      setLeaseStatus('none')
    }
  }, [enabled, releaseLease])

  // ── Cleanup on unmount ────────────────────────────────────────────────

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      stopLoop()
      // Fire-and-forget release
      const rid = readerIdRef.current
      const sid = sessionIdRef.current
      if (rid && sid) {
        fetch(`/api/payment-readers/${rid}/release`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ terminalId, sessionId: sid, reason: 'unmount' }),
        }).catch(() => {})
      }
    }
  }, [terminalId])

  return {
    isListening,
    error,
    leaseStatus,
    startListening,
    stopListening,
  }
}
