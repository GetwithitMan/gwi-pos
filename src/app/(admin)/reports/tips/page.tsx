'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'

interface EmployeeTipSummary {
  employeeId: string
  employeeName: string
  roleName: string
  grossTips: number
  tipOutsGiven: number
  tipOutsReceived: number
  netTips: number
  shiftCount: number
}

interface TipShare {
  id: string
  from: string
  fromRole: string
  to: string
  toRole: string
  amount: number
  type: 'role_tipout' | 'custom' | 'pool'
  percentage: number | null
  status: string
  date: string
  shiftDate: string | null
}

interface BankedTip {
  id: string
  employeeId: string
  employeeName: string
  roleName: string
  amount: number
  status: string
  source: string
  fromEmployee: string | null
  createdAt: string
  collectedAt: string | null
  paidOutAt: string | null
}

interface TipsReport {
  byEmployee: EmployeeTipSummary[]
  tipShares: TipShare[]
  bankedTips: BankedTip[]
  summary: {
    totalGrossTips: number
    totalTipOuts: number
    totalBanked: number
    totalCollected: number
    totalPaidOut: number
  }
}

type TabType = 'summary' | 'shares' | 'banked'

export default function TipsReportPage() {
  const router = useRouter()
  const { isAuthenticated, employee } = useAuthStore()
  const [report, setReport] = useState<TipsReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>('summary')
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
      router.push('/login?redirect=/reports/tips')
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

      const response = await fetch(`/api/reports/tips?${params}`)
      if (response.ok) {
        const data = await response.json()
        setReport(data)
      }
    } catch (error) {
      console.error('Failed to load tips report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800'
      case 'collected': return 'bg-green-100 text-green-800'
      case 'banked': return 'bg-blue-100 text-blue-800'
      case 'paid_out': return 'bg-gray-100 text-gray-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'role_tipout': return 'Role Tip-Out'
      case 'custom': return 'Custom Share'
      case 'pool': return 'Tip Pool'
      default: return type
    }
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/reports" className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <h1 className="text-2xl font-bold">Tips Report</h1>
        </div>
        <Link href="/settings/tip-outs">
          <Button variant="outline">Configure Tip-Outs</Button>
        </Link>
      </header>

      <div className="p-6 max-w-6xl mx-auto">
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

        {/* Summary Cards */}
        {report && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-gray-500">Gross Tips</p>
                <p className="text-2xl font-bold text-green-600">
                  {formatCurrency(report.summary.totalGrossTips)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-gray-500">Tip-Outs</p>
                <p className="text-2xl font-bold text-blue-600">
                  {formatCurrency(report.summary.totalTipOuts)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-gray-500">Pending Banked</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {formatCurrency(report.summary.totalBanked)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-gray-500">Collected</p>
                <p className="text-2xl font-bold text-gray-600">
                  {formatCurrency(report.summary.totalCollected)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-gray-500">Paid Out</p>
                <p className="text-2xl font-bold text-gray-600">
                  {formatCurrency(report.summary.totalPaidOut)}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tabs */}
        <div className="mb-4 border-b">
          <nav className="flex gap-4">
            {(['summary', 'shares', 'banked'] as TabType[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-2 px-1 border-b-2 font-medium transition-colors ${
                  activeTab === tab
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab === 'summary' ? 'By Employee' : tab === 'shares' ? 'Tip Shares' : 'Banked Tips'}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
            <p className="text-gray-500">Loading report...</p>
          </div>
        ) : !report ? (
          <div className="text-center py-12 text-gray-500">
            No data available
          </div>
        ) : (
          <>
            {/* By Employee Tab */}
            {activeTab === 'summary' && (
              <Card>
                <CardContent className="p-0">
                  {report.byEmployee.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                      No tip data for the selected period
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-gray-50 border-b">
                            <th className="text-left px-4 py-3 font-medium text-gray-600">Employee</th>
                            <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                            <th className="text-right px-4 py-3 font-medium text-gray-600">Shifts</th>
                            <th className="text-right px-4 py-3 font-medium text-gray-600">Gross Tips</th>
                            <th className="text-right px-4 py-3 font-medium text-gray-600">Given</th>
                            <th className="text-right px-4 py-3 font-medium text-gray-600">Received</th>
                            <th className="text-right px-4 py-3 font-medium text-gray-600">Net Tips</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.byEmployee.map((emp) => (
                            <tr key={emp.employeeId} className="border-b hover:bg-gray-50">
                              <td className="px-4 py-3 font-medium">{emp.employeeName}</td>
                              <td className="px-4 py-3 text-gray-500">{emp.roleName}</td>
                              <td className="px-4 py-3 text-right">{emp.shiftCount}</td>
                              <td className="px-4 py-3 text-right text-green-600">
                                {formatCurrency(emp.grossTips)}
                              </td>
                              <td className="px-4 py-3 text-right text-red-600">
                                {emp.tipOutsGiven > 0 ? `-${formatCurrency(emp.tipOutsGiven)}` : '-'}
                              </td>
                              <td className="px-4 py-3 text-right text-blue-600">
                                {emp.tipOutsReceived > 0 ? `+${formatCurrency(emp.tipOutsReceived)}` : '-'}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold">
                                {formatCurrency(emp.netTips + emp.tipOutsReceived)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Tip Shares Tab */}
            {activeTab === 'shares' && (
              <Card>
                <CardContent className="p-0">
                  {report.tipShares.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                      No tip shares for the selected period
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-gray-50 border-b">
                            <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                            <th className="text-left px-4 py-3 font-medium text-gray-600">From</th>
                            <th className="text-left px-4 py-3 font-medium text-gray-600">To</th>
                            <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                            <th className="text-right px-4 py-3 font-medium text-gray-600">Amount</th>
                            <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.tipShares.map((share) => (
                            <tr key={share.id} className="border-b hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm text-gray-500">
                                {formatDate(share.date)}
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-medium">{share.from}</div>
                                <div className="text-xs text-gray-500">{share.fromRole}</div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-medium">{share.to}</div>
                                <div className="text-xs text-gray-500">{share.toRole}</div>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-sm">{getTypeLabel(share.type)}</span>
                                {share.percentage && (
                                  <span className="text-xs text-gray-500 ml-1">({share.percentage}%)</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right font-medium">
                                {formatCurrency(share.amount)}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(share.status)}`}>
                                  {share.status}
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
            )}

            {/* Banked Tips Tab */}
            {activeTab === 'banked' && (
              <Card>
                <CardContent className="p-0">
                  {report.bankedTips.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                      No banked tips for the selected period
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-gray-50 border-b">
                            <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                            <th className="text-left px-4 py-3 font-medium text-gray-600">Employee</th>
                            <th className="text-left px-4 py-3 font-medium text-gray-600">From</th>
                            <th className="text-right px-4 py-3 font-medium text-gray-600">Amount</th>
                            <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
                            <th className="text-left px-4 py-3 font-medium text-gray-600">Collected</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.bankedTips.map((tip) => (
                            <tr key={tip.id} className="border-b hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm text-gray-500">
                                {formatDate(tip.createdAt)}
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-medium">{tip.employeeName}</div>
                                <div className="text-xs text-gray-500">{tip.roleName}</div>
                              </td>
                              <td className="px-4 py-3 text-sm">
                                {tip.fromEmployee || '-'}
                              </td>
                              <td className="px-4 py-3 text-right font-medium">
                                {formatCurrency(tip.amount)}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(tip.status)}`}>
                                  {tip.status}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-500">
                                {tip.collectedAt ? formatDate(tip.collectedAt) : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}
