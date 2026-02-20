'use client'

import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { toast } from '@/stores/toast-store'

interface HourData {
  hour: number
  label: string
  orderCount: number
  revenue: number
  avgOrderValue: number
  tipTotal: number
}

interface HourlySummary {
  peakHour: number
  peakHourLabel: string
  peakRevenue: number
  totalRevenue: number
  totalOrders: number
  avgOrderValue: number
}

interface HourlyReport {
  date: string
  hours: HourData[]
  compareDate?: string
  compareHours?: HourData[]
  summary: HourlySummary
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value)
}

export default function HourlySalesPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/hourly' })
  const employee = useAuthStore(s => s.employee)

  const [report, setReport] = useState<HourlyReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [compareDate, setCompareDate] = useState('')
  const [activeView, setActiveView] = useState<'chart' | 'table'>('chart')

  const loadReport = useCallback(async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        requestingEmployeeId: employee.id,
        date,
      })
      if (compareDate) {
        params.set('compareDate', compareDate)
      }
      const response = await fetch(`/api/reports/hourly?${params}`)
      if (response.ok) {
        const data = await response.json()
        setReport(data.data)
      } else {
        toast.error('Failed to load hourly report')
      }
    } catch {
      toast.error('Failed to load hourly report')
    } finally {
      setIsLoading(false)
    }
  }, [employee?.location?.id, employee?.id, date, compareDate])

  useEffect(() => {
    if (employee?.location?.id) {
      loadReport()
    }
  }, [employee?.location?.id, loadReport])

  if (!hydrated) return null

  const summary = report?.summary
  const hours = report?.hours ?? []
  const compareHours = report?.compareHours
  const peakRevenue = summary?.peakRevenue ?? 0

  // Only show hours with activity, or all 24 if none have activity
  const hasActivity = hours.some(h => h.orderCount > 0)

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Hourly Sales"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
      />

      <div className="max-w-7xl mx-auto">
        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Compare Date <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="date"
                  value={compareDate}
                  onChange={(e) => setCompareDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={loadReport}
                disabled={isLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {isLoading ? 'Loading...' : 'Apply'}
              </button>
              {compareDate && (
                <button
                  onClick={() => setCompareDate('')}
                  className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 font-medium"
                >
                  Clear Compare
                </button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total Revenue</p>
                <p className="text-xl font-bold text-green-600">
                  {formatCurrency(summary.totalRevenue)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total Orders</p>
                <p className="text-xl font-bold text-blue-600">
                  {summary.totalOrders}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Peak Hour</p>
                <p className="text-xl font-bold text-purple-600">
                  {summary.peakHourLabel}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatCurrency(summary.peakRevenue)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Avg Order Value</p>
                <p className="text-xl font-bold text-gray-700">
                  {formatCurrency(summary.avgOrderValue)}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* View Toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setActiveView('chart')}
            className={`px-4 py-2 rounded-lg font-medium text-sm ${
              activeView === 'chart'
                ? 'bg-blue-600 text-white'
                : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            Bar Chart
          </button>
          <button
            onClick={() => setActiveView('table')}
            className={`px-4 py-2 rounded-lg font-medium text-sm ${
              activeView === 'table'
                ? 'bg-blue-600 text-white'
                : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            Data Table
          </button>
        </div>

        {/* Chart View */}
        {activeView === 'chart' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Revenue by Hour</span>
                {report?.date && (
                  <span className="text-sm font-normal text-gray-500">
                    {new Date(report.date + 'T12:00:00').toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-12 text-gray-500">Loading report...</div>
              ) : !hasActivity ? (
                <div className="text-center py-12 text-gray-500">
                  No orders found for this date.
                </div>
              ) : (
                <div className="space-y-0.5">
                  {/* Column header */}
                  <div className="flex items-center gap-3 pb-2 border-b mb-2">
                    <span className="w-12 text-xs text-right text-gray-400">Hour</span>
                    <div className="flex-1 text-xs text-gray-400 pl-1">Revenue</div>
                    <span className="w-20 text-right text-xs text-gray-400">Amount</span>
                    <span className="w-16 text-right text-xs text-gray-400">Orders</span>
                  </div>
                  {hours.map((h) => {
                    const compareH = compareHours?.find(c => c.hour === h.hour)
                    const comparePct = peakRevenue > 0 ? (compareH?.revenue ?? 0) / peakRevenue * 100 : 0
                    const primaryPct = peakRevenue > 0 ? (h.revenue / peakRevenue * 100) : 0
                    const isPeak = h.hour === summary?.peakHour

                    return (
                      <div key={h.hour} className="flex items-center gap-3 py-0.5">
                        <span className={`w-12 text-xs text-right ${isPeak ? 'text-purple-600 font-semibold' : 'text-gray-500'}`}>
                          {h.label}
                        </span>
                        <div className="flex-1 bg-gray-100 rounded h-6 overflow-hidden relative">
                          {/* Compare bar (behind, orange) */}
                          {compareHours && (
                            <div
                              className="absolute inset-y-0 left-0 bg-orange-200 rounded transition-all"
                              style={{ width: `${comparePct}%` }}
                            />
                          )}
                          {/* Primary bar (blue) */}
                          <div
                            className={`absolute inset-y-0 left-0 rounded transition-all ${isPeak ? 'bg-purple-500' : 'bg-blue-500'}`}
                            style={{ width: `${primaryPct}%` }}
                          />
                        </div>
                        <span className="w-20 text-right text-sm font-medium">
                          {h.revenue > 0 ? formatCurrency(h.revenue) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </span>
                        <span className="w-16 text-right text-xs text-gray-500">
                          {h.orderCount > 0 ? `${h.orderCount} orders` : ''}
                        </span>
                      </div>
                    )
                  })}
                  {/* Legend */}
                  {compareHours && (
                    <div className="flex items-center gap-6 pt-3 mt-2 border-t text-xs text-gray-500">
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded bg-blue-500" />
                        {report?.date}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded bg-orange-300" />
                        {report?.compareDate}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Table View */}
        {activeView === 'table' && (
          <Card>
            <CardHeader>
              <CardTitle>Hourly Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-12 text-gray-500">Loading report...</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Hour</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Orders</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Revenue</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Avg Order</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Tips</th>
                        {compareHours && (
                          <>
                            <th className="px-4 py-3 text-right text-sm font-medium text-orange-500">
                              Compare Orders
                            </th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-orange-500">
                              Compare Revenue
                            </th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {hours.map((h) => {
                        const compareH = compareHours?.find(c => c.hour === h.hour)
                        const isPeak = h.hour === summary?.peakHour
                        return (
                          <tr
                            key={h.hour}
                            className={`border-t ${isPeak ? 'bg-purple-50' : 'hover:bg-gray-50'} ${h.orderCount === 0 ? 'opacity-40' : ''}`}
                          >
                            <td className="px-4 py-2.5">
                              <span className={`font-medium ${isPeak ? 'text-purple-700' : 'text-gray-700'}`}>
                                {h.label}
                              </span>
                              {isPeak && (
                                <span className="ml-2 text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full">
                                  Peak
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right">{h.orderCount}</td>
                            <td className="px-4 py-2.5 text-right font-medium">
                              {h.revenue > 0 ? formatCurrency(h.revenue) : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right text-gray-500">
                              {h.avgOrderValue > 0 ? formatCurrency(h.avgOrderValue) : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right text-gray-500">
                              {h.tipTotal > 0 ? formatCurrency(h.tipTotal) : '—'}
                            </td>
                            {compareHours && (
                              <>
                                <td className="px-4 py-2.5 text-right text-orange-600">
                                  {compareH && compareH.orderCount > 0 ? compareH.orderCount : '—'}
                                </td>
                                <td className="px-4 py-2.5 text-right text-orange-600">
                                  {compareH && compareH.revenue > 0 ? formatCurrency(compareH.revenue) : '—'}
                                </td>
                              </>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                    {summary && (
                      <tfoot className="bg-gray-100">
                        <tr>
                          <td className="px-4 py-3 font-bold">TOTALS</td>
                          <td className="px-4 py-3 text-right font-bold text-blue-600">
                            {summary.totalOrders}
                          </td>
                          <td className="px-4 py-3 text-right font-bold">
                            {formatCurrency(summary.totalRevenue)}
                          </td>
                          <td className="px-4 py-3 text-right font-bold">
                            {formatCurrency(summary.avgOrderValue)}
                          </td>
                          <td className="px-4 py-3 text-right font-bold">
                            {formatCurrency(hours.reduce((s, h) => s + h.tipTotal, 0))}
                          </td>
                          {compareHours && (
                            <>
                              <td className="px-4 py-3 text-right font-bold text-orange-600">
                                {compareHours.reduce((s, h) => s + h.orderCount, 0)}
                              </td>
                              <td className="px-4 py-3 text-right font-bold text-orange-600">
                                {formatCurrency(compareHours.reduce((s, h) => s + h.revenue, 0))}
                              </td>
                            </>
                          )}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
