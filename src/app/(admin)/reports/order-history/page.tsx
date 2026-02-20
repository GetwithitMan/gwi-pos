'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { ReceiptModal } from '@/components/receipt'
import { AdjustTipModal } from '@/components/orders/AdjustTipModal'
import { VoidPaymentModal } from '@/components/orders/VoidPaymentModal'
import { ReopenOrderModal } from '@/components/orders/ReopenOrderModal'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { WebReportBanner } from '@/components/admin/WebReportBanner'
import { useDataRetention } from '@/hooks/useDataRetention'

interface Payment {
  id: string
  method: string
  paymentMethod: string
  amount: number
  tipAmount: number
  totalAmount: number
  cardLast4?: string
  cardBrand?: string
}

interface Order {
  id: string
  orderNumber: number
  orderType: string
  status: string
  tableName?: string
  tabName?: string
  guestCount: number
  subtotal: number
  taxTotal: number
  discountTotal: number
  total: number
  employee?: { id: string; firstName: string; lastName: string }
  customer?: { id: string; firstName: string; lastName: string; phone?: string }
  itemCount: number
  payments: Payment[]
  createdAt: string
  closedAt?: string
}

interface Summary {
  orderCount: number
  subtotal: number
  taxTotal: number
  discountTotal: number
  total: number
}

interface StatusBreakdown {
  status: string
  count: number
  total: number
}

interface TypeBreakdown {
  type: string
  count: number
  total: number
}

interface PaymentBreakdown {
  method: string
  count: number
  amount: number
  tips: number
}

export default function OrderHistoryPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/order-history' })
  const employee = useAuthStore(s => s.employee)
  const { retentionDays, venueSlug } = useDataRetention()
  const [orders, setOrders] = useState<Order[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [statusBreakdown, setStatusBreakdown] = useState<StatusBreakdown[]>([])
  const [typeBreakdown, setTypeBreakdown] = useState<TypeBreakdown[]>([])
  const [paymentBreakdown, setPaymentBreakdown] = useState<PaymentBreakdown[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  // Filters
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const [status, setStatus] = useState('')
  const [orderType, setOrderType] = useState('')
  const [search, setSearch] = useState('')

  // Receipt modal
  const [showReceipt, setShowReceipt] = useState(false)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)

  // Action modals
  const [showAdjustTip, setShowAdjustTip] = useState(false)
  const [showVoidPayment, setShowVoidPayment] = useState(false)
  const [showReopenOrder, setShowReopenOrder] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null)

  useEffect(() => {
    loadOrders()
  }, [page, startDate, endDate, status, orderType])

  const loadOrders = async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        employeeId: employee.id,
        page: page.toString(),
        limit: '50',
      })
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      if (status) params.set('status', status)
      if (orderType) params.set('orderType', orderType)
      if (search) params.set('search', search)

      const res = await fetch(`/api/reports/order-history?${params}`)
      if (res.ok) {
        const data = await res.json()
        setOrders(data.data.orders)
        setSummary(data.data.summary)
        setStatusBreakdown(data.data.statusBreakdown)
        setTypeBreakdown(data.data.typeBreakdown)
        setPaymentBreakdown(data.data.paymentBreakdown)
        setTotalPages(data.data.pagination.totalPages)
      }
    } catch (error) {
      console.error('Failed to load orders:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    loadOrders()
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid': return 'bg-green-100 text-green-800'
      case 'closed': return 'bg-gray-100 text-gray-800'
      case 'open': return 'bg-blue-100 text-blue-800'
      case 'voided': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getOrderTypeLabel = (type: string) => {
    switch (type) {
      case 'dine_in': return 'Dine In'
      case 'takeout': return 'Takeout'
      case 'delivery': return 'Delivery'
      case 'bar_tab': return 'Bar Tab'
      default: return type
    }
  }

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Order History"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
      />

      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Order History</h1>
          <p className="text-gray-600">View and search past orders</p>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <form onSubmit={handleSearch} className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="border rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="border rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="border rounded px-3 py-2"
                >
                  <option value="">All</option>
                  <option value="open">Open</option>
                  <option value="paid">Paid</option>
                  <option value="closed">Closed</option>
                  <option value="voided">Voided</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Type</label>
                <select
                  value={orderType}
                  onChange={(e) => setOrderType(e.target.value)}
                  className="border rounded px-3 py-2"
                >
                  <option value="">All</option>
                  <option value="dine_in">Dine In</option>
                  <option value="takeout">Takeout</option>
                  <option value="delivery">Delivery</option>
                  <option value="bar_tab">Bar Tab</option>
                </select>
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm text-gray-600 mb-1">Search</label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Order #, table, customer..."
                  className="border rounded px-3 py-2 w-full"
                />
              </div>
              <Button type="submit">Search</Button>
            </form>
          </CardContent>
        </Card>

        <WebReportBanner
          startDate={startDate}
          endDate={endDate}
          reportType="order-history"
          retentionDays={retentionDays}
          venueSlug={venueSlug}
        />

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">{summary.orderCount}</p>
                <p className="text-sm text-gray-600">Orders</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">{formatCurrency(summary.subtotal)}</p>
                <p className="text-sm text-gray-600">Subtotal</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-red-600">-{formatCurrency(summary.discountTotal)}</p>
                <p className="text-sm text-gray-600">Discounts</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">{formatCurrency(summary.taxTotal)}</p>
                <p className="text-sm text-gray-600">Tax</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-green-600">{formatCurrency(summary.total)}</p>
                <p className="text-sm text-gray-600">Total</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Breakdowns Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Status Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">By Status</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {statusBreakdown.map(s => (
                <div key={s.status} className="flex justify-between py-1 text-sm">
                  <span className={`px-2 py-0.5 rounded text-xs capitalize ${getStatusColor(s.status)}`}>
                    {s.status}
                  </span>
                  <span>{s.count} orders ({formatCurrency(s.total)})</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Type Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">By Order Type</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {typeBreakdown.map(t => (
                <div key={t.type} className="flex justify-between py-1 text-sm">
                  <span>{getOrderTypeLabel(t.type)}</span>
                  <span>{t.count} ({formatCurrency(t.total)})</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Payment Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">By Payment Method</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {paymentBreakdown.map(p => (
                <div key={p.method} className="flex justify-between py-1 text-sm">
                  <span className="capitalize">{p.method}</span>
                  <span>{formatCurrency(p.amount)} + {formatCurrency(p.tips)} tips</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Orders Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-gray-500">Loading orders...</div>
            ) : orders.length === 0 ? (
              <div className="p-8 text-center text-gray-500">No orders found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Order #</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Type</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Table/Tab</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Server</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Customer</th>
                      <th className="text-right p-3 text-sm font-medium text-gray-600">Items</th>
                      <th className="text-right p-3 text-sm font-medium text-gray-600">Total</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Status</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Date</th>
                      <th className="text-right p-3 text-sm font-medium text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {orders.map(order => (
                      <tr key={order.id} className="hover:bg-gray-50">
                        <td className="p-3 font-mono">#{order.orderNumber}</td>
                        <td className="p-3 text-sm">{getOrderTypeLabel(order.orderType)}</td>
                        <td className="p-3 text-sm">{order.tableName || order.tabName || '-'}</td>
                        <td className="p-3 text-sm">
                          {order.employee ? `${order.employee.firstName} ${order.employee.lastName}` : '-'}
                        </td>
                        <td className="p-3 text-sm">{order.customer ? `${order.customer.firstName} ${order.customer.lastName}` : '-'}</td>
                        <td className="p-3 text-sm text-right">{order.itemCount}</td>
                        <td className="p-3 text-sm text-right font-medium">{formatCurrency(order.total)}</td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded text-xs capitalize ${getStatusColor(order.status)}`}>
                            {order.status}
                          </span>
                        </td>
                        <td className="p-3 text-sm text-gray-500">
                          {formatDateTime(order.createdAt)}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex justify-end gap-2">
                            {/* Quick Receipt Button */}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSelectedOrderId(order.id)
                                setShowReceipt(true)
                              }}
                              title="Reprint Receipt"
                            >
                              🖨️
                            </Button>

                            {/* Actions Dropdown */}
                            <div className="relative group">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="px-2"
                              >
                                ⋮
                              </Button>

                              {/* Dropdown Menu */}
                              <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10 hidden group-hover:block">
                                <div className="py-1">
                                  {/* Adjust Tip - only for paid/closed orders with payments */}
                                  {(order.status === 'paid' || order.status === 'closed') && order.payments.length > 0 && (
                                    <button
                                      onClick={() => {
                                        setSelectedOrder(order)
                                        setSelectedPayment(order.payments[0])
                                        setShowAdjustTip(true)
                                      }}
                                      className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center gap-2"
                                    >
                                      💵 Adjust Tip
                                    </button>
                                  )}

                                  {/* Void Payment - only for paid/closed orders with payments */}
                                  {(order.status === 'paid' || order.status === 'closed') && order.payments.length > 0 && (
                                    <button
                                      onClick={() => {
                                        setSelectedOrder(order)
                                        setSelectedPayment(order.payments[0])
                                        setShowVoidPayment(true)
                                      }}
                                      className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center gap-2 text-red-600"
                                    >
                                      ⛔ Void Payment
                                    </button>
                                  )}

                                  {/* Reopen Order - only for closed/paid orders */}
                                  {(order.status === 'closed' || order.status === 'paid') && (
                                    <button
                                      onClick={() => {
                                        setSelectedOrder(order)
                                        setShowReopenOrder(true)
                                      }}
                                      className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center gap-2"
                                    >
                                      🔓 Reopen Order
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-4">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
            >
              Previous
            </Button>
            <span className="px-4 py-2">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              disabled={page === totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>

      {/* Receipt Modal */}
      <ReceiptModal
        isOpen={showReceipt && !!selectedOrderId}
        orderId={selectedOrderId}
        locationId={employee?.location?.id || ''}
        onClose={() => {
          setShowReceipt(false)
          setSelectedOrderId(null)
        }}
      />

      {/* Adjust Tip Modal */}
      {selectedOrder && selectedPayment && (
        <AdjustTipModal
          isOpen={showAdjustTip}
          onClose={() => {
            setShowAdjustTip(false)
            setSelectedOrder(null)
            setSelectedPayment(null)
          }}
          order={selectedOrder}
          payment={selectedPayment}
          locationId={employee?.location?.id || ''}
          onSuccess={() => {
            loadOrders() // Reload orders after adjustment
          }}
        />
      )}

      {/* Void Payment Modal */}
      {selectedOrder && selectedPayment && (
        <VoidPaymentModal
          isOpen={showVoidPayment}
          onClose={() => {
            setShowVoidPayment(false)
            setSelectedOrder(null)
            setSelectedPayment(null)
          }}
          order={selectedOrder}
          payment={selectedPayment}
          locationId={employee?.location?.id || ''}
          onSuccess={() => {
            loadOrders() // Reload orders after void
          }}
        />
      )}

      {/* Reopen Order Modal */}
      {selectedOrder && (
        <ReopenOrderModal
          isOpen={showReopenOrder}
          onClose={() => {
            setShowReopenOrder(false)
            setSelectedOrder(null)
          }}
          order={selectedOrder}
          locationId={employee?.location?.id || ''}
          onSuccess={() => {
            loadOrders() // Reload orders after reopen
          }}
        />
      )}
    </div>
  )
}
