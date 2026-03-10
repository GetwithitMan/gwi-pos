'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'
import { toast } from '@/stores/toast-store'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ThirdPartyOrder {
  id: string
  platform: 'doordash' | 'ubereats' | 'grubhub'
  externalOrderId: string
  customerName: string | null
  customerPhone: string | null
  status: string
  orderId: string | null
  items: Array<{ name: string; quantity: number; price: number; modifiers?: string[] }>
  subtotal: number
  tax: number
  deliveryFee: number
  tip: number
  total: number
  specialInstructions: string | null
  estimatedPickupAt: string | null
  createdAt: string
}

interface PlatformSummary {
  platform: string
  orderCount: number
  total: number
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PLATFORM_LABELS: Record<string, string> = {
  doordash: 'DoorDash',
  ubereats: 'UberEats',
  grubhub: 'Grubhub',
}

const PLATFORM_COLORS: Record<string, string> = {
  doordash: 'bg-red-100 text-red-800',
  ubereats: 'bg-green-100 text-green-800',
  grubhub: 'bg-orange-100 text-orange-800',
}

const STATUS_COLORS: Record<string, string> = {
  received: 'bg-blue-100 text-blue-800',
  accepted: 'bg-indigo-100 text-indigo-800',
  preparing: 'bg-yellow-100 text-yellow-800',
  ready: 'bg-emerald-100 text-emerald-800',
  picked_up: 'bg-purple-100 text-purple-800',
  delivered: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-600',
}

const DELIVERY_EVENTS = [
  'delivery:new-order',
  'delivery:status-update',
  'orders:list-changed',
]

// ─── Component ──────────────────────────────────────────────────────────────

export default function ThirdPartyDeliveryPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id

  const [orders, setOrders] = useState<ThirdPartyOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [platformFilter, setPlatformFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [summary, setSummary] = useState<PlatformSummary[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // ── Data Fetching ─────────────────────────────────────────────────────────

  const fetchOrders = useCallback(async () => {
    if (!locationId || !employee?.id) return

    try {
      const params = new URLSearchParams({
        locationId,
        employeeId: employee.id,
        limit: '200',
      })

      if (platformFilter !== 'all') {
        params.set('platform', platformFilter)
      }

      if (statusFilter === 'active') {
        // Active = not delivered/cancelled
      } else if (statusFilter !== 'all') {
        params.set('status', statusFilter)
      }

      // Today's date
      const today = new Date().toISOString().split('T')[0]
      params.set('startDate', today)

      const res = await fetch(`/api/third-party-orders?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const json = await res.json()
      let data = json.data || []

      // Client-side filter for "active" since API doesn't support NOT IN
      if (statusFilter === 'active') {
        data = data.filter((o: ThirdPartyOrder) => !['delivered', 'cancelled'].includes(o.status))
      }

      setOrders(data)

      // Calculate platform summary
      const allOrders = json.data || []
      const summaryMap: Record<string, PlatformSummary> = {}
      for (const o of allOrders) {
        if (!summaryMap[o.platform]) {
          summaryMap[o.platform] = { platform: o.platform, orderCount: 0, total: 0 }
        }
        summaryMap[o.platform].orderCount++
        summaryMap[o.platform].total += o.total
      }
      setSummary(Object.values(summaryMap))
    } catch (error) {
      console.error('[ThirdPartyDelivery] Fetch error:', error)
    } finally {
      setLoading(false)
    }
  }, [locationId, employee?.id, platformFilter, statusFilter])

  useEffect(() => { void fetchOrders() }, [fetchOrders])

  // Auto-refresh via socket
  useReportAutoRefresh({
    onRefresh: fetchOrders,
    events: DELIVERY_EVENTS,
    debounceMs: 1000,
  })

  // Audio alert for new orders
  useEffect(() => {
    audioRef.current = new Audio('data:audio/wav;base64,UklGRl9vT19teleVcFkAAQBIAEgAAAABAAEARKwAAIhYAQACABAAZGF0YQ==')
    return () => { audioRef.current = null }
  }, [])

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleAction(orderId: string, action: 'accept' | 'reject' | 'ready') {
    if (!locationId || !employee?.id) return

    try {
      const res = await fetch(`/api/third-party-orders/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          employeeId: employee.id,
          action,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || `Failed to ${action} order`)
        return
      }

      toast.success(
        action === 'accept' ? 'Order accepted and sent to kitchen' :
        action === 'reject' ? 'Order rejected' :
        'Order marked ready for pickup'
      )

      void fetchOrders()
    } catch {
      toast.error(`Failed to ${action} order`)
    }
  }

  async function handleStatusUpdate(orderId: string, status: string) {
    if (!locationId || !employee?.id) return

    try {
      const res = await fetch(`/api/third-party-orders/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          employeeId: employee.id,
          action: 'status_update',
          status,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to update status')
        return
      }

      toast.success(`Status updated to ${status}`)
      void fetchOrders()
    } catch {
      toast.error('Failed to update status')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Third-Party Delivery Orders</h1>
        <div className="text-gray-900">Loading...</div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Third-Party Delivery Orders</h1>
      <p className="text-sm text-gray-900 mb-6">DoorDash, UberEats, and Grubhub orders</p>

      {/* ── Summary Cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {(['doordash', 'ubereats', 'grubhub'] as const).map(platform => {
          const stats = summary.find(s => s.platform === platform)
          return (
            <div key={platform} className="bg-white rounded-xl border p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${PLATFORM_COLORS[platform]}`}>
                  {PLATFORM_LABELS[platform]}
                </span>
              </div>
              <div className="text-2xl font-bold">{stats?.orderCount || 0}</div>
              <div className="text-sm text-gray-900">
                orders today / ${(stats?.total || 0).toFixed(2)} revenue
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <select
          value={platformFilter}
          onChange={e => setPlatformFilter(e.target.value)}
          className="px-3 py-2 border rounded-lg text-sm"
        >
          <option value="all">All Platforms</option>
          <option value="doordash">DoorDash</option>
          <option value="ubereats">UberEats</option>
          <option value="grubhub">Grubhub</option>
        </select>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 border rounded-lg text-sm"
        >
          <option value="active">Active Orders</option>
          <option value="all">All Statuses</option>
          <option value="received">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="preparing">Preparing</option>
          <option value="ready">Ready</option>
          <option value="picked_up">Picked Up</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <button
          onClick={() => void fetchOrders()}
          className="px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
        >
          Refresh
        </button>
      </div>

      {/* ── Order List ──────────────────────────────────────────────────── */}
      {orders.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center text-gray-900">
          No delivery orders found for the selected filters.
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map(order => (
            <div key={order.id} className="bg-white rounded-xl border p-4">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${PLATFORM_COLORS[order.platform]}`}>
                    {PLATFORM_LABELS[order.platform] || order.platform}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[order.status] || 'bg-gray-100'}`}>
                    {order.status.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-gray-900">
                    #{order.externalOrderId.slice(-6)}
                  </span>
                </div>

                <div className="text-right">
                  <div className="text-lg font-bold">${order.total.toFixed(2)}</div>
                  <div className="text-xs text-gray-900">
                    {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>

              {/* Customer */}
              {order.customerName && (
                <div className="text-sm text-gray-900 mb-2">
                  {order.customerName}
                  {order.customerPhone && <span className="text-gray-900 ml-2">{order.customerPhone}</span>}
                </div>
              )}

              {/* Items */}
              <div className="mb-3">
                {(order.items || []).slice(0, 5).map((item, i) => (
                  <div key={i} className="text-sm text-gray-600">
                    <span className="font-medium">{item.quantity}x</span>{' '}
                    {item.name}
                    {item.modifiers && item.modifiers.length > 0 && (
                      <span className="text-gray-900 ml-1">
                        ({item.modifiers.join(', ')})
                      </span>
                    )}
                    <span className="text-gray-900 ml-1">${(item.price * item.quantity).toFixed(2)}</span>
                  </div>
                ))}
                {(order.items || []).length > 5 && (
                  <div className="text-xs text-gray-900 mt-1">
                    +{order.items.length - 5} more items
                  </div>
                )}
              </div>

              {/* Special instructions */}
              {order.specialInstructions && (
                <div className="text-xs text-amber-700 bg-amber-50 rounded p-2 mb-3">
                  {order.specialInstructions}
                </div>
              )}

              {/* Price breakdown */}
              <div className="flex gap-4 text-xs text-gray-900 mb-3">
                <span>Subtotal: ${order.subtotal.toFixed(2)}</span>
                <span>Tax: ${order.tax.toFixed(2)}</span>
                {order.deliveryFee > 0 && <span>Delivery: ${order.deliveryFee.toFixed(2)}</span>}
                {order.tip > 0 && <span>Tip: ${order.tip.toFixed(2)} (paid by platform)</span>}
              </div>

              {/* Estimated pickup */}
              {order.estimatedPickupAt && (
                <div className="text-xs text-gray-900 mb-3">
                  Est. pickup: {new Date(order.estimatedPickupAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 flex-wrap">
                {order.status === 'received' && (
                  <>
                    <button
                      onClick={() => void handleAction(order.id, 'accept')}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => void handleAction(order.id, 'reject')}
                      className="px-4 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200 transition"
                    >
                      Reject
                    </button>
                  </>
                )}

                {order.status === 'accepted' && (
                  <button
                    onClick={() => void handleStatusUpdate(order.id, 'preparing')}
                    className="px-4 py-2 bg-yellow-100 text-yellow-800 rounded-lg text-sm font-medium hover:bg-yellow-200 transition"
                  >
                    Start Preparing
                  </button>
                )}

                {order.status === 'preparing' && (
                  <button
                    onClick={() => void handleAction(order.id, 'ready')}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition"
                  >
                    Ready for Pickup
                  </button>
                )}

                {order.orderId && (
                  <span className="px-3 py-2 text-xs text-indigo-600 bg-indigo-50 rounded-lg">
                    POS Order linked
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
