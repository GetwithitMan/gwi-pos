'use client'

/**
 * DeliveryExpoRail — Kanban-style delivery order tracker for KDS screens.
 *
 * Feature-gated by `useDeliveryFeature('deliveryKdsProvisioned')`.
 * Renders a collapsible horizontal rail with 5 columns:
 *   PREPARING | READY | ASSIGNED | OUT | PROBLEM
 *
 * Data source: GET /api/delivery/dispatch (aggregate endpoint, reused).
 * Real-time: `delivery:status_changed`, `delivery:exception_created`,
 *            `delivery:exception_resolved` socket events.
 * Fallback: auto-refresh every 30s.
 */

import { useState, useEffect, useCallback, useRef, memo } from 'react'
import { useDeliveryFeature } from '@/hooks/useDeliveryFeature'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'

// ── Types ──────────────────────────────────────────────────────────────────────

interface DeliveryExpoOrder {
  id: string
  orderId: string | null
  orderNumber: number | null
  status: string
  customerName: string | null
  address: string | null
  driverId: string | null
  driverName: string | null
  runId: string | null
  zoneName: string | null
  zoneColor: string | null
  estimatedMinutes: number | null
  createdAt: string
  updatedAt: string
  dispatchedAt: string | null
  assignedAt: string | null
  deliveryFee: number
  orderTotal: number | null
  orderStatus: string | null
  // Computed client-side
  minutesInState: number
  isLate: boolean
}

interface DeliveryException {
  id: string
  deliveryOrderId: string | null
  type: string
  severity: string
  status: string
  createdAt: string
}

type ExpoColumn = 'preparing' | 'ready' | 'assigned' | 'out' | 'problem'

// ── Status → Column Mapping ────────────────────────────────────────────────────

const STATUS_TO_COLUMN: Record<string, ExpoColumn> = {
  pending: 'preparing',
  confirmed: 'preparing',
  preparing: 'preparing',
  ready_for_pickup: 'ready',
  assigned: 'assigned',
  dispatched: 'out',
  en_route: 'out',
  arrived: 'out',
  // Problem statuses
  attempted: 'problem',
  failed_delivery: 'problem',
  returned_to_store: 'problem',
  redelivery_pending: 'problem',
}

const COLUMN_CONFIG: {
  key: ExpoColumn
  label: string
  color: string
  bgColor: string
  borderColor: string
}[] = [
  { key: 'preparing', label: 'PREPARING', color: 'text-blue-400', bgColor: 'bg-blue-900/30', borderColor: 'border-blue-700' },
  { key: 'ready', label: 'READY', color: 'text-green-400', bgColor: 'bg-green-900/30', borderColor: 'border-green-700' },
  { key: 'assigned', label: 'ASSIGNED', color: 'text-yellow-400', bgColor: 'bg-yellow-900/30', borderColor: 'border-yellow-700' },
  { key: 'out', label: 'OUT', color: 'text-purple-400', bgColor: 'bg-purple-900/30', borderColor: 'border-purple-700' },
  { key: 'problem', label: 'PROBLEM', color: 'text-red-400', bgColor: 'bg-red-900/30', borderColor: 'border-red-700' },
]

const PROBLEM_STATUS_LABELS: Record<string, string> = {
  attempted: 'Attempted',
  failed_delivery: 'Failed',
  returned_to_store: 'Returned',
  redelivery_pending: 'Redelivery',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function minutesSince(dateStr: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 60_000))
}

function formatElapsed(minutes: number): string {
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${m}m`
}

function getLatenessColor(order: DeliveryExpoOrder): string {
  if (!order.estimatedMinutes) return 'text-gray-400'
  const totalElapsed = minutesSince(order.createdAt)
  const ratio = totalElapsed / order.estimatedMinutes
  if (ratio >= 1.0) return 'text-red-400'
  if (ratio >= 0.75) return 'text-yellow-400'
  return 'text-green-400'
}

function getCardBorderColor(order: DeliveryExpoOrder): string {
  if (!order.estimatedMinutes) return 'border-gray-600'
  const totalElapsed = minutesSince(order.createdAt)
  const ratio = totalElapsed / order.estimatedMinutes
  if (ratio >= 1.0) return 'border-red-500'
  if (ratio >= 0.75) return 'border-yellow-500'
  return 'border-gray-600'
}

// ── Card Component ─────────────────────────────────────────────────────────────

interface ExpoCardProps {
  order: DeliveryExpoOrder
  column: ExpoColumn
  hasException: boolean
  exceptionMessage?: string
}

const ExpoCard = memo(function ExpoCard({ order, column, hasException, exceptionMessage }: ExpoCardProps) {
  const cardBorder = hasException ? 'border-red-500' : getCardBorderColor(order)
  const timeColor = getLatenessColor(order)

  return (
    <div className={`bg-gray-800 rounded border-l-4 ${cardBorder} px-3 py-2 mb-2 last:mb-0`}>
      {/* Order number + item count */}
      <div className="flex items-center justify-between">
        <span className="text-white font-bold text-sm">
          #{order.orderNumber || '---'}
        </span>
        {order.isLate && (
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
        )}
      </div>

      {/* Time in current state */}
      <div className={`text-xs font-mono ${timeColor} mt-0.5`}>
        {column === 'ready' ? (
          <span className="text-green-400 font-bold">Ready!</span>
        ) : (
          formatElapsed(order.minutesInState)
        )}
      </div>

      {/* Driver name (if assigned/out) */}
      {order.driverName && (column === 'assigned' || column === 'out') && (
        <div className="text-xs text-gray-400 mt-0.5 truncate">
          &rarr; {order.driverName}
        </div>
      )}

      {/* ETA for out-for-delivery */}
      {column === 'out' && order.estimatedMinutes != null && (
        <div className="text-xs text-gray-500 mt-0.5">
          ETA {order.estimatedMinutes}m
        </div>
      )}

      {/* Problem details */}
      {column === 'problem' && (
        <div className="mt-1">
          <div className="text-xs text-red-400 font-medium">
            {PROBLEM_STATUS_LABELS[order.status] || order.status}
          </div>
          {hasException && exceptionMessage && (
            <div className="text-xs text-red-300/70 truncate mt-0.5">
              {exceptionMessage}
            </div>
          )}
          {order.isLate && (
            <div className="text-xs text-red-300/70 mt-0.5">
              {formatElapsed(minutesSince(order.createdAt))} total
            </div>
          )}
        </div>
      )}

      {/* Zone color indicator */}
      {order.zoneColor && (
        <div
          className="w-full h-0.5 rounded mt-1.5"
          style={{ backgroundColor: order.zoneColor }}
        />
      )}
    </div>
  )
})

// ── Column Component ───────────────────────────────────────────────────────────

interface ExpoColumnProps {
  config: typeof COLUMN_CONFIG[number]
  orders: DeliveryExpoOrder[]
  exceptions: DeliveryException[]
}

const ExpoColumn = memo(function ExpoColumn({ config, orders, exceptions }: ExpoColumnProps) {
  // Build a set of delivery order IDs that have open exceptions
  const exceptionMap = new Map<string, string>()
  for (const ex of exceptions) {
    if (ex.deliveryOrderId) {
      exceptionMap.set(ex.deliveryOrderId, ex.type)
    }
  }

  return (
    <div className={`flex-1 min-w-[140px] rounded-lg ${config.bgColor} border ${config.borderColor} overflow-hidden`}>
      {/* Column header */}
      <div className="px-3 py-2 border-b border-gray-700/50 flex items-center justify-between">
        <span className={`text-xs font-bold tracking-wide ${config.color}`}>
          {config.label}
        </span>
        <span className={`text-xs font-mono ${config.color}`}>
          ({orders.length})
        </span>
      </div>

      {/* Cards */}
      <div className="p-2 max-h-[280px] overflow-y-auto scrollbar-thin">
        {orders.length === 0 ? (
          <div className="text-center py-4 text-gray-600 text-xs">
            None
          </div>
        ) : (
          orders.map(order => (
            <ExpoCard
              key={order.id}
              order={order}
              column={config.key}
              hasException={exceptionMap.has(order.id)}
              exceptionMessage={exceptionMap.get(order.id)}
            />
          ))
        )}
      </div>
    </div>
  )
})

// ── Main Rail Component ────────────────────────────────────────────────────────

interface DeliveryExpoRailProps {
  locationId: string
}

export default function DeliveryExpoRail({ locationId }: DeliveryExpoRailProps) {
  const isProvisioned = useDeliveryFeature('deliveryKdsProvisioned')

  if (!isProvisioned) return null

  return <DeliveryExpoRailInner locationId={locationId} />
}

function DeliveryExpoRailInner({ locationId }: DeliveryExpoRailProps) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('kds_delivery_rail_collapsed') === 'true'
  })
  const [orders, setOrders] = useState<DeliveryExpoOrder[]>([])
  const [exceptions, setExceptions] = useState<DeliveryException[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Persist collapsed state
  const toggleCollapsed = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem('kds_delivery_rail_collapsed', String(next))
      return next
    })
  }, [])

  // ── Data Fetching ──────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!locationId) return

    try {
      const res = await fetch('/api/delivery/dispatch', { credentials: 'include' })

      if (!res.ok) {
        // 403 = not provisioned, silently hide
        if (res.status === 403) {
          setError(false)
          setOrders([])
          return
        }
        setError(true)
        return
      }

      const data = await res.json()
      const now = Date.now()

      // Map dispatch orders → expo orders with computed fields
      const mapped: DeliveryExpoOrder[] = (data.orders || []).map((o: any) => {
        const lastStatusChange = o.updatedAt || o.createdAt
        const minutesInState = Math.max(0, Math.floor((now - new Date(lastStatusChange).getTime()) / 60_000))
        const totalElapsed = Math.floor((now - new Date(o.createdAt).getTime()) / 60_000)
        const isLate = o.estimatedMinutes != null && totalElapsed > o.estimatedMinutes

        return {
          id: o.id,
          orderId: o.orderId,
          orderNumber: o.orderNumber,
          status: o.status,
          customerName: o.customerName,
          address: o.address,
          driverId: o.driverId,
          driverName: o.driverName,
          runId: o.runId,
          zoneName: o.zoneName,
          zoneColor: o.zoneColor,
          estimatedMinutes: o.estimatedMinutes != null ? Number(o.estimatedMinutes) : null,
          createdAt: o.createdAt,
          updatedAt: o.updatedAt || o.createdAt,
          dispatchedAt: o.dispatchedAt,
          assignedAt: o.assignedAt,
          deliveryFee: Number(o.deliveryFee || 0),
          orderTotal: o.orderTotal != null ? Number(o.orderTotal) : null,
          orderStatus: o.orderStatus,
          minutesInState,
          isLate,
        }
      })

      // Also handle orders with open exceptions — they go to PROBLEM column
      const openExceptions: DeliveryException[] = (data.exceptions || []).map((ex: any) => ({
        id: ex.id,
        deliveryOrderId: ex.deliveryOrderId,
        type: ex.type,
        severity: ex.severity,
        status: ex.status,
        createdAt: ex.createdAt,
      }))

      setOrders(mapped)
      setExceptions(openExceptions)
      setError(false)
    } catch (err) {
      console.error('[DeliveryExpoRail] Fetch error:', err)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [locationId])

  // ── Initial load + fallback polling (30s) ──────────────────────────────────

  useEffect(() => {
    fetchData()

    refreshTimerRef.current = setInterval(fetchData, 30_000)
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
    }
  }, [fetchData])

  // ── Socket events for real-time updates ────────────────────────────────────

  useEffect(() => {
    const socket = getSharedSocket()

    const onDeliveryStatusChanged = () => fetchData()
    const onExceptionCreated = () => fetchData()
    const onExceptionResolved = () => fetchData()
    const onRunCreated = () => fetchData()
    const onRunCompleted = () => fetchData()
    const onDriverStatusChanged = () => fetchData()

    socket.on('delivery:status_changed', onDeliveryStatusChanged)
    socket.on('delivery:exception_created', onExceptionCreated)
    socket.on('delivery:exception_resolved', onExceptionResolved)
    socket.on('delivery:run_created', onRunCreated)
    socket.on('delivery:run_completed', onRunCompleted)
    socket.on('driver:status_changed', onDriverStatusChanged)

    return () => {
      socket.off('delivery:status_changed', onDeliveryStatusChanged)
      socket.off('delivery:exception_created', onExceptionCreated)
      socket.off('delivery:exception_resolved', onExceptionResolved)
      socket.off('delivery:run_created', onRunCreated)
      socket.off('delivery:run_completed', onRunCompleted)
      socket.off('driver:status_changed', onDriverStatusChanged)
      releaseSharedSocket()
    }
  }, [fetchData])

  // ── Client-side time recomputation (30s tick) ──────────────────────────────

  useEffect(() => {
    if (orders.length === 0) return

    const tick = () => {
      const now = Date.now()
      setOrders(prev => prev.map(o => {
        const lastStatusChange = o.updatedAt || o.createdAt
        const minutesInState = Math.max(0, Math.floor((now - new Date(lastStatusChange).getTime()) / 60_000))
        const totalElapsed = Math.floor((now - new Date(o.createdAt).getTime()) / 60_000)
        const isLate = o.estimatedMinutes != null && totalElapsed > o.estimatedMinutes
        if (minutesInState === o.minutesInState && isLate === o.isLate) return o
        return { ...o, minutesInState, isLate }
      }))
    }

    const interval = setInterval(tick, 30_000)
    return () => clearInterval(interval)
  }, [orders.length])

  // ── Bucket orders into columns ─────────────────────────────────────────────

  // Build set of delivery order IDs with active exceptions
  const exceptionOrderIds = new Set(
    exceptions.map(ex => ex.deliveryOrderId).filter(Boolean) as string[]
  )

  const columns: Record<ExpoColumn, DeliveryExpoOrder[]> = {
    preparing: [],
    ready: [],
    assigned: [],
    out: [],
    problem: [],
  }

  for (const order of orders) {
    // Orders with active exceptions go to PROBLEM regardless of status
    if (exceptionOrderIds.has(order.id)) {
      columns.problem.push(order)
      continue
    }

    const col = STATUS_TO_COLUMN[order.status]
    if (col) {
      columns[col].push(order)
    }
    // Orders in terminal states (delivered, cancelled) are excluded by the API already
  }

  // Sort each column: late orders first, then by time in state descending
  for (const col of Object.values(columns)) {
    col.sort((a, b) => {
      if (a.isLate !== b.isLate) return a.isLate ? -1 : 1
      return b.minutesInState - a.minutesInState
    })
  }

  const totalActive = orders.length
  const lateCount = orders.filter(o => o.isLate).length
  const problemCount = columns.problem.length

  // If no active delivery orders and not loading, don't render the rail at all
  if (!loading && totalActive === 0 && !error) return null

  return (
    <div className="bg-gray-850 border-b border-gray-700">
      {/* Rail Header */}
      <div
        className="px-4 py-2 flex items-center justify-between cursor-pointer select-none hover:bg-gray-800/50 transition-colors"
        onClick={toggleCollapsed}
      >
        <div className="flex items-center gap-3">
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${collapsed ? '' : 'rotate-90'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-sm font-bold text-purple-400 tracking-wide">
            DELIVERY EXPO
          </span>
          <span className="text-xs text-gray-500 font-mono">
            {totalActive} active
          </span>
          {lateCount > 0 && (
            <span className="text-xs text-red-400 font-bold animate-pulse">
              {lateCount} late
            </span>
          )}
          {problemCount > 0 && (
            <span className="text-xs bg-red-600 text-white px-1.5 py-0.5 rounded font-bold">
              {problemCount} problem{problemCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          onClick={(e) => { e.stopPropagation(); toggleCollapsed() }}
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>

      {/* Rail Body */}
      {!collapsed && (
        <div className="px-4 pb-3">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
              <span className="ml-2 text-xs text-gray-500">Loading delivery orders...</span>
            </div>
          ) : error ? (
            <div className="text-center py-4">
              <span className="text-xs text-red-400">Failed to load delivery data</span>
              <button
                onClick={fetchData}
                className="ml-2 text-xs text-blue-400 hover:text-blue-300 underline"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              {COLUMN_CONFIG.map(config => (
                <ExpoColumn
                  key={config.key}
                  config={config}
                  orders={columns[config.key]}
                  exceptions={exceptions}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
