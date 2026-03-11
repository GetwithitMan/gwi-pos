'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'

interface EmployeeRow {
  employeeId: string | null
  employeeName: string
  totalPours: number
  ackCount: number
  nakCount: number
  unmatchedCount: number
  unmatchedExposure: number
  nakRate: number
  totalOz: number
  totalCost: number
}

interface BergEmployeeReport {
  period: { startDate: string; endDate: string }
  generatedAt: string
  employees: EmployeeRow[]
  summary: { totalPours: number; totalUnmatched: number; totalExposure: number }
}

function fmtMoney(n: number) {
  return '$' + n.toFixed(2)
}

function today() {
  return new Date().toISOString().split('T')[0]
}

function weekAgo() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().split('T')[0]
}

export default function BergEmployeeReportPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id

  const [startDate, setStartDate] = useState(weekAgo)
  const [endDate, setEndDate] = useState(today)
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<BergEmployeeReport | null>(null)

  useReportAutoRefresh({ onRefresh: runReport })

  async function runReport() {
    if (!locationId || !employee?.id) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        locationId,
        startDate,
        endDate,
        employeeId: employee.id,
      })
      const res = await fetch(`/api/reports/berg-employee?${params}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setReport(data)
    } catch {
      toast.error('Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  function exportCSV() {
    if (!locationId || !employee?.id) return
    const params = new URLSearchParams({
      locationId,
      startDate,
      endDate,
      employeeId: employee.id,
      format: 'csv',
    })
    window.open(`/api/reports/berg-employee?${params}`)
  }

  const dateClass = 'border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900'

  return (
    <div className="p-6 max-w-7xl mx-auto pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">Employee Accountability</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={dateClass} />
          <span className="text-gray-900">to</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={dateClass} />
          <Button onClick={runReport} disabled={loading}>
            {loading ? 'Running...' : 'Run Report'}
          </Button>
          {report && (
            <Button variant="outline" onClick={exportCSV}>Export CSV</Button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {!report && !loading && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-8 text-center text-sm text-gray-900">
          Select a date range and run the report to see per-employee Berg accountability data.
        </div>
      )}

      {report && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="pt-4 text-center">
                <div className="text-xs text-gray-900 uppercase">Total Pours</div>
                <div className="text-3xl font-bold">{report.summary.totalPours}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <div className="text-xs text-gray-900 uppercase">Total Unmatched</div>
                <div className={`text-3xl font-bold ${report.summary.totalUnmatched > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                  {report.summary.totalUnmatched}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <div className="text-xs text-gray-900 uppercase">Total $ Exposure</div>
                <div className={`text-3xl font-bold ${report.summary.totalExposure > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {fmtMoney(report.summary.totalExposure)}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left text-gray-900">
                      <th className="py-2 px-3 font-medium">Employee</th>
                      <th className="py-2 px-3 font-medium text-right">Pours</th>
                      <th className="py-2 px-3 font-medium text-right">Volume (oz)</th>
                      <th className="py-2 px-3 font-medium text-right">$ Cost</th>
                      <th className="py-2 px-3 font-medium text-right">Unmatched</th>
                      <th className="py-2 px-3 font-medium text-right">$ Exposure</th>
                      <th className="py-2 px-3 font-medium text-right">NAK Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {report.employees.map((row) => {
                      const highNak = row.nakRate > 5
                      const hasUnmatched = row.unmatchedCount > 0
                      const rowClass = highNak ? 'bg-red-50' : hasUnmatched ? 'bg-amber-50' : ''
                      return (
                        <tr key={row.employeeId || '__none__'} className={rowClass}>
                          <td className="py-2 px-3 font-medium">
                            {row.employeeName}
                            {!row.employeeId && (
                              <span className="ml-2 text-xs text-gray-900">(unassigned)</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right">{row.totalPours}</td>
                          <td className="py-2 px-3 text-right">{row.totalOz.toFixed(1)}</td>
                          <td className="py-2 px-3 text-right">{fmtMoney(row.totalCost)}</td>
                          <td className="py-2 px-3 text-right">
                            {hasUnmatched ? (
                              <span className="font-semibold text-amber-700">{row.unmatchedCount}</span>
                            ) : (
                              <span className="text-gray-900">0</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {row.unmatchedExposure > 0 ? (
                              <span className="font-semibold text-red-600">{fmtMoney(row.unmatchedExposure)}</span>
                            ) : (
                              <span className="text-gray-900">$0.00</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <span className={highNak ? 'font-semibold text-red-600' : ''}>
                              {row.nakRate.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                    {report.employees.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-gray-900">
                          No dispense events found for this period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
