'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import {
  CreditCardIcon,
  ArrowPathIcon,
  XCircleIcon,
  ChevronLeftIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '@/stores/auth-store'
import { useEvents } from '@/lib/events'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ReaderHealth {
  id: string
  name: string
  isOnline: boolean
  avgResponseTime: number | null
  successRate: number | null
  lastSeenAt: string | null
  lastError: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatLastSeen(dateString: string | null): string {
  if (!dateString) return 'Never'
  const diff = Date.now() - new Date(dateString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return new Date(dateString).toLocaleDateString()
}

// ─── Color coding helpers ─────────────────────────────────────────────────────

function responseTimeColor(ms: number | null): string {
  if (ms == null) return 'text-gray-400'
  if (ms < 500) return 'text-green-600'
  if (ms <= 2000) return 'text-amber-600'
  return 'text-red-600'
}

function responseTimeBg(ms: number | null): string {
  if (ms == null) return 'bg-gray-50 text-gray-400'
  if (ms < 500) return 'bg-green-50 text-green-700'
  if (ms <= 2000) return 'bg-amber-50 text-amber-700'
  return 'bg-red-50 text-red-700'
}

function successRateColor(rate: number | null): string {
  if (rate == null) return 'text-gray-400'
  if (rate > 95) return 'text-green-600'
  if (rate >= 85) return 'text-amber-600'
  return 'text-red-600'
}

function successRateBg(rate: number | null): string {
  if (rate == null) return 'bg-gray-50 text-gray-400'
  if (rate > 95) return 'bg-green-50 text-green-700'
  if (rate >= 85) return 'bg-amber-50 text-amber-700'
  return 'bg-red-50 text-red-700'
}

// ─── Reader Card ───────────────────────────────────────────────────────────────

function ReaderCard({ reader }: { reader: ReaderHealth }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-4 px-5 py-4">
        {/* Icon + status dot */}
        <div className="relative flex-shrink-0">
          <CreditCardIcon className="w-9 h-9 text-gray-300" />
          <span
            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
              reader.isOnline ? 'bg-green-500' : 'bg-red-400'
            }`}
          />
        </div>

        {/* Name + online badge */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-semibold text-gray-900">{reader.name}</span>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                reader.isOnline
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  reader.isOnline ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              {reader.isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            Last seen: {formatLastSeen(reader.lastSeenAt)}
          </p>
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-2 divide-x divide-gray-100 border-t border-gray-100">
        {/* Avg Response Time */}
        <div className="px-5 py-3">
          <p className="text-xs text-gray-500 font-medium mb-1">Avg Response Time</p>
          {reader.avgResponseTime != null ? (
            <div className="flex items-baseline gap-1">
              <span className={`text-lg font-bold ${responseTimeColor(reader.avgResponseTime)}`}>
                {reader.avgResponseTime}
              </span>
              <span className="text-xs text-gray-400">ms</span>
              <span
                className={`ml-2 px-1.5 py-0.5 rounded text-xs font-medium ${responseTimeBg(reader.avgResponseTime)}`}
              >
                {reader.avgResponseTime < 500
                  ? 'Fast'
                  : reader.avgResponseTime <= 2000
                  ? 'Slow'
                  : 'Critical'}
              </span>
            </div>
          ) : (
            <span className="text-sm text-gray-400">No data</span>
          )}
        </div>

        {/* Success Rate */}
        <div className="px-5 py-3">
          <p className="text-xs text-gray-500 font-medium mb-1">Success Rate</p>
          {reader.successRate != null ? (
            <div className="flex items-baseline gap-1">
              <span className={`text-lg font-bold ${successRateColor(reader.successRate)}`}>
                {reader.successRate.toFixed(1)}
              </span>
              <span className="text-xs text-gray-400">%</span>
              <span
                className={`ml-2 px-1.5 py-0.5 rounded text-xs font-medium ${successRateBg(reader.successRate)}`}
              >
                {reader.successRate > 95
                  ? 'Good'
                  : reader.successRate >= 85
                  ? 'Degraded'
                  : 'Critical'}
              </span>
            </div>
          ) : (
            <span className="text-sm text-gray-400">No data</span>
          )}
        </div>
      </div>

      {/* Last error bar */}
      {reader.lastError && (
        <div className="px-5 py-2 bg-red-50 border-t border-red-100 text-xs text-red-600 flex items-center gap-2">
          <XCircleIcon className="w-3.5 h-3.5 flex-shrink-0" />
          {reader.lastError}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function ReaderHealthPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id
  const { isConnected } = useEvents({ locationId, autoConnect: true })

  const [readers, setReaders] = useState<ReaderHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchHealth = useCallback(async () => {
    if (!locationId) return
    setRefreshing(true)
    try {
      const res = await fetch(`/api/hardware/readers/health?locationId=${locationId}`)
      if (res.ok) {
        const data = await res.json()
        setReaders(data.data?.readers ?? [])
        setLastRefresh(new Date())
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [locationId])

  // Initial load
  useEffect(() => {
    fetchHealth()
  }, [fetchHealth])

  // Auto-refresh every 30 seconds (only when socket is disconnected)
  useEffect(() => {
    if (isConnected) return // Skip polling when socket is active
    const interval = setInterval(() => {
      fetchHealth()
    }, 30000)
    return () => clearInterval(interval)
  }, [fetchHealth, isConnected])

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6 max-w-4xl mx-auto">
        <AdminPageHeader
          title="Reader Health"
          subtitle="Live metrics from payment readers — refreshes every 30 seconds"
          breadcrumbs={[
            { label: 'Settings', href: '/settings' },
            { label: 'Hardware', href: '/settings/hardware' },
            { label: 'Payment Readers', href: '/settings/hardware/payment-readers' },
          ]}
          actions={
            <div className="flex items-center gap-3">
              {lastRefresh && (
                <span className="text-xs text-gray-400">
                  Updated {formatLastSeen(lastRefresh.toISOString())}
                </span>
              )}
              <button
                onClick={fetchHealth}
                disabled={refreshing}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors font-medium text-sm"
              >
                <ArrowPathIcon className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          }
        />

        {/* Back link */}
        <div className="mb-5">
          <Link
            href="/settings/hardware/payment-readers"
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            <ChevronLeftIcon className="w-4 h-4" />
            Back to Payment Readers
          </Link>
        </div>

        {/* No readers */}
        {readers.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border-2 border-dashed border-gray-200">
            <CreditCardIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 font-medium mb-1">No readers registered</p>
            <p className="text-sm text-gray-400">
              Register readers on the{' '}
              <Link href="/settings/hardware/payment-readers" className="text-blue-600 hover:underline">
                Payment Readers
              </Link>{' '}
              page first.
            </p>
          </div>
        ) : (
          <>
            {/* Summary strip */}
            <div className="grid grid-cols-3 gap-4 mb-5">
              <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{readers.length}</p>
                <p className="text-xs text-gray-500 mt-0.5">Total Readers</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 text-center">
                <p className="text-2xl font-bold text-green-600">
                  {readers.filter(r => r.isOnline).length}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">Online</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 text-center">
                <p className="text-2xl font-bold text-red-500">
                  {readers.filter(r => !r.isOnline).length}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">Offline</p>
              </div>
            </div>

            {/* Reader cards */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Readers ({readers.length})
              </p>
              {readers.map(reader => (
                <ReaderCard key={reader.id} reader={reader} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
