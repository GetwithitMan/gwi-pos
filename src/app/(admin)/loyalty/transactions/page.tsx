'use client'

import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useRequireAuth } from '@/hooks/useRequireAuth'

interface Transaction {
  id: string
  customerId: string
  customerFirstName: string
  customerLastName: string
  type: string
  points: number
  balanceBefore: number
  balanceAfter: number
  description: string
  orderId: string | null
  createdAt: string
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  earn: { label: 'Earned', color: 'bg-green-100 text-green-800' },
  redeem: { label: 'Redeemed', color: 'bg-orange-100 text-orange-800' },
  adjust: { label: 'Adjusted', color: 'bg-blue-100 text-blue-800' },
  expire: { label: 'Expired', color: 'bg-gray-100 text-gray-800' },
  tier_bonus: { label: 'Tier Bonus', color: 'bg-purple-100 text-purple-800' },
  welcome: { label: 'Welcome', color: 'bg-indigo-100 text-indigo-800' },
}

export default function TransactionsPage() {
  const { employee } = useRequireAuth()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [typeFilter, setTypeFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const limit = 50

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('limit', String(limit))
      params.set('offset', String(offset))
      if (typeFilter) params.set('type', typeFilter)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)

      const res = await fetch(`/api/loyalty/transactions?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load')
      const json = await res.json()

      setTransactions(
        (json.data || []).map((t: any) => ({
          id: t.id,
          customerId: t.customerId,
          customerFirstName: t.customerFirstName || '',
          customerLastName: t.customerLastName || '',
          type: t.type,
          points: Number(t.points),
          balanceBefore: Number(t.balanceBefore),
          balanceAfter: Number(t.balanceAfter),
          description: t.description || '',
          orderId: t.orderId,
          createdAt: t.createdAt,
        })),
      )
      setTotal(json.pagination?.total ?? 0)
    } catch (err) {
      console.error('Failed to load transactions:', err)
    } finally {
      setLoading(false)
    }
  }, [offset, typeFilter, dateFrom, dateTo])

  useEffect(() => {
    fetchTransactions()
  }, [fetchTransactions])

  const handleFilter = () => {
    setOffset(0)
    fetchTransactions()
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <AdminPageHeader
        title="Loyalty Transactions"
        subtitle="Full audit trail of all loyalty point changes"
        breadcrumbs={[{ label: 'Loyalty', href: '/loyalty' }]}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setOffset(0) }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">All types</option>
            <option value="earn">Earned</option>
            <option value="redeem">Redeemed</option>
            <option value="adjust">Adjusted</option>
            <option value="expire">Expired</option>
            <option value="tier_bonus">Tier Bonus</option>
            <option value="welcome">Welcome</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setOffset(0) }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setOffset(0) }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">Loading...</div>
      ) : transactions.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          No transactions found.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Customer</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Type</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">Points</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">Balance</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Description</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => {
                  const typeInfo = TYPE_LABELS[t.type] || { label: t.type, color: 'bg-gray-100 text-gray-800' }
                  return (
                    <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {new Date(t.createdAt).toLocaleDateString()}{' '}
                        {new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {t.customerFirstName} {t.customerLastName}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${typeInfo.color}`}>
                          {typeInfo.label}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-right font-mono font-medium ${t.points >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {t.points >= 0 ? '+' : ''}{t.points.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-500">
                        {t.balanceAfter.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs max-w-xs truncate">
                        {t.description}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > limit && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
              <p className="text-xs text-gray-500">
                Showing {offset + 1}-{Math.min(offset + limit, total)} of {total}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                  className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setOffset(offset + limit)}
                  disabled={offset + limit >= total}
                  className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
