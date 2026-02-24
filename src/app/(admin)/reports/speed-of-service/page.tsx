'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface TimingMetrics {
  avgOrderToSend: number | null
  avgSendToComplete: number | null
  avgSeatToPay: number | null
  orderCount: number
}

interface ByDay {
  date: string
  avgOrderToSend: number | null
  avgSendToComplete: number | null
  avgSeatToPay: number | null
  count: number
}

interface ByEmployee {
  employeeId: string
  name: string
  avgOrderToSend: number | null
  avgSendToComplete: number | null
  avgSeatToPay: number | null
  count: number
}

interface ByOrderType {
  type: string
  avgOrderToSend: number | null
  avgSendToComplete: number | null
  avgSeatToPay: number | null
  count: number
}

interface SpeedReport {
  overall: TimingMetrics
  byDay: ByDay[]
  byEmployee: ByEmployee[]
  byOrderType: ByOrderType[]
}

function fmtMin(val: number | null): string {
  if (val === null) return '—'
  return `${val.toFixed(1)} min`
}

function exportSpeedCSV(report: SpeedReport, startDate: string, endDate: string) {
  const rows: string[][] = []
  rows.push(['Section', 'Name', 'Orders', 'Avg Order→Send (min)', 'Avg Send→Complete (min)', 'Avg Seat→Pay (min)'])

  rows.push(['Overall', 'All', String(report.overall.orderCount), String(report.overall.avgOrderToSend ?? ''), String(report.overall.avgSendToComplete ?? ''), String(report.overall.avgSeatToPay ?? '')])

  report.byEmployee.forEach(e => {
    rows.push(['By Employee', `"${e.name}"`, String(e.count), String(e.avgOrderToSend ?? ''), String(e.avgSendToComplete ?? ''), String(e.avgSeatToPay ?? '')])
  })

  report.byDay.forEach(d => {
    rows.push(['By Day', d.date, String(d.count), String(d.avgOrderToSend ?? ''), String(d.avgSendToComplete ?? ''), String(d.avgSeatToPay ?? '')])
  })

  report.byOrderType.forEach(t => {
    rows.push(['By Order Type', t.type, String(t.count), String(t.avgOrderToSend ?? ''), String(t.avgSendToComplete ?? ''), String(t.avgSeatToPay ?? '')])
  })

  const csv = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `speed-of-service-${startDate}-to-${endDate}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function SpeedOfServicePage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/speed-of-service' })
  const employee = useAuthStore(s => s.employee)

  const todayStr = new Date().toISOString().split('T')[0]
  const [startDate, setStartDate] = useState(todayStr)
  const [endDate, setEndDate] = useState(todayStr)
  const [report, setReport] = useState<SpeedReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [view, setView] = useState<'employee' | 'day' | 'orderType'>('employee')

  const loadReport = useCallback(async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        requestingEmployeeId: employee.id,
        startDate,
        endDate,
      })
      const response = await fetch(`/api/reports/speed-of-service?${params}`)
      if (response.ok) {
        const json = await response.json()
        setReport(json.data)
      }
    } catch (error) {
      console.error('Failed to load speed of service report:', error)
    } finally {
      setIsLoading(false)
    }
  }, [employee?.location?.id, employee?.id, startDate, endDate])

  useEffect(() => {
    if (employee?.location?.id) {
      loadReport()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.location?.id])

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Speed of Service"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
      />

      <div className="max-w-7xl mx-auto">
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
              {report && report.overall.orderCount > 0 && (
                <Button variant="outline" onClick={() => exportSpeedCSV(report, startDate, endDate)}>
                  Export CSV
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        {report && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Orders Analyzed</p>
                <p className="text-2xl font-bold text-blue-600">{report.overall.orderCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Avg Order → Send</p>
                <p className="text-2xl font-bold text-purple-600">{fmtMin(report.overall.avgOrderToSend)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Avg Send → Complete</p>
                <p className="text-2xl font-bold text-orange-600">{fmtMin(report.overall.avgSendToComplete)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Avg Seat → Pay</p>
                <p className="text-2xl font-bold text-green-600">{fmtMin(report.overall.avgSeatToPay)}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* View Tabs */}
        <div className="flex gap-2 mb-4">
          <Button variant={view === 'employee' ? 'primary' : 'outline'} onClick={() => setView('employee')}>
            By Employee
          </Button>
          <Button variant={view === 'day' ? 'primary' : 'outline'} onClick={() => setView('day')}>
            By Day
          </Button>
          <Button variant={view === 'orderType' ? 'primary' : 'outline'} onClick={() => setView('orderType')}>
            By Order Type
          </Button>
        </div>

        {/* Tables */}
        <Card>
          <CardHeader>
            <CardTitle>
              {view === 'employee' && 'Speed by Employee'}
              {view === 'day' && 'Speed by Day'}
              {view === 'orderType' && 'Speed by Order Type'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-gray-500">Loading report...</div>
            ) : !report || report.overall.orderCount === 0 ? (
              <div className="text-center py-8 text-gray-500">No timing data found for the selected period.</div>
            ) : view === 'employee' ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Employee</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Orders</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Order → Send</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Send → Complete</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Seat → Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byEmployee.map((emp) => (
                      <tr key={emp.employeeId} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{emp.name}</td>
                        <td className="px-4 py-3 text-right">{emp.count}</td>
                        <td className="px-4 py-3 text-right text-purple-600">{fmtMin(emp.avgOrderToSend)}</td>
                        <td className="px-4 py-3 text-right text-orange-600">{fmtMin(emp.avgSendToComplete)}</td>
                        <td className="px-4 py-3 text-right text-green-600">{fmtMin(emp.avgSeatToPay)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : view === 'day' ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Date</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Orders</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Order → Send</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Send → Complete</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Seat → Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byDay.map((day) => (
                      <tr key={day.date} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">
                          {new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', {
                            weekday: 'short', month: 'short', day: 'numeric',
                          })}
                        </td>
                        <td className="px-4 py-3 text-right">{day.count}</td>
                        <td className="px-4 py-3 text-right text-purple-600">{fmtMin(day.avgOrderToSend)}</td>
                        <td className="px-4 py-3 text-right text-orange-600">{fmtMin(day.avgSendToComplete)}</td>
                        <td className="px-4 py-3 text-right text-green-600">{fmtMin(day.avgSeatToPay)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Order Type</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Orders</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Order → Send</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Send → Complete</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Seat → Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byOrderType.map((t) => (
                      <tr key={t.type} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium capitalize">{t.type.replace(/_/g, ' ')}</td>
                        <td className="px-4 py-3 text-right">{t.count}</td>
                        <td className="px-4 py-3 text-right text-purple-600">{fmtMin(t.avgOrderToSend)}</td>
                        <td className="px-4 py-3 text-right text-orange-600">{fmtMin(t.avgSendToComplete)}</td>
                        <td className="px-4 py-3 text-right text-green-600">{fmtMin(t.avgSeatToPay)}</td>
                      </tr>
                    ))}
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
