'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card } from '@/components/ui/card'
import { formatCurrency, formatDate } from '@/lib/utils'

interface GiftCardStats {
  totalLiability: number
  activeCount: number
  depletedCount: number
  frozenCount: number
  expiredCount: number
  unactivatedCount: number
  recentTransactions: {
    id: string
    type: string
    amount: number
    balanceBefore: number
    balanceAfter: number
    notes: string | null
    createdAt: string
    cardNumber: string | null
  }[]
}

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  purchase: 'Purchase',
  activated: 'Activation',
  redemption: 'Redemption',
  reload: 'Reload',
  refund: 'Refund',
  adjustment_credit: 'Credit',
  adjustment_debit: 'Debit',
  frozen: 'Frozen',
  unfrozen: 'Unfrozen',
}

interface GiftCardDashboardProps {
  locationId: string | undefined
  expanded?: boolean
}

export function GiftCardDashboard({ locationId, expanded = false }: GiftCardDashboardProps) {
  const [stats, setStats] = useState<GiftCardStats | null>(null)
  const [loading, setLoading] = useState(true)

  const loadStats = useCallback(async () => {
    if (!locationId) return
    setLoading(true)
    try {
      const response = await fetch(`/api/gift-cards/stats?locationId=${locationId}`)
      if (response.ok) {
        const data = await response.json()
        setStats(data)
      }
    } catch (error) {
      console.error('Failed to load gift card stats:', error)
    } finally {
      setLoading(false)
    }
  }, [locationId])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[1, 2, 3, 4].map(i => (
          <Card key={i} className="p-4 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-24 mb-2" />
            <div className="h-8 bg-gray-200 rounded w-16" />
          </Card>
        ))}
      </div>
    )
  }

  if (!stats) return null

  const totalCards = stats.activeCount + stats.depletedCount + stats.frozenCount + stats.expiredCount + stats.unactivatedCount

  return (
    <div className="mb-6 space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Liability */}
        <Card className="p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Outstanding Liability</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(stats.totalLiability)}</p>
          <p className="text-xs text-gray-500 mt-1">{stats.activeCount + stats.frozenCount} cards with balance</p>
        </Card>

        {/* Active Cards */}
        <Card className="p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Active Cards</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{stats.activeCount}</p>
          <p className="text-xs text-gray-500 mt-1">of {totalCards} total</p>
        </Card>

        {/* Pool Available */}
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Pool Available</p>
            {stats.unactivatedCount < 10 && stats.unactivatedCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Low</span>
            )}
            {stats.unactivatedCount === 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Empty</span>
            )}
          </div>
          <p className="text-2xl font-bold text-yellow-600 mt-1">{stats.unactivatedCount}</p>
          <p className="text-xs text-gray-500 mt-1">unactivated cards</p>
        </Card>

        {/* Status Breakdown */}
        <Card className="p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Status Breakdown</p>
          <div className="mt-2 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                Active
              </span>
              <span className="font-medium">{stats.activeCount}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-gray-400" />
                Depleted
              </span>
              <span className="font-medium">{stats.depletedCount}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                Frozen
              </span>
              <span className="font-medium">{stats.frozenCount}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                Expired
              </span>
              <span className="font-medium">{stats.expiredCount}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-yellow-500" />
                Unactivated
              </span>
              <span className="font-medium">{stats.unactivatedCount}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Recent transactions (shown in expanded/report mode) */}
      {expanded && stats.recentTransactions.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Recent Transactions</h3>
          <div className="space-y-2">
            {stats.recentTransactions.map(txn => (
              <div key={txn.id} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-gray-600">{txn.cardNumber}</span>
                  <span className="text-gray-900">{TRANSACTION_TYPE_LABELS[txn.type] || txn.type}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className={txn.amount >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                    {txn.amount >= 0 ? '+' : ''}{formatCurrency(txn.amount)}
                  </span>
                  <span className="text-xs text-gray-500">{formatDate(txn.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
