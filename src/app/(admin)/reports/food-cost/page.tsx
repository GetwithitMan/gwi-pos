'use client'

import { useState, useEffect } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'

interface CategoryRow {
  categoryId: string
  categoryName: string
  categoryType: string
  revenue: number
  cost: number
  foodCostPct: number
  grossProfit: number
  itemCount: number
}

interface ItemRow {
  menuItemId: string
  menuItemName: string
  categoryName: string
  qtySold: number
  revenue: number
  unitPrice: number
  unitCost: number
  totalCost: number
  foodCostPct: number
  grossProfit: number
  contributionMargin: number
  hasCostData: boolean
}

interface ReportData {
  summary: {
    totalRevenue: number
    totalCost: number
    foodCostPct: number
    grossProfit: number
    grossMargin: number
    itemsWithCost: number
    itemsWithoutCost: number
    coveragePercent: number
  }
  byCategory: CategoryRow[]
  byItem: ItemRow[]
  dateRange: { start: string; end: string }
}

function costColor(pct: number): string {
  if (pct < 25) return 'text-green-600'
  if (pct <= 35) return 'text-yellow-600'
  return 'text-red-600'
}

function costBg(pct: number): string {
  if (pct < 25) return 'bg-green-100 border-green-200'
  if (pct <= 35) return 'bg-yellow-100 border-yellow-200'
  return 'bg-red-100 border-red-200'
}

function exportCSV(report: ReportData) {
  const header = ['Item', 'Category', 'Qty Sold', 'Revenue', 'Unit Cost', 'Total Cost', 'Food Cost %', 'Gross Profit', 'Has Cost'].join(',')
  const rows = report.byItem.map(it =>
    [`"${it.menuItemName}"`, `"${it.categoryName}"`, it.qtySold, it.revenue.toFixed(2), it.unitCost.toFixed(2), it.totalCost.toFixed(2), it.foodCostPct.toFixed(1), it.grossProfit.toFixed(2), it.hasCostData].join(',')
  )
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `food-cost-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function FoodCostReportPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/food-cost' })
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id

  const [report, setReport] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [groupBy, setGroupBy] = useState<'category' | 'item'>('category')
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0])

  useEffect(() => {
    if (locationId) fetchReport()
  }, [startDate, endDate, locationId])

  async function fetchReport() {
    if (!locationId) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/reports/food-cost?locationId=${locationId}&startDate=${startDate}&endDate=${endDate}&employeeId=${employee?.id}`
      )
      const data = await res.json()
      setReport(data.data)
    } catch (error) {
      console.error('Failed to fetch food cost report:', error)
    } finally {
      setLoading(false)
    }
  }

  if (!hydrated) return null

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600">Loading report...</div>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600">No data available</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Food Cost Analysis"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
      />

      <div className="max-w-7xl mx-auto">
        {/* Controls */}
        <div className="flex gap-4 mb-6 items-center flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-gray-600 text-sm font-medium">From:</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-gray-600 text-sm font-medium">To:</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setGroupBy('category')}
              className={`px-4 py-2 rounded-lg font-medium ${groupBy === 'category' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
              By Category
            </button>
            <button onClick={() => setGroupBy('item')}
              className={`px-4 py-2 rounded-lg font-medium ${groupBy === 'item' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
              By Item
            </button>
          </div>
          {report.byItem.length > 0 && (
            <button onClick={() => exportCSV(report)}
              className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 font-medium ml-auto">
              Export CSV
            </button>
          )}
        </div>

        {/* Warning banner for missing cost data */}
        {report.summary.itemsWithoutCost > 0 && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div>
              <p className="font-medium text-amber-800">{report.summary.itemsWithoutCost} items missing cost data</p>
              <p className="text-sm text-amber-700 mt-1">
                Add recipes in Menu Builder to improve accuracy. Currently {report.summary.coveragePercent.toFixed(0)}% of revenue has cost data.
              </p>
            </div>
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className={`rounded-lg shadow p-4 border ${costBg(report.summary.foodCostPct)}`}>
            <div className="text-gray-600 text-sm">Food Cost %</div>
            <div className={`text-3xl font-bold ${costColor(report.summary.foodCostPct)}`}>
              {report.summary.foodCostPct.toFixed(1)}%
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
            <div className="text-gray-500 text-sm">Total Revenue</div>
            <div className="text-2xl font-bold text-gray-900">${report.summary.totalRevenue.toFixed(2)}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
            <div className="text-gray-500 text-sm">Total COGS</div>
            <div className="text-2xl font-bold text-gray-900">${report.summary.totalCost.toFixed(2)}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
            <div className="text-gray-500 text-sm">Gross Profit</div>
            <div className="text-2xl font-bold text-green-600">${report.summary.grossProfit.toFixed(2)}</div>
          </div>
        </div>

        {/* By Category Table */}
        {groupBy === 'category' && (
          <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-4 text-gray-700 font-semibold">Category</th>
                  <th className="text-right p-4 text-gray-700 font-semibold">Items</th>
                  <th className="text-right p-4 text-gray-700 font-semibold">Revenue</th>
                  <th className="text-right p-4 text-gray-700 font-semibold">COGS</th>
                  <th className="text-right p-4 text-gray-700 font-semibold">Food Cost %</th>
                  <th className="text-right p-4 text-gray-700 font-semibold">Profit</th>
                </tr>
              </thead>
              <tbody>
                {report.byCategory.map(cat => (
                  <tr key={cat.categoryId} className="border-t border-gray-200">
                    <td className="p-4 font-medium text-gray-900">{cat.categoryName}</td>
                    <td className="p-4 text-right text-gray-900">{cat.itemCount}</td>
                    <td className="p-4 text-right text-gray-900">${cat.revenue.toFixed(2)}</td>
                    <td className="p-4 text-right text-gray-900">${cat.cost.toFixed(2)}</td>
                    <td className="p-4 text-right">
                      <span className={`font-semibold ${costColor(cat.foodCostPct)}`}>
                        {cat.foodCostPct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="p-4 text-right text-green-600 font-medium">${cat.grossProfit.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* By Item Table */}
        {groupBy === 'item' && (
          <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-4 text-gray-700 font-semibold">Item</th>
                  <th className="text-left p-4 text-gray-700 font-semibold">Category</th>
                  <th className="text-right p-4 text-gray-700 font-semibold">Qty</th>
                  <th className="text-right p-4 text-gray-700 font-semibold">Revenue</th>
                  <th className="text-right p-4 text-gray-700 font-semibold">Unit Cost</th>
                  <th className="text-right p-4 text-gray-700 font-semibold">Total Cost</th>
                  <th className="text-right p-4 text-gray-700 font-semibold">Food Cost %</th>
                  <th className="text-right p-4 text-gray-700 font-semibold">Profit</th>
                </tr>
              </thead>
              <tbody>
                {report.byItem.map(item => (
                  <tr key={item.menuItemId} className="border-t border-gray-200">
                    <td className="p-4">
                      <span className="font-medium text-gray-900">{item.menuItemName}</span>
                      {!item.hasCostData && (
                        <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">No cost</span>
                      )}
                    </td>
                    <td className="p-4 text-gray-600">{item.categoryName}</td>
                    <td className="p-4 text-right text-gray-900">{item.qtySold}</td>
                    <td className="p-4 text-right text-gray-900">${item.revenue.toFixed(2)}</td>
                    <td className="p-4 text-right text-gray-900">
                      {item.hasCostData ? `$${item.unitCost.toFixed(2)}` : '-'}
                    </td>
                    <td className="p-4 text-right text-gray-900">
                      {item.hasCostData ? `$${item.totalCost.toFixed(2)}` : '-'}
                    </td>
                    <td className="p-4 text-right">
                      {item.hasCostData ? (
                        <span className={`font-semibold ${costColor(item.foodCostPct)}`}>
                          {item.foodCostPct.toFixed(1)}%
                        </span>
                      ) : '-'}
                    </td>
                    <td className="p-4 text-right text-green-600 font-medium">
                      {item.hasCostData ? `$${item.grossProfit.toFixed(2)}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
