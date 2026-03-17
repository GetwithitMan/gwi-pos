'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CakeOrder {
  id: string
  orderNumber: number
  status: string
  customerName: string
  customerPhone: string | null
  customerEmail: string | null
  eventDate: string
  tiers: number
  total: number | null
  depositPaid: number
  createdAt: string
}

interface CakeOrderListResponse {
  orders: CakeOrder[]
  total: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUSES = [
  'all',
  'submitted',
  'quoted',
  'approved',
  'in_production',
  'ready',
  'delivered',
  'completed',
  'cancelled',
] as const

const STATUS_LABELS: Record<string, string> = {
  all: 'All',
  submitted: 'Submitted',
  quoted: 'Quoted',
  approved: 'Approved',
  deposit_paid: 'Deposit Paid',
  in_production: 'In Production',
  ready: 'Ready',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const STATUS_COLORS: Record<string, string> = {
  submitted: 'bg-gray-100 text-gray-800',
  quoted: 'bg-blue-100 text-blue-800',
  approved: 'bg-purple-100 text-purple-800',
  deposit_paid: 'bg-indigo-100 text-indigo-800',
  in_production: 'bg-yellow-100 text-yellow-800',
  ready: 'bg-green-100 text-green-800',
  delivered: 'bg-teal-100 text-teal-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-red-100 text-red-800',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CakeOrdersListPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/settings/cake-orders' })
  const locationId = useAuthStore(s => s.locationId)
  const router = useRouter()

  const [orders, setOrders] = useState<CakeOrder[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const loadOrders = useCallback(async () => {
    if (!locationId) return
    try {
      const params = new URLSearchParams({ locationId, limit: '200' })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (search.trim()) params.set('search', search.trim())
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)

      const res = await fetch(`/api/cake-orders?${params}`)
      if (!res.ok) throw new Error('Failed to load orders')
      const json: { data: CakeOrderListResponse } = await res.json()
      setOrders(json.data.orders)
    } catch {
      toast.error('Failed to load cake orders')
    } finally {
      setIsLoading(false)
    }
  }, [locationId, statusFilter, search, dateFrom, dateTo])

  // Initial load + filter changes
  useEffect(() => {
    if (hydrated && locationId) {
      setIsLoading(true)
      loadOrders()
    }
  }, [hydrated, locationId, loadOrders])

  // Socket-driven auto-refresh (replaces 30s polling)
  const cakeEvents = useMemo(() => ['cake-orders:new', 'cake-orders:updated', 'cake-orders:list-changed'], [])
  useReportAutoRefresh({
    onRefresh: loadOrders,
    events: cakeEvents,
    debounceMs: 2000,
    enabled: hydrated && !!locationId,
  })

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Cake Orders"
        subtitle="Manage custom cake orders, quotes, and fulfillment"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push('/settings/cake-orders/production')}>
              Production View
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push('/settings/cake-orders/config')}>
              Settings
            </Button>
          </div>
        }
      />

      <div className="max-w-7xl mx-auto mt-6 space-y-4">
        {/* Status Tabs */}
        <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden w-fit">
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === s ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {STATUS_LABELS[s] || s}
            </button>
          ))}
        </div>

        {/* Search + Date Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by customer name, order #..."
            className="w-72 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Event date:</span>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <span>to</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          {(search || dateFrom || dateTo) && (
            <button
              onClick={() => { setSearch(''); setDateFrom(''); setDateTo('') }}
              className="text-xs text-indigo-600 font-medium hover:text-indigo-700"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Order List */}
        {isLoading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
            Loading cake orders...
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
            No cake orders found.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {orders.map(order => (
              <button
                key={order.id}
                onClick={() => router.push(`/settings/cake-orders/orders/${order.id}`)}
                className="text-left bg-white rounded-xl border border-gray-200 p-4 transition-colors hover:border-indigo-300 hover:shadow-sm"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-sm font-semibold text-gray-900">
                    CK-{order.orderNumber}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-800'}`}>
                    {STATUS_LABELS[order.status] || order.status}
                  </span>
                </div>
                <div className="text-sm text-gray-900 font-medium">{order.customerName}</div>
                <div className="flex items-center justify-between mt-2 text-xs text-gray-600">
                  <span>{formatDate(order.eventDate)}</span>
                  {order.total != null && (
                    <span className="font-medium text-gray-900">{formatCurrency(Number(order.total))}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
