'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'

interface TipShare {
  id: string
  date: string
  fromEmployee: string
  fromRole: string
  toEmployee: string
  toRole: string
  amount: number
  shareType: string
  percentage: number | null
  status: string
}

interface TipEmployee {
  employeeId: string
  employeeName: string
  role: string
  shifts: number
  grossTips: number
  givenTips: number
  receivedTips: number
  netTips: number
}

interface TipsReport {
  byEmployee: TipEmployee[]
  tipShares: TipShare[]
  summary: { totalGross: number; totalGiven: number; totalReceived: number; totalNet: number; pendingBanked: number; collected: number; paidOut: number }
}

function getDefaultDateRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 7)
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  }
}

export default function CrewTipsReportPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const [dateRange, setDateRange] = useState(getDefaultDateRange)
  const [report, setReport] = useState<TipsReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!employee || !isAuthenticated) {
      router.push('/login')
    }
  }, [employee, isAuthenticated, router])

  useEffect(() => {
    if (!employee) return
    setLoading(true)
    setError(null)
    fetch(`/api/reports/tips?employeeId=${employee.id}&locationId=${employee.location.id}&startDate=${dateRange.start}&endDate=${dateRange.end}&requestingEmployeeId=${employee.id}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load tips report')
        return res.json()
      })
      .then(data => setReport(data.data || data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [employee, dateRange])

  if (!employee || !isAuthenticated) return null

  const myData = report?.byEmployee?.[0]

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Back Button */}
        <button onClick={() => router.push('/crew')} className="flex items-center gap-2 text-white/60 hover:text-white transition-all mb-6">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Crew Hub
        </button>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h1 className="text-2xl font-bold text-white">My Tips</h1>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateRange.start}
              onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="bg-white/10 border border-white/20 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50"
            />
            <span className="text-white/40">to</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="bg-white/10 border border-white/20 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50"
            />
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-400" />
            <span className="ml-3 text-white/60">Loading tips data...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 text-center">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {!loading && !error && report && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-4 text-center">
                <div className="text-white/40 text-xs mb-1">Gross Tips</div>
                <div className="text-white font-bold text-lg">{formatCurrency(myData?.grossTips ?? 0)}</div>
              </div>
              <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-4 text-center">
                <div className="text-white/40 text-xs mb-1">Tip-Outs Given</div>
                <div className="text-red-400 font-bold text-lg">{formatCurrency(myData?.givenTips ?? 0)}</div>
              </div>
              <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-4 text-center">
                <div className="text-white/40 text-xs mb-1">Tip-Outs Received</div>
                <div className="text-emerald-400 font-bold text-lg">{formatCurrency(myData?.receivedTips ?? 0)}</div>
              </div>
              <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-4 text-center">
                <div className="text-white/40 text-xs mb-1">Net Tips</div>
                <div className="text-white font-bold text-lg">{formatCurrency(myData?.netTips ?? 0)}</div>
              </div>
            </div>

            {/* Tip Shares Table */}
            {report.tipShares.length > 0 ? (
              <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-6">
                <h3 className="text-white font-semibold mb-4">Tip Share Details</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-white/40 text-xs uppercase tracking-wider border-b border-white/10">
                        <th className="text-left py-2 pr-4">Date</th>
                        <th className="text-left py-2 pr-4">From / To</th>
                        <th className="text-left py-2 pr-4">Type</th>
                        <th className="text-right py-2 pr-4">Amount</th>
                        <th className="text-right py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.tipShares.map(share => {
                        const isReceived = share.toEmployee === employee.displayName
                        return (
                          <tr key={share.id} className="border-b border-white/5">
                            <td className="py-3 pr-4 text-white/60">
                              {new Date(share.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </td>
                            <td className="py-3 pr-4">
                              {isReceived ? (
                                <span className="text-white/80">From: {share.fromEmployee} <span className="text-white/30">({share.fromRole})</span></span>
                              ) : (
                                <span className="text-white/80">To: {share.toEmployee} <span className="text-white/30">({share.toRole})</span></span>
                              )}
                            </td>
                            <td className="py-3 pr-4 text-white/60">{share.shareType}</td>
                            <td className={`py-3 pr-4 text-right font-medium ${isReceived ? 'text-emerald-400' : 'text-red-400'}`}>
                              {isReceived ? '+' : '-'}{formatCurrency(share.amount)}
                            </td>
                            <td className="py-3 text-right">
                              <span className={`px-2 py-0.5 rounded-full text-xs ${
                                share.status === 'paid' ? 'bg-emerald-500/20 text-emerald-400' :
                                share.status === 'pending' ? 'bg-amber-500/20 text-amber-400' :
                                'bg-white/10 text-white/50'
                              }`}>
                                {share.status}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-12 text-center">
                <p className="text-white/40">No tip share records for this period.</p>
              </div>
            )}
          </>
        )}

        {!loading && !error && !report && (
          <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-12 text-center">
            <p className="text-white/40">No tips data found for this period.</p>
          </div>
        )}
      </div>
    </div>
  )
}
