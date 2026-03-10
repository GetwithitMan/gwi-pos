'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'
import { ReportExportBar } from '@/components/reports/ReportExportBar'

interface LaborRow {
  key: string
  label: string
  hours: number
  wages: number
  sales: number
  laborPercent: number | null
}

interface LaborReport {
  rows: LaborRow[]
  summary: {
    totalHours: number
    totalWages: number
    totalSales: number
    laborPercent: number | null
  }
  filters: {
    startDate: string
    endDate: string
    groupBy: string
  }
}

export default function LaborCostReportPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/labor-cost' })
  const employee = useAuthStore(s => s.employee)
  const [report, setReport] = useState<LaborReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [groupBy, setGroupBy] = useState<'date' | 'role' | 'employee'>('date')
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

  useEffect(() => {
    if (employee?.location?.id) loadReport()
  }, [employee?.location?.id, startDate, endDate, groupBy])

  const loadReport = async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        startDate,
        endDate,
        groupBy,
        requestingEmployeeId: employee.id,
      })
      const res = await fetch(`/api/reports/labor-cost?${params}`)
      if (res.ok) {
        const json = await res.json()
        setReport(json.data)
      }
    } catch (err) {
      console.error('Failed to load labor cost report:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useReportAutoRefresh({ onRefresh: loadReport })

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Labor Cost Report"
        subtitle="Hours, wages, and labor % vs sales"
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
              <div>
                <label className="block text-xs text-gray-500 mb-1">Group By</label>
                <select
                  value={groupBy}
                  onChange={e => setGroupBy(e.target.value as 'date' | 'role' | 'employee')}
                  className="px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="date">Date</option>
                  <option value="role">Role</option>
                  <option value="employee">Employee</option>
                </select>
              </div>
              <Button variant="outline" onClick={loadReport} disabled={isLoading}>
                {isLoading ? 'Loading...' : 'Refresh'}
              </Button>
              {report && (
                <ReportExportBar
                  reportType="labor-cost"
                  reportTitle="Labor Cost Report"
                  headers={[
                    groupBy === 'date' ? 'Date' : groupBy === 'role' ? 'Role' : 'Employee',
                    'Hours', 'Wages', 'Sales', 'Labor %',
                  ]}
                  rows={report.rows.map(row => [
                    row.label,
                    row.hours.toFixed(1),
                    formatCurrency(row.wages),
                    formatCurrency(row.sales),
                    row.laborPercent !== null ? `${row.laborPercent}%` : 'N/A',
                  ])}
                  summary={[
                    { label: 'Total Hours', value: report.summary.totalHours.toFixed(1) },
                    { label: 'Total Wages', value: formatCurrency(report.summary.totalWages) },
                    { label: 'Total Sales', value: formatCurrency(report.summary.totalSales) },
                    { label: 'Labor %', value: report.summary.laborPercent !== null ? `${report.summary.laborPercent}%` : 'N/A' },
                  ]}
                  dateRange={{ start: startDate, end: endDate }}
                />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        {report && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-sm text-gray-500">Total Hours</div>
                <div className="text-2xl font-bold">{report.summary.totalHours.toFixed(1)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-sm text-gray-500">Total Wages</div>
                <div className="text-2xl font-bold text-red-600">{formatCurrency(report.summary.totalWages)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-sm text-gray-500">Total Sales</div>
                <div className="text-2xl font-bold text-green-600">{formatCurrency(report.summary.totalSales)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-sm text-gray-500">Labor %</div>
                <div className={`text-2xl font-bold ${
                  (report.summary.laborPercent || 0) > 35 ? 'text-red-600' :
                  (report.summary.laborPercent || 0) > 25 ? 'text-yellow-600' :
                  'text-green-600'
                }`}>
                  {report.summary.laborPercent !== null ? `${report.summary.laborPercent}%` : 'N/A'}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Data Table */}
        {report && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Breakdown by {groupBy === 'date' ? 'Date' : groupBy === 'role' ? 'Role' : 'Employee'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report.rows.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">No labor data for this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-gray-500">
                        <th className="py-2 pr-4">{groupBy === 'date' ? 'Date' : groupBy === 'role' ? 'Role' : 'Employee'}</th>
                        <th className="py-2 pr-4 text-right">Hours</th>
                        <th className="py-2 pr-4 text-right">Wages</th>
                        <th className="py-2 pr-4 text-right">Sales</th>
                        <th className="py-2 text-right">Labor %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map(row => (
                        <tr key={row.key} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-medium">{row.label}</td>
                          <td className="py-2 pr-4 text-right">{row.hours.toFixed(1)}</td>
                          <td className="py-2 pr-4 text-right">{formatCurrency(row.wages)}</td>
                          <td className="py-2 pr-4 text-right">{formatCurrency(row.sales)}</td>
                          <td className={`py-2 text-right font-medium ${
                            (row.laborPercent || 0) > 35 ? 'text-red-600' :
                            (row.laborPercent || 0) > 25 ? 'text-yellow-600' :
                            'text-green-600'
                          }`}>
                            {row.laborPercent !== null ? `${row.laborPercent}%` : '—'}
                          </td>
                        </tr>
                      ))}
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
            Loading labor cost data...
          </div>
        )}
      </div>
    </div>
  )
}
