'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface EmployeeData {
  id: string
  name: string
  role: string
  orders: number
  sales: number
  tips: number
  cashTips: number
  cardTips: number
  commission: number
  avgTicket: number
  itemsSold: number
  hoursWorked: number
  salesPerHour: number
  cashPayments: number
  cashAmount: number
  cardPayments: number
  cardAmount: number
  cashReceived: number
  cashOwed: number
  purseBalance: number
}

interface DailyData {
  date: string
  employees: {
    employeeId: string
    employeeName: string
    orders: number
    sales: number
    tips: number
  }[]
  totalSales: number
  totalTips: number
  totalOrders: number
}

interface EmployeeReport {
  summary: {
    totalEmployees: number
    totalOrders: number
    totalSales: number
    totalTips: number
    totalCommission: number
    avgTicket: number
    avgTipPercent: number
  }
  byEmployee: EmployeeData[]
  byDay: DailyData[]
}

export default function EmployeeReportsPage() {
  const router = useRouter()
  const { isAuthenticated, employee } = useAuthStore()
  const [report, setReport] = useState<EmployeeReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 7)
    return date.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0]
  })
  const [selectedView, setSelectedView] = useState<'summary' | 'daily' | 'purse'>('summary')
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/reports/employees')
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

      const response = await fetch(`/api/reports/employees?${params}`)
      if (response.ok) {
        const data = await response.json()
        setReport(data)
      }
    } catch (error) {
      console.error('Failed to load employee report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Employee Reports"
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
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        {report && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total Sales</p>
                <p className="text-xl font-bold text-green-600">
                  {formatCurrency(report.summary.totalSales)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total Tips</p>
                <p className="text-xl font-bold text-blue-600">
                  {formatCurrency(report.summary.totalTips)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Tip %</p>
                <p className="text-xl font-bold text-purple-600">
                  {report.summary.avgTipPercent}%
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Commission</p>
                <p className="text-xl font-bold text-orange-600">
                  {formatCurrency(report.summary.totalCommission)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Orders</p>
                <p className="text-xl font-bold text-gray-700">
                  {report.summary.totalOrders}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Avg Ticket</p>
                <p className="text-xl font-bold text-gray-700">
                  {formatCurrency(report.summary.avgTicket)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Employees</p>
                <p className="text-xl font-bold text-gray-700">
                  {report.summary.totalEmployees}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* View Tabs */}
        <div className="flex gap-2 mb-4">
          <Button
            variant={selectedView === 'summary' ? 'primary' : 'outline'}
            onClick={() => setSelectedView('summary')}
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
            variant={selectedView === 'purse' ? 'primary' : 'outline'}
            onClick={() => setSelectedView('purse')}
          >
            Purse / Cash Out
          </Button>
        </div>

        {/* Report Content */}
        <Card>
          <CardHeader>
            <CardTitle>
              {selectedView === 'summary' && 'Employee Performance'}
              {selectedView === 'daily' && 'Daily Breakdown'}
              {selectedView === 'purse' && 'Cash Purse & Tips'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-gray-500">Loading report...</div>
            ) : !report || report.byEmployee.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No data found for the selected period.
              </div>
            ) : selectedView === 'summary' ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Employee</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Role</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Orders</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Sales</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Tips</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Commission</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Avg Ticket</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Items</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byEmployee.map((emp) => (
                      <tr
                        key={emp.id}
                        className="border-t hover:bg-gray-50 cursor-pointer"
                        onClick={() => setExpandedEmployee(expandedEmployee === emp.id ? null : emp.id)}
                      >
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
                        <td className="px-4 py-3 text-right">{emp.orders}</td>
                        <td className="px-4 py-3 text-right font-medium text-green-600">
                          {formatCurrency(emp.sales)}
                        </td>
                        <td className="px-4 py-3 text-right text-blue-600">
                          {formatCurrency(emp.tips)}
                        </td>
                        <td className="px-4 py-3 text-right text-orange-600">
                          {formatCurrency(emp.commission)}
                        </td>
                        <td className="px-4 py-3 text-right">{formatCurrency(emp.avgTicket)}</td>
                        <td className="px-4 py-3 text-right">{emp.itemsSold}</td>
                        <td className="px-4 py-3 text-right">{emp.hoursWorked.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : selectedView === 'daily' ? (
              <div className="space-y-4">
                {report.byDay.map((day) => (
                  <div key={day.date} className="border rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 flex justify-between items-center">
                      <span className="font-medium">
                        {new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                      <div className="flex gap-4 text-sm">
                        <span>{day.totalOrders} orders</span>
                        <span className="text-green-600">{formatCurrency(day.totalSales)}</span>
                        <span className="text-blue-600">{formatCurrency(day.totalTips)} tips</span>
                      </div>
                    </div>
                    <table className="w-full">
                      <tbody>
                        {day.employees.map((emp) => (
                          <tr key={emp.employeeId} className="border-t">
                            <td className="px-4 py-2">{emp.employeeName}</td>
                            <td className="px-4 py-2 text-right text-gray-500">{emp.orders} orders</td>
                            <td className="px-4 py-2 text-right text-green-600">{formatCurrency(emp.sales)}</td>
                            <td className="px-4 py-2 text-right text-blue-600">{formatCurrency(emp.tips)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            ) : (
              /* Purse View */
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Employee</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Cash Sales</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Card Sales</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Cash Tips</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Card Tips</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Cash Received</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Owes Back</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Purse Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byEmployee.map((emp) => (
                      <tr key={emp.id} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{emp.name}</td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(emp.cashAmount)}
                          <span className="text-gray-400 text-xs ml-1">({emp.cashPayments})</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(emp.cardAmount)}
                          <span className="text-gray-400 text-xs ml-1">({emp.cardPayments})</span>
                        </td>
                        <td className="px-4 py-3 text-right text-green-600">
                          {formatCurrency(emp.cashTips)}
                        </td>
                        <td className="px-4 py-3 text-right text-blue-600">
                          {formatCurrency(emp.cardTips)}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {formatCurrency(emp.cashReceived)}
                        </td>
                        <td className="px-4 py-3 text-right text-red-600">
                          {formatCurrency(emp.cashOwed)}
                        </td>
                        <td className={`px-4 py-3 text-right font-bold ${
                          emp.purseBalance >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {formatCurrency(emp.purseBalance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-100">
                    <tr>
                      <td className="px-4 py-3 font-bold">TOTALS</td>
                      <td className="px-4 py-3 text-right font-bold">
                        {formatCurrency(report.byEmployee.reduce((sum, e) => sum + e.cashAmount, 0))}
                      </td>
                      <td className="px-4 py-3 text-right font-bold">
                        {formatCurrency(report.byEmployee.reduce((sum, e) => sum + e.cardAmount, 0))}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-green-600">
                        {formatCurrency(report.byEmployee.reduce((sum, e) => sum + e.cashTips, 0))}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-blue-600">
                        {formatCurrency(report.byEmployee.reduce((sum, e) => sum + e.cardTips, 0))}
                      </td>
                      <td className="px-4 py-3 text-right font-bold">
                        {formatCurrency(report.byEmployee.reduce((sum, e) => sum + e.cashReceived, 0))}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-red-600">
                        {formatCurrency(report.byEmployee.reduce((sum, e) => sum + e.cashOwed, 0))}
                      </td>
                      <td className="px-4 py-3 text-right font-bold">
                        {formatCurrency(report.byEmployee.reduce((sum, e) => sum + e.purseBalance, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
                <div className="mt-4 p-4 bg-blue-50 rounded-lg text-sm text-blue-800">
                  <strong>Purse Balance</strong> = Cash Received - Cash Sales Owed Back
                  <br />
                  This should equal the cash tips the employee keeps. If there&apos;s a discrepancy,
                  check for over/under rings or missing cash payments.
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
