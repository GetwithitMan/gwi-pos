'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'

interface Deduction {
  id: string
  orderId: string
  paymentId: string | null
  deductionType: string
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'dead'
  attempts: number
  maxAttempts: number
  lastError: string | null
  lastAttemptAt: string | null
  succeededAt: string | null
  availableAt: string
  createdAt: string
  updatedAt: string
  runCount: number
}

interface Summary {
  pending: number
  processing: number
  succeededToday: number
  failed: number
  dead: number
}

type FilterTab = 'all' | 'pending' | 'failed' | 'dead'

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-gray-700 text-gray-300',
  processing: 'bg-blue-900/50 text-blue-300',
  succeeded: 'bg-green-900/50 text-green-300',
  failed: 'bg-yellow-900/50 text-yellow-300',
  dead: 'bg-red-900/50 text-red-300',
}

export default function DeductionQueuePage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = useAuthStore(s => s.locationId)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/inventory/deductions-queue' })

  const [deductions, setDeductions] = useState<Deduction[]>([])
  const [summary, setSummary] = useState<Summary>({ pending: 0, processing: 0, succeededToday: 0, failed: 0, dead: 0 })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterTab>('all')
  const [retrying, setRetrying] = useState<string | null>(null)
  const [runningProcessor, setRunningProcessor] = useState(false)

  const fetchData = useCallback(async () => {
    if (!locationId || !employee?.id) return
    try {
      const statusParam = filter !== 'all' ? `&status=${filter}` : ''
      const res = await fetch(
        `/api/inventory/deduction-queue?locationId=${locationId}&employeeId=${employee.id}${statusParam}`
      )
      if (res.ok) {
        const json = await res.json()
        setDeductions(json.data.deductions)
        setSummary(json.data.summary)
      }
    } catch (e) {
      console.error('Failed to fetch deduction queue:', e)
    } finally {
      setLoading(false)
    }
  }, [locationId, employee?.id, filter])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData])

  const handleRetry = async (id: string) => {
    if (!locationId || !employee?.id) return
    setRetrying(id)
    try {
      const res = await fetch('/api/inventory/deduction-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          action: 'retry',
          id,
          employeeId: employee.id,
        }),
      })
      if (res.ok) {
        fetchData()
      } else {
        const json = await res.json()
        alert(json.error || 'Retry failed')
      }
    } catch (e) {
      console.error('Retry failed:', e)
      alert('Retry failed')
    } finally {
      setRetrying(null)
    }
  }

  const handleRunProcessor = async () => {
    if (!locationId || !employee?.id) return
    setRunningProcessor(true)
    try {
      const res = await fetch(`/api/cron/process-deductions?locationId=${locationId}&employeeId=${employee.id}`, {
        method: 'POST',
      })
      if (res.ok) {
        fetchData()
      } else {
        const json = await res.json()
        alert(json.error || 'Failed to run processor')
      }
    } catch (e) {
      console.error('Run processor failed:', e)
      alert('Failed to run processor')
    } finally {
      setRunningProcessor(false)
    }
  }

  if (!hydrated) return null

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'failed', label: 'Failed' },
    { key: 'dead', label: 'Dead' },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Inventory Deduction Queue</h1>
        <button
          onClick={handleRunProcessor}
          disabled={runningProcessor}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-900 disabled:opacity-50 text-white rounded-lg text-sm font-medium min-h-[48px]"
        >
          {runningProcessor ? 'Running...' : 'Run Processor'}
        </button>
      </div>

      {/* Dead alert banner */}
      {summary.dead > 0 && (
        <div className="mb-4 p-4 bg-red-900/40 border border-red-600 rounded-lg flex items-center gap-3">
          <span className="text-red-400 text-lg font-bold">!</span>
          <span className="text-red-200 font-medium">
            {summary.dead} deduction{summary.dead !== 1 ? 's' : ''} require manual attention
          </span>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        <div className="bg-gray-800 border border-gray-600 rounded-lg p-3 text-center">
          <div className="text-xs text-gray-400">Pending</div>
          <div className="text-xl font-bold text-gray-200">{summary.pending}</div>
        </div>
        <div className="bg-gray-800 border border-blue-800 rounded-lg p-3 text-center">
          <div className="text-xs text-blue-400">Processing</div>
          <div className="text-xl font-bold text-blue-300">{summary.processing}</div>
        </div>
        <div className="bg-gray-800 border border-green-800 rounded-lg p-3 text-center">
          <div className="text-xs text-green-400">Succeeded (Today)</div>
          <div className="text-xl font-bold text-green-300">{summary.succeededToday}</div>
        </div>
        <div className="bg-gray-800 border border-yellow-800 rounded-lg p-3 text-center">
          <div className="text-xs text-yellow-400">Failed</div>
          <div className="text-xl font-bold text-yellow-300">{summary.failed}</div>
        </div>
        <div className="bg-gray-800 border border-red-800 rounded-lg p-3 text-center">
          <div className="text-xs text-red-400">Dead</div>
          <div className="text-xl font-bold text-red-300">{summary.dead}</div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => { setFilter(t.key); setLoading(true) }}
            className={`px-4 py-2 rounded-lg text-sm font-medium min-h-[48px] ${
              filter === t.key
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-700 text-gray-300">
              <th className="px-4 py-3 text-left">Order</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-center">Attempts</th>
              <th className="px-4 py-3 text-left">Last Error</th>
              <th className="px-4 py-3 text-left">Created</th>
              <th className="px-4 py-3 text-left">Last Attempt</th>
              <th className="px-4 py-3 text-left">Next Retry</th>
              <th className="px-4 py-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">Loading...</td>
              </tr>
            ) : deductions.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  No deductions found
                </td>
              </tr>
            ) : (
              deductions.map(d => (
                <tr key={d.id} className="border-t border-gray-700 hover:bg-gray-700/50">
                  <td className="px-4 py-3 text-gray-300 font-mono text-xs">
                    {d.orderId.slice(-8)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_STYLES[d.status] || ''}`}>
                      {d.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-gray-300">
                    {d.attempts}/{d.maxAttempts}
                  </td>
                  <td className="px-4 py-3 text-gray-400 max-w-xs truncate" title={d.lastError ?? ''}>
                    {d.lastError || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {new Date(d.createdAt).toLocaleString([], {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {d.lastAttemptAt
                      ? new Date(d.lastAttemptAt).toLocaleString([], {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {d.status === 'pending' || d.status === 'failed'
                      ? new Date(d.availableAt).toLocaleString([], {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {(d.status === 'failed' || d.status === 'dead') && (
                      <button
                        onClick={() => handleRetry(d.id)}
                        disabled={retrying === d.id}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 disabled:opacity-50 text-white rounded text-xs font-medium min-h-[36px]"
                      >
                        {retrying === d.id ? 'Retrying...' : 'Retry'}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs text-gray-500 text-right">
        Auto-refreshes every 30 seconds
      </div>
    </div>
  )
}
