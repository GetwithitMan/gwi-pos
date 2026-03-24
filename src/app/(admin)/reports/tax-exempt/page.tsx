'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { WebReportBanner } from '@/components/admin/WebReportBanner'
import { useDataRetention } from '@/hooks/useDataRetention'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'

interface ExemptOrder {
  id: string
  orderNumber: number
  displayNumber: string | null
  date: string
  paidAt: string | null
  status: string
  subtotal: number
  total: number
  taxExemptReason: string
  taxExemptId: string | null
  taxSaved: number
  approvedBy: string
  approvedByEmployeeId: string | null
  serverName: string
  customerName: string | null
}

interface Summary {
  totalExemptOrders: number
  totalTaxSaved: number
  totalOrderAmount: number
  dateRange: { start: string; end: string }
}

function exportTaxExemptCSV(orders: ExemptOrder[], summary: Summary | null) {
  const rows: string[][] = []
  rows.push(['Date', 'Order #', 'Status', 'Reason', 'Tax ID', 'Subtotal', 'Total', 'Tax Saved', 'Approved By', 'Server', 'Customer'])
  orders.forEach(order => {
    rows.push([
      new Date(order.date).toLocaleString(),
      order.displayNumber || String(order.orderNumber),
      order.status,
      `"${order.taxExemptReason}"`,
      `"${order.taxExemptId || ''}"`,
      order.subtotal.toFixed(2),
      order.total.toFixed(2),
      order.taxSaved.toFixed(2),
      `"${order.approvedBy}"`,
      `"${order.serverName}"`,
      `"${order.customerName || ''}"`,
    ])
  })
  if (summary) {
    rows.push([])
    rows.push(['Summary'])
    rows.push(['Total Exempt Orders', String(summary.totalExemptOrders)])
    rows.push(['Total Tax Saved', summary.totalTaxSaved.toFixed(2)])
    rows.push(['Total Order Amount', summary.totalOrderAmount.toFixed(2)])
  }
  const csv = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `tax-exempt-report-${summary?.dateRange.start || 'all'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function TaxExemptReportPage() {
  const auth = useAuthenticationGuard()
  const locationId = useAuthStore(s => s.locationId)
  const employeeId = useAuthStore(s => s.employee?.id)
  const { retentionDays } = useDataRetention()

  const [orders, setOrders] = useState<ExemptOrder[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Date range state — default to current month
  const now = new Date()
  const [startDate, setStartDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0])
  const [endDate, setEndDate] = useState(now.toISOString().split('T')[0])

  const fetchReport = () => {
    if (!locationId || !employeeId) return
    setLoading(true)
    setError(null)

    fetch(`/api/reports/tax-exempt?locationId=${locationId}&startDate=${startDate}&endDate=${endDate}&requestingEmployeeId=${employeeId}`)
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch report')
        return r.json()
      })
      .then(raw => {
        const data = raw.data ?? raw
        setOrders(data.orders || [])
        setSummary(data.summary || null)
      })
      .catch(err => {
        setError(err.message || 'Failed to load report')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchReport()
  }, [locationId, employeeId, startDate, endDate])

  // Auto-refresh on socket events
  useReportAutoRefresh({ onRefresh: fetchReport })

  if (!auth) return null

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      <AdminPageHeader title="Tax Exempt Report" />
      <WebReportBanner startDate={startDate} endDate={endDate} reportType="tax-exempt" retentionDays={retentionDays} />

      {/* Date Range Controls */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            />
          </div>
          <Button onClick={fetchReport} variant="outline" size="sm">
            Refresh
          </Button>
          {orders.length > 0 && (
            <Button onClick={() => exportTaxExemptCSV(orders, summary)} variant="outline" size="sm">
              Export CSV
            </Button>
          )}
        </div>
        {retentionDays > 0 && (
          <p className="text-xs text-gray-400 mt-2">
            Data retained for {retentionDays} days
          </p>
        )}
      </Card>

      {/* Summary Cards */}
      {summary && !loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-4 text-center">
            <div className="text-2xl font-bold text-yellow-600">{summary.totalExemptOrders}</div>
            <div className="text-sm text-gray-500">Exempt Orders</div>
          </Card>
          <Card className="p-4 text-center">
            <div className="text-2xl font-bold text-red-600">{formatCurrency(summary.totalTaxSaved)}</div>
            <div className="text-sm text-gray-500">Total Tax Waived</div>
          </Card>
          <Card className="p-4 text-center">
            <div className="text-2xl font-bold text-gray-700">{formatCurrency(summary.totalOrderAmount)}</div>
            <div className="text-sm text-gray-500">Total Order Value</div>
          </Card>
        </div>
      )}

      {/* Error */}
      {error && (
        <Card className="p-4 border-red-200 bg-red-50">
          <p className="text-red-600 text-sm">{error}</p>
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <Card className="p-8 text-center">
          <p className="text-gray-500">Loading tax exempt report...</p>
        </Card>
      )}

      {/* Orders Table */}
      {!loading && orders.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-3 font-medium text-gray-600">Date</th>
                  <th className="text-left p-3 font-medium text-gray-600">Order #</th>
                  <th className="text-left p-3 font-medium text-gray-600">Reason</th>
                  <th className="text-left p-3 font-medium text-gray-600">Tax ID</th>
                  <th className="text-right p-3 font-medium text-gray-600">Order Total</th>
                  <th className="text-right p-3 font-medium text-gray-600">Tax Saved</th>
                  <th className="text-left p-3 font-medium text-gray-600">Approved By</th>
                  <th className="text-left p-3 font-medium text-gray-600">Server</th>
                  <th className="text-left p-3 font-medium text-gray-600">Customer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map(order => (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="p-3 text-gray-600 whitespace-nowrap">
                      {new Date(order.date).toLocaleDateString()}
                    </td>
                    <td className="p-3 font-medium">
                      {order.displayNumber || `#${order.orderNumber}`}
                    </td>
                    <td className="p-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                        {order.taxExemptReason}
                      </span>
                    </td>
                    <td className="p-3 text-gray-600 font-mono text-xs">
                      {order.taxExemptId || '-'}
                    </td>
                    <td className="p-3 text-right font-medium">
                      {formatCurrency(order.total)}
                    </td>
                    <td className="p-3 text-right font-medium text-red-600">
                      {formatCurrency(order.taxSaved)}
                    </td>
                    <td className="p-3 text-gray-600">{order.approvedBy}</td>
                    <td className="p-3 text-gray-600">{order.serverName}</td>
                    <td className="p-3 text-gray-600">{order.customerName || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Empty State */}
      {!loading && orders.length === 0 && !error && (
        <Card className="p-8 text-center">
          <p className="text-gray-500">No tax-exempt orders found for this date range.</p>
        </Card>
      )}
    </div>
  )
}
