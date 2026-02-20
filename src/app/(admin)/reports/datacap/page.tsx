'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface LocalPayment {
  id: string
  amount: number
  tipAmount: number
  totalAmount: number
  cardBrand: string | null
  cardLast4: string | null
  authCode: string | null
  entryMethod: string | null
  datacapRefNumber: string | null
  datacapSequenceNo: string | null
  isOfflineCapture: boolean
  status: string
  processedAt: string
  paymentMethod: string
  datacapVerified: boolean
  datacapReturnCode: string | null
  datacapTranCode: string | null
  datacapAuthResponseText: string | null
}

interface DatacapTransaction {
  Request?: {
    TranCode?: string
    TransactionTime?: string
    Authorize?: string
    Purchase?: string
  }
  Response?: {
    TranCode?: string
    DSIXReturnCode?: string
    AuthCode?: string
    CardType?: string
    Authorize?: string
    Purchase?: string
    Gratuity?: string
    RefNo?: string
    EntryMethod?: string
    AuthResponseText?: string
  }
}

interface Summary {
  totalCard: number
  totalLive: number
  totalOffline: number
  totalVoided: number
  totalAmount: number
  datacapApproved: number
  datacapDeclined: number
  datacapTotal: number
}

type ViewTab = 'local' | 'datacap'
type StatusFilter = 'all' | 'live' | 'offline' | 'voided'

function StatusBadge({ payment }: { payment: LocalPayment }) {
  if (payment.isOfflineCapture) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" />
        Offline / SAF
      </span>
    )
  }
  if (payment.status === 'voided') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" />
        Voided
      </span>
    )
  }
  if (payment.status === 'refunded') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
        Refunded
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
      Live
    </span>
  )
}

function DatacapReturnBadge({ code, text }: { code: string | null; text: string | null }) {
  if (!code) return <span className="text-xs text-gray-400">—</span>
  if (code === '000000') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
        Approved
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700"
      title={text || code}
    >
      {code}
    </span>
  )
}

export default function DatacapTransactionReportPage() {
  const router = useRouter()
  const employee = useAuthStore(s => s.employee)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)

  const [localPayments, setLocalPayments] = useState<LocalPayment[]>([])
  const [datacapTransactions, setDatacapTransactions] = useState<DatacapTransaction[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [hasReportingKey, setHasReportingKey] = useState(false)
  const [hasMerchantId, setHasMerchantId] = useState(false)
  const [datacapError, setDatacapError] = useState<string | null>(null)
  const [datacapHasMore, setDatacapHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const [tab, setTab] = useState<ViewTab>('local')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0])
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/reports/datacap')
    }
  }, [isAuthenticated, router])

  useEffect(() => {
    if (employee?.location?.id) {
      loadReport()
    }
  }, [employee?.location?.id, startDate, endDate])

  const loadReport = async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    setDatacapError(null)
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        startDate,
        endDate,
        requestingEmployeeId: employee.id,
      })
      const res = await fetch(`/api/reports/datacap-transactions?${params}`)
      if (res.ok) {
        const data = await res.json()
        const d = data.data
        setLocalPayments(d.localPayments || [])
        setDatacapTransactions(d.datacapTransactions || [])
        setSummary(d.summary || null)
        setHasReportingKey(d.hasReportingKey || false)
        setHasMerchantId(d.hasMerchantId || false)
        setDatacapError(d.datacapError || null)
        setDatacapHasMore(d.datacapHasMore || false)
      }
    } catch {
      setDatacapError('Failed to load report')
    } finally {
      setIsLoading(false)
    }
  }

  const setQuickRange = (range: 'today' | 'yesterday' | 'week') => {
    const today = new Date()
    if (range === 'today') {
      const d = today.toISOString().split('T')[0]
      setStartDate(d)
      setEndDate(d)
    } else if (range === 'yesterday') {
      const yest = new Date(today)
      yest.setDate(yest.getDate() - 1)
      const d = yest.toISOString().split('T')[0]
      setStartDate(d)
      setEndDate(d)
    } else {
      const weekAgo = new Date(today)
      weekAgo.setDate(weekAgo.getDate() - 6)
      setStartDate(weekAgo.toISOString().split('T')[0])
      setEndDate(today.toISOString().split('T')[0])
    }
  }

  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

  const filteredLocal = localPayments.filter((p) => {
    if (statusFilter === 'live') return !p.isOfflineCapture && p.status === 'completed'
    if (statusFilter === 'offline') return p.isOfflineCapture
    if (statusFilter === 'voided') return p.status === 'voided' || p.status === 'refunded'
    return true
  })

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Payment Verification"
        subtitle="Datacap transaction report"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
      />

      <div className="max-w-7xl mx-auto space-y-4">

        {/* Filters */}
        <Card className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex gap-1">
              {(['today', 'yesterday', 'week'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setQuickRange(r)}
                  className="px-3 py-1.5 text-xs font-medium rounded border border-gray-300 hover:bg-gray-100 capitalize"
                >
                  {r === 'week' ? 'This Week' : r.charAt(0).toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Start</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-1.5 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">End</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-1.5 border rounded-lg text-sm"
              />
            </div>
            <Button variant="outline" size="sm" onClick={loadReport}>
              Refresh
            </Button>
          </div>
        </Card>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Card Payments</p>
              <p className="text-2xl font-bold mt-1">{summary.totalCard}</p>
              <p className="text-sm text-gray-500 mt-0.5">{formatCurrency(summary.totalAmount)}</p>
            </Card>
            <Card className="p-4 bg-green-50">
              <p className="text-xs text-green-600 uppercase tracking-wide">Live / Captured</p>
              <p className="text-2xl font-bold text-green-700 mt-1">{summary.totalLive}</p>
              <p className="text-xs text-green-600 mt-0.5">Processed online</p>
            </Card>
            <Card className="p-4 bg-yellow-50">
              <p className="text-xs text-yellow-700 uppercase tracking-wide">Offline / SAF</p>
              <p className="text-2xl font-bold text-yellow-800 mt-1">{summary.totalOffline}</p>
              <p className="text-xs text-yellow-700 mt-0.5">Awaiting settlement</p>
            </Card>
            <Card className="p-4 bg-gray-50">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Voided / Refunded</p>
              <p className="text-2xl font-bold text-gray-700 mt-1">{summary.totalVoided}</p>
              <p className="text-xs text-gray-500 mt-0.5">Reversed transactions</p>
            </Card>
          </div>
        )}

        {/* Datacap cloud summary — only shown if reporting key configured */}
        {summary && hasReportingKey && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Card className="p-4 border-blue-200 bg-blue-50">
              <p className="text-xs text-blue-600 uppercase tracking-wide">Datacap: Approved</p>
              <p className="text-2xl font-bold text-blue-700 mt-1">{summary.datacapApproved}</p>
              <p className="text-xs text-blue-600 mt-0.5">DSIXReturnCode 000000</p>
            </Card>
            <Card className="p-4 border-red-200 bg-red-50">
              <p className="text-xs text-red-600 uppercase tracking-wide">Datacap: Declined</p>
              <p className="text-2xl font-bold text-red-700 mt-1">{summary.datacapDeclined}</p>
              <p className="text-xs text-red-600 mt-0.5">Non-zero return codes</p>
            </Card>
            <Card className="p-4 border-gray-200">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Datacap: Total</p>
              <p className="text-2xl font-bold text-gray-700 mt-1">{summary.datacapTotal}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {datacapHasMore ? 'First 100 shown — more available' : 'All records shown'}
              </p>
            </Card>
          </div>
        )}

        {/* Config warnings */}
        {!hasMerchantId && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <strong>No Datacap Merchant ID configured.</strong> Payment processing requires a merchant ID.
            This will be set automatically when Datacap provisioning is complete.
          </div>
        )}
        {hasMerchantId && !hasReportingKey && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
            <strong>Datacap Reporting API key not configured.</strong> Showing local payment records only.
            To enable cross-verification with Datacap&apos;s cloud records, add{' '}
            <code className="px-1 py-0.5 bg-gray-200 rounded text-xs">DATACAP_REPORTING_API_KEY</code> to
            environment variables. Get the key from your Datacap Reportal dashboard under Settings.
          </div>
        )}
        {datacapError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <strong>Datacap Reporting error:</strong> {datacapError}
          </div>
        )}

        {/* View Tabs */}
        <div className="flex gap-2 border-b border-gray-200">
          <button
            onClick={() => setTab('local')}
            className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
              tab === 'local'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Local Payments ({localPayments.length})
          </button>
          {hasReportingKey && (
            <button
              onClick={() => setTab('datacap')}
              className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                tab === 'datacap'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Datacap Cloud ({datacapTransactions.length})
            </button>
          )}
        </div>

        {/* LOCAL PAYMENTS VIEW */}
        {tab === 'local' && (
          <>
            {/* Status filter */}
            <div className="flex gap-2">
              {(['all', 'live', 'offline', 'voided'] as StatusFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    statusFilter === f
                      ? 'bg-gray-900 text-white'
                      : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'live' ? 'Live' : f === 'offline' ? 'Offline / SAF' : 'Voided / Refunded'}
                </button>
              ))}
            </div>

            {isLoading ? (
              <div className="text-center py-16 text-gray-400">Loading...</div>
            ) : filteredLocal.length === 0 ? (
              <Card className="p-10 text-center">
                <p className="text-gray-500">No card payments found for this period.</p>
              </Card>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Time</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Amount</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Card</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Entry</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Auth Code</th>
                      {hasReportingKey && (
                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Datacap</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredLocal.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                          {formatTime(p.processedAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{formatCurrency(p.totalAmount)}</div>
                          {p.tipAmount > 0 && (
                            <div className="text-xs text-gray-400">+{formatCurrency(p.tipAmount)} tip</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{p.cardBrand || p.paymentMethod}</div>
                          {p.cardLast4 && (
                            <div className="text-xs text-gray-400">••••{p.cardLast4}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600 capitalize">
                          {p.entryMethod?.toLowerCase() || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge payment={p} />
                        </td>
                        <td className="px-4 py-3">
                          {p.authCode ? (
                            <code className="text-xs font-mono text-gray-700">{p.authCode}</code>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        {hasReportingKey && (
                          <td className="px-4 py-3">
                            {p.isOfflineCapture ? (
                              <span className="text-xs text-gray-400">Pending</span>
                            ) : (
                              <DatacapReturnBadge
                                code={p.datacapReturnCode}
                                text={p.datacapAuthResponseText}
                              />
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* DATACAP CLOUD VIEW */}
        {tab === 'datacap' && hasReportingKey && (
          <>
            {isLoading ? (
              <div className="text-center py-16 text-gray-400">Loading...</div>
            ) : datacapTransactions.length === 0 ? (
              <Card className="p-10 text-center">
                <p className="text-gray-500">No transactions found in Datacap for this period.</p>
                {datacapError && (
                  <p className="text-sm text-red-500 mt-2">{datacapError}</p>
                )}
              </Card>
            ) : (
              <>
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Time</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Tran Code</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Amount</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Card Type</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Auth Code</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {datacapTransactions.map((t, idx) => {
                        const approved = t.Response?.DSIXReturnCode === '000000'
                        const amount = t.Response?.Authorize || t.Response?.Purchase || t.Request?.Authorize || '0'
                        return (
                          <tr key={idx} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                              {t.Request?.TransactionTime
                                ? formatTime(t.Request.TransactionTime)
                                : '—'}
                            </td>
                            <td className="px-4 py-3 font-medium">
                              {t.Response?.TranCode || t.Request?.TranCode || '—'}
                            </td>
                            <td className="px-4 py-3 font-medium">
                              {formatCurrency(parseFloat(amount) || 0)}
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {t.Response?.CardType || '—'}
                            </td>
                            <td className="px-4 py-3">
                              {t.Response?.AuthCode ? (
                                <code className="text-xs font-mono text-gray-700">{t.Response.AuthCode}</code>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {t.Response?.DSIXReturnCode ? (
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                    approved
                                      ? 'bg-green-100 text-green-700'
                                      : 'bg-red-100 text-red-700'
                                  }`}
                                  title={t.Response.AuthResponseText || ''}
                                >
                                  {approved ? 'Approved' : t.Response.DSIXReturnCode}
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {datacapHasMore && (
                  <p className="text-sm text-gray-500 text-center py-2">
                    Showing first 100 records. Narrow your date range to see all transactions.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
