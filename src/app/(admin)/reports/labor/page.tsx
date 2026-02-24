'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface EmployeeLaborData {
  id: string
  name: string
  role: string
  hourlyRate: number
  shifts: number
  regularHours: number
  overtimeHours: number
  totalHours: number
  breakMinutes: number
  laborCost: number
  avgHoursPerShift: number
}

interface DailyLaborData {
  date: string
  shifts: number
  regularHours: number
  overtimeHours: number
  totalHours: number
  breakMinutes: number
  laborCost: number
  employeeCount: number
}

interface RoleLaborData {
  role: string
  employees: number
  shifts: number
  totalHours: number
  laborCost: number
  avgHoursPerShift: number
}

interface LaborReport {
  summary: {
    totalShifts: number
    totalRegularHours: number
    totalOvertimeHours: number
    totalHours: number
    totalBreakMinutes: number
    totalBreakHours: number
    totalLaborCost: number
    laborCostPercent: number | null
    avgHoursPerShift: number
    avgCostPerHour: number
  }
  byEmployee: EmployeeLaborData[]
  byDay: DailyLaborData[]
  byRole: RoleLaborData[]
}

function exportLaborCSV(report: LaborReport, startDate: string, endDate: string) {
  const header = [
    'Employee', 'Role', 'Shifts', 'Regular Hours', 'Overtime Hours',
    'Total Hours', 'Break Minutes', 'Hourly Rate', 'Labor Cost',
  ].join(',')

  const rows = report.byEmployee.map((emp) =>
    [
      `"${emp.name}"`,
      `"${emp.role}"`,
      emp.shifts,
      emp.regularHours.toFixed(1),
      emp.overtimeHours.toFixed(1),
      emp.totalHours.toFixed(1),
      emp.breakMinutes,
      emp.hourlyRate.toFixed(2),
      emp.laborCost.toFixed(2),
    ].join(',')
  )

  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `labor-report-${startDate}-to-${endDate}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function laborPercentColor(percent: number | null): string {
  if (percent === null) return 'text-gray-400'
  if (percent < 30) return 'text-green-600'
  if (percent <= 35) return 'text-amber-600'
  return 'text-red-600'
}

function laborPercentBadge(percent: number | null): { label: string; className: string } | null {
  if (percent === null) return null
  if (percent < 30) return { label: 'On Target', className: 'bg-green-100 text-green-700' }
  if (percent <= 35) return { label: 'Watch', className: 'bg-amber-100 text-amber-700' }
  return { label: 'Over Target', className: 'bg-red-100 text-red-700' }
}

export default function LaborReportPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/labor' })
  const employee = useAuthStore(s => s.employee)
  const [report, setReport] = useState<LaborReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0])
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const [selectedView, setSelectedView] = useState<'employee' | 'daily' | 'role'>('employee')

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
        requestingEmployeeId: employee.id,
        startDate,
        endDate,
      })
      const response = await fetch(`/api/reports/labor?${params}`)
      if (response.ok) {
        const data = await response.json()
        setReport(data.data)
      }
    } catch (error) {
      console.error('Failed to load labor report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (!hydrated) return null

  const badge = report ? laborPercentBadge(report.summary.laborCostPercent) : null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Labor Cost Report"
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
              {report && report.byEmployee.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => exportLaborCSV(report, startDate, endDate)}
                >
                  Export CSV
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        {report && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total Labor Cost</p>
                <p className="text-xl font-bold text-gray-900">
                  {formatCurrency(report.summary.totalLaborCost)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500 flex items-center gap-1.5">
                  Labor %
                  {badge && (
                    <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                  )}
                </p>
                <p className={`text-xl font-bold ${laborPercentColor(report.summary.laborCostPercent)}`}>
                  {report.summary.laborCostPercent !== null
                    ? `${report.summary.laborCostPercent}%`
                    : 'N/A'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total Hours</p>
                <p className="text-xl font-bold text-blue-600">
                  {report.summary.totalHours.toFixed(1)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Overtime Hours</p>
                <p className={`text-xl font-bold ${report.summary.totalOvertimeHours > 0 ? 'text-amber-600' : 'text-gray-700'}`}>
                  {report.summary.totalOvertimeHours.toFixed(1)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Avg $/Hour</p>
                <p className="text-xl font-bold text-gray-700">
                  {formatCurrency(report.summary.avgCostPerHour)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total Shifts</p>
                <p className="text-xl font-bold text-gray-700">
                  {report.summary.totalShifts}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* View Tabs */}
        <div className="flex gap-2 mb-4">
          <Button
            variant={selectedView === 'employee' ? 'primary' : 'outline'}
            onClick={() => setSelectedView('employee')}
          >
            By Employee
          </Button>
          <Button
            variant={selectedView === 'daily' ? 'primary' : 'outline'}
            onClick={() => setSelectedView('daily')}
          >
            By Day
          </Button>
          <Button
            variant={selectedView === 'role' ? 'primary' : 'outline'}
            onClick={() => setSelectedView('role')}
          >
            By Role
          </Button>
        </div>

        {/* Report Content */}
        <Card>
          <CardHeader>
            <CardTitle>
              {selectedView === 'employee' && 'Employee Labor Breakdown'}
              {selectedView === 'daily' && 'Daily Labor Breakdown'}
              {selectedView === 'role' && 'Labor by Role'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-gray-500">Loading report...</div>
            ) : !report || report.byEmployee.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No labor data found for the selected period.
              </div>
            ) : selectedView === 'employee' ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Employee</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Role</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Hours</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Regular</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">OT</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Rate</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Labor Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byEmployee.map((emp) => (
                      <tr key={emp.id} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                              <span className="text-blue-600 font-semibold text-sm">
                                {emp.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <span className="font-medium">{emp.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{emp.role}</td>
                        <td className="px-4 py-3 text-right font-medium text-blue-600">{emp.totalHours.toFixed(1)}</td>
                        <td className="px-4 py-3 text-right">{emp.regularHours.toFixed(1)}</td>
                        <td className={`px-4 py-3 text-right ${emp.overtimeHours > 0 ? 'text-amber-600 font-medium' : ''}`}>
                          {emp.overtimeHours.toFixed(1)}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500">{formatCurrency(emp.hourlyRate)}/hr</td>
                        <td className="px-4 py-3 text-right font-medium">{formatCurrency(emp.laborCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-100">
                    <tr>
                      <td className="px-4 py-3 font-bold" colSpan={2}>TOTALS</td>
                      <td className="px-4 py-3 text-right font-bold text-blue-600">{report.summary.totalHours.toFixed(1)}</td>
                      <td className="px-4 py-3 text-right font-bold">{report.summary.totalRegularHours.toFixed(1)}</td>
                      <td className="px-4 py-3 text-right font-bold text-amber-600">{report.summary.totalOvertimeHours.toFixed(1)}</td>
                      <td className="px-4 py-3 text-right font-bold">{formatCurrency(report.summary.avgCostPerHour)}/hr</td>
                      <td className="px-4 py-3 text-right font-bold">{formatCurrency(report.summary.totalLaborCost)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : selectedView === 'daily' ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Date</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Employees</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Shifts</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Hours</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">OT Hours</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Breaks</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Labor Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byDay.map((day) => (
                      <tr key={day.date} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">
                          {new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </td>
                        <td className="px-4 py-3 text-right">{day.employeeCount}</td>
                        <td className="px-4 py-3 text-right">{day.shifts}</td>
                        <td className="px-4 py-3 text-right font-medium text-blue-600">{day.totalHours.toFixed(1)}</td>
                        <td className={`px-4 py-3 text-right ${day.overtimeHours > 0 ? 'text-amber-600 font-medium' : ''}`}>
                          {day.overtimeHours.toFixed(1)}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500">{day.breakMinutes}m</td>
                        <td className="px-4 py-3 text-right font-medium">{formatCurrency(day.laborCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-100">
                    <tr>
                      <td className="px-4 py-3 font-bold">TOTALS</td>
                      <td className="px-4 py-3 text-right font-bold">—</td>
                      <td className="px-4 py-3 text-right font-bold">{report.summary.totalShifts}</td>
                      <td className="px-4 py-3 text-right font-bold text-blue-600">{report.summary.totalHours.toFixed(1)}</td>
                      <td className="px-4 py-3 text-right font-bold text-amber-600">{report.summary.totalOvertimeHours.toFixed(1)}</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-500">{report.summary.totalBreakMinutes}m</td>
                      <td className="px-4 py-3 text-right font-bold">{formatCurrency(report.summary.totalLaborCost)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              /* Role View */
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Role</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Employees</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Shifts</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Total Hours</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Avg Hrs/Shift</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Labor Cost</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">% of Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byRole.map((role) => (
                      <tr key={role.role} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{role.role}</td>
                        <td className="px-4 py-3 text-right">{role.employees}</td>
                        <td className="px-4 py-3 text-right">{role.shifts}</td>
                        <td className="px-4 py-3 text-right font-medium text-blue-600">{role.totalHours.toFixed(1)}</td>
                        <td className="px-4 py-3 text-right text-gray-500">{role.avgHoursPerShift.toFixed(1)}</td>
                        <td className="px-4 py-3 text-right font-medium">{formatCurrency(role.laborCost)}</td>
                        <td className="px-4 py-3 text-right text-gray-500">
                          {report.summary.totalLaborCost > 0
                            ? `${((role.laborCost / report.summary.totalLaborCost) * 100).toFixed(1)}%`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-100">
                    <tr>
                      <td className="px-4 py-3 font-bold">TOTALS</td>
                      <td className="px-4 py-3 text-right font-bold">{report.byRole.reduce((s, r) => s + r.employees, 0)}</td>
                      <td className="px-4 py-3 text-right font-bold">{report.summary.totalShifts}</td>
                      <td className="px-4 py-3 text-right font-bold text-blue-600">{report.summary.totalHours.toFixed(1)}</td>
                      <td className="px-4 py-3 text-right font-bold">{report.summary.avgHoursPerShift.toFixed(1)}</td>
                      <td className="px-4 py-3 text-right font-bold">{formatCurrency(report.summary.totalLaborCost)}</td>
                      <td className="px-4 py-3 text-right font-bold">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Labor % benchmark guide */}
        {report && report.summary.laborCostPercent !== null && (
          <div className="mt-4 p-4 bg-white border border-gray-200 rounded-xl">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Labor Cost % Benchmarks</h3>
            <div className="flex gap-4 text-sm">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-green-500" />
                Under 30% — On Target
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-amber-500" />
                30-35% — Watch
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-red-500" />
                Over 35% — Over Target
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
