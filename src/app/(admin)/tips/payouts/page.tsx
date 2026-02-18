'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Modal } from '@/components/ui/modal'

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

interface PayableEmployee {
  employeeId: string
  firstName: string
  lastName: string
  displayName: string | null
  roleName: string
  currentBalanceCents: number
  currentBalanceDollars: number
}

interface PayoutHistoryEntry {
  id: string
  employeeId: string
  amountCents: number
  amountDollars: number
  sourceType: string
  memo: string | null
  shiftId: string | null
  createdAt: string
}

// ────────────────────────────────────────────
// Page Component
// ────────────────────────────────────────────

export default function TipPayoutsPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const locationId = employee?.location?.id

  // ──── State ────
  const [employees, setEmployees] = useState<PayableEmployee[]>([])
  const [totalOwedCents, setTotalOwedCents] = useState(0)
  const [totalOwedDollars, setTotalOwedDollars] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  // History state
  const [history, setHistory] = useState<PayoutHistoryEntry[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyOffset, setHistoryOffset] = useState(0)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [historyDateFrom, setHistoryDateFrom] = useState('')
  const [historyDateTo, setHistoryDateTo] = useState('')
  const [showZeroBalances, setShowZeroBalances] = useState(false)

  // Modals
  const [cashOutEmployeeId, setCashOutEmployeeId] = useState<string | null>(null)
  const [cashOutAmount, setCashOutAmount] = useState('')
  const [cashOutMemo, setCashOutMemo] = useState('')
  const [isCashingOut, setIsCashingOut] = useState(false)

  const [showBatchConfirm, setShowBatchConfirm] = useState(false)
  const [isBatchProcessing, setIsBatchProcessing] = useState(false)
  const [batchResult, setBatchResult] = useState<{
    totalPaidOutDollars: number
    employeeCount: number
    entries: Array<{ employeeName: string; amountDollars: number }>
  } | null>(null)

  const HISTORY_LIMIT = 50

  // ──── Auth redirect ────
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login')
    }
  }, [isAuthenticated, router])

  // ──── Load payable balances ────
  const loadBalances = useCallback(async () => {
    if (!locationId) return
    try {
      setIsLoading(true)
      const res = await fetch(`/api/tips/payouts/batch?locationId=${locationId}`)
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to load tip balances')
        return
      }
      const data = await res.json()
      setEmployees(data.employees)
      setTotalOwedCents(data.totalOwedCents)
      setTotalOwedDollars(data.totalOwedDollars)
    } catch {
      toast.error('Failed to load tip balances')
    } finally {
      setIsLoading(false)
    }
  }, [locationId])

  useEffect(() => {
    loadBalances()
  }, [loadBalances])

  // ──── Load payout history ────
  const loadHistory = useCallback(async (offset = 0) => {
    if (!locationId) return
    try {
      setIsHistoryLoading(true)
      const params = new URLSearchParams({
        locationId,
        limit: String(HISTORY_LIMIT),
        offset: String(offset),
      })
      if (historyDateFrom) params.set('dateFrom', historyDateFrom)
      if (historyDateTo) params.set('dateTo', historyDateTo)

      const res = await fetch(`/api/tips/payouts?${params.toString()}`)
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to load payout history')
        return
      }
      const data = await res.json()
      setHistory(data.payouts)
      setHistoryTotal(data.total)
      setHistoryOffset(offset)
    } catch {
      toast.error('Failed to load payout history')
    } finally {
      setIsHistoryLoading(false)
    }
  }, [locationId, historyDateFrom, historyDateTo])

  // Load history when section is expanded or filters change
  useEffect(() => {
    if (historyExpanded) {
      loadHistory(0)
    }
  }, [historyExpanded, loadHistory])

  // ──── Cash out single employee ────
  const cashOutEmployee = employees.find(e => e.employeeId === cashOutEmployeeId)

  const handleCashOut = async () => {
    if (!locationId || !cashOutEmployeeId) return

    const amount = cashOutAmount ? parseFloat(cashOutAmount) : undefined
    if (cashOutAmount && (isNaN(amount!) || amount! <= 0)) {
      toast.warning('Enter a valid amount')
      return
    }

    try {
      setIsCashingOut(true)
      const res = await fetch('/api/tips/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          employeeId: cashOutEmployeeId,
          amount,
          memo: cashOutMemo || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to process cash out')
        return
      }

      const data = await res.json()
      toast.success(`Paid out ${formatCurrency(data.payout.amountDollars)} to ${
        cashOutEmployee?.displayName || `${cashOutEmployee?.firstName} ${cashOutEmployee?.lastName}`
      }`)

      setCashOutEmployeeId(null)
      setCashOutAmount('')
      setCashOutMemo('')
      await loadBalances()
      if (historyExpanded) await loadHistory(0)
    } catch {
      toast.error('Failed to process cash out')
    } finally {
      setIsCashingOut(false)
    }
  }

  // ──── Batch payroll payout ────
  const handleBatchPayout = async () => {
    if (!locationId || !employee?.id) return

    try {
      setIsBatchProcessing(true)
      const res = await fetch('/api/tips/payouts/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          processedById: employee.id,
          memo: 'Payroll batch payout',
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to process batch payout')
        return
      }

      const data = await res.json()
      setBatchResult({
        totalPaidOutDollars: data.batch.totalPaidOutDollars,
        employeeCount: data.batch.employeeCount,
        entries: data.batch.entries.map((e: { employeeName: string; amountDollars: number }) => ({
          employeeName: e.employeeName,
          amountDollars: e.amountDollars,
        })),
      })

      toast.success(`Batch payout complete: ${formatCurrency(data.batch.totalPaidOutDollars)} to ${data.batch.employeeCount} employees`)
      setShowBatchConfirm(false)
      await loadBalances()
      if (historyExpanded) await loadHistory(0)
    } catch {
      toast.error('Failed to process batch payout')
    } finally {
      setIsBatchProcessing(false)
    }
  }

  // ──── Helpers ────
  const employeesOwed = employees.filter(e => e.currentBalanceCents > 0)
  const lastBatchDate = history.find(h => h.sourceType === 'PAYOUT_PAYROLL')?.createdAt

  // Build a name map from employees for history display
  const employeeNameMap = new Map<string, string>()
  for (const emp of employees) {
    employeeNameMap.set(
      emp.employeeId,
      emp.displayName || `${emp.firstName} ${emp.lastName}`
    )
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  const sourceTypeLabel = (type: string) => {
    switch (type) {
      case 'PAYOUT_CASH': return 'Cash'
      case 'PAYOUT_PAYROLL': return 'Payroll'
      default: return type
    }
  }

  // ──── Loading state ────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <AdminPageHeader
          title="Tip Payouts"
          subtitle="Loading..."
          breadcrumbs={[
            { label: 'Settings', href: '/settings' },
            { label: 'Tips', href: '/settings/tips' },
          ]}
        />
        <div className="flex items-center justify-center py-24">
          <div className="text-gray-400 text-lg">Loading tip balances...</div>
        </div>
      </div>
    )
  }

  // ──── Render ────
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Tip Payouts"
        subtitle="Manage employee tip balances and payouts"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Tips', href: '/settings/tips' },
        ]}
        actions={
          <button
            onClick={loadBalances}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-white/10 border border-white/20 text-white/70 hover:bg-white/20 transition-all"
            aria-label="Refresh balances"
          >
            Refresh
          </button>
        }
      />

      <div className="max-w-4xl mx-auto space-y-6 pb-16">

        {/* ═══════════════════════════════════════════
            Summary Cards
            ═══════════════════════════════════════════ */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Total Owed */}
          <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-5">
            <div className="text-sm text-white/50 mb-1">Total Owed</div>
            <div className="text-2xl font-bold text-white">
              {formatCurrency(totalOwedDollars)}
            </div>
            <div className="text-xs text-white/30 mt-1">
              Sum of all positive balances
            </div>
          </div>

          {/* Employees Owed */}
          <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-5">
            <div className="text-sm text-white/50 mb-1">Employees Owed</div>
            <div className="text-2xl font-bold text-white">
              {employeesOwed.length}
            </div>
            <div className="text-xs text-white/30 mt-1">
              With positive balance
            </div>
          </div>

          {/* Last Batch Date */}
          <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-5">
            <div className="text-sm text-white/50 mb-1">Last Batch Payout</div>
            <div className="text-2xl font-bold text-white">
              {lastBatchDate ? formatDate(lastBatchDate) : 'Never'}
            </div>
            <div className="text-xs text-white/30 mt-1">
              Most recent payroll batch
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════
            Employee Balances Table
            ═══════════════════════════════════════════ */}
        <section className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-semibold text-white">Employee Balances</h2>
              <p className="text-sm text-white/50">Tip bank balances owed to employees</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-white/50 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showZeroBalances}
                onChange={e => setShowZeroBalances(e.target.checked)}
                className="rounded border-white/20 bg-white/5 text-indigo-600 focus:ring-indigo-500"
              />
              Show $0 balances
            </label>
          </div>

          {employeesOwed.length === 0 && !showZeroBalances ? (
            <div className="text-center py-12 text-white/40">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-lg font-medium">All caught up</p>
              <p className="text-sm mt-1">No employees have outstanding tip balances</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left text-xs font-medium text-white/50 uppercase tracking-wider pb-3 pr-4">Employee</th>
                    <th className="text-left text-xs font-medium text-white/50 uppercase tracking-wider pb-3 pr-4">Role</th>
                    <th className="text-right text-xs font-medium text-white/50 uppercase tracking-wider pb-3 pr-4">Balance</th>
                    <th className="text-right text-xs font-medium text-white/50 uppercase tracking-wider pb-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {(showZeroBalances ? employees : employeesOwed).map(emp => {
                    const name = emp.displayName || `${emp.firstName} ${emp.lastName}`
                    const isZero = emp.currentBalanceCents <= 0
                    return (
                      <tr key={emp.employeeId} className={`${isZero ? 'opacity-40' : ''}`}>
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            {isZero && (
                              <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                            <span className="text-sm font-medium text-white">{name}</span>
                          </div>
                        </td>
                        <td className="py-3 pr-4">
                          <span className="text-sm text-white/60">{emp.roleName}</span>
                        </td>
                        <td className="py-3 pr-4 text-right">
                          <span className={`text-sm font-semibold ${isZero ? 'text-white/40' : 'text-emerald-400'}`}>
                            {formatCurrency(emp.currentBalanceDollars)}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          {!isZero && (
                            <button
                              onClick={() => {
                                setCashOutEmployeeId(emp.employeeId)
                                setCashOutAmount(String(emp.currentBalanceDollars))
                                setCashOutMemo('')
                              }}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                            >
                              Cash Out
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ═══════════════════════════════════════════
            Batch Actions
            ═══════════════════════════════════════════ */}
        <section className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-1">Batch Actions</h2>
          <p className="text-sm text-white/50 mb-5">Process payouts for multiple employees at once</p>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => {
                if (employeesOwed.length === 0) {
                  toast.info('No employees have outstanding balances')
                  return
                }
                setShowBatchConfirm(true)
              }}
              disabled={isBatchProcessing}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-all shadow-sm disabled:opacity-50"
            >
              {isBatchProcessing ? 'Processing...' : 'Payroll Batch -- Pay All'}
            </button>

            <div className="relative group">
              <button
                disabled
                className="px-5 py-2.5 rounded-xl text-sm font-semibold border border-white/20 text-white/40 cursor-not-allowed"
              >
                Export CSV
              </button>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                Coming Soon
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Payout History
            ═══════════════════════════════════════════ */}
        <section className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl">
          <button
            onClick={() => setHistoryExpanded(!historyExpanded)}
            className="w-full p-6 flex items-center justify-between text-left"
          >
            <div>
              <h2 className="text-lg font-semibold text-white">Payout History</h2>
              <p className="text-sm text-white/50">
                {historyTotal > 0
                  ? `${historyTotal} payout${historyTotal !== 1 ? 's' : ''} on record`
                  : 'View past payouts'
                }
              </p>
            </div>
            <svg
              className={`w-5 h-5 text-white/50 transition-transform ${historyExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {historyExpanded && (
            <div className="px-6 pb-6 border-t border-white/5">
              {/* Date range filter */}
              <div className="flex flex-wrap items-end gap-3 mt-4 mb-4">
                <div>
                  <label className="block text-xs font-medium text-white/50 mb-1">From</label>
                  <input
                    type="date"
                    value={historyDateFrom}
                    onChange={e => setHistoryDateFrom(e.target.value)}
                    className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/50 mb-1">To</label>
                  <input
                    type="date"
                    value={historyDateTo}
                    onChange={e => setHistoryDateTo(e.target.value)}
                    className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
                {(historyDateFrom || historyDateTo) && (
                  <button
                    onClick={() => {
                      setHistoryDateFrom('')
                      setHistoryDateTo('')
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/50 hover:text-white/80 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>

              {isHistoryLoading ? (
                <div className="text-center py-8 text-white/40">Loading history...</div>
              ) : history.length === 0 ? (
                <div className="text-center py-8 text-white/40">No payouts found</div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-white/10">
                          <th className="text-left text-xs font-medium text-white/50 uppercase tracking-wider pb-3 pr-4">Date</th>
                          <th className="text-left text-xs font-medium text-white/50 uppercase tracking-wider pb-3 pr-4">Employee</th>
                          <th className="text-left text-xs font-medium text-white/50 uppercase tracking-wider pb-3 pr-4">Type</th>
                          <th className="text-right text-xs font-medium text-white/50 uppercase tracking-wider pb-3 pr-4">Amount</th>
                          <th className="text-left text-xs font-medium text-white/50 uppercase tracking-wider pb-3">Memo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {history.map(entry => (
                          <tr key={entry.id}>
                            <td className="py-3 pr-4 text-sm text-white/70 whitespace-nowrap">
                              {formatDate(entry.createdAt)}
                            </td>
                            <td className="py-3 pr-4 text-sm text-white font-medium">
                              {employeeNameMap.get(entry.employeeId) || entry.employeeId}
                            </td>
                            <td className="py-3 pr-4">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                                entry.sourceType === 'PAYOUT_CASH'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-indigo-500/20 text-indigo-300'
                              }`}>
                                {sourceTypeLabel(entry.sourceType)}
                              </span>
                            </td>
                            <td className="py-3 pr-4 text-right text-sm font-semibold text-white">
                              {formatCurrency(entry.amountDollars)}
                            </td>
                            <td className="py-3 text-sm text-white/50 max-w-[200px] truncate">
                              {entry.memo || '--'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {historyTotal > HISTORY_LIMIT && (
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
                      <span className="text-sm text-white/40">
                        Showing {historyOffset + 1}-{Math.min(historyOffset + HISTORY_LIMIT, historyTotal)} of {historyTotal}
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => loadHistory(Math.max(0, historyOffset - HISTORY_LIMIT))}
                          disabled={historyOffset === 0}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          Previous
                        </button>
                        <button
                          onClick={() => loadHistory(historyOffset + HISTORY_LIMIT)}
                          disabled={historyOffset + HISTORY_LIMIT >= historyTotal}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ═══════════════════════════════════════════
          Cash Out Confirmation Modal
          ═══════════════════════════════════════════ */}
      <Modal
        isOpen={!!(cashOutEmployeeId && cashOutEmployee)}
        onClose={() => {
          setCashOutEmployeeId(null)
          setCashOutAmount('')
          setCashOutMemo('')
        }}
        title="Cash Out Tips"
        size="md"
      >
            <p className="text-sm text-gray-500 mb-5">
              Pay out tips for {cashOutEmployee?.displayName || `${cashOutEmployee?.firstName} ${cashOutEmployee?.lastName}`}
            </p>

            <div className="space-y-4">
              {/* Current balance display */}
              <div className="p-3 rounded-xl bg-gray-50 border border-gray-200">
                <div className="text-xs text-gray-500 mb-0.5">Current Balance</div>
                <div className="text-xl font-bold text-emerald-600">
                  {formatCurrency(cashOutEmployee?.currentBalanceDollars ?? 0)}
                </div>
              </div>

              {/* Amount input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payout Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={cashOutEmployee?.currentBalanceDollars}
                    value={cashOutAmount}
                    onChange={e => setCashOutAmount(e.target.value)}
                    className="w-full pl-7 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder={String(cashOutEmployee?.currentBalanceDollars)}
                    aria-label="Payout amount"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">Leave at full balance for complete payout</p>
              </div>

              {/* Memo input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Memo (optional)</label>
                <input
                  type="text"
                  value={cashOutMemo}
                  onChange={e => setCashOutMemo(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="e.g. End of shift cash out"
                  aria-label="Payout memo"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setCashOutEmployeeId(null)
                  setCashOutAmount('')
                  setCashOutMemo('')
                }}
                disabled={isCashingOut}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCashOut}
                disabled={isCashingOut}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {isCashingOut ? 'Processing...' : `Pay ${cashOutAmount ? formatCurrency(parseFloat(cashOutAmount) || 0) : formatCurrency(cashOutEmployee?.currentBalanceDollars ?? 0)}`}
              </button>
            </div>
      </Modal>

      {/* ═══════════════════════════════════════════
          Batch Payroll Confirmation Modal
          ═══════════════════════════════════════════ */}
      <Modal
        isOpen={showBatchConfirm}
        onClose={() => setShowBatchConfirm(false)}
        title="Confirm Payroll Batch Payout"
        size="md"
      >
            <p className="text-sm text-gray-500 mb-5">
              This will create payroll debit entries for {employeesOwed.length} employee{employeesOwed.length !== 1 ? 's' : ''} totaling {formatCurrency(totalOwedDollars)}.
            </p>

            {/* Preview list */}
            <div className="max-h-60 overflow-y-auto rounded-xl bg-gray-50 border border-gray-200 divide-y divide-gray-100">
              {employeesOwed.map(emp => {
                const name = emp.displayName || `${emp.firstName} ${emp.lastName}`
                return (
                  <div key={emp.employeeId} className="flex items-center justify-between px-4 py-2.5">
                    <div>
                      <div className="text-sm text-gray-900 font-medium">{name}</div>
                      <div className="text-xs text-gray-500">{emp.roleName}</div>
                    </div>
                    <span className="text-sm font-semibold text-emerald-600">
                      {formatCurrency(emp.currentBalanceDollars)}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Total */}
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
              <span className="text-sm font-medium text-gray-700">Total Payout</span>
              <span className="text-lg font-bold text-gray-900">{formatCurrency(totalOwedDollars)}</span>
            </div>

            {/* Actions */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowBatchConfirm(false)}
                disabled={isBatchProcessing}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleBatchPayout}
                disabled={isBatchProcessing}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                {isBatchProcessing ? 'Processing...' : 'Confirm Batch Payout'}
              </button>
            </div>
      </Modal>

      {/* ═══════════════════════════════════════════
          Batch Result Modal
          ═══════════════════════════════════════════ */}
      <Modal
        isOpen={!!batchResult}
        onClose={() => setBatchResult(null)}
        title="Batch Payout Complete"
        size="md"
      >
            <div className="text-center mb-5">
              <svg className="w-12 h-12 mx-auto mb-3 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-gray-500 mt-1">
                {formatCurrency(batchResult?.totalPaidOutDollars ?? 0)} paid to {batchResult?.employeeCount ?? 0} employee{batchResult?.employeeCount !== 1 ? 's' : ''}
              </p>
            </div>

            {/* Result list */}
            <div className="max-h-60 overflow-y-auto rounded-xl bg-gray-50 border border-gray-200 divide-y divide-gray-100">
              {batchResult?.entries.map((entry, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-sm text-gray-900 font-medium">{entry.employeeName}</span>
                  <span className="text-sm font-semibold text-emerald-600">
                    {formatCurrency(entry.amountDollars)}
                  </span>
                </div>
              ))}
            </div>

            <button
              onClick={() => setBatchResult(null)}
              className="w-full mt-6 px-4 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              Done
            </button>
      </Modal>
    </div>
  )
}
