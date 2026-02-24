'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface DaypartData {
  name: string
  startHour: number
  endHour: number
  orderCount: number
  revenue: number
  avgCheck: number
  covers: number
  tipTotal: number
}

interface DaypartReport {
  dayparts: DaypartData[]
  totals: {
    orderCount: number
    revenue: number
    covers: number
    tipTotal: number
    avgCheck: number
  }
  filters: {
    startDate: string
    endDate: string
  }
}

const DAYPART_COLORS = [
  'bg-yellow-400', // Morning
  'bg-orange-500', // Lunch
  'bg-blue-400',   // Afternoon
  'bg-indigo-500', // Dinner
  'bg-purple-600', // Late Night
  'bg-gray-500',   // Overnight
]

function exportDaypartCSV(report: DaypartReport) {
  const rows: string[][] = []
  rows.push(['Daypart', 'Start', 'End', 'Orders', 'Revenue', 'Avg Check', 'Covers', 'Tips'])
  report.dayparts.forEach(dp => {
    rows.push([
      dp.name, `${dp.startHour}:00`, `${dp.endHour}:00`,
      String(dp.orderCount), dp.revenue.toFixed(2), dp.avgCheck.toFixed(2),
      String(dp.covers), dp.tipTotal.toFixed(2),
    ])
  })
  rows.push([])
  rows.push(['Totals', '', '', String(report.totals.orderCount), report.totals.revenue.toFixed(2), report.totals.avgCheck.toFixed(2), String(report.totals.covers), report.totals.tipTotal.toFixed(2)])
  const csv = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `daypart-report-${report.filters.startDate}-to-${report.filters.endDate}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function formatHour(hour: number): string {
  if (hour === 0 || hour === 24) return '12 AM'
  if (hour < 12) return `${hour} AM`
  if (hour === 12) return '12 PM'
  return `${hour - 12} PM`
}

export default function DaypartReportPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/daypart' })
  const employee = useAuthStore(s => s.employee)
  const [report, setReport] = useState<DaypartReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 7)
    return date.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

  useEffect(() => {
    if (employee?.location?.id) {
      loadReport()
    }
  }, [employee?.location?.id])

  const loadReport = async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        startDate,
        endDate,
      })
      const response = await fetch(`/api/reports/daypart?${params}`)
      if (response.ok) {
        const data = await response.json()
        setReport(data.data)
      }
    } catch (error) {
      console.error('Failed to load daypart report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (!hydrated) return null

  const maxRevenue = report ? Math.max(...report.dayparts.map(dp => dp.revenue), 1) : 1

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Daypart Analysis"
        subtitle={employee?.location?.name}
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
        actions={
          <Button
            variant="outline"
            disabled={!report}
            onClick={() => report && exportDaypartCSV(report)}
          >
            Export CSV
          </Button>
        }
      />

      <div className="max-w-6xl mx-auto">
        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <Button variant="primary" onClick={loadReport} disabled={isLoading}>
                {isLoading ? 'Loading...' : 'Apply Filters'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Loading report...</div>
        ) : !report ? (
          <div className="text-center py-12 text-gray-500">No data available</div>
        ) : (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Total Revenue</p>
                  <p className="text-xl font-bold text-green-600">{formatCurrency(report.totals.revenue)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Total Orders</p>
                  <p className="text-xl font-bold text-blue-600">{report.totals.orderCount}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Avg Check</p>
                  <p className="text-xl font-bold text-purple-600">{formatCurrency(report.totals.avgCheck)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Total Covers</p>
                  <p className="text-xl font-bold text-gray-700">{report.totals.covers}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Total Tips</p>
                  <p className="text-xl font-bold text-orange-600">{formatCurrency(report.totals.tipTotal)}</p>
                </CardContent>
              </Card>
            </div>

            {/* Bar Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Revenue by Daypart</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {report.dayparts.map((dp, idx) => {
                    const percentage = maxRevenue > 0 ? (dp.revenue / maxRevenue) * 100 : 0
                    return (
                      <div key={dp.name} className="flex items-center gap-4">
                        <div className="w-24 text-sm font-medium text-gray-700">{dp.name}</div>
                        <div className="text-xs text-gray-400 w-20">
                          {formatHour(dp.startHour)}–{formatHour(dp.endHour)}
                        </div>
                        <div className="flex-1 h-10 bg-gray-100 rounded-lg overflow-hidden relative">
                          <div
                            className={`h-full ${DAYPART_COLORS[idx] || 'bg-blue-500'} transition-all rounded-lg`}
                            style={{ width: `${percentage}%` }}
                          />
                          <div className="absolute inset-0 flex items-center justify-between px-3">
                            <span className="text-xs font-medium text-white drop-shadow">
                              {dp.orderCount > 0 ? `${dp.orderCount} orders` : ''}
                            </span>
                            <span className="text-xs font-bold text-white drop-shadow">
                              {dp.revenue > 0 ? formatCurrency(dp.revenue) : ''}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Detail Table */}
            <Card>
              <CardHeader>
                <CardTitle>Daypart Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Daypart</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Hours</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Orders</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Revenue</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Avg Check</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Covers</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Tips</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">% of Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.dayparts.map((dp, idx) => (
                        <tr key={dp.name} className="border-t hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className={`w-3 h-3 rounded-full ${DAYPART_COLORS[idx] || 'bg-blue-500'}`} />
                              <span className="font-medium">{dp.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-sm">
                            {formatHour(dp.startHour)}–{formatHour(dp.endHour)}
                          </td>
                          <td className="px-4 py-3 text-right">{dp.orderCount}</td>
                          <td className="px-4 py-3 text-right font-medium text-green-600">{formatCurrency(dp.revenue)}</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(dp.avgCheck)}</td>
                          <td className="px-4 py-3 text-right">{dp.covers}</td>
                          <td className="px-4 py-3 text-right text-orange-600">{formatCurrency(dp.tipTotal)}</td>
                          <td className="px-4 py-3 text-right text-gray-500">
                            {report.totals.revenue > 0 ? Math.round((dp.revenue / report.totals.revenue) * 100) : 0}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-100 font-bold">
                      <tr>
                        <td className="px-4 py-3" colSpan={2}>Totals</td>
                        <td className="px-4 py-3 text-right">{report.totals.orderCount}</td>
                        <td className="px-4 py-3 text-right text-green-600">{formatCurrency(report.totals.revenue)}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(report.totals.avgCheck)}</td>
                        <td className="px-4 py-3 text-right">{report.totals.covers}</td>
                        <td className="px-4 py-3 text-right text-orange-600">{formatCurrency(report.totals.tipTotal)}</td>
                        <td className="px-4 py-3 text-right">100%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Footer */}
            <div className="text-center text-xs text-gray-500 pt-4">
              {report.filters.startDate} to {report.filters.endDate} — Generated on {new Date().toLocaleString()}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
