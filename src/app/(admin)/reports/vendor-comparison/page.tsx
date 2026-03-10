'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'

// ─── Types ───────────────────────────────────────────────────────────────────

interface VendorPrice {
  vendorId: string
  vendorName: string
  unitPrice: number
  previousPrice: number | null
  trend: 'up' | 'down' | 'stable'
  unit: string
  lastOrderDate: string
}

interface ComparisonItem {
  itemId: string
  itemName: string
  category: string
  purchaseUnit: string
  currentCost: number
  defaultVendorId: string | null
  defaultVendorName: string | null
  prices: VendorPrice[]
  bestPrice: number | null
  bestVendorId: string | null
  priceDifference: number
}

interface VendorInfo {
  id: string
  name: string
}

interface Summary {
  totalItems: number
  itemsWithMultipleVendors: number
  totalPotentialSavings: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPrice(n: number): string {
  return '$' + n.toFixed(4)
}

// ─── Page Component ──────────────────────────────────────────────────────────

type SortField = 'name' | 'difference'
type SortDir = 'asc' | 'desc'

export default function VendorComparisonPage() {
  const employee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/vendor-comparison' })
  const locationId = employee?.location?.id

  // Data
  const [comparison, setComparison] = useState<ComparisonItem[]>([])
  const [vendors, setVendors] = useState<VendorInfo[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [summary, setSummary] = useState<Summary>({ totalItems: 0, itemsWithMultipleVendors: 0, totalPotentialSavings: 0 })
  const [isLoading, setIsLoading] = useState(true)

  // Filters
  const [categoryFilter, setCategoryFilter] = useState('')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // ─── Fetch data ───────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!locationId) return
    setIsLoading(true)

    try {
      const params = new URLSearchParams({ locationId })
      if (categoryFilter) params.set('category', categoryFilter)

      const res = await fetch(`/api/reports/vendor-comparison?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const json = await res.json()
      const { vendors: v, categories: c, comparison: comp, summary: s } = json.data

      setVendors(v)
      setCategories(c)
      setComparison(comp)
      setSummary(s)
    } catch (error) {
      console.error('Failed to fetch vendor comparison:', error)
      toast.error('Failed to load vendor comparison')
    } finally {
      setIsLoading(false)
    }
  }, [locationId, categoryFilter])

  useEffect(() => {
    if (locationId) fetchData()
  }, [locationId, fetchData])

  // ─── Sort ─────────────────────────────────────────────────────────────────
  const sortedComparison = useMemo(() => {
    const sorted = [...comparison]
    sorted.sort((a, b) => {
      if (sortField === 'name') {
        return sortDir === 'asc'
          ? a.itemName.localeCompare(b.itemName)
          : b.itemName.localeCompare(a.itemName)
      }
      // sort by price difference
      return sortDir === 'asc'
        ? a.priceDifference - b.priceDifference
        : b.priceDifference - a.priceDifference
    })
    return sorted
  }, [comparison, sortField, sortDir])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  // Build unique vendor list from comparison data for column headers
  const activeVendors = useMemo(() => {
    const vendorIds = new Set<string>()
    for (const item of comparison) {
      for (const p of item.prices) {
        vendorIds.add(p.vendorId)
      }
    }
    return vendors.filter(v => vendorIds.has(v.id))
  }, [comparison, vendors])

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Vendor Price Comparison"
        subtitle="Compare prices across vendors for inventory items"
        breadcrumbs={[
          { label: 'Reports', href: '/reports' },
        ]}
      />

      <div className="max-w-7xl mx-auto">

        {/* ═══ Filter ═══ */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                <select
                  value={categoryFilter}
                  onChange={e => setCategoryFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Categories</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ═══ Summary Cards ═══ */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">Items with Vendor Data</p>
              <p className="text-2xl font-bold text-gray-900">{summary.totalItems}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">Items with Multiple Vendors</p>
              <p className="text-2xl font-bold text-blue-600">{summary.itemsWithMultipleVendors}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">Potential Savings (per unit)</p>
              <p className="text-2xl font-bold text-green-600">{formatCurrency(summary.totalPotentialSavings)}</p>
            </CardContent>
          </Card>
        </div>

        {/* ═══ Comparison Table ═══ */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
                <p className="text-gray-500">Loading vendor comparison...</p>
              </div>
            ) : sortedComparison.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No vendor pricing data found. Create purchase orders with received pricing to see comparisons.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th
                        className="text-left px-4 py-3 font-medium text-gray-600 text-sm cursor-pointer hover:text-gray-900 select-none min-w-[180px]"
                        onClick={() => toggleSort('name')}
                      >
                        Item Name {sortField === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Category</th>
                      {activeVendors.map(v => (
                        <th key={v.id} className="text-right px-4 py-3 font-medium text-gray-600 text-sm min-w-[120px]">
                          {v.name}
                        </th>
                      ))}
                      <th className="text-right px-4 py-3 font-medium text-gray-600 text-sm min-w-[100px]">
                        Best Price
                      </th>
                      <th
                        className="text-right px-4 py-3 font-medium text-gray-600 text-sm cursor-pointer hover:text-gray-900 select-none min-w-[100px]"
                        onClick={() => toggleSort('difference')}
                      >
                        Spread {sortField === 'difference' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedComparison.map(item => (
                      <tr key={item.itemId} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          {item.itemName}
                          <span className="block text-xs text-gray-400">per {item.purchaseUnit}</span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {item.category.charAt(0).toUpperCase() + item.category.slice(1)}
                        </td>
                        {activeVendors.map(v => {
                          const vendorPrice = item.prices.find(p => p.vendorId === v.id)
                          if (!vendorPrice) {
                            return (
                              <td key={v.id} className="px-4 py-3 text-right text-sm text-gray-300">
                                -
                              </td>
                            )
                          }
                          const isBest = vendorPrice.vendorId === item.bestVendorId
                          return (
                            <td
                              key={v.id}
                              className={`px-4 py-3 text-right text-sm font-mono ${
                                isBest ? 'text-green-700 bg-green-50 font-bold' : 'text-gray-700'
                              }`}
                            >
                              {formatPrice(vendorPrice.unitPrice)}
                              {vendorPrice.trend !== 'stable' && (
                                <span className={`ml-1 text-xs ${vendorPrice.trend === 'up' ? 'text-red-500' : 'text-green-500'}`}>
                                  {vendorPrice.trend === 'up' ? '↑' : '↓'}
                                </span>
                              )}
                            </td>
                          )
                        })}
                        <td className="px-4 py-3 text-right text-sm font-mono font-bold text-green-700">
                          {item.bestPrice !== null ? formatPrice(item.bestPrice) : '-'}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-mono">
                          {item.priceDifference > 0 ? (
                            <span className="text-amber-600">{formatPrice(item.priceDifference)}</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
