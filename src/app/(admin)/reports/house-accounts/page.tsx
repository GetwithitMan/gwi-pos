'use client'

import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgingAccount {
  id: string
  name: string
  contactName: string | null
  email: string | null
  phone: string | null
  currentBalance: number
  creditLimit: number
  paymentTerms: number
  status: string
  lastPaymentDate: string | null
  lastPaymentAmount: number | null
  oldestChargeDate: string | null
  daysOverdue: number
  agingBucket: 'current' | '30' | '60' | '90' | 'over90'
  current: number
  bucket30: number
  bucket60: number
  bucket90: number
  over90: number
}

interface AgingSummary {
  totalOutstanding: number
  totalCurrent: number
  total30: number
  total60: number
  total90: number
  totalOver90: number
  accountCount: number
  overdueCount: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function agingBucketBadge(bucket: string): { label: string; className: string } {
  if (bucket === 'current') return { label: 'Current', className: 'bg-green-100 text-green-700' }
  if (bucket === '30') return { label: '30 Days', className: 'bg-amber-100 text-amber-700' }
  if (bucket === '60') return { label: '60 Days', className: 'bg-orange-100 text-orange-700' }
  if (bucket === '90') return { label: '90 Days', className: 'bg-red-100 text-red-700' }
  return { label: 'Over 90', className: 'bg-red-200 text-red-800' }
}

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'ach', label: 'ACH' },
  { value: 'wire', label: 'Wire' },
  { value: 'card', label: 'Card' },
]

// ─── Page Component ──────────────────────────────────────────────────────────

export default function HouseAccountsReportPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/house-accounts' })
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id

  // Data state
  const [accounts, setAccounts] = useState<AgingAccount[]>([])
  const [summary, setSummary] = useState<AgingSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Filter state
  const [includeZeroBalance, setIncludeZeroBalance] = useState(false)
  const [statusFilter, setStatusFilter] = useState('active')

  // Inline payment form state
  const [payingAccountId, setPayingAccountId] = useState<string | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentRef, setPaymentRef] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false)

  // ─── Fetch report data ───────────────────────────────────────────────────
  const loadReport = useCallback(async () => {
    if (!locationId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId,
        status: statusFilter,
        includeZeroBalance: includeZeroBalance.toString(),
      })
      const res = await fetch(`/api/reports/house-accounts?${params}`)
      if (!res.ok) throw new Error('Failed to load report')
      const json = await res.json()
      setAccounts(json.data.accounts)
      setSummary(json.data.summary)
    } catch (error) {
      console.error('Failed to load house accounts report:', error)
      toast.error('Failed to load accounts receivable report')
    } finally {
      setIsLoading(false)
    }
  }, [locationId, statusFilter, includeZeroBalance])

  useEffect(() => {
    if (locationId) loadReport()
  }, [locationId, loadReport])

  // ─── Record payment ─────────────────────────────────────────────────────
  const handleRecordPayment = async (accountId: string) => {
    const amount = parseFloat(paymentAmount)
    if (isNaN(amount) || amount <= 0) {
      toast.error('Enter a valid payment amount')
      return
    }

    setIsSubmittingPayment(true)
    try {
      const res = await fetch(`/api/house-accounts/${accountId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          paymentMethod,
          referenceNumber: paymentRef.trim() || null,
          notes: paymentNotes.trim() || null,
          employeeId: employee?.id,
        }),
      })

      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error || 'Failed to record payment')
        return
      }

      toast.success(`Payment of ${formatCurrency(amount)} recorded`)
      resetPaymentForm()
      loadReport()
    } catch (error) {
      console.error('Failed to record payment:', error)
      toast.error('Failed to record payment')
    } finally {
      setIsSubmittingPayment(false)
    }
  }

  const resetPaymentForm = () => {
    setPayingAccountId(null)
    setPaymentAmount('')
    setPaymentMethod('cash')
    setPaymentRef('')
    setPaymentNotes('')
  }

  // ─── CSV export ──────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    if (accounts.length === 0) {
      toast.error('No data to export')
      return
    }

    const headers = ['Account', 'Contact', 'Email', 'Balance', 'Credit Limit', 'Terms (days)', 'Last Payment', 'Aging', 'Days Overdue']
    const rows = accounts.map(a => [
      a.name,
      a.contactName || '',
      a.email || '',
      a.currentBalance.toFixed(2),
      a.creditLimit.toFixed(2),
      a.paymentTerms,
      a.lastPaymentDate ? new Date(a.lastPaymentDate).toLocaleDateString() : '',
      agingBucketBadge(a.agingBucket).label,
      a.daysOverdue,
    ])

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ar-report-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ─── Summary total ───────────────────────────────────────────────────────
  const totalBalance = accounts.reduce((sum, a) => sum + a.currentBalance, 0)

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Accounts Receivable"
        subtitle="Outstanding house account balances by aging bucket"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
        actions={
          <Button variant="outline" onClick={handleExportCSV} disabled={accounts.length === 0}>
            Export CSV
          </Button>
        }
      />

      <div className="max-w-7xl mx-auto">

        {/* ═══ Filter Bar ═══ */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-center">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
              <label className="flex items-center gap-2 mt-4">
                <input
                  type="checkbox"
                  checked={includeZeroBalance}
                  onChange={e => setIncludeZeroBalance(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-700">Include $0 balances</span>
              </label>
            </div>
          </CardContent>
        </Card>

        {/* ═══ Summary Stat Cards ═══ */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total Outstanding</p>
                <p className="text-xl font-bold text-blue-600">{formatCurrency(summary.totalOutstanding)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Current (0-30)</p>
                <p className="text-xl font-bold text-green-600">{formatCurrency(summary.totalCurrent)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">30 Days</p>
                <p className="text-xl font-bold text-amber-600">{formatCurrency(summary.total30)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">60 Days</p>
                <p className="text-xl font-bold text-orange-600">{formatCurrency(summary.total60)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">90+ Days</p>
                <p className="text-xl font-bold text-red-600">{formatCurrency(summary.total90 + summary.totalOver90)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Accounts Overdue</p>
                <p className={`text-xl font-bold ${summary.overdueCount > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                  {summary.overdueCount}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ═══ Accounts Table ═══ */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
                <p className="text-gray-500">Loading accounts...</p>
              </div>
            ) : accounts.length === 0 ? (
              <div className="p-8 text-center">
                <div className="flex justify-center mb-3">
                  <svg className="w-12 h-12 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-gray-500 font-medium">No outstanding balances</p>
                <p className="text-sm text-gray-400 mt-1">All house accounts are current</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Account</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Contact</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 text-sm">Balance</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 text-sm">Credit Limit</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600 text-sm">Terms</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 text-sm">Last Payment</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600 text-sm">Aging</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600 text-sm">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map(account => {
                      const badge = agingBucketBadge(account.agingBucket)
                      const isPayingThis = payingAccountId === account.id
                      const utilizationPct = account.creditLimit > 0
                        ? Math.round((account.currentBalance / account.creditLimit) * 100)
                        : 0

                      return (
                        <tr key={account.id} className="border-b hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">{account.name}</div>
                            {account.email && (
                              <div className="text-xs text-gray-400">{account.email}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {account.contactName || '-'}
                            {account.phone && (
                              <div className="text-xs text-gray-400">{account.phone}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="font-mono font-medium text-gray-900">
                              {formatCurrency(account.currentBalance)}
                            </span>
                            {utilizationPct > 80 && (
                              <div className="text-xs text-red-500">{utilizationPct}% of limit</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm text-gray-500">
                            {formatCurrency(account.creditLimit)}
                          </td>
                          <td className="px-4 py-3 text-center text-sm text-gray-500">
                            {account.paymentTerms}d
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {account.lastPaymentDate ? (
                              <div>
                                <div>{new Date(account.lastPaymentDate).toLocaleDateString()}</div>
                                {account.lastPaymentAmount != null && (
                                  <div className="text-xs text-green-600">
                                    {formatCurrency(account.lastPaymentAmount)}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-400">Never</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                              {badge.label}
                            </span>
                            {account.daysOverdue > 0 && (
                              <div className="text-xs text-red-500 mt-0.5">
                                {account.daysOverdue}d overdue
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex gap-1 justify-center">
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => {
                                  if (isPayingThis) {
                                    resetPaymentForm()
                                  } else {
                                    resetPaymentForm()
                                    setPayingAccountId(account.id)
                                  }
                                }}
                              >
                                {isPayingThis ? 'Cancel' : 'Record Payment'}
                              </Button>
                            </div>

                            {/* Inline payment form */}
                            {isPayingThis && (
                              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-left">
                                <div className="grid grid-cols-2 gap-2 mb-2">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Amount</label>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0.01"
                                      value={paymentAmount}
                                      onChange={e => setPaymentAmount(e.target.value)}
                                      placeholder="0.00"
                                      className="w-full px-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      autoFocus
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
                                    <select
                                      value={paymentMethod}
                                      onChange={e => setPaymentMethod(e.target.value)}
                                      className="w-full px-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                      {PAYMENT_METHODS.map(m => (
                                        <option key={m.value} value={m.value}>{m.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                                <div className="mb-2">
                                  <label className="block text-xs font-medium text-gray-600 mb-1">Reference # (optional)</label>
                                  <input
                                    type="text"
                                    value={paymentRef}
                                    onChange={e => setPaymentRef(e.target.value)}
                                    placeholder="Check #, ACH ref..."
                                    className="w-full px-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                </div>
                                <div className="mb-2">
                                  <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
                                  <textarea
                                    value={paymentNotes}
                                    onChange={e => setPaymentNotes(e.target.value)}
                                    rows={2}
                                    className="w-full px-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                </div>
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => handleRecordPayment(account.id)}
                                  disabled={isSubmittingPayment}
                                  className="w-full"
                                >
                                  {isSubmittingPayment ? 'Submitting...' : 'Submit Payment'}
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 border-t-2 border-gray-300">
                      <td className="px-4 py-3 font-bold text-gray-700" colSpan={2}>
                        Total ({accounts.length} account{accounts.length !== 1 ? 's' : ''})
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-gray-900">
                        {formatCurrency(totalBalance)}
                      </td>
                      <td colSpan={5} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
