'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { toast } from '@/stores/toast-store'
import { formatCurrency } from '@/lib/utils'

interface VendorOrder {
  id: string
  orderNumber: string
  vendorId: string
  vendorName: string
  status: string
  lineItemCount: number
  estimatedTotal: number
  orderDate: string
  expectedDelivery: string | null
  createdByName: string | null
  createdAt: string
}

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'partially_received', label: 'Partially Received' },
  { value: 'received', label: 'Received' },
  { value: 'cancelled', label: 'Cancelled' },
]

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-900',
  sent: 'bg-blue-50 text-blue-700',
  confirmed: 'bg-purple-50 text-purple-700',
  partially_received: 'bg-yellow-50 text-yellow-700',
  received: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-700',
}

export default function PurchaseOrdersPage() {
  const employee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/inventory/orders' })
  const locationId = employee?.location?.id

  const [orders, setOrders] = useState<VendorOrder[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterVendor, setFilterVendor] = useState('')

  const loadOrders = useCallback(async () => {
    if (!locationId || !employee?.id) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId,
        employeeId: employee.id,
      })
      const res = await fetch(`/api/inventory/orders?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setOrders(data.data?.orders || data.orders || [])
    } catch {
      toast.error('Failed to load purchase orders')
    } finally {
      setIsLoading(false)
    }
  }, [locationId, employee?.id])

  useEffect(() => { loadOrders() }, [loadOrders])

  // Filter orders
  const filtered = useMemo(() => {
    let result = orders
    if (filterStatus !== 'all') {
      result = result.filter(o => o.status === filterStatus)
    }
    if (filterVendor) {
      const lower = filterVendor.toLowerCase()
      result = result.filter(o => o.vendorName.toLowerCase().includes(lower))
    }
    return result
  }, [orders, filterStatus, filterVendor])

  // Summary counts
  const counts = useMemo(() => ({
    total: orders.length,
    pending: orders.filter(o => o.status === 'draft' || o.status === 'sent').length,
    partiallyReceived: orders.filter(o => o.status === 'partially_received').length,
  }), [orders])

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Purchase Orders"
        subtitle={`${counts.total} order${counts.total !== 1 ? 's' : ''}`}
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }]}
        actions={
          <Link href="/inventory/orders/new">
            <Button>+ New Purchase Order</Button>
          </Link>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-600">Total Orders</p>
            <p className="text-3xl font-bold text-gray-900">{counts.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-blue-600">Pending</p>
            <p className="text-3xl font-bold text-blue-700">{counts.pending}</p>
            <p className="text-xs text-gray-900">Draft + Sent</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-yellow-600">Partially Received</p>
            <p className="text-3xl font-bold text-yellow-700">{counts.partiallyReceived}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="mb-6 space-y-3">
        {/* Status Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setFilterStatus(tab.value)}
              className={`px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
                filterStatus === tab.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Vendor Search */}
        <input
          type="text"
          placeholder="Search by vendor name..."
          value={filterVendor}
          onChange={(e) => setFilterVendor(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm w-full max-w-xs"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <Card>
          <CardContent className="p-8 text-center text-gray-900">
            Loading...
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-gray-900 text-lg mb-2">No purchase orders yet</p>
            <Link href="/inventory/orders/new" className="text-blue-600 hover:underline text-sm">
              Create your first PO
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Order #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Vendor</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Items</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Est. Total</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Order Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Expected Delivery</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map(order => (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {order.orderNumber}
                    </td>
                    <td className="px-4 py-3 text-gray-900">
                      {order.vendorName}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[order.status] || 'bg-gray-100'}`}>
                        {order.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      {order.lineItemCount}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {formatCurrency(order.estimatedTotal)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {new Date(order.orderDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {order.expectedDelivery
                        ? new Date(order.expectedDelivery).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/inventory/orders/${order.id}`}>
                        <Button variant="outline" size="sm">View</Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
