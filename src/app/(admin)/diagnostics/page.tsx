'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Button } from '@/components/ui/button'
import { toast } from '@/stores/toast-store'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import { SOCKET_EVENTS } from '@/lib/socket-events'

// ============================================================================
// TYPES
// ============================================================================

interface VenueLog {
  id: string
  locationId: string
  level: string
  source: string
  category: string
  message: string
  details: Record<string, unknown> | null
  employeeId: string | null
  deviceId: string | null
  stackTrace: string | null
  createdAt: string
  expiresAt: string
}

interface LogStats {
  hours: number
  since: string
  total: number
  summary: {
    critical: number
    errors: number
    warnings: number
    info: number
  }
  byLevel: Record<string, number>
  bySource: Record<string, number>
  byCategory: Record<string, number>
  trending: Array<{
    message: string
    level: string
    source: string
    category: string
    count: number
    latestAt: string
  }>
}

interface Pagination {
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

// ============================================================================
// CONSTANTS
// ============================================================================

const LEVELS = ['all', 'critical', 'error', 'warn', 'info'] as const
const SOURCES = ['all', 'server', 'pos', 'kds', 'android', 'sync', 'pax'] as const
const CATEGORIES = ['all', 'payment', 'sync', 'hardware', 'auth', 'order', 'system'] as const

const LEVEL_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 border-red-300',
  error: 'bg-orange-100 text-orange-800 border-orange-300',
  warn: 'bg-amber-100 text-amber-800 border-amber-300',
  info: 'bg-blue-100 text-blue-800 border-blue-300',
}

const LEVEL_DOT_COLORS: Record<string, string> = {
  critical: 'bg-red-500',
  error: 'bg-orange-500',
  warn: 'bg-amber-500',
  info: 'bg-blue-500',
}

const PAGE_SIZE = 50

// ============================================================================
// HELPERS
// ============================================================================

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function DiagnosticsPage() {
  const currentEmployee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/diagnostics' })

  // Filter state
  const [level, setLevel] = useState<string>('all')
  const [source, setSource] = useState<string>('all')
  const [category, setCategory] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [dateRange, setDateRange] = useState<'1h' | '6h' | '24h' | '7d' | '30d'>('24h')

  // Data state
  const [logs, setLogs] = useState<VenueLog[]>([])
  const [stats, setStats] = useState<LogStats | null>(null)
  const [pagination, setPagination] = useState<Pagination>({ total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
  const [isLoading, setIsLoading] = useState(true)
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  // Real-time
  const [liveCount, setLiveCount] = useState(0)
  const socketRef = useRef<ReturnType<typeof getSharedSocket> | null>(null)

  // Date range to params
  const getDateParams = useCallback(() => {
    const now = new Date()
    const ranges: Record<string, number> = { '1h': 1, '6h': 6, '24h': 24, '7d': 168, '30d': 720 }
    const hours = ranges[dateRange] || 24
    const startDate = new Date(now.getTime() - hours * 60 * 60 * 1000)
    return { startDate: startDate.toISOString(), endDate: now.toISOString(), hours }
  }, [dateRange])

  // Fetch logs
  const fetchLogs = useCallback(async (offset = 0) => {
    try {
      setIsLoading(true)
      const { startDate, endDate } = getDateParams()
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        startDate,
        endDate,
      })
      if (level !== 'all') params.set('level', level)
      if (source !== 'all') params.set('source', source)
      if (category !== 'all') params.set('category', category)
      if (search.trim()) params.set('search', search.trim())

      const res = await fetch(`/api/venue-logs?${params}`)
      if (!res.ok) throw new Error('Failed to fetch logs')
      const json = await res.json()

      setLogs(json.data || [])
      setPagination(json.pagination || { total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
    } catch (err) {
      console.error('Failed to fetch logs:', err)
      toast.error('Failed to load diagnostic logs')
    } finally {
      setIsLoading(false)
    }
  }, [level, source, category, search, getDateParams])

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const { hours } = getDateParams()
      const res = await fetch(`/api/venue-logs/stats?hours=${hours}`)
      if (!res.ok) throw new Error('Failed to fetch stats')
      const json = await res.json()
      setStats(json.data || null)
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    }
  }, [getDateParams])

  // Initial load and filter changes
  useEffect(() => {
    if (!hydrated) return
    fetchLogs(0)
    fetchStats()
    setLiveCount(0)
  }, [hydrated, fetchLogs, fetchStats])

  // Socket connection for real-time log updates
  useEffect(() => {
    if (!hydrated) return

    const socket = getSharedSocket()
    socketRef.current = socket

    const handleNewLog = () => {
      setLiveCount(c => c + 1)
    }

    socket.on(SOCKET_EVENTS.VENUE_LOG_NEW, handleNewLog)

    return () => {
      socket.off(SOCKET_EVENTS.VENUE_LOG_NEW, handleNewLog)
      releaseSharedSocket()
    }
  }, [hydrated])

  // Refresh to pick up live entries
  const handleRefreshLive = useCallback(() => {
    setLiveCount(0)
    fetchLogs(0)
    fetchStats()
  }, [fetchLogs, fetchStats])

  // Pagination
  const handleNextPage = useCallback(() => {
    const next = pagination.offset + PAGE_SIZE
    fetchLogs(next)
  }, [pagination.offset, fetchLogs])

  const handlePrevPage = useCallback(() => {
    const prev = Math.max(0, pagination.offset - PAGE_SIZE)
    fetchLogs(prev)
  }, [pagination.offset, fetchLogs])

  // Export as JSON
  const handleExport = useCallback(async () => {
    setIsExporting(true)
    try {
      const { startDate, endDate } = getDateParams()
      const params = new URLSearchParams({
        limit: '2000',
        offset: '0',
        startDate,
        endDate,
      })
      if (level !== 'all') params.set('level', level)
      if (source !== 'all') params.set('source', source)
      if (category !== 'all') params.set('category', category)
      if (search.trim()) params.set('search', search.trim())

      const res = await fetch(`/api/venue-logs?${params}`)
      if (!res.ok) throw new Error('Export fetch failed')
      const json = await res.json()

      const blob = new Blob([JSON.stringify(json.data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `venue-logs-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Logs exported')
    } catch (err) {
      console.error('Export failed:', err)
      toast.error('Export failed')
    } finally {
      setIsExporting(false)
    }
  }, [getDateParams, level, source, category, search])

  if (!hydrated) return null

  const currentPage = Math.floor(pagination.offset / PAGE_SIZE) + 1
  const totalPages = Math.ceil(pagination.total / PAGE_SIZE)

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <AdminPageHeader
        title="Diagnostics"
        subtitle="Venue diagnostic logs from NUC devices and services"
        breadcrumbs={[{ label: 'Admin', href: '/dashboard' }]}
        actions={
          <div className="flex items-center gap-2">
            {liveCount > 0 && (
              <Button variant="outline" size="sm" onClick={handleRefreshLive}>
                {liveCount} new {liveCount === 1 ? 'entry' : 'entries'} — Refresh
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={isExporting}
            >
              {isExporting ? 'Exporting...' : 'Export JSON'}
            </Button>
          </div>
        }
      />

      {/* ================================================================== */}
      {/* SUMMARY CARDS */}
      {/* ================================================================== */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <SummaryCard
            label="Critical"
            count={stats.summary.critical}
            color="bg-red-50 border-red-200 text-red-700"
          />
          <SummaryCard
            label="Errors"
            count={stats.summary.errors}
            color="bg-orange-50 border-orange-200 text-orange-700"
          />
          <SummaryCard
            label="Warnings"
            count={stats.summary.warnings}
            color="bg-amber-50 border-amber-200 text-amber-700"
          />
          <SummaryCard
            label="Info"
            count={stats.summary.info}
            color="bg-blue-50 border-blue-200 text-blue-700"
          />
        </div>
      )}

      {/* ================================================================== */}
      {/* FILTERS */}
      {/* ================================================================== */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 space-y-3">
        {/* Row 1: Level + Date Range + Search */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Level dropdown */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Level</label>
            <select
              value={level}
              onChange={e => setLevel(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              {LEVELS.map(l => (
                <option key={l} value={l}>{l === 'all' ? 'All Levels' : l}</option>
              ))}
            </select>
          </div>

          {/* Date range */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Range</label>
            <div className="flex border border-gray-300 rounded overflow-hidden">
              {(['1h', '6h', '24h', '7d', '30d'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => setDateRange(r)}
                  className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                    dateRange === r
                      ? 'bg-gray-900 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search messages..."
              className="w-full border border-gray-300 rounded px-3 py-1 text-sm"
            />
          </div>
        </div>

        {/* Row 2: Source tabs + Category pills */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Source tabs */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Source</label>
            <div className="flex gap-1">
              {SOURCES.map(s => (
                <button
                  key={s}
                  onClick={() => setSource(s)}
                  className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                    source === s
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {s === 'all' ? 'All' : s}
                </button>
              ))}
            </div>
          </div>

          {/* Category pills */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Category</label>
            <div className="flex gap-1">
              {CATEGORIES.map(c => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                    category === c
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {c === 'all' ? 'All' : c}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ================================================================== */}
      {/* LOG TABLE */}
      {/* ================================================================== */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
          <span className="text-sm text-gray-600">
            {pagination.total.toLocaleString()} {pagination.total === 1 ? 'entry' : 'entries'}
            {level !== 'all' && ` (${level})`}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrevPage}
                disabled={pagination.offset === 0}
              >
                Prev
              </Button>
              <span className="text-gray-600">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNextPage}
                disabled={!pagination.hasMore}
              >
                Next
              </Button>
            </div>
          )}
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="px-4 py-12 text-center text-gray-500 text-sm">
            Loading logs...
          </div>
        )}

        {/* Empty state */}
        {!isLoading && logs.length === 0 && (
          <div className="px-4 py-12 text-center text-gray-500 text-sm">
            No log entries found for the selected filters.
          </div>
        )}

        {/* Log rows */}
        {!isLoading && logs.length > 0 && (
          <div className="divide-y divide-gray-100">
            {logs.map(log => (
              <LogRow
                key={log.id}
                log={log}
                isExpanded={expandedLogId === log.id}
                onToggle={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ================================================================== */}
      {/* TRENDING ISSUES */}
      {/* ================================================================== */}
      {stats && stats.trending.length > 0 && (
        <div className="mt-6 bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Trending Issues (Last {dateRange})</h3>
          <div className="space-y-2">
            {stats.trending.map((trend, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                  LEVEL_COLORS[trend.level] || 'bg-gray-100 text-gray-800'
                }`}>
                  {trend.count}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-gray-900 truncate">{trend.message}</p>
                  <p className="text-xs text-gray-500">
                    {trend.source} / {trend.category} — last seen {timeAgo(trend.latestAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function SummaryCard({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className={`rounded-lg border p-4 ${color}`}>
      <div className="text-2xl font-bold">{count.toLocaleString()}</div>
      <div className="text-xs font-medium uppercase tracking-wide mt-1">{label}</div>
    </div>
  )
}

function LogRow({
  log,
  isExpanded,
  onToggle,
}: {
  log: VenueLog
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    <div>
      {/* Compact row */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors"
      >
        {/* Level dot */}
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${LEVEL_DOT_COLORS[log.level] || 'bg-gray-400'}`} />

        {/* Level badge */}
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded border flex-shrink-0 ${
          LEVEL_COLORS[log.level] || 'bg-gray-100 text-gray-800 border-gray-300'
        }`}>
          {log.level}
        </span>

        {/* Source + Category */}
        <span className="text-xs text-gray-500 flex-shrink-0 w-20">{log.source}</span>
        <span className="text-xs text-gray-500 flex-shrink-0 w-20">{log.category}</span>

        {/* Message */}
        <span className="text-sm text-gray-900 truncate flex-1">{log.message}</span>

        {/* Timestamp */}
        <span className="text-xs text-gray-400 flex-shrink-0" title={new Date(log.createdAt).toISOString()}>
          {timeAgo(log.createdAt)}
        </span>

        {/* Expand chevron */}
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-1 bg-gray-50 border-t border-gray-100">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
            <Detail label="Timestamp" value={formatTimestamp(log.createdAt)} />
            <Detail label="Source" value={log.source} />
            <Detail label="Category" value={log.category} />
            <Detail label="Level" value={log.level} />
            {log.employeeId && <Detail label="Employee ID" value={log.employeeId} />}
            {log.deviceId && <Detail label="Device ID" value={log.deviceId} />}
            <Detail label="Expires" value={formatTimestamp(log.expiresAt)} />
          </div>

          {/* Full message */}
          <div className="mb-3">
            <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Message</label>
            <p className="text-sm text-gray-900 mt-0.5 whitespace-pre-wrap">{log.message}</p>
          </div>

          {/* Details JSON */}
          {log.details && Object.keys(log.details).length > 0 && (
            <div className="mb-3">
              <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Details</label>
              <pre className="mt-1 text-xs bg-white border border-gray-200 rounded p-3 overflow-x-auto max-h-48 overflow-y-auto">
                {JSON.stringify(log.details, null, 2)}
              </pre>
            </div>
          )}

          {/* Stack trace */}
          {log.stackTrace && (
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Stack Trace</label>
              <pre className="mt-1 text-xs bg-white border border-gray-200 rounded p-3 overflow-x-auto max-h-64 overflow-y-auto font-mono text-red-800">
                {log.stackTrace}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900 font-medium">{value}</dd>
    </div>
  )
}
