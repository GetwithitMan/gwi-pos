'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface DayMetrics {
  date: string
  netSales: number
  orderCount: number
  avgCheck: number
  voidPercent: number
  laborPercent: number
  tips: number
  covers: number
}

interface TrendsReport {
  current: DayMetrics[]
  previous: DayMetrics[]
  summary: {
    currentNetSales: number
    previousNetSales: number
    salesDelta: number
    salesDeltaPercent: number
    currentOrders: number
    previousOrders: number
    ordersDelta: number
    currentAvgCheck: number
    previousAvgCheck: number
    avgCheckDelta: number
    currentTips: number
    previousTips: number
    tipsDelta: number
  }
}

function getDatesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const start = new Date(startDate + 'T12:00:00')
  const end = new Date(endDate + 'T12:00:00')
  while (start <= end) {
    dates.push(start.toISOString().split('T')[0])
    start.setDate(start.getDate() + 1)
  }
  return dates
}

function exportTrendsCSV(report: TrendsReport, startDate: string, endDate: string) {
  const rows: string[][] = []
  rows.push(['Date', 'Net Sales', 'Orders', 'Avg Check', 'Tips', 'Covers', 'Compare Date', 'Compare Sales', 'Compare Orders', 'Compare Avg Check'])
  for (let i = 0; i < report.current.length; i++) {
    const c = report.current[i]
    const p = report.previous[i]
    rows.push([
      c.date, c.netSales.toFixed(2), String(c.orderCount), c.avgCheck.toFixed(2),
      c.tips.toFixed(2), String(c.covers),
      p ? p.date : '', p ? p.netSales.toFixed(2) : '', p ? String(p.orderCount) : '',
      p ? p.avgCheck.toFixed(2) : '',
    ])
  }
  rows.push([])
  rows.push(['Summary', 'Current Period', 'Previous Period', 'Delta'])
  rows.push(['Net Sales', report.summary.currentNetSales.toFixed(2), report.summary.previousNetSales.toFixed(2), report.summary.salesDelta.toFixed(2)])
  rows.push(['Orders', String(report.summary.currentOrders), String(report.summary.previousOrders), String(report.summary.ordersDelta)])
  rows.push(['Avg Check', report.summary.currentAvgCheck.toFixed(2), report.summary.previousAvgCheck.toFixed(2), report.summary.avgCheckDelta.toFixed(2)])
  rows.push(['Tips', report.summary.currentTips.toFixed(2), report.summary.previousTips.toFixed(2), report.summary.tipsDelta.toFixed(2)])
  const csv = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `trends-report-${startDate}-to-${endDate}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function TrendsReportPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/trends' })
  const employee = useAuthStore(s => s.employee)
  const [report, setReport] = useState<TrendsReport | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const [periodDays, setPeriodDays] = useState(7)
  const [endDate, setEndDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.toISOString().split('T')[0]
  })

  const startDate = (() => {
    const d = new Date(endDate + 'T12:00:00')
    d.setDate(d.getDate() - periodDays + 1)
    return d.toISOString().split('T')[0]
  })()

  const prevEndDate = (() => {
    const d = new Date(startDate + 'T12:00:00')
    d.setDate(d.getDate() - 1)
    return d.toISOString().split('T')[0]
  })()

  const prevStartDate = (() => {
    const d = new Date(prevEndDate + 'T12:00:00')
    d.setDate(d.getDate() - periodDays + 1)
    return d.toISOString().split('T')[0]
  })()

  useEffect(() => {
    if (employee?.location?.id) {
      loadReport()
    }
  }, [employee?.location?.id])

  const loadReport = async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const currentDates = getDatesInRange(startDate, endDate)
      const previousDates = getDatesInRange(prevStartDate, prevEndDate)

      const fetchDay = async (date: string): Promise<DayMetrics> => {
        try {
          const res = await fetch(
            `/api/reports/daily?locationId=${employee!.location!.id}&date=${date}&employeeId=${employee!.id}`
          )
          if (res.ok) {
            const data = await res.json()
            const r = data.data
            if (r) {
              return {
                date,
                netSales: r.revenue?.netSales || 0,
                orderCount: r.stats?.checks || 0,
                avgCheck: r.stats?.avgCheck || 0,
                voidPercent: r.voids?.percentOfSales || 0,
                laborPercent: r.labor?.total?.percentOfSales || 0,
                tips: r.revenue?.tips || 0,
                covers: r.stats?.covers || 0,
              }
            }
          }
        } catch {}
        return { date, netSales: 0, orderCount: 0, avgCheck: 0, voidPercent: 0, laborPercent: 0, tips: 0, covers: 0 }
      }

      const [currentResults, previousResults] = await Promise.all([
        Promise.all(currentDates.map(fetchDay)),
        Promise.all(previousDates.map(fetchDay)),
      ])

      const sumMetrics = (metrics: DayMetrics[]) => ({
        netSales: metrics.reduce((s, m) => s + m.netSales, 0),
        orders: metrics.reduce((s, m) => s + m.orderCount, 0),
        tips: metrics.reduce((s, m) => s + m.tips, 0),
      })

      const currentSum = sumMetrics(currentResults)
      const previousSum = sumMetrics(previousResults)

      const currentAvgCheck = currentSum.orders > 0 ? currentSum.netSales / currentSum.orders : 0
      const previousAvgCheck = previousSum.orders > 0 ? previousSum.netSales / previousSum.orders : 0

      setReport({
        current: currentResults,
        previous: previousResults,
        summary: {
          currentNetSales: currentSum.netSales,
          previousNetSales: previousSum.netSales,
          salesDelta: currentSum.netSales - previousSum.netSales,
          salesDeltaPercent: previousSum.netSales > 0
            ? Math.round(((currentSum.netSales - previousSum.netSales) / previousSum.netSales) * 1000) / 10
            : 0,
          currentOrders: currentSum.orders,
          previousOrders: previousSum.orders,
          ordersDelta: currentSum.orders - previousSum.orders,
          currentAvgCheck,
          previousAvgCheck,
          avgCheckDelta: currentAvgCheck - previousAvgCheck,
          currentTips: currentSum.tips,
          previousTips: previousSum.tips,
          tipsDelta: currentSum.tips - previousSum.tips,
        },
      })
    } catch (error) {
      console.error('Failed to load trends report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const deltaColor = (delta: number, higherIsBetter: boolean = true) => {
    if (delta === 0) return 'text-gray-600'
    return (delta > 0) === higherIsBetter ? 'text-green-600' : 'text-red-600'
  }

  const formatDelta = (delta: number, isCurrency: boolean = true) => {
    const sign = delta >= 0 ? '+' : ''
    return sign + (isCurrency ? formatCurrency(delta) : delta.toString())
  }

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Trends & Comparison"
        subtitle={employee?.location?.name}
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
        actions={
          <Button
            variant="outline"
            disabled={!report}
            onClick={() => report && exportTrendsCSV(report, startDate, endDate)}
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Period End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Period Length</label>
                <select
                  value={periodDays}
                  onChange={(e) => setPeriodDays(Number(e.target.value))}
                  className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={7}>Last 7 Days</option>
                  <option value={14}>Last 14 Days</option>
                  <option value={30}>Last 30 Days</option>
                </select>
              </div>
              <Button variant="primary" onClick={loadReport} disabled={isLoading}>
                {isLoading ? 'Loading...' : 'Compare'}
              </Button>
              <div className="flex-1" />
              <div className="text-sm text-gray-500">
                <div>Current: {startDate} to {endDate}</div>
                <div>Previous: {prevStartDate} to {prevEndDate}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Loading comparison data...</div>
        ) : !report ? (
          <div className="text-center py-12 text-gray-500">
            Select dates and click Compare to view trends
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary Delta Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Net Sales</p>
                  <p className="text-xl font-bold text-green-600">{formatCurrency(report.summary.currentNetSales)}</p>
                  <p className={`text-sm font-medium ${deltaColor(report.summary.salesDelta)}`}>
                    {formatDelta(report.summary.salesDelta)} ({report.summary.salesDeltaPercent > 0 ? '+' : ''}{report.summary.salesDeltaPercent}%)
                  </p>
                  <p className="text-xs text-gray-400">vs {formatCurrency(report.summary.previousNetSales)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Orders</p>
                  <p className="text-xl font-bold text-blue-600">{report.summary.currentOrders}</p>
                  <p className={`text-sm font-medium ${deltaColor(report.summary.ordersDelta)}`}>
                    {formatDelta(report.summary.ordersDelta, false)}
                  </p>
                  <p className="text-xs text-gray-400">vs {report.summary.previousOrders}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Avg Check</p>
                  <p className="text-xl font-bold text-purple-600">{formatCurrency(report.summary.currentAvgCheck)}</p>
                  <p className={`text-sm font-medium ${deltaColor(report.summary.avgCheckDelta)}`}>
                    {formatDelta(report.summary.avgCheckDelta)}
                  </p>
                  <p className="text-xs text-gray-400">vs {formatCurrency(report.summary.previousAvgCheck)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Tips</p>
                  <p className="text-xl font-bold text-orange-600">{formatCurrency(report.summary.currentTips)}</p>
                  <p className={`text-sm font-medium ${deltaColor(report.summary.tipsDelta)}`}>
                    {formatDelta(report.summary.tipsDelta)}
                  </p>
                  <p className="text-xs text-gray-400">vs {formatCurrency(report.summary.previousTips)}</p>
                </CardContent>
              </Card>
            </div>

            {/* Day-by-Day Comparison Table */}
            <Card>
              <CardHeader>
                <CardTitle>Day-by-Day Comparison</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Current Date</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Net Sales</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Orders</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Avg Check</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-400">vs</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Compare Date</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Net Sales</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Delta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.current.map((day, idx) => {
                        const prevDay = report.previous[idx]
                        const delta = prevDay ? day.netSales - prevDay.netSales : day.netSales
                        return (
                          <tr key={day.date} className="border-t hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium">
                              {new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                            </td>
                            <td className="px-4 py-3 text-right font-medium text-green-600">{formatCurrency(day.netSales)}</td>
                            <td className="px-4 py-3 text-right">{day.orderCount}</td>
                            <td className="px-4 py-3 text-right">{formatCurrency(day.avgCheck)}</td>
                            <td className="px-4 py-3 text-center text-gray-300">|</td>
                            <td className="px-4 py-3 text-gray-500">
                              {prevDay ? new Date(prevDay.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '—'}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-500">
                              {prevDay ? formatCurrency(prevDay.netSales) : '—'}
                            </td>
                            <td className={`px-4 py-3 text-right font-medium ${deltaColor(delta)}`}>
                              {prevDay ? formatDelta(delta) : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot className="bg-gray-100 font-bold">
                      <tr>
                        <td className="px-4 py-3">Totals</td>
                        <td className="px-4 py-3 text-right text-green-600">{formatCurrency(report.summary.currentNetSales)}</td>
                        <td className="px-4 py-3 text-right">{report.summary.currentOrders}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(report.summary.currentAvgCheck)}</td>
                        <td className="px-4 py-3" />
                        <td className="px-4 py-3" />
                        <td className="px-4 py-3 text-right text-gray-500">{formatCurrency(report.summary.previousNetSales)}</td>
                        <td className={`px-4 py-3 text-right ${deltaColor(report.summary.salesDelta)}`}>
                          {formatDelta(report.summary.salesDelta)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Footer */}
            <div className="text-center text-xs text-gray-500 pt-4">
              Generated on {new Date().toLocaleString()}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
