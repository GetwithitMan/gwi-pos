'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface ServerRow {
  employeeId: string
  name: string
  totalSales: number
  totalTips: number
  orderCount: number
  avgCheckSize: number
  tableCount: number
  tableTurns: number
}

interface ServerPerformanceReport {
  servers: ServerRow[]
  summary: {
    totalRevenue: number
    totalTips: number
    totalOrders: number
    topServer: string | null
  }
}

function exportCSV(servers: ServerRow[], startDate: string, endDate: string) {
  const header = [
    'Server Name',
    'Orders',
    'Total Sales',
    'Total Tips',
    'Avg Check',
    'Table Turns',
  ].join(',')

  const rows = servers.map((s) =>
    [
      `"${s.name}"`,
      s.orderCount,
      s.totalSales.toFixed(2),
      s.totalTips.toFixed(2),
      s.avgCheckSize.toFixed(2),
      s.tableTurns,
    ].join(',')
  )

  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `server-performance-${startDate}-to-${endDate}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function ServerPerformancePage() {
  const hydrated = useAuthenticationGuard({
    redirectUrl: '/login?redirect=/reports/server-performance',
  })
  const employee = useAuthStore((s) => s.employee)

  const todayStr = new Date().toISOString().split('T')[0]
  const [startDate, setStartDate] = useState(todayStr)
  const [endDate, setEndDate] = useState(todayStr)
  const [report, setReport] = useState<ServerPerformanceReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)

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
      const response = await fetch(`/api/reports/server-performance?${params}`)
      if (response.ok) {
        const json = await response.json()
        setReport(json.data)
      }
    } catch (error) {
      console.error('Failed to load server performance report:', error)
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

  const servers = report?.servers ?? []
  const summary = report?.summary

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Server Performance Report"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
      />

      <div className="max-w-7xl mx-auto">
        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  End Date
                </label>
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
              {servers.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => exportCSV(servers, startDate, endDate)}
                >
                  Export CSV
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total Revenue</p>
                <p className="text-xl font-bold text-green-600">
                  {formatCurrency(summary.totalRevenue)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total Tips</p>
                <p className="text-xl font-bold text-orange-600">
                  {formatCurrency(summary.totalTips)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total Orders</p>
                <p className="text-xl font-bold text-blue-600">
                  {summary.totalOrders}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Top Performer</p>
                <p className="text-xl font-bold text-purple-600 truncate">
                  {summary.topServer ?? '—'}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Server Table */}
        <Card>
          <CardHeader>
            <CardTitle>Server Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-gray-500">
                Loading report...
              </div>
            ) : servers.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No paid orders found for the selected period.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">
                        Server Name
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">
                        Orders
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">
                        Total Sales
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">
                        Total Tips
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">
                        Avg Check
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">
                        Table Turns
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {servers.map((server, idx) => (
                      <tr key={server.employeeId} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {idx === 0 && (
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-bold">
                                1
                              </span>
                            )}
                            <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                              <span className="text-purple-600 font-semibold text-sm">
                                {server.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <span className="font-medium">{server.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {server.orderCount}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-green-600">
                          {formatCurrency(server.totalSales)}
                        </td>
                        <td className="px-4 py-3 text-right text-orange-600">
                          {formatCurrency(server.totalTips)}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">
                          {formatCurrency(server.avgCheckSize)}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">
                          {server.tableTurns}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {summary && servers.length > 1 && (
                    <tfoot className="bg-gray-100">
                      <tr>
                        <td className="px-4 py-3 font-bold">TOTALS</td>
                        <td className="px-4 py-3 text-right font-bold">
                          {summary.totalOrders}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-green-600">
                          {formatCurrency(summary.totalRevenue)}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-orange-600">
                          {formatCurrency(summary.totalTips)}
                        </td>
                        <td className="px-4 py-3 text-right font-bold">
                          {summary.totalOrders > 0
                            ? formatCurrency(summary.totalRevenue / summary.totalOrders)
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-bold">
                          {servers.reduce((sum, s) => sum + s.tableTurns, 0)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
