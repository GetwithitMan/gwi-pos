'use client'

import { useState, useEffect } from 'react'

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

const LOCATION_ID = 'loc_default'

export default function ProductMixReportPage() {
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
    fetchReport()
  }, [startDate, endDate])

  async function fetchReport() {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/reports/product-mix?locationId=${LOCATION_ID}&startDate=${startDate}&endDate=${endDate}`
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
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Product Mix Report</h1>

      {/* Date Range */}
      <div className="flex gap-4 mb-6 items-center">
        <div className="flex items-center gap-2">
          <label className="text-gray-400">From:</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="px-3 py-2 bg-gray-700 rounded"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-gray-400">To:</label>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="px-3 py-2 bg-gray-700 rounded"
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
            className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600"
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
            className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600"
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
            className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600"
          >
            90 Days
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Total Revenue</div>
          <div className="text-2xl font-bold">${report.summary.totalRevenue.toFixed(2)}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Total Cost</div>
          <div className="text-2xl font-bold">${report.summary.totalCost.toFixed(2)}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Gross Profit</div>
          <div className="text-2xl font-bold text-green-400">
            ${report.summary.totalProfit.toFixed(2)}
          </div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Items Sold</div>
          <div className="text-2xl font-bold">{report.summary.totalQuantity}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Profit Margin</div>
          <div className="text-2xl font-bold">{report.summary.profitMargin.toFixed(1)}%</div>
        </div>
      </div>

      {/* View Tabs */}
      <div className="flex gap-2 mb-6">
        {(['items', 'categories', 'hourly', 'pairings'] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-2 rounded-lg capitalize ${
              view === v ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
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
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-medium mb-3">Top by Quantity</h3>
              <div className="space-y-2">
                {report.topPerformers.byQuantity.slice(0, 5).map((item, i) => (
                  <div key={item.menuItemId} className="flex justify-between text-sm">
                    <span className="text-gray-300">
                      {i + 1}. {item.name}
                    </span>
                    <span className="font-medium">{item.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-medium mb-3">Top by Revenue</h3>
              <div className="space-y-2">
                {report.topPerformers.byRevenue.slice(0, 5).map((item, i) => (
                  <div key={item.menuItemId} className="flex justify-between text-sm">
                    <span className="text-gray-300">
                      {i + 1}. {item.name}
                    </span>
                    <span className="font-medium">${item.revenue.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-medium mb-3">Bottom Performers</h3>
              <div className="space-y-2">
                {report.topPerformers.bottomPerformers.slice(0, 5).map((item, i) => (
                  <div key={item.menuItemId} className="flex justify-between text-sm">
                    <span className="text-gray-300">
                      {i + 1}. {item.name}
                    </span>
                    <span className="font-medium text-red-400">{item.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Full Items Table */}
          <div className="bg-gray-800 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-700">
                <tr>
                  <th className="text-left p-4">Item</th>
                  <th className="text-left p-4">Category</th>
                  <th className="text-right p-4">Qty</th>
                  <th className="text-right p-4">Revenue</th>
                  <th className="text-right p-4">Cost</th>
                  <th className="text-right p-4">Profit</th>
                  <th className="text-right p-4">Margin</th>
                  <th className="text-right p-4">% of Sales</th>
                </tr>
              </thead>
              <tbody>
                {report.items.map(item => (
                  <tr key={item.menuItemId} className="border-t border-gray-700">
                    <td className="p-4 font-medium">{item.name}</td>
                    <td className="p-4 text-gray-400">{item.categoryName}</td>
                    <td className="p-4 text-right">{item.quantity}</td>
                    <td className="p-4 text-right">${item.revenue.toFixed(2)}</td>
                    <td className="p-4 text-right">${item.cost.toFixed(2)}</td>
                    <td className="p-4 text-right text-green-400">${item.profit.toFixed(2)}</td>
                    <td className="p-4 text-right">{item.profitMargin.toFixed(1)}%</td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-2 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500"
                            style={{ width: `${Math.min(item.revenuePercent, 100)}%` }}
                          />
                        </div>
                        <span className="text-sm">{item.revenuePercent.toFixed(1)}%</span>
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
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-700">
              <tr>
                <th className="text-left p-4">Category</th>
                <th className="text-right p-4">Items</th>
                <th className="text-right p-4">Qty Sold</th>
                <th className="text-right p-4">Revenue</th>
                <th className="text-right p-4">Cost</th>
                <th className="text-right p-4">Profit</th>
                <th className="text-right p-4">Margin</th>
                <th className="text-right p-4">% of Sales</th>
              </tr>
            </thead>
            <tbody>
              {report.categories.map(cat => (
                <tr key={cat.categoryId} className="border-t border-gray-700">
                  <td className="p-4 font-medium">{cat.categoryName}</td>
                  <td className="p-4 text-right">{cat.itemCount}</td>
                  <td className="p-4 text-right">{cat.quantity}</td>
                  <td className="p-4 text-right">${cat.revenue.toFixed(2)}</td>
                  <td className="p-4 text-right">${cat.cost.toFixed(2)}</td>
                  <td className="p-4 text-right text-green-400">${cat.profit.toFixed(2)}</td>
                  <td className="p-4 text-right">{cat.profitMargin.toFixed(1)}%</td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-20 h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500"
                          style={{ width: `${Math.min(cat.revenuePercent, 100)}%` }}
                        />
                      </div>
                      <span className="text-sm">{cat.revenuePercent.toFixed(1)}%</span>
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
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-medium mb-4">Sales by Hour</h3>
          <div className="space-y-2">
            {Object.entries(report.hourlyDistribution).map(([hour, data]) => {
              const h = parseInt(hour)
              const maxQty = Math.max(...Object.values(report.hourlyDistribution).map(d => d.quantity))
              const pct = maxQty > 0 ? (data.quantity / maxQty) * 100 : 0

              return (
                <div key={hour} className="flex items-center gap-4">
                  <span className="w-16 text-sm text-gray-400">
                    {h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`}
                  </span>
                  <div className="flex-1 h-6 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-20 text-right text-sm">{data.quantity} items</span>
                  <span className="w-24 text-right text-sm text-gray-400">
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
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-medium mb-4">Frequently Ordered Together</h3>
          {report.pairings.length === 0 ? (
            <p className="text-gray-400">No significant pairings found</p>
          ) : (
            <div className="space-y-3">
              {report.pairings.map((pairing, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400">{i + 1}.</span>
                    <span className="font-medium">{pairing.names[0]}</span>
                    <span className="text-gray-500">+</span>
                    <span className="font-medium">{pairing.names[1]}</span>
                  </div>
                  <span className="text-blue-400">{pairing.count} orders</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
