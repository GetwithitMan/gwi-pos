'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface EmployeePayroll {
  employeeId: string
  employeeName: string
  role: string
  isTipped: boolean
  hourlyRate: number
  regularHours: number
  overtimeHours: number
  totalHours: number
  breakMinutes: number
  regularPay: number
  overtimePay: number
  totalWages: number
  declaredTips: number
  tipSharesGiven: number
  tipSharesReceived: number
  bankedTipsPending: number
  bankedTipsCollected: number
  netTips: number
  commissionTotal: number
  grossPay: number
  shifts: {
    id: string
    date: string
    hours: number
    tips: number
    commission: number
  }[]
  timeEntries: {
    id: string
    date: string
    clockIn: string
    clockOut: string | null
    regularHours: number
    overtimeHours: number
    breakMinutes: number
  }[]
}

interface PayrollSummary {
  periodStart: string
  periodEnd: string
  employeeCount: number
  totalRegularHours: number
  totalOvertimeHours: number
  totalHours: number
  totalWages: number
  totalTips: number
  totalCommissions: number
  totalBankedTipsPending: number
  grandTotal: number
}

interface PayrollReport {
  summary: PayrollSummary
  employees: EmployeePayroll[]
  filters: {
    startDate: string
    endDate: string
    locationId: string
    employeeId: string | null
  }
}

export default function PayrollReportPage() {
  const router = useRouter()
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const employee = useAuthStore(s => s.employee)
  const [report, setReport] = useState<PayrollReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null)

  // Default to current pay period (last 2 weeks)
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 13) // 2 weeks ago
    return date.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0]
  })

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/reports/payroll')
      return
    }
    if (employee?.location?.id) {
      loadReport()
    }
  }, [isAuthenticated, router, employee?.location?.id])

  const loadReport = async () => {
    if (!employee?.location?.id) return

    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('locationId', employee.location.id)
      if (startDate) params.append('startDate', startDate)
      if (endDate) params.append('endDate', endDate)

      const response = await fetch(`/api/reports/payroll?${params}`)
      if (response.ok) {
        const data = await response.json()
        setReport(data)
      }
    } catch (error) {
      console.error('Failed to load payroll report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  }

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Payroll Report"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
      />

      <div className="max-w-7xl mx-auto">
        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Period Start</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Period End</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <Button variant="primary" onClick={loadReport} disabled={isLoading}>
                {isLoading ? 'Loading...' : 'Generate Report'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        {report && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total Wages</p>
                <p className="text-xl font-bold text-blue-600">
                  {formatCurrency(report.summary.totalWages)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total Tips</p>
                <p className="text-xl font-bold text-green-600">
                  {formatCurrency(report.summary.totalTips)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total Commission</p>
                <p className="text-xl font-bold text-purple-600">
                  {formatCurrency(report.summary.totalCommissions)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Grand Total</p>
                <p className="text-xl font-bold text-gray-900">
                  {formatCurrency(report.summary.grandTotal)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total Hours</p>
                <p className="text-xl font-bold text-gray-700">
                  {report.summary.totalHours.toFixed(1)}
                </p>
                <p className="text-xs text-gray-400">
                  {report.summary.totalOvertimeHours > 0 && `(${report.summary.totalOvertimeHours.toFixed(1)} OT)`}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Banked Tips</p>
                <p className="text-xl font-bold text-orange-600">
                  {formatCurrency(report.summary.totalBankedTipsPending)}
                </p>
                <p className="text-xs text-gray-400">pending payout</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Payroll Table */}
        <Card>
          <CardHeader>
            <CardTitle>Employee Payroll</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-gray-500">Loading payroll data...</div>
            ) : !report || report.employees.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p className="mb-2">No payroll data found for the selected period.</p>
                <p className="text-sm">Ensure employees have clocked in/out during this period.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {report.employees.map((emp) => (
                  <div key={emp.employeeId} className="border rounded-lg overflow-hidden">
                    {/* Employee Header Row */}
                    <button
                      className="w-full p-4 bg-gray-50 hover:bg-gray-100 flex items-center justify-between text-left"
                      onClick={() => setExpandedEmployee(
                        expandedEmployee === emp.employeeId ? null : emp.employeeId
                      )}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                          <span className="text-blue-600 font-semibold">
                            {emp.employeeName.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="font-semibold">{emp.employeeName}</p>
                          <p className="text-sm text-gray-500">{emp.role}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <p className="text-sm text-gray-500">Hours</p>
                          <p className="font-medium">{emp.totalHours.toFixed(1)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-gray-500">Wages</p>
                          <p className="font-medium text-blue-600">{formatCurrency(emp.totalWages)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-gray-500">Tips</p>
                          <p className="font-medium text-green-600">{formatCurrency(emp.netTips)}</p>
                        </div>
                        {emp.commissionTotal > 0 && (
                          <div className="text-right">
                            <p className="text-sm text-gray-500">Commission</p>
                            <p className="font-medium text-purple-600">{formatCurrency(emp.commissionTotal)}</p>
                          </div>
                        )}
                        <div className="text-right min-w-[100px]">
                          <p className="text-sm text-gray-500">Gross Pay</p>
                          <p className="text-xl font-bold">{formatCurrency(emp.grossPay)}</p>
                        </div>
                        <svg
                          className={`w-5 h-5 text-gray-400 transition-transform ${
                            expandedEmployee === emp.employeeId ? 'rotate-180' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>

                    {/* Expanded Details */}
                    {expandedEmployee === emp.employeeId && (
                      <div className="border-t p-4 bg-white">
                        <div className="grid md:grid-cols-2 gap-6">
                          {/* Earnings Breakdown */}
                          <div>
                            <h4 className="font-medium text-gray-900 mb-3">Earnings Breakdown</h4>
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between py-1 border-b">
                                <span className="text-gray-600">Hourly Rate</span>
                                <span>{formatCurrency(emp.hourlyRate)}/hr</span>
                              </div>
                              <div className="flex justify-between py-1">
                                <span className="text-gray-600">Regular Hours ({emp.regularHours.toFixed(1)} hrs)</span>
                                <span>{formatCurrency(emp.regularPay)}</span>
                              </div>
                              {emp.overtimeHours > 0 && (
                                <div className="flex justify-between py-1">
                                  <span className="text-gray-600">Overtime ({emp.overtimeHours.toFixed(1)} hrs @ 1.5x)</span>
                                  <span>{formatCurrency(emp.overtimePay)}</span>
                                </div>
                              )}
                              <div className="flex justify-between py-1 border-t font-medium">
                                <span>Total Wages</span>
                                <span className="text-blue-600">{formatCurrency(emp.totalWages)}</span>
                              </div>
                            </div>
                          </div>

                          {/* Tips Breakdown */}
                          <div>
                            <h4 className="font-medium text-gray-900 mb-3">Tips Breakdown</h4>
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between py-1">
                                <span className="text-gray-600">Declared Tips</span>
                                <span>{formatCurrency(emp.declaredTips)}</span>
                              </div>
                              {emp.tipSharesGiven > 0 && (
                                <div className="flex justify-between py-1 text-red-600">
                                  <span>Tip-Outs Given</span>
                                  <span>-{formatCurrency(emp.tipSharesGiven)}</span>
                                </div>
                              )}
                              {emp.tipSharesReceived > 0 && (
                                <div className="flex justify-between py-1 text-green-600">
                                  <span>Tip-Outs Received</span>
                                  <span>+{formatCurrency(emp.tipSharesReceived)}</span>
                                </div>
                              )}
                              {emp.bankedTipsCollected > 0 && (
                                <div className="flex justify-between py-1 text-blue-600">
                                  <span>Banked Tips Collected</span>
                                  <span>+{formatCurrency(emp.bankedTipsCollected)}</span>
                                </div>
                              )}
                              <div className="flex justify-between py-1 border-t font-medium">
                                <span>Net Tips</span>
                                <span className="text-green-600">{formatCurrency(emp.netTips)}</span>
                              </div>
                              {emp.bankedTipsPending > 0 && (
                                <div className="flex justify-between py-1 text-orange-600 text-xs">
                                  <span>Pending Banked Tips</span>
                                  <span>{formatCurrency(emp.bankedTipsPending)}</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Commission Breakdown (if any) */}
                          {emp.commissionTotal > 0 && (
                            <div>
                              <h4 className="font-medium text-gray-900 mb-3">Commission</h4>
                              <div className="space-y-2 text-sm">
                                <div className="flex justify-between py-1 font-medium">
                                  <span>Total Commission</span>
                                  <span className="text-purple-600">{formatCurrency(emp.commissionTotal)}</span>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Time Entries */}
                          {emp.timeEntries.length > 0 && (
                            <div className="md:col-span-2">
                              <h4 className="font-medium text-gray-900 mb-3">Time Entries</h4>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead className="bg-gray-50">
                                    <tr>
                                      <th className="px-3 py-2 text-left">Date</th>
                                      <th className="px-3 py-2 text-left">Clock In</th>
                                      <th className="px-3 py-2 text-left">Clock Out</th>
                                      <th className="px-3 py-2 text-right">Regular</th>
                                      <th className="px-3 py-2 text-right">OT</th>
                                      <th className="px-3 py-2 text-right">Break</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {emp.timeEntries.map((entry) => (
                                      <tr key={entry.id} className="border-t">
                                        <td className="px-3 py-2">{formatDate(entry.date)}</td>
                                        <td className="px-3 py-2">{formatTime(entry.clockIn)}</td>
                                        <td className="px-3 py-2">
                                          {entry.clockOut ? formatTime(entry.clockOut) : '—'}
                                        </td>
                                        <td className="px-3 py-2 text-right">{entry.regularHours.toFixed(1)} hrs</td>
                                        <td className="px-3 py-2 text-right">
                                          {entry.overtimeHours > 0 ? `${entry.overtimeHours.toFixed(1)} hrs` : '—'}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                          {entry.breakMinutes > 0 ? `${entry.breakMinutes} min` : '—'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Grand Total */}
                        <div className="mt-4 pt-4 border-t flex justify-end">
                          <div className="bg-gray-100 px-6 py-3 rounded-lg">
                            <p className="text-sm text-gray-500">Gross Pay</p>
                            <p className="text-2xl font-bold">{formatCurrency(emp.grossPay)}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
