'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { toast } from '@/stores/toast-store'

// ─── Types ───────────────────────────────────────────────────────────────────

interface TabPayment {
  id: string
  amount: number
  tipAmount: number
  totalAmount: number
  paymentMethod: string
  cardBrand: string | null
  cardLast4: string | null
  status: string
}

interface TabItem {
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

interface WalkoutRetryInfo {
  id: string
  status: string
  retryCount: number
  maxRetries: number
  nextRetryAt: string | null
  lastRetryError: string | null
  collectedAt: string | null
  writtenOffAt: string | null
  cardType: string | null
  cardLast4: string | null
  amount: number
}

interface ClosedTab {
  id: string
  tabName: string | null
  customerName: string | null
  isWalkout?: boolean
  employee: { id: string; name: string }
  openedAt: string
  closedAt: string | null
  subtotal: number
  taxTotal: number
  tipTotal: number
  total: number
  paidTotal: number
  paymentMethods: string[]
  itemCount: number
  items: TabItem[]
  payments: TabPayment[]
}

interface TabSummary {
  totalTabsClosed: number
  totalRevenue: number
  averageTabSize: number
  averageTipPercent: number
}

interface Employee {
  id: string
  displayName: string | null
  firstName: string
  lastName: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayDateString(): string {
  return new Date().toISOString().split('T')[0]
}

function formatPaymentMethod(method: string): string {
  return method.charAt(0).toUpperCase() + method.slice(1)
}

// ─── Page Component ──────────────────────────────────────────────────────────

export default function ClosedTabsPage() {
  const employee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/tabs/closed' })
  const locationId = employee?.location?.id

  // Filter state
  const [dateFrom, setDateFrom] = useState(todayDateString)
  const [dateTo, setDateTo] = useState(todayDateString)
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  // Data state
  const [tabs, setTabs] = useState<ClosedTab[]>([])
  const [summary, setSummary] = useState<TabSummary>({
    totalTabsClosed: 0,
    totalRevenue: 0,
    averageTabSize: 0,
    averageTipPercent: 0,
  })
  const [totalPages, setTotalPages] = useState(1)
  const [isLoading, setIsLoading] = useState(true)

  // Employee list for filter
  const [employees, setEmployees] = useState<Employee[]>([])

  // Detail modal
  const [detailTab, setDetailTab] = useState<ClosedTab | null>(null)

  // ─── Fetch employees ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!locationId) return
    fetch(`/api/employees?locationId=${locationId}&includeInactive=false${employee?.id ? `&requestingEmployeeId=${employee.id}` : ''}`)
      .then(res => res.json())
      .then(data => {
        const list = data.data?.employees || data.employees || []
        setEmployees(list)
      })
      .catch(() => {})
  }, [locationId, employee?.id])

  // ─── Fetch closed tabs ────────────────────────────────────────────────────
  const fetchTabs = useCallback(async () => {
    if (!locationId) return
    setIsLoading(true)

    try {
      const params = new URLSearchParams({ locationId, page: String(currentPage) })
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      if (employeeFilter) params.set('employeeId', employeeFilter)
      if (searchQuery.trim()) params.set('search', searchQuery.trim())

      const res = await fetch(`/api/tabs/closed?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const json = await res.json()
      const { tabs: newTabs, summary: newSummary, pagination } = json.data

      setTabs(newTabs)
      setSummary(newSummary)
      setTotalPages(pagination.totalPages)
    } catch (error) {
      console.error('Failed to fetch closed tabs:', error)
      toast.error('Failed to load closed tabs')
    } finally {
      setIsLoading(false)
    }
  }, [locationId, dateFrom, dateTo, employeeFilter, searchQuery, currentPage])

  // Initial load + filter changes
  useEffect(() => {
    if (locationId) fetchTabs()
  }, [locationId, fetchTabs])

  // Live updates
  useReportAutoRefresh({
    onRefresh: fetchTabs,
    events: ['orders:list-changed', 'payment:processed'],
  })

  const handleSearch = () => {
    setCurrentPage(1)
    fetchTabs()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Closed Tabs"
        subtitle="Review and manage closed bar tabs"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
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
                  onChange={e => { setDateFrom(e.target.value); setCurrentPage(1) }}
                  className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => { setDateTo(e.target.value); setCurrentPage(1) }}
                  className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Employee</label>
                <select
                  value={employeeFilter}
                  onChange={e => { setEmployeeFilter(e.target.value); setCurrentPage(1) }}
                  className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Employees</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.displayName || `${emp.firstName} ${emp.lastName}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Tab name, customer..."
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <Button variant="primary" onClick={handleSearch} disabled={isLoading}>
                {isLoading ? 'Searching...' : 'Search'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ═══ Summary Cards ═══ */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">Total Tabs Closed</p>
              <p className="text-2xl font-bold text-gray-900">{summary.totalTabsClosed}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">Total Revenue</p>
              <p className="text-2xl font-bold text-blue-600">{formatCurrency(summary.totalRevenue)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">Average Tab Size</p>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(summary.averageTabSize)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">Average Tip %</p>
              <p className="text-2xl font-bold text-green-600">{summary.averageTipPercent.toFixed(1)}%</p>
            </CardContent>
          </Card>
        </div>

        {/* ═══ Tabs Table ═══ */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
                <p className="text-gray-500">Loading closed tabs...</p>
              </div>
            ) : tabs.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No closed tabs found for the selected filters
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Tab Name</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Customer</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Employee</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Open Time</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Close Time</th>
                        <th className="text-right px-4 py-3 font-medium text-gray-600 text-sm">Subtotal</th>
                        <th className="text-right px-4 py-3 font-medium text-gray-600 text-sm">Tip</th>
                        <th className="text-right px-4 py-3 font-medium text-gray-600 text-sm">Total</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Payment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tabs.map(tab => (
                        <tr
                          key={tab.id}
                          className="border-b hover:bg-gray-50 cursor-pointer"
                          onClick={() => setDetailTab(tab)}
                        >
                          <td className="px-4 py-3 font-medium text-blue-600 hover:text-blue-800">
                            {tab.tabName || '(unnamed)'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {tab.customerName || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm">{tab.employee.name}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {formatDateTime(tab.openedAt)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {tab.closedAt ? formatDateTime(tab.closedAt) : '-'}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm">
                            {formatCurrency(tab.subtotal)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm">
                            {tab.tipTotal > 0 ? (
                              <span className="text-green-600">{formatCurrency(tab.tipTotal)}</span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm font-bold">
                            {formatCurrency(tab.paidTotal)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {tab.paymentMethods.map(formatPaymentMethod).join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="p-4 flex items-center justify-between border-t">
                    <span className="text-sm text-gray-500">
                      Page {currentPage} of {totalPages} ({summary.totalTabsClosed} tabs)
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage <= 1}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage >= totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ═══ Tab Detail Modal ═══ */}
      <Modal
        isOpen={!!detailTab}
        onClose={() => setDetailTab(null)}
        title={detailTab ? `Tab: ${detailTab.tabName || '(unnamed)'}` : ''}
        size="lg"
      >
        {detailTab && (
          <div className="space-y-4">
            {/* Tab meta */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Employee:</span>{' '}
                <span className="font-medium">{detailTab.employee.name}</span>
              </div>
              <div>
                <span className="text-gray-500">Customer:</span>{' '}
                <span className="font-medium">{detailTab.customerName || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500">Opened:</span>{' '}
                <span className="font-medium">{formatDateTime(detailTab.openedAt)}</span>
              </div>
              <div>
                <span className="text-gray-500">Closed:</span>{' '}
                <span className="font-medium">{detailTab.closedAt ? formatDateTime(detailTab.closedAt) : '-'}</span>
              </div>
            </div>

            {/* Items */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Items ({detailTab.itemCount})</h3>
              <div className="bg-gray-50 rounded-lg p-3 space-y-2 max-h-60 overflow-y-auto">
                {detailTab.items.map(item => (
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
                <span className="font-mono">{formatCurrency(detailTab.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Tax</span>
                <span className="font-mono">{formatCurrency(detailTab.taxTotal)}</span>
              </div>
              {detailTab.tipTotal > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Tip</span>
                  <span className="font-mono text-green-600">{formatCurrency(detailTab.tipTotal)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base pt-1 border-t">
                <span>Total Paid</span>
                <span className="font-mono">{formatCurrency(detailTab.paidTotal)}</span>
              </div>
            </div>

            {/* Payments */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Payments</h3>
              <div className="space-y-2">
                {detailTab.payments.map(payment => (
                  <div key={payment.id} className="flex items-center justify-between bg-gray-50 rounded-lg p-3 text-sm">
                    <div>
                      <span className="font-medium">
                        {payment.cardBrand && payment.cardLast4
                          ? `${payment.cardBrand} ***${payment.cardLast4}`
                          : formatPaymentMethod(payment.paymentMethod)}
                      </span>
                      {payment.tipAmount > 0 && (
                        <span className="text-green-600 ml-2 text-xs">
                          (tip: {formatCurrency(payment.tipAmount)})
                        </span>
                      )}
                    </div>
                    <span className="font-mono">{formatCurrency(payment.totalAmount)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t">
              <Button variant="outline" onClick={() => setDetailTab(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
