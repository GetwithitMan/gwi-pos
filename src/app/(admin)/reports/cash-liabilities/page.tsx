'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface CashLiabilitiesReport {
  cash: {
    totalOnHand: number
    paidIn: number
    paidOut: number
    drawers: { shiftId: string; employee: string; startingCash: number; cashSales: number; estimated: number }[]
  }
  houseAccounts: {
    total: number
    count: number
    accounts: { id: string; name: string; balance: number; creditLimit: number }[]
  }
  giftCards: {
    total: number
    count: number
    activeCount: number
    cards: { id: string; cardNumber: string; balance: number }[]
  }
  tips: {
    total: number
    balances: { employeeId: string; employee: string; balance: number }[]
  }
  variance: {
    total: number
    recent: { shiftId: string; employee: string; variance: number; date: string | null }[]
  }
  totals: {
    totalCash: number
    totalLiabilities: number
    netPosition: number
  }
}

function exportCashLiabilitiesCSV(report: CashLiabilitiesReport) {
  const rows: string[][] = []
  rows.push(['Section', 'Item', 'Amount'])
  rows.push(['Cash', 'Total On Hand', report.cash.totalOnHand.toFixed(2)])
  rows.push(['Cash', 'Paid In', report.cash.paidIn.toFixed(2)])
  rows.push(['Cash', 'Paid Out', report.cash.paidOut.toFixed(2)])
  report.cash.drawers.forEach(d => {
    rows.push(['Cash Drawer', `"${d.employee}"`, d.estimated.toFixed(2)])
  })
  rows.push([])
  rows.push(['House Accounts'])
  report.houseAccounts.accounts.forEach(ha => {
    rows.push(['House Account', `"${ha.name}"`, ha.balance.toFixed(2)])
  })
  rows.push(['House Accounts', 'Total', report.houseAccounts.total.toFixed(2)])
  rows.push([])
  rows.push(['Gift Cards'])
  report.giftCards.cards.forEach(gc => {
    rows.push(['Gift Card', gc.cardNumber, gc.balance.toFixed(2)])
  })
  rows.push(['Gift Cards', 'Total', report.giftCards.total.toFixed(2)])
  rows.push([])
  rows.push(['Tip Balances'])
  report.tips.balances.forEach(tb => {
    rows.push(['Tip Balance', `"${tb.employee}"`, tb.balance.toFixed(2)])
  })
  rows.push(['Tips', 'Total', report.tips.total.toFixed(2)])
  rows.push([])
  rows.push(['Totals', 'Cash On Hand', report.totals.totalCash.toFixed(2)])
  rows.push(['Totals', 'Total Liabilities', report.totals.totalLiabilities.toFixed(2)])
  rows.push(['Totals', 'Net Position', report.totals.netPosition.toFixed(2)])
  const csv = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `cash-liabilities-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function CashLiabilitiesPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/cash-liabilities' })
  const employee = useAuthStore(s => s.employee)
  const [report, setReport] = useState<CashLiabilitiesReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (employee?.location?.id) {
      loadReport()
    }
  }, [employee?.location?.id])

  const loadReport = async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const response = await fetch(`/api/reports/cash-liabilities?locationId=${employee.location.id}`)
      if (response.ok) {
        const data = await response.json()
        setReport(data.data)
      }
    } catch (error) {
      console.error('Failed to load cash liabilities report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Cash-Flow & Liabilities"
        subtitle={employee?.location?.name}
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={!report}
              onClick={() => report && exportCashLiabilitiesCSV(report)}
            >
              Export CSV
            </Button>
            <Button variant="outline" onClick={loadReport} disabled={isLoading}>
              {isLoading ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        }
      />

      <div className="max-w-6xl mx-auto">
        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Loading report...</div>
        ) : !report ? (
          <div className="text-center py-12 text-gray-500">No data available</div>
        ) : (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-6">
                  <p className="text-sm text-gray-500">Total Cash on Hand</p>
                  <p className="text-3xl font-bold text-green-600">{formatCurrency(report.totals.totalCash)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <p className="text-sm text-gray-500">Total Liabilities</p>
                  <p className="text-3xl font-bold text-red-600">{formatCurrency(report.totals.totalLiabilities)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <p className="text-sm text-gray-500">Net Position</p>
                  <p className={`text-3xl font-bold ${report.totals.netPosition >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(report.totals.netPosition)}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Cash Drawers */}
            <Card>
              <CardHeader>
                <CardTitle>Cash Drawers</CardTitle>
              </CardHeader>
              <CardContent>
                {report.cash.drawers.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No active cash drawers</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Employee</th>
                          <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Starting Cash</th>
                          <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Cash Sales</th>
                          <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Estimated Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.cash.drawers.map(d => (
                          <tr key={d.shiftId} className="border-t hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium">{d.employee}</td>
                            <td className="px-4 py-3 text-right">{formatCurrency(d.startingCash)}</td>
                            <td className="px-4 py-3 text-right">{formatCurrency(d.cashSales)}</td>
                            <td className="px-4 py-3 text-right font-bold text-green-600">{formatCurrency(d.estimated)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="mt-4 flex justify-between font-mono text-sm border-t pt-3">
                  <span>Paid In: <span className="text-green-600">{formatCurrency(report.cash.paidIn)}</span></span>
                  <span>Paid Out: <span className="text-red-600">{formatCurrency(report.cash.paidOut)}</span></span>
                  <span className="font-bold">Net Cash: {formatCurrency(report.totals.totalCash)}</span>
                </div>
              </CardContent>
            </Card>

            {/* House Accounts */}
            <Card>
              <CardHeader>
                <CardTitle>
                  House Accounts
                  <span className="text-sm font-normal text-gray-500 ml-2">({report.houseAccounts.count} accounts)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {report.houseAccounts.accounts.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No active house accounts</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Account</th>
                          <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Balance Owed</th>
                          <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Credit Limit</th>
                          <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Available</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.houseAccounts.accounts.map(ha => (
                          <tr key={ha.id} className="border-t hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium">{ha.name}</td>
                            <td className="px-4 py-3 text-right text-red-600 font-medium">{formatCurrency(ha.balance)}</td>
                            <td className="px-4 py-3 text-right text-gray-500">{formatCurrency(ha.creditLimit)}</td>
                            <td className="px-4 py-3 text-right">{formatCurrency(ha.creditLimit - ha.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-100">
                        <tr>
                          <td className="px-4 py-3 font-bold">Total</td>
                          <td className="px-4 py-3 text-right font-bold text-red-600">
                            {formatCurrency(report.houseAccounts.total)}
                          </td>
                          <td className="px-4 py-3" colSpan={2} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Gift Cards */}
            <Card>
              <CardHeader>
                <CardTitle>
                  Gift Cards
                  <span className="text-sm font-normal text-gray-500 ml-2">
                    ({report.giftCards.activeCount} active of {report.giftCards.count})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {report.giftCards.cards.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No active gift card balances</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Card Number</th>
                          <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.giftCards.cards.map(gc => (
                          <tr key={gc.id} className="border-t hover:bg-gray-50">
                            <td className="px-4 py-3 font-mono">{gc.cardNumber}</td>
                            <td className="px-4 py-3 text-right font-medium text-blue-600">{formatCurrency(gc.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-100">
                        <tr>
                          <td className="px-4 py-3 font-bold">Total Liability</td>
                          <td className="px-4 py-3 text-right font-bold text-red-600">{formatCurrency(report.giftCards.total)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Tip Balances */}
            <Card>
              <CardHeader>
                <CardTitle>Unpaid Tip Balances</CardTitle>
              </CardHeader>
              <CardContent>
                {report.tips.balances.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No unpaid tip balances</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Employee</th>
                          <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Balance Owed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.tips.balances.map(tb => (
                          <tr key={tb.employeeId} className="border-t hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium">{tb.employee}</td>
                            <td className="px-4 py-3 text-right text-orange-600 font-medium">{formatCurrency(tb.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-100">
                        <tr>
                          <td className="px-4 py-3 font-bold">Total</td>
                          <td className="px-4 py-3 text-right font-bold text-red-600">{formatCurrency(report.tips.total)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Over/Short Variance */}
            {report.variance.recent.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Recent Cash Drawer Variances</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Employee</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Date</th>
                          <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Over / Short</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.variance.recent.map(v => (
                          <tr key={v.shiftId} className="border-t hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium">{v.employee}</td>
                            <td className="px-4 py-3 text-gray-500">
                              {v.date ? new Date(v.date).toLocaleDateString() : '—'}
                            </td>
                            <td className={`px-4 py-3 text-right font-medium ${v.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {v.variance >= 0 ? '+' : ''}{formatCurrency(v.variance)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-100">
                        <tr>
                          <td className="px-4 py-3 font-bold" colSpan={2}>Net Variance</td>
                          <td className={`px-4 py-3 text-right font-bold ${report.variance.total >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {report.variance.total >= 0 ? '+' : ''}{formatCurrency(report.variance.total)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Footer */}
            <div className="text-center text-xs text-gray-500 pt-4">
              Generated on {new Date().toLocaleString()}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
