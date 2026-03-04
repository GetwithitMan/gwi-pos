'use client'

import { useState, useEffect } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'

type Classification = 'star' | 'plow_horse' | 'puzzle' | 'dog'

interface EngineeringItem {
  menuItemId: string
  menuItemName: string
  categoryId: string
  categoryName: string
  qtySold: number
  revenue: number
  sellPrice: number
  unitCost: number
  contributionMargin: number
  classification: Classification
  recommendation: string
  hasCostData: boolean
  foodCostPct: number | null
}

interface CategoryOption {
  id: string
  name: string
}

interface ReportData {
  items: EngineeringItem[]
  summary: {
    stars: number
    plowHorses: number
    puzzles: number
    dogs: number
    totalItems: number
    starsRevenue: number
    plowHorsesRevenue: number
    puzzlesRevenue: number
    dogsRevenue: number
  }
  averages: {
    avgQtySold: number
    avgContributionMargin: number
  }
  categories: CategoryOption[]
  dateRange: { start: string; end: string }
}

const CLASS_CONFIG: Record<Classification, { label: string; emoji: string; color: string; bg: string; border: string }> = {
  star: { label: 'Stars', emoji: '\u2B50', color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200' },
  plow_horse: { label: 'Plow Horses', emoji: '\uD83D\uDC34', color: 'text-yellow-700', bg: 'bg-yellow-50', border: 'border-yellow-200' },
  puzzle: { label: 'Puzzles', emoji: '\uD83E\uDDE9', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
  dog: { label: 'Dogs', emoji: '\uD83D\uDC15', color: 'text-gray-700', bg: 'bg-gray-50', border: 'border-gray-200' },
}

function classificationBadge(c: Classification) {
  const cfg = CLASS_CONFIG[c]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
      {cfg.emoji} {cfg.label.slice(0, -1)}
    </span>
  )
}

export default function MenuEngineeringPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/menu-engineering' })
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id

  const [report, setReport] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0])
  const [categoryId, setCategoryId] = useState<string>('')
  const [filterClass, setFilterClass] = useState<Classification | ''>('')
  const [showInfo, setShowInfo] = useState(false)

  useEffect(() => {
    if (locationId) fetchReport()
  }, [startDate, endDate, locationId, categoryId])

  async function fetchReport() {
    if (!locationId) return
    setLoading(true)
    try {
      let url = `/api/reports/menu-engineering?locationId=${locationId}&startDate=${startDate}&endDate=${endDate}&employeeId=${employee?.id}`
      if (categoryId) url += `&categoryId=${categoryId}`
      const res = await fetch(url)
      const data = await res.json()
      setReport(data.data)
    } catch (error) {
      console.error('Failed to fetch menu engineering report:', error)
    } finally {
      setLoading(false)
    }
  }

  if (!hydrated) return null

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

  const filteredItems = filterClass
    ? report.items.filter(i => i.classification === filterClass)
    : report.items

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Menu Engineering"
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
          {report.categories && report.categories.length > 0 && (
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="">All Categories</option>
              {report.categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <button onClick={() => setShowInfo(!showInfo)}
            className="px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-500 font-medium"
            title="What is menu engineering?">
            ?
          </button>
        </div>

        {/* Info tooltip */}
        {showInfo && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
            <p className="font-medium mb-2">Menu Engineering Matrix</p>
            <p className="mb-1">Items are classified into 4 quadrants based on <strong>popularity</strong> (quantity sold vs average) and <strong>profitability</strong> (contribution margin vs average):</p>
            <ul className="list-disc ml-5 space-y-1">
              <li><strong>Stars</strong> - High popularity + High profit. Your best items.</li>
              <li><strong>Plow Horses</strong> - High popularity + Low profit. Sell well but thin margins.</li>
              <li><strong>Puzzles</strong> - Low popularity + High profit. Promote these more.</li>
              <li><strong>Dogs</strong> - Low popularity + Low profit. Consider removing or repricing.</li>
            </ul>
          </div>
        )}

        {/* 4-Quadrant Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {([
            { key: 'star' as Classification, count: report.summary.stars, revenue: report.summary.starsRevenue, note: 'Keep & protect' },
            { key: 'puzzle' as Classification, count: report.summary.puzzles, revenue: report.summary.puzzlesRevenue, note: 'Promote more' },
            { key: 'plow_horse' as Classification, count: report.summary.plowHorses, revenue: report.summary.plowHorsesRevenue, note: 'Review pricing' },
            { key: 'dog' as Classification, count: report.summary.dogs, revenue: report.summary.dogsRevenue, note: 'Consider removing' },
          ]).map(q => {
            const cfg = CLASS_CONFIG[q.key]
            return (
              <button key={q.key}
                onClick={() => setFilterClass(filterClass === q.key ? '' : q.key)}
                className={`rounded-lg shadow p-4 border text-left transition-all ${cfg.bg} ${cfg.border} ${filterClass === q.key ? 'ring-2 ring-blue-500' : ''}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-lg">{cfg.emoji}</span>
                  <span className={`text-2xl font-bold ${cfg.color}`}>{q.count}</span>
                </div>
                <div className={`font-semibold ${cfg.color}`}>{cfg.label}</div>
                <div className="text-xs text-gray-500 mt-1">${q.revenue.toFixed(0)} revenue</div>
                <div className="text-xs text-gray-400 mt-0.5">{q.note}</div>
              </button>
            )
          })}
        </div>

        {/* Items Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-4 text-gray-700 font-semibold">Item</th>
                <th className="text-left p-4 text-gray-700 font-semibold">Category</th>
                <th className="text-right p-4 text-gray-700 font-semibold">Sold</th>
                <th className="text-right p-4 text-gray-700 font-semibold">Revenue</th>
                <th className="text-right p-4 text-gray-700 font-semibold">CM</th>
                <th className="text-center p-4 text-gray-700 font-semibold">Class</th>
                <th className="text-left p-4 text-gray-700 font-semibold">Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map(item => (
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
                    {item.hasCostData ? `$${item.contributionMargin.toFixed(2)}` : '-'}
                  </td>
                  <td className="p-4 text-center">{classificationBadge(item.classification)}</td>
                  <td className="p-4 text-sm text-gray-600">{item.recommendation}</td>
                </tr>
              ))}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-400">No items match the current filters</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Averages footer */}
        <div className="mt-4 flex gap-6 text-sm text-gray-500">
          <span>Avg qty sold: {report.averages.avgQtySold.toFixed(1)}</span>
          <span>Avg contribution margin: ${report.averages.avgContributionMargin.toFixed(2)}</span>
          <span>Total items: {report.summary.totalItems}</span>
        </div>
      </div>
    </div>
  )
}
