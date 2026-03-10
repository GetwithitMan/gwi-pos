'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'

interface WalkoutRetryRow {
  id: string
  orderId: string | null
  amount: number
  status: string
  retryCount: number
  maxRetries: number
  nextRetryAt: string | null
  lastRetryAt: string | null
  lastRetryError: string | null
  collectedAt: string | null
  writtenOffAt: string | null
  cardType: string | null
  cardLast4: string | null
  cardholderName: string | null
  createdAt: string
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-yellow-100 text-yellow-800' },
  collected: { label: 'Collected', className: 'bg-green-100 text-green-800' },
  exhausted: { label: 'Exhausted', className: 'bg-red-100 text-red-800' },
  written_off: { label: 'Written Off', className: 'bg-gray-100 text-gray-600' },
}

export default function WalkoutRetriesPage() {
  useAuthenticationGuard()
  const employee = useAuthStore(s => s.employee)
  const [retries, setRetries] = useState<WalkoutRetryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [writeOffTarget, setWriteOffTarget] = useState<WalkoutRetryRow | null>(null)

  const locationId = employee?.location?.id

  const fetchRetries = useCallback(async () => {
    if (!locationId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ locationId })
      if (statusFilter) params.set('status', statusFilter)
      const res = await fetch(`/api/datacap/walkout-retry?${params}`)
      if (res.ok) {
        const json = await res.json()
        setRetries(json.data || [])
      }
    } finally {
      setLoading(false)
    }
  }, [locationId, statusFilter])

  useReportAutoRefresh({ onRefresh: fetchRetries })

  useEffect(() => { fetchRetries() }, [fetchRetries])

  const handleWriteOff = async () => {
    if (!writeOffTarget || !locationId) return
    const res = await fetch(`/api/datacap/walkout-retry/${writeOffTarget.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'write-off',
        employeeId: employee?.id,
        locationId,
      }),
    })
    if (res.ok) {
      setWriteOffTarget(null)
      fetchRetries()
    }
  }

  const canWriteOff = (row: WalkoutRetryRow) =>
    row.status === 'exhausted' && !row.writtenOffAt

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <AdminPageHeader
        title="Walkout Retries"
        subtitle="Track and manage walkout card capture retries"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
      />

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-900">Status:</label>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="collected">Collected</option>
          <option value="exhausted">Exhausted</option>
          <option value="written_off">Written Off</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-900">Loading...</div>
      ) : retries.length === 0 ? (
        <div className="text-center py-12 text-gray-900">No walkout retries found.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-900 uppercase">Order</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-900 uppercase">Card</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-900 uppercase">Amount</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-900 uppercase">Retries</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-900 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-900 uppercase">Last Error</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-900 uppercase">Created</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-900 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {retries.map(row => {
                const statusInfo = STATUS_LABELS[row.status] || { label: row.status, className: 'bg-gray-100 text-gray-600' }
                return (
                  <tr key={row.id}>
                    <td className="px-4 py-3 text-sm text-gray-900 font-mono">
                      {row.orderId ? row.orderId.slice(-6) : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {row.cardType || ''} {row.cardLast4 ? `****${row.cardLast4}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 text-right font-medium">
                      {formatCurrency(row.amount)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 text-center">
                      {row.retryCount} / {row.maxRetries}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                      {row.writtenOffAt && (
                        <div className="text-xs text-gray-900 mt-0.5">
                          {new Date(row.writtenOffAt).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-900 max-w-[200px] truncate">
                      {row.lastRetryError || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {new Date(row.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {canWriteOff(row) && (
                        <button
                          onClick={() => setWriteOffTarget(row)}
                          className="px-3 py-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                        >
                          Write Off
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

      <ConfirmDialog
        open={!!writeOffTarget}
        title="Write Off Walkout"
        description={writeOffTarget
          ? `Write off ${formatCurrency(writeOffTarget.amount)} for card ****${writeOffTarget.cardLast4 || '????'}? This marks the amount as unrecoverable.`
          : ''
        }
        confirmLabel="Write Off"
        destructive
        onConfirm={handleWriteOff}
        onCancel={() => setWriteOffTarget(null)}
      />
    </div>
  )
}
