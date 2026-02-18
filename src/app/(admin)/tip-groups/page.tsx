'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency, formatDateTime } from '@/lib/utils'

// ─── Types ──────────────────────────────────────────────────────────────────

interface MemberEarning {
  employeeId: string
  employeeName: string
  totalEarnedCents: number
  totalEarnedDollars: number
}

interface Segment {
  id: string
  startedAt: string
  endedAt: string | null
  memberCount: number
  splitJson: unknown
}

interface Membership {
  id: string
  employeeId: string
  employeeName: string
  joinedAt: string
  leftAt: string | null
  status: string
}

interface TipGroup {
  id: string
  createdBy: string
  ownerId: string
  startedAt: string
  endedAt: string | null
  status: string
  splitMode: string
  segments: Segment[]
  memberships: Membership[]
  memberEarnings: MemberEarning[]
}

type StatusFilter = 'all' | 'active' | 'closed'

// ─── Helpers ────────────────────────────────────────────────────────────────

function splitModeLabel(mode: string): string {
  switch (mode) {
    case 'equal': return 'Equal'
    case 'role_weighted': return 'Role Weighted'
    case 'hours_weighted': return 'Hours Weighted'
    case 'custom': return 'Custom'
    default: return mode
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function TipGroupsPage() {
  const router = useRouter()
  const employee = useAuthStore(s => s.employee)
  const locationId = useAuthStore(s => s.locationId)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)

  const [groups, setGroups] = useState<TipGroup[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // ── Auth guard ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/tip-groups')
    }
  }, [isAuthenticated, router])

  // ── Fetch data ──────────────────────────────────────────────────────────

  const loadGroups = useCallback(async () => {
    if (!locationId) return

    setIsLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ locationId })
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)

      const headers: Record<string, string> = {}
      if (employee?.id) {
        headers['x-employee-id'] = employee.id
      }

      const res = await fetch(`/api/reports/tip-groups?${params.toString()}`, {
        headers,
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to load tip groups')
      }

      const data = await res.json()
      setGroups(data.groups ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tip groups')
    } finally {
      setIsLoading(false)
    }
  }, [locationId, dateFrom, dateTo, employee?.id])

  useEffect(() => {
    if (locationId) {
      loadGroups()
    }
  }, [loadGroups, locationId])

  // ── Derived data ────────────────────────────────────────────────────────

  const filteredGroups = groups.filter((g) => {
    if (statusFilter === 'active') return g.status === 'active'
    if (statusFilter === 'closed') return g.status === 'closed'
    return true
  })

  // ── Render guards ───────────────────────────────────────────────────────

  if (!isAuthenticated || !employee) {
    return null
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Tip Groups</h1>
        <p className="text-sm text-gray-400 mt-1">
          View active and past tip-sharing groups
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-4 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          {/* Status filter */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Status</label>
            <div className="flex rounded-lg overflow-hidden border border-white/20">
              {(['all', 'active', 'closed'] as StatusFilter[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    statusFilter === s
                      ? 'bg-white/20 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Date from */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Date to */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Clear filters */}
          {(dateFrom || dateTo || statusFilter !== 'all') && (
            <button
              onClick={() => {
                setDateFrom('')
                setDateTo('')
                setStatusFilter('all')
              }}
              className="text-sm text-gray-400 hover:text-white underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Results summary */}
      <div className="text-sm text-gray-400 mb-4">
        Showing {filteredGroups.length} of {total} group{total !== 1 ? 's' : ''}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="text-center py-16 text-gray-400">Loading tip groups...</div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/20 border border-red-500/40 rounded-xl p-4 text-red-300 text-sm mb-6">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && filteredGroups.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          <p>No tip groups found for the selected filters.</p>
        </div>
      )}

      {/* Group cards */}
      {!isLoading && !error && filteredGroups.length > 0 && (
        <div className="space-y-4">
          {filteredGroups.map((group) => {
            const currentSegment = group.segments[group.segments.length - 1] ?? null
            const totalEarnings = group.memberEarnings.reduce(
              (sum, e) => sum + e.totalEarnedDollars,
              0
            )

            return (
              <div
                key={group.id}
                className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-4"
              >
                {/* Top row: badges + dates */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {/* Status badge */}
                  {group.status === 'active' ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-300">
                      Active
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-500/20 text-gray-400">
                      Closed
                    </span>
                  )}

                  {/* Split mode badge */}
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-300">
                    {splitModeLabel(group.splitMode)}
                  </span>

                  {/* Dates */}
                  <span className="text-xs text-gray-400 ml-auto">
                    {formatDateTime(group.startedAt)}
                    {group.endedAt ? ` - ${formatDateTime(group.endedAt)}` : ' - Present'}
                  </span>
                </div>

                {/* Total earnings */}
                <div className="mb-3 text-sm text-gray-300">
                  Total group earnings:{' '}
                  <span className="font-semibold text-white">
                    {formatCurrency(totalEarnings)}
                  </span>
                </div>

                {/* Current segment info */}
                {currentSegment && (
                  <div className="mb-3 px-3 py-2 bg-white/5 rounded-lg border border-white/10 text-xs text-gray-400">
                    <span className="font-medium text-gray-300">
                      Current Segment:
                    </span>{' '}
                    {currentSegment.memberCount} member{currentSegment.memberCount !== 1 ? 's' : ''}
                    {' | '}Started {formatDateTime(currentSegment.startedAt)}
                    {currentSegment.endedAt
                      ? ` | Ended ${formatDateTime(currentSegment.endedAt)}`
                      : ''}
                  </div>
                )}

                {/* Members table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 border-b border-white/10">
                        <th className="pb-2 pr-4">Member</th>
                        <th className="pb-2 pr-4">Status</th>
                        <th className="pb-2 pr-4">Joined</th>
                        <th className="pb-2 text-right">Earnings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.memberships.map((m) => {
                        const earning = group.memberEarnings.find(
                          (e) => e.employeeId === m.employeeId
                        )
                        return (
                          <tr
                            key={m.id}
                            className="border-b border-white/5 last:border-0"
                          >
                            <td className="py-2 pr-4 text-gray-200">
                              {m.employeeName}
                            </td>
                            <td className="py-2 pr-4">
                              {m.status === 'active' ? (
                                <span className="text-emerald-400 text-xs">Active</span>
                              ) : (
                                <span className="text-gray-500 text-xs">
                                  Left {m.leftAt ? formatDateTime(m.leftAt) : ''}
                                </span>
                              )}
                            </td>
                            <td className="py-2 pr-4 text-gray-400 text-xs">
                              {formatDateTime(m.joinedAt)}
                            </td>
                            <td className="py-2 text-right font-medium text-white">
                              {formatCurrency(earning?.totalEarnedDollars ?? 0)}
                            </td>
                          </tr>
                        )
                      })}

                      {group.memberships.length === 0 && (
                        <tr>
                          <td
                            colSpan={4}
                            className="py-3 text-center text-gray-500 text-xs"
                          >
                            No members
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
