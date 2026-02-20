'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { WebReportBanner } from '@/components/admin/WebReportBanner'
import { useDataRetention } from '@/hooks/useDataRetention'

interface EmployeeShiftReport {
  employee: {
    id: string
    name: string
    role: string
  }

  shift: {
    id: string | null
    clockIn: string
    clockOut: string
    hours: number
    hourlyRate: number
    laborCost: number
  }

  summary: {
    totalSales: number
    hours: number
    laborCost: number
    checks: number
    avgCheck: number
    tips: number
    discounts: number
    voids: number
    cashDue: number
    creditTips: number
  }

  revenue: {
    adjustedGrossSales: number
    discounts: number
    netSales: number
    salesTax: number
    surcharge: number
    grossSales: number
    tips: number
    gratuity: number
    refunds: number
    totalCollected: number
    commission: number
  }

  payments: {
    cash: { count: number; amount: number }
    credit: {
      count: number
      amount: number
      tips: number
      breakdown: {
        visa: { count: number; amount: number }
        mastercard: { count: number; amount: number }
        amex: { count: number; amount: number }
        discover: { count: number; amount: number }
        other: { count: number; amount: number }
      }
    }
    gift: { count: number; amount: number }
    houseAccount: { count: number; amount: number }
    other: { count: number; amount: number }
    totalPayments: number
  }

  cash: {
    cashReceived: number
    cashIn: number
    cashOut: number
    gratuity: number
    tipsOwed: number
    cashDue: number
  }

  revenueGroups: {
    name: string
    gross: number
    net: number
    discounts: number
    voids: number
    percentOfGross: number
    percentOfNet: number
  }[]

  salesByCategory: {
    name: string
    categoryType: string
    units: number
    gross: number
    discounts: number
    net: number
    voids: number
    percentOfTotal: number
  }[]

  voids: {
    tickets: { count: number; amount: number }
    items: { count: number; amount: number }
    total: { count: number; amount: number }
    percentOfSales: number
    byReason: { reason: string; count: number; amount: number }[]
  }

  discounts: {
    total: number
    byType: { name: string; count: number; amount: number }[]
  }

  stats: {
    checks: number
    avgCheck: number
    avgCheckTimeMinutes: number
    covers: number
    avgCover: number
    foodAvg: number
    bevAvg: number
    retailAvg: number
  }
}

interface Employee {
  id: string
  firstName: string
  lastName: string
  displayName: string | null
}

function EmployeeShiftReportContent() {
  const searchParams = useSearchParams()
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/shift' })
  const currentEmployee = useAuthStore(s => s.employee)
  const { retentionDays, venueSlug } = useDataRetention()

  const [report, setReport] = useState<EmployeeShiftReport | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('')
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])

  // Check for query params
  useEffect(() => {
    const employeeId = searchParams.get('employeeId')
    const date = searchParams.get('date')
    const shiftId = searchParams.get('shiftId')

    if (employeeId) setSelectedEmployeeId(employeeId)
    if (date) setSelectedDate(date)
    if (shiftId) {
      loadReportByShift(shiftId)
    }
  }, [searchParams])

  useEffect(() => {
    if (currentEmployee?.location?.id) {
      loadEmployees()
    }
  }, [currentEmployee?.location?.id])

  const loadEmployees = async () => {
    if (!currentEmployee?.location?.id) return

    try {
      const response = await fetch(
        `/api/employees?locationId=${currentEmployee.location.id}`
      )
      if (response.ok) {
        const data = await response.json()
        setEmployees(data.data.employees)
      }
    } catch (error) {
      console.error('Failed to load employees:', error)
    }
  }

  const loadReport = async () => {
    if (!currentEmployee?.location?.id || !selectedEmployeeId) return

    setIsLoading(true)
    try {
      const response = await fetch(
        `/api/reports/employee-shift?locationId=${currentEmployee.location.id}&employeeId=${selectedEmployeeId}&date=${selectedDate}`
      )
      if (response.ok) {
        const data = await response.json()
        setReport(data.data)
      } else {
        setReport(null)
      }
    } catch (error) {
      console.error('Failed to load report:', error)
      setReport(null)
    } finally {
      setIsLoading(false)
    }
  }

  const loadReportByShift = async (shiftId: string) => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/reports/employee-shift?shiftId=${shiftId}&employeeId=${currentEmployee?.id}&locationId=${currentEmployee?.location?.id}`)
      if (response.ok) {
        const data = await response.json()
        setReport(data.data)
        setSelectedEmployeeId(data.data.employee.id)
      }
    } catch (error) {
      console.error('Failed to load report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const formatTime = (minutes: number) => {
    const mins = Math.floor(minutes)
    const secs = Math.round((minutes - mins) * 60)
    return `${mins} mins ${secs} s`
  }

  const formatShiftTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Employee Shift Report"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
        actions={
          <div className="flex items-center gap-4">
            <select
              value={selectedEmployeeId}
              onChange={(e) => setSelectedEmployeeId(e.target.value)}
              className="px-3 py-2 border rounded-lg min-w-[200px]"
            >
              <option value="">Select Employee...</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.displayName || `${emp.firstName} ${emp.lastName}`}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 border rounded-lg"
            />
            <Button variant="primary" onClick={loadReport} disabled={!selectedEmployeeId}>
              Load Report
            </Button>
            {report && (
              <Button variant="outline" onClick={() => window.print()}>
                Print
              </Button>
            )}
          </div>
        }
      />

      <div className="max-w-5xl mx-auto print:p-0 print:max-w-none">
        <WebReportBanner
          startDate={selectedDate}
          endDate={selectedDate}
          reportType="shift"
          retentionDays={retentionDays}
          venueSlug={venueSlug}
        />

        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Loading report...</div>
        ) : !report ? (
          <div className="text-center py-12 text-gray-500">
            {selectedEmployeeId
              ? 'No shift found for this employee on this date'
              : 'Select an employee and date to view their shift report'}
          </div>
        ) : (
          <div className="space-y-4 print:space-y-3">
            {/* Employee Header */}
            <Card className="print:shadow-none print:border">
              <CardContent className="py-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-2xl font-bold">{report.employee.name}</h2>
                    <p className="text-gray-600">{report.employee.role}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">
                      {new Date(report.shift.clockIn).toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </p>
                    <p className="text-sm text-gray-500">
                      Shift: {formatShiftTime(report.shift.clockIn)} - {formatShiftTime(report.shift.clockOut)}
                    </p>
                  </div>
                </div>

                {/* Summary Header Bar */}
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <div className="grid grid-cols-5 md:grid-cols-10 gap-4 text-center text-sm">
                    <div>
                      <p className="text-gray-500">Sales</p>
                      <p className="font-bold text-lg">{formatCurrency(report.summary.totalSales)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Hours</p>
                      <p className="font-bold text-lg">{report.summary.hours.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Labor</p>
                      <p className="font-bold text-lg">{formatCurrency(report.summary.laborCost)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Checks</p>
                      <p className="font-bold text-lg">{report.summary.checks}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Avg Check</p>
                      <p className="font-bold text-lg">{formatCurrency(report.summary.avgCheck)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Tips</p>
                      <p className="font-bold text-lg text-green-600">{formatCurrency(report.summary.tips)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Discounts</p>
                      <p className="font-bold text-lg text-orange-600">{formatCurrency(report.summary.discounts)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Voids</p>
                      <p className="font-bold text-lg text-red-600">{formatCurrency(report.summary.voids)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Cash Due</p>
                      <p className="font-bold text-lg">{formatCurrency(report.summary.cashDue)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">CC Tips</p>
                      <p className="font-bold text-lg text-green-600">{formatCurrency(report.summary.creditTips)}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Revenue Section */}
            <Card className="print:shadow-none print:border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Revenue</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 font-mono text-sm">
                  <div className="flex justify-between">
                    <span>Adjusted Gross Sales</span>
                    <span>{formatCurrency(report.revenue.adjustedGrossSales)}</span>
                  </div>
                  <div className="flex justify-between text-red-600">
                    <span>– Discounts</span>
                    <span>{formatCurrency(report.revenue.discounts)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Net Sales</span>
                    <span>{formatCurrency(report.revenue.netSales)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>+ Sales Tax</span>
                    <span>{formatCurrency(report.revenue.salesTax)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>+ Surcharge</span>
                    <span>{formatCurrency(report.revenue.surcharge)}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t pt-1">
                    <span>Gross Sales</span>
                    <span>{formatCurrency(report.revenue.grossSales)}</span>
                  </div>
                  <div className="flex justify-between text-green-600">
                    <span>+ Tips</span>
                    <span>{formatCurrency(report.revenue.tips)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>+ Gratuity</span>
                    <span>{formatCurrency(report.revenue.gratuity)}</span>
                  </div>
                  <div className="flex justify-between text-red-600">
                    <span>– Refunds</span>
                    <span>{formatCurrency(report.revenue.refunds)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg border-t pt-2 mt-2">
                    <span>= Total Collected</span>
                    <span>{formatCurrency(report.revenue.totalCollected)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Payments & Cash */}
            <div className="grid md:grid-cols-2 gap-4 print:grid-cols-2">
              {/* Payments */}
              <Card className="print:shadow-none print:border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Tender</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 font-mono text-sm">
                    <div className="flex justify-between">
                      <span>+ Cash ({report.payments.cash.count})</span>
                      <span>{formatCurrency(report.payments.cash.amount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>+ Credit ({report.payments.credit.count})</span>
                      <span>{formatCurrency(report.payments.credit.amount)}</span>
                    </div>
                    <div className="ml-4 text-gray-600 space-y-0.5 text-xs">
                      {report.payments.credit.breakdown.amex.count > 0 && (
                        <div className="flex justify-between">
                          <span>AMEX ({report.payments.credit.breakdown.amex.count})</span>
                          <span>{formatCurrency(report.payments.credit.breakdown.amex.amount)}</span>
                        </div>
                      )}
                      {report.payments.credit.breakdown.visa.count > 0 && (
                        <div className="flex justify-between">
                          <span>VISA ({report.payments.credit.breakdown.visa.count})</span>
                          <span>{formatCurrency(report.payments.credit.breakdown.visa.amount)}</span>
                        </div>
                      )}
                      {report.payments.credit.breakdown.mastercard.count > 0 && (
                        <div className="flex justify-between">
                          <span>MC ({report.payments.credit.breakdown.mastercard.count})</span>
                          <span>{formatCurrency(report.payments.credit.breakdown.mastercard.amount)}</span>
                        </div>
                      )}
                      {report.payments.credit.breakdown.discover.count > 0 && (
                        <div className="flex justify-between">
                          <span>DCVR ({report.payments.credit.breakdown.discover.count})</span>
                          <span>{formatCurrency(report.payments.credit.breakdown.discover.amount)}</span>
                        </div>
                      )}
                    </div>
                    {report.payments.gift.count > 0 && (
                      <div className="flex justify-between">
                        <span>+ Gift ({report.payments.gift.count})</span>
                        <span>{formatCurrency(report.payments.gift.amount)}</span>
                      </div>
                    )}
                    {report.payments.houseAccount.count > 0 && (
                      <div className="flex justify-between">
                        <span>+ House Acct ({report.payments.houseAccount.count})</span>
                        <span>{formatCurrency(report.payments.houseAccount.amount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold border-t pt-1 mt-1">
                      <span>= Total Payments</span>
                      <span>{formatCurrency(report.payments.totalPayments)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Cash */}
              <Card className="print:shadow-none print:border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Cash</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 font-mono text-sm">
                    <div className="flex justify-between">
                      <span>+ Cash</span>
                      <span>{formatCurrency(report.cash.cashReceived)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>+ Cash In</span>
                      <span>{formatCurrency(report.cash.cashIn)}</span>
                    </div>
                    <div className="flex justify-between text-red-600">
                      <span>– Cash Out</span>
                      <span>{formatCurrency(report.cash.cashOut)}</span>
                    </div>
                    <div className="flex justify-between text-red-600">
                      <span>– Gratuity</span>
                      <span>{formatCurrency(report.cash.gratuity)}</span>
                    </div>
                    <div className="flex justify-between text-red-600">
                      <span>– Tips</span>
                      <span>{formatCurrency(report.cash.tipsOwed)}</span>
                    </div>
                    <div className="flex justify-between font-bold border-t pt-1 mt-1">
                      <span>= Cash Due</span>
                      <span>{formatCurrency(report.cash.cashDue)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Revenue Groups */}
            <Card className="print:shadow-none print:border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Revenue Groups</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-4 text-xs font-mono">
                  <div className="font-semibold">Category</div>
                  <div className="font-semibold text-right">% of Net</div>
                  <div className="font-semibold text-right">Amount</div>
                  <div className="font-semibold text-right">Voids</div>
                </div>
                {report.revenueGroups.map(group => (
                  <div key={group.name} className="grid grid-cols-4 gap-4 text-sm font-mono py-1 border-t">
                    <div>{group.name}</div>
                    <div className="text-right text-gray-500">{group.percentOfNet}%</div>
                    <div className="text-right">{formatCurrency(group.net)}</div>
                    <div className="text-right text-red-600">
                      {group.voids > 0 ? formatCurrency(group.voids) : '—'}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Voids & Discounts */}
            <div className="grid md:grid-cols-2 gap-4 print:grid-cols-2">
              {/* Voids */}
              <Card className="print:shadow-none print:border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Voids</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 font-mono text-sm">
                    <div className="flex justify-between">
                      <span>Voided Tickets ({report.voids.tickets.count})</span>
                      <span>{formatCurrency(report.voids.tickets.amount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Voided Items ({report.voids.items.count})</span>
                      <span>{formatCurrency(report.voids.items.amount)}</span>
                    </div>
                    <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                      <span>Total ({report.voids.total.count})</span>
                      <span>
                        {formatCurrency(report.voids.total.amount)}
                        <span className="text-gray-500 text-xs ml-1">
                          ({report.voids.percentOfSales}%)
                        </span>
                      </span>
                    </div>
                    {report.voids.byReason.length > 0 && (
                      <div className="mt-2 pt-2 border-t">
                        <p className="text-xs text-gray-500 mb-1">By Reason:</p>
                        {report.voids.byReason.map(v => (
                          <div key={v.reason} className="flex justify-between text-xs">
                            <span>{v.reason} ({v.count})</span>
                            <span>{formatCurrency(v.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Discounts */}
              <Card className="print:shadow-none print:border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Discounts</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 font-mono text-sm">
                    {report.discounts.byType.length === 0 ? (
                      <p className="text-gray-500">No discounts applied</p>
                    ) : (
                      report.discounts.byType.map(d => (
                        <div key={d.name} className="flex justify-between">
                          <span className="truncate mr-2">{d.name} ({d.count})</span>
                          <span>{formatCurrency(d.amount)}</span>
                        </div>
                      ))
                    )}
                    <div className="flex justify-between font-bold border-t pt-1 mt-1">
                      <span>Total</span>
                      <span>{formatCurrency(report.discounts.total)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Stats */}
            <Card className="print:shadow-none print:border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Stats</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 md:grid-cols-8 gap-4 font-mono text-sm">
                  <div>
                    <p className="text-gray-500 text-xs">Sales</p>
                    <p className="font-bold">{formatCurrency(report.revenue.totalCollected)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Checks</p>
                    <p className="font-bold">{report.stats.checks}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Avg Check</p>
                    <p className="font-bold">{formatCurrency(report.stats.avgCheck)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Avg Time</p>
                    <p className="font-bold">{formatTime(report.stats.avgCheckTimeMinutes)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Covers</p>
                    <p className="font-bold">{report.stats.covers}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Avg Cover</p>
                    <p className="font-bold">{formatCurrency(report.stats.avgCover)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Food Avg</p>
                    <p className="font-bold">{formatCurrency(report.stats.foodAvg)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Bev Avg</p>
                    <p className="font-bold">{formatCurrency(report.stats.bevAvg)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Commission if any */}
            {report.revenue.commission > 0 && (
              <Card className="print:shadow-none print:border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Commission</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="font-mono text-sm">
                    <div className="flex justify-between font-bold">
                      <span>Total Commission Earned</span>
                      <span className="text-purple-600">{formatCurrency(report.revenue.commission)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Labor */}
            <Card className="print:shadow-none print:border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Labor</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 font-mono text-sm">
                  <div className="flex justify-between">
                    <span>Total Hours</span>
                    <span>{report.shift.hours.toFixed(2)} hrs</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Hourly Rate</span>
                    <span>{formatCurrency(report.shift.hourlyRate)}/hr</span>
                  </div>
                  <div className="flex justify-between font-bold border-t pt-1 mt-1">
                    <span>Labor Cost</span>
                    <span>{formatCurrency(report.shift.laborCost)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Footer */}
            <div className="text-center text-xs text-gray-500 pt-2">
              Generated {new Date().toLocaleString()}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function EmployeeShiftReportPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <EmployeeShiftReportContent />
    </Suspense>
  )
}
