'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import MobileOrderCard from '@/components/mobile/MobileOrderCard'
import type { MobileOrderCardOrder } from '@/components/mobile/MobileOrderCard'
import { useSocket } from '@/hooks/useSocket'

type ViewMode = 'open' | 'closed'
type AgeFilter = 'all' | 'today' | 'previous' | 'declined'
type OwnerFilter = 'mine' | 'all'
type ClosedDatePreset = 'today' | 'yesterday' | 'this_week'

export default function MobileTabsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <MobileTabsContent />
    </Suspense>
  )
}

function MobileTabsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const locationId = searchParams.get('locationId') ?? ''

  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  // Orders state
  const [orders, setOrders] = useState<MobileOrderCardOrder[]>([])
  const [closedOrders, setClosedOrders] = useState<MobileOrderCardOrder[]>([])
  const [loading, setLoading] = useState(true)

  // Filter state
  const [viewMode, setViewMode] = useState<ViewMode>('open')
  const [ageFilter, setAgeFilter] = useState<AgeFilter>('all')
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('mine')
  const [closedDatePreset, setClosedDatePreset] = useState<ClosedDatePreset>('today')
  const [previousDayCount, setPreviousDayCount] = useState<number | null>(null)

  // Closed orders pagination
  const [closedCursor, setClosedCursor] = useState<string | null>(null)
  const [hasMoreClosed, setHasMoreClosed] = useState(false)

  const { socket, isConnected } = useSocket()
  const ordersRef = useRef(orders)
  ordersRef.current = orders

  // ── Auth check ──
  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/mobile/device/auth')
        if (res.ok) {
          const data = await res.json()
          setEmployeeId(data.data.employeeId)
          setAuthChecked(true)
          return
        }
      } catch {
        // network error — fall through to redirect
      }
      const loginUrl = locationId
        ? `/mobile/login?locationId=${locationId}`
        : '/mobile/login'
      router.replace(loginUrl)
    }
    checkAuth()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load open orders ──
  const loadOpenOrders = useCallback(async (forPreviousDay = false) => {
    try {
      const params = new URLSearchParams({ summary: 'true' })
      if (locationId) params.set('locationId', locationId)
      if (forPreviousDay) params.set('previousDay', 'true')

      const res = await fetch(`/api/orders/open?${params}`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        const fetched: MobileOrderCardOrder[] = data.data?.orders || []
        setOrders(fetched)
        if (forPreviousDay) setPreviousDayCount(fetched.length)
      }
    } catch (err) {
      console.error('Failed to load orders:', err)
    } finally {
      setLoading(false)
    }
  }, [locationId])

  // ── Load closed orders ──
  const loadClosedOrders = useCallback(async (cursor: string | null) => {
    if (!locationId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ locationId, limit: '50', sortBy: 'newest' })

      // Date range from preset
      const now = new Date()
      const toLocal = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

      if (closedDatePreset === 'today') {
        params.set('dateFrom', toLocal(now))
      } else if (closedDatePreset === 'yesterday') {
        const yesterday = new Date(now)
        yesterday.setDate(yesterday.getDate() - 1)
        params.set('dateFrom', toLocal(yesterday))
        params.set('dateTo', toLocal(yesterday))
      } else if (closedDatePreset === 'this_week') {
        const weekStart = new Date(now)
        weekStart.setDate(weekStart.getDate() - weekStart.getDay())
        params.set('dateFrom', toLocal(weekStart))
      }

      if (cursor) params.set('cursor', cursor)

      const res = await fetch(`/api/orders/closed?${params}`)
      if (res.ok) {
        const data = await res.json()
        const fetched = data.data?.orders || []
        if (cursor) {
          setClosedOrders(prev => [...prev, ...fetched])
        } else {
          setClosedOrders(fetched)
        }
        setClosedCursor(data.data?.pagination?.nextCursor || null)
        setHasMoreClosed(data.data?.pagination?.hasMore || false)
      }
    } catch (err) {
      console.error('Failed to load closed orders:', err)
    } finally {
      setLoading(false)
    }
  }, [locationId, closedDatePreset])

  // ── Load orders on auth + filter changes ──
  useEffect(() => {
    if (!authChecked) return
    if (viewMode === 'open') {
      loadOpenOrders(ageFilter === 'previous')
    } else {
      setClosedOrders([])
      setClosedCursor(null)
      loadClosedOrders(null)
    }
  }, [authChecked, viewMode, ageFilter, closedDatePreset, loadOpenOrders, loadClosedOrders])

  // ── Background fetch: previous day count ──
  useEffect(() => {
    if (!authChecked || !locationId || ageFilter === 'previous') return
    const params = new URLSearchParams({ summary: 'true', previousDay: 'true' })
    if (locationId) params.set('locationId', locationId)
    fetch(`/api/orders/open?${params}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setPreviousDayCount((data.data?.orders || []).length) })
      .catch(() => {})
  }, [authChecked, locationId, ageFilter])

  // ── Socket updates (debounced) ──
  const debouncedRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedRefresh = useCallback(() => {
    if (debouncedRefreshRef.current) clearTimeout(debouncedRefreshRef.current)
    debouncedRefreshRef.current = setTimeout(() => {
      if (viewMode === 'open') loadOpenOrders(ageFilter === 'previous')
    }, 300)
  }, [viewMode, ageFilter, loadOpenOrders])

  useEffect(() => {
    return () => { if (debouncedRefreshRef.current) clearTimeout(debouncedRefreshRef.current) }
  }, [])

  useEffect(() => {
    if (!socket || !isConnected || viewMode !== 'open') return

    const handleOrdersChanged = (data: { trigger?: string; orderId?: string }) => {
      if (ageFilter === 'previous') return // Don't overwrite previous-day results
      const { trigger, orderId } = data
      if (orderId && (trigger === 'paid' || trigger === 'voided')) {
        // Delta remove
        setOrders(prev => prev.filter(o => o.id !== orderId))
      } else {
        debouncedRefresh()
      }
    }

    socket.on('orders:list-changed', handleOrdersChanged)
    socket.on('order:created', debouncedRefresh)
    socket.on('order:updated', debouncedRefresh)
    socket.on('payment:processed', debouncedRefresh)
    socket.on('tab:updated', debouncedRefresh)

    return () => {
      socket.off('orders:list-changed', handleOrdersChanged)
      socket.off('order:created', debouncedRefresh)
      socket.off('order:updated', debouncedRefresh)
      socket.off('payment:processed', debouncedRefresh)
      socket.off('tab:updated', debouncedRefresh)
    }
  }, [socket, isConnected, viewMode, ageFilter, debouncedRefresh])

  // ── Disconnected-only polling fallback (20s) ──
  useEffect(() => {
    if (isConnected || viewMode !== 'open') return
    const fallback = setInterval(() => loadOpenOrders(ageFilter === 'previous'), 20000)
    return () => clearInterval(fallback)
  }, [isConnected, viewMode, ageFilter, loadOpenOrders])

  // ── Visibility change (instant refresh on foreground) ──
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') {
        if (viewMode === 'open') loadOpenOrders(ageFilter === 'previous')
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [viewMode, ageFilter, loadOpenOrders])

  // ── Reconnect refresh ──
  const prevConnectedRef = useRef(false)
  useEffect(() => {
    if (isConnected && !prevConnectedRef.current && viewMode === 'open') {
      loadOpenOrders(ageFilter === 'previous')
    }
    prevConnectedRef.current = isConnected
  }, [isConnected, viewMode, ageFilter, loadOpenOrders])

  // ── Don't render until auth is resolved ──
  if (!authChecked) {
    return <div className="min-h-screen bg-gray-950" />
  }

  // ── Filter + sort ──
  const sourceOrders = viewMode === 'open' ? orders : closedOrders
  let filteredOrders = [...sourceOrders]

  // Owner filter (only for open orders — closed doesn't have realtime employee context)
  if (ownerFilter === 'mine' && employeeId) {
    filteredOrders = filteredOrders.filter(o => o.employee.id === employeeId)
  }

  // Age filter — 'previous' handled server-side; 'declined' is client-side
  if (viewMode === 'open' && ageFilter === 'declined') {
    filteredOrders = filteredOrders.filter(o => o.isCaptureDeclined)
  }

  // Sort: newest first (declined / rolled-over first as priority)
  filteredOrders.sort((a, b) => {
    // Priority: declined first
    if (a.isCaptureDeclined && !b.isCaptureDeclined) return -1
    if (!a.isCaptureDeclined && b.isCaptureDeclined) return 1
    // Then rolled-over
    if (a.isRolledOver && !b.isRolledOver) return -1
    if (!a.isRolledOver && b.isRolledOver) return 1
    // Then by time (newest first)
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  const declinedCount = orders.filter(o => o.isCaptureDeclined).length

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <h1 className="text-xl font-bold">Orders</h1>
        <div className="flex items-center gap-3">
          <a
            href={locationId ? `/mobile/schedule?locationId=${locationId}` : '/mobile/schedule'}
            className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white/90 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Schedule
          </a>
          {!isConnected && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-600/40 text-red-300">
              Offline
            </span>
          )}
          <span className="text-white/40 text-sm">{filteredOrders.length} orders</span>
        </div>
      </div>

      {/* Open / Closed toggle */}
      <div className="flex gap-1 p-2 border-b border-white/10">
        <button
          onClick={() => setViewMode('open')}
          className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
            viewMode === 'open'
              ? 'bg-indigo-600/40 text-white border border-indigo-500/50'
              : 'text-white/40 hover:text-white/60'
          }`}
        >
          Open ({orders.length})
        </button>
        <button
          onClick={() => setViewMode('closed')}
          className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
            viewMode === 'closed'
              ? 'bg-indigo-600/40 text-white border border-indigo-500/50'
              : 'text-white/40 hover:text-white/60'
          }`}
        >
          Closed
        </button>
      </div>

      {/* Sub-filters row */}
      <div className="flex gap-1 p-2 border-b border-white/10 overflow-x-auto">
        {/* Mine / All */}
        <button
          onClick={() => setOwnerFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0 ${
            ownerFilter === 'all'
              ? 'bg-white/15 text-white'
              : 'bg-white/5 text-white/40 hover:bg-white/10'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setOwnerFilter('mine')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0 ${
            ownerFilter === 'mine'
              ? 'bg-white/15 text-white'
              : 'bg-white/5 text-white/40 hover:bg-white/10'
          }`}
        >
          Mine
        </button>

        <div className="w-px h-6 mx-1 bg-white/10 self-center flex-shrink-0" />

        {/* Date/status filters */}
        {viewMode === 'open' ? (
          <>
            {(['all', 'today', 'previous', 'declined'] as const).map(f => {
              let label = f === 'all' ? 'All' : f === 'today' ? 'Today' : f === 'previous' ? 'Previous Day' : 'Declined'
              const count = f === 'previous' ? previousDayCount : f === 'declined' ? declinedCount : null
              if (count != null && count > 0) label += ` (${count})`

              return (
                <button
                  key={f}
                  onClick={() => setAgeFilter(f)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0 ${
                    ageFilter === f
                      ? f === 'declined'
                        ? 'bg-red-600/40 text-red-300 border border-red-500/50'
                        : 'bg-blue-600 text-white'
                      : 'bg-white/5 text-white/40 hover:bg-white/10'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </>
        ) : (
          <>
            {(['today', 'yesterday', 'this_week'] as const).map(preset => (
              <button
                key={preset}
                onClick={() => setClosedDatePreset(preset)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0 ${
                  closedDatePreset === preset
                    ? 'bg-blue-600 text-white'
                    : 'bg-white/5 text-white/40 hover:bg-white/10'
                }`}
              >
                {preset === 'today' ? 'Today' : preset === 'yesterday' ? 'Yesterday' : 'This Week'}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Order List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && filteredOrders.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="text-center py-12 text-white/40">
            <p className="text-lg">
              {viewMode === 'open'
                ? ageFilter === 'declined'
                  ? 'No declined orders'
                  : ageFilter === 'previous'
                    ? 'No previous day orders'
                    : 'No open orders'
                : 'No closed orders'
              }
            </p>
            <p className="text-sm mt-1 text-white/25">
              {viewMode === 'open'
                ? 'Orders will appear here when created'
                : 'Paid orders will appear here'
              }
            </p>
          </div>
        ) : (
          <>
            {filteredOrders.map(order => (
              <MobileOrderCard
                key={order.id}
                order={order}
                showDate={ageFilter === 'previous' || viewMode === 'closed' || order.isRolledOver}
                onTap={() => {
                  window.location.href = `/mobile/tabs/${order.id}`
                }}
              />
            ))}

            {/* Load More for closed orders */}
            {viewMode === 'closed' && hasMoreClosed && (
              <div className="text-center py-3">
                <button
                  onClick={() => loadClosedOrders(closedCursor)}
                  className="px-6 py-2.5 rounded-lg text-sm font-semibold bg-white/10 hover:bg-white/15 text-white transition-colors"
                >
                  Load More
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
