'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface VarianceItem {
  inventoryItemId: string
  name: string
  sku: string | null
  category: string
  unit: string
  beginningStock: number
  purchases: number
  theoreticalUsage: number
  theoreticalEnding: number
  actualEnding: number
  variance: number
  variancePercent: number
  varianceCost: number
  costPerUnit: number
}

interface VarianceSummary {
  totalItems: number
  totalTheoreticalCost: number
  totalVarianceCost: number
  overallVariancePercent: number
  itemsWithVariance: number
  itemsOverTheoretical: number
  itemsUnderTheoretical: number
}

interface VarianceReport {
  report: {
    locationId: string
    startDate: string
    endDate: string
    department: string
    category: string
    items: VarianceItem[]
    summary: VarianceSummary
  }
}

function varianceColor(pct: number): string {
  const abs = Math.abs(pct)
  if (abs > 10) return 'text-red-600 bg-red-50'
  if (abs > 5) return 'text-amber-600 bg-amber-50'
  return 'text-green-600 bg-green-50'
}

function varianceBadge(pct: number): { label: string; className: string } {
  const abs = Math.abs(pct)
  if (abs > 10) return { label: 'High', className: 'bg-red-100 text-red-700' }
  if (abs > 5) return { label: 'Moderate', className: 'bg-amber-100 text-amber-700' }
  return { label: 'Low', className: 'bg-green-100 text-green-700' }
}

function exportVarianceCSV(items: VarianceItem[], startDate: string, endDate: string) {
  const header = [
    'Item Name', 'SKU', 'Category', 'Unit', 'Beginning Stock', 'Purchases',
    'Theoretical Usage', 'Theoretical Ending', 'Actual Ending',
    'Variance', 'Variance %', 'Cost/Unit', 'Variance Cost',
  ].join(',')

  const rows = items.map((item) =>
    [
      `"${item.name}"`,
      `"${item.sku || ''}"`,
      `"${item.category}"`,
      `"${item.unit}"`,
      item.beginningStock.toFixed(2),
      item.purchases.toFixed(2),
      item.theoreticalUsage.toFixed(2),
      item.theoreticalEnding.toFixed(2),
      item.actualEnding.toFixed(2),
      item.variance.toFixed(2),
      item.variancePercent.toFixed(1),
      item.costPerUnit.toFixed(2),
      item.varianceCost.toFixed(2),
    ].join(',')
  )

  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `variance-report-${startDate}-to-${endDate}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function VarianceReportPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/variance' })
  const employee = useAuthStore(s => s.employee)

  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0])
  const [report, setReport] = useState<VarianceReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadReport = useCallback(async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        employeeId: employee.id,
        startDate,
        endDate,
      })
      const response = await fetch(`/api/reports/variance?${params}`)
      if (response.ok) {
        const json = await response.json()
        setReport(json.data)
      }
    } catch (error) {
      console.error('Failed to load variance report:', error)
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

  const items = report?.report.items ?? []
  const summary = report?.report.summary

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Food Cost / Variance Report"
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
              {items.length > 0 && (
                <Button variant="outline" onClick={() => exportVarianceCSV(items, startDate, endDate)}>
                  Export CSV
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Items with Variance</p>
                <p className="text-2xl font-bold text-gray-900">{summary.itemsWithVariance}</p>
                <p className="text-xs text-gray-400">of {summary.totalItems} tracked</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total Variance Cost</p>
                <p className={`text-2xl font-bold ${summary.totalVarianceCost < 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {formatCurrency(Math.abs(summary.totalVarianceCost))}
                </p>
                <p className="text-xs text-gray-400">{summary.totalVarianceCost < 0 ? 'shrinkage' : 'surplus'}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Overall Variance %</p>
                <p className={`text-2xl font-bold ${Math.abs(summary.overallVariancePercent) > 10 ? 'text-red-600' : Math.abs(summary.overallVariancePercent) > 5 ? 'text-amber-600' : 'text-green-600'}`}>
                  {summary.overallVariancePercent.toFixed(1)}%
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Over Theoretical</p>
                <p className="text-2xl font-bold text-green-600">{summary.itemsOverTheoretical}</p>
                <p className="text-xs text-gray-400">items</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Under Theoretical</p>
                <p className="text-2xl font-bold text-red-600">{summary.itemsUnderTheoretical}</p>
                <p className="text-xs text-gray-400">items (shrinkage)</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Variance Table */}
        <Card>
          <CardHeader>
            <CardTitle>Variance Detail</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-gray-500">Loading variance data...</div>
            ) : items.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No tracked inventory items found for the selected period.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-3 text-left text-sm font-medium text-gray-500">Item</th>
                      <th className="px-3 py-3 text-left text-sm font-medium text-gray-500">Category</th>
                      <th className="px-3 py-3 text-right text-sm font-medium text-gray-500">Begin</th>
                      <th className="px-3 py-3 text-right text-sm font-medium text-gray-500">Purchases</th>
                      <th className="px-3 py-3 text-right text-sm font-medium text-gray-500">Theo. Usage</th>
                      <th className="px-3 py-3 text-right text-sm font-medium text-gray-500">Theo. End</th>
                      <th className="px-3 py-3 text-right text-sm font-medium text-gray-500">Actual End</th>
                      <th className="px-3 py-3 text-right text-sm font-medium text-gray-500">Variance</th>
                      <th className="px-3 py-3 text-right text-sm font-medium text-gray-500">Var %</th>
                      <th className="px-3 py-3 text-right text-sm font-medium text-gray-500">Var Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const badge = varianceBadge(item.variancePercent)
                      return (
                        <tr key={item.inventoryItemId} className="border-t hover:bg-gray-50">
                          <td className="px-3 py-3">
                            <div>
                              <span className="font-medium">{item.name}</span>
                              {item.sku && <span className="text-xs text-gray-400 ml-2">{item.sku}</span>}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-gray-500 text-sm">{item.category}</td>
                          <td className="px-3 py-3 text-right text-sm">{item.beginningStock.toFixed(1)} {item.unit}</td>
                          <td className="px-3 py-3 text-right text-sm">{item.purchases.toFixed(1)}</td>
                          <td className="px-3 py-3 text-right text-sm">{item.theoreticalUsage.toFixed(1)}</td>
                          <td className="px-3 py-3 text-right text-sm">{item.theoreticalEnding.toFixed(1)}</td>
                          <td className="px-3 py-3 text-right text-sm font-medium">{item.actualEnding.toFixed(1)}</td>
                          <td className={`px-3 py-3 text-right text-sm font-medium ${item.variance < 0 ? 'text-red-600' : item.variance > 0 ? 'text-green-600' : ''}`}>
                            {item.variance > 0 ? '+' : ''}{item.variance.toFixed(1)}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                              {item.variancePercent.toFixed(1)}%
                            </span>
                          </td>
                          <td className={`px-3 py-3 text-right text-sm font-medium ${item.varianceCost < 0 ? 'text-red-600' : item.varianceCost > 0 ? 'text-green-600' : ''}`}>
                            {item.varianceCost < 0 ? '-' : ''}{formatCurrency(Math.abs(item.varianceCost))}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Color Legend */}
        {items.length > 0 && (
          <div className="mt-4 p-4 bg-white border border-gray-200 rounded-xl">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Variance Thresholds</h3>
            <div className="flex gap-4 text-sm">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-green-500" />
                Under 5% — Low
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-amber-500" />
                5-10% — Moderate
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-red-500" />
                Over 10% — High
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
