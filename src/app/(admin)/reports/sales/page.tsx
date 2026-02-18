'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface SalesReport {
  summary: {
    orderCount: number
    itemCount: number
    grossSales: number
    discounts: number
    netSales: number
    tax: number
    tips: number
    total: number
    cashSales: number
    cardSales: number
    averageOrderValue: number
  }
  byDay: { date: string; orders: number; gross: number; net: number; tax: number; tips: number }[]
  byHour: { hour: number; label: string; orders: number; gross: number }[]
  byCategory: { id: string; name: string; quantity: number; gross: number }[]
  byItem: { id: string; name: string; quantity: number; gross: number; category: string }[]
  byEmployee: { id: string; name: string; orders: number; gross: number }[]
}

type TabType = 'summary' | 'daily' | 'hourly' | 'categories' | 'items' | 'employees'

export default function SalesReportPage() {
  const router = useRouter()
  const employee = useAuthStore(s => s.employee)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const [report, setReport] = useState<SalesReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>('summary')
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 7)
    return date.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0]
  })

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/reports/sales')
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
      const params = new URLSearchParams({
        locationId: employee.location.id,
      })
      if (startDate) params.append('startDate', startDate)
      if (endDate) params.append('endDate', endDate)

      const response = await fetch(`/api/reports/sales?${params}`)
      if (response.ok) {
        const data = await response.json()
        setReport(data)
      }
    } catch (error) {
      console.error('Failed to load sales report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  }

  if (!isAuthenticated) return null

  const tabs: { id: TabType; label: string }[] = [
    { id: 'summary', label: 'Summary' },
    { id: 'daily', label: 'By Day' },
    { id: 'hourly', label: 'By Hour' },
    { id: 'categories', label: 'Categories' },
    { id: 'items', label: 'Top Items' },
    { id: 'employees', label: 'Employees' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Sales Report"
        subtitle={employee?.location?.name}
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
        actions={
          <Button variant="ghost" onClick={() => router.push('/reports/commission')}>
            Commission Report
          </Button>
        }
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
              <div className="flex-1" />
              <div className="text-sm text-gray-500">
                {employee?.location?.name}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {tabs.map(tab => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="p-8 text-center text-gray-500">
              Loading sales report...
            </CardContent>
          </Card>
        ) : !report ? (
          <Card>
            <CardContent className="p-8 text-center text-gray-500">
              No data available
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Summary Tab */}
            {activeTab === 'summary' && (
              <div className="space-y-6">
                {/* Key Metrics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-500">Gross Sales</p>
                      <p className="text-2xl font-bold text-blue-600">
                        {formatCurrency(report.summary.grossSales)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-500">Net Sales</p>
                      <p className="text-2xl font-bold text-green-600">
                        {formatCurrency(report.summary.netSales)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-500">Total (with Tax)</p>
                      <p className="text-2xl font-bold text-purple-600">
                        {formatCurrency(report.summary.total)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-500">Tips Collected</p>
                      <p className="text-2xl font-bold text-orange-600">
                        {formatCurrency(report.summary.tips)}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Order Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-500">Orders</p>
                      <p className="text-2xl font-bold">{report.summary.orderCount}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-500">Items Sold</p>
                      <p className="text-2xl font-bold">{report.summary.itemCount}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-500">Avg Order Value</p>
                      <p className="text-2xl font-bold">{formatCurrency(report.summary.averageOrderValue)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-500">Tax Collected</p>
                      <p className="text-2xl font-bold">{formatCurrency(report.summary.tax)}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Payment Methods */}
                <Card>
                  <CardHeader>
                    <CardTitle>Payment Methods</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex items-center gap-4 p-4 bg-green-50 rounded-lg">
                        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                          <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">Cash</p>
                          <p className="text-xl font-bold text-green-600">{formatCurrency(report.summary.cashSales)}</p>
                          <p className="text-xs text-gray-500">
                            {report.summary.cashSales + report.summary.cardSales > 0
                              ? Math.round((report.summary.cashSales / (report.summary.cashSales + report.summary.cardSales)) * 100)
                              : 0}%
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 p-4 bg-blue-50 rounded-lg">
                        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                          <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">Card</p>
                          <p className="text-xl font-bold text-blue-600">{formatCurrency(report.summary.cardSales)}</p>
                          <p className="text-xs text-gray-500">
                            {report.summary.cashSales + report.summary.cardSales > 0
                              ? Math.round((report.summary.cardSales / (report.summary.cashSales + report.summary.cardSales)) * 100)
                              : 0}%
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Discounts */}
                {report.summary.discounts > 0 && (
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-500">Discounts Applied</p>
                          <p className="text-xl font-bold text-red-600">-{formatCurrency(report.summary.discounts)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Daily Tab */}
            {activeTab === 'daily' && (
              <Card>
                <CardHeader>
                  <CardTitle>Sales by Day</CardTitle>
                </CardHeader>
                <CardContent>
                  {report.byDay.length === 0 ? (
                    <p className="text-center py-8 text-gray-500">No daily data available</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Date</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Orders</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Gross</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Tax</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Tips</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Net Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.byDay.map((day) => (
                            <tr key={day.date} className="border-t hover:bg-gray-50">
                              <td className="px-4 py-3 font-medium">{formatDate(day.date)}</td>
                              <td className="px-4 py-3 text-right text-gray-600">{day.orders}</td>
                              <td className="px-4 py-3 text-right">{formatCurrency(day.gross)}</td>
                              <td className="px-4 py-3 text-right text-gray-500">{formatCurrency(day.tax)}</td>
                              <td className="px-4 py-3 text-right text-orange-600">{formatCurrency(day.tips)}</td>
                              <td className="px-4 py-3 text-right font-bold text-green-600">{formatCurrency(day.net)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-gray-100 font-bold">
                          <tr>
                            <td className="px-4 py-3">Total</td>
                            <td className="px-4 py-3 text-right">{report.byDay.reduce((sum, d) => sum + d.orders, 0)}</td>
                            <td className="px-4 py-3 text-right">{formatCurrency(report.byDay.reduce((sum, d) => sum + d.gross, 0))}</td>
                            <td className="px-4 py-3 text-right">{formatCurrency(report.byDay.reduce((sum, d) => sum + d.tax, 0))}</td>
                            <td className="px-4 py-3 text-right text-orange-600">{formatCurrency(report.byDay.reduce((sum, d) => sum + d.tips, 0))}</td>
                            <td className="px-4 py-3 text-right text-green-600">{formatCurrency(report.byDay.reduce((sum, d) => sum + d.net, 0))}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Hourly Tab */}
            {activeTab === 'hourly' && (
              <Card>
                <CardHeader>
                  <CardTitle>Sales by Hour</CardTitle>
                </CardHeader>
                <CardContent>
                  {report.byHour.length === 0 ? (
                    <p className="text-center py-8 text-gray-500">No hourly data available</p>
                  ) : (
                    <div className="space-y-2">
                      {report.byHour.map((hour) => {
                        const maxGross = Math.max(...report.byHour.map(h => h.gross))
                        const percentage = maxGross > 0 ? (hour.gross / maxGross) * 100 : 0
                        return (
                          <div key={hour.hour} className="flex items-center gap-4">
                            <div className="w-16 text-sm font-medium text-gray-600">{hour.label}</div>
                            <div className="flex-1 h-8 bg-gray-100 rounded-lg overflow-hidden relative">
                              <div
                                className="h-full bg-blue-500 rounded-lg transition-all"
                                style={{ width: `${percentage}%` }}
                              />
                              <div className="absolute inset-0 flex items-center justify-between px-3">
                                <span className="text-xs font-medium">{hour.orders} orders</span>
                                <span className="text-xs font-bold">{formatCurrency(hour.gross)}</span>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Categories Tab */}
            {activeTab === 'categories' && (
              <Card>
                <CardHeader>
                  <CardTitle>Sales by Category</CardTitle>
                </CardHeader>
                <CardContent>
                  {report.byCategory.length === 0 ? (
                    <p className="text-center py-8 text-gray-500">No category data available</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Category</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Qty Sold</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Gross Sales</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">% of Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.byCategory.map((cat) => (
                            <tr key={cat.id} className="border-t hover:bg-gray-50">
                              <td className="px-4 py-3 font-medium">{cat.name}</td>
                              <td className="px-4 py-3 text-right text-gray-600">{cat.quantity}</td>
                              <td className="px-4 py-3 text-right font-medium">{formatCurrency(cat.gross)}</td>
                              <td className="px-4 py-3 text-right text-gray-500">
                                {report.summary.grossSales > 0
                                  ? Math.round((cat.gross / report.summary.grossSales) * 100)
                                  : 0}%
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

            {/* Items Tab */}
            {activeTab === 'items' && (
              <Card>
                <CardHeader>
                  <CardTitle>Top Selling Items</CardTitle>
                </CardHeader>
                <CardContent>
                  {report.byItem.length === 0 ? (
                    <p className="text-center py-8 text-gray-500">No item data available</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">#</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Item</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Category</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Qty Sold</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Gross Sales</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.byItem.map((item, index) => (
                            <tr key={item.id} className="border-t hover:bg-gray-50">
                              <td className="px-4 py-3 text-gray-400">{index + 1}</td>
                              <td className="px-4 py-3 font-medium">{item.name}</td>
                              <td className="px-4 py-3 text-gray-500">{item.category}</td>
                              <td className="px-4 py-3 text-right text-gray-600">{item.quantity}</td>
                              <td className="px-4 py-3 text-right font-medium text-green-600">{formatCurrency(item.gross)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Employees Tab */}
            {activeTab === 'employees' && (
              <Card>
                <CardHeader>
                  <CardTitle>Sales by Employee</CardTitle>
                </CardHeader>
                <CardContent>
                  {report.byEmployee.length === 0 ? (
                    <p className="text-center py-8 text-gray-500">No employee data available</p>
                  ) : (
                    <div className="space-y-3">
                      {report.byEmployee.map((emp, index) => (
                        <div key={emp.id} className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
                          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                            <span className="text-blue-600 font-bold">{index + 1}</span>
                          </div>
                          <div className="flex-1">
                            <p className="font-medium">{emp.name}</p>
                            <p className="text-sm text-gray-500">{emp.orders} orders</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xl font-bold text-green-600">{formatCurrency(emp.gross)}</p>
                            <p className="text-xs text-gray-500">
                              {report.summary.grossSales > 0
                                ? Math.round((emp.gross / report.summary.grossSales) * 100)
                                : 0}% of total
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}
