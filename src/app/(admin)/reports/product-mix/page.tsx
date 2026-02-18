'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAuthStore } from '@/stores/auth-store'

interface ProductMixItem {
  menuItemId: string
  name: string
  categoryId: string
  categoryName: string
  quantity: number
  revenue: number
  cost: number
  profit: number
  modifierRevenue: number
  revenuePercent: number
  quantityPercent: number
  profitMargin: number
  avgPrice: number
  orderTypes: Record<string, number>
  hourlyDistribution: Record<number, number>
}

interface CategoryData {
  categoryId: string
  categoryName: string
  itemCount: number
  quantity: number
  revenue: number
  cost: number
  profit: number
  revenuePercent: number
  quantityPercent: number
  profitMargin: number
}

interface Pairing {
  items: [string, string]
  names: [string, string]
  count: number
}

interface ReportData {
  summary: {
    totalRevenue: number
    totalCost: number
    totalProfit: number
    totalQuantity: number
    uniqueItems: number
    avgItemPrice: number
    profitMargin: number
  }
  items: ProductMixItem[]
  categories: CategoryData[]
  hourlyDistribution: Record<number, { quantity: number; revenue: number }>
  topPerformers: {
    byQuantity: ProductMixItem[]
    byRevenue: ProductMixItem[]
    byProfit: ProductMixItem[]
    bottomPerformers: ProductMixItem[]
  }
  pairings: Pairing[]
  dateRange: {
    start: string
    end: string
  }
}

export default function ProductMixReportPage() {
  const router = useRouter()
  const employee = useAuthStore(s => s.employee)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const locationId = employee?.location?.id

  const [report, setReport] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0])
  const [view, setView] = useState<'items' | 'categories' | 'hourly' | 'pairings'>('items')

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/reports/product-mix')
    }
  }, [isAuthenticated, router])

  useEffect(() => {
    if (locationId) {
      fetchReport()
    }
  }, [startDate, endDate, locationId])

  async function fetchReport() {
    if (!locationId) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/reports/product-mix?locationId=${locationId}&startDate=${startDate}&endDate=${endDate}`
      )
      const data = await res.json()
      setReport(data)
    } catch (error) {
      console.error('Failed to fetch report:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading report...</div>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">No data available</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Product Mix Report"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
      />

      <div className="max-w-7xl mx-auto">

      {/* Date Range */}
      <div className="flex gap-4 mb-6 items-center">
        <div className="flex items-center gap-2">
          <label className="text-gray-600 text-sm font-medium">From:</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-gray-600 text-sm font-medium">To:</label>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              const d = new Date()
              d.setDate(d.getDate() - 7)
              setStartDate(d.toISOString().split('T')[0])
              setEndDate(new Date().toISOString().split('T')[0])
            }}
            className="px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
          >
            7 Days
          </button>
          <button
            onClick={() => {
              const d = new Date()
              d.setDate(d.getDate() - 30)
              setStartDate(d.toISOString().split('T')[0])
              setEndDate(new Date().toISOString().split('T')[0])
            }}
            className="px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
          >
            30 Days
          </button>
          <button
            onClick={() => {
              const d = new Date()
              d.setDate(d.getDate() - 90)
              setStartDate(d.toISOString().split('T')[0])
              setEndDate(new Date().toISOString().split('T')[0])
            }}
            className="px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
          >
            90 Days
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <div className="text-gray-500 text-sm">Total Revenue</div>
          <div className="text-2xl font-bold text-gray-900">${report.summary.totalRevenue.toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <div className="text-gray-500 text-sm">Total Cost</div>
          <div className="text-2xl font-bold text-gray-900">${report.summary.totalCost.toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <div className="text-gray-500 text-sm">Gross Profit</div>
          <div className="text-2xl font-bold text-green-600">
            ${report.summary.totalProfit.toFixed(2)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <div className="text-gray-500 text-sm">Items Sold</div>
          <div className="text-2xl font-bold text-gray-900">{report.summary.totalQuantity}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <div className="text-gray-500 text-sm">Profit Margin</div>
          <div className="text-2xl font-bold text-gray-900">{report.summary.profitMargin.toFixed(1)}%</div>
        </div>
      </div>

      {/* View Tabs */}
      <div className="flex gap-2 mb-6">
        {(['items', 'categories', 'hourly', 'pairings'] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-2 rounded-lg capitalize font-medium ${
              view === v
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {v === 'pairings' ? 'Item Pairings' : v}
          </button>
        ))}
      </div>

      {/* Items View */}
      {view === 'items' && (
        <div className="space-y-6">
          {/* Top Performers */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Top by Quantity</h3>
              <div className="space-y-2">
                {report.topPerformers.byQuantity.slice(0, 5).map((item, i) => (
                  <div key={item.menuItemId} className="flex justify-between text-sm">
                    <span className="text-gray-600">
                      {i + 1}. {item.name}
                    </span>
                    <span className="font-semibold text-gray-900">{item.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Top by Revenue</h3>
              <div className="space-y-2">
                {report.topPerformers.byRevenue.slice(0, 5).map((item, i) => (
                  <div key={item.menuItemId} className="flex justify-between text-sm">
                    <span className="text-gray-600">
                      {i + 1}. {item.name}
                    </span>
                    <span className="font-semibold text-gray-900">${item.revenue.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Bottom Performers</h3>
              <div className="space-y-2">
                {report.topPerformers.bottomPerformers.slice(0, 5).map((item, i) => (
                  <div key={item.menuItemId} className="flex justify-between text-sm">
                    <span className="text-gray-600">
                      {i + 1}. {item.name}
                    </span>
                    <span className="font-semibold text-red-600">{item.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Full Items Table */}
          <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-4 text-gray-700 font-semibold">Item</th>
                  <th className="text-left p-4 text-gray-700 font-semibold">Category</th>
                  <th className="text-right p-4 text-gray-700 font-semibold">Qty</th>
                  <th className="text-right p-4 text-gray-700 font-semibold">Revenue</th>
                  <th className="text-right p-4 text-gray-700 font-semibold">Cost</th>
                  <th className="text-right p-4 text-gray-700 font-semibold">Profit</th>
                  <th className="text-right p-4 text-gray-700 font-semibold">Margin</th>
                  <th className="text-right p-4 text-gray-700 font-semibold">% of Sales</th>
                </tr>
              </thead>
              <tbody>
                {report.items.map(item => (
                  <tr key={item.menuItemId} className="border-t border-gray-200">
                    <td className="p-4 font-medium text-gray-900">{item.name}</td>
                    <td className="p-4 text-gray-600">{item.categoryName}</td>
                    <td className="p-4 text-right text-gray-900">{item.quantity}</td>
                    <td className="p-4 text-right text-gray-900">${item.revenue.toFixed(2)}</td>
                    <td className="p-4 text-right text-gray-900">${item.cost.toFixed(2)}</td>
                    <td className="p-4 text-right text-green-600 font-medium">${item.profit.toFixed(2)}</td>
                    <td className="p-4 text-right text-gray-900">{item.profitMargin.toFixed(1)}%</td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-600"
                            style={{ width: `${Math.min(item.revenuePercent, 100)}%` }}
                          />
                        </div>
                        <span className="text-sm text-gray-600">{item.revenuePercent.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Categories View */}
      {view === 'categories' && (
        <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-4 text-gray-700 font-semibold">Category</th>
                <th className="text-right p-4 text-gray-700 font-semibold">Items</th>
                <th className="text-right p-4 text-gray-700 font-semibold">Qty Sold</th>
                <th className="text-right p-4 text-gray-700 font-semibold">Revenue</th>
                <th className="text-right p-4 text-gray-700 font-semibold">Cost</th>
                <th className="text-right p-4 text-gray-700 font-semibold">Profit</th>
                <th className="text-right p-4 text-gray-700 font-semibold">Margin</th>
                <th className="text-right p-4 text-gray-700 font-semibold">% of Sales</th>
              </tr>
            </thead>
            <tbody>
              {report.categories.map(cat => (
                <tr key={cat.categoryId} className="border-t border-gray-200">
                  <td className="p-4 font-medium text-gray-900">{cat.categoryName}</td>
                  <td className="p-4 text-right text-gray-900">{cat.itemCount}</td>
                  <td className="p-4 text-right text-gray-900">{cat.quantity}</td>
                  <td className="p-4 text-right text-gray-900">${cat.revenue.toFixed(2)}</td>
                  <td className="p-4 text-right text-gray-900">${cat.cost.toFixed(2)}</td>
                  <td className="p-4 text-right text-green-600 font-medium">${cat.profit.toFixed(2)}</td>
                  <td className="p-4 text-right text-gray-900">{cat.profitMargin.toFixed(1)}%</td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-600"
                          style={{ width: `${Math.min(cat.revenuePercent, 100)}%` }}
                        />
                      </div>
                      <span className="text-sm text-gray-600">{cat.revenuePercent.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Hourly View */}
      {view === 'hourly' && (
        <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Sales by Hour</h3>
          <div className="space-y-2">
            {Object.entries(report.hourlyDistribution).map(([hour, data]) => {
              const h = parseInt(hour)
              const maxQty = Math.max(...Object.values(report.hourlyDistribution).map(d => d.quantity))
              const pct = maxQty > 0 ? (data.quantity / maxQty) * 100 : 0

              return (
                <div key={hour} className="flex items-center gap-4">
                  <span className="w-16 text-sm text-gray-600 font-medium">
                    {h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`}
                  </span>
                  <div className="flex-1 h-6 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-20 text-right text-sm text-gray-900 font-medium">{data.quantity} items</span>
                  <span className="w-24 text-right text-sm text-gray-600">
                    ${data.revenue.toFixed(2)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Pairings View */}
      {view === 'pairings' && (
        <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Frequently Ordered Together</h3>
          {report.pairings.length === 0 ? (
            <p className="text-gray-500">No significant pairings found</p>
          ) : (
            <div className="space-y-3">
              {report.pairings.map((pairing, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500 font-medium">{i + 1}.</span>
                    <span className="font-medium text-gray-900">{pairing.names[0]}</span>
                    <span className="text-gray-400">+</span>
                    <span className="font-medium text-gray-900">{pairing.names[1]}</span>
                  </div>
                  <span className="text-blue-600 font-semibold">{pairing.count} orders</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  )
}
