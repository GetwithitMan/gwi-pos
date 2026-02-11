'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { toast } from '@/stores/toast-store'

interface GroupHistoryTimelineProps {
  locationId: string
  employeeId: string
}

interface Segment {
  id: string
  startedAt: string
  endedAt: string | null
  memberCount: number
  splitJson: Record<string, number>
}

interface Membership {
  id: string
  employeeId: string
  employeeName: string
  joinedAt: string
  leftAt: string | null
  status: string
}

interface MemberEarning {
  employeeId: string
  employeeName: string
  totalEarnedCents: number
  totalEarnedDollars?: number
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

interface TimelineEvent {
  timestamp: string
  type: 'group_created' | 'member_joined' | 'member_left' | 'segment_change' | 'group_closed'
  label: string
  sublabel?: string
  dotColor: 'indigo' | 'green' | 'red' | 'blue' | 'gray'
  splitJson?: Record<string, number>
}

const TYPE_PRIORITY: Record<TimelineEvent['type'], number> = {
  group_created: 0,
  member_joined: 1,
  member_left: 2,
  segment_change: 3,
  group_closed: 4,
}

const DOT_STYLES: Record<TimelineEvent['dotColor'], string> = {
  indigo: 'bg-indigo-100 border-2 border-indigo-400',
  green: 'bg-green-100 border-2 border-green-400',
  red: 'bg-red-100 border-2 border-red-400',
  blue: 'bg-blue-100 border-2 border-blue-400',
  gray: 'bg-gray-200 border-2 border-gray-400',
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function calculateDuration(start: string, end: string | null): string {
  if (!end) return 'Active'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

function formatCurrencyFromCents(cents: number): string {
  return '$' + (cents / 100).toFixed(2)
}

function getEarningDollars(e: MemberEarning): number {
  if (e.totalEarnedDollars != null) return e.totalEarnedDollars
  return e.totalEarnedCents / 100
}

function buildTimeline(group: TipGroup): TimelineEvent[] {
  const events: TimelineEvent[] = []

  // Group created
  events.push({
    timestamp: group.startedAt,
    type: 'group_created',
    label: 'Group Created',
    sublabel: `Split mode: ${group.splitMode}`,
    dotColor: 'indigo',
  })

  // Member joins
  for (const m of group.memberships) {
    events.push({
      timestamp: m.joinedAt,
      type: 'member_joined',
      label: `${m.employeeName} joined`,
      dotColor: 'green',
    })

    // Member left
    if (m.leftAt) {
      events.push({
        timestamp: m.leftAt,
        type: 'member_left',
        label: `${m.employeeName} left`,
        dotColor: 'red',
      })
    }
  }

  // Segment changes
  for (const s of group.segments) {
    const splitEntries = Object.entries(s.splitJson || {})
    const nameMap = new Map(group.memberships.map(m => [m.employeeId, m.employeeName]))
    const sublabel = splitEntries
      .map(([empId, pct]) => `${nameMap.get(empId) || empId.slice(-6)}: ${Math.round(pct * 100)}%`)
      .join(', ')

    events.push({
      timestamp: s.startedAt,
      type: 'segment_change',
      label: `Split recalculated (${s.memberCount} members)`,
      sublabel,
      dotColor: 'blue',
      splitJson: s.splitJson,
    })
  }

  // Group closed
  if (group.endedAt) {
    events.push({
      timestamp: group.endedAt,
      type: 'group_closed',
      label: 'Group Closed',
      dotColor: 'gray',
    })
  }

  // Sort chronologically, with type priority as tiebreaker
  events.sort((a, b) => {
    const timeDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    if (timeDiff !== 0) return timeDiff
    return TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type]
  })

  return events
}

export function GroupHistoryTimeline({ locationId, employeeId }: GroupHistoryTimelineProps) {
  const [groups, setGroups] = useState<TipGroup[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [selectedGroup, setSelectedGroup] = useState<TipGroup | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Load group list on mount
  useEffect(() => {
    let cancelled = false
    async function loadGroups() {
      setLoading(true)
      try {
        const res = await fetch(
          `/api/reports/tip-groups?locationId=${encodeURIComponent(locationId)}&limit=50`,
          { headers: { 'x-employee-id': employeeId } }
        )
        if (!res.ok) throw new Error('Failed to load groups')
        const data = await res.json()
        if (!cancelled) {
          setGroups(data.groups || [])
        }
      } catch (err) {
        if (!cancelled) {
          toast.error('Failed to load tip groups')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadGroups()
    return () => { cancelled = true }
  }, [locationId, employeeId])

  // Load single group detail when selection changes
  const handleGroupSelect = useCallback(async (groupId: string) => {
    setSelectedGroupId(groupId)
    if (!groupId) {
      setSelectedGroup(null)
      return
    }
    setLoadingDetail(true)
    try {
      const res = await fetch(
        `/api/reports/tip-groups?locationId=${encodeURIComponent(locationId)}&groupId=${encodeURIComponent(groupId)}`,
        { headers: { 'x-employee-id': employeeId } }
      )
      if (!res.ok) throw new Error('Failed to load group details')
      const data = await res.json()
      const grp = data.groups?.[0] || null
      setSelectedGroup(grp)
    } catch (err) {
      toast.error('Failed to load group details')
      setSelectedGroup(null)
    } finally {
      setLoadingDetail(false)
    }
  }, [locationId, employeeId])

  const timeline = useMemo(() => {
    if (!selectedGroup) return []
    return buildTimeline(selectedGroup)
  }, [selectedGroup])

  const sortedEarnings = useMemo(() => {
    if (!selectedGroup?.memberEarnings) return []
    return [...selectedGroup.memberEarnings].sort((a, b) => getEarningDollars(b) - getEarningDollars(a))
  }, [selectedGroup])

  const nameMap = useMemo(() => {
    if (!selectedGroup) return new Map<string, string>()
    return new Map(selectedGroup.memberships.map(m => [m.employeeId, m.employeeName]))
  }, [selectedGroup])

  return (
    <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Group History & Timeline</h2>
      <p className="text-sm text-gray-500 mb-5">
        Select a group to view its membership changes and tip splits over time.
      </p>

      {/* Group selector */}
      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <select
          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-indigo-500"
          value={selectedGroupId}
          onChange={(e) => handleGroupSelect(e.target.value)}
        >
          <option value="">Select a group...</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              Group ...{g.id.slice(-6)} — {g.status === 'active' ? '\u25CF Active' : '\u25CB Closed'} — {formatDate(g.startedAt)} ({g.memberships.length} members)
            </option>
          ))}
        </select>
      )}

      {/* Loading detail */}
      {loadingDetail && (
        <p className="mt-4 text-sm text-gray-400">Loading...</p>
      )}

      {/* Empty state */}
      {!selectedGroupId && !loading && (
        <p className="mt-8 text-center text-sm text-gray-400">
          Select a group to view its timeline
        </p>
      )}

      {/* Summary card */}
      {selectedGroup && !loadingDetail && (
        <>
          <div className="mt-4 p-4 rounded-xl bg-gray-50 border border-gray-100">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-xs text-gray-500">Status</div>
                <div className="text-sm font-semibold">
                  {selectedGroup.status === 'active' ? (
                    <span className="inline-flex items-center gap-1 text-green-600">
                      <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                      Active
                    </span>
                  ) : (
                    <span className="text-gray-500">Closed</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Duration</div>
                <div className="text-sm font-semibold">
                  {calculateDuration(selectedGroup.startedAt, selectedGroup.endedAt)}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Total Members</div>
                <div className="text-sm font-semibold">
                  {selectedGroup.memberships.length}
                </div>
              </div>
            </div>
          </div>

          {/* Timeline */}
          {timeline.length === 0 && selectedGroup.segments.length === 0 ? (
            <p className="mt-6 text-center text-sm text-gray-400">
              No segment history available
            </p>
          ) : (
            <div className="relative mt-6 pl-4">
              {/* Vertical line */}
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />

              {timeline.map((event, idx) => (
                <div key={idx} className="relative flex items-start gap-4 pb-6">
                  {/* Dot */}
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center z-10 shrink-0 ${DOT_STYLES[event.dotColor]}`}
                  >
                    {event.type === 'group_created' && (
                      <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                    )}
                    {event.type === 'member_joined' && (
                      <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                      </svg>
                    )}
                    {event.type === 'member_left' && (
                      <svg className="w-3.5 h-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" />
                      </svg>
                    )}
                    {event.type === 'segment_change' && (
                      <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    )}
                    {event.type === 'group_closed' && (
                      <svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1 pt-1">
                    <p className="text-sm font-medium text-gray-900">{event.label}</p>
                    {event.sublabel && (
                      <p className="text-xs text-gray-500 mt-0.5">{event.sublabel}</p>
                    )}
                    {/* Split badges for segment changes */}
                    {event.splitJson && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {Object.entries(event.splitJson).map(([empId, pct]) => (
                          <span
                            key={empId}
                            className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-100"
                          >
                            {nameMap.get(empId) || empId.slice(-6)}: {Math.round(pct * 100)}%
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-[10px] text-gray-400 mt-1">
                      {formatDateTime(event.timestamp)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Earnings summary table */}
          {sortedEarnings.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Member Earnings</h3>
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left text-xs font-medium text-gray-500 px-4 py-2">
                        Employee
                      </th>
                      <th className="text-right text-xs font-medium text-gray-500 px-4 py-2">
                        Earned
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortedEarnings.map((e) => (
                      <tr key={e.employeeId}>
                        <td className="px-4 py-2 text-sm text-gray-900">
                          {e.employeeName}
                        </td>
                        <td
                          className={`px-4 py-2 text-sm text-right font-medium ${
                            getEarningDollars(e) > 0 ? 'text-green-600' : 'text-gray-400'
                          }`}
                        >
                          {formatCurrencyFromCents(e.totalEarnedCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
