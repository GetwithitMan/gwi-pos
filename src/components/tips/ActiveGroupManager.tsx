'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { Modal } from '@/components/ui/modal'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface TipGroupMember {
  id: string
  employeeId: string
  firstName: string
  lastName: string
  displayName: string | null
  joinedAt: string
  leftAt: string | null
  status: string
  role: string
}

interface TipGroupSegment {
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
  members: TipGroupMember[]
  currentSegment: TipGroupSegment | null
}

interface EmployeeOption {
  id: string
  firstName: string
  lastName: string
  displayName: string | null
}

interface ActiveGroupManagerProps {
  locationId: string
  employeeId: string
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getMemberName(m: { displayName: string | null; firstName: string; lastName: string }) {
  return m.displayName || `${m.firstName} ${m.lastName.charAt(0)}.`
}

function formatRelativeTime(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function isStale(joinedAt: string): boolean {
  const hours = (Date.now() - new Date(joinedAt).getTime()) / (1000 * 60 * 60)
  return hours > 12
}

function getGroupDisplayName(group: TipGroupInfo): string {
  if (group.members.length > 0) {
    const ownerMember = group.members.find(m => m.employeeId === group.ownerId)
    if (ownerMember) return `${getMemberName(ownerMember)}'s Group`
  }
  return `Group ...${group.id.slice(-6)}`
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function ActiveGroupManager({ locationId, employeeId }: ActiveGroupManagerProps) {
  const [groups, setGroups] = useState<TipGroupInfo[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null)

  // Modal state
  const [addMemberGroupId, setAddMemberGroupId] = useState<string | null>(null)
  const [addMemberSearch, setAddMemberSearch] = useState('')
  const [addMemberSelected, setAddMemberSelected] = useState<string | null>(null)
  const [addMemberSaving, setAddMemberSaving] = useState(false)

  const [closeGroupId, setCloseGroupId] = useState<string | null>(null)
  const [closingGroup, setClosingGroup] = useState(false)

  const [adjustGroupId, setAdjustGroupId] = useState<string | null>(null)
  const [adjustEmployeeId, setAdjustEmployeeId] = useState('')
  const [adjustAmount, setAdjustAmount] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjustSaving, setAdjustSaving] = useState(false)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-employee-id': employeeId,
  }

  // ── Load groups ──────────────────────────────────────────────────────────────

  const loadGroups = useCallback(async () => {
    try {
      const res = await fetch(`/api/tips/groups?locationId=${locationId}&status=active`, {
        headers: { 'x-employee-id': employeeId },
      })
      if (!res.ok) throw new Error('Failed to load groups')
      const data = await res.json()
      setGroups(data.groups || [])
    } catch {
      toast.error('Failed to load active tip groups')
    } finally {
      setLoading(false)
    }
  }, [locationId, employeeId])

  // ── Load employees ───────────────────────────────────────────────────────────

  const loadEmployees = useCallback(async () => {
    try {
      const res = await fetch(`/api/employees?locationId=${locationId}`, {
        headers: { 'x-employee-id': employeeId },
      })
      if (!res.ok) throw new Error('Failed to load employees')
      const data = await res.json()
      setEmployees(data.employees || data || [])
    } catch {
      // Silent — add member modal will show empty
    }
  }, [locationId, employeeId])

  useEffect(() => {
    loadGroups()
    loadEmployees()
  }, [loadGroups, loadEmployees])

  // ── Approve join request ─────────────────────────────────────────────────────

  const handleApproveJoin = async (groupId: string, targetEmployeeId: string) => {
    try {
      const res = await fetch(`/api/tips/groups/${groupId}/members`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ employeeId: targetEmployeeId }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to approve')
      }
      toast.success('Join request approved')
      await loadGroups()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve join request')
    }
  }

  // ── Reject join request (remove pending member) ──────────────────────────────

  const handleRejectJoin = async (groupId: string, targetEmployeeId: string) => {
    try {
      const res = await fetch(`/api/tips/groups/${groupId}/members?employeeId=${targetEmployeeId}`, {
        method: 'DELETE',
        headers: { 'x-employee-id': employeeId },
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to reject')
      }
      toast.success('Join request rejected')
      await loadGroups()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject join request')
    }
  }

  // ── Remove member ────────────────────────────────────────────────────────────

  const handleRemoveMember = async (groupId: string, targetEmployeeId: string) => {
    try {
      const res = await fetch(`/api/tips/groups/${groupId}/members?employeeId=${targetEmployeeId}`, {
        method: 'DELETE',
        headers: { 'x-employee-id': employeeId },
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to remove member')
      }
      toast.success('Member removed')
      await loadGroups()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove member')
    }
  }

  // ── Transfer ownership ───────────────────────────────────────────────────────

  const handleMakeOwner = async (groupId: string, targetEmployeeId: string) => {
    try {
      const res = await fetch(`/api/tips/groups/${groupId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ newOwnerId: targetEmployeeId }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to transfer ownership')
      }
      toast.success('Ownership transferred')
      await loadGroups()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to transfer ownership')
    }
  }

  // ── Add member ───────────────────────────────────────────────────────────────

  const handleAddMember = async () => {
    if (!addMemberGroupId || !addMemberSelected) return
    setAddMemberSaving(true)
    try {
      const res = await fetch(`/api/tips/groups/${addMemberGroupId}/members`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ employeeId: addMemberSelected, action: 'add' }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to add member')
      }
      toast.success('Member added')
      setAddMemberGroupId(null)
      setAddMemberSearch('')
      setAddMemberSelected(null)
      await loadGroups()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add member')
    } finally {
      setAddMemberSaving(false)
    }
  }

  // ── Close group ──────────────────────────────────────────────────────────────

  const handleCloseGroup = async () => {
    if (!closeGroupId) return
    setClosingGroup(true)
    try {
      const res = await fetch(`/api/tips/groups/${closeGroupId}`, {
        method: 'DELETE',
        headers: { 'x-employee-id': employeeId },
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to close group')
      }
      toast.success('Group closed')
      setCloseGroupId(null)
      await loadGroups()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to close group')
    } finally {
      setClosingGroup(false)
    }
  }

  // ── Manual adjustment ────────────────────────────────────────────────────────

  const handleAdjustment = async () => {
    if (!adjustEmployeeId || !adjustAmount || !adjustReason.trim()) {
      toast.warning('All fields are required')
      return
    }
    const dollars = parseFloat(adjustAmount)
    if (isNaN(dollars)) {
      toast.warning('Enter a valid dollar amount')
      return
    }
    setAdjustSaving(true)
    try {
      const deltaCents = Math.round(dollars * 100)
      const res = await fetch('/api/tips/adjustments', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          locationId,
          adjustmentType: 'manual_override',
          reason: adjustReason.trim(),
          context: { before: 'Manual adjustment', after: 'Adjusted' },
          employeeDeltas: [{ employeeId: adjustEmployeeId, deltaCents }],
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save adjustment')
      }
      toast.success('Adjustment saved')
      setAdjustGroupId(null)
      setAdjustEmployeeId('')
      setAdjustAmount('')
      setAdjustReason('')
      await loadGroups()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save adjustment')
    } finally {
      setAdjustSaving(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-gray-900">Active Tip Groups</h2>
        <button onClick={loadGroups} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">
          Refresh
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">Manage active tip groups, add or remove members, and handle forgotten clock-outs.</p>

      {/* Loading */}
      {loading ? (
        <div className="text-sm text-gray-400 text-center py-8">Loading active groups...</div>
      ) : groups.length === 0 ? (
        /* Empty state */
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-400">No active tip groups right now.</p>
        </div>
      ) : (
        /* Group cards */
        <div className="space-y-3">
          {groups.map(group => {
            const isExpanded = expandedGroupId === group.id
            const activeMembers = group.members.filter(m => m.status === 'active')
            const pendingMembers = group.members.filter(m => m.status === 'pending')
            const ownerMember = group.members.find(m => m.employeeId === group.ownerId)

            return (
              <div key={group.id} className="rounded-xl border border-gray-200 hover:border-gray-300 transition-colors">
                {/* Header */}
                <button
                  type="button"
                  onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
                  className="w-full flex items-center gap-3 p-4 text-left cursor-pointer"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">{getGroupDisplayName(group)}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">
                        {activeMembers.length} member{activeMembers.length !== 1 ? 's' : ''}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-700">
                        {group.splitMode}
                      </span>
                      {pendingMembers.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                          {pendingMembers.length} pending
                        </span>
                      )}
                    </div>
                    {ownerMember && (
                      <p className="text-xs text-gray-400 mt-0.5">Owner: {getMemberName(ownerMember)}</p>
                    )}
                  </div>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-4">
                    {/* Pending join requests */}
                    {pendingMembers.length > 0 && (
                      <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                        <p className="text-xs font-semibold text-amber-700 mb-2">Pending Join Requests</p>
                        <div className="space-y-2">
                          {pendingMembers.map(m => (
                            <div key={m.id} className="flex items-center justify-between">
                              <span className="text-sm text-gray-700">{getMemberName(m)}</span>
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() => handleApproveJoin(group.id, m.employeeId)}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => handleRejectJoin(group.id, m.employeeId)}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-200 hover:bg-gray-300 text-gray-700 transition-colors"
                                >
                                  Reject
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Active members */}
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Active Members</p>
                      {activeMembers.length === 0 ? (
                        <p className="text-sm text-gray-400">No active members</p>
                      ) : (
                        <div className="space-y-2">
                          {activeMembers.map(m => {
                            const splitPct = group.currentSegment?.splitJson?.[m.employeeId]
                            const memberIsOwner = m.employeeId === group.ownerId
                            const memberIsStale = isStale(m.joinedAt)

                            return (
                              <div key={m.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50 border border-gray-100">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-sm font-medium text-gray-900">{getMemberName(m)}</span>
                                    {m.role && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-200 text-gray-600">
                                        {m.role}
                                      </span>
                                    )}
                                    {memberIsOwner && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">
                                        Owner
                                      </span>
                                    )}
                                    {memberIsStale && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">
                                        12h+ Active
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-xs text-gray-400">Joined {formatRelativeTime(m.joinedAt)}</span>
                                    {splitPct !== undefined && (
                                      <span className="text-xs text-indigo-500 font-medium">
                                        {(splitPct * 100).toFixed(0)}%
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {!memberIsOwner && (
                                    <button
                                      onClick={() => handleMakeOwner(group.id, m.employeeId)}
                                      className="px-2 py-1 rounded-lg text-[10px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
                                      title="Make Owner"
                                    >
                                      Make Owner
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleRemoveMember(group.id, m.employeeId)}
                                    className="px-2 py-1 rounded-lg text-[10px] font-medium text-red-500 hover:bg-red-50 transition-colors"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    {/* Action bar */}
                    <div className="flex gap-2 pt-2 border-t border-gray-100">
                      <button
                        onClick={() => {
                          setAddMemberGroupId(group.id)
                          setAddMemberSearch('')
                          setAddMemberSelected(null)
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
                      >
                        Add Member
                      </button>
                      <button
                        onClick={() => {
                          setAdjustGroupId(group.id)
                          setAdjustEmployeeId('')
                          setAdjustAmount('')
                          setAdjustReason('')
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-200 hover:bg-gray-300 text-gray-700 transition-colors"
                      >
                        Adjust Tips
                      </button>
                      <button
                        onClick={() => setCloseGroupId(group.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-100 hover:bg-red-200 text-red-700 transition-colors ml-auto"
                      >
                        Close Group
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Add Member Modal ──────────────────────────────────────────────────── */}
      <Modal isOpen={!!addMemberGroupId} onClose={() => { setAddMemberGroupId(null); setAddMemberSelected(null) }} title="Add Member" size="md" variant="default">

            {/* Search */}
            <input
              type="text"
              value={addMemberSearch}
              onChange={e => setAddMemberSearch(e.target.value)}
              placeholder="Search employees..."
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:border-indigo-500 mb-3"
              aria-label="Search employees"
            />

            {/* Employee list */}
            {(() => {
              const currentGroup = groups.find(g => g.id === addMemberGroupId)
              const memberIds = new Set(currentGroup?.members.map(m => m.employeeId) ?? [])
              const searchLower = addMemberSearch.toLowerCase()
              const available = employees.filter(emp => {
                if (memberIds.has(emp.id)) return false
                if (!addMemberSearch) return true
                const name = getMemberName(emp).toLowerCase()
                return name.includes(searchLower)
              })

              if (available.length === 0) {
                return <p className="text-sm text-gray-400 py-4 text-center">No available employees found.</p>
              }

              return (
                <div className="space-y-1 mb-4 max-h-60 overflow-y-auto">
                  {available.map(emp => (
                    <button
                      type="button"
                      key={emp.id}
                      onClick={() => setAddMemberSelected(emp.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                        addMemberSelected === emp.id
                          ? 'bg-indigo-50 border border-indigo-300 text-indigo-700 font-medium'
                          : 'bg-gray-50 border border-gray-100 text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {getMemberName(emp)}
                    </button>
                  ))}
                </div>
              )
            })()}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setAddMemberGroupId(null); setAddMemberSelected(null) }}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-semibold transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddMember}
                disabled={!addMemberSelected || addMemberSaving}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  addMemberSelected
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                {addMemberSaving ? 'Adding...' : 'Add Member'}
              </button>
            </div>
      </Modal>

      {/* ── Close Group Confirmation Modal ────────────────────────────────────── */}
      <Modal isOpen={!!closeGroupId} onClose={() => setCloseGroupId(null)} title="Close Group" size="md" variant="default">
            <p className="text-sm text-gray-500 mb-6">
              This will close the group and end tip pooling for all members.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setCloseGroupId(null)}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-semibold transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCloseGroup}
                disabled={closingGroup}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
              >
                {closingGroup ? 'Closing...' : 'Close Group'}
              </button>
            </div>
      </Modal>

      {/* ── Manual Adjustment Modal ──────────────────────────────────────────── */}
      <Modal isOpen={!!adjustGroupId} onClose={() => { setAdjustGroupId(null); setAdjustEmployeeId(''); setAdjustAmount(''); setAdjustReason('') }} title="Adjust Tips" size="md" variant="default">

            {/* Employee selector */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-600 mb-1">Employee</label>
              <select
                value={adjustEmployeeId}
                onChange={e => setAdjustEmployeeId(e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-indigo-500"
                aria-label="Select employee for adjustment"
              >
                <option value="">Select employee...</option>
                {(() => {
                  const currentGroup = groups.find(g => g.id === adjustGroupId)
                  const activeMembers = currentGroup?.members.filter(m => m.status === 'active') ?? []
                  return activeMembers.map(m => (
                    <option key={m.employeeId} value={m.employeeId}>
                      {getMemberName(m)}
                    </option>
                  ))
                })()}
              </select>
            </div>

            {/* Amount */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-600 mb-1">Amount ($)</label>
              <input
                type="number"
                step="0.01"
                value={adjustAmount}
                onChange={e => setAdjustAmount(e.target.value)}
                placeholder="e.g., 5.00 or -3.50"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:border-indigo-500"
                aria-label="Adjustment amount in dollars"
              />
              <p className="text-xs text-gray-400 mt-1">Use negative values to deduct.</p>
            </div>

            {/* Reason */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-600 mb-1">Reason</label>
              <textarea
                value={adjustReason}
                onChange={e => setAdjustReason(e.target.value)}
                placeholder="Reason for this adjustment..."
                rows={3}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:border-indigo-500 resize-none"
                aria-label="Adjustment reason"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setAdjustGroupId(null); setAdjustEmployeeId(''); setAdjustAmount(''); setAdjustReason('') }}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-semibold transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdjustment}
                disabled={adjustSaving || !adjustEmployeeId || !adjustAmount || !adjustReason.trim()}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  adjustEmployeeId && adjustAmount && adjustReason.trim()
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                {adjustSaving ? 'Saving...' : 'Save Adjustment'}
              </button>
            </div>
      </Modal>
    </section>
  )
}
