'use client'

import React, { useState, useEffect } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { WebReportBanner } from '@/components/admin/WebReportBanner'
import { useDataRetention } from '@/hooks/useDataRetention'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'
import { ReportExportBar } from '@/components/reports/ReportExportBar'

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
  soldByWeight?: boolean
  totalWeight?: number
  weightUnit?: string | null
  totalOuncesPoured?: number | null
  orderTypes: Record<string, number>
  hourlyDistribution: Record<number, number>
  variationCount?: number
  hasLiquorModifiers?: boolean
  pricingOptionLabel?: string | null
}

interface VariationRow {
  fingerprint: string
  label: string
  quantitySold: number
  totalRevenue: number
  totalCost: number
  avgRevenue: number
  avgCost: number
  margin: number
  percentOfTotal: number
  modifiers: Array<{
    name: string
    preModifier: string | null
    spiritTier: string | null
    isNoneSelection: boolean
    quantity: number
  }>
  pourSize: string | null
  avgModifierRevenue: number
  totalOunces?: number | null
  avgOuncesPerDrink?: number | null
}

interface VariationDetailData {
  modifiers: Array<{
    name: string
    preModifier: string | null
    spiritTier: string | null
    avgPrice: number
    avgCost: number
    frequency: number
    frequencyPct: number
    isLiquor: boolean
    pourSizes?: Record<string, number>
    pourSizeOunces?: Record<string, number>
    totalOunces?: number
    weeklySparkline: number[]
  }>
  weeklySparkline: Array<{ week: string; count: number }>
  liquor: {
    tierDistribution: Record<string, number>
    totalPours: number
    totalOuncesPoured?: number
  } | null
  weekLabels: string[]
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

function formatQty(item: ProductMixItem): string {
  if (item.soldByWeight && item.totalWeight) {
    return `${item.totalWeight.toFixed(1)} ${item.weightUnit || 'lb'}`
  }
  return String(item.quantity)
}

function exportProductMixCSV(report: ReportData) {
  const header = [
    'Item', 'Category', 'Quantity', 'Revenue', 'Cost',
    'Profit', 'Margin %', '% of Sales',
  ].join(',')

  const rows = report.items.map((item) =>
    [
      `"${item.name}"`,
      `"${item.categoryName}"`,
      `"${formatQty(item)}"`,
      item.revenue.toFixed(2),
      item.cost.toFixed(2),
      item.profit.toFixed(2),
      item.profitMargin.toFixed(1),
      item.revenuePercent.toFixed(1),
    ].join(',')
  )

  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `product-mix-${report.dateRange.start}-to-${report.dateRange.end}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function ProductMixReportPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/product-mix' })
  const employee = useAuthStore(s => s.employee)
  const { retentionDays, venueSlug } = useDataRetention()
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

  // Drilldown state
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)
  const [variationData, setVariationData] = useState<Record<string, VariationRow[]>>({})
  const [loadingVariations, setLoadingVariations] = useState<string | null>(null)
  const [expandedFingerprint, setExpandedFingerprint] = useState<string | null>(null)
  const [detailData, setDetailData] = useState<Record<string, VariationDetailData>>({})
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null)

  useReportAutoRefresh({ onRefresh: fetchReport })

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
        `/api/reports/product-mix?locationId=${locationId}&startDate=${startDate}&endDate=${endDate}&employeeId=${employee?.id}`
      )
      const data = await res.json()
      setReport(data.data)
    } catch (error) {
      console.error('Failed to fetch report:', error)
    } finally {
      setLoading(false)
    }
  }

  async function loadVariations(item: ProductMixItem) {
    const key = item.pricingOptionLabel
      ? `${item.menuItemId}::${item.pricingOptionLabel}`
      : item.menuItemId
    if (variationData[key]) {
      setExpandedItemId(expandedItemId === key ? null : key)
      setExpandedFingerprint(null)
      return
    }
    setLoadingVariations(key)
    setExpandedItemId(key)
    setExpandedFingerprint(null)
    try {
      const params = new URLSearchParams({
        locationId: locationId!,
        startDate,
        endDate,
        employeeId: employee?.id || '',
      })
      if (item.pricingOptionLabel) {
        params.set('pricingOptionLabel', item.pricingOptionLabel)
      }
      const res = await fetch(`/api/reports/product-mix/${item.menuItemId}/variations?${params}`)
      const json = await res.json()
      const variations = json.data?.variations || json.data || []
      setVariationData(prev => ({ ...prev, [key]: variations }))
    } catch (err) {
      console.error('Failed to load variations:', err)
    } finally {
      setLoadingVariations(null)
    }
  }

  async function loadDetail(menuItemId: string, fingerprint: string) {
    const detailKey = `${menuItemId}::${fingerprint}`
    if (detailData[detailKey]) {
      setExpandedFingerprint(expandedFingerprint === fingerprint ? null : fingerprint)
      return
    }
    setLoadingDetail(fingerprint)
    setExpandedFingerprint(fingerprint)
    try {
      const params = new URLSearchParams({
        locationId: locationId!,
        startDate,
        endDate,
        fingerprint,
        employeeId: employee?.id || '',
      })
      const res = await fetch(`/api/reports/product-mix/${menuItemId}/detail?${params}`)
      const json = await res.json()
      setDetailData(prev => ({ ...prev, [detailKey]: json.data }))
    } catch (err) {
      console.error('Failed to load detail:', err)
    } finally {
      setLoadingDetail(null)
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
            className="px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
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
            className="px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
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
            className="px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
          >
            90 Days
          </button>
          {report && report.items.length > 0 && (
            <ReportExportBar
              reportType="product-mix"
              reportTitle="Product Mix Report"
              headers={['Item', 'Category', 'Qty', 'Revenue', 'Cost', 'Profit', 'Margin %', '% of Sales']}
              rows={report.items.map(item => [
                item.name,
                item.categoryName,
                formatQty(item),
                `$${item.revenue.toFixed(2)}`,
                `$${item.cost.toFixed(2)}`,
                `$${item.profit.toFixed(2)}`,
                `${item.profitMargin.toFixed(1)}%`,
                `${item.revenuePercent.toFixed(1)}%`,
              ])}
              summary={[
                { label: 'Total Revenue', value: `$${report.summary.totalRevenue.toFixed(2)}` },
                { label: 'Total Cost', value: `$${report.summary.totalCost.toFixed(2)}` },
                { label: 'Gross Profit', value: `$${report.summary.totalProfit.toFixed(2)}` },
                { label: 'Items Sold', value: String(report.summary.totalQuantity) },
                { label: 'Profit Margin', value: `${report.summary.profitMargin.toFixed(1)}%` },
              ]}
              dateRange={{ start: startDate, end: endDate }}
              onExportCSV={() => exportProductMixCSV(report)}
            />
          )}
        </div>
      </div>

      <WebReportBanner
        startDate={startDate}
        endDate={endDate}
        reportType="product-mix"
        retentionDays={retentionDays}
        venueSlug={venueSlug}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <div className="text-gray-900 text-sm">Total Revenue</div>
          <div className="text-2xl font-bold text-gray-900">${report.summary.totalRevenue.toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <div className="text-gray-900 text-sm">Total Cost</div>
          <div className="text-2xl font-bold text-gray-900">${report.summary.totalCost.toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <div className="text-gray-900 text-sm">Gross Profit</div>
          <div className="text-2xl font-bold text-green-600">
            ${report.summary.totalProfit.toFixed(2)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <div className="text-gray-900 text-sm">Items Sold</div>
          <div className="text-2xl font-bold text-gray-900">{report.summary.totalQuantity}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <div className="text-gray-900 text-sm">Profit Margin</div>
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
                : 'bg-white border border-gray-300 text-gray-900 hover:bg-gray-50'
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
                    <span className="font-semibold text-gray-900">{formatQty(item)}</span>
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
                    <span className="font-semibold text-red-600">{formatQty(item)}</span>
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
                  <th className="w-8 p-4"></th>
                  <th className="text-left p-4 text-gray-900 font-semibold">Item</th>
                  <th className="text-left p-4 text-gray-900 font-semibold">Category</th>
                  <th className="text-right p-4 text-gray-900 font-semibold">Variations</th>
                  <th className="text-right p-4 text-gray-900 font-semibold">Qty</th>
                  <th className="text-right p-4 text-gray-900 font-semibold">Oz Poured</th>
                  <th className="text-right p-4 text-gray-900 font-semibold">Revenue</th>
                  <th className="text-right p-4 text-gray-900 font-semibold">Cost</th>
                  <th className="text-right p-4 text-gray-900 font-semibold">Profit</th>
                  <th className="text-right p-4 text-gray-900 font-semibold">Margin</th>
                  <th className="text-right p-4 text-gray-900 font-semibold">% of Sales</th>
                </tr>
              </thead>
              <tbody>
                {report.items.map(item => {
                  const rowKey = item.pricingOptionLabel
                    ? `${item.menuItemId}::${item.pricingOptionLabel}`
                    : item.menuItemId
                  const isExpanded = expandedItemId === rowKey
                  const variations = variationData[rowKey]
                  const isLoadingThis = loadingVariations === rowKey

                  return (
                    <React.Fragment key={rowKey}>
                      {/* Item row */}
                      <tr
                        className={`border-t border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors ${isExpanded ? 'bg-blue-50' : ''}`}
                        onClick={() => loadVariations(item)}
                      >
                        <td className="p-4 text-gray-400">
                          {isLoadingThis ? (
                            <svg className="animate-spin h-4 w-4 text-blue-500" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                          ) : (
                            <svg
                              className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          )}
                        </td>
                        <td className="p-4 font-medium text-gray-900">
                          <div className="flex items-center gap-2">
                            {item.name}
                            {item.hasLiquorModifiers && (
                              <span title="Has liquor modifiers" className="text-amber-500 text-sm">&#127864;</span>
                            )}
                          </div>
                        </td>
                        <td className="p-4 text-gray-600">{item.categoryName}</td>
                        <td className="p-4 text-right">
                          {(item.variationCount ?? 0) > 1 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                              {item.variationCount} ways
                            </span>
                          ) : (
                            <span className="text-gray-400 text-xs">1 way</span>
                          )}
                        </td>
                        <td className="p-4 text-right text-gray-900">{formatQty(item)}</td>
                        <td className="p-4 text-right text-gray-900">
                          {item.totalOuncesPoured != null ? (
                            <span className="text-amber-700 font-medium">{item.totalOuncesPoured} oz</span>
                          ) : (
                            <span className="text-gray-300">--</span>
                          )}
                        </td>
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

                      {/* Variation panel (Level 1) */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={11} className="p-0">
                            <div className="bg-gray-50 border-t border-b border-gray-200">
                              {!variations ? (
                                <div className="p-6 text-center text-gray-500">Loading variations...</div>
                              ) : variations.length === 0 ? (
                                <div className="p-6 text-center text-gray-500">No variation data available</div>
                              ) : (
                                <div className="px-6 py-4">
                                  <h4 className="text-sm font-semibold text-gray-700 mb-3 pl-8">
                                    Variation Breakdown for {item.name}
                                  </h4>
                                  <table className="w-full">
                                    <thead>
                                      <tr className="text-xs text-gray-500 uppercase">
                                        <th className="w-8 py-2"></th>
                                        <th className="text-left py-2 pl-2">Variation</th>
                                        <th className="text-right py-2 pr-3">Qty</th>
                                        <th className="text-right py-2 pr-3">Oz</th>
                                        <th className="text-right py-2 pr-3">% of Total</th>
                                        <th className="text-right py-2 pr-3">Avg Price</th>
                                        <th className="text-right py-2 pr-3">Avg Cost</th>
                                        <th className="text-right py-2 pr-3">Margin</th>
                                        <th className="text-right py-2 pr-3">Cost Delta</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {variations.map(v => {
                                        const costDelta = v.avgCost - (item.cost / Math.max(item.quantity, 1))
                                        const isFpExpanded = expandedFingerprint === v.fingerprint
                                        const detailKey = `${item.menuItemId}::${v.fingerprint}`
                                        const detail = detailData[detailKey]
                                        const isLoadingThisDetail = loadingDetail === v.fingerprint

                                        return (
                                          <React.Fragment key={v.fingerprint}>
                                            <tr
                                              className={`border-t border-gray-200 cursor-pointer hover:bg-gray-100 transition-colors ${isFpExpanded ? 'bg-gray-100' : ''}`}
                                              onClick={(e) => { e.stopPropagation(); loadDetail(item.menuItemId, v.fingerprint) }}
                                            >
                                              <td className="py-2 text-gray-400">
                                                {isLoadingThisDetail ? (
                                                  <svg className="animate-spin h-3 w-3 text-blue-500" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                                  </svg>
                                                ) : v.modifiers.length > 0 || v.fingerprint !== 'standard' ? (
                                                  <svg
                                                    className={`h-3 w-3 transition-transform duration-200 ${isFpExpanded ? 'rotate-90' : ''}`}
                                                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                                                  >
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                                  </svg>
                                                ) : null}
                                              </td>
                                              <td className="py-2 pl-2 text-sm text-gray-800 font-medium">{v.label}</td>
                                              <td className="py-2 pr-3 text-right text-sm text-gray-900">{v.quantitySold}</td>
                                              <td className="py-2 pr-3 text-right text-sm">
                                                {v.totalOunces != null ? (
                                                  <span className="text-amber-700" title={v.avgOuncesPerDrink != null ? `${v.avgOuncesPerDrink} oz/drink` : ''}>
                                                    {v.totalOunces} oz
                                                  </span>
                                                ) : (
                                                  <span className="text-gray-300">--</span>
                                                )}
                                              </td>
                                              <td className="py-2 pr-3 text-right text-sm">
                                                <div className="flex items-center justify-end gap-1.5">
                                                  <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                                    <div className="h-full bg-purple-500" style={{ width: `${Math.min(v.percentOfTotal, 100)}%` }} />
                                                  </div>
                                                  <span className="text-gray-600">{v.percentOfTotal.toFixed(1)}%</span>
                                                </div>
                                              </td>
                                              <td className="py-2 pr-3 text-right text-sm text-gray-900">${v.avgRevenue.toFixed(2)}</td>
                                              <td className="py-2 pr-3 text-right text-sm text-gray-900">${v.avgCost.toFixed(2)}</td>
                                              <td className="py-2 pr-3 text-right text-sm">
                                                <div className="flex items-center justify-end gap-1.5">
                                                  <div className="w-10 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                                    <div
                                                      className={`h-full ${v.margin >= 50 ? 'bg-green-500' : v.margin >= 25 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                                      style={{ width: `${Math.min(Math.max(v.margin, 0), 100)}%` }}
                                                    />
                                                  </div>
                                                  <span className="text-gray-700">{v.margin.toFixed(1)}%</span>
                                                </div>
                                              </td>
                                              <td className="py-2 pr-3 text-right text-sm">
                                                {Math.abs(costDelta) < 0.01 ? (
                                                  <span className="text-gray-400">--</span>
                                                ) : costDelta < 0 ? (
                                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                                                    Saves ${Math.abs(costDelta).toFixed(2)}
                                                  </span>
                                                ) : (
                                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                                                    +${costDelta.toFixed(2)}
                                                  </span>
                                                )}
                                              </td>
                                            </tr>

                                            {/* Modifier detail panel (Level 2) */}
                                            {isFpExpanded && (
                                              <tr>
                                                <td colSpan={9} className="p-0">
                                                  <div className="bg-gray-100 border-t border-gray-200 px-8 py-4">
                                                    {!detail ? (
                                                      <div className="text-center text-gray-500 text-sm py-3">Loading modifier details...</div>
                                                    ) : detail.modifiers.length === 0 ? (
                                                      <div className="text-center text-gray-500 text-sm py-3">Standard item - no modifiers</div>
                                                    ) : (
                                                      <div className="space-y-4">
                                                        <h5 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Modifier Details</h5>
                                                        <table className="w-full text-sm">
                                                          <thead>
                                                            <tr className="text-xs text-gray-500 uppercase">
                                                              <th className="text-left py-1.5">Modifier</th>
                                                              <th className="text-right py-1.5">Price</th>
                                                              <th className="text-right py-1.5">Cost</th>
                                                              <th className="text-right py-1.5">Frequency</th>
                                                              <th className="text-right py-1.5">Weekly Trend</th>
                                                            </tr>
                                                          </thead>
                                                          <tbody>
                                                            {detail.modifiers.map((mod, mi) => (
                                                              <tr key={mi} className="border-t border-gray-200">
                                                                <td className="py-2 text-gray-800">
                                                                  <div className="flex items-center gap-1.5">
                                                                    {mod.preModifier && (
                                                                      <span className="text-xs text-gray-500 italic">{mod.preModifier}</span>
                                                                    )}
                                                                    <span className="font-medium">{mod.name}</span>
                                                                    {mod.spiritTier && (
                                                                      <span className="text-xs px-1 py-0.5 rounded bg-amber-100 text-amber-700">
                                                                        {mod.spiritTier}
                                                                      </span>
                                                                    )}
                                                                  </div>
                                                                </td>
                                                                <td className="py-2 text-right text-gray-900">${mod.avgPrice.toFixed(2)}</td>
                                                                <td className="py-2 text-right text-gray-600">${mod.avgCost.toFixed(2)}</td>
                                                                <td className="py-2 text-right">
                                                                  <span className="text-gray-900">{mod.frequency}</span>
                                                                  <span className="text-gray-400 text-xs ml-1">({mod.frequencyPct.toFixed(0)}%)</span>
                                                                </td>
                                                                <td className="py-2">
                                                                  {/* Mini sparkline */}
                                                                  <div className="flex items-end gap-px justify-end h-4">
                                                                    {mod.weeklySparkline.map((val, wi) => {
                                                                      const maxVal = Math.max(...mod.weeklySparkline, 1)
                                                                      const h = Math.max((val / maxVal) * 16, 1)
                                                                      return (
                                                                        <div
                                                                          key={wi}
                                                                          className="w-1.5 bg-blue-400 rounded-t"
                                                                          style={{ height: `${h}px` }}
                                                                          title={`${detail.weekLabels?.[wi] || `Week ${wi + 1}`}: ${val}`}
                                                                        />
                                                                      )
                                                                    })}
                                                                  </div>
                                                                </td>
                                                              </tr>
                                                            ))}
                                                          </tbody>
                                                        </table>

                                                        {/* Liquor tier distribution */}
                                                        {detail.liquor && (
                                                          <div className="mt-3 pt-3 border-t border-gray-200">
                                                            <h6 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                                                              Spirit Tier Distribution ({detail.liquor.totalPours} pours
                                                              {detail.liquor.totalOuncesPoured ? ` / ${detail.liquor.totalOuncesPoured} oz` : ''})
                                                            </h6>
                                                            <div className="flex gap-3">
                                                              {Object.entries(detail.liquor.tierDistribution).map(([tier, count]) => {
                                                                const pct = detail.liquor!.totalPours > 0
                                                                  ? Math.round((count / detail.liquor!.totalPours) * 100)
                                                                  : 0
                                                                return (
                                                                  <div key={tier} className="flex items-center gap-2">
                                                                    <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                                                                      <div className="h-full bg-amber-500 rounded-full" style={{ width: `${pct}%` }} />
                                                                    </div>
                                                                    <span className="text-xs text-gray-700 capitalize">{tier.replace('_', ' ')}</span>
                                                                    <span className="text-xs text-gray-500">{pct}%</span>
                                                                  </div>
                                                                )
                                                              })}
                                                            </div>
                                                          </div>
                                                        )}
                                                      </div>
                                                    )}
                                                  </div>
                                                </td>
                                              </tr>
                                            )}
                                          </React.Fragment>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
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
                <th className="text-left p-4 text-gray-900 font-semibold">Category</th>
                <th className="text-right p-4 text-gray-900 font-semibold">Items</th>
                <th className="text-right p-4 text-gray-900 font-semibold">Qty Sold</th>
                <th className="text-right p-4 text-gray-900 font-semibold">Revenue</th>
                <th className="text-right p-4 text-gray-900 font-semibold">Cost</th>
                <th className="text-right p-4 text-gray-900 font-semibold">Profit</th>
                <th className="text-right p-4 text-gray-900 font-semibold">Margin</th>
                <th className="text-right p-4 text-gray-900 font-semibold">% of Sales</th>
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
            <p className="text-gray-900">No significant pairings found</p>
          ) : (
            <div className="space-y-3">
              {report.pairings.map((pairing, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center gap-3">
                    <span className="text-gray-900 font-medium">{i + 1}.</span>
                    <span className="font-medium text-gray-900">{pairing.names[0]}</span>
                    <span className="text-gray-900">+</span>
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
