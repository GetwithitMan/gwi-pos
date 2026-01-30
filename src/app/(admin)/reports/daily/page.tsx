'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'

interface DailyReport {
  reportDate: string
  generatedAt: string

  revenue: {
    adjustedGrossSales: number
    discounts: number
    netSales: number
    salesTax: number
    surcharge: number
    grossSales: number
    tips: number
    gratuity: number
    refunds: number
    giftCardLoads: number
    totalCollected: number
    commission: number
  }

  payments: {
    cash: { count: number; amount: number; tips: number }
    credit: {
      count: number
      amount: number
      tips: number
      breakdown: {
        visa: { count: number; amount: number }
        mastercard: { count: number; amount: number }
        amex: { count: number; amount: number }
        discover: { count: number; amount: number }
        other: { count: number; amount: number }
      }
    }
    gift: { count: number; amount: number }
    houseAccount: { count: number; amount: number }
    other: { count: number; amount: number }
    totalPayments: number
  }

  cash: {
    cashReceived: number
    cashIn: number
    cashOut: number
    tipsOut: number
    cashDue: number
  }

  paidInOut: {
    paidIn: number
    paidOut: number
    net: number
  }

  salesByCategory: {
    name: string
    categoryType: string
    units: number
    gross: number
    discounts: number
    net: number
    voids: number
    percentOfTotal: number
  }[]

  salesByOrderType: {
    name: string
    count: number
    gross: number
    net: number
  }[]

  voids: {
    tickets: { count: number; amount: number }
    items: { count: number; amount: number }
    total: { count: number; amount: number }
    percentOfSales: number
    byReason: { reason: string; count: number; amount: number }[]
  }

  discounts: {
    total: number
    byType: { name: string; count: number; amount: number }[]
  }

  labor: {
    frontOfHouse: { hours: number; cost: number; percentOfLabor: number }
    backOfHouse: { hours: number; cost: number; percentOfLabor: number }
    total: { hours: number; cost: number; percentOfSales: number }
  }

  giftCards: {
    loads: number
    redemptions: number
    netLiability: number
  }

  stats: {
    checks: number
    avgCheck: number
    avgCheckTimeMinutes: number
    covers: number
    avgCover: number
    foodAvg: number
    bevAvg: number
    retailAvg: number
  }
}

export default function DailyReportPage() {
  const router = useRouter()
  const { isAuthenticated, employee } = useAuthStore()
  const [report, setReport] = useState<DailyReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/reports/daily')
      return
    }
    if (employee?.location?.id) {
      loadReport()
    }
  }, [isAuthenticated, employee?.location?.id, selectedDate])

  const loadReport = async () => {
    if (!employee?.location?.id) return

    setIsLoading(true)
    try {
      const response = await fetch(
        `/api/reports/daily?locationId=${employee.location.id}&date=${selectedDate}`
      )
      if (response.ok) {
        const data = await response.json()
        setReport(data)
      }
    } catch (error) {
      console.error('Failed to load report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const formatTime = (minutes: number) => {
    const mins = Math.floor(minutes)
    const secs = Math.round((minutes - mins) * 60)
    return `${mins} mins ${secs} s`
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/reports')}
              className="text-gray-500 hover:text-gray-700"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-2xl font-bold">Daily Sales Report</h1>
          </div>
          <div className="flex items-center gap-4">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 border rounded-lg"
            />
            <Button variant="outline" onClick={() => window.print()}>
              Print Report
            </Button>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-6xl mx-auto print:p-0 print:max-w-none">
        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Loading report...</div>
        ) : !report ? (
          <div className="text-center py-12 text-gray-500">No data available for this date</div>
        ) : (
          <div className="space-y-6 print:space-y-4">
            {/* Report Header */}
            <div className="text-center mb-6 print:mb-4">
              <h2 className="text-xl font-bold">{employee?.location?.name}</h2>
              <p className="text-gray-600">
                {new Date(report.reportDate).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>

            {/* Revenue Section */}
            <Card className="print:shadow-none print:border">
              <CardHeader className="pb-2">
                <CardTitle>Revenue</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 font-mono text-sm">
                  <div className="flex justify-between">
                    <span>Adjusted Gross Sales</span>
                    <span>{formatCurrency(report.revenue.adjustedGrossSales)}</span>
                  </div>
                  <div className="flex justify-between text-red-600">
                    <span>– Discounts</span>
                    <span>{formatCurrency(report.revenue.discounts)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Net Sales</span>
                    <span>{formatCurrency(report.revenue.netSales)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>+ Sales Tax</span>
                    <span>{formatCurrency(report.revenue.salesTax)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>+ Surcharge</span>
                    <span>{formatCurrency(report.revenue.surcharge)}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t pt-1">
                    <span>Gross Sales</span>
                    <span>{formatCurrency(report.revenue.grossSales)}</span>
                  </div>
                  <div className="flex justify-between text-green-600">
                    <span>+ Tips</span>
                    <span>{formatCurrency(report.revenue.tips)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>+ Gratuity</span>
                    <span>{formatCurrency(report.revenue.gratuity)}</span>
                  </div>
                  <div className="flex justify-between text-red-600">
                    <span>– Refunds</span>
                    <span>{formatCurrency(report.revenue.refunds)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>+ Gift Card Load</span>
                    <span>{formatCurrency(report.revenue.giftCardLoads)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg border-t pt-2 mt-2">
                    <span>= Total Collected</span>
                    <span>{formatCurrency(report.revenue.totalCollected)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Payments Section */}
            <Card className="print:shadow-none print:border">
              <CardHeader className="pb-2">
                <CardTitle>Tender</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 font-mono text-sm">
                  <div className="flex justify-between">
                    <span>+ Cash ({report.payments.cash.count})</span>
                    <span>{formatCurrency(report.payments.cash.amount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>+ Credit ({report.payments.credit.count})</span>
                    <span>{formatCurrency(report.payments.credit.amount)}</span>
                  </div>
                  {/* Credit Card Breakdown */}
                  <div className="ml-4 text-gray-600 space-y-0.5">
                    {report.payments.credit.breakdown.amex.count > 0 && (
                      <div className="flex justify-between">
                        <span>AMEX ({report.payments.credit.breakdown.amex.count})</span>
                        <span>{formatCurrency(report.payments.credit.breakdown.amex.amount)}</span>
                      </div>
                    )}
                    {report.payments.credit.breakdown.visa.count > 0 && (
                      <div className="flex justify-between">
                        <span>VISA ({report.payments.credit.breakdown.visa.count})</span>
                        <span>{formatCurrency(report.payments.credit.breakdown.visa.amount)}</span>
                      </div>
                    )}
                    {report.payments.credit.breakdown.mastercard.count > 0 && (
                      <div className="flex justify-between">
                        <span>MC ({report.payments.credit.breakdown.mastercard.count})</span>
                        <span>{formatCurrency(report.payments.credit.breakdown.mastercard.amount)}</span>
                      </div>
                    )}
                    {report.payments.credit.breakdown.discover.count > 0 && (
                      <div className="flex justify-between">
                        <span>DCVR ({report.payments.credit.breakdown.discover.count})</span>
                        <span>{formatCurrency(report.payments.credit.breakdown.discover.amount)}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-between">
                    <span>+ Gift ({report.payments.gift.count})</span>
                    <span>{formatCurrency(report.payments.gift.amount)}</span>
                  </div>
                  {report.payments.houseAccount.count > 0 && (
                    <div className="flex justify-between">
                      <span>+ House Account ({report.payments.houseAccount.count})</span>
                      <span>{formatCurrency(report.payments.houseAccount.amount)}</span>
                    </div>
                  )}
                  {report.payments.other.count > 0 && (
                    <div className="flex justify-between">
                      <span>+ Other ({report.payments.other.count})</span>
                      <span>{formatCurrency(report.payments.other.amount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold border-t pt-1 mt-1">
                    <span>= Total Payments</span>
                    <span>{formatCurrency(report.payments.totalPayments)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Cash Section */}
            <Card className="print:shadow-none print:border">
              <CardHeader className="pb-2">
                <CardTitle>Cash</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 font-mono text-sm">
                  <div className="flex justify-between">
                    <span>+ Cash Received</span>
                    <span>{formatCurrency(report.cash.cashReceived)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>+ Cash In</span>
                    <span>{formatCurrency(report.cash.cashIn)}</span>
                  </div>
                  <div className="flex justify-between text-red-600">
                    <span>– Cash Out</span>
                    <span>{formatCurrency(report.cash.cashOut)}</span>
                  </div>
                  <div className="flex justify-between text-red-600">
                    <span>– Tips Paid Out</span>
                    <span>{formatCurrency(report.cash.tipsOut)}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t pt-1 mt-1">
                    <span>= Cash Due</span>
                    <span>{formatCurrency(report.cash.cashDue)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Two Column Layout for Categories */}
            <div className="grid md:grid-cols-2 gap-6 print:grid-cols-2 print:gap-4">
              {/* Revenue Groups */}
              <Card className="print:shadow-none print:border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Revenue by Category</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 font-mono text-sm">
                    {report.salesByCategory.map(cat => (
                      <div key={cat.name} className="flex justify-between">
                        <span className="truncate mr-2">
                          {cat.name} ({cat.units})
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-gray-500 text-xs">{cat.percentOfTotal}%</span>
                          <span className="w-20 text-right">{formatCurrency(cat.net)}</span>
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between font-bold border-t pt-1 mt-1">
                      <span>Total</span>
                      <span>{formatCurrency(report.revenue.netSales)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Sales by Order Type */}
              <Card className="print:shadow-none print:border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Sales by Order Type</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 font-mono text-sm">
                    {report.salesByOrderType.map(type => (
                      <div key={type.name} className="flex justify-between">
                        <span>{type.name} ({type.count})</span>
                        <span>{formatCurrency(type.net)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Voids & Discounts */}
            <div className="grid md:grid-cols-2 gap-6 print:grid-cols-2 print:gap-4">
              {/* Voids */}
              <Card className="print:shadow-none print:border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Voids & Refunds</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 font-mono text-sm">
                    <div className="flex justify-between">
                      <span>Voided Tickets ({report.voids.tickets.count})</span>
                      <span>{formatCurrency(report.voids.tickets.amount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Voided Items ({report.voids.items.count})</span>
                      <span>{formatCurrency(report.voids.items.amount)}</span>
                    </div>
                    <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                      <span>Total ({report.voids.total.count})</span>
                      <span>
                        {formatCurrency(report.voids.total.amount)}
                        <span className="text-gray-500 text-xs ml-1">
                          ({report.voids.percentOfSales}%)
                        </span>
                      </span>
                    </div>
                    {report.voids.byReason.length > 0 && (
                      <div className="mt-2 pt-2 border-t">
                        <p className="text-xs text-gray-500 mb-1">By Reason:</p>
                        {report.voids.byReason.map(v => (
                          <div key={v.reason} className="flex justify-between text-xs">
                            <span>{v.reason} ({v.count})</span>
                            <span>{formatCurrency(v.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Discounts */}
              <Card className="print:shadow-none print:border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Discounts</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 font-mono text-sm">
                    {report.discounts.byType.map(d => (
                      <div key={d.name} className="flex justify-between">
                        <span className="truncate mr-2">{d.name} ({d.count})</span>
                        <span>{formatCurrency(d.amount)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between font-bold border-t pt-1 mt-1">
                      <span>Total Discounts</span>
                      <span>{formatCurrency(report.discounts.total)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Labor Summary */}
            <Card className="print:shadow-none print:border">
              <CardHeader className="pb-2">
                <CardTitle>Labor</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 font-mono text-sm">
                  <div className="flex justify-between">
                    <span>Front of House</span>
                    <span className="flex items-center gap-4">
                      <span className="text-gray-500">{report.labor.frontOfHouse.hours.toFixed(1)} hrs</span>
                      <span className="text-gray-500">{report.labor.frontOfHouse.percentOfLabor}%</span>
                      <span className="w-20 text-right">{formatCurrency(report.labor.frontOfHouse.cost)}</span>
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Back of House</span>
                    <span className="flex items-center gap-4">
                      <span className="text-gray-500">{report.labor.backOfHouse.hours.toFixed(1)} hrs</span>
                      <span className="text-gray-500">{report.labor.backOfHouse.percentOfLabor}%</span>
                      <span className="w-20 text-right">{formatCurrency(report.labor.backOfHouse.cost)}</span>
                    </span>
                  </div>
                  <div className="flex justify-between font-bold border-t pt-1 mt-1">
                    <span>Total Labor</span>
                    <span className="flex items-center gap-4">
                      <span className="text-gray-500">{report.labor.total.hours.toFixed(1)} hrs</span>
                      <span className="text-blue-600">{report.labor.total.percentOfSales}% of sales</span>
                      <span className="w-20 text-right">{formatCurrency(report.labor.total.cost)}</span>
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Stats */}
            <Card className="print:shadow-none print:border">
              <CardHeader className="pb-2">
                <CardTitle>Stats</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono text-sm">
                  <div>
                    <p className="text-gray-500">Checks</p>
                    <p className="text-xl font-bold">{report.stats.checks}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Avg Check</p>
                    <p className="text-xl font-bold">{formatCurrency(report.stats.avgCheck)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Avg Check Time</p>
                    <p className="text-xl font-bold">{formatTime(report.stats.avgCheckTimeMinutes)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Covers</p>
                    <p className="text-xl font-bold">{report.stats.covers}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Avg Cover</p>
                    <p className="text-xl font-bold">{formatCurrency(report.stats.avgCover)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Food Avg</p>
                    <p className="text-xl font-bold">{formatCurrency(report.stats.foodAvg)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Bev Avg</p>
                    <p className="text-xl font-bold">{formatCurrency(report.stats.bevAvg)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Retail Avg</p>
                    <p className="text-xl font-bold">{formatCurrency(report.stats.retailAvg)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Gift Cards */}
            {(report.giftCards.loads > 0 || report.giftCards.redemptions > 0) && (
              <Card className="print:shadow-none print:border">
                <CardHeader className="pb-2">
                  <CardTitle>Gift Cards</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 font-mono text-sm">
                    <div className="flex justify-between">
                      <span>Gift Card Loads</span>
                      <span>{formatCurrency(report.giftCards.loads)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Gift Card Redemptions</span>
                      <span>{formatCurrency(report.giftCards.redemptions)}</span>
                    </div>
                    <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                      <span>Net Liability Change</span>
                      <span>{formatCurrency(report.giftCards.netLiability)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Footer */}
            <div className="text-center text-xs text-gray-500 pt-4 print:pt-2">
              Generated on {new Date(report.generatedAt).toLocaleString()}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
