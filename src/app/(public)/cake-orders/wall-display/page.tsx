'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * Cake Orders Wall Display — Public, token-authenticated kitchen monitor
 *
 * Full-screen dark board showing active cake orders (deposit_paid, in_production, ready).
 * Auto-refreshes every 15s via polling (no socket — unauthenticated).
 * No PII, no financial data, no internal notes.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

interface WallDisplayOrder {
  id: string
  orderNumber: number
  eventDate: string
  eventTimeStart: string | null
  eventType: string
  guestCount: number | null
  status: 'deposit_paid' | 'in_production' | 'ready'
  assignedToFirstName: string | null
  cakeSummary: string
}

type PageState = 'loading' | 'denied' | 'ready' | 'error'

// ─── Status badge config ────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  deposit_paid: { label: 'Paid', bg: 'bg-blue-600', text: 'text-blue-100' },
  in_production: { label: 'In Production', bg: 'bg-amber-600', text: 'text-amber-100' },
  ready: { label: 'Ready', bg: 'bg-emerald-600', text: 'text-emerald-100' },
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatEventDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00')
    const now = new Date()
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()

    const isTomorrow =
      d.getFullYear() === tomorrow.getFullYear() &&
      d.getMonth() === tomorrow.getMonth() &&
      d.getDate() === tomorrow.getDate()

    if (isToday) return 'Today'
    if (isTomorrow) return 'Tomorrow'

    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function CakeWallDisplayPage() {
  const [pageState, setPageState] = useState<PageState>('loading')
  const [orders, setOrders] = useState<WallDisplayOrder[]>([])
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Extract token and locationId from URL search params
  const getParams = useCallback(() => {
    if (typeof window === 'undefined') return { token: null, locationId: null }
    const params = new URLSearchParams(window.location.search)
    return {
      token: params.get('token'),
      locationId: params.get('locationId'),
    }
  }, [])

  const fetchOrders = useCallback(async () => {
    const { token, locationId } = getParams()
    if (!token || !locationId) {
      setPageState('denied')
      return
    }

    try {
      const res = await fetch(
        `/api/public/cake-orders/wall-display?token=${encodeURIComponent(token)}&locationId=${encodeURIComponent(locationId)}`
      )

      if (res.status === 403) {
        setPageState('denied')
        return
      }

      if (!res.ok) {
        setPageState('error')
        return
      }

      const data = await res.json()
      setOrders(data.orders ?? [])
      setLastRefresh(new Date())
      setPageState('ready')
    } catch {
      if (pageState !== 'ready') {
        setPageState('error')
      }
      // If already displaying orders, silently fail and keep showing stale data
    }
  }, [getParams, pageState])

  // Initial load + polling
  useEffect(() => {
    fetchOrders()

    intervalRef.current = setInterval(fetchOrders, 15_000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(err => console.warn('fullscreen request failed:', err))
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(err => console.warn('exit fullscreen failed:', err))
    }
  }, [])

  // Listen for fullscreen change (e.g. user presses Escape)
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // ─── Denied ─────────────────────────────────────────────────────────────

  if (pageState === 'denied') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <div className="text-6xl mb-4">&#128274;</div>
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-gray-400">
            Invalid or missing display token. Please check the URL provided by your administrator.
          </p>
        </div>
      </div>
    )
  }

  // ─── Loading ────────────────────────────────────────────────────────────

  if (pageState === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <div className="animate-pulse text-4xl mb-4">&#127856;</div>
          <p className="text-gray-400 text-lg">Loading cake orders...</p>
        </div>
      </div>
    )
  }

  // ─── Error ──────────────────────────────────────────────────────────────

  if (pageState === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Connection Error</h1>
          <p className="text-gray-400 mb-4">Unable to load cake orders. Retrying automatically...</p>
          <button
            onClick={fetchOrders}
            className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600 transition-colors"
          >
            Retry Now
          </button>
        </div>
      </div>
    )
  }

  // ─── Ready ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Cake Orders</h1>
          {lastRefresh && (
            <p className="text-gray-500 text-sm mt-1">
              Updated {lastRefresh.toLocaleTimeString()}
            </p>
          )}
        </div>
        <button
          onClick={toggleFullscreen}
          className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors text-gray-400 hover:text-white"
          title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            </svg>
          )}
        </button>
      </div>

      {/* Empty state */}
      {orders.length === 0 && (
        <div className="flex items-center justify-center h-[60vh]">
          <div className="text-center">
            <div className="text-6xl mb-4 opacity-30">&#127856;</div>
            <p className="text-gray-500 text-xl">No active cake orders</p>
          </div>
        </div>
      )}

      {/* Order grid */}
      {orders.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {orders.map((order) => {
            const statusConfig = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.deposit_paid
            return (
              <div
                key={order.id}
                className={`rounded-xl border p-5 transition-all ${
                  order.status === 'ready'
                    ? 'border-emerald-500/50 bg-emerald-950/30'
                    : order.status === 'in_production'
                    ? 'border-amber-500/30 bg-gray-900'
                    : 'border-gray-700/50 bg-gray-900'
                }`}
              >
                {/* Top row: order number + status */}
                <div className="flex items-start justify-between mb-3">
                  <span className="text-2xl sm:text-3xl font-bold font-mono tracking-tight">
                    CK-{String(order.orderNumber).padStart(3, '0')}
                  </span>
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-semibold ${statusConfig.bg} ${statusConfig.text}`}
                  >
                    {statusConfig.label}
                  </span>
                </div>

                {/* Event date */}
                <div className="text-lg text-gray-300 mb-1">
                  {formatEventDate(order.eventDate)}
                  {order.eventTimeStart && (
                    <span className="text-gray-500 ml-2">{order.eventTimeStart}</span>
                  )}
                </div>

                {/* Event type + guest count */}
                <div className="text-gray-400 text-sm mb-3">
                  {order.eventType}
                  {order.guestCount != null && order.guestCount > 0 && (
                    <span className="ml-2 text-gray-500">&middot; {order.guestCount} guests</span>
                  )}
                </div>

                {/* Cake summary */}
                <div className="text-base text-gray-200 font-medium mb-2">
                  {order.cakeSummary}
                </div>

                {/* Assigned baker */}
                {order.assignedToFirstName && (
                  <div className="text-sm text-gray-500 mt-2 flex items-center gap-1.5">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                    </svg>
                    {order.assignedToFirstName}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Footer: order count */}
      {orders.length > 0 && (
        <div className="mt-6 text-center text-gray-600 text-sm">
          {orders.length} active order{orders.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}
