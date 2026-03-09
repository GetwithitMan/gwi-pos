'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'

interface UseReportAutoRefreshOptions {
  /** Callback to refresh the report data */
  onRefresh: () => void
  /** Socket events to listen for (defaults to common order/payment events) */
  events?: string[]
  /** Debounce interval in ms (default: 2000 -- prevents burst refreshes) */
  debounceMs?: number
  /** Fallback polling interval in ms when socket disconnected (default: 60000) */
  fallbackIntervalMs?: number
  /** Whether the hook is enabled (default: true) */
  enabled?: boolean
}

const DEFAULT_EVENTS = [
  'orders:list-changed',
  'order:totals-updated',
  'payment:processed',
  'employee:clock-changed',
]

/**
 * Auto-refreshes report/admin pages when relevant socket events fire.
 *
 * Uses existing socket events -- no new events needed.
 * Debounces to prevent UI thrashing from rapid mutations.
 * Falls back to polling when socket is disconnected.
 *
 * Usage:
 * ```ts
 * const { isSocketConnected } = useReportAutoRefresh({
 *   onRefresh: fetchReportData,
 *   events: ['orders:list-changed', 'payment:processed'],
 *   debounceMs: 3000,
 * })
 * ```
 */
export function useReportAutoRefresh({
  onRefresh,
  events = DEFAULT_EVENTS,
  debounceMs = 2000,
  fallbackIntervalMs = 60000,
  enabled = true,
}: UseReportAutoRefreshOptions): { isSocketConnected: boolean } {
  const [isSocketConnected, setIsSocketConnected] = useState(false)

  // Ref for the callback to avoid stale closures — always calls latest version
  const onRefreshRef = useRef(onRefresh)
  useEffect(() => { onRefreshRef.current = onRefresh })

  // Refs for timers so cleanup can clear them
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Track whether we're currently polling (for starting/stopping on connect/disconnect)
  const isPollingRef = useRef(false)

  const startPolling = useCallback((intervalMs: number) => {
    if (isPollingRef.current) return
    isPollingRef.current = true
    pollingIntervalRef.current = setInterval(() => {
      onRefreshRef.current()
    }, intervalMs)
  }, [])

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
    isPollingRef.current = false
  }, [])

  useEffect(() => {
    if (!enabled) return

    const socket = getSharedSocket()

    // Debounced refresh — collapses rapid socket events into a single refresh call
    const debouncedRefresh = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(() => {
        onRefreshRef.current()
      }, debounceMs)
    }

    // Connection state handlers
    const onConnect = () => {
      setIsSocketConnected(true)
      stopPolling()
      // Refresh on reconnect to catch anything missed while disconnected
      onRefreshRef.current()
    }

    const onDisconnect = () => {
      setIsSocketConnected(false)
      startPolling(fallbackIntervalMs)
    }

    // Register connection handlers
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)

    // Register event listeners — all point to the same debounced handler
    for (const event of events) {
      socket.on(event, debouncedRefresh)
    }

    // Set initial state based on current connection
    if (socket.connected) {
      setIsSocketConnected(true)
    } else {
      setIsSocketConnected(false)
      startPolling(fallbackIntervalMs)
    }

    // Cleanup
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)

      for (const event of events) {
        socket.off(event, debouncedRefresh)
      }

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }

      stopPolling()
      releaseSharedSocket()
    }
    // events array identity: consumers should pass a stable array (const or useMemo).
    // We join to string for the dep check to avoid infinite re-renders from inline arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, debounceMs, fallbackIntervalMs, events.join(','), startPolling, stopPolling])

  return { isSocketConnected }
}
