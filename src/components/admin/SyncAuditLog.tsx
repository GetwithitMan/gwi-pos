'use client'

import { useState, useEffect, useCallback } from 'react'

interface SyncLogEntry {
  id: string
  createdAt: string
  terminalName: string
  terminalId: string
  orderNumber: number | null
  orderId: string
  amount: number
  idempotencyKey: string
  status: 'SUCCESS' | 'DUPLICATE_BLOCKED' | 'OFFLINE_SYNC' | 'VOIDED' | 'FAILED'
  cardLast4?: string
  employeeName?: string
}

interface SyncSummary {
  totalCount: number
  successCount: number
  blockedCount: number
  offlineCount: number
  voidedCount: number
  failedCount: number
  totalAmount: number
  blockedAmount: number // Money saved from double-charges!
}

interface SyncAuditLogProps {
  locationId?: string
  date?: string // YYYY-MM-DD
  terminalId?: string // Filter by specific terminal
}

export function SyncAuditLog({
  locationId = 'loc-1',
  date,
  terminalId,
}: SyncAuditLogProps) {
  const [logs, setLogs] = useState<SyncLogEntry[]>([])
  const [summary, setSummary] = useState<SyncSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null)

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({ locationId })
      if (date) params.append('date', date)
      if (terminalId) params.append('terminalId', terminalId)
      if (selectedStatus) params.append('status', selectedStatus)

      const response = await fetch(`/api/admin/sync-audit?${params}`)
      if (!response.ok) throw new Error('Failed to fetch sync audit logs')

      const data = await response.json()
      setLogs(data.logs || [])
      setSummary(data.summary)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [locationId, date, terminalId, selectedStatus])

  useEffect(() => {
    fetchLogs()
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchLogs, 30000)
    return () => clearInterval(interval)
  }, [fetchLogs])

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-800/30 p-6">
        <div>
          <h2 className="text-xl font-bold text-white">Sync & Idempotency Audit</h2>
          <p className="mt-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
            Reconciliation for Offline & Handheld Transactions
          </p>
        </div>
        <div className="flex gap-4">
          {summary && (
            <>
              <StatBox
                label="Duplicates Blocked"
                value={summary.blockedCount}
                color="text-amber-500"
                subValue={summary.blockedCount > 0 ? `$${summary.blockedAmount.toFixed(2)} saved` : undefined}
              />
              <StatBox
                label="Offline Syncs"
                value={summary.offlineCount}
                color="text-cyan-400"
              />
            </>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-950/50 px-6 py-3">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Filter:</span>
        <FilterButton
          label="All"
          active={!selectedStatus}
          onClick={() => setSelectedStatus(null)}
        />
        <FilterButton
          label="Processed"
          active={selectedStatus === 'SUCCESS'}
          onClick={() => setSelectedStatus('SUCCESS')}
          color="green"
        />
        <FilterButton
          label="Blocked"
          active={selectedStatus === 'DUPLICATE_BLOCKED'}
          onClick={() => setSelectedStatus('DUPLICATE_BLOCKED')}
          color="amber"
        />
        <FilterButton
          label="Offline"
          active={selectedStatus === 'OFFLINE_SYNC'}
          onClick={() => setSelectedStatus('OFFLINE_SYNC')}
          color="cyan"
        />
        <FilterButton
          label="Voided"
          active={selectedStatus === 'VOIDED'}
          onClick={() => setSelectedStatus('VOIDED')}
          color="red"
        />

        <div className="ml-auto">
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-700 disabled:opacity-50"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="border-b border-red-500/30 bg-red-900/20 p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-slate-950 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
              <th className="p-4">Timestamp</th>
              <th className="p-4">Terminal</th>
              <th className="p-4">Order #</th>
              <th className="p-4">Amount</th>
              <th className="p-4">Card</th>
              <th className="p-4">Idempotency Key</th>
              <th className="p-4 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading && logs.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center">
                  <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent"></div>
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center">
                  <CloudIcon className="mx-auto h-12 w-12 text-slate-700" />
                  <p className="mt-2 text-slate-400">No sync events found</p>
                  <p className="text-sm text-slate-500">
                    {selectedStatus ? 'Try a different filter' : 'All transactions processed online'}
                  </p>
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr
                  key={log.id}
                  className="transition-colors hover:bg-slate-800/30"
                >
                  <td className="p-4 font-mono text-xs text-slate-400">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="p-4 text-sm font-bold text-slate-200">
                    {log.terminalName}
                  </td>
                  <td className="p-4 text-sm text-slate-300">
                    #{log.orderNumber || 'N/A'}
                  </td>
                  <td className="p-4 font-mono text-sm text-white">
                    ${log.amount.toFixed(2)}
                  </td>
                  <td className="p-4 text-sm text-slate-400">
                    {log.cardLast4 ? `****${log.cardLast4}` : '-'}
                  </td>
                  <td className="max-w-[120px] truncate p-4 font-mono text-[10px] text-slate-500">
                    {log.idempotencyKey}
                  </td>
                  <td className="p-4">
                    <StatusBadge status={log.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer with dispute resolution info */}
      {summary && summary.blockedCount > 0 && (
        <div className="border-t border-slate-800 bg-slate-950/50 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheckIcon className="h-5 w-5 flex-shrink-0 text-green-400" />
            <div>
              <p className="text-sm font-medium text-green-400">
                Idempotency Engine Protected ${summary.blockedAmount.toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {summary.blockedCount} duplicate charge attempt{summary.blockedCount > 1 ? 's were' : ' was'} blocked.
                Customers may see pending holds on their bank statements that will clear in 2-3 business days.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Status Badge Component
function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { icon: React.ReactNode; text: string; className: string }> = {
    SUCCESS: {
      icon: <CheckCircleIcon className="h-4 w-4" />,
      text: 'Processed',
      className: 'bg-green-500/10 text-green-400 border-green-500/30',
    },
    DUPLICATE_BLOCKED: {
      icon: <NoSymbolIcon className="h-4 w-4" />,
      text: 'Duplicate Blocked',
      className: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
    },
    OFFLINE_SYNC: {
      icon: <CloudIcon className="h-4 w-4" />,
      text: 'Offline Sync',
      className: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
    },
    VOIDED: {
      icon: <XCircleIcon className="h-4 w-4" />,
      text: 'Voided',
      className: 'bg-red-500/10 text-red-400 border-red-500/30',
    },
    FAILED: {
      icon: <ExclamationCircleIcon className="h-4 w-4" />,
      text: 'Failed',
      className: 'bg-red-500/10 text-red-400 border-red-500/30',
    },
  }

  const config = configs[status] || configs.SUCCESS

  return (
    <div
      className={`flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-tight ${config.className}`}
    >
      {config.icon}
      {config.text}
    </div>
  )
}

// Stat Box Component
function StatBox({
  label,
  value,
  color,
  subValue,
}: {
  label: string
  value: number
  color: string
  subValue?: string
}) {
  return (
    <div className="text-right">
      <div className={`font-mono text-2xl font-black ${color}`}>{value}</div>
      <div className="text-[10px] font-black uppercase tracking-tighter text-slate-500">
        {label}
      </div>
      {subValue && (
        <div className="text-[9px] font-bold text-green-400">{subValue}</div>
      )}
    </div>
  )
}

// Filter Button Component
function FilterButton({
  label,
  active,
  onClick,
  color = 'slate',
}: {
  label: string
  active: boolean
  onClick: () => void
  color?: 'slate' | 'green' | 'amber' | 'cyan' | 'red'
}) {
  const colorClasses = {
    slate: active ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800',
    green: active ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'text-slate-400 hover:bg-slate-800',
    amber: active ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'text-slate-400 hover:bg-slate-800',
    cyan: active ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' : 'text-slate-400 hover:bg-slate-800',
    red: active ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'text-slate-400 hover:bg-slate-800',
  }

  return (
    <button
      onClick={onClick}
      className={`rounded-lg border border-transparent px-3 py-1 text-xs font-bold transition-colors ${colorClasses[color]}`}
    >
      {label}
    </button>
  )
}

// Inline SVG Icons
function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

function NoSymbolIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
      />
    </svg>
  )
}

function CloudIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
      />
    </svg>
  )
}

function XCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

function ExclamationCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

function ArrowPathIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  )
}

function ShieldCheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
      />
    </svg>
  )
}
