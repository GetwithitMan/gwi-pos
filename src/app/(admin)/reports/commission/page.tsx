'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface CommissionOrder {
  orderId: string
  orderNumber: string
  date: string
  commission: number
  items: { name: string; commission: number }[]
}

interface EmployeeCommission {
  employeeId: string
  employeeName: string
  orderCount: number
  totalCommission: number
  orders: CommissionOrder[]
}

interface CommissionReport {
  report: EmployeeCommission[]
  summary: {
    totalEmployees: number
    totalOrders: number
    grandTotalCommission: number
  }
  filters: {
    startDate: string | null
    endDate: string | null
    employeeId: string | null
  }
}

export default function CommissionReportPage() {
  const router = useRouter()
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const employee = useAuthStore(s => s.employee)
  const [report, setReport] = useState<CommissionReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 7) // Last 7 days by default
    return date.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0]
  })
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/reports/commission')
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

      const response = await fetch(`/api/reports/commission?${params}`)
      if (response.ok) {
        const data = await response.json()
        setReport(data.data)
      }
    } catch (error) {
      console.error('Failed to load commission report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Commission Report"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
      />

      <div className="max-w-6xl mx-auto">
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-gray-500">Total Commission</p>
                <p className="text-3xl font-bold text-green-600">
                  {formatCurrency(report.summary.grandTotalCommission)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-gray-500">Employees with Commission</p>
                <p className="text-3xl font-bold text-blue-600">
                  {report.summary.totalEmployees}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-gray-500">Orders with Commission</p>
                <p className="text-3xl font-bold text-purple-600">
                  {report.summary.totalOrders}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Report Table */}
        <Card>
          <CardHeader>
            <CardTitle>Commission by Employee</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-gray-500">Loading report...</div>
            ) : !report || report.report.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p className="mb-2">No commission data found for the selected period.</p>
                <p className="text-sm">Commission is tracked when items with commission settings are sold.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {report.report.map((employee) => (
                  <div key={employee.employeeId} className="border rounded-lg overflow-hidden">
                    <button
                      className="w-full p-4 bg-gray-50 hover:bg-gray-100 flex items-center justify-between text-left"
                      onClick={() => setExpandedEmployee(
                        expandedEmployee === employee.employeeId ? null : employee.employeeId
                      )}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                          <span className="text-blue-600 font-semibold">
                            {employee.employeeName.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="font-semibold">{employee.employeeName}</p>
                          <p className="text-sm text-gray-500">{employee.orderCount} orders</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-xl font-bold text-green-600">
                          {formatCurrency(employee.totalCommission)}
                        </span>
                        <svg
                          className={`w-5 h-5 text-gray-400 transition-transform ${
                            expandedEmployee === employee.employeeId ? 'rotate-180' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>

                    {expandedEmployee === employee.employeeId && (
                      <div className="border-t">
                        <table className="w-full">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">Order</th>
                              <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">Date</th>
                              <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">Items</th>
                              <th className="px-4 py-2 text-right text-sm font-medium text-gray-500">Commission</th>
                            </tr>
                          </thead>
                          <tbody>
                            {employee.orders.map((order) => (
                              <tr key={order.orderId} className="border-t">
                                <td className="px-4 py-3 text-sm font-medium">
                                  #{order.orderNumber}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-500">
                                  {formatDate(order.date)}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-500">
                                  {order.items.map((item, i) => (
                                    <span key={i}>
                                      {item.name}
                                      {i < order.items.length - 1 && ', '}
                                    </span>
                                  ))}
                                </td>
                                <td className="px-4 py-3 text-sm font-medium text-green-600 text-right">
                                  {formatCurrency(order.commission)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
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
