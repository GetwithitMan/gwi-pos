'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import { hasPermission, PERMISSIONS } from '@/lib/auth-utils'

// ─── Types ───────────────────────────────────────────────────────────────────

interface OrderItem {
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

interface OpenOrder {
  id: string
  orderNumber: number
  displayNumber: string
  status: string
  orderType: string
  tabName: string | null
  tableName: string | null
  tableId: string | null
  ageMinutes: number
  isRolledOver: boolean
  rolledOverAt: string | null
  rolledOverFrom: string | null
  isCaptureDeclined: boolean
  captureRetryCount: number
  employee: { id: string; name: string }
  itemCount: number
  subtotal: number
  taxTotal: number
  tipTotal: number
  total: number
  items: OrderItem[]
  createdAt: string
  openedAt: string
  hasPreAuth: boolean
  preAuth: {
    cardBrand: string | null
    last4: string | null
    amount: number | null
  } | null
}

interface TableOption {
  id: string
  name: string
  status: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft:       'bg-gray-100 text-gray-600',
  open:        'bg-green-100 text-green-700',
  sent:        'bg-blue-100 text-blue-700',
  in_progress: 'bg-indigo-100 text-indigo-700',
  split:       'bg-purple-100 text-purple-700',
}

const STATUS_LABELS: Record<string, string> = {
  draft:       'Draft',
  open:        'Open',
  sent:        'Sent',
  in_progress: 'In Progress',
  split:       'Split',
}

const ALL_STATUSES = ['draft', 'open', 'sent', 'in_progress', 'split'] as const
type OrderStatus = typeof ALL_STATUSES[number]

function formatAge(ageMinutes: number): string {
  if (ageMinutes < 1) return '< 1m'
  if (ageMinutes < 60) return `${ageMinutes}m`
  const hours = Math.floor(ageMinutes / 60)
  const mins = ageMinutes % 60
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`
}

// ─── Skeleton Row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b animate-pulse">
      {Array.from({ length: 9 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-200 rounded w-full" />
        </td>
      ))}
    </tr>
  )
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function OpenOrdersManagerPage() {
  const employee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/orders/manager' })

  const locationId = employee?.location?.id
  const employeeId = employee?.id
  const permissions = employee?.permissions ?? []
  const canBulkOp = hasPermission(permissions, PERMISSIONS.MGR_BULK_OPERATIONS)

  // ─── Filter state ──────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<OrderStatus[]>([...ALL_STATUSES])
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'zero' | 'nonzero'>('all')
  const [showRolledOverOnly, setShowRolledOverOnly] = useState(false)
  const [searchText, setSearchText] = useState('')

  // ─── Data state ────────────────────────────────────────────────────────────
  const [orders, setOrders] = useState<OpenOrder[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // ─── Modal state ───────────────────────────────────────────────────────────
  const [detailOrder, setDetailOrder] = useState<OpenOrder | null>(null)
  const [reassignTableId, setReassignTableId] = useState('')
  const [tables, setTables] = useState<TableOption[]>([])
  const [isActioning, setIsActioning] = useState(false)

  // ─── Fetch open orders from /api/orders/open ───────────────────────────────
  const fetchOrders = useCallback(async () => {
    if (!locationId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId,
        summary: 'false',
        // No date bounds — get ALL open orders regardless of day
        ...(showRolledOverOnly ? { rolledOver: 'true' } : {}),
      })
      const res = await fetch(`/api/orders/open?${params}`)
      if (!res.ok) throw new Error('Failed to fetch open orders')
      const json = await res.json()
      setOrders(json.data?.orders ?? [])
    } catch (err) {
      console.error('Failed to fetch open orders:', err)
      toast.error('Failed to load open orders')
    } finally {
      setIsLoading(false)
    }
  }, [locationId, showRolledOverOnly])

  // Initial load
  useEffect(() => {
    if (locationId) fetchOrders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, showRolledOverOnly])

  // ─── Fetch available tables for reassign ──────────────────────────────────
  useEffect(() => {
    if (!locationId) return
    fetch(`/api/tables?locationId=${locationId}`)
      .then(r => r.json())
      .then(data => {
        const list: TableOption[] = (data.data?.tables || data.tables || []).map((t: { id: string; name: string; status: string }) => ({
          id: t.id,
          name: t.name,
          status: t.status,
        }))
        setTables(list)
      })
      .catch(() => {})
  }, [locationId])

  // ─── Socket listener ───────────────────────────────────────────────────────
  const fetchRef = useRef(fetchOrders)
  fetchRef.current = fetchOrders

  useEffect(() => {
    const socket = getSharedSocket()
    let debounceTimer: ReturnType<typeof setTimeout>

    const handleChange = () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => fetchRef.current(), 300)
    }

    socket.on('orders:list-changed', handleChange)
    return () => {
      clearTimeout(debounceTimer)
      socket.off('orders:list-changed', handleChange)
      releaseSharedSocket()
    }
  }, [])

  // ─── Client-side filtering ─────────────────────────────────────────────────
  const filteredOrders = orders.filter(order => {
    if (!statusFilter.includes(order.status as OrderStatus)) return false
    if (balanceFilter === 'zero' && order.total > 0) return false
    if (balanceFilter === 'nonzero' && order.total <= 0) return false
    if (showRolledOverOnly && !order.isRolledOver) return false
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase()
      const matchNum = String(order.orderNumber).includes(q)
      const matchTab = (order.tabName || '').toLowerCase().includes(q)
      const matchTable = (order.tableName || '').toLowerCase().includes(q)
      if (!matchNum && !matchTab && !matchTable) return false
    }
    return true
  })

  // ─── Selection helpers ────────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredOrders.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredOrders.map(o => o.id)))
    }
  }

  const selectedOrders = filteredOrders.filter(o => selectedIds.has(o.id))
  const allSelectedZeroBalance = selectedOrders.every(o => o.total <= 0 || o.status === 'draft')
  const allSelectedNonZero = selectedOrders.every(o => o.total > 0)

  // ─── Actions ──────────────────────────────────────────────────────────────

  const callBulkAction = async (action: 'cancel' | 'void', ids: string[]) => {
    if (!employeeId || !ids.length) return
    setIsActioning(true)
    try {
      const res = await fetch('/api/orders/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: ids, action, employeeId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Action failed')
      toast.success(`${action === 'cancel' ? 'Cancelled' : 'Voided'} ${json.data?.processedCount ?? ids.length} order(s)`)
      setSelectedIds(new Set())
      setDetailOrder(null)
      fetchOrders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setIsActioning(false)
    }
  }

  const handleCancel = (ids: string[]) => callBulkAction('cancel', ids)
  const handleVoid = (ids: string[]) => callBulkAction('void', ids)

  const handleReassignTable = async (orderId: string, tableId: string) => {
    if (!tableId) return
    setIsActioning(true)
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Reassign failed')
      toast.success('Table reassigned')
      setDetailOrder(null)
      fetchOrders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reassign failed')
    } finally {
      setIsActioning(false)
    }
  }

  // ─── Summary stats ────────────────────────────────────────────────────────
  const rolledOverCount = filteredOrders.filter(o => o.isRolledOver).length
  const zeroBalanceCount = filteredOrders.filter(o => o.total <= 0).length
  const captureDeclinedCount = filteredOrders.filter(o => o.isCaptureDeclined).length

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Open Orders Manager"
        subtitle="View, manage, and act on all open orders across days"
        breadcrumbs={[]}
      />

      <div className="max-w-7xl mx-auto">

        {/* ═══ Filter Bar ═══ */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-end">

              {/* Status multi-select */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                <div className="flex gap-1 flex-wrap">
                  {ALL_STATUSES.map(s => (
                    <button
                      key={s}
                      onClick={() =>
                        setStatusFilter(prev =>
                          prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
                        )
                      }
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        statusFilter.includes(s)
                          ? STATUS_COLORS[s] + ' border-transparent'
                          : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400'
                      }`}
                    >
                      {STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Balance filter */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Balance</label>
                <select
                  value={balanceFilter}
                  onChange={e => setBalanceFilter(e.target.value as 'all' | 'zero' | 'nonzero')}
                  className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All</option>
                  <option value="zero">$0 / Draft</option>
                  <option value="nonzero">Has Balance</option>
                </select>
              </div>

              {/* Rolled-over toggle */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Rolled Over</label>
                <button
                  onClick={() => setShowRolledOverOnly(v => !v)}
                  className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                    showRolledOverOnly
                      ? 'bg-orange-100 text-orange-700 border-orange-200'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {showRolledOverOnly ? 'Rolled Over Only' : 'Show All'}
                </button>
              </div>

              {/* Search */}
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
                <input
                  type="text"
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  placeholder="Order #, tab name, table..."
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <Button variant="outline" onClick={fetchOrders} disabled={isLoading}>
                {isLoading ? 'Refreshing...' : 'Refresh'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ═══ Summary Stats ═══ */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">Open Orders</p>
              <p className="text-2xl font-bold text-gray-900">{filteredOrders.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">Rolled Over</p>
              <p className={`text-2xl font-bold ${rolledOverCount > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                {rolledOverCount}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">Zero Balance</p>
              <p className={`text-2xl font-bold ${zeroBalanceCount > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                {zeroBalanceCount}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">Capture Declined</p>
              <p className={`text-2xl font-bold ${captureDeclinedCount > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                {captureDeclinedCount}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ═══ Bulk Actions Bar ═══ */}
        {selectedIds.size > 0 && canBulkOp && (
          <div className="mb-4 flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
            <span className="text-sm font-medium text-blue-800">
              {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''} selected
            </span>
            <div className="flex gap-2 ml-auto">
              {allSelectedZeroBalance && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isActioning}
                  onClick={() => handleCancel(Array.from(selectedIds))}
                >
                  Cancel Selected
                </Button>
              )}
              {allSelectedNonZero && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isActioning}
                  onClick={() => handleVoid(Array.from(selectedIds))}
                >
                  Void Selected
                </Button>
              )}
              {!allSelectedZeroBalance && !allSelectedNonZero && (
                <span className="text-xs text-gray-500 self-center">
                  Mixed selection — select all $0 or all with balance for bulk action
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </Button>
            </div>
          </div>
        )}

        {/* ═══ Orders Table ═══ */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="w-10 px-4 py-3" />
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Order #</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Age</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Table / Tab</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 text-sm">Total</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600 text-sm">Items</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Server</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Flags</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600 text-sm">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
                  </tbody>
                </table>
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No open orders match the selected filters
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.size === filteredOrders.length && filteredOrders.length > 0}
                          onChange={toggleSelectAll}
                          className="rounded"
                        />
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Order #</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Age</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Table / Tab</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 text-sm">Total</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600 text-sm">Items</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Server</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Flags</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600 text-sm">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map(order => {
                      const isDraft = order.status === 'draft'
                      const isZero = order.total <= 0
                      return (
                        <tr
                          key={order.id}
                          className={`border-b hover:bg-gray-50 ${isDraft ? 'bg-gray-50/50' : ''}`}
                        >
                          {/* Checkbox */}
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(order.id)}
                              onChange={() => toggleSelect(order.id)}
                              className="rounded"
                            />
                          </td>

                          {/* Order # */}
                          <td className="px-4 py-3 font-medium">
                            <button
                              onClick={() => { setDetailOrder(order); setReassignTableId('') }}
                              className="text-blue-600 hover:text-blue-800 hover:underline font-semibold"
                            >
                              #{order.orderNumber}
                            </button>
                          </td>

                          {/* Status badge */}
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[order.status] ?? 'bg-gray-100 text-gray-600'}`}>
                              {STATUS_LABELS[order.status] ?? order.status}
                            </span>
                          </td>

                          {/* Age */}
                          <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                            {formatAge(order.ageMinutes)}
                          </td>

                          {/* Table / Tab */}
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {order.tableName || order.tabName || (
                              <span className="text-gray-400 italic">—</span>
                            )}
                          </td>

                          {/* Total */}
                          <td className="px-4 py-3 text-right font-mono text-sm">
                            <span className={isZero ? 'text-red-500' : ''}>
                              {formatCurrency(order.total)}
                            </span>
                          </td>

                          {/* Items */}
                          <td className="px-4 py-3 text-center text-sm text-gray-500">
                            {order.itemCount}
                          </td>

                          {/* Server */}
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {order.employee.name}
                          </td>

                          {/* Flags */}
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {order.isRolledOver && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">
                                  Rolled Over
                                </span>
                              )}
                              {order.isCaptureDeclined && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                                  Capture Declined
                                </span>
                              )}
                              {isDraft && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
                                  Draft
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3">
                            <div className="flex gap-1 justify-center">
                              {canBulkOp && (isDraft || isZero) && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={isActioning}
                                  onClick={() => handleCancel([order.id])}
                                >
                                  Cancel
                                </Button>
                              )}
                              {canBulkOp && !isZero && !isDraft && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={isActioning}
                                  onClick={() => handleVoid([order.id])}
                                >
                                  Void
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => { setDetailOrder(order); setReassignTableId('') }}
                              >
                                View
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
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
        {detailOrder && (() => {
          const isDraft = detailOrder.status === 'draft'
          const isZero = detailOrder.total <= 0
          return (
            <div className="space-y-4">

              {/* Order meta */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Status:</span>{' '}
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ml-1 ${STATUS_COLORS[detailOrder.status] ?? ''}`}>
                    {STATUS_LABELS[detailOrder.status] ?? detailOrder.status}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Age:</span>{' '}
                  <span className="font-medium">{formatAge(detailOrder.ageMinutes)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Server:</span>{' '}
                  <span className="font-medium">{detailOrder.employee.name}</span>
                </div>
                <div>
                  <span className="text-gray-500">Created:</span>{' '}
                  <span className="font-medium">{formatDateTime(detailOrder.createdAt)}</span>
                </div>
                {(detailOrder.tableName || detailOrder.tabName) && (
                  <div>
                    <span className="text-gray-500">{detailOrder.tableName ? 'Table' : 'Tab'}:</span>{' '}
                    <span className="font-medium">{detailOrder.tableName || detailOrder.tabName}</span>
                  </div>
                )}
              </div>

              {/* Rolled-over banner */}
              {detailOrder.isRolledOver && (
                <div className="flex items-center gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-800">
                  <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                  </svg>
                  Rolled over from {detailOrder.rolledOverFrom
                    ? new Date(detailOrder.rolledOverFrom).toLocaleDateString()
                    : 'previous day'}
                  {detailOrder.rolledOverAt && ` on ${formatDateTime(detailOrder.rolledOverAt)}`}
                </div>
              )}

              {/* Capture declined banner */}
              {detailOrder.isCaptureDeclined && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                  <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  Capture declined {detailOrder.captureRetryCount} time{detailOrder.captureRetryCount !== 1 ? 's' : ''}
                </div>
              )}

              {/* Items */}
              {detailOrder.items.length > 0 ? (
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
              ) : (
                <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-400 italic text-center">
                  No items — draft order
                </div>
              )}

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
                <div className={`flex justify-between font-bold text-base pt-1 border-t ${isZero ? 'text-red-600' : ''}`}>
                  <span>Total</span>
                  <span className="font-mono">{formatCurrency(detailOrder.total)}</span>
                </div>
              </div>

              {/* Reassign table */}
              {canBulkOp && tables.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Reassign Table</h3>
                  <div className="flex gap-2">
                    <select
                      value={reassignTableId}
                      onChange={e => setReassignTableId(e.target.value)}
                      className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select a table...</option>
                      {tables
                        .filter(t => t.id !== detailOrder.tableId)
                        .map(t => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.status})
                          </option>
                        ))}
                    </select>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!reassignTableId || isActioning}
                      onClick={() => handleReassignTable(detailOrder.id, reassignTableId)}
                    >
                      Reassign
                    </Button>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 pt-2 border-t flex-wrap">
                {canBulkOp && (isDraft || isZero) && (
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={isActioning}
                    onClick={() => handleCancel([detailOrder.id])}
                  >
                    Cancel Order
                  </Button>
                )}
                {canBulkOp && !isDraft && detailOrder.total > 0 && (
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={isActioning}
                    onClick={() => handleVoid([detailOrder.id])}
                  >
                    Void Order
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => setDetailOrder(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}
