'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'

// ─── Types ───────────────────────────────────────────────────────────────────

interface WasteLogEntry {
  id: string
  itemName: string
  category: string
  quantity: number
  unit: string
  cost: number
  reason: string
  notes: string | null
  employeeName: string
  businessDate: string
  createdAt: string
}

interface WasteSummary {
  totalWasteCost: number
  totalWasteQuantity: number
  totalEntries: number
  topReason: string | null
}

interface ByReasonEntry {
  reason: string
  cost: number
  quantity: number
  count: number
}

interface ByItemEntry {
  itemName: string
  category: string
  cost: number
  quantity: number
  count: number
}

interface ByEmployeeEntry {
  employeeName: string
  cost: number
  quantity: number
  count: number
}

interface ByDayEntry {
  date: string
  cost: number
  quantity: number
  count: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const REASON_LABELS: Record<string, string> = {
  spoilage: 'Spoilage',
  over_pour: 'Over Pour',
  spill: 'Spill',
  breakage: 'Breakage',
  expired: 'Expired',
  void_comped: 'Void / Comped',
  other: 'Other',
}

function formatReason(reason: string): string {
  return REASON_LABELS[reason] || reason.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function exportWasteCSV(
  logs: WasteLogEntry[],
  summary: WasteSummary | null,
  startDate: string,
  endDate: string,
) {
  const rows: string[][] = []
  rows.push(['Date', 'Item', 'Category', 'Quantity', 'Unit', 'Cost', 'Reason', 'Employee', 'Notes'])
  logs.forEach(log => {
    rows.push([
      formatDate(log.businessDate),
      `"${log.itemName}"`,
      `"${log.category}"`,
      String(log.quantity),
      log.unit,
      log.cost.toFixed(2),
      `"${formatReason(log.reason)}"`,
      `"${log.employeeName}"`,
      `"${log.notes || ''}"`,
    ])
  })
  if (summary) {
    rows.push([])
    rows.push(['Summary'])
    rows.push(['Total Waste Cost', summary.totalWasteCost.toFixed(2)])
    rows.push(['Total Items Wasted', String(summary.totalWasteQuantity)])
    rows.push(['Total Entries', String(summary.totalEntries)])
    if (summary.topReason) {
      rows.push(['Top Waste Reason', formatReason(summary.topReason)])
    }
  }
  const csv = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `waste-report-${startDate}-to-${endDate}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Page Component ──────────────────────────────────────────────────────────

export default function WasteReportPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/waste' })
  const employee = useAuthStore(s => s.employee)

  const [logs, setLogs] = useState<WasteLogEntry[]>([])
  const [summary, setSummary] = useState<WasteSummary | null>(null)
  const [byReason, setByReason] = useState<ByReasonEntry[]>([])
  const [byItem, setByItem] = useState<ByItemEntry[]>([])
  const [byEmployee, setByEmployee] = useState<ByEmployeeEntry[]>([])
  const [byDay, setByDay] = useState<ByDayEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Filters
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setDate(1) // first of month
    return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0]
  })

  // View mode
  const [viewMode, setViewMode] = useState<'logs' | 'byReason' | 'byItem' | 'byEmployee' | 'byDay'>('logs')

  // Sort state for logs table
  const [sortField, setSortField] = useState<'cost' | 'quantity' | 'businessDate'>('cost')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    if (employee?.location?.id) {
      loadReport()
    }
  }, [employee?.location?.id, startDate, endDate])

  const loadReport = async () => {
    if (!employee?.location?.id) return

    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        startDate,
        endDate,
        requestingEmployeeId: employee.id,
      })

      const response = await fetch(`/api/reports/waste?${params}`)
      if (response.ok) {
        const json = await response.json()
        const data = json.data
        setLogs(data.logs || [])
        setSummary(data.summary || null)
        setByReason(data.byReason || [])
        setByItem(data.byItem || [])
        setByEmployee(data.byEmployee || [])
        setByDay(data.byDay || [])
      }
    } catch (error) {
      console.error('Failed to load waste report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useReportAutoRefresh({ onRefresh: loadReport })

  // Sorted logs
  const sortedLogs = [...logs].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortField === 'cost') return (a.cost - b.cost) * dir
    if (sortField === 'quantity') return (a.quantity - b.quantity) * dir
    return (new Date(a.businessDate).getTime() - new Date(b.businessDate).getTime()) * dir
  })

  const handleSort = (field: 'cost' | 'quantity' | 'businessDate') => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const sortIndicator = (field: string) => {
    if (sortField !== field) return ''
    return sortDir === 'asc' ? ' \u2191' : ' \u2193'
  }

  // Find max cost day for the bar chart
  const maxDayCost = byDay.reduce((max, d) => Math.max(max, d.cost), 0)

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Waste Analytics"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
        actions={
          <Button
            variant="outline"
            disabled={logs.length === 0}
            onClick={() => exportWasteCSV(logs, summary, startDate, endDate)}
          >
            Export CSV
          </Button>
        }
      />

      {/* Filters */}
      <div className="max-w-7xl mx-auto">
        <Card className="p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-2 border rounded-lg"
              />
            </div>
            <Button variant="outline" onClick={loadReport}>
              Refresh
            </Button>
          </div>
        </Card>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="max-w-7xl mx-auto mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4 bg-red-50">
              <p className="text-sm text-red-600">Total Waste Cost</p>
              <p className="text-2xl font-bold text-red-700">{formatCurrency(summary.totalWasteCost)}</p>
            </Card>
            <Card className="p-4 bg-amber-50">
              <p className="text-sm text-amber-600">Total Items Wasted</p>
              <p className="text-2xl font-bold text-amber-700">{summary.totalWasteQuantity.toFixed(1)}</p>
            </Card>
            <Card className="p-4 bg-blue-50">
              <p className="text-sm text-blue-600">Total Entries</p>
              <p className="text-2xl font-bold text-blue-700">{summary.totalEntries}</p>
            </Card>
            <Card className="p-4 bg-gray-100">
              <p className="text-sm text-gray-600">Top Waste Reason</p>
              <p className="text-2xl font-bold text-gray-800">
                {summary.topReason ? formatReason(summary.topReason) : '-'}
              </p>
            </Card>
          </div>
        </div>
      )}

      {/* View Toggle */}
      <div className="max-w-7xl mx-auto mb-4">
        <div className="flex flex-wrap gap-2">
          {(['logs', 'byReason', 'byItem', 'byEmployee', 'byDay'] as const).map((mode) => (
            <Button
              key={mode}
              variant={viewMode === mode ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setViewMode(mode)}
            >
              {mode === 'logs' ? 'All Entries' :
               mode === 'byReason' ? 'By Reason' :
               mode === 'byItem' ? 'By Item' :
               mode === 'byEmployee' ? 'By Employee' :
               'Daily Trend'}
            </Button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto pb-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
          </div>
        ) : viewMode === 'logs' ? (
          /* ─── All Entries Table ─── */
          sortedLogs.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-gray-900">No waste entries found for this period.</p>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Item</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Category</th>
                      <th
                        className="text-right px-4 py-3 font-medium text-gray-600 text-sm cursor-pointer select-none"
                        onClick={() => handleSort('quantity')}
                      >
                        Qty{sortIndicator('quantity')}
                      </th>
                      <th
                        className="text-right px-4 py-3 font-medium text-gray-600 text-sm cursor-pointer select-none"
                        onClick={() => handleSort('cost')}
                      >
                        Cost{sortIndicator('cost')}
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Reason</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Employee</th>
                      <th
                        className="text-left px-4 py-3 font-medium text-gray-600 text-sm cursor-pointer select-none"
                        onClick={() => handleSort('businessDate')}
                      >
                        Date{sortIndicator('businessDate')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLogs.map((log) => (
                      <tr key={log.id} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium">{log.itemName}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{log.category}</td>
                        <td className="px-4 py-3 text-sm text-right font-mono">
                          {log.quantity} {log.unit}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-mono text-red-600">
                          {formatCurrency(log.cost)}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-900">
                            {formatReason(log.reason)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">{log.employeeName}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{formatDate(log.businessDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )
        ) : viewMode === 'byReason' ? (
          /* ─── By Reason ─── */
          byReason.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-gray-900">No waste data for this period.</p>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Reason</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 text-sm">Entries</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 text-sm">Quantity</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 text-sm">Cost</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm w-1/3">% of Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byReason.map((entry) => {
                      const pct = summary && summary.totalWasteCost > 0
                        ? (entry.cost / summary.totalWasteCost) * 100
                        : 0
                      return (
                        <tr key={entry.reason} className="border-b hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium">{formatReason(entry.reason)}</td>
                          <td className="px-4 py-3 text-sm text-right">{entry.count}</td>
                          <td className="px-4 py-3 text-sm text-right font-mono">{entry.quantity.toFixed(1)}</td>
                          <td className="px-4 py-3 text-sm text-right font-mono text-red-600">{formatCurrency(entry.cost)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-gray-200 rounded-full h-2">
                                <div
                                  className="bg-red-500 h-2 rounded-full"
                                  style={{ width: `${Math.min(pct, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-900 w-12 text-right">{pct.toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )
        ) : viewMode === 'byItem' ? (
          /* ─── By Item ─── */
          byItem.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-gray-900">No waste data for this period.</p>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Item</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Category</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 text-sm">Entries</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 text-sm">Quantity</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 text-sm">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byItem.map((entry, idx) => (
                      <tr key={idx} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium">{entry.itemName}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{entry.category}</td>
                        <td className="px-4 py-3 text-sm text-right">{entry.count}</td>
                        <td className="px-4 py-3 text-sm text-right font-mono">{entry.quantity.toFixed(1)}</td>
                        <td className="px-4 py-3 text-sm text-right font-mono text-red-600">{formatCurrency(entry.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )
        ) : viewMode === 'byEmployee' ? (
          /* ─── By Employee ─── */
          byEmployee.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-gray-900">No waste data for this period.</p>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Employee</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 text-sm">Entries</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 text-sm">Quantity</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 text-sm">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byEmployee.map((entry, idx) => (
                      <tr key={idx} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium">{entry.employeeName}</td>
                        <td className="px-4 py-3 text-sm text-right">{entry.count}</td>
                        <td className="px-4 py-3 text-sm text-right font-mono">{entry.quantity.toFixed(1)}</td>
                        <td className="px-4 py-3 text-sm text-right font-mono text-red-600">{formatCurrency(entry.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )
        ) : (
          /* ─── Daily Trend ─── */
          byDay.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-gray-900">No waste data for this period.</p>
            </Card>
          ) : (
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Daily Waste Cost Trend</h3>
              <div className="space-y-2">
                {byDay.map((day) => {
                  const barWidth = maxDayCost > 0 ? (day.cost / maxDayCost) * 100 : 0
                  return (
                    <div key={day.date} className="flex items-center gap-3">
                      <span className="text-sm text-gray-900 w-24 flex-shrink-0">{formatDate(day.date)}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-6 relative">
                        <div
                          className="bg-red-400 h-6 rounded-full flex items-center"
                          style={{ width: `${Math.max(barWidth, 2)}%` }}
                        >
                          {barWidth > 20 && (
                            <span className="text-xs text-white font-medium pl-2">
                              {formatCurrency(day.cost)}
                            </span>
                          )}
                        </div>
                      </div>
                      {barWidth <= 20 && (
                        <span className="text-xs text-gray-900 w-20 text-right flex-shrink-0">
                          {formatCurrency(day.cost)}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Daily detail table below chart */}
              <div className="mt-6 overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-left px-4 py-2 font-medium text-gray-600 text-sm">Date</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600 text-sm">Entries</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600 text-sm">Quantity</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600 text-sm">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byDay.map((day) => (
                      <tr key={day.date} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm">{formatDate(day.date)}</td>
                        <td className="px-4 py-2 text-sm text-right">{day.count}</td>
                        <td className="px-4 py-2 text-sm text-right font-mono">{day.quantity.toFixed(1)}</td>
                        <td className="px-4 py-2 text-sm text-right font-mono text-red-600">{formatCurrency(day.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )
        )}
      </main>
    </div>
  )
}
