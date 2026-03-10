'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { WebReportBanner } from '@/components/admin/WebReportBanner'
import { useDataRetention } from '@/hooks/useDataRetention'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'

interface DayPaymentData {
  date: string
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
}

interface AggregatedPayments {
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
  totalTips: number
}

function emptyAgg(): AggregatedPayments {
  return {
    cash: { count: 0, amount: 0, tips: 0 },
    credit: {
      count: 0, amount: 0, tips: 0,
      breakdown: {
        visa: { count: 0, amount: 0 },
        mastercard: { count: 0, amount: 0 },
        amex: { count: 0, amount: 0 },
        discover: { count: 0, amount: 0 },
        other: { count: 0, amount: 0 },
      },
    },
    gift: { count: 0, amount: 0 },
    houseAccount: { count: 0, amount: 0 },
    other: { count: 0, amount: 0 },
    totalPayments: 0,
    totalTips: 0,
  }
}

function aggregatePayments(days: DayPaymentData[]): AggregatedPayments {
  const agg = emptyAgg()
  for (const day of days) {
    const p = day.payments
    agg.cash.count += p.cash.count
    agg.cash.amount += p.cash.amount
    agg.cash.tips += p.cash.tips
    agg.credit.count += p.credit.count
    agg.credit.amount += p.credit.amount
    agg.credit.tips += p.credit.tips
    agg.credit.breakdown.visa.count += p.credit.breakdown.visa.count
    agg.credit.breakdown.visa.amount += p.credit.breakdown.visa.amount
    agg.credit.breakdown.mastercard.count += p.credit.breakdown.mastercard.count
    agg.credit.breakdown.mastercard.amount += p.credit.breakdown.mastercard.amount
    agg.credit.breakdown.amex.count += p.credit.breakdown.amex.count
    agg.credit.breakdown.amex.amount += p.credit.breakdown.amex.amount
    agg.credit.breakdown.discover.count += p.credit.breakdown.discover.count
    agg.credit.breakdown.discover.amount += p.credit.breakdown.discover.amount
    agg.credit.breakdown.other.count += p.credit.breakdown.other.count
    agg.credit.breakdown.other.amount += p.credit.breakdown.other.amount
    agg.gift.count += p.gift.count
    agg.gift.amount += p.gift.amount
    agg.houseAccount.count += p.houseAccount.count
    agg.houseAccount.amount += p.houseAccount.amount
    agg.other.count += p.other.count
    agg.other.amount += p.other.amount
    agg.totalPayments += p.totalPayments
    agg.totalTips += p.cash.tips + p.credit.tips
  }
  return agg
}

function getDatesInRange(start: string, end: string): string[] {
  const dates: string[] = []
  const d = new Date(start + 'T12:00:00')
  const e = new Date(end + 'T12:00:00')
  while (d <= e) {
    dates.push(d.toISOString().split('T')[0])
    d.setDate(d.getDate() + 1)
  }
  return dates
}

function pct(value: number, total: number): string {
  if (total === 0) return '0.0'
  return ((value / total) * 100).toFixed(1)
}

function exportPaymentMethodsCSV(agg: AggregatedPayments, days: DayPaymentData[], startDate: string, endDate: string) {
  const rows: string[][] = []
  rows.push(['Section', 'Method', 'Count', 'Amount', 'Tips', '% of Total'])

  rows.push(['Summary', 'Cash', String(agg.cash.count), agg.cash.amount.toFixed(2), agg.cash.tips.toFixed(2), pct(agg.cash.amount, agg.totalPayments)])
  rows.push(['Summary', 'Credit Card', String(agg.credit.count), agg.credit.amount.toFixed(2), agg.credit.tips.toFixed(2), pct(agg.credit.amount, agg.totalPayments)])
  rows.push(['Summary', 'Gift Card', String(agg.gift.count), agg.gift.amount.toFixed(2), '', pct(agg.gift.amount, agg.totalPayments)])
  rows.push(['Summary', 'House Account', String(agg.houseAccount.count), agg.houseAccount.amount.toFixed(2), '', pct(agg.houseAccount.amount, agg.totalPayments)])
  rows.push(['Summary', 'Other', String(agg.other.count), agg.other.amount.toFixed(2), '', pct(agg.other.amount, agg.totalPayments)])
  rows.push(['Summary', 'Total', '', agg.totalPayments.toFixed(2), agg.totalTips.toFixed(2), '100.0'])

  rows.push([])
  rows.push(['Card Brand', 'Count', 'Amount', '% of Credit'])
  rows.push(['Visa', String(agg.credit.breakdown.visa.count), agg.credit.breakdown.visa.amount.toFixed(2), pct(agg.credit.breakdown.visa.amount, agg.credit.amount)])
  rows.push(['Mastercard', String(agg.credit.breakdown.mastercard.count), agg.credit.breakdown.mastercard.amount.toFixed(2), pct(agg.credit.breakdown.mastercard.amount, agg.credit.amount)])
  rows.push(['Amex', String(agg.credit.breakdown.amex.count), agg.credit.breakdown.amex.amount.toFixed(2), pct(agg.credit.breakdown.amex.amount, agg.credit.amount)])
  rows.push(['Discover', String(agg.credit.breakdown.discover.count), agg.credit.breakdown.discover.amount.toFixed(2), pct(agg.credit.breakdown.discover.amount, agg.credit.amount)])
  rows.push(['Other', String(agg.credit.breakdown.other.count), agg.credit.breakdown.other.amount.toFixed(2), pct(agg.credit.breakdown.other.amount, agg.credit.amount)])

  rows.push([])
  rows.push(['Date', 'Cash', 'Credit', 'Gift', 'House Account', 'Other', 'Total'])
  for (const day of days) {
    rows.push([
      day.date,
      day.payments.cash.amount.toFixed(2),
      day.payments.credit.amount.toFixed(2),
      day.payments.gift.amount.toFixed(2),
      day.payments.houseAccount.amount.toFixed(2),
      day.payments.other.amount.toFixed(2),
      day.payments.totalPayments.toFixed(2),
    ])
  }

  const csv = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `payment-methods-${startDate}-to-${endDate}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

type PresetRange = 'today' | 'yesterday' | 'this_week' | 'custom'

export default function PaymentMethodsReportPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/payment-methods' })
  const employee = useAuthStore(s => s.employee)
  const { retentionDays, venueSlug } = useDataRetention()
  const [days, setDays] = useState<DayPaymentData[]>([])
  const [agg, setAgg] = useState<AggregatedPayments>(emptyAgg())
  const [isLoading, setIsLoading] = useState(false)
  const [preset, setPreset] = useState<PresetRange>('today')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0])
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

  const applyPreset = (p: PresetRange) => {
    setPreset(p)
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    if (p === 'today') {
      setStartDate(todayStr)
      setEndDate(todayStr)
    } else if (p === 'yesterday') {
      const y = new Date(today)
      y.setDate(y.getDate() - 1)
      const yStr = y.toISOString().split('T')[0]
      setStartDate(yStr)
      setEndDate(yStr)
    } else if (p === 'this_week') {
      const dayOfWeek = today.getDay()
      const monday = new Date(today)
      monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
      setStartDate(monday.toISOString().split('T')[0])
      setEndDate(todayStr)
    }
  }

  const loadReport = async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const dates = getDatesInRange(startDate, endDate)

      const fetchDay = async (date: string): Promise<DayPaymentData> => {
        try {
          const res = await fetch(
            `/api/reports/daily?locationId=${employee!.location!.id}&date=${date}&employeeId=${employee!.id}`
          )
          if (res.ok) {
            const data = await res.json()
            const r = data.data
            if (r?.payments) {
              return { date, payments: r.payments }
            }
          }
        } catch {}
        return {
          date,
          payments: {
            cash: { count: 0, amount: 0, tips: 0 },
            credit: {
              count: 0, amount: 0, tips: 0,
              breakdown: {
                visa: { count: 0, amount: 0 },
                mastercard: { count: 0, amount: 0 },
                amex: { count: 0, amount: 0 },
                discover: { count: 0, amount: 0 },
                other: { count: 0, amount: 0 },
              },
            },
            gift: { count: 0, amount: 0 },
            houseAccount: { count: 0, amount: 0 },
            other: { count: 0, amount: 0 },
            totalPayments: 0,
          },
        }
      }

      const results = await Promise.all(dates.map(fetchDay))
      setDays(results)
      setAgg(aggregatePayments(results))
    } catch (error) {
      console.error('Failed to load payment methods report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useReportAutoRefresh({ onRefresh: loadReport })

  useEffect(() => {
    if (employee?.location?.id) {
      loadReport()
    }
  }, [employee?.location?.id])

  if (!hydrated) return null

  const methodColors: Record<string, string> = {
    cash: 'text-green-600',
    credit: 'text-blue-600',
    gift: 'text-purple-600',
    houseAccount: 'text-orange-600',
    other: 'text-gray-600',
  }

  const brandLabels: { key: keyof AggregatedPayments['credit']['breakdown']; label: string; color: string }[] = [
    { key: 'visa', label: 'Visa', color: 'bg-blue-500' },
    { key: 'mastercard', label: 'Mastercard', color: 'bg-red-500' },
    { key: 'amex', label: 'Amex', color: 'bg-indigo-500' },
    { key: 'discover', label: 'Discover', color: 'bg-orange-500' },
    { key: 'other', label: 'Other', color: 'bg-gray-400' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Payment Methods Report"
        subtitle={employee?.location?.name}
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
        actions={
          <Button
            variant="outline"
            disabled={!agg || agg.totalPayments === 0}
            onClick={() => exportPaymentMethodsCSV(agg, days, startDate, endDate)}
          >
            Export CSV
          </Button>
        }
      />

      <div className="max-w-6xl mx-auto">
        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex gap-2">
                {([
                  ['today', 'Today'],
                  ['yesterday', 'Yesterday'],
                  ['this_week', 'This Week'],
                  ['custom', 'Custom'],
                ] as const).map(([value, label]) => (
                  <Button
                    key={value}
                    variant={preset === value ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => applyPreset(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {preset === 'custom' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-1">End Date</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </>
              )}
              <Button variant="primary" onClick={loadReport} disabled={isLoading}>
                {isLoading ? 'Loading...' : 'Apply'}
              </Button>
              <div className="flex-1" />
              <div className="text-sm text-gray-900">
                {startDate === endDate ? startDate : `${startDate} to ${endDate}`}
              </div>
            </div>
          </CardContent>
        </Card>

        <WebReportBanner
          startDate={startDate}
          endDate={endDate}
          reportType="payment-methods"
          retentionDays={retentionDays}
          venueSlug={venueSlug}
        />

        {isLoading ? (
          <div className="text-center py-12 text-gray-900">Loading payment methods data...</div>
        ) : agg.totalPayments === 0 ? (
          <div className="text-center py-12 text-gray-900">No payment data for this period</div>
        ) : (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-900">Cash</p>
                  <p className={`text-xl font-bold ${methodColors.cash}`}>{formatCurrency(agg.cash.amount)}</p>
                  <p className="text-xs text-gray-900">{agg.cash.count} txns &middot; {pct(agg.cash.amount, agg.totalPayments)}%</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-900">Credit Card</p>
                  <p className={`text-xl font-bold ${methodColors.credit}`}>{formatCurrency(agg.credit.amount)}</p>
                  <p className="text-xs text-gray-900">{agg.credit.count} txns &middot; {pct(agg.credit.amount, agg.totalPayments)}%</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-900">Gift Card</p>
                  <p className={`text-xl font-bold ${methodColors.gift}`}>{formatCurrency(agg.gift.amount)}</p>
                  <p className="text-xs text-gray-900">{agg.gift.count} txns &middot; {pct(agg.gift.amount, agg.totalPayments)}%</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-900">House Account</p>
                  <p className={`text-xl font-bold ${methodColors.houseAccount}`}>{formatCurrency(agg.houseAccount.amount)}</p>
                  <p className="text-xs text-gray-900">{agg.houseAccount.count} txns &middot; {pct(agg.houseAccount.amount, agg.totalPayments)}%</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-900">Other</p>
                  <p className={`text-xl font-bold ${methodColors.other}`}>{formatCurrency(agg.other.amount)}</p>
                  <p className="text-xs text-gray-900">{agg.other.count} txns &middot; {pct(agg.other.amount, agg.totalPayments)}%</p>
                </CardContent>
              </Card>
            </div>

            {/* Total & Tips */}
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-900">Total Payments</p>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(agg.totalPayments)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-900">Total Tips</p>
                  <p className="text-2xl font-bold text-orange-600">{formatCurrency(agg.totalTips)}</p>
                  <p className="text-xs text-gray-900">
                    Cash tips: {formatCurrency(agg.cash.tips)} &middot; Card tips: {formatCurrency(agg.credit.tips)}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Credit Card Brand Breakdown */}
            {agg.credit.count > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Credit Card Brand Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {brandLabels.map(({ key, label, color }) => {
                      const brand = agg.credit.breakdown[key]
                      if (brand.count === 0) return null
                      const barPct = agg.credit.amount > 0 ? (brand.amount / agg.credit.amount) * 100 : 0
                      return (
                        <div key={key}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-gray-900">{label}</span>
                            <span className="text-sm text-gray-600">
                              {formatCurrency(brand.amount)} ({brand.count} txns) &middot; {pct(brand.amount, agg.credit.amount)}%
                            </span>
                          </div>
                          <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${color} rounded-full transition-all`}
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Tips by Payment Method */}
            <Card>
              <CardHeader>
                <CardTitle>Tips by Payment Method</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-900">Method</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-900">Transactions</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-900">Amount</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-900">Tips</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-900">Tip %</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-900">% of Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-green-600">Cash</td>
                        <td className="px-4 py-3 text-right text-gray-600">{agg.cash.count}</td>
                        <td className="px-4 py-3 text-right font-medium">{formatCurrency(agg.cash.amount)}</td>
                        <td className="px-4 py-3 text-right text-orange-600">{formatCurrency(agg.cash.tips)}</td>
                        <td className="px-4 py-3 text-right text-gray-900">{agg.cash.amount > 0 ? pct(agg.cash.tips, agg.cash.amount) : '0.0'}%</td>
                        <td className="px-4 py-3 text-right text-gray-900">{pct(agg.cash.amount, agg.totalPayments)}%</td>
                      </tr>
                      <tr className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-blue-600">Credit Card</td>
                        <td className="px-4 py-3 text-right text-gray-600">{agg.credit.count}</td>
                        <td className="px-4 py-3 text-right font-medium">{formatCurrency(agg.credit.amount)}</td>
                        <td className="px-4 py-3 text-right text-orange-600">{formatCurrency(agg.credit.tips)}</td>
                        <td className="px-4 py-3 text-right text-gray-900">{agg.credit.amount > 0 ? pct(agg.credit.tips, agg.credit.amount) : '0.0'}%</td>
                        <td className="px-4 py-3 text-right text-gray-900">{pct(agg.credit.amount, agg.totalPayments)}%</td>
                      </tr>
                      {agg.gift.count > 0 && (
                        <tr className="border-t hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-purple-600">Gift Card</td>
                          <td className="px-4 py-3 text-right text-gray-600">{agg.gift.count}</td>
                          <td className="px-4 py-3 text-right font-medium">{formatCurrency(agg.gift.amount)}</td>
                          <td className="px-4 py-3 text-right text-gray-900">--</td>
                          <td className="px-4 py-3 text-right text-gray-900">--</td>
                          <td className="px-4 py-3 text-right text-gray-900">{pct(agg.gift.amount, agg.totalPayments)}%</td>
                        </tr>
                      )}
                      {agg.houseAccount.count > 0 && (
                        <tr className="border-t hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-orange-600">House Account</td>
                          <td className="px-4 py-3 text-right text-gray-600">{agg.houseAccount.count}</td>
                          <td className="px-4 py-3 text-right font-medium">{formatCurrency(agg.houseAccount.amount)}</td>
                          <td className="px-4 py-3 text-right text-gray-900">--</td>
                          <td className="px-4 py-3 text-right text-gray-900">--</td>
                          <td className="px-4 py-3 text-right text-gray-900">{pct(agg.houseAccount.amount, agg.totalPayments)}%</td>
                        </tr>
                      )}
                      {agg.other.count > 0 && (
                        <tr className="border-t hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-600">Other</td>
                          <td className="px-4 py-3 text-right text-gray-600">{agg.other.count}</td>
                          <td className="px-4 py-3 text-right font-medium">{formatCurrency(agg.other.amount)}</td>
                          <td className="px-4 py-3 text-right text-gray-900">--</td>
                          <td className="px-4 py-3 text-right text-gray-900">--</td>
                          <td className="px-4 py-3 text-right text-gray-900">{pct(agg.other.amount, agg.totalPayments)}%</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot className="bg-gray-100 font-bold">
                      <tr>
                        <td className="px-4 py-3">Total</td>
                        <td className="px-4 py-3 text-right">{agg.cash.count + agg.credit.count + agg.gift.count + agg.houseAccount.count + agg.other.count}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(agg.totalPayments)}</td>
                        <td className="px-4 py-3 text-right text-orange-600">{formatCurrency(agg.totalTips)}</td>
                        <td className="px-4 py-3 text-right">{agg.totalPayments > 0 ? pct(agg.totalTips, agg.totalPayments) : '0.0'}%</td>
                        <td className="px-4 py-3 text-right">100.0%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Daily Breakdown Table */}
            {days.length > 1 && (
              <Card>
                <CardHeader>
                  <CardTitle>Daily Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-900">Date</th>
                          <th className="px-4 py-3 text-right text-sm font-medium text-gray-900">Cash</th>
                          <th className="px-4 py-3 text-right text-sm font-medium text-gray-900">Credit</th>
                          <th className="px-4 py-3 text-right text-sm font-medium text-gray-900">Gift</th>
                          <th className="px-4 py-3 text-right text-sm font-medium text-gray-900">House Acct</th>
                          <th className="px-4 py-3 text-right text-sm font-medium text-gray-900">Other</th>
                          <th className="px-4 py-3 text-right text-sm font-medium text-gray-900">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {days.map(day => (
                          <tr key={day.date} className="border-t hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium">
                              {new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                            </td>
                            <td className="px-4 py-3 text-right text-green-600">{formatCurrency(day.payments.cash.amount)}</td>
                            <td className="px-4 py-3 text-right text-blue-600">{formatCurrency(day.payments.credit.amount)}</td>
                            <td className="px-4 py-3 text-right text-purple-600">{formatCurrency(day.payments.gift.amount)}</td>
                            <td className="px-4 py-3 text-right text-orange-600">{formatCurrency(day.payments.houseAccount.amount)}</td>
                            <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(day.payments.other.amount)}</td>
                            <td className="px-4 py-3 text-right font-bold">{formatCurrency(day.payments.totalPayments)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-100 font-bold">
                        <tr>
                          <td className="px-4 py-3">Totals</td>
                          <td className="px-4 py-3 text-right text-green-600">{formatCurrency(agg.cash.amount)}</td>
                          <td className="px-4 py-3 text-right text-blue-600">{formatCurrency(agg.credit.amount)}</td>
                          <td className="px-4 py-3 text-right text-purple-600">{formatCurrency(agg.gift.amount)}</td>
                          <td className="px-4 py-3 text-right text-orange-600">{formatCurrency(agg.houseAccount.amount)}</td>
                          <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(agg.other.amount)}</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(agg.totalPayments)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Footer */}
            <div className="text-center text-xs text-gray-900 pt-4">
              Generated on {new Date().toLocaleString()}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
