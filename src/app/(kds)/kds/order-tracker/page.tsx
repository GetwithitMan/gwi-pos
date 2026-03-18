'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import type { Socket } from 'socket.io-client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrackerItem {
  id: string
  name: string
  quantity: number
  isCompleted: boolean
  completedAt: string | null
  kitchenSentAt: string | null
}

interface TrackerOrder {
  id: string
  orderNumber: number
  orderType: string
  tableName: string | null
  tabName: string | null
  employeeName: string
  createdAt: string
  items: TrackerItem[]
}

interface ReadyOrder extends TrackerOrder {
  /** Timestamp when all items became ready (for auto-removal timer) */
  readyAt: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: 'Dine In',
  takeout: 'Takeout',
  delivery: 'Delivery',
  bar_tab: 'Bar',
  boh_sale: 'BOH',
}

const ORDER_TYPE_COLORS: Record<string, string> = {
  dine_in: 'bg-blue-500',
  takeout: 'bg-orange-500',
  delivery: 'bg-purple-500',
  bar_tab: 'bg-emerald-500',
  boh_sale: 'bg-gray-500',
}

/** Auto-remove from Ready column after 5 minutes */
const READY_REMOVAL_MS = 5 * 60 * 1000

/** Poll interval for full data refresh */
const POLL_INTERVAL_MS = 30_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isOrderPreparing(order: TrackerOrder): boolean {
  const hasSentItems = order.items.some(i => i.kitchenSentAt)
  const allCompleted = order.items.length > 0 && order.items.every(i => i.isCompleted)
  return hasSentItems && !allCompleted
}

function isOrderReady(order: TrackerOrder): boolean {
  if (order.items.length === 0) return false
  return order.items.every(i => i.isCompleted)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OrderTrackerPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-black text-white">Loading...</div>}>
      <OrderTrackerContent />
    </Suspense>
  )
}

function OrderTrackerContent() {
  const searchParams = useSearchParams()
  const locationId = searchParams.get('locationId')

  const [preparing, setPreparing] = useState<TrackerOrder[]>([])
  const [ready, setReady] = useState<ReadyOrder[]>([])
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)

  const socketRef = useRef<Socket | null>(null)
  const readyTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Track orders we've already seen as ready (to preserve readyAt timestamps)
  const readyMapRef = useRef<Map<string, ReadyOrder>>(new Map())

  // ── Fetch orders from KDS API ─────────────────────────────────────────
  const loadOrders = useCallback(async () => {
    if (!locationId) return
    try {
      const res = await fetch(`/api/kds?locationId=${encodeURIComponent(locationId)}&showAll=true`)
      if (!res.ok) return
      const json = await res.json()
      const orders: TrackerOrder[] = json.data?.orders || []

      const newPreparing: TrackerOrder[] = []
      const newReady: ReadyOrder[] = []

      for (const order of orders) {
        if (isOrderReady(order)) {
          // Preserve existing readyAt if we've seen this order before
          const existing = readyMapRef.current.get(order.id)
          const readyAt = existing?.readyAt || Date.now()
          newReady.push({ ...order, readyAt })
        } else if (isOrderPreparing(order)) {
          newPreparing.push(order)
        }
      }

      // Update ready map
      readyMapRef.current.clear()
      for (const ro of newReady) {
        readyMapRef.current.set(ro.id, ro)
      }

      setPreparing(newPreparing)
      setReady(prev => {
        // Merge: keep orders that haven't timed out
        const now = Date.now()
        return newReady.filter(o => now - o.readyAt < READY_REMOVAL_MS)
      })
    } catch {
      // Silently fail — will retry on next poll
    } finally {
      setLoading(false)
    }
  }, [locationId])

  // ── Auto-remove stale "Ready" orders every second ─────────────────────
  useEffect(() => {
    const timer = setInterval(() => {
      setReady(prev => {
        const now = Date.now()
        const filtered = prev.filter(o => now - o.readyAt < READY_REMOVAL_MS)
        return filtered.length !== prev.length ? filtered : prev
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // ── Socket + polling setup ────────────────────────────────────────────
  useEffect(() => {
    if (!locationId) return

    loadOrders()

    // Polling fallback
    pollRef.current = setInterval(loadOrders, POLL_INTERVAL_MS)

    // Socket for real-time updates
    const socket = getSharedSocket()
    socketRef.current = socket

    const onConnect = () => {
      setConnected(true)
      socket.emit('join_station', {
        locationId,
        tags: ['order-tracker'],
        terminalId: `tracker-${Date.now().toString(36)}`,
      })
      loadOrders()
    }

    const onDisconnect = () => setConnected(false)

    // On any KDS event, refresh the full order list.
    // This is simpler than granular state patching and acceptable
    // for a customer-facing display with modest order volume.
    const onKdsEvent = () => loadOrders()

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('kds:order-bumped', onKdsEvent)
    socket.on('kds:item-status', onKdsEvent)
    socket.on('kds:order-received', onKdsEvent)
    socket.on('orders:list-changed', onKdsEvent)
    socket.on('order:created', onKdsEvent)
    socket.on('order:closed', onKdsEvent)

    if (socket.connected) onConnect()

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('kds:order-bumped', onKdsEvent)
      socket.off('kds:item-status', onKdsEvent)
      socket.off('kds:order-received', onKdsEvent)
      socket.off('orders:list-changed', onKdsEvent)
      socket.off('order:created', onKdsEvent)
      socket.off('order:closed', onKdsEvent)
      socketRef.current = null
      releaseSharedSocket()

      // Clear ready timers
      for (const timer of readyTimersRef.current.values()) clearTimeout(timer)
      readyTimersRef.current.clear()
    }
  }, [locationId, loadOrders])

  // ── Missing locationId ────────────────────────────────────────────────
  if (!locationId) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center text-gray-500">
          <p className="text-xl font-semibold">Order Tracker</p>
          <p className="mt-2 text-sm">Missing locationId parameter</p>
        </div>
      </div>
    )
  }

  // ── Loading state ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center text-gray-400">
          <div className="w-10 h-10 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-lg">Loading orders...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Order Tracker</h1>
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-400'}`} />
          <span className="text-sm text-gray-500">{connected ? 'Live' : 'Reconnecting...'}</span>
        </div>
      </header>

      {/* Two-column layout */}
      <div className="flex-1 flex">
        {/* Preparing Column */}
        <div className="flex-1 border-r border-gray-200 flex flex-col">
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-amber-500 animate-pulse" />
            <h2 className="text-lg font-bold text-amber-800">Preparing</h2>
            <span className="ml-auto text-sm font-semibold text-amber-600 bg-amber-100 px-2.5 py-0.5 rounded-full">
              {preparing.length}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {preparing.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-300">
                <p className="text-xl">No orders preparing</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {preparing.map(order => (
                  <OrderCard key={order.id} order={order} variant="preparing" />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Ready Column */}
        <div className="flex-1 flex flex-col">
          <div className="bg-green-50 border-b border-green-200 px-6 py-3 flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <h2 className="text-lg font-bold text-green-800">Ready</h2>
            <span className="ml-auto text-sm font-semibold text-green-600 bg-green-100 px-2.5 py-0.5 rounded-full">
              {ready.length}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {ready.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-300">
                <p className="text-xl">No orders ready</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {ready.map(order => (
                  <OrderCard key={order.id} order={order} variant="ready" />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// OrderCard sub-component
// ---------------------------------------------------------------------------

function OrderCard({
  order,
  variant,
}: {
  order: TrackerOrder | ReadyOrder
  variant: 'preparing' | 'ready'
}) {
  const borderColor = variant === 'preparing' ? 'border-amber-300' : 'border-green-400'
  const bgColor = variant === 'preparing' ? 'bg-white' : 'bg-green-50'
  const numberColor = variant === 'preparing' ? 'text-gray-900' : 'text-green-700'

  const typeLabel = ORDER_TYPE_LABELS[order.orderType] || order.orderType
  const typeBg = ORDER_TYPE_COLORS[order.orderType] || 'bg-gray-500'

  return (
    <div
      className={`
        ${bgColor} ${borderColor} border-2 rounded-xl p-5 shadow-sm
        transition-all duration-500 ease-in-out
        animate-in fade-in slide-in-from-bottom-2
      `}
    >
      {/* Order number + type badge */}
      <div className="flex items-center justify-between mb-3">
        <span className={`text-4xl font-extrabold ${numberColor} tracking-tight`}>
          #{order.orderNumber}
        </span>
        <span className={`${typeBg} text-white text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wider`}>
          {typeLabel}
        </span>
      </div>

      {/* Table / Tab name */}
      {(order.tableName || order.tabName) && (
        <p className="text-sm text-gray-500 mb-2">
          {order.tableName && <span>Table {order.tableName}</span>}
          {order.tableName && order.tabName && <span className="mx-1">&middot;</span>}
          {order.tabName && <span>{order.tabName}</span>}
        </p>
      )}

      {/* Item count */}
      <div className="text-sm text-gray-600">
        {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
      </div>

      {/* Ready indicator */}
      {variant === 'ready' && (
        <div className="mt-3 flex items-center gap-2 text-green-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-sm font-semibold">Ready for pickup</span>
        </div>
      )}

      {/* Preparing progress */}
      {variant === 'preparing' && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Progress</span>
            <span>
              {order.items.filter(i => i.isCompleted).length}/{order.items.length}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-amber-500 h-2 rounded-full transition-all duration-500"
              style={{
                width: `${order.items.length > 0
                  ? (order.items.filter(i => i.isCompleted).length / order.items.length) * 100
                  : 0}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
