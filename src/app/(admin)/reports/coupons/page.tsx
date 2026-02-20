'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { WebReportBanner } from '@/components/admin/WebReportBanner'
import { useDataRetention } from '@/hooks/useDataRetention'

interface CouponStat {
  id: string
  code: string
  name: string
  discountType: string
  discountValue: number
  isActive: boolean
  usageLimit?: number
  usageCount: number
  periodRedemptions: number
  totalDiscount: number
  avgOrderValue: number
  validFrom?: string
  validUntil?: string
}

interface DailyTrend {
  date: string
  count: number
  discount: number
}

interface TypeBreakdown {
  type: string
  count: number
  discount: number
}

interface Redemption {
  id: string
  couponCode: string
  couponName: string
  discountAmount: number
  orderNumber: number
  orderTotal: number
  redeemedAt: string
}

interface Summary {
  totalCoupons: number
  activeCoupons: number
  totalRedemptions: number
  totalDiscountGiven: number
  totalOrderValue: number
  avgDiscountPerRedemption: number
}

export default function CouponReportsPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/coupons' })
  const employee = useAuthStore(s => s.employee)
  const { retentionDays, venueSlug } = useDataRetention()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [coupons, setCoupons] = useState<CouponStat[]>([])
  const [dailyTrend, setDailyTrend] = useState<DailyTrend[]>([])
  const [byType, setByType] = useState<TypeBreakdown[]>([])
  const [recentRedemptions, setRecentRedemptions] = useState<Redemption[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'coupons' | 'redemptions'>('overview')

  // Filters
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

  useEffect(() => {
    loadReport()
  }, [startDate, endDate])

  const loadReport = async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        startDate,
        endDate,
        employeeId: employee.id,
      })

      const res = await fetch(`/api/reports/coupons?${params}`)
      if (res.ok) {
        const data = await res.json()
        setSummary(data.data.summary)
        setCoupons(data.data.coupons)
        setDailyTrend(data.data.dailyTrend)
        setByType(data.data.byType)
        setRecentRedemptions(data.data.recentRedemptions)
      }
    } catch (error) {
      console.error('Failed to load coupon report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const getDiscountLabel = (type: string, value: number) => {
    switch (type) {
      case 'percent': return `${value}% off`
      case 'fixed': return `${formatCurrency(value)} off`
      case 'free_item': return 'Free item'
      default: return type
    }
  }

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Coupon Reports"
        subtitle="Analyze coupon performance and redemptions"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
      />

      <div className="max-w-7xl mx-auto">

        {/* Date Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="border rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="border rounded px-3 py-2"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    const d = new Date()
                    d.setDate(d.getDate() - 7)
                    setStartDate(d.toISOString().split('T')[0])
                    setEndDate(new Date().toISOString().split('T')[0])
                  }}
                >
                  Last 7 Days
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const d = new Date()
                    d.setDate(d.getDate() - 30)
                    setStartDate(d.toISOString().split('T')[0])
                    setEndDate(new Date().toISOString().split('T')[0])
                  }}
                >
                  Last 30 Days
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <WebReportBanner
          startDate={startDate}
          endDate={endDate}
          reportType="coupons"
          retentionDays={retentionDays}
          venueSlug={venueSlug}
        />

        {isLoading ? (
          <div className="text-center py-8 text-gray-500">Loading report...</div>
        ) : (
          <>
            {/* Summary Cards */}
            {summary && (
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold">{summary.totalCoupons}</p>
                    <p className="text-sm text-gray-600">Total Coupons</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-green-600">{summary.activeCoupons}</p>
                    <p className="text-sm text-gray-600">Active</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold">{summary.totalRedemptions}</p>
                    <p className="text-sm text-gray-600">Redemptions</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-red-600">{formatCurrency(summary.totalDiscountGiven)}</p>
                    <p className="text-sm text-gray-600">Discount Given</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-blue-600">{formatCurrency(summary.totalOrderValue)}</p>
                    <p className="text-sm text-gray-600">Order Value</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold">{formatCurrency(summary.avgDiscountPerRedemption)}</p>
                    <p className="text-sm text-gray-600">Avg Discount</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-2 mb-4">
              <Button
                variant={activeTab === 'overview' ? 'primary' : 'ghost'}
                onClick={() => setActiveTab('overview')}
              >
                Overview
              </Button>
              <Button
                variant={activeTab === 'coupons' ? 'primary' : 'ghost'}
                onClick={() => setActiveTab('coupons')}
              >
                By Coupon
              </Button>
              <Button
                variant={activeTab === 'redemptions' ? 'primary' : 'ghost'}
                onClick={() => setActiveTab('redemptions')}
              >
                Redemptions
              </Button>
            </div>

            {activeTab === 'overview' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Daily Trend */}
                <Card>
                  <CardHeader>
                    <CardTitle>Daily Redemptions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {dailyTrend.length === 0 ? (
                      <p className="text-gray-500 text-center py-4">No data for period</p>
                    ) : (
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {dailyTrend.map(d => (
                          <div key={d.date} className="flex justify-between items-center py-1 border-b">
                            <span className="text-sm">{d.date}</span>
                            <div className="text-right">
                              <span className="text-sm font-medium">{d.count} redemptions</span>
                              <span className="text-sm text-gray-500 ml-2">({formatCurrency(d.discount)})</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* By Type */}
                <Card>
                  <CardHeader>
                    <CardTitle>By Discount Type</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {byType.length === 0 ? (
                      <p className="text-gray-500 text-center py-4">No data</p>
                    ) : (
                      <div className="space-y-3">
                        {byType.map(t => (
                          <div key={t.type} className="flex justify-between items-center">
                            <span className="capitalize font-medium">{t.type.replace('_', ' ')}</span>
                            <div className="text-right">
                              <span className="font-medium">{t.count}</span>
                              <span className="text-gray-500 ml-2">({formatCurrency(t.discount)})</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Top Performing */}
                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle>Top Performing Coupons</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {coupons.slice(0, 3).map((coupon, idx) => (
                        <div key={coupon.id} className="p-4 bg-gray-50 rounded-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-sm ${
                              idx === 0 ? 'bg-yellow-500' : idx === 1 ? 'bg-gray-400' : 'bg-orange-400'
                            }`}>
                              {idx + 1}
                            </span>
                            <span className="font-mono font-bold">{coupon.code}</span>
                          </div>
                          <p className="text-sm text-gray-600 mb-2">{coupon.name}</p>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <p className="text-gray-500">Redemptions</p>
                              <p className="font-bold">{coupon.periodRedemptions}</p>
                            </div>
                            <div>
                              <p className="text-gray-500">Discount</p>
                              <p className="font-bold">{formatCurrency(coupon.totalDiscount)}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === 'coupons' && (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="text-left p-3 text-sm font-medium text-gray-600">Code</th>
                          <th className="text-left p-3 text-sm font-medium text-gray-600">Name</th>
                          <th className="text-left p-3 text-sm font-medium text-gray-600">Discount</th>
                          <th className="text-center p-3 text-sm font-medium text-gray-600">Status</th>
                          <th className="text-right p-3 text-sm font-medium text-gray-600">Usage</th>
                          <th className="text-right p-3 text-sm font-medium text-gray-600">Period Uses</th>
                          <th className="text-right p-3 text-sm font-medium text-gray-600">Total Discount</th>
                          <th className="text-right p-3 text-sm font-medium text-gray-600">Avg Order</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {coupons.map(coupon => (
                          <tr key={coupon.id} className="hover:bg-gray-50">
                            <td className="p-3 font-mono font-bold">{coupon.code}</td>
                            <td className="p-3">{coupon.name}</td>
                            <td className="p-3 text-sm">{getDiscountLabel(coupon.discountType, coupon.discountValue)}</td>
                            <td className="p-3 text-center">
                              <span className={`px-2 py-1 rounded text-xs ${
                                coupon.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                              }`}>
                                {coupon.isActive ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="p-3 text-right text-sm">
                              {coupon.usageCount}{coupon.usageLimit ? ` / ${coupon.usageLimit}` : ''}
                            </td>
                            <td className="p-3 text-right font-medium">{coupon.periodRedemptions}</td>
                            <td className="p-3 text-right text-red-600">{formatCurrency(coupon.totalDiscount)}</td>
                            <td className="p-3 text-right">{formatCurrency(coupon.avgOrderValue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'redemptions' && (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="text-left p-3 text-sm font-medium text-gray-600">Date</th>
                          <th className="text-left p-3 text-sm font-medium text-gray-600">Coupon</th>
                          <th className="text-left p-3 text-sm font-medium text-gray-600">Order #</th>
                          <th className="text-right p-3 text-sm font-medium text-gray-600">Order Total</th>
                          <th className="text-right p-3 text-sm font-medium text-gray-600">Discount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {recentRedemptions.map(r => (
                          <tr key={r.id} className="hover:bg-gray-50">
                            <td className="p-3 text-sm">{formatDateTime(r.redeemedAt)}</td>
                            <td className="p-3">
                              <span className="font-mono font-bold">{r.couponCode}</span>
                              <span className="text-sm text-gray-500 ml-2">{r.couponName}</span>
                            </td>
                            <td className="p-3 font-mono">#{r.orderNumber}</td>
                            <td className="p-3 text-right">{formatCurrency(r.orderTotal)}</td>
                            <td className="p-3 text-right text-red-600 font-medium">-{formatCurrency(r.discountAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}
