'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

// ——— Types ———

interface ParItem {
  id: string
  name: string
  sku: string | null
  department: string
  category: string
  unit: string
  purchaseUnit: string
  currentStock: number
  parLevel: number | null
  reorderPoint: number | null
  reorderQty: number | null
  belowPar: boolean
  belowReorder: boolean
  suggestedOrder: number
  usageRate: number
  daysUntilReorder: number | null
  lastCountDate: string | null
  costPerUnit: number
  suggestedOrderCost: number
}

interface ParSummary {
  totalItems: number
  belowPar: number
  belowReorder: number
  criticalItems: number
  totalSuggestedOrderCost: number
}

interface VarianceItem {
  id: string
  name: string
  sku: string | null
  department: string
  category: string
  unit: string
  expectedUsage: number
  actualUsage: number
  variance: number
  variancePercent: number
  varianceCost: number
  status: 'ok' | 'warning' | 'high_variance'
}

interface VarianceSummary {
  totalItems: number
  ok: number
  warning: number
  highVariance: number
  totalVarianceCost: number
}

type SortField = 'name' | 'currentStock' | 'parLevel' | 'suggestedOrder' | 'usageRate' | 'daysUntilReorder'
type SortDir = 'asc' | 'desc'

// ——— Helpers ———

function stockStatusColor(item: ParItem): string {
  if (item.belowReorder) return 'bg-red-50 border-l-4 border-red-500'
  if (item.belowPar) return 'bg-amber-50 border-l-4 border-amber-500'
  return ''
}

function stockBadge(item: ParItem): { label: string; className: string } {
  if (item.daysUntilReorder !== null && item.daysUntilReorder <= 1 && item.belowReorder) {
    return { label: 'Critical', className: 'bg-red-600 text-white' }
  }
  if (item.belowReorder) return { label: 'Reorder', className: 'bg-red-100 text-red-700' }
  if (item.belowPar) return { label: 'Low', className: 'bg-amber-100 text-amber-700' }
  return { label: 'OK', className: 'bg-green-100 text-green-700' }
}

function varianceStatusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case 'high_variance':
      return { label: 'High Variance', className: 'bg-red-100 text-red-700' }
    case 'warning':
      return { label: 'Warning', className: 'bg-amber-100 text-amber-700' }
    default:
      return { label: 'OK', className: 'bg-green-100 text-green-700' }
  }
}

function exportParCSV(items: ParItem[]) {
  const header = [
    'Item Name', 'SKU', 'Department', 'Category', 'Unit', 'Current Stock',
    'PAR Level', 'Reorder Point', 'Below PAR', 'Below Reorder',
    'Suggested Order', 'Usage Rate (daily)', 'Days Until Reorder',
    'Last Count Date', 'Cost/Unit', 'Suggested Order Cost',
  ].join(',')

  const rows = items.map(item =>
    [
      `"${item.name}"`,
      `"${item.sku || ''}"`,
      `"${item.department}"`,
      `"${item.category}"`,
      `"${item.unit}"`,
      item.currentStock.toFixed(2),
      item.parLevel?.toFixed(2) ?? '',
      item.reorderPoint?.toFixed(2) ?? '',
      item.belowPar ? 'Yes' : 'No',
      item.belowReorder ? 'Yes' : 'No',
      item.suggestedOrder.toFixed(2),
      item.usageRate.toFixed(2),
      item.daysUntilReorder?.toFixed(1) ?? 'N/A',
      item.lastCountDate || '',
      item.costPerUnit.toFixed(2),
      item.suggestedOrderCost.toFixed(2),
    ].join(',')
  )

  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `par-report-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function exportVarianceCSV(items: VarianceItem[], days: number) {
  const header = [
    'Item Name', 'SKU', 'Department', 'Category', 'Unit',
    'Expected Usage', 'Actual Usage', 'Variance', 'Variance %',
    'Variance Cost', 'Status',
  ].join(',')

  const rows = items.map(item =>
    [
      `"${item.name}"`,
      `"${item.sku || ''}"`,
      `"${item.department}"`,
      `"${item.category}"`,
      `"${item.unit}"`,
      item.expectedUsage.toFixed(2),
      item.actualUsage.toFixed(2),
      item.variance.toFixed(2),
      item.variancePercent.toFixed(1),
      item.varianceCost.toFixed(2),
      item.status,
    ].join(',')
  )

  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `inventory-variance-${days}d-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ——— Page Component ———

export default function InventoryParReportPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/inventory' })
  const employee = useAuthStore(s => s.employee)

  const [activeTab, setActiveTab] = useState<'par' | 'variance'>('par')

  // PAR State
  const [parItems, setParItems] = useState<ParItem[]>([])
  const [parSummary, setParSummary] = useState<ParSummary | null>(null)
  const [parLoading, setParLoading] = useState(true)
  const [parFilter, setParFilter] = useState<'all' | 'belowPar' | 'belowReorder'>('all')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Variance State
  const [varianceItems, setVarianceItems] = useState<VarianceItem[]>([])
  const [varianceSummary, setVarianceSummary] = useState<VarianceSummary | null>(null)
  const [varianceLoading, setVarianceLoading] = useState(false)
  const [varianceDays, setVarianceDays] = useState(7)

  // ——— PAR Loading ———
  const loadPar = useCallback(async () => {
    if (!employee?.location?.id) return
    setParLoading(true)
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        employeeId: employee.id,
      })
      if (parFilter === 'belowPar') params.set('belowParOnly', 'true')
      if (parFilter === 'belowReorder') params.set('belowReorderOnly', 'true')

      const response = await fetch(`/api/reports/inventory/par?${params}`)
      if (response.ok) {
        const json = await response.json()
        setParItems(json.data.items)
        setParSummary(json.data.summary)
      }
    } catch (error) {
      console.error('Failed to load PAR report:', error)
    } finally {
      setParLoading(false)
    }
  }, [employee?.location?.id, employee?.id, parFilter])

  // ——— Variance Loading ———
  const loadVariance = useCallback(async () => {
    if (!employee?.location?.id) return
    setVarianceLoading(true)
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        employeeId: employee.id,
        days: String(varianceDays),
      })

      const response = await fetch(`/api/reports/inventory/variance?${params}`)
      if (response.ok) {
        const json = await response.json()
        setVarianceItems(json.data.items)
        setVarianceSummary(json.data.summary)
      }
    } catch (error) {
      console.error('Failed to load variance report:', error)
    } finally {
      setVarianceLoading(false)
    }
  }, [employee?.location?.id, employee?.id, varianceDays])

  // Load PAR on mount
  useEffect(() => {
    if (employee?.location?.id) {
      loadPar()
    }
  }, [employee?.location?.id, parFilter])

  // Load variance when tab switches or days change
  useEffect(() => {
    if (activeTab === 'variance' && employee?.location?.id && varianceItems.length === 0) {
      loadVariance()
    }
  }, [activeTab, employee?.location?.id])

  // ——— Sorting ———
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const sortedParItems = [...parItems].sort((a, b) => {
    const mult = sortDir === 'asc' ? 1 : -1
    switch (sortField) {
      case 'name': return mult * a.name.localeCompare(b.name)
      case 'currentStock': return mult * (a.currentStock - b.currentStock)
      case 'parLevel': return mult * ((a.parLevel ?? 0) - (b.parLevel ?? 0))
      case 'suggestedOrder': return mult * (a.suggestedOrder - b.suggestedOrder)
      case 'usageRate': return mult * (a.usageRate - b.usageRate)
      case 'daysUntilReorder': return mult * ((a.daysUntilReorder ?? 999) - (b.daysUntilReorder ?? 999))
      default: return 0
    }
  })

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return null
    return sortDir === 'asc' ? ' \u2191' : ' \u2193'
  }

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Inventory PAR Report"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
      />

      <div className="max-w-7xl mx-auto">
        {/* Tab Selector */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab('par')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'par'
                ? 'bg-white shadow text-gray-900'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            PAR Status
          </button>
          <button
            onClick={() => setActiveTab('variance')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'variance'
                ? 'bg-white shadow text-gray-900'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Variance Report
          </button>
        </div>

        {/* ========== PAR TAB ========== */}
        {activeTab === 'par' && (
          <>
            {/* Filter Bar */}
            <Card className="mb-6">
              <CardContent className="p-4">
                <div className="flex flex-wrap gap-4 items-center">
                  <div className="flex gap-2">
                    {(['all', 'belowPar', 'belowReorder'] as const).map(filter => (
                      <button
                        key={filter}
                        onClick={() => setParFilter(filter)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                          parFilter === filter
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {filter === 'all' ? 'All Items' : filter === 'belowPar' ? 'Below PAR' : 'Below Reorder'}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1" />
                  <Button variant="outline" onClick={() => loadPar()} disabled={parLoading}>
                    {parLoading ? 'Loading...' : 'Refresh'}
                  </Button>
                  {parItems.length > 0 && (
                    <Button variant="outline" onClick={() => exportParCSV(sortedParItems)}>
                      Export CSV
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Summary Cards */}
            {parSummary && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500">Total Tracked</p>
                    <p className="text-2xl font-bold text-gray-900">{parSummary.totalItems}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500">Below PAR</p>
                    <p className="text-2xl font-bold text-amber-600">{parSummary.belowPar}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500">Below Reorder</p>
                    <p className="text-2xl font-bold text-red-600">{parSummary.belowReorder}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500">Critical</p>
                    <p className={`text-2xl font-bold ${parSummary.criticalItems > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {parSummary.criticalItems}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500">Est. Order Cost</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {formatCurrency(parSummary.totalSuggestedOrderCost)}
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* PAR Table */}
            <Card>
              <CardHeader>
                <CardTitle>PAR Status Detail</CardTitle>
              </CardHeader>
              <CardContent>
                {parLoading ? (
                  <div className="text-center py-8 text-gray-500">Loading PAR data...</div>
                ) : sortedParItems.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No tracked inventory items found. Configure PAR levels on inventory items to use this report.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-3 text-left text-sm font-medium text-gray-700">Status</th>
                          <th
                            className="px-3 py-3 text-left text-sm font-medium text-gray-700 cursor-pointer hover:text-blue-600"
                            onClick={() => handleSort('name')}
                          >
                            Item{sortIcon('name')}
                          </th>
                          <th className="px-3 py-3 text-left text-sm font-medium text-gray-700">Category</th>
                          <th
                            className="px-3 py-3 text-right text-sm font-medium text-gray-700 cursor-pointer hover:text-blue-600"
                            onClick={() => handleSort('currentStock')}
                          >
                            Stock{sortIcon('currentStock')}
                          </th>
                          <th
                            className="px-3 py-3 text-right text-sm font-medium text-gray-700 cursor-pointer hover:text-blue-600"
                            onClick={() => handleSort('parLevel')}
                          >
                            PAR{sortIcon('parLevel')}
                          </th>
                          <th className="px-3 py-3 text-right text-sm font-medium text-gray-700">Reorder Pt</th>
                          <th
                            className="px-3 py-3 text-right text-sm font-medium text-gray-700 cursor-pointer hover:text-blue-600"
                            onClick={() => handleSort('suggestedOrder')}
                          >
                            Suggested Order{sortIcon('suggestedOrder')}
                          </th>
                          <th
                            className="px-3 py-3 text-right text-sm font-medium text-gray-700 cursor-pointer hover:text-blue-600"
                            onClick={() => handleSort('usageRate')}
                          >
                            Daily Usage{sortIcon('usageRate')}
                          </th>
                          <th
                            className="px-3 py-3 text-right text-sm font-medium text-gray-700 cursor-pointer hover:text-blue-600"
                            onClick={() => handleSort('daysUntilReorder')}
                          >
                            Days to Reorder{sortIcon('daysUntilReorder')}
                          </th>
                          <th className="px-3 py-3 text-right text-sm font-medium text-gray-700">Last Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedParItems.map(item => {
                          const badge = stockBadge(item)
                          return (
                            <tr key={item.id} className={`border-t hover:bg-gray-50 ${stockStatusColor(item)}`}>
                              <td className="px-3 py-3">
                                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                                  {badge.label}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                <div>
                                  <span className="font-medium">{item.name}</span>
                                  {item.sku && <span className="text-xs text-gray-500 ml-2">{item.sku}</span>}
                                </div>
                              </td>
                              <td className="px-3 py-3 text-sm text-gray-600">{item.category}</td>
                              <td className={`px-3 py-3 text-right text-sm font-medium ${
                                item.belowReorder ? 'text-red-600' : item.belowPar ? 'text-amber-600' : 'text-gray-900'
                              }`}>
                                {item.currentStock} {item.unit}
                              </td>
                              <td className="px-3 py-3 text-right text-sm text-gray-600">
                                {item.parLevel !== null ? item.parLevel : '--'}
                              </td>
                              <td className="px-3 py-3 text-right text-sm text-gray-600">
                                {item.reorderPoint !== null ? item.reorderPoint : '--'}
                              </td>
                              <td className="px-3 py-3 text-right text-sm">
                                {item.suggestedOrder > 0 ? (
                                  <span className="font-medium text-blue-600">
                                    {item.suggestedOrder} {item.unit}
                                  </span>
                                ) : (
                                  <span className="text-gray-400">--</span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-right text-sm text-gray-600">
                                {item.usageRate > 0 ? `${item.usageRate}/day` : '--'}
                              </td>
                              <td className="px-3 py-3 text-right text-sm">
                                {item.daysUntilReorder !== null ? (
                                  <span className={
                                    item.daysUntilReorder <= 1 ? 'text-red-600 font-bold' :
                                    item.daysUntilReorder <= 3 ? 'text-amber-600 font-medium' :
                                    'text-gray-600'
                                  }>
                                    {item.daysUntilReorder === 0 ? 'Now' : `${item.daysUntilReorder}d`}
                                  </span>
                                ) : (
                                  <span className="text-gray-400">--</span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-right text-sm text-gray-500">
                                {item.lastCountDate || 'Never'}
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
            {sortedParItems.length > 0 && (
              <div className="mt-4 p-4 bg-white border border-gray-200 rounded-xl">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Status Legend</h3>
                <div className="flex gap-4 text-sm">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-green-500" />
                    OK -- At or above PAR
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-amber-500" />
                    Low -- Below PAR level
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-red-500" />
                    Reorder -- Below reorder point
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-red-700" />
                    Critical -- Reorder needed within 24h
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        {/* ========== VARIANCE TAB ========== */}
        {activeTab === 'variance' && (
          <>
            {/* Filter Bar */}
            <Card className="mb-6">
              <CardContent className="p-4">
                <div className="flex flex-wrap gap-4 items-end">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Period</label>
                    <div className="flex gap-2">
                      {([7, 14, 30] as const).map(d => (
                        <button
                          key={d}
                          onClick={() => setVarianceDays(d)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                            varianceDays === d
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {d}d
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button variant="primary" onClick={loadVariance} disabled={varianceLoading}>
                    {varianceLoading ? 'Loading...' : 'Apply'}
                  </Button>
                  {varianceItems.length > 0 && (
                    <Button variant="outline" onClick={() => exportVarianceCSV(varianceItems, varianceDays)}>
                      Export CSV
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Summary Cards */}
            {varianceSummary && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500">Total Items</p>
                    <p className="text-2xl font-bold text-gray-900">{varianceSummary.totalItems}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500">OK</p>
                    <p className="text-2xl font-bold text-green-600">{varianceSummary.ok}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500">Warning (&gt;10%)</p>
                    <p className="text-2xl font-bold text-amber-600">{varianceSummary.warning}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500">High Variance (&gt;25%)</p>
                    <p className="text-2xl font-bold text-red-600">{varianceSummary.highVariance}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500">Total Variance Cost</p>
                    <p className={`text-2xl font-bold ${varianceSummary.totalVarianceCost > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {varianceSummary.totalVarianceCost > 0 ? '' : '-'}{formatCurrency(Math.abs(varianceSummary.totalVarianceCost))}
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Variance Table */}
            <Card>
              <CardHeader>
                <CardTitle>Expected vs Actual Usage</CardTitle>
              </CardHeader>
              <CardContent>
                {varianceLoading ? (
                  <div className="text-center py-8 text-gray-500">Loading variance data...</div>
                ) : varianceItems.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No usage data found for the selected period. Ensure items have recipes linked and orders are being placed.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-3 text-left text-sm font-medium text-gray-700">Item</th>
                          <th className="px-3 py-3 text-left text-sm font-medium text-gray-700">Category</th>
                          <th className="px-3 py-3 text-right text-sm font-medium text-gray-700">Expected</th>
                          <th className="px-3 py-3 text-right text-sm font-medium text-gray-700">Actual</th>
                          <th className="px-3 py-3 text-right text-sm font-medium text-gray-700">Variance</th>
                          <th className="px-3 py-3 text-right text-sm font-medium text-gray-700">Var %</th>
                          <th className="px-3 py-3 text-right text-sm font-medium text-gray-700">Var Cost</th>
                          <th className="px-3 py-3 text-center text-sm font-medium text-gray-700">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {varianceItems.map(item => {
                          const badge = varianceStatusBadge(item.status)
                          return (
                            <tr
                              key={item.id}
                              className={`border-t hover:bg-gray-50 ${
                                item.status === 'high_variance' ? 'bg-red-50' :
                                item.status === 'warning' ? 'bg-amber-50' : ''
                              }`}
                            >
                              <td className="px-3 py-3">
                                <div>
                                  <span className="font-medium">{item.name}</span>
                                  {item.sku && <span className="text-xs text-gray-500 ml-2">{item.sku}</span>}
                                </div>
                              </td>
                              <td className="px-3 py-3 text-sm text-gray-600">{item.category}</td>
                              <td className="px-3 py-3 text-right text-sm">{item.expectedUsage.toFixed(1)} {item.unit}</td>
                              <td className="px-3 py-3 text-right text-sm">{item.actualUsage.toFixed(1)} {item.unit}</td>
                              <td className={`px-3 py-3 text-right text-sm font-medium ${
                                item.variance < 0 ? 'text-red-600' : item.variance > 0 ? 'text-green-600' : ''
                              }`}>
                                {item.variance > 0 ? '+' : ''}{item.variance.toFixed(1)}
                              </td>
                              <td className="px-3 py-3 text-right">
                                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                                  Math.abs(item.variancePercent) > 25 ? 'bg-red-100 text-red-700' :
                                  Math.abs(item.variancePercent) > 10 ? 'bg-amber-100 text-amber-700' :
                                  'bg-green-100 text-green-700'
                                }`}>
                                  {item.variancePercent > 0 ? '+' : ''}{item.variancePercent.toFixed(1)}%
                                </span>
                              </td>
                              <td className={`px-3 py-3 text-right text-sm font-medium ${
                                item.varianceCost > 0 ? 'text-red-600' : item.varianceCost < 0 ? 'text-green-600' : ''
                              }`}>
                                {item.varianceCost > 0 ? '' : item.varianceCost < 0 ? '-' : ''}{formatCurrency(Math.abs(item.varianceCost))}
                              </td>
                              <td className="px-3 py-3 text-center">
                                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                                  {badge.label}
                                </span>
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
            {varianceItems.length > 0 && (
              <div className="mt-4 p-4 bg-white border border-gray-200 rounded-xl">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Variance Thresholds</h3>
                <div className="flex gap-4 text-sm">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-green-500" />
                    Under 10% -- OK
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-amber-500" />
                    10-25% -- Warning
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-red-500" />
                    Over 25% -- High Variance
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Positive variance % means actual usage exceeded expected (recipe-based) usage. Investigate for waste, over-portioning, or theft.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
