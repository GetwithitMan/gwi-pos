'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProductionTierModifier {
  id: string
  name: string
}

interface ProductionTier {
  id: string
  tierNumber: number
  size: string
  flavor: string
  filling: string | null
  frosting: string | null
  shape: string | null
  servings: number | null
  notes: string | null
  modifiers: ProductionTierModifier[]
}

interface ProductionOrder {
  id: string
  orderNumber: number
  status: string
  customerName: string
  eventDate: string
  eventTime: string | null
  allergies: string | null
  cakeMessage: string | null
  decorations: string | null
  deliveryAddress: string | null
  deliveryNotes: string | null
  tiers: ProductionTier[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  in_production: 'In Production',
  ready: 'Ready',
}

const STATUS_COLORS: Record<string, string> = {
  in_production: 'bg-yellow-100 text-yellow-800',
  ready: 'bg-green-100 text-green-800',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDefaultDateRange(): { from: string; to: string } {
  const today = new Date()
  const nextWeek = new Date(today)
  nextWeek.setDate(today.getDate() + 7)
  return {
    from: today.toISOString().split('T')[0],
    to: nextWeek.toISOString().split('T')[0],
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CakeProductionPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/settings/cake-orders/production' })
  const employee = useAuthStore(s => s.employee)
  const locationId = useAuthStore(s => s.locationId)

  const defaultRange = getDefaultDateRange()
  const [dateFrom, setDateFrom] = useState(defaultRange.from)
  const [dateTo, setDateTo] = useState(defaultRange.to)
  const [orders, setOrders] = useState<ProductionOrder[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [advancingId, setAdvancingId] = useState<string | null>(null)

  const loadOrders = useCallback(async () => {
    if (!locationId) return
    try {
      const params = new URLSearchParams({
        locationId,
        status: 'in_production,ready',
        dateFrom,
        dateTo,
        limit: '200',
      })
      const res = await fetch(`/api/cake-orders?${params}`)
      if (!res.ok) throw new Error('Failed to load production orders')
      const json = await res.json()
      setOrders(json.data.orders)
    } catch {
      toast.error('Failed to load production orders')
    } finally {
      setIsLoading(false)
    }
  }, [locationId, dateFrom, dateTo])

  useEffect(() => {
    if (hydrated && locationId) {
      setIsLoading(true)
      loadOrders()
    }
  }, [hydrated, locationId, loadOrders])

  // Socket-driven auto-refresh for real-time production updates
  const cakeEvents = useMemo(() => ['cake-orders:new', 'cake-orders:updated', 'cake-orders:list-changed'], [])
  useReportAutoRefresh({
    onRefresh: loadOrders,
    events: cakeEvents,
    debounceMs: 2000,
    enabled: hydrated && !!locationId,
  })

  const advanceStatus = async (orderId: string, action: string) => {
    try {
      setAdvancingId(orderId)
      const res = await fetch(`/api/cake-orders/${orderId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, employeeId: employee?.id }),
      })
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.error || 'Failed to update status')
      }
      toast.success('Status updated')
      loadOrders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setAdvancingId(null)
    }
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Baker Production"
        subtitle="Orders in production and ready for pickup/delivery"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Cake Orders', href: '/settings/cake-orders' },
        ]}
        backHref="/settings/cake-orders"
      />

      <div className="max-w-7xl mx-auto mt-6 space-y-4">
        {/* Date Filters */}
        <div className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 p-4">
          <span className="text-sm font-medium text-gray-700">Event date range:</span>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <span className="text-gray-400">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            onClick={() => {
              const d = getDefaultDateRange()
              setDateFrom(d.from)
              setDateTo(d.to)
            }}
            className="text-xs text-indigo-600 font-medium hover:text-indigo-700"
          >
            Reset to next 7 days
          </button>
        </div>

        {/* Orders */}
        {isLoading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
            Loading production orders...
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
            No orders in production for this date range.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {orders.map(order => (
              <div key={order.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Card Header */}
                <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <span className="text-sm font-bold text-gray-900">CK-{order.orderNumber}</span>
                    <span className="ml-2 text-xs text-gray-500">{formatDate(order.eventDate)}</span>
                    {order.eventTime && <span className="ml-1 text-xs text-gray-500">at {order.eventTime}</span>}
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-800'}`}>
                    {STATUS_LABELS[order.status] || order.status}
                  </span>
                </div>

                {/* Customer */}
                <div className="px-4 py-2 border-b border-gray-50">
                  <div className="text-sm font-medium text-gray-900">{order.customerName}</div>
                </div>

                {/* Allergies Warning */}
                {order.allergies && (
                  <div className="mx-4 mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                    <div className="text-xs font-bold text-red-700 uppercase">Allergy Alert</div>
                    <div className="text-sm text-red-800">{order.allergies}</div>
                  </div>
                )}

                {/* Tiers */}
                <div className="p-4 space-y-3">
                  {order.tiers.map(tier => (
                    <div key={tier.id} className="bg-gray-50 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-gray-700 uppercase">Tier {tier.tierNumber}</span>
                        <span className="text-xs text-gray-500">
                          {tier.size} {tier.shape && `(${tier.shape})`}
                          {tier.servings && ` | ${tier.servings} svgs`}
                        </span>
                      </div>
                      <div className="text-sm text-gray-800 space-y-0.5">
                        <div><span className="text-gray-500">Flavor:</span> {tier.flavor}</div>
                        {tier.filling && <div><span className="text-gray-500">Filling:</span> {tier.filling}</div>}
                        {tier.frosting && <div><span className="text-gray-500">Frosting:</span> {tier.frosting}</div>}
                      </div>
                      {tier.modifiers.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {tier.modifiers.map(mod => (
                            <span key={mod.id} className="px-1.5 py-0.5 rounded text-xs bg-white border border-gray-200 text-gray-600">
                              {mod.name}
                            </span>
                          ))}
                        </div>
                      )}
                      {tier.notes && (
                        <div className="mt-1 text-xs text-gray-500 italic">{tier.notes}</div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Decorations + Message */}
                {(order.decorations || order.cakeMessage) && (
                  <div className="px-4 pb-3 space-y-2">
                    {order.decorations && (
                      <div>
                        <div className="text-xs font-semibold text-gray-500 uppercase">Decorations</div>
                        <div className="text-sm text-gray-800">{order.decorations}</div>
                      </div>
                    )}
                    {order.cakeMessage && (
                      <div>
                        <div className="text-xs font-semibold text-gray-500 uppercase">Cake Message</div>
                        <div className="text-sm text-gray-800 italic">&quot;{order.cakeMessage}&quot;</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Delivery Info */}
                {order.deliveryAddress && (
                  <div className="px-4 pb-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase">Delivery</div>
                    <div className="text-sm text-gray-800">{order.deliveryAddress}</div>
                    {order.deliveryNotes && (
                      <div className="text-xs text-gray-500 mt-0.5">{order.deliveryNotes}</div>
                    )}
                  </div>
                )}

                {/* Action Button */}
                <div className="p-4 border-t border-gray-100">
                  {order.status === 'in_production' && (
                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full"
                      onClick={() => advanceStatus(order.id, 'mark_ready')}
                      disabled={advancingId === order.id}
                    >
                      {advancingId === order.id ? 'Updating...' : 'Mark Ready'}
                    </Button>
                  )}
                  {order.status === 'ready' && (
                    <div className="flex gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        className="flex-1"
                        onClick={() => advanceStatus(order.id, 'mark_delivered')}
                        disabled={advancingId === order.id}
                      >
                        {advancingId === order.id ? 'Updating...' : 'Mark Delivered'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => advanceStatus(order.id, 'complete')}
                        disabled={advancingId === order.id}
                      >
                        {advancingId === order.id ? 'Updating...' : 'Complete (Pickup)'}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
