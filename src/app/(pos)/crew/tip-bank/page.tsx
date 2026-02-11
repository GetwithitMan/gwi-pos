'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { ManualTipTransferModal } from '@/components/tips/ManualTipTransferModal'

type SourceType =
  | 'DIRECT_TIP'
  | 'TIP_GROUP'
  | 'ROLE_TIPOUT'
  | 'MANUAL_TRANSFER'
  | 'PAYOUT_CASH'
  | 'PAYOUT_PAYROLL'
  | 'CHARGEBACK'
  | 'ADJUSTMENT'

interface LedgerEntry {
  id: string
  type: 'CREDIT' | 'DEBIT'
  amountCents: number
  amountDollars: number
  sourceType: SourceType
  sourceId: string | null
  memo: string | null
  shiftId: string | null
  orderId: string | null
  adjustmentId: string | null
  createdAt: string
}

interface LedgerBalance {
  currentBalanceCents: number
  currentBalanceDollars: number
  employeeId: string
  ledgerId: string | null
}

interface LedgerResponse {
  balance: LedgerBalance
  entries: LedgerEntry[]
  total: number
  filters: {
    dateFrom: string | null
    dateTo: string | null
    sourceType: string | null
    limit: number
    offset: number
  }
}

function humanizeSourceType(sourceType: SourceType): string {
  switch (sourceType) {
    case 'DIRECT_TIP': return 'Direct Tip'
    case 'TIP_GROUP': return 'Group Pool'
    case 'ROLE_TIPOUT': return 'Role Tip-Out'
    case 'MANUAL_TRANSFER': return 'Transfer'
    case 'PAYOUT_CASH': return 'Cash Payout'
    case 'PAYOUT_PAYROLL': return 'Payroll Payout'
    case 'CHARGEBACK': return 'Chargeback'
    case 'ADJUSTMENT': return 'Adjustment'
    default: return sourceType
  }
}

function sourceTypeBadgeClasses(sourceType: SourceType): string {
  switch (sourceType) {
    case 'DIRECT_TIP': return 'bg-emerald-500/20 text-emerald-400'
    case 'TIP_GROUP': return 'bg-blue-500/20 text-blue-400'
    case 'ROLE_TIPOUT': return 'bg-purple-500/20 text-purple-400'
    case 'MANUAL_TRANSFER': return 'bg-amber-500/20 text-amber-400'
    case 'PAYOUT_CASH': return 'bg-orange-500/20 text-orange-400'
    case 'PAYOUT_PAYROLL': return 'bg-orange-500/20 text-orange-400'
    case 'CHARGEBACK': return 'bg-red-500/20 text-red-400'
    case 'ADJUSTMENT': return 'bg-yellow-500/20 text-yellow-400'
    default: return 'bg-white/10 text-white/50'
  }
}

const SOURCE_TYPE_OPTIONS: { label: string; value: SourceType | '' }[] = [
  { label: 'All', value: '' },
  { label: 'Direct Tips', value: 'DIRECT_TIP' },
  { label: 'Group Tips', value: 'TIP_GROUP' },
  { label: 'Role Tip-Outs', value: 'ROLE_TIPOUT' },
  { label: 'Manual Transfers', value: 'MANUAL_TRANSFER' },
  { label: 'Payouts', value: 'PAYOUT_CASH' },
  { label: 'Payroll Payouts', value: 'PAYOUT_PAYROLL' },
  { label: 'Chargebacks', value: 'CHARGEBACK' },
  { label: 'Adjustments', value: 'ADJUSTMENT' },
]

const LIMIT = 50

function getDefaultDateRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 30)
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  }
}

export default function CrewTipBankPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const [dateRange, setDateRange] = useState(getDefaultDateRange)
  const [sourceTypeFilter, setSourceTypeFilter] = useState<SourceType | ''>('')
  const [data, setData] = useState<LedgerResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [showTransferModal, setShowTransferModal] = useState(false)

  // Hydration guard: wait for Zustand to rehydrate from localStorage
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])

  useEffect(() => {
    if (hydrated && (!employee || !isAuthenticated)) {
      router.push('/login')
    }
  }, [hydrated, employee, isAuthenticated, router])

  const fetchLedger = useCallback(async (currentOffset: number, append: boolean) => {
    if (!employee) return

    if (append) {
      setLoadingMore(true)
    } else {
      setLoading(true)
    }
    setError(null)

    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        requestingEmployeeId: employee.id,
        limit: String(LIMIT),
        offset: String(currentOffset),
      })
      if (dateRange.start) params.set('dateFrom', dateRange.start)
      if (dateRange.end) params.set('dateTo', dateRange.end)
      if (sourceTypeFilter) params.set('sourceType', sourceTypeFilter)

      const res = await fetch(`/api/tips/ledger/${employee.id}?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load tip bank data')
      const json: LedgerResponse = await res.json()

      if (append && data) {
        setData({
          ...json,
          entries: [...data.entries, ...json.entries],
        })
      } else {
        setData(json)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [employee, dateRange, sourceTypeFilter, data])

  // Initial load and filter changes reset to offset 0
  useEffect(() => {
    setOffset(0)
    fetchLedger(0, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee, dateRange, sourceTypeFilter])

  const handleLoadMore = () => {
    const newOffset = offset + LIMIT
    setOffset(newOffset)
    fetchLedger(newOffset, true)
  }

  if (!hydrated || !employee || !isAuthenticated) return null

  const balance = data?.balance
  const entries = data?.entries ?? []
  const total = data?.total ?? 0
  const hasMore = entries.length < total

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
          <h1 className="text-2xl font-bold text-white">Tip Bank</h1>
          <button
            onClick={() => setShowTransferModal(true)}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-all"
          >
            Transfer Tips
          </button>
        </div>

        {/* Balance Hero Card */}
        {balance && !loading && (
          <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-8 mb-6 text-center">
            <div className="text-white/40 text-sm mb-2 uppercase tracking-wider">Tip Bank Balance</div>
            <div className="text-4xl sm:text-5xl font-bold text-emerald-400">
              {formatCurrency(balance.currentBalanceDollars)}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-4 mb-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
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
            <select
              value={sourceTypeFilter}
              onChange={e => setSourceTypeFilter(e.target.value as SourceType | '')}
              className="bg-white/10 border border-white/20 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 appearance-none cursor-pointer"
            >
              {SOURCE_TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value} className="bg-gray-800 text-white">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-400" />
            <span className="ml-3 text-white/60">Loading tip bank...</span>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 text-center">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Ledger Entries */}
        {!loading && !error && data && (
          <>
            {entries.length > 0 ? (
              <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-semibold">Ledger Activity</h3>
                  <span className="text-white/40 text-sm">
                    Showing {entries.length} of {total} entries
                  </span>
                </div>
                <div className="divide-y divide-white/5">
                  {entries.map(entry => {
                    const isCredit = entry.type === 'CREDIT'
                    const displayAmount = Math.abs(entry.amountDollars)
                    const description = entry.memo || humanizeSourceType(entry.sourceType)

                    return (
                      <div key={entry.id} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-white/80 text-sm font-medium truncate">
                              {description}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${sourceTypeBadgeClasses(entry.sourceType)}`}>
                              {humanizeSourceType(entry.sourceType)}
                            </span>
                          </div>
                          <div className="text-white/40 text-xs">
                            {new Date(entry.createdAt).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                            {' '}
                            {new Date(entry.createdAt).toLocaleTimeString('en-US', {
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </div>
                        </div>
                        <div className={`text-right font-semibold text-lg ml-4 ${isCredit ? 'text-emerald-400' : 'text-red-400'}`}>
                          {isCredit ? '+' : '-'}{formatCurrency(displayAmount)}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Load More */}
                {hasMore && (
                  <div className="mt-6 text-center">
                    <button
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className="bg-white/10 hover:bg-white/15 border border-white/20 text-white rounded-xl px-6 py-2.5 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loadingMore ? (
                        <span className="flex items-center gap-2">
                          <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                          Loading...
                        </span>
                      ) : (
                        `Load More (${total - entries.length} remaining)`
                      )}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-12 text-center">
                <div className="text-white/20 mb-4">
                  <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                  </svg>
                </div>
                <p className="text-white/40 text-lg">No tip bank activity yet</p>
                <p className="text-white/25 text-sm mt-1">Tip credits and payouts will appear here</p>
              </div>
            )}
          </>
        )}

        {!loading && !error && !data && (
          <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-12 text-center">
            <p className="text-white/40">No tip bank data found.</p>
          </div>
        )}
      </div>

      <ManualTipTransferModal
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        locationId={employee?.location?.id || ''}
        employeeId={employee?.id || ''}
        currentBalanceDollars={data?.balance?.currentBalanceDollars || 0}
        onTransferComplete={() => {
          setOffset(0)
          fetchLedger(0, false)
        }}
      />
    </div>
  )
}
