'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface VarianceReportItem {
  id: string
  inventoryItemId: string
  itemName: string
  itemSku: string | null
  itemCategory: string
  itemUnit: string
  expectedQty: number
  countedQty: number | null
  variance: number | null
  variancePct: number | null
  varianceValue: number | null
  costPerUnit: number
  isAboveThreshold: boolean
  countDate: string
  countId: string
}

interface VarianceReportSummary {
  totalItemsCounted: number
  itemsWithVariance: number
  itemsAboveThreshold: number
  avgVariancePercent: number
  totalVarianceValue: number
  dateRange: {
    from: string
    to: string
  }
  varianceAlertThreshold: number
}

interface VarianceReport {
  items: VarianceReportItem[]
  summary: VarianceReportSummary
}

function getVarianceBadgeColor(variancePct: number | null, threshold: number): {
  label: string
  className: string
} {
  if (variancePct === null) return { label: 'Not Counted', className: 'bg-gray-100 text-gray-700' }

  const abs = Math.abs(variancePct)
  if (abs > threshold) return { label: 'Alert', className: 'bg-red-100 text-red-700' }
  if (abs > threshold / 2) return { label: 'Warning', className: 'bg-amber-100 text-amber-700' }
  return { label: 'OK', className: 'bg-green-100 text-green-700' }
}

function getVarianceColor(value: number | null): string {
  if (value === null || value === 0) return 'text-gray-600'
  return value < 0 ? 'text-red-600' : 'text-green-600'
}

function exportVarianceCSV(items: VarianceReportItem[], startDate: string, endDate: string) {
  const header = [
    'Count Date',
    'Item Name',
    'SKU',
    'Category',
    'Unit',
    'Expected Qty',
    'Counted Qty',
    'Variance',
    'Variance %',
    'Cost/Unit',
    'Variance Value',
    'Alert',
  ].join(',')

  const rows = items.map(item =>
    [
      item.countDate,
      `"${item.itemName}"`,
      `"${item.itemSku || ''}"`,
      `"${item.itemCategory}"`,
      `"${item.itemUnit}"`,
      item.expectedQty.toFixed(2),
      item.countedQty ? item.countedQty.toFixed(2) : '',
      item.variance ? item.variance.toFixed(2) : '',
      item.variancePct ? item.variancePct.toFixed(2) : '',
      item.costPerUnit.toFixed(2),
      item.varianceValue ? item.varianceValue.toFixed(2) : '',
      item.isAboveThreshold ? 'YES' : 'NO',
    ].join(',')
  )

  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `inventory-count-variance-${startDate}-to-${endDate}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function InventoryCountVarianceReport() {
  const hydrated = useAuthenticationGuard({
    redirectUrl: '/login?redirect=/inventory/counts/variance',
  })
  const employee = useAuthStore(s => s.employee)

  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0])
  const [categoryId, setCategoryId] = useState('')
  const [report, setReport] = useState<VarianceReport | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadReport = useCallback(async () => {
    if (!employee?.location?.id) return

    setIsLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        employeeId: employee.id,
        startDate,
        endDate,
      })

      if (categoryId) {
        params.append('categoryId', categoryId)
      }

      const response = await fetch(`/api/inventory/counts/variance?${params}`)

      if (!response.ok) {
        const json = await response.json()
        setError(json.error || 'Failed to load variance report')
        setReport(null)
        return
      }

      const json = await response.json()
      setReport(json.data)
    } catch (err) {
      console.error('Failed to load variance report:', err)
      setError('An error occurred while loading the report')
      setReport(null)
    } finally {
      setIsLoading(false)
    }
  }, [employee?.location?.id, employee?.id, startDate, endDate, categoryId])

  useEffect(() => {
    if (employee?.location?.id) {
      loadReport()
    }
  }, [employee?.location?.id])

  if (!hydrated) return null

  const items = report?.items ?? []
  const summary = report?.summary

  const alertThreshold = summary?.varianceAlertThreshold ?? 5

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Inventory Count Variance Report"
        breadcrumbs={[
          { label: 'Inventory', href: '/inventory' },
          { label: 'Counts', href: '/inventory/counts' },
        ]}
      />

      <div className="max-w-7xl mx-auto">
        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <Button variant="primary" onClick={loadReport} disabled={isLoading}>
                {isLoading ? 'Loading...' : 'Generate Report'}
              </Button>
              {items.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => exportVarianceCSV(items, startDate, endDate)}
                >
                  Export CSV
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Error Message */}
        {error && (
          <Card className="mb-6 border-red-200 bg-red-50">
            <CardContent className="p-4">
              <p className="text-red-700">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500 font-medium mb-1">Total Items Counted</p>
                <p className="text-2xl font-bold text-gray-900">{summary.totalItemsCounted}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500 font-medium mb-1">Items with Variance</p>
                <p className="text-2xl font-bold text-gray-900">{summary.itemsWithVariance}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500 font-medium mb-1">Items Above Threshold</p>
                <p className="text-2xl font-bold text-red-600">{summary.itemsAboveThreshold}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500 font-medium mb-1">Avg Variance %</p>
                <p className="text-2xl font-bold text-gray-900">{summary.avgVariancePercent.toFixed(1)}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500 font-medium mb-1">Total Variance Value</p>
                <p className={`text-2xl font-bold ${summary.totalVarianceValue < 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {formatCurrency(Math.abs(summary.totalVarianceValue))}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Variance Table */}
        <Card>
          <CardHeader>
            <CardTitle>Variance Details</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-gray-500">Loading variance data...</div>
            ) : items.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                {error ? 'No data available' : 'No inventory counts found for the selected period.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-700">Count Date</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-700">Item Name</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-700">Category</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-700">Expected</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-700">Counted</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-700">Variance</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-700">Var %</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-700">Var Cost</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-700">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => {
                      const badge = getVarianceBadgeColor(item.variancePct, alertThreshold)
                      const varColor = getVarianceColor(item.variance)

                      return (
                        <tr
                          key={item.id}
                          className={`border-t ${item.isAboveThreshold ? 'bg-red-50' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                        >
                          <td className="px-4 py-3 text-gray-900">{item.countDate}</td>
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-medium text-gray-900">{item.itemName}</p>
                              {item.itemSku && (
                                <p className="text-xs text-gray-500">{item.itemSku}</p>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{item.itemCategory}</td>
                          <td className="px-4 py-3 text-right text-gray-900">
                            {item.expectedQty.toFixed(1)} {item.itemUnit}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-900 font-medium">
                            {item.countedQty ? `${item.countedQty.toFixed(1)} ${item.itemUnit}` : '—'}
                          </td>
                          <td className={`px-4 py-3 text-right font-medium ${varColor}`}>
                            {item.variance !== null ? (
                              <>
                                {item.variance > 0 ? '+' : ''}
                                {item.variance.toFixed(1)} {item.itemUnit}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {item.variancePct !== null ? (
                              <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${badge.className}`}>
                                {item.variancePct > 0 ? '+' : ''}
                                {item.variancePct.toFixed(1)}%
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className={`px-4 py-3 text-right font-medium ${varColor}`}>
                            {item.varianceValue !== null
                              ? `${item.varianceValue < 0 ? '-' : ''}${formatCurrency(Math.abs(item.varianceValue))}`
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {item.variancePct !== null ? (
                              <span
                                className={`inline-block px-2 py-1 rounded text-xs font-semibold ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                            ) : (
                              '—'
                            )}
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

        {/* Legend */}
        {items.length > 0 && (
          <Card className="mt-4">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Alert Threshold</h3>
              <p className="text-sm text-gray-600">
                Items are flagged as &quot;Alert&quot; when variance exceeds{' '}
                <span className="font-semibold">{alertThreshold}%</span> (configured in inventory
                settings).
              </p>
              <div className="mt-3 flex gap-4 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span>Below threshold</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-amber-500" />
                  <span>Warning (50-100% of threshold)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <span>Alert (above threshold)</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
