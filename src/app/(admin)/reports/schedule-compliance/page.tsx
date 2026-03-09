'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'

interface ComplianceRow {
  employeeId: string
  employeeName: string
  date: string
  scheduledStart: string | null
  scheduledEnd: string | null
  scheduledHours: number
  actualStart: string | null
  actualEnd: string | null
  actualHours: number
  variance: number
  status: 'on_time' | 'late' | 'early' | 'no_show' | 'unscheduled'
}

interface ComplianceReport {
  rows: ComplianceRow[]
  summary: {
    totalScheduledHours: number
    totalActualHours: number
    variance: number
    noShows: number
    lateCount: number
    complianceRate: number
  }
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  on_time: { label: 'On Time', className: 'bg-green-100 text-green-700' },
  early: { label: 'Early', className: 'bg-blue-100 text-blue-700' },
  late: { label: 'Late', className: 'bg-yellow-100 text-yellow-700' },
  no_show: { label: 'No Show', className: 'bg-red-100 text-red-700' },
  unscheduled: { label: 'Unscheduled', className: 'bg-gray-100 text-gray-700' },
}

export default function ScheduleCompliancePage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/schedule-compliance' })
  const employee = useAuthStore(s => s.employee)
  const [report, setReport] = useState<ComplianceReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

  useEffect(() => {
    if (employee?.location?.id) loadReport()
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
      const res = await fetch(`/api/reports/schedule-compliance?${params}`)
      if (res.ok) {
        const json = await res.json()
        setReport(json.data)
      }
    } catch (err) {
      console.error('Failed to load schedule compliance report:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useReportAutoRefresh({ onRefresh: loadReport })

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Schedule Compliance"
        subtitle="Scheduled vs actual hours"
        backHref="/reports"
      />

      <div className="max-w-6xl mx-auto space-y-6">
        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <Button variant="outline" onClick={loadReport} disabled={isLoading}>
                {isLoading ? 'Loading...' : 'Refresh'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary */}
        {report && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-sm text-gray-500">Compliance Rate</div>
                <div className={`text-2xl font-bold ${
                  report.summary.complianceRate >= 90 ? 'text-green-600' :
                  report.summary.complianceRate >= 75 ? 'text-yellow-600' :
                  'text-red-600'
                }`}>
                  {report.summary.complianceRate}%
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-sm text-gray-500">Scheduled / Actual</div>
                <div className="text-lg font-bold">
                  {report.summary.totalScheduledHours.toFixed(1)}h / {report.summary.totalActualHours.toFixed(1)}h
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-sm text-gray-500">No Shows</div>
                <div className={`text-2xl font-bold ${report.summary.noShows > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {report.summary.noShows}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-sm text-gray-500">Late Arrivals</div>
                <div className={`text-2xl font-bold ${report.summary.lateCount > 0 ? 'text-yellow-600' : 'text-green-600'}`}>
                  {report.summary.lateCount}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Table */}
        {report && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Shift Compliance Details</CardTitle>
            </CardHeader>
            <CardContent>
              {report.rows.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">No schedule data for this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-gray-500">
                        <th className="py-2 pr-4">Date</th>
                        <th className="py-2 pr-4">Employee</th>
                        <th className="py-2 pr-4">Scheduled</th>
                        <th className="py-2 pr-4">Actual</th>
                        <th className="py-2 pr-4 text-right">Sched. Hrs</th>
                        <th className="py-2 pr-4 text-right">Actual Hrs</th>
                        <th className="py-2 pr-4 text-right">Variance</th>
                        <th className="py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((row, i) => {
                        const style = STATUS_STYLES[row.status]
                        return (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-2 pr-4">{row.date}</td>
                            <td className="py-2 pr-4 font-medium">{row.employeeName}</td>
                            <td className="py-2 pr-4 text-gray-600">
                              {row.scheduledStart && row.scheduledEnd ? `${row.scheduledStart} - ${row.scheduledEnd}` : '—'}
                            </td>
                            <td className="py-2 pr-4 text-gray-600">
                              {row.actualStart && row.actualEnd
                                ? `${formatTime(row.actualStart)} - ${formatTime(row.actualEnd)}`
                                : '—'}
                            </td>
                            <td className="py-2 pr-4 text-right">{row.scheduledHours.toFixed(1)}</td>
                            <td className="py-2 pr-4 text-right">{row.actualHours.toFixed(1)}</td>
                            <td className={`py-2 pr-4 text-right font-medium ${
                              row.variance > 0 ? 'text-yellow-600' : row.variance < 0 ? 'text-red-600' : ''
                            }`}>
                              {row.variance > 0 ? '+' : ''}{row.variance.toFixed(1)}
                            </td>
                            <td className="py-2">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${style.className}`}>
                                {style.label}
                              </span>
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
        )}

        {isLoading && (
          <div className="text-center py-8 text-gray-500">
            <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
            Loading schedule compliance data...
          </div>
        )}
      </div>
    </div>
  )
}
