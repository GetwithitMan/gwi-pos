'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface TierData {
  tier: string
  label: string
  count: number
  revenue: number
  orderCount: number
}

interface CategoryData {
  categoryId: string
  categoryName: string
  totalPours: number
  totalCost: number
  totalRevenue: number
  margin: number
}

interface BottleData {
  bottleId: string
  name: string
  tier: string
  category: string
  totalPours: number
  totalCost: number
}

interface PourCostData {
  menuItemId: string
  name: string
  sellPrice: number
  pourCost: number
  margin: number
  ingredientCount: number
}

interface UpsellTierData {
  tier: string
  shown: number
  accepted: number
  revenue: number
  acceptanceRate: number
}

interface UpsellEmployeeData {
  employeeId: string
  employeeName: string
  shown: number
  accepted: number
  revenue: number
  acceptanceRate: number
}

interface LiquorReport {
  summary: {
    totalPours: number
    totalPourCost: number
    totalSpiritRevenue: number
    grossMargin: number
    uniqueBottlesUsed: number
    spiritSelectionCount: number
  }
  byTier: TierData[]
  byCategory: CategoryData[]
  byBottle: BottleData[]
  pourCostAnalysis: PourCostData[]
  upsells: {
    summary: {
      totalShown: number
      totalAccepted: number
      acceptanceRate: number
      totalRevenue: number
    }
    byTier: UpsellTierData[]
    byEmployee: UpsellEmployeeData[]
  }
  filters: {
    startDate: string | null
    endDate: string | null
    locationId: string
  }
}

type TabType = 'overview' | 'tiers' | 'bottles' | 'pourCost' | 'upsells'

const TIER_COLORS: Record<string, string> = {
  well: 'bg-gray-100 text-gray-800',
  call: 'bg-blue-100 text-blue-800',
  premium: 'bg-purple-100 text-purple-800',
  top_shelf: 'bg-amber-100 text-amber-800',
}

const TIER_BAR_COLORS: Record<string, string> = {
  well: 'bg-gray-500',
  call: 'bg-blue-500',
  premium: 'bg-purple-500',
  top_shelf: 'bg-amber-500',
}

export default function LiquorReportPage() {
  const router = useRouter()
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const employee = useAuthStore(s => s.employee)
  const [report, setReport] = useState<LiquorReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>('overview')
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 7)
    return date.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0]
  })

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/reports/liquor')
      return
    }
    if (employee?.location?.id) {
      loadReport()
    }
  }, [isAuthenticated, router, employee?.location?.id])

  const loadReport = async () => {
    if (!employee?.location?.id) return

    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('locationId', employee.location.id)
      if (startDate) params.append('startDate', startDate)
      if (endDate) params.append('endDate', endDate)

      const response = await fetch(`/api/reports/liquor?${params}`)
      if (response.ok) {
        const data = await response.json()
        setReport(data)
      }
    } catch (error) {
      console.error('Failed to load liquor report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (!isAuthenticated) return null

  const tabs: { id: TabType; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'tiers', label: 'By Tier' },
    { id: 'bottles', label: 'Bottle Usage' },
    { id: 'pourCost', label: 'Pour Cost' },
    { id: 'upsells', label: 'Upsells' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Liquor & Spirits Report"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
        actions={
          <Button variant="outline" onClick={() => router.push('/liquor-builder')}>
            Liquor Builder
          </Button>
        }
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
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <div className="mb-6 border-b bg-white rounded-t-lg">
          <nav className="flex gap-1 p-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Loading report...</div>
        ) : !report ? (
          <div className="text-center py-12 text-gray-500">Failed to load report</div>
        ) : (
          <>
            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-500">Total Pours</p>
                      <p className="text-2xl font-bold text-blue-600">{report.summary.totalPours}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-500">Pour Cost</p>
                      <p className="text-2xl font-bold text-red-600">
                        {formatCurrency(report.summary.totalPourCost)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-500">Spirit Revenue</p>
                      <p className="text-2xl font-bold text-green-600">
                        {formatCurrency(report.summary.totalSpiritRevenue)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-500">Gross Margin</p>
                      <p className="text-2xl font-bold text-purple-600">{report.summary.grossMargin}%</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-500">Bottles Used</p>
                      <p className="text-2xl font-bold text-gray-700">{report.summary.uniqueBottlesUsed}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-500">Spirit Selections</p>
                      <p className="text-2xl font-bold text-gray-700">{report.summary.spiritSelectionCount}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Tier Distribution */}
                <Card>
                  <CardHeader>
                    <CardTitle>Sales by Spirit Tier</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {report.byTier.length === 0 ? (
                      <p className="text-gray-500 text-center py-4">No spirit tier data available</p>
                    ) : (
                      <div className="space-y-4">
                        {report.byTier.map((tier) => {
                          const maxRevenue = Math.max(...report.byTier.map(t => t.revenue))
                          const percentage = maxRevenue > 0 ? (tier.revenue / maxRevenue) * 100 : 0
                          return (
                            <div key={tier.tier} className="flex items-center gap-4">
                              <span className={`px-3 py-1 rounded-full text-sm font-medium w-28 text-center ${TIER_COLORS[tier.tier] || 'bg-gray-100'}`}>
                                {tier.label}
                              </span>
                              <div className="flex-1">
                                <div className="h-8 bg-gray-100 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full ${TIER_BAR_COLORS[tier.tier] || 'bg-gray-500'} transition-all`}
                                    style={{ width: `${percentage}%` }}
                                  />
                                </div>
                              </div>
                              <div className="text-right w-32">
                                <p className="font-semibold">{formatCurrency(tier.revenue)}</p>
                                <p className="text-xs text-gray-500">{tier.count} drinks</p>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Category Breakdown */}
                <Card>
                  <CardHeader>
                    <CardTitle>Sales by Spirit Category</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {report.byCategory.length === 0 ? (
                      <p className="text-gray-500 text-center py-4">No category data available</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-3 px-4 font-medium text-gray-600">Category</th>
                              <th className="text-right py-3 px-4 font-medium text-gray-600">Pours</th>
                              <th className="text-right py-3 px-4 font-medium text-gray-600">Cost</th>
                              <th className="text-right py-3 px-4 font-medium text-gray-600">Revenue</th>
                              <th className="text-right py-3 px-4 font-medium text-gray-600">Margin</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.byCategory.map((cat) => (
                              <tr key={cat.categoryId} className="border-b hover:bg-gray-50">
                                <td className="py-3 px-4 font-medium">{cat.categoryName}</td>
                                <td className="py-3 px-4 text-right">{cat.totalPours}</td>
                                <td className="py-3 px-4 text-right text-red-600">{formatCurrency(cat.totalCost)}</td>
                                <td className="py-3 px-4 text-right text-green-600">{formatCurrency(cat.totalRevenue)}</td>
                                <td className="py-3 px-4 text-right">
                                  <span className={`px-2 py-1 rounded text-sm ${
                                    cat.margin >= 70 ? 'bg-green-100 text-green-800' :
                                    cat.margin >= 50 ? 'bg-yellow-100 text-yellow-800' :
                                    'bg-red-100 text-red-800'
                                  }`}>
                                    {cat.margin}%
                                  </span>
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
            )}

            {/* Tiers Tab */}
            {activeTab === 'tiers' && (
              <Card>
                <CardHeader>
                  <CardTitle>Spirit Sales by Tier</CardTitle>
                </CardHeader>
                <CardContent>
                  {report.byTier.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">No tier data available for this period</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                      {report.byTier.map((tier) => (
                        <div key={tier.tier} className={`p-6 rounded-lg border-2 ${
                          tier.tier === 'well' ? 'border-gray-300 bg-gray-50' :
                          tier.tier === 'call' ? 'border-blue-300 bg-blue-50' :
                          tier.tier === 'premium' ? 'border-purple-300 bg-purple-50' :
                          'border-amber-300 bg-amber-50'
                        }`}>
                          <h3 className="text-lg font-bold mb-4">{tier.label}</h3>
                          <div className="space-y-2">
                            <div className="flex justify-between">
                              <span className="text-gray-600">Drinks Sold</span>
                              <span className="font-semibold">{tier.count}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Revenue</span>
                              <span className="font-semibold text-green-600">{formatCurrency(tier.revenue)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Orders</span>
                              <span className="font-semibold">{tier.orderCount}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Avg per Order</span>
                              <span className="font-semibold">
                                {tier.orderCount > 0 ? formatCurrency(tier.revenue / tier.orderCount) : '$0.00'}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Bottles Tab */}
            {activeTab === 'bottles' && (
              <Card>
                <CardHeader>
                  <CardTitle>Bottle Usage</CardTitle>
                </CardHeader>
                <CardContent>
                  {report.byBottle.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">No bottle usage data available</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-3 px-4 font-medium text-gray-600">Bottle</th>
                            <th className="text-left py-3 px-4 font-medium text-gray-600">Category</th>
                            <th className="text-center py-3 px-4 font-medium text-gray-600">Tier</th>
                            <th className="text-right py-3 px-4 font-medium text-gray-600">Pours</th>
                            <th className="text-right py-3 px-4 font-medium text-gray-600">Cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.byBottle.map((bottle) => (
                            <tr key={bottle.bottleId} className="border-b hover:bg-gray-50">
                              <td className="py-3 px-4 font-medium">{bottle.name}</td>
                              <td className="py-3 px-4 text-gray-600">{bottle.category}</td>
                              <td className="py-3 px-4 text-center">
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${TIER_COLORS[bottle.tier] || 'bg-gray-100'}`}>
                                  {bottle.tier.replace('_', ' ')}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right font-semibold">{bottle.totalPours}</td>
                              <td className="py-3 px-4 text-right text-red-600">{formatCurrency(bottle.totalCost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Pour Cost Tab */}
            {activeTab === 'pourCost' && (
              <Card>
                <CardHeader>
                  <CardTitle>Pour Cost Analysis</CardTitle>
                </CardHeader>
                <CardContent>
                  {report.pourCostAnalysis.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <p className="mb-2">No cocktails with recipes found.</p>
                      <p className="text-sm">Add recipes in the Liquor Builder to see pour cost analysis.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-3 px-4 font-medium text-gray-600">Cocktail</th>
                            <th className="text-right py-3 px-4 font-medium text-gray-600">Sell Price</th>
                            <th className="text-right py-3 px-4 font-medium text-gray-600">Pour Cost</th>
                            <th className="text-right py-3 px-4 font-medium text-gray-600">Profit</th>
                            <th className="text-right py-3 px-4 font-medium text-gray-600">Margin</th>
                            <th className="text-center py-3 px-4 font-medium text-gray-600">Ingredients</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.pourCostAnalysis.map((item) => {
                            const profit = item.sellPrice - item.pourCost
                            return (
                              <tr key={item.menuItemId} className="border-b hover:bg-gray-50">
                                <td className="py-3 px-4 font-medium">{item.name}</td>
                                <td className="py-3 px-4 text-right">{formatCurrency(item.sellPrice)}</td>
                                <td className="py-3 px-4 text-right text-red-600">{formatCurrency(item.pourCost)}</td>
                                <td className="py-3 px-4 text-right text-green-600">{formatCurrency(profit)}</td>
                                <td className="py-3 px-4 text-right">
                                  <span className={`px-2 py-1 rounded text-sm ${
                                    item.margin >= 75 ? 'bg-green-100 text-green-800' :
                                    item.margin >= 60 ? 'bg-yellow-100 text-yellow-800' :
                                    'bg-red-100 text-red-800'
                                  }`}>
                                    {item.margin}%
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-center text-gray-500">{item.ingredientCount}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Upsells Tab */}
            {activeTab === 'upsells' && (
              <div className="space-y-6">
                {/* Upsell Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-500">Upsells Shown</p>
                      <p className="text-2xl font-bold text-blue-600">{report.upsells.summary.totalShown}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-500">Upsells Accepted</p>
                      <p className="text-2xl font-bold text-green-600">{report.upsells.summary.totalAccepted}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-500">Acceptance Rate</p>
                      <p className="text-2xl font-bold text-purple-600">{report.upsells.summary.acceptanceRate}%</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-500">Upsell Revenue</p>
                      <p className="text-2xl font-bold text-green-600">
                        {formatCurrency(report.upsells.summary.totalRevenue)}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Upsells by Tier */}
                <Card>
                  <CardHeader>
                    <CardTitle>Upsells by Tier</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {report.upsells.byTier.length === 0 ? (
                      <p className="text-gray-500 text-center py-4">No upsell data by tier</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-3 px-4 font-medium text-gray-600">Tier</th>
                              <th className="text-right py-3 px-4 font-medium text-gray-600">Shown</th>
                              <th className="text-right py-3 px-4 font-medium text-gray-600">Accepted</th>
                              <th className="text-right py-3 px-4 font-medium text-gray-600">Acceptance Rate</th>
                              <th className="text-right py-3 px-4 font-medium text-gray-600">Revenue</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.upsells.byTier.map((tier) => (
                              <tr key={tier.tier} className="border-b hover:bg-gray-50">
                                <td className="py-3 px-4">
                                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${TIER_COLORS[tier.tier] || 'bg-gray-100'}`}>
                                    {tier.tier.replace('_', ' ')}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-right">{tier.shown}</td>
                                <td className="py-3 px-4 text-right">{tier.accepted}</td>
                                <td className="py-3 px-4 text-right">
                                  <span className={`px-2 py-1 rounded text-sm ${
                                    tier.acceptanceRate >= 30 ? 'bg-green-100 text-green-800' :
                                    tier.acceptanceRate >= 15 ? 'bg-yellow-100 text-yellow-800' :
                                    'bg-red-100 text-red-800'
                                  }`}>
                                    {tier.acceptanceRate}%
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-right text-green-600 font-semibold">
                                  {formatCurrency(tier.revenue)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Upsells by Employee */}
                <Card>
                  <CardHeader>
                    <CardTitle>Upsell Performance by Employee</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {report.upsells.byEmployee.length === 0 ? (
                      <p className="text-gray-500 text-center py-4">No upsell data by employee</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-3 px-4 font-medium text-gray-600">Employee</th>
                              <th className="text-right py-3 px-4 font-medium text-gray-600">Shown</th>
                              <th className="text-right py-3 px-4 font-medium text-gray-600">Accepted</th>
                              <th className="text-right py-3 px-4 font-medium text-gray-600">Rate</th>
                              <th className="text-right py-3 px-4 font-medium text-gray-600">Revenue</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.upsells.byEmployee.map((emp) => (
                              <tr key={emp.employeeId} className="border-b hover:bg-gray-50">
                                <td className="py-3 px-4 font-medium">{emp.employeeName}</td>
                                <td className="py-3 px-4 text-right">{emp.shown}</td>
                                <td className="py-3 px-4 text-right">{emp.accepted}</td>
                                <td className="py-3 px-4 text-right">
                                  <span className={`px-2 py-1 rounded text-sm ${
                                    emp.acceptanceRate >= 30 ? 'bg-green-100 text-green-800' :
                                    emp.acceptanceRate >= 15 ? 'bg-yellow-100 text-yellow-800' :
                                    'bg-red-100 text-red-800'
                                  }`}>
                                    {emp.acceptanceRate}%
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-right text-green-600 font-semibold">
                                  {formatCurrency(emp.revenue)}
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
            )}
          </>
        )}
      </div>
    </div>
  )
}
