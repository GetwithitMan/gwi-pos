'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { Modal } from '@/components/ui/modal'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface OwnerEntry {
  id: string
  employeeId: string
  sharePercent: number
  employee: {
    firstName: string
    lastName: string
    displayName: string | null
  }
}

interface Ownership {
  id: string
  orderId: string
  splitType: string
  isActive: boolean
  entries: OwnerEntry[]
}

interface EmployeeOption {
  id: string
  firstName: string
  lastName: string
  displayName: string | null
}

interface SharedOwnershipModalProps {
  orderId: string
  locationId: string
  employeeId: string
  isOpen: boolean
  onClose: () => void
  onUpdated?: () => void
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getDisplayName(emp: { firstName: string; lastName: string; displayName: string | null }) {
  return emp.displayName || `${emp.firstName} ${emp.lastName.charAt(0)}.`
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function SharedOwnershipModal({
  orderId,
  locationId,
  employeeId,
  isOpen,
  onClose,
  onUpdated,
}: SharedOwnershipModalProps) {
  const [ownership, setOwnership] = useState<Ownership | null>(null)
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [splitMode, setSplitMode] = useState<'even' | 'custom'>('even')
  const [customSplits, setCustomSplits] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [addingOwner, setAddingOwner] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [savingSplits, setSavingSplits] = useState(false)
  const [loadingEmployees, setLoadingEmployees] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [transferring, setTransferring] = useState(false)

  const headers = {
    'Content-Type': 'application/json',
    'x-employee-id': employeeId,
  }

  // ── Fetch current ownership ────────────────────────────────────────────────

  const fetchOwnership = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ locationId })
      const res = await fetch(`/api/orders/${orderId}/ownership?${params}`, {
        headers: { 'x-employee-id': employeeId },
      })
      if (!res.ok) throw new Error('Failed to fetch ownership')
      const rawRes = await res.json()
      const data = rawRes.data ?? rawRes
      const raw = data.ownership

      if (raw) {
        // Map API shape (owners with flat employee data) → modal shape (entries with nested employee)
        const mapped: Ownership = {
          id: raw.id,
          orderId: raw.orderId,
          splitType: raw.splitType || 'even',
          isActive: raw.isActive,
          entries: (raw.owners || []).map((o: { id: string; employeeId: string; sharePercent: number; firstName?: string; lastName?: string; displayName?: string | null; employee?: { firstName: string; lastName: string; displayName: string | null } }) => ({
            id: o.id,
            employeeId: o.employeeId,
            sharePercent: o.sharePercent,
            employee: o.employee || {
              firstName: o.firstName || '',
              lastName: o.lastName || '',
              displayName: o.displayName ?? null,
            },
          })),
        }
        setOwnership(mapped)
        setSplitMode(mapped.splitType === 'custom' ? 'custom' : 'even')
        const splits: Record<string, string> = {}
        for (const entry of mapped.entries) {
          splits[entry.employeeId] = String(entry.sharePercent)
        }
        setCustomSplits(splits)
      } else {
        setOwnership(null)
        setSplitMode('even')
        setCustomSplits({})
      }
    } catch {
      toast.error('Failed to load ownership data')
    } finally {
      setLoading(false)
    }
  }, [orderId, locationId, employeeId])

  // ── Fetch clocked-in employees (open shifts) ──────────────────────────────

  const fetchEmployees = useCallback(async () => {
    setLoadingEmployees(true)
    try {
      const params = new URLSearchParams({ locationId, status: 'open' })
      const res = await fetch(`/api/shifts?${params}`)
      if (!res.ok) throw new Error('Failed to fetch shifts')
      const raw = await res.json()
      const data = raw.data ?? raw
      // Extract unique employees from open shifts — only those with pos.access permission
      const seen = new Set<string>()
      const clockedIn: EmployeeOption[] = []
      for (const shift of data.shifts || []) {
        if (!seen.has(shift.employee.id)) {
          seen.add(shift.employee.id)
          const perms: string[] = shift.employee.permissions || []
          const hasPosAccess = perms.some((p: string) => p === 'pos.access' || p === 'pos.*' || p === '*')
          if (!hasPosAccess) continue // Skip employees without POS access
          const parts = shift.employee.name?.split(' ') || ['', '']
          clockedIn.push({
            id: shift.employee.id,
            firstName: parts[0] || '',
            lastName: parts.slice(1).join(' ') || '',
            displayName: shift.employee.name || null,
          })
        }
      }
      setEmployees(clockedIn)
    } catch {
      toast.error('Failed to load clocked-in employees')
    } finally {
      setLoadingEmployees(false)
    }
  }, [locationId])

  // ── Auto-seed current employee as first owner if no ownership exists ───────

  const seedCurrentOwner = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}/ownership`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          locationId,
          employeeId,
          splitType: 'even',
        }),
      })
      if (res.ok) {
        await fetchOwnership()
      }
    } catch {
      // Silent — fetchOwnership will show the empty state
    }
  }, [orderId, locationId, employeeId, fetchOwnership])

  // ── Load data on open ──────────────────────────────────────────────────────

  useEffect(() => {
    if (isOpen) {
      setSelectedEmployeeId('')
      fetchOwnership().then(() => {
        // After fetching, check if we need to seed the current employee
      })
      fetchEmployees()
    }
  }, [isOpen, fetchOwnership, fetchEmployees])

  // Auto-seed: once loading finishes, if no owners exist, add current employee
  useEffect(() => {
    if (isOpen && !loading && ownership === null) {
      seedCurrentOwner()
    }
  }, [isOpen, loading, ownership, seedCurrentOwner])

  // ── Add owner ──────────────────────────────────────────────────────────────

  const handleAddOwner = async () => {
    if (!selectedEmployeeId) {
      toast.warning('Select an employee to add')
      return
    }

    setAddingOwner(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/ownership`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          locationId,
          employeeId: selectedEmployeeId,
          splitType: 'even',
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to add owner')
      }

      toast.success('Owner added')
      setSelectedEmployeeId('')
      await fetchOwnership()
      onUpdated?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add owner'
      toast.error(message)
    } finally {
      setAddingOwner(false)
    }
  }

  // ── Remove owner ───────────────────────────────────────────────────────────

  const handleRemoveOwner = async (removeEmployeeId: string) => {
    setRemovingId(removeEmployeeId)
    try {
      const res = await fetch(`/api/orders/${orderId}/ownership`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ employeeId: removeEmployeeId }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to remove owner')
      }

      toast.success('Owner removed')
      await fetchOwnership()
      onUpdated?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove owner'
      toast.error(message)
    } finally {
      setRemovingId(null)
    }
  }

  // ── Save custom splits ────────────────────────────────────────────────────

  const handleSaveSplits = async () => {
    if (!ownership) return

    // Validate splits sum to 100
    const splits = ownership.entries.map((entry) => ({
      employeeId: entry.employeeId,
      sharePercent: parseFloat(customSplits[entry.employeeId] || '0'),
    }))

    const total = splits.reduce((sum, s) => sum + s.sharePercent, 0)
    if (Math.abs(total - 100) > 0.01) {
      toast.warning(`Splits must total 100% (currently ${total.toFixed(1)}%)`)
      return
    }

    // Validate no negative or zero values
    for (const s of splits) {
      if (s.sharePercent <= 0 || isNaN(s.sharePercent)) {
        toast.warning('Each owner must have a percentage greater than 0')
        return
      }
    }

    setSavingSplits(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/ownership`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ locationId, splits }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update splits')
      }

      toast.success('Splits updated')
      await fetchOwnership()
      onUpdated?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update splits'
      toast.error(message)
    } finally {
      setSavingSplits(false)
    }
  }

  // ── Transfer ownership ────────────────────────────────────────────────────

  const handleTransferOwnership = async (newOwnerId: string) => {
    setTransferring(true)
    try {
      // 1. Transfer the order to the new owner
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ employeeId: newOwnerId }),
      })
      if (!res.ok) throw new Error('Failed to transfer ownership')

      // 2. Remove self from shared ownership
      await fetch(`/api/orders/${orderId}/ownership`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ employeeId }),
      })

      toast.success('Table transferred')
      onUpdated?.()
      onClose()
    } catch {
      toast.error('Failed to transfer ownership')
    } finally {
      setTransferring(false)
      setShowTransfer(false)
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const ownerIds = new Set(ownership?.entries.map((e) => e.employeeId) ?? [])
  const availableEmployees = employees.filter((emp) => !ownerIds.has(emp.id))
  const hasOwners = ownership && ownership.entries.length > 0
  const coOwners = ownership?.entries.filter((e) => e.employeeId !== employeeId) ?? []

  const currentTotal = hasOwners
    ? ownership.entries.reduce(
        (sum, e) => sum + parseFloat(customSplits[e.employeeId] || '0'),
        0
      )
    : 0
  const splitsValid = Math.abs(currentTotal - 100) < 0.01
  const hasSplitChanges =
    splitMode === 'custom' &&
    hasOwners &&
    ownership.entries.some(
      (e) => String(e.sharePercent) !== (customSplits[e.employeeId] || '0')
    )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Share Table" size="md" variant="default">

        {/* ── Loading ──────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="text-center py-10 text-white/40">Loading ownership...</div>
        ) : (
          <>
            {/* ── Current owners ────────────────────────────────────────────── */}
            <div className="mb-4">
              <p className="text-xs font-medium text-white/50 uppercase tracking-wider mb-2">
                Current Owners
              </p>

              {!hasOwners ? (
                <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-5 text-center">
                  <p className="text-sm text-white/40">No shared ownership yet</p>
                  <p className="text-xs text-white/25 mt-1">Add servers below to share tips on this table</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {ownership.entries.map((entry) => {
                    const isOwner = entry.employeeId === employeeId
                    return (
                    <div
                      key={entry.id}
                      className={`flex items-center gap-3 rounded-xl px-4 py-3 ${
                        isOwner
                          ? 'bg-indigo-500/10 border border-indigo-500/30'
                          : 'bg-white/5 border border-white/10'
                      }`}
                    >
                      {/* Avatar circle */}
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        isOwner
                          ? 'bg-indigo-500/40 border border-indigo-400/50 text-indigo-200'
                          : 'bg-indigo-500/30 border border-indigo-400/40 text-indigo-300'
                      }`}>
                        {entry.employee.firstName.charAt(0)}
                        {entry.employee.lastName.charAt(0)}
                      </div>

                      {/* Name + Owner badge */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-white truncate">
                            {getDisplayName(entry.employee)}
                          </p>
                          {isOwner && (
                            <span className="text-[10px] font-semibold text-indigo-300 bg-indigo-500/20 px-1.5 py-0.5 rounded">
                              Owner
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Split percentage */}
                      {splitMode === 'custom' ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={customSplits[entry.employeeId] ?? ''}
                            onChange={(e) =>
                              setCustomSplits((prev) => ({
                                ...prev,
                                [entry.employeeId]: e.target.value,
                              }))
                            }
                            className="w-16 bg-white/10 border border-white/20 rounded-lg px-2 py-1.5 text-sm text-white text-right focus:outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/30"
                            aria-label={`Split percentage for ${getDisplayName(entry.employee)}`}
                          />
                          <span className="text-sm text-white/40">%</span>
                        </div>
                      ) : (
                        <span className="text-sm font-medium text-white/60 shrink-0">
                          {entry.sharePercent}%
                        </span>
                      )}

                      {/* Remove button — owner sees Transfer instead */}
                      {!isOwner ? (
                        <button
                          onClick={() => handleRemoveOwner(entry.employeeId)}
                          disabled={removingId === entry.employeeId}
                          className="p-1.5 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0 disabled:opacity-40"
                          aria-label={`Remove ${getDisplayName(entry.employee)}`}
                        >
                          {removingId === entry.employeeId ? (
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                              />
                              <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                              />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12"
                              />
                            </svg>
                          )}
                        </button>
                      ) : coOwners.length > 0 ? (
                        <button
                          onClick={() => setShowTransfer(true)}
                          className="text-[10px] font-medium text-amber-400 hover:text-amber-300 px-2 py-1 rounded-lg hover:bg-amber-500/10 transition-colors shrink-0"
                        >
                          Transfer
                        </button>
                      ) : (
                        <div className="w-7 shrink-0" />
                      )}
                    </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── Transfer picker ─────────────────────────────────────────── */}
            {showTransfer && coOwners.length > 0 && (
              <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
                <p className="text-xs font-semibold text-amber-300 mb-2">
                  Transfer ownership to:
                </p>
                <div className="space-y-1.5">
                  {coOwners.map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => handleTransferOwnership(entry.employeeId)}
                      disabled={transferring}
                      className="w-full text-left px-3 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-white transition-colors disabled:opacity-40 flex items-center gap-2"
                    >
                      <div className="w-6 h-6 rounded-full bg-amber-500/30 border border-amber-400/40 flex items-center justify-center text-[10px] font-bold text-amber-200 shrink-0">
                        {entry.employee.firstName.charAt(0)}
                        {entry.employee.lastName.charAt(0)}
                      </div>
                      {getDisplayName(entry.employee)}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setShowTransfer(false)}
                  className="mt-2 w-full px-3 py-1.5 rounded-lg text-xs text-white/40 hover:text-white/60 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* ── Split mode toggle (only when 2+ owners) ────────────────── */}
            {hasOwners && ownership.entries.length >= 2 && (
              <div className="mb-4">
                <p className="text-xs font-medium text-white/50 uppercase tracking-wider mb-2">
                  Split Mode
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSplitMode('even')}
                    className={`flex-1 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                      splitMode === 'even'
                        ? 'bg-indigo-600/40 text-white border border-indigo-500/50'
                        : 'bg-white/5 text-white/50 hover:bg-white/10 border border-white/10'
                    }`}
                  >
                    Even Split
                  </button>
                  <button
                    onClick={() => setSplitMode('custom')}
                    className={`flex-1 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                      splitMode === 'custom'
                        ? 'bg-indigo-600/40 text-white border border-indigo-500/50'
                        : 'bg-white/5 text-white/50 hover:bg-white/10 border border-white/10'
                    }`}
                  >
                    Custom Split
                  </button>
                </div>

                {/* Total indicator for custom mode */}
                {splitMode === 'custom' && (
                  <div className="mt-2 flex items-center justify-between px-1">
                    <span className="text-xs text-white/40">Total:</span>
                    <span
                      className={`text-xs font-medium ${
                        splitsValid ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      {currentTotal.toFixed(1)}% {splitsValid ? '' : '(must be 100%)'}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* ── Save splits button (custom mode with changes) ──────────── */}
            {splitMode === 'custom' && hasOwners && hasSplitChanges && (
              <div className="mb-4">
                <button
                  onClick={handleSaveSplits}
                  disabled={savingSplits || !splitsValid}
                  className={`w-full px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    splitsValid
                      ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25'
                      : 'bg-white/5 text-white/30 cursor-not-allowed'
                  }`}
                >
                  {savingSplits ? 'Saving...' : 'Save Custom Splits'}
                </button>
              </div>
            )}

            {/* ── Add server section ─────────────────────────────────────── */}
            <div className="border-t border-white/10 pt-4">
              <p className="text-xs font-medium text-white/50 uppercase tracking-wider mb-2">
                Add Server
              </p>

              {loadingEmployees ? (
                <div className="text-sm text-white/30 py-2">Loading clocked-in employees...</div>
              ) : availableEmployees.length === 0 ? (
                <div className="text-sm text-white/30 py-2">
                  {employees.length === 0
                    ? 'No clocked-in employees found'
                    : 'All clocked-in employees are already owners'}
                </div>
              ) : (
                <div className="flex gap-2">
                  <select
                    value={selectedEmployeeId}
                    onChange={(e) => setSelectedEmployeeId(e.target.value)}
                    className="flex-1 bg-white/10 border border-white/20 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/30 appearance-none"
                    aria-label="Select employee to add"
                  >
                    <option value="" className="bg-slate-900 text-white/50">
                      Select employee...
                    </option>
                    {availableEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id} className="bg-slate-900 text-white">
                        {getDisplayName(emp)}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={handleAddOwner}
                    disabled={!selectedEmployeeId || addingOwner}
                    className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all shrink-0 ${
                      selectedEmployeeId
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/25'
                        : 'bg-white/5 text-white/30 cursor-not-allowed'
                    }`}
                  >
                    {addingOwner ? 'Adding...' : 'Add'}
                  </button>
                </div>
              )}
            </div>

            {/* ── Close button ────────────────────────────────────────────── */}
            <div className="mt-5 pt-4 border-t border-white/10">
              <button
                onClick={onClose}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/10 transition-colors"
              >
                Close
              </button>
            </div>
          </>
        )}
    </Modal>
  )
}
