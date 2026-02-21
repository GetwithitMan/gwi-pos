'use client'

/**
 * Mission Control — GWIPOS Access Log (T-070)
 *
 * Shows who has accessed barpos.restaurant via SMS OTP.
 * Displays today's stats and full access log.
 */

import { useEffect, useState } from 'react'

interface LogEntry {
  id: string
  phone_mask: string
  ip: string
  user_agent: string | null
  action: string
  created_at: string
}

interface Stats {
  totalToday: number
  uniquePhonesToday: number
  verifiedToday: number
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  code_sent:  { label: 'Code sent',  color: 'text-blue-400 bg-blue-950 border-blue-900' },
  verified:   { label: 'Verified',   color: 'text-green-400 bg-green-950 border-green-900' },
  denied:     { label: 'Denied',     color: 'text-red-400 bg-red-950 border-red-900' },
  blocked:    { label: 'Blocked',    color: 'text-orange-400 bg-orange-950 border-orange-900' },
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(iso).toLocaleDateString()
}

export default function GWIPOSAccessPage() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/access-log?limit=100')
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setLogs(data.logs ?? [])
      setStats(data.stats ?? null)
    } catch {
      setError('Could not load access log')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000) // refresh every 30s
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">GWIPOS Access</h1>
          <p className="text-gray-400 text-sm mt-1">
            SMS OTP access log for barpos.restaurant
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg border border-gray-700 transition-colors disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">
              Access attempts today
            </p>
            <p className="text-3xl font-bold text-white">{stats.totalToday}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">
              Unique phones today
            </p>
            <p className="text-3xl font-bold text-white">{stats.uniquePhonesToday}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">
              Verified today
            </p>
            <p className="text-3xl font-bold text-green-400">{stats.verifiedToday}</p>
          </div>
        </div>
      )}

      {/* Log Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300">Access log</h2>
          <span className="text-xs text-gray-500">{logs.length} entries · updates every 30s</span>
        </div>

        {error && (
          <div className="p-4 text-red-400 text-sm">{error}</div>
        )}

        {!error && logs.length === 0 && !loading && (
          <div className="p-8 text-center text-gray-500 text-sm">
            No access attempts yet. The log will populate as people visit barpos.restaurant.
          </div>
        )}

        {logs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Phone
                  </th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Action
                  </th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                    IP
                  </th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {logs.map((entry) => {
                  const badge = ACTION_LABELS[entry.action] ?? {
                    label: entry.action,
                    color: 'text-gray-400 bg-gray-800 border-gray-700',
                  }
                  return (
                    <tr key={entry.id} className="hover:bg-gray-800/50 transition-colors">
                      <td className="px-4 py-3 text-gray-300 font-mono">
                        {entry.phone_mask}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium border ${badge.color}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                        {entry.ip}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {timeAgo(entry.created_at)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-600 mt-4">
        Phone numbers are masked at collection time. Full numbers are never stored.
        Access sessions expire after 8 hours.
      </p>
    </div>
  )
}
