'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useRequireAuth } from '@/hooks/useRequireAuth'

interface DashboardData {
  program: {
    id: string
    name: string
    isActive: boolean
    pointsPerDollar: number
    pointValueCents: number
    minimumRedeemPoints: number
  } | null
  enrolledCount: number
  tierCount: number
  stats: {
    pointsIssuedThisMonth: number
    pointsRedeemedThisMonth: number
    transactionsThisMonth: number
  }
  topCustomers: Array<{
    id: string
    firstName: string
    lastName: string
    loyaltyPoints: number
    lifetimePoints: number
    tierName: string | null
    tierColor: string | null
  }>
}

export default function LoyaltyDashboardPage() {
  const { employee } = useRequireAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchDashboard = useCallback(async () => {
    try {
      // Fetch program
      const programRes = await fetch('/api/loyalty/programs')
      const programJson = await programRes.json()
      const programs = programJson.data || []
      const program = programs[0] || null

      // Fetch transactions this month stats
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const txnRes = await fetch(`/api/loyalty/transactions?dateFrom=${monthStart}&limit=200`)
      const txnJson = await txnRes.json()
      const txns = txnJson.data || []

      let pointsIssuedThisMonth = 0
      let pointsRedeemedThisMonth = 0
      for (const t of txns) {
        if (t.type === 'earn' || t.type === 'welcome' || t.type === 'tier_bonus') {
          pointsIssuedThisMonth += Math.abs(Number(t.points))
        } else if (t.type === 'redeem') {
          pointsRedeemedThisMonth += Math.abs(Number(t.points))
        }
      }

      // Fetch top customers by loyalty points
      const custRes = await fetch('/api/customers?sortBy=loyaltyPoints&sortDir=desc&limit=10')
      let topCustomers: DashboardData['topCustomers'] = []
      if (custRes.ok) {
        const custJson = await custRes.json()
        const custs = custJson.data || custJson.customers || []
        topCustomers = custs
          .filter((c: any) => Number(c.loyaltyPoints) > 0)
          .slice(0, 10)
          .map((c: any) => ({
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            loyaltyPoints: Number(c.loyaltyPoints),
            lifetimePoints: Number(c.lifetimePoints ?? 0),
            tierName: c.tierName ?? c.loyaltyTier?.name ?? null,
            tierColor: c.tierColor ?? c.loyaltyTier?.color ?? null,
          }))
      }

      setData({
        program: program
          ? {
              id: program.id,
              name: program.name,
              isActive: program.isActive,
              pointsPerDollar: Number(program.pointsPerDollar),
              pointValueCents: Number(program.pointValueCents),
              minimumRedeemPoints: Number(program.minimumRedeemPoints),
            }
          : null,
        enrolledCount: Number(program?.enrolledCount ?? 0),
        tierCount: Number(program?.tierCount ?? 0),
        stats: {
          pointsIssuedThisMonth,
          pointsRedeemedThisMonth,
          transactionsThisMonth: txns.length,
        },
        topCustomers,
      })
    } catch (err) {
      console.error('Failed to load loyalty dashboard:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDashboard()
  }, [fetchDashboard])

  if (loading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <AdminPageHeader title="Loyalty Program" subtitle="Loading..." />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <AdminPageHeader
        title="Loyalty Program"
        subtitle="Manage your loyalty program, tiers, and enrolled customers"
        actions={
          <div className="flex items-center gap-3">
            <Link
              href="/loyalty/program"
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
            >
              {data?.program ? 'Edit Program' : 'Create Program'}
            </Link>
          </div>
        }
      />

      {/* Quick Nav */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Link href="/loyalty/program" className="bg-white rounded-xl border border-gray-200 p-4 hover:border-indigo-300 transition-colors">
          <p className="text-sm font-semibold text-gray-900">Program Settings</p>
          <p className="text-xs text-gray-500 mt-0.5">Points per dollar, redemption rules</p>
        </Link>
        <Link href="/loyalty/tiers" className="bg-white rounded-xl border border-gray-200 p-4 hover:border-indigo-300 transition-colors">
          <p className="text-sm font-semibold text-gray-900">Tiers</p>
          <p className="text-xs text-gray-500 mt-0.5">{data?.tierCount ?? 0} tiers configured</p>
        </Link>
        <Link href="/loyalty/customers" className="bg-white rounded-xl border border-gray-200 p-4 hover:border-indigo-300 transition-colors">
          <p className="text-sm font-semibold text-gray-900">Enrolled Customers</p>
          <p className="text-xs text-gray-500 mt-0.5">{data?.enrolledCount ?? 0} customers</p>
        </Link>
        <Link href="/loyalty/transactions" className="bg-white rounded-xl border border-gray-200 p-4 hover:border-indigo-300 transition-colors">
          <p className="text-sm font-semibold text-gray-900">Transaction Log</p>
          <p className="text-xs text-gray-500 mt-0.5">Full audit trail</p>
        </Link>
      </div>

      {/* Stats Cards */}
      {data?.program ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Status</p>
            <div className="flex items-center gap-2 mt-2">
              <span className={`w-2.5 h-2.5 rounded-full ${data.program.isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
              <p className="text-lg font-bold text-gray-900">{data.program.isActive ? 'Active' : 'Inactive'}</p>
            </div>
            <p className="text-xs text-gray-500 mt-1">{data.program.pointsPerDollar} pts/$1 spent</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Enrolled</p>
            <p className="text-2xl font-bold text-gray-900 mt-2">{data.enrolledCount.toLocaleString()}</p>
            <p className="text-xs text-gray-500 mt-1">customers</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Points Issued (Month)</p>
            <p className="text-2xl font-bold text-indigo-600 mt-2">{data.stats.pointsIssuedThisMonth.toLocaleString()}</p>
            <p className="text-xs text-gray-500 mt-1">{data.stats.transactionsThisMonth} transactions</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Points Redeemed (Month)</p>
            <p className="text-2xl font-bold text-orange-600 mt-2">{data.stats.pointsRedeemedThisMonth.toLocaleString()}</p>
            <p className="text-xs text-gray-500 mt-1">
              ${((data.stats.pointsRedeemedThisMonth * (data.program?.pointValueCents ?? 1)) / 100).toFixed(2)} value
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
          </svg>
          <p className="text-lg font-semibold text-gray-900">No Loyalty Program Yet</p>
          <p className="text-sm text-gray-500 mt-1">Create a program to start earning and redeeming points.</p>
          <Link
            href="/loyalty/program"
            className="inline-block mt-4 px-6 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Create Program
          </Link>
        </div>
      )}

      {/* Top Customers */}
      {data?.topCustomers && data.topCustomers.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Top Loyalty Customers</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-5 py-2.5 font-medium text-gray-600">Customer</th>
                <th className="text-left px-5 py-2.5 font-medium text-gray-600">Tier</th>
                <th className="text-right px-5 py-2.5 font-medium text-gray-600">Current Points</th>
                <th className="text-right px-5 py-2.5 font-medium text-gray-600">Lifetime Points</th>
              </tr>
            </thead>
            <tbody>
              {data.topCustomers.map((c) => (
                <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900">
                    {c.firstName} {c.lastName}
                  </td>
                  <td className="px-5 py-3">
                    {c.tierName ? (
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white"
                        style={{ backgroundColor: c.tierColor || '#6366f1' }}
                      >
                        {c.tierName}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">--</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-gray-900">
                    {c.loyaltyPoints.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-gray-500">
                    {c.lifetimePoints.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
