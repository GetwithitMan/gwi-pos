'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { WebReportBanner } from '@/components/admin/WebReportBanner'
import { useDataRetention } from '@/hooks/useDataRetention'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'

interface GratuityRow {
  employeeId: string
  employeeName: string
  date: string
  orderCount: number
  totalGratuity: number
  avgGratuityPercent: number
  totalOrderValue: number
  avgPartySize: number
}

interface GratuityReport {
  rows: GratuityRow[]
  summary: {
    totalOrders: number
    totalGratuity: number
    totalOrderValue: number
    avgGratuityPercent: number
  }
  settings: {
    enabled: boolean
    percent: number
    minimumPartySize: number
  }
}

function exportGratuityCSV(report: GratuityReport, startDate: string, endDate: string) {
  const rows: string[][] = []
  rows.push(['Employee', 'Date', 'Orders', 'Total Gratuity', 'Avg %', 'Total Sales', 'Avg Party Size'])
  report.rows.forEach(r => {
    rows.push([
      `"${r.employeeName}"`,
      r.date,
      String(r.orderCount),
      r.totalGratuity.toFixed(2),
      r.avgGratuityPercent.toFixed(1),
      r.totalOrderValue.toFixed(2),
      r.avgPartySize.toFixed(1),
    ])
  })
  rows.push([])
  rows.push(['Summary'])
  rows.push(['Total Orders', String(report.summary.totalOrders)])
  rows.push(['Total Gratuity', report.summary.totalGratuity.toFixed(2)])
  rows.push(['Total Order Value', report.summary.totalOrderValue.toFixed(2)])
  rows.push(['Avg Gratuity %', report.summary.avgGratuityPercent.toFixed(1)])
  const csv = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `gratuity-report-${startDate}-to-${endDate}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function GratuityReportPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/gratuity' })
  const employee = useAuthStore(s => s.employee)
  const { retentionDays, venueSlug } = useDataRetention()

  const [report, setReport] = useState<GratuityReport | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Default to last 7 days
  const today = new Date()
  const weekAgo = new Date(today)
  weekAgo.setDate(weekAgo.getDate() - 7)
  const [startDate, setStartDate] = useState(weekAgo.toISOString().split('T')[0])
  const [endDate, setEndDate] = useState(today.toISOString().split('T')[0])

  const loadReport = async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        startDate,
        endDate,
        employeeId: employee.id,
      })
      const response = await fetch(`/api/reports/gratuity?${params}`)
      if (response.ok) {
        const data = await response.json()
        setReport(data.data)
      } else {
        setReport(null)
      }
    } catch (error) {
      console.error('Failed to load gratuity report:', error)
      setReport(null)
    } finally {
      setIsLoading(false)
    }
  }

  // Auto-refresh via socket
  useReportAutoRefresh({ onRefresh: loadReport })

  useEffect(() => {
    if (employee?.location?.id) {
      loadReport()
    }
  }, [employee?.location?.id])

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Gratuity Report"
        subtitle="Auto-gratuity tracking by employee and date"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
        actions={
          <div className="flex items-center gap-4">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 border rounded-lg"
            />
            <span className="text-gray-900">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 border rounded-lg"
            />
            <Button variant="primary" onClick={loadReport}>
              Load Report
            </Button>
            {report && (
              <>
                <Button variant="outline" onClick={() => exportGratuityCSV(report, startDate, endDate)}>
                  Export CSV
                </Button>
                <Button variant="outline" onClick={() => window.print()}>
                  Print
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="max-w-5xl mx-auto print:p-0 print:max-w-none">
        <WebReportBanner
          startDate={startDate}
          endDate={endDate}
          reportType="gratuity"
          retentionDays={retentionDays}
          venueSlug={venueSlug}
        />

        {isLoading ? (
          <div className="text-center py-12 text-gray-900">Loading report...</div>
        ) : !report ? (
          <div className="text-center py-12 text-gray-900">
            Select a date range and click Load Report
          </div>
        ) : (
          <div className="space-y-4 print:space-y-3">
            {/* Settings Banner */}
            <Card className="print:shadow-none print:border">
              <CardContent className="py-4">
                <div className="flex items-center gap-6 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-2 h-2 rounded-full ${report.settings.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <span className="text-gray-900">
                      Auto-gratuity: {report.settings.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  {report.settings.enabled && (
                    <>
                      <span className="text-gray-900">
                        Rate: <span className="font-semibold">{report.settings.percent}%</span>
                      </span>
                      <span className="text-gray-900">
                        Min party: <span className="font-semibold">{report.settings.minimumPartySize}+ guests</span>
                      </span>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 print:grid-cols-4">
              <Card className="print:shadow-none print:border">
                <CardContent className="p-4 text-center">
                  <p className="text-sm text-gray-900">Total Orders</p>
                  <p className="text-2xl font-bold">{report.summary.totalOrders}</p>
                </CardContent>
              </Card>
              <Card className="print:shadow-none print:border">
                <CardContent className="p-4 text-center">
                  <p className="text-sm text-gray-900">Total Gratuity</p>
                  <p className="text-2xl font-bold text-green-600">{formatCurrency(report.summary.totalGratuity)}</p>
                </CardContent>
              </Card>
              <Card className="print:shadow-none print:border">
                <CardContent className="p-4 text-center">
                  <p className="text-sm text-gray-900">Total Sales</p>
                  <p className="text-2xl font-bold">{formatCurrency(report.summary.totalOrderValue)}</p>
                </CardContent>
              </Card>
              <Card className="print:shadow-none print:border">
                <CardContent className="p-4 text-center">
                  <p className="text-sm text-gray-900">Avg Gratuity %</p>
                  <p className="text-2xl font-bold text-indigo-600">{report.summary.avgGratuityPercent.toFixed(1)}%</p>
                </CardContent>
              </Card>
            </div>

            {/* Detail Table */}
            <Card className="print:shadow-none print:border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Gratuity by Employee</CardTitle>
              </CardHeader>
              <CardContent>
                {report.rows.length === 0 ? (
                  <p className="text-gray-900 text-sm py-6 text-center">
                    No auto-gratuity transactions found for this date range
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm font-mono">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-2 pr-4 font-semibold text-gray-900">Employee</th>
                          <th className="text-left py-2 pr-4 font-semibold text-gray-900">Date</th>
                          <th className="text-right py-2 pr-4 font-semibold text-gray-900">Orders</th>
                          <th className="text-right py-2 pr-4 font-semibold text-gray-900">Total Gratuity</th>
                          <th className="text-right py-2 pr-4 font-semibold text-gray-900">Avg %</th>
                          <th className="text-right py-2 pr-4 font-semibold text-gray-900">Total Sales</th>
                          <th className="text-right py-2 font-semibold text-gray-900">Avg Party</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.rows.map((row, idx) => (
                          <tr key={`${row.employeeId}-${row.date}-${idx}`} className="border-b border-gray-100">
                            <td className="py-2 pr-4">{row.employeeName}</td>
                            <td className="py-2 pr-4 text-gray-900">
                              {new Date(row.date + 'T12:00:00').toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </td>
                            <td className="py-2 pr-4 text-right">{row.orderCount}</td>
                            <td className="py-2 pr-4 text-right text-green-600 font-semibold">
                              {formatCurrency(row.totalGratuity)}
                            </td>
                            <td className="py-2 pr-4 text-right">{row.avgGratuityPercent.toFixed(1)}%</td>
                            <td className="py-2 pr-4 text-right">{formatCurrency(row.totalOrderValue)}</td>
                            <td className="py-2 text-right">{row.avgPartySize.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-gray-300 font-bold">
                          <td className="py-2 pr-4">Totals</td>
                          <td className="py-2 pr-4"></td>
                          <td className="py-2 pr-4 text-right">{report.summary.totalOrders}</td>
                          <td className="py-2 pr-4 text-right text-green-600">
                            {formatCurrency(report.summary.totalGratuity)}
                          </td>
                          <td className="py-2 pr-4 text-right">{report.summary.avgGratuityPercent.toFixed(1)}%</td>
                          <td className="py-2 pr-4 text-right">{formatCurrency(report.summary.totalOrderValue)}</td>
                          <td className="py-2 text-right"></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Footer */}
            <div className="text-center text-xs text-gray-900 pt-2">
              Generated {new Date().toLocaleString()}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
