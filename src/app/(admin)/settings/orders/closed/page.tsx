'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ReopenOrderModal } from '@/components/orders/ReopenOrderModal'
import { AdjustTipModal } from '@/components/orders/AdjustTipModal'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { toast } from '@/stores/toast-store'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ClosedOrderPayment {
  id: string
  amount: number
  tipAmount: number
  totalAmount: number
  paymentMethod: string
  cardBrand: string | null
  cardLast4: string | null
  status: string
  datacapRecordNo: string | null
}

interface ClosedOrderItem {
  id: string
  name: string
  price: number
  quantity: number
  itemTotal: number
  specialNotes: string | null
  modifiers: {
    id: string
    name: string
    price: number
    preModifier: string | null
  }[]
}

interface ClosedOrder {
  id: string
  orderNumber: number
  orderType: string
  tabName: string | null
  status: string
  employee: { id: string; name: string }
  items: ClosedOrderItem[]
  itemCount: number
  subtotal: number
  taxTotal: number
  tipTotal: number
  total: number
  createdAt: string
  closedAt: string | null
  paidAmount: number
  paymentMethods: string[]
  payments: ClosedOrderPayment[]
  hasCardPayment: boolean
  needsTip: boolean
}

interface Employee {
  id: string
  displayName: string | null
  firstName: string
  lastName: string
  isActive: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: 'Dine In',
  bar_tab: 'Bar Tab',
  takeout: 'Takeout',
  delivery: 'Delivery',
  drive_thru: 'Drive Thru',
}

function formatOrderType(type: string): string {
  return ORDER_TYPE_LABELS[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatPaymentMethods(methods: string[]): string {
  return methods.map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(', ')
}

function todayDateString(): string {
  return new Date().toISOString().split('T')[0]
}

// ─── Page Component ──────────────────────────────────────────────────────────

export default function ClosedOrdersPage() {
  const employee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/settings/orders/closed' })

  const locationId = employee?.location?.id

  // Filter state
  const [dateFrom, setDateFrom] = useState(todayDateString)
  const [dateTo, setDateTo] = useState(todayDateString)
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [orderTypeFilter, setOrderTypeFilter] = useState('')
  const [tipStatusFilter, setTipStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Data state
  const [orders, setOrders] = useState<ClosedOrder[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  // Employee list for filter dropdown
  const [employees, setEmployees] = useState<Employee[]>([])

  // Modal state
  const [detailOrder, setDetailOrder] = useState<ClosedOrder | null>(null)
  const [reopenOrder, setReopenOrder] = useState<ClosedOrder | null>(null)
  const [adjustTipOrder, setAdjustTipOrder] = useState<ClosedOrder | null>(null)
  const [adjustTipPayment, setAdjustTipPayment] = useState<ClosedOrderPayment | null>(null)

  // ─── Fetch employees for filter dropdown ─────────────────────────────────
  useEffect(() => {
    if (!locationId) return
    fetch(`/api/employees?locationId=${locationId}&includeInactive=false`)
      .then(res => res.json())
      .then(data => {
        const list = data.data?.employees || data.employees || []
        setEmployees(list)
      })
      .catch(() => {})
  }, [locationId])

  // ─── Fetch closed orders ─────────────────────────────────────────────────
  const fetchOrders = useCallback(async (append = false) => {
    if (!locationId) return
    if (append) setIsLoadingMore(true)
    else setIsLoading(true)

    try {
      const params = new URLSearchParams({ locationId, dateFrom, dateTo })
      if (employeeFilter) params.set('employeeId', employeeFilter)
      if (orderTypeFilter) params.set('orderType', orderTypeFilter)
      if (tipStatusFilter !== 'all') params.set('tipStatus', tipStatusFilter)
      if (searchQuery.trim()) params.set('search', searchQuery.trim())
      params.set('limit', '50')
      if (append && cursor) params.set('cursor', cursor)

      const res = await fetch(`/api/orders/closed?${params}`)
      if (!res.ok) throw new Error('Failed to fetch orders')
      const json = await res.json()
      const { orders: newOrders, pagination } = json.data

      if (append) {
        setOrders(prev => [...prev, ...newOrders])
      } else {
        setOrders(newOrders)
      }
      setCursor(pagination.nextCursor)
      setHasMore(pagination.hasMore)
    } catch (error) {
      console.error('Failed to fetch closed orders:', error)
      toast.error('Failed to load closed orders')
    } finally {
      setIsLoading(false)
      setIsLoadingMore(false)
    }
  }, [locationId, dateFrom, dateTo, employeeFilter, orderTypeFilter, tipStatusFilter, searchQuery, cursor])

  // Initial load
  useEffect(() => {
    if (locationId) fetchOrders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId])

  const handleSearch = () => {
    setCursor(null)
    fetchOrders()
  }

  const handleLoadMore = () => {
    fetchOrders(true)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  // ─── Actions ─────────────────────────────────────────────────────────────
  const handleReopenSuccess = () => {
    setReopenOrder(null)
    setDetailOrder(null)
    fetchOrders()
  }

  const handleAdjustTipSuccess = () => {
    setAdjustTipOrder(null)
    setAdjustTipPayment(null)
    setDetailOrder(null)
    fetchOrders()
  }

  const handlePrintReceipt = (order: ClosedOrder) => {
    const win = window.open('', '_blank', 'width=400,height=600')
    if (!win) {
      toast.error('Pop-up blocked — please allow pop-ups for receipt printing')
      return
    }

    const itemRows = order.items.map(item => {
      const mods = item.modifiers.length > 0
        ? item.modifiers.map(m => `<div style="padding-left:20px;font-size:12px;color:#666;">${m.preModifier ? m.preModifier + ' ' : ''}${m.name}${m.price > 0 ? ` +${formatCurrency(m.price)}` : ''}</div>`).join('')
        : ''
      return `<div style="display:flex;justify-content:space-between;padding:2px 0;"><span>${item.quantity}x ${item.name}</span><span>${formatCurrency(item.itemTotal)}</span></div>${mods}`
    }).join('')

    const paymentRows = order.payments.map(p => {
      const label = p.cardBrand && p.cardLast4
        ? `${p.cardBrand} ***${p.cardLast4}`
        : p.paymentMethod.charAt(0).toUpperCase() + p.paymentMethod.slice(1)
      return `<div style="display:flex;justify-content:space-between;"><span>${label}</span><span>${formatCurrency(p.totalAmount)}</span></div>`
    }).join('')

    win.document.write(`<!DOCTYPE html><html><head><title>Receipt #${order.orderNumber}</title>
<style>body{font-family:monospace;max-width:300px;margin:0 auto;padding:20px;font-size:14px;}
.divider{border-top:1px dashed #999;margin:8px 0;}
@media print{button{display:none!important;}}</style></head><body>
<div style="text-align:center;font-weight:bold;font-size:16px;margin-bottom:10px;">Order #${order.orderNumber}</div>
<div style="text-align:center;font-size:12px;color:#666;margin-bottom:10px;">${order.closedAt ? formatDateTime(order.closedAt) : ''}</div>
<div style="text-align:center;font-size:12px;margin-bottom:10px;">Server: ${order.employee.name}</div>
<div class="divider"></div>
${itemRows}
<div class="divider"></div>
<div style="display:flex;justify-content:space-between;"><span>Subtotal</span><span>${formatCurrency(order.subtotal)}</span></div>
<div style="display:flex;justify-content:space-between;"><span>Tax</span><span>${formatCurrency(order.taxTotal)}</span></div>
${order.tipTotal > 0 ? `<div style="display:flex;justify-content:space-between;"><span>Tip</span><span>${formatCurrency(order.tipTotal)}</span></div>` : ''}
<div style="display:flex;justify-content:space-between;font-weight:bold;margin-top:4px;"><span>Total</span><span>${formatCurrency(order.paidAmount)}</span></div>
<div class="divider"></div>
${paymentRows}
<div class="divider"></div>
<div style="text-align:center;font-size:12px;color:#666;margin-top:10px;">Thank you!</div>
<button onclick="window.print()" style="display:block;margin:20px auto;padding:8px 24px;cursor:pointer;">Print</button>
</body></html>`)
    win.document.close()
  }

  // ─── Summary stats ───────────────────────────────────────────────────────
  const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0)
  const needsTipCount = orders.filter(o => o.needsTip).length

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Closed Orders"
        subtitle="Search, review, and manage closed orders"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Orders', href: '/settings/orders' },
        ]}
      />

      <div className="max-w-7xl mx-auto">

        {/* ═══ Filter Bar ═══ */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Server</label>
                <select
                  value={employeeFilter}
                  onChange={e => setEmployeeFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Servers</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.displayName || `${emp.firstName} ${emp.lastName}`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                <select
                  value={orderTypeFilter}
                  onChange={e => setOrderTypeFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Types</option>
                  {Object.entries(ORDER_TYPE_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tip Status</label>
                <select
                  value={tipStatusFilter}
                  onChange={e => setTipStatusFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All</option>
                  <option value="needs_tip">Needs Tip</option>
                  <option value="has_tip">Has Tip</option>
                </select>
              </div>
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Order #, tab name, server..."
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <Button variant="primary" onClick={handleSearch} disabled={isLoading}>
                {isLoading ? 'Searching...' : 'Search'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ═══ Summary Stats ═══ */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">Orders Found</p>
              <p className="text-2xl font-bold text-gray-900">{orders.length}{hasMore ? '+' : ''}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">Total Revenue</p>
              <p className="text-2xl font-bold text-blue-600">{formatCurrency(totalRevenue)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">Needs Tip</p>
              <p className={`text-2xl font-bold ${needsTipCount > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                {needsTipCount}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ═══ Orders Table ═══ */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
                <p className="text-gray-500">Loading closed orders...</p>
              </div>
            ) : orders.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No closed orders found for the selected filters
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Order #</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Date/Time</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Server</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Type</th>
                        <th className="text-center px-4 py-3 font-medium text-gray-600 text-sm">Items</th>
                        <th className="text-right px-4 py-3 font-medium text-gray-600 text-sm">Total</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Payment</th>
                        <th className="text-center px-4 py-3 font-medium text-gray-600 text-sm">Tip</th>
                        <th className="text-center px-4 py-3 font-medium text-gray-600 text-sm">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map(order => (
                        <tr key={order.id} className="border-b hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium">
                            <button
                              onClick={() => setDetailOrder(order)}
                              className="text-blue-600 hover:text-blue-800 hover:underline font-semibold"
                            >
                              #{order.orderNumber}
                            </button>
                            {order.tabName && (
                              <span className="block text-xs text-gray-400">{order.tabName}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {order.closedAt ? formatDateTime(order.closedAt) : '-'}
                          </td>
                          <td className="px-4 py-3 text-sm">{order.employee.name}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {formatOrderType(order.orderType)}
                          </td>
                          <td className="px-4 py-3 text-sm text-center text-gray-500">
                            {order.itemCount}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm">
                            {formatCurrency(order.total)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {formatPaymentMethods(order.paymentMethods)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {order.needsTip ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                Needs Tip
                              </span>
                            ) : order.tipTotal > 0 ? (
                              <span className="text-sm font-mono text-green-600">
                                {formatCurrency(order.tipTotal)}
                              </span>
                            ) : (
                              <span className="text-sm text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex gap-1 justify-center">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setDetailOrder(order)}
                              >
                                View
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setReopenOrder(order)}
                              >
                                Reopen
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {hasMore && (
                  <div className="p-4 text-center border-t">
                    <Button
                      variant="outline"
                      onClick={handleLoadMore}
                      disabled={isLoadingMore}
                    >
                      {isLoadingMore ? 'Loading...' : 'Load More'}
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ═══ Order Detail Modal ═══ */}
      <Modal
        isOpen={!!detailOrder}
        onClose={() => setDetailOrder(null)}
        title={detailOrder ? `Order #${detailOrder.orderNumber}` : ''}
        size="lg"
      >
        {detailOrder && (
          <div className="space-y-4">
            {/* Order meta */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Server:</span>{' '}
                <span className="font-medium">{detailOrder.employee.name}</span>
              </div>
              <div>
                <span className="text-gray-500">Type:</span>{' '}
                <span className="font-medium">{formatOrderType(detailOrder.orderType)}</span>
              </div>
              <div>
                <span className="text-gray-500">Closed:</span>{' '}
                <span className="font-medium">{detailOrder.closedAt ? formatDateTime(detailOrder.closedAt) : '-'}</span>
              </div>
              <div>
                <span className="text-gray-500">Status:</span>{' '}
                <span className="font-medium capitalize">{detailOrder.status}</span>
              </div>
              {detailOrder.tabName && (
                <div>
                  <span className="text-gray-500">Tab:</span>{' '}
                  <span className="font-medium">{detailOrder.tabName}</span>
                </div>
              )}
            </div>

            {/* Items */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Items</h3>
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                {detailOrder.items.map(item => (
                  <div key={item.id}>
                    <div className="flex justify-between text-sm">
                      <span>{item.quantity}x {item.name}</span>
                      <span className="font-mono">{formatCurrency(item.itemTotal)}</span>
                    </div>
                    {item.modifiers.map(mod => (
                      <div key={mod.id} className="text-xs text-gray-500 pl-4">
                        {mod.preModifier ? `${mod.preModifier} ` : ''}{mod.name}
                        {mod.price > 0 && ` +${formatCurrency(mod.price)}`}
                      </div>
                    ))}
                    {item.specialNotes && (
                      <div className="text-xs text-amber-600 pl-4">Note: {item.specialNotes}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Totals */}
            <div className="border-t pt-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-mono">{formatCurrency(detailOrder.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Tax</span>
                <span className="font-mono">{formatCurrency(detailOrder.taxTotal)}</span>
              </div>
              {detailOrder.tipTotal > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Tip</span>
                  <span className="font-mono text-green-600">{formatCurrency(detailOrder.tipTotal)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base pt-1 border-t">
                <span>Total</span>
                <span className="font-mono">{formatCurrency(detailOrder.paidAmount)}</span>
              </div>
            </div>

            {/* Payments */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Payments</h3>
              <div className="space-y-2">
                {detailOrder.payments.map(payment => (
                  <div key={payment.id} className="flex items-center justify-between bg-gray-50 rounded-lg p-3 text-sm">
                    <div>
                      <span className="font-medium">
                        {payment.cardBrand && payment.cardLast4
                          ? `${payment.cardBrand} ***${payment.cardLast4}`
                          : payment.paymentMethod.charAt(0).toUpperCase() + payment.paymentMethod.slice(1)
                        }
                      </span>
                      {payment.tipAmount > 0 && (
                        <span className="text-green-600 ml-2 text-xs">
                          (tip: {formatCurrency(payment.tipAmount)})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{formatCurrency(payment.totalAmount)}</span>
                      {payment.datacapRecordNo && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setAdjustTipOrder(detailOrder)
                            setAdjustTipPayment(payment)
                          }}
                        >
                          Adjust Tip
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Needs tip badge */}
            {detailOrder.needsTip && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                This order has a card payment with no tip recorded
              </div>
            )}

            {/* Detail modal actions */}
            <div className="flex gap-2 pt-2 border-t">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => handlePrintReceipt(detailOrder)}
              >
                Reprint Receipt
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setReopenOrder(detailOrder)
                }}
              >
                Reopen Order
              </Button>
              <Button
                variant="outline"
                onClick={() => setDetailOrder(null)}
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ═══ Reopen Order Modal ═══ */}
      {reopenOrder && locationId && (
        <ReopenOrderModal
          isOpen={!!reopenOrder}
          onClose={() => setReopenOrder(null)}
          order={{
            id: reopenOrder.id,
            orderNumber: reopenOrder.orderNumber,
            status: reopenOrder.status,
            total: reopenOrder.total,
            closedAt: reopenOrder.closedAt || undefined,
            tabName: reopenOrder.tabName || undefined,
          }}
          locationId={locationId}
          onSuccess={handleReopenSuccess}
        />
      )}

      {/* ═══ Adjust Tip Modal ═══ */}
      {adjustTipOrder && adjustTipPayment && locationId && (
        <AdjustTipModal
          isOpen={!!adjustTipOrder}
          onClose={() => { setAdjustTipOrder(null); setAdjustTipPayment(null) }}
          order={{
            id: adjustTipOrder.id,
            orderNumber: adjustTipOrder.orderNumber,
            total: adjustTipOrder.total,
            subtotal: adjustTipOrder.subtotal,
            taxTotal: adjustTipOrder.taxTotal,
            tabName: adjustTipOrder.tabName || undefined,
          }}
          payment={adjustTipPayment}
          locationId={locationId}
          onSuccess={handleAdjustTipSuccess}
        />
      )}
    </div>
  )
}
