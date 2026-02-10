'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'

// ─── Types ──────────────────────────────────────────────────────────────────

interface TipGroupMemberInfo {
  id: string
  employeeId: string
  firstName: string
  lastName: string
  displayName: string | null
  joinedAt: string
  leftAt: string | null
  status: string
  role: string | null
}

interface TipGroupSegmentInfo {
  id: string
  startedAt: string
  endedAt: string | null
  memberCount: number
  splitJson: Record<string, number>
}

interface TipGroupInfo {
  id: string
  locationId: string
  createdBy: string
  ownerId: string
  registerId: string | null
  startedAt: string
  endedAt: string | null
  status: string
  splitMode: string
  members: TipGroupMemberInfo[]
  currentSegment: TipGroupSegmentInfo | null
}

interface EmployeeOption {
  id: string
  firstName: string
  lastName: string
  displayName: string | null
  role: { id: string; name: string }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function TipGroupPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()

  const [groups, setGroups] = useState<TipGroupInfo[]>([])
  const [myGroup, setMyGroup] = useState<TipGroupInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [showStartModal, setShowStartModal] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set())
  const [splitMode, setSplitMode] = useState<'equal' | 'custom'>('equal')

  // ── Auth guard ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!employee || !isAuthenticated) {
      router.push('/login')
    }
  }, [employee, isAuthenticated, router])

  // ── Fetch groups ────────────────────────────────────────────────────────

  const fetchGroups = useCallback(async () => {
    if (!employee) return
    try {
      const res = await fetch(
        `/api/tips/groups?locationId=${employee.location.id}&status=active`,
        { headers: { 'x-employee-id': employee.id } }
      )
      if (res.ok) {
        const data = await res.json()
        const allGroups: TipGroupInfo[] = data.groups || []
        setGroups(allGroups)

        // Find which group the current employee is in
        const mine = allGroups.find((g) =>
          g.members.some(
            (m) => m.employeeId === employee.id && m.status === 'active'
          )
        )
        setMyGroup(mine || null)
      } else {
        toast.error('Failed to load tip groups')
      }
    } catch {
      toast.error('Failed to load tip groups')
    } finally {
      setLoading(false)
    }
  }, [employee])

  useEffect(() => {
    fetchGroups()
  }, [fetchGroups])

  // ── Fetch employees for start modal ─────────────────────────────────────

  const fetchEmployees = useCallback(async () => {
    if (!employee) return
    try {
      const res = await fetch(
        `/api/employees?locationId=${employee.location.id}`,
        { headers: { 'x-employee-id': employee.id } }
      )
      if (res.ok) {
        const data = await res.json()
        // Filter out the current employee (they are auto-included as creator)
        const others: EmployeeOption[] = (data.employees || []).filter(
          (e: EmployeeOption) => e.id !== employee.id
        )
        setEmployees(others)
      }
    } catch {
      // Silently fail - modal will show empty list
    }
  }, [employee])

  // ── Start group ─────────────────────────────────────────────────────────

  const handleStartGroup = async () => {
    if (!employee) return
    setActionLoading(true)
    try {
      const initialMemberIds = [employee.id, ...Array.from(selectedEmployees)]
      const res = await fetch('/api/tips/groups', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-employee-id': employee.id,
        },
        body: JSON.stringify({
          locationId: employee.location.id,
          initialMemberIds,
          splitMode,
        }),
      })
      if (res.ok) {
        toast.success('Tip group started')
        setShowStartModal(false)
        setSelectedEmployees(new Set())
        setSplitMode('equal')
        await fetchGroups()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to start tip group')
      }
    } catch {
      toast.error('Failed to start tip group')
    } finally {
      setActionLoading(false)
    }
  }

  // ── Request to join ─────────────────────────────────────────────────────

  const handleRequestJoin = async (groupId: string) => {
    if (!employee) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/tips/groups/${groupId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-employee-id': employee.id,
        },
        body: JSON.stringify({
          employeeId: employee.id,
          action: 'request',
        }),
      })
      if (res.ok) {
        toast.success('Join request sent')
        await fetchGroups()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to send join request')
      }
    } catch {
      toast.error('Failed to send join request')
    } finally {
      setActionLoading(false)
    }
  }

  // ── Leave group ─────────────────────────────────────────────────────────

  const handleLeaveGroup = async () => {
    if (!employee || !myGroup) return
    setShowLeaveConfirm(false)
    setActionLoading(true)
    try {
      const res = await fetch(
        `/api/tips/groups/${myGroup.id}/members?employeeId=${employee.id}`,
        {
          method: 'DELETE',
          headers: { 'x-employee-id': employee.id },
        }
      )
      if (res.ok) {
        toast.success('You left the tip group')
        await fetchGroups()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to leave group')
      }
    } catch {
      toast.error('Failed to leave group')
    } finally {
      setActionLoading(false)
    }
  }

  // ── Close group (owner only) ────────────────────────────────────────────

  const handleCloseGroup = async () => {
    if (!employee || !myGroup) return
    setShowCloseConfirm(false)
    setActionLoading(true)
    try {
      const res = await fetch(`/api/tips/groups/${myGroup.id}`, {
        method: 'DELETE',
        headers: { 'x-employee-id': employee.id },
      })
      if (res.ok) {
        toast.success('Tip group closed')
        await fetchGroups()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to close group')
      }
    } catch {
      toast.error('Failed to close group')
    } finally {
      setActionLoading(false)
    }
  }

  // ── Approve pending join request (owner only) ───────────────────────────

  const handleApproveJoin = async (memberEmployeeId: string) => {
    if (!employee || !myGroup) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/tips/groups/${myGroup.id}/members`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-employee-id': employee.id,
        },
        body: JSON.stringify({ employeeId: memberEmployeeId }),
      })
      if (res.ok) {
        toast.success('Join request approved')
        await fetchGroups()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to approve request')
      }
    } catch {
      toast.error('Failed to approve request')
    } finally {
      setActionLoading(false)
    }
  }

  // ── Toggle employee selection in start modal ────────────────────────────

  const toggleEmployeeSelection = (empId: string) => {
    setSelectedEmployees((prev) => {
      const next = new Set(prev)
      if (next.has(empId)) {
        next.delete(empId)
      } else {
        next.add(empId)
      }
      return next
    })
  }

  // ── Open start modal ───────────────────────────────────────────────────

  const openStartModal = () => {
    setShowStartModal(true)
    fetchEmployees()
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  const getMemberDisplayName = (member: TipGroupMemberInfo) =>
    member.displayName || `${member.firstName} ${member.lastName.charAt(0)}.`

  const getOwnerName = (group: TipGroupInfo) => {
    const owner = group.members.find((m) => m.employeeId === group.ownerId)
    return owner ? getMemberDisplayName(owner) : 'Unknown'
  }

  const isCurrentEmployeePendingIn = (group: TipGroupInfo) =>
    group.members.some(
      (m) => m.employeeId === employee?.id && m.status === 'pending_approval'
    )

  const isCurrentEmployeeAlreadyIn = (group: TipGroupInfo) =>
    group.members.some(
      (m) =>
        m.employeeId === employee?.id &&
        (m.status === 'active' || m.status === 'pending_approval')
    )

  // ── Guard ───────────────────────────────────────────────────────────────

  if (!employee || !isAuthenticated) return null

  const isOwner = myGroup ? myGroup.ownerId === employee.id : false
  const activeMembers = myGroup
    ? myGroup.members.filter((m) => m.status === 'active')
    : []
  const pendingMembers = myGroup
    ? myGroup.members.filter((m) => m.status === 'pending_approval')
    : []
  const otherGroups = groups.filter((g) => g.id !== myGroup?.id)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="max-w-2xl mx-auto mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/crew')}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Tip Groups</h1>
            <p className="text-white/40 text-sm">Pool tips with your coworkers</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto space-y-6">
        {/* Loading state */}
        {loading && (
          <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-8 text-center">
            <p className="text-white/40">Loading tip groups...</p>
          </div>
        )}

        {/* Active Group Panel */}
        {!loading && myGroup && (
          <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-emerald-500/20">
                  <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-white font-semibold text-lg">Your Active Group</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 border border-emerald-500/30 text-emerald-400">
                      Active
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-500/20 border border-indigo-500/30 text-indigo-400">
                      {myGroup.splitMode === 'equal' ? 'Equal Split' : 'Custom Split'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Members list */}
            <div className="space-y-2 mb-4">
              <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">
                Members ({activeMembers.length})
              </h3>
              {activeMembers.map((member) => {
                const splitPercent =
                  myGroup.currentSegment?.splitJson?.[member.employeeId]
                const isGroupOwner = member.employeeId === myGroup.ownerId

                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between py-2 px-3 rounded-xl bg-white/5"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 text-xs font-bold">
                        {member.firstName.charAt(0)}
                        {member.lastName.charAt(0)}
                      </div>
                      <span className="text-white text-sm font-medium">
                        {getMemberDisplayName(member)}
                      </span>
                      {isGroupOwner && (
                        <span className="text-amber-400 text-xs" title="Group Owner">
                          <svg className="w-4 h-4 inline" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                          </svg>
                        </span>
                      )}
                      {member.employeeId === employee.id && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/10 text-white/50">
                          You
                        </span>
                      )}
                    </div>
                    {splitPercent !== undefined && (
                      <span className="text-emerald-400 text-sm font-mono">
                        {Math.round(splitPercent * 100)}%
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Pending join requests (owner sees these) */}
            {isOwner && pendingMembers.length > 0 && (
              <div className="space-y-2 mb-4">
                <h3 className="text-amber-400/80 text-xs font-semibold uppercase tracking-wider">
                  Pending Requests ({pendingMembers.length})
                </h3>
                {pendingMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between py-2 px-3 rounded-xl bg-amber-500/5 border border-amber-500/10"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 text-xs font-bold">
                        {member.firstName.charAt(0)}
                        {member.lastName.charAt(0)}
                      </div>
                      <span className="text-white text-sm font-medium">
                        {getMemberDisplayName(member)}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-400">
                        Pending
                      </span>
                    </div>
                    <button
                      onClick={() => handleApproveJoin(member.employeeId)}
                      disabled={actionLoading}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-400 text-xs font-semibold transition-all disabled:opacity-50"
                    >
                      Approve
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 mt-4">
              {isOwner ? (
                <button
                  onClick={() => setShowCloseConfirm(true)}
                  disabled={actionLoading}
                  className="flex-1 py-3 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
                >
                  Close Group
                </button>
              ) : (
                <button
                  onClick={() => setShowLeaveConfirm(true)}
                  disabled={actionLoading}
                  className="flex-1 py-3 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
                >
                  Leave Group
                </button>
              )}
            </div>
          </div>
        )}

        {/* No active group: Start or Join */}
        {!loading && !myGroup && (
          <>
            {/* Start a new group */}
            <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-6 text-center">
              <div className="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <h2 className="text-white font-semibold text-lg mb-2">Start a Tip Group</h2>
              <p className="text-white/40 text-sm mb-4">
                Create a new tip group and invite coworkers to pool tips together.
              </p>
              <button
                onClick={openStartModal}
                disabled={actionLoading}
                className="px-6 py-3 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-indigo-400 rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
              >
                Start New Group
              </button>
            </div>

            {/* Joinable groups */}
            {otherGroups.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider px-1">
                  Active Groups You Can Join
                </h3>
                {otherGroups.map((group) => {
                  const activeCount = group.members.filter(
                    (m) => m.status === 'active'
                  ).length
                  const alreadyIn = isCurrentEmployeeAlreadyIn(group)
                  const isPending = isCurrentEmployeePendingIn(group)

                  return (
                    <div
                      key={group.id}
                      className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-white font-medium text-sm">
                              {getOwnerName(group)}&apos;s Group
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-500/20 text-indigo-400">
                              {group.splitMode === 'equal' ? 'Equal' : 'Custom'}
                            </span>
                          </div>
                          <p className="text-white/40 text-xs">
                            {activeCount} member{activeCount !== 1 ? 's' : ''}
                          </p>
                        </div>
                        {isPending ? (
                          <span className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-semibold">
                            Pending
                          </span>
                        ) : alreadyIn ? (
                          <span className="px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
                            Joined
                          </span>
                        ) : (
                          <button
                            onClick={() => handleRequestJoin(group.id)}
                            disabled={actionLoading}
                            className="px-3 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-indigo-400 text-xs font-semibold transition-all disabled:opacity-50"
                          >
                            Request to Join
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* No groups at all */}
            {otherGroups.length === 0 && (
              <p className="text-white/30 text-sm text-center">
                No active tip groups right now. Start one above.
              </p>
            )}
          </>
        )}
      </div>

      {/* ── Start Tip Group Modal ──────────────────────────────────────────── */}
      {showStartModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800/95 border border-white/10 backdrop-blur-xl rounded-2xl p-6 max-w-md w-full max-h-[85vh] flex flex-col">
            <h3 className="text-lg font-semibold text-white mb-1">Start a Tip Group</h3>
            <p className="text-white/40 text-sm mb-4">
              You will be added automatically. Select coworkers to invite.
            </p>

            {/* Split mode selector */}
            <div className="mb-4">
              <label className="text-white/60 text-xs font-semibold uppercase tracking-wider block mb-2">
                Split Mode
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setSplitMode('equal')}
                  className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${
                    splitMode === 'equal'
                      ? 'bg-indigo-500/30 border border-indigo-500/40 text-indigo-300'
                      : 'bg-white/5 border border-white/10 text-white/50 hover:bg-white/10'
                  }`}
                >
                  Equal
                </button>
                <button
                  onClick={() => setSplitMode('custom')}
                  className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${
                    splitMode === 'custom'
                      ? 'bg-indigo-500/30 border border-indigo-500/40 text-indigo-300'
                      : 'bg-white/5 border border-white/10 text-white/50 hover:bg-white/10'
                  }`}
                >
                  Custom
                </button>
              </div>
            </div>

            {/* Employee list */}
            <div className="mb-4 flex-1 overflow-y-auto min-h-0">
              <label className="text-white/60 text-xs font-semibold uppercase tracking-wider block mb-2">
                Invite Coworkers
              </label>
              {employees.length === 0 ? (
                <p className="text-white/30 text-sm py-4 text-center">
                  Loading employees...
                </p>
              ) : (
                <div className="space-y-1">
                  {employees.map((emp) => {
                    const isSelected = selectedEmployees.has(emp.id)
                    return (
                      <button
                        key={emp.id}
                        onClick={() => toggleEmployeeSelection(emp.id)}
                        className={`w-full flex items-center gap-3 py-2.5 px-3 rounded-xl text-left transition-all ${
                          isSelected
                            ? 'bg-indigo-500/20 border border-indigo-500/30'
                            : 'bg-white/5 border border-transparent hover:bg-white/10'
                        }`}
                      >
                        <div
                          className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all ${
                            isSelected
                              ? 'bg-indigo-500 text-white'
                              : 'bg-white/10 border border-white/20'
                          }`}
                        >
                          {isSelected && (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-white text-sm font-medium block truncate">
                            {emp.displayName || `${emp.firstName} ${emp.lastName}`}
                          </span>
                          <span className="text-white/40 text-xs">{emp.role.name}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Modal actions */}
            <div className="flex gap-3 pt-2 border-t border-white/10">
              <button
                onClick={() => {
                  setShowStartModal(false)
                  setSelectedEmployees(new Set())
                  setSplitMode('equal')
                }}
                className="flex-1 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-semibold text-sm transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleStartGroup}
                disabled={actionLoading}
                className="flex-1 py-3 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-indigo-400 rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
              >
                {actionLoading ? 'Creating...' : `Start Group${selectedEmployees.size > 0 ? ` (${selectedEmployees.size + 1})` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Leave Confirmation Dialog ──────────────────────────────────────── */}
      {showLeaveConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800/95 border border-white/10 backdrop-blur-xl rounded-2xl p-8 max-w-sm w-full text-center">
            <div className="w-16 h-16 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Leave Tip Group?</h3>
            <p className="text-white/50 text-sm mb-6">
              Your tip split will stop and you will no longer pool tips with this group.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-semibold text-sm transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleLeaveGroup}
                disabled={actionLoading}
                className="py-3 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
              >
                {actionLoading ? 'Leaving...' : 'Yes, Leave'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Close Group Confirmation Dialog ─────────────────────────────────── */}
      {showCloseConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800/95 border border-white/10 backdrop-blur-xl rounded-2xl p-8 max-w-sm w-full text-center">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Close Tip Group?</h3>
            <p className="text-white/50 text-sm mb-6">
              This will end the group for all {activeMembers.length} member{activeMembers.length !== 1 ? 's' : ''}.
              Tip pooling will stop immediately.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setShowCloseConfirm(false)}
                className="py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-semibold text-sm transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleCloseGroup}
                disabled={actionLoading}
                className="py-3 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
              >
                {actionLoading ? 'Closing...' : 'Yes, Close Group'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
