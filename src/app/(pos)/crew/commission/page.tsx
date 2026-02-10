'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'

interface CommissionOrder {
  orderId: string
  orderNumber: number
  createdAt: string
  items: { name: string; quantity: number; price: number; commissionRate: number; commission: number }[]
  totalCommission: number
}

interface CommissionEmployee {
  employeeId: string
  employeeName: string
  totalCommission: number
  orderCount: number
  orders: CommissionOrder[]
}

interface CommissionReport {
  report: CommissionEmployee[]
  summary: { totalEmployees: number; totalOrders: number; grandTotal: number }
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

export default function CrewCommissionReportPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const [dateRange, setDateRange] = useState(getDefaultDateRange)
  const [report, setReport] = useState<CommissionReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!employee || !isAuthenticated) {
      router.push('/login')
    }
  }, [employee, isAuthenticated, router])

  useEffect(() => {
    if (!employee) return
    setLoading(true)
    setError(null)
    fetch(`/api/reports/commission?employeeId=${employee.id}&locationId=${employee.location.id}&startDate=${dateRange.start}&endDate=${dateRange.end}&requestingEmployeeId=${employee.id}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load commission report')
        return res.json()
      })
      .then(data => setReport(data.data || data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [employee, dateRange])

  if (!employee || !isAuthenticated) return null

  const myData = report?.report?.[0]

  const toggleOrder = (orderId: string) => {
    setExpandedOrders(prev => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
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
          <h1 className="text-2xl font-bold text-white">My Commissions</h1>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateRange.start}
              onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="bg-white/10 border border-white/20 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
            <span className="text-white/40">to</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="bg-white/10 border border-white/20 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-400" />
            <span className="ml-3 text-white/60">Loading commission data...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 text-center">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {!loading && !error && report && (
          <>
            {/* Total Commission Card */}
            <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-8 mb-6 text-center">
              <div className="text-white/40 text-sm mb-2">Total Commission</div>
              <div className="text-amber-400 font-bold text-4xl">{formatCurrency(myData?.totalCommission ?? 0)}</div>
              <div className="text-white/30 text-sm mt-2">{myData?.orderCount ?? 0} orders</div>
            </div>

            {/* Order List */}
            {myData && myData.orders.length > 0 ? (
              <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-6">
                <h3 className="text-white font-semibold mb-4">Orders</h3>
                <div className="space-y-2">
                  {myData.orders.map(order => (
                    <div key={order.orderId} className="border border-white/5 rounded-xl overflow-hidden">
                      <button
                        onClick={() => toggleOrder(order.orderId)}
                        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors text-left"
                      >
                        <div className="flex items-center gap-4">
                          <svg
                            className={`w-4 h-4 text-white/40 transition-transform ${expandedOrders.has(order.orderId) ? 'rotate-90' : ''}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          <div>
                            <span className="text-white font-medium">Order #{order.orderNumber}</span>
                            <span className="text-white/30 text-sm ml-3">
                              {new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                        <span className="text-amber-400 font-semibold">{formatCurrency(order.totalCommission)}</span>
                      </button>

                      {expandedOrders.has(order.orderId) && (
                        <div className="border-t border-white/5 px-4 pb-4">
                          <table className="w-full text-sm mt-3">
                            <thead>
                              <tr className="text-white/30 text-xs uppercase tracking-wider">
                                <th className="text-left py-1">Item</th>
                                <th className="text-right py-1">Qty</th>
                                <th className="text-right py-1">Price</th>
                                <th className="text-right py-1">Rate</th>
                                <th className="text-right py-1">Commission</th>
                              </tr>
                            </thead>
                            <tbody>
                              {order.items.map((item, i) => (
                                <tr key={i} className="border-t border-white/5">
                                  <td className="py-2 text-white/80">{item.name}</td>
                                  <td className="py-2 text-right text-white/60">{item.quantity}</td>
                                  <td className="py-2 text-right text-white/60">{formatCurrency(item.price)}</td>
                                  <td className="py-2 text-right text-white/60">{(item.commissionRate * 100).toFixed(0)}%</td>
                                  <td className="py-2 text-right text-amber-400">{formatCurrency(item.commission)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-12 text-center">
                <p className="text-white/40">No commission orders found for this period.</p>
              </div>
            )}
          </>
        )}

        {!loading && !error && !report && (
          <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-12 text-center">
            <p className="text-white/40">No commission data found for this period.</p>
          </div>
        )}
      </div>
    </div>
  )
}
