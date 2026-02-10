'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'

interface ShiftReport {
  employee: { id: string; name: string; role: string }
  shift: { id: string | null; clockIn: string; clockOut: string; hours: number; hourlyRate: number; laborCost: number }
  summary: { totalSales: number; hours: number; laborCost: number; checks: number; avgCheck: number; tips: number; discounts: number; voids: number; cashDue: number; creditTips: number }
  revenue: { adjustedGrossSales: number; discounts: number; netSales: number; salesTax: number; surcharge: number; grossSales: number; tips: number; gratuity: number; refunds: number; totalCollected: number; commission: number }
  payments: { cash: { count: number; amount: number }; credit: { count: number; amount: number; tips: number; brands: Record<string, { count: number; amount: number }> }; gift: { count: number; amount: number }; houseAccount: { count: number; amount: number } }
  tipShares?: { given: { recipientName: string; recipientRole: string; amount: number; type: string }[]; received: { fromName: string; fromRole: string; amount: number; type: string; status: string }[]; netTips: number }
}

export default function CrewShiftReportPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0])
  const [report, setReport] = useState<ShiftReport | null>(null)
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
    fetch(`/api/reports/employee-shift?employeeId=${employee.id}&locationId=${employee.location.id}&date=${selectedDate}&requestingEmployeeId=${employee.id}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load shift report')
        return res.json()
      })
      .then(data => setReport(data.data || data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [employee, selectedDate])

  if (!employee || !isAuthenticated) return null

  const formatShiftTime = (iso: string | null | undefined) => {
    if (!iso) return '--'
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }

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
          <h1 className="text-2xl font-bold text-white">My Shift Report</h1>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="bg-white/10 border border-white/20 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
          />
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400" />
            <span className="ml-3 text-white/60">Loading shift data...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 text-center">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {!loading && !error && report && (
          <>
            {/* Employee Header Card */}
            <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-6 mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-white font-semibold text-lg">{report.employee.name}</h2>
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-purple-500/20 text-purple-400">
                    {report.employee.role}
                  </span>
                </div>
                <div className="text-right text-sm">
                  <div className="text-white/60">
                    {formatShiftTime(report.shift.clockIn)} - {formatShiftTime(report.shift.clockOut)}
                  </div>
                  <div className="text-white font-semibold">{report.shift.hours?.toFixed(2) || '0.00'} hours</div>
                </div>
              </div>
            </div>

            {/* Summary Bar */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-4 text-center">
                <div className="text-white/40 text-xs mb-1">Total Sales</div>
                <div className="text-white font-bold text-lg">{formatCurrency(report.summary.totalSales)}</div>
              </div>
              <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-4 text-center">
                <div className="text-white/40 text-xs mb-1">Tips</div>
                <div className="text-emerald-400 font-bold text-lg">{formatCurrency(report.summary.tips)}</div>
              </div>
              <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-4 text-center">
                <div className="text-white/40 text-xs mb-1">Cash Due</div>
                <div className="text-amber-400 font-bold text-lg">{formatCurrency(report.summary.cashDue)}</div>
              </div>
            </div>

            {/* Revenue Section */}
            <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-6 mb-4">
              <h3 className="text-white font-semibold mb-4">Revenue</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-white/60">Net Sales</span><span className="text-white">{formatCurrency(report.revenue.netSales)}</span></div>
                <div className="flex justify-between"><span className="text-white/60">Sales Tax</span><span className="text-white">{formatCurrency(report.revenue.salesTax)}</span></div>
                <div className="flex justify-between"><span className="text-white/60">Tips</span><span className="text-white">{formatCurrency(report.revenue.tips)}</span></div>
                {report.revenue.surcharge > 0 && (
                  <div className="flex justify-between"><span className="text-white/60">Surcharge</span><span className="text-white">{formatCurrency(report.revenue.surcharge)}</span></div>
                )}
                {report.revenue.discounts > 0 && (
                  <div className="flex justify-between"><span className="text-white/60">Discounts</span><span className="text-red-400">-{formatCurrency(report.revenue.discounts)}</span></div>
                )}
                {report.revenue.refunds > 0 && (
                  <div className="flex justify-between"><span className="text-white/60">Refunds</span><span className="text-red-400">-{formatCurrency(report.revenue.refunds)}</span></div>
                )}
                <div className="flex justify-between border-t border-white/10 pt-2 mt-2">
                  <span className="text-white font-semibold">Total Collected</span>
                  <span className="text-white font-semibold">{formatCurrency(report.revenue.totalCollected)}</span>
                </div>
              </div>
            </div>

            {/* Payments Section */}
            <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-6 mb-4">
              <h3 className="text-white font-semibold mb-4">Payments</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/60">Cash ({report.payments.cash.count})</span>
                  <span className="text-white">{formatCurrency(report.payments.cash.amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">Credit ({report.payments.credit.count})</span>
                  <span className="text-white">{formatCurrency(report.payments.credit.amount)}</span>
                </div>
                {report.payments.credit.brands && Object.entries(report.payments.credit.brands).map(([brand, data]) => (
                  <div key={brand} className="flex justify-between pl-4">
                    <span className="text-white/40">{brand} ({data.count})</span>
                    <span className="text-white/80">{formatCurrency(data.amount)}</span>
                  </div>
                ))}
                {report.payments.gift.count > 0 && (
                  <div className="flex justify-between">
                    <span className="text-white/60">Gift Card ({report.payments.gift.count})</span>
                    <span className="text-white">{formatCurrency(report.payments.gift.amount)}</span>
                  </div>
                )}
                {report.payments.houseAccount.count > 0 && (
                  <div className="flex justify-between">
                    <span className="text-white/60">House Account ({report.payments.houseAccount.count})</span>
                    <span className="text-white">{formatCurrency(report.payments.houseAccount.amount)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Tip Shares Section */}
            {report.tipShares && (
              <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-6">
                <h3 className="text-white font-semibold mb-4">Tip Shares</h3>

                {report.tipShares.given.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-white/60 text-xs uppercase tracking-wider mb-2">Tip-Outs Given</h4>
                    <div className="space-y-1 text-sm">
                      {report.tipShares.given.map((g, i) => (
                        <div key={i} className="flex justify-between">
                          <span className="text-white/60">{g.recipientName} <span className="text-white/30">({g.recipientRole})</span></span>
                          <span className="text-red-400">-{formatCurrency(g.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {report.tipShares.received.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-white/60 text-xs uppercase tracking-wider mb-2">Tip-Outs Received</h4>
                    <div className="space-y-1 text-sm">
                      {report.tipShares.received.map((r, i) => (
                        <div key={i} className="flex justify-between">
                          <span className="text-white/60">{r.fromName} <span className="text-white/30">({r.fromRole})</span></span>
                          <span className="text-emerald-400">+{formatCurrency(r.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-between border-t border-white/10 pt-3 mt-3">
                  <span className="text-white font-semibold">Net Tips</span>
                  <span className="text-emerald-400 font-semibold">{formatCurrency(report.tipShares.netTips)}</span>
                </div>
              </div>
            )}
          </>
        )}

        {!loading && !error && !report && (
          <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-12 text-center">
            <p className="text-white/40">No shift data found for this date.</p>
          </div>
        )}
      </div>
    </div>
  )
}
