'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

// ─── Types ───────────────────────────────────────────────────────────────────

interface DayOfWeekPattern {
  day: string
  dayIndex: number
  avgRevenue: number
  avgOrders: number
  sampleWeeks: number
}

interface ForecastRow {
  date: string
  dayOfWeek: string
  projectedRevenue: number
  projectedOrders: number
}

interface ForecastingSummary {
  strongestDay: { day: string; avgRevenue: number }
  weakestDay: { day: string; avgRevenue: number }
  projectedWeekRevenue: number
}

interface ForecastingReport {
  historicalPeriod: {
    startDate: string
    endDate: string
    ordersAnalyzed: number
    lookbackDays: number
  }
  dayOfWeekPatterns: DayOfWeekPattern[]
  forecast: ForecastRow[]
  summary: ForecastingSummary
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(isoDate: string): string {
  // Parse as local date to avoid UTC offset display issues
  const [year, month, day] = isoDate.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getTodayStr(): string {
  return new Date().toISOString().split('T')[0]
}

function getTomorrowStr(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ForecastingPage() {
  const hydrated = useAuthenticationGuard({
    redirectUrl: '/login?redirect=/reports/forecasting',
  })
  const employee = useAuthStore((s) => s.employee)

  const [lookbackDays, setLookbackDays] = useState<number>(84)
  const [forecastDays, setForecastDays] = useState<number>(14)
  const [report, setReport] = useState<ForecastingReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadReport = useCallback(async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        requestingEmployeeId: employee.id,
        lookbackDays: String(lookbackDays),
        forecastDays: String(forecastDays),
      })
      const response = await fetch(`/api/reports/forecasting?${params}`)
      if (response.ok) {
        const json = await response.json()
        setReport(json.data)
      } else {
        const json = await response.json().catch(() => ({}))
        setError((json as { error?: string }).error ?? 'Failed to load report')
      }
    } catch {
      setError('Failed to load forecasting report')
    } finally {
      setIsLoading(false)
    }
  }, [employee?.location?.id, employee?.id, lookbackDays, forecastDays])

  useEffect(() => {
    if (employee?.location?.id) {
      loadReport()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.location?.id])

  if (!hydrated) return null

  const todayStr = getTodayStr()
  const tomorrowStr = getTomorrowStr()

  const patterns = report?.dayOfWeekPatterns ?? []
  const forecast = report?.forecast ?? []
  const summary = report?.summary
  const historical = report?.historicalPeriod

  // Find the highest-revenue day index among patterns for the gold highlight
  const maxAvgRevenue = patterns.length > 0
    ? Math.max(...patterns.map((p) => p.avgRevenue))
    : -1

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Sales Forecasting"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
      />

      <div className="max-w-7xl mx-auto">
        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Lookback Period
                </label>
                <select
                  value={lookbackDays}
                  onChange={(e) => setLookbackDays(Number(e.target.value))}
                  className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={28}>4 weeks (28 days)</option>
                  <option value={56}>8 weeks (56 days)</option>
                  <option value={84}>12 weeks (84 days)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Forecast Horizon
                </label>
                <select
                  value={forecastDays}
                  onChange={(e) => setForecastDays(Number(e.target.value))}
                  className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                </select>
              </div>
              <Button variant="primary" onClick={loadReport} disabled={isLoading}>
                {isLoading ? 'Loading...' : 'Apply Filters'}
              </Button>
            </div>
            {historical && !isLoading && (
              <p className="mt-3 text-xs text-gray-500">
                Based on{' '}
                <span className="font-medium">{historical.ordersAnalyzed.toLocaleString()} orders</span>{' '}
                from {formatDate(historical.startDate)} to {formatDate(historical.endDate)}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Error state */}
        {error && (
          <Card className="mb-6 border-red-200 bg-red-50">
            <CardContent className="p-4 text-red-700 text-sm">{error}</CardContent>
          </Card>
        )}

        {/* Summary Cards */}
        {summary && !isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500 mb-1">Strongest Day</p>
                <p className="text-xl font-bold text-yellow-600">
                  {summary.strongestDay.day}
                </p>
                <p className="text-sm text-gray-600 mt-0.5">
                  Avg {formatCurrency(summary.strongestDay.avgRevenue)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500 mb-1">Weakest Day</p>
                <p className="text-xl font-bold text-blue-600">
                  {summary.weakestDay.day}
                </p>
                <p className="text-sm text-gray-600 mt-0.5">
                  Avg {formatCurrency(summary.weakestDay.avgRevenue)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500 mb-1">Projected 7-Day Revenue</p>
                <p className="text-xl font-bold text-green-600">
                  {formatCurrency(summary.projectedWeekRevenue)}
                </p>
                <p className="text-sm text-gray-500 mt-0.5">Mon — Sun average week</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Section 1 — Day-of-Week Averages */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Day-of-Week Averages</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-gray-500">Loading report...</div>
            ) : patterns.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No orders found in the lookback period.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">
                        Day
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">
                        Avg Revenue
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">
                        Avg Orders
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">
                        Sample
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {patterns.map((pattern) => {
                      const isStrongest = pattern.avgRevenue === maxAvgRevenue && maxAvgRevenue > 0
                      return (
                        <tr
                          key={pattern.dayIndex}
                          className={`border-t hover:bg-gray-50 ${isStrongest ? 'bg-yellow-50' : ''}`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span
                                className={`font-medium ${isStrongest ? 'text-yellow-700' : 'text-gray-900'}`}
                              >
                                {pattern.day}
                              </span>
                              {isStrongest && (
                                <span
                                  className="text-yellow-500 text-base"
                                  title="Strongest revenue day"
                                >
                                  ★
                                </span>
                              )}
                            </div>
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-medium ${
                              isStrongest ? 'text-yellow-700' : 'text-green-600'
                            }`}
                          >
                            {formatCurrency(pattern.avgRevenue)}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-700">
                            {pattern.avgOrders}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-500 text-sm">
                            {pattern.sampleWeeks} {pattern.sampleWeeks === 1 ? 'week' : 'weeks'}
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

        {/* Section 2 — Forecast Table */}
        <Card>
          <CardHeader>
            <CardTitle>
              {forecastDays}-Day Forecast
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-gray-500">Loading report...</div>
            ) : forecast.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No forecast data available.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">
                        Date
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">
                        Day
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">
                        Projected Revenue
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">
                        Projected Orders
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecast.map((row) => {
                      const isToday = row.date === todayStr
                      const isTomorrow = row.date === tomorrowStr
                      const highlight = isToday || isTomorrow

                      return (
                        <tr
                          key={row.date}
                          className={`border-t hover:bg-gray-50 ${highlight ? 'bg-blue-50' : ''}`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm ${highlight ? 'font-semibold text-blue-700' : 'text-gray-700'}`}>
                                {formatDate(row.date)}
                              </span>
                              {isToday && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                                  Today
                                </span>
                              )}
                              {isTomorrow && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                                  Tomorrow
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-600 text-sm">
                            {row.dayOfWeek}
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-green-600">
                            {formatCurrency(row.projectedRevenue)}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-700">
                            {row.projectedOrders}
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
    </div>
  )
}
