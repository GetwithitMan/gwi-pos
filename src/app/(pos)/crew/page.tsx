'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { useOrderStore } from '@/stores/order-store'
import { hasPermission, PERMISSIONS } from '@/lib/auth-utils'
import { formatCurrency } from '@/lib/utils'
import { Modal } from '@/components/ui/modal'
import { ShiftCloseoutModal } from '@/components/shifts/ShiftCloseoutModal'
import { toast } from '@/stores/toast-store'

const DENOMINATIONS = [
  { label: '$100', value: 100 },
  { label: '$50', value: 50 },
  { label: '$20', value: 20 },
  { label: '$10', value: 10 },
  { label: '$5', value: 5 },
  { label: '$1', value: 1 },
  { label: '25\u00a2', value: 0.25 },
  { label: '10\u00a2', value: 0.10 },
  { label: '5\u00a2', value: 0.05 },
  { label: '1\u00a2', value: 0.01 },
]

function DrawerCountModal({
  isOpen,
  onClose,
  shiftId,
  startingCash,
  employeeId,
  locationId,
}: {
  isOpen: boolean
  onClose: () => void
  shiftId: string
  startingCash: number
  employeeId: string
  locationId: string
}) {
  const [counts, setCounts] = useState<Record<number, number>>({})
  const [useManual, setUseManual] = useState(false)
  const [manualTotal, setManualTotal] = useState('')
  const [expectedCash, setExpectedCash] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const countedTotal = Object.entries(counts).reduce(
    (sum, [denom, count]) => sum + parseFloat(denom) * count,
    0
  )
  const actualCash = useManual ? parseFloat(manualTotal) || 0 : countedTotal
  const variance = expectedCash !== null ? actualCash - expectedCash : null

  useEffect(() => {
    if (!isOpen) return
    setCounts({})
    setManualTotal('')
    setUseManual(false)
    setExpectedCash(null)
    setSaved(false)
    setLoading(true)
    fetch(`/api/shifts/${shiftId}`)
      .then(res => res.ok ? res.json() : null)
      .then(json => {
        if (!json) return
        const data = json.data ?? json
        const summary = data.summary
        if (summary) {
          const expected = startingCash
            + (summary.netCashReceived || 0)
            + (summary.paidIn || 0)
            - (summary.paidOut || 0)
          setExpectedCash(Math.round(expected * 100) / 100)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [isOpen, shiftId, startingCash])

  const handleCountChange = (denom: number, value: string) => {
    const count = parseInt(value) || 0
    setCounts(prev => ({ ...prev, [denom]: count }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const note = `[PREVIEW COUNT] ${new Date().toLocaleString()} - Counted: ${formatCurrency(actualCash)}${expectedCash !== null ? `, Expected: ${formatCurrency(expectedCash)}, Variance: ${variance !== null && variance >= 0 ? '+' : ''}${variance !== null ? formatCurrency(variance) : 'N/A'}` : ''}`
      const res = await fetch(`/api/shifts/${shiftId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', notes: note, employeeId }),
      })
      if (res.ok) {
        setSaved(true)
        toast.success('Drawer count saved')
      } else {
        toast.error('Failed to save count')
      }
    } catch {
      toast.error('Failed to save count')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Count Drawer" size="md">
      <div className="space-y-4">
        <div className="bg-gray-50 rounded-lg p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Starting Cash</span>
            <span className="font-medium">{formatCurrency(startingCash)}</span>
          </div>
          {expectedCash !== null && (
            <div className="flex justify-between mt-1">
              <span className="text-gray-500">Expected Cash</span>
              <span className="font-medium">{formatCurrency(expectedCash)}</span>
            </div>
          )}
          {loading && (
            <p className="text-xs text-gray-400 mt-1">Loading shift data...</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={useManual}
              onChange={e => setUseManual(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-gray-600">Enter total manually</span>
          </label>
        </div>

        {useManual ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cash Total</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={manualTotal}
                onChange={e => setManualTotal(e.target.value)}
                className="w-full pl-8 pr-4 py-3 border rounded-lg text-lg font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {DENOMINATIONS.map(d => (
              <div key={d.value} className="flex items-center gap-2">
                <span className="text-sm text-gray-600 w-12 text-right">{d.label}</span>
                <input
                  type="number"
                  min="0"
                  value={counts[d.value] || ''}
                  onChange={e => handleCountChange(d.value, e.target.value)}
                  className="flex-1 px-2 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0"
                />
                <span className="text-xs text-gray-400 w-16 text-right">
                  {counts[d.value] ? formatCurrency(d.value * counts[d.value]) : ''}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="border-t pt-3 space-y-2">
          <div className="flex justify-between text-lg font-bold">
            <span>Counted Total</span>
            <span>{formatCurrency(actualCash)}</span>
          </div>
          {variance !== null && actualCash > 0 && (
            <div className={`flex justify-between text-sm font-semibold ${
              variance === 0 ? 'text-green-600' : variance > 0 ? 'text-blue-600' : 'text-red-600'
            }`}>
              <span>Variance</span>
              <span>
                {variance === 0 ? 'Balanced' : variance > 0 ? `+${formatCurrency(variance)} OVER` : `${formatCurrency(Math.abs(variance))} SHORT`}
              </span>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400">
          This is a preview count only. Your shift will be closed with the final count in the Shift Closeout.
        </p>

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-semibold text-sm transition-all"
          >
            Close
          </button>
          <button
            onClick={handleSave}
            disabled={saving || saved || actualCash === 0}
            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : saved ? 'Saved' : 'Save Count'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default function CrewHubPage() {
  const router = useRouter()
  const employee = useAuthStore(s => s.employee)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const logout = useAuthStore(s => s.logout)
  const clearOrder = useOrderStore(s => s.clearOrder)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [clockStatus, setClockStatus] = useState<{
    clockedIn: boolean
    entryId: string | null
    clockInTime: string | null
  }>({ clockedIn: false, entryId: null, clockInTime: null })
  const [clockLoading, setClockLoading] = useState(false)
  const [clockStatusLoading, setClockStatusLoading] = useState(true)
  const [showClockOutConfirm, setShowClockOutConfirm] = useState(false)
  const [showRolePicker, setShowRolePicker] = useState(false)
  const [showGroupPicker, setShowGroupPicker] = useState(false)
  const [eligibleTemplates, setEligibleTemplates] = useState<{ id: string; name: string; defaultSplitMode: string }[]>([])
  const [allowStandaloneServers, setAllowStandaloneServers] = useState(true)
  const [pendingClockInRoleId, setPendingClockInRoleId] = useState<string | undefined>(undefined)
  const [lastMemberGroupId, setLastMemberGroupId] = useState<string | null>(null)
  const [overtimeWarningMinutes, setOvertimeWarningMinutes] = useState(30)
  const [tableSummary, setTableSummary] = useState<{ occupied: number; total: number; openOrders: number } | null>(null)
  const [showShiftCloseout, setShowShiftCloseout] = useState(false)
  const [activeShift, setActiveShift] = useState<{ id: string; startedAt: string; startingCash: number; drawerId: string | null } | null>(null)
  const [showDrawerCount, setShowDrawerCount] = useState(false)

  // Hydration guard: Zustand persist middleware starts with defaults (isAuthenticated=false)
  // before rehydrating from localStorage. Without this guard, the auth redirect fires
  // immediately on mount before the real auth state loads.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])

  // Auth guard (only after hydration)
  useEffect(() => {
    if (hydrated && (!employee || !isAuthenticated)) {
      router.push('/login')
    }
  }, [hydrated, employee, isAuthenticated, router])

  // Live clock
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  // Fetch clock-in status
  const fetchClockStatus = useCallback(async () => {
    if (!employee) return
    try {
      const res = await fetch(`/api/time-clock/status?employeeId=${employee.id}`)
      if (res.ok) {
        const data = await res.json()
        setClockStatus(data)
      }
    } catch {
      // Silently fail - status will show as not clocked in
    } finally {
      setClockStatusLoading(false)
    }
  }, [employee])

  useEffect(() => {
    fetchClockStatus()
  }, [fetchClockStatus])

  // Fetch overtimeWarningMinutes from location settings
  useEffect(() => {
    if (!employee?.location?.id) return
    fetch('/api/settings')
      .then(res => res.ok ? res.json() : null)
      .then(json => {
        if (!json) return
        const data = json.data ?? json
        const s = data.settings || data
        const mins = s.alerts?.overtimeWarningMinutes
        if (typeof mins === 'number' && mins > 0) setOvertimeWarningMinutes(mins)
      })
      .catch(console.error)
  }, [employee?.location?.id])

  useEffect(() => {
    if (!employee?.location?.id || !hasPermission(employee.permissions || [], PERMISSIONS.POS_ACCESS)) return
    const locId = employee.location.id
    fetch('/api/orders/open?summary=true')
      .then(res => res.ok ? res.json() : null)
      .then(json => {
        if (!json?.data) return
        const orders = json.data.orders || []
        const openOrders = json.data.count ?? orders.length
        const tableIds = new Set(orders.filter((o: { tableId?: string }) => o.tableId).map((o: { tableId: string }) => o.tableId))
        fetch(`/api/floor-plan?locationId=${locId}&include=tables`)
          .then(r => r.ok ? r.json() : null)
          .then(fp => {
            const tables = fp?.data?.tables || []
            setTableSummary({ occupied: tableIds.size, total: tables.length, openOrders })
          })
          .catch(() => setTableSummary({ occupied: tableIds.size, total: 0, openOrders }))
      })
      .catch(console.error)
  }, [employee])

  const fetchActiveShift = useCallback(async () => {
    if (!employee) return
    try {
      const res = await fetch(`/api/shifts?locationId=${employee.location.id}&employeeId=${employee.id}&status=open`)
      if (res.ok) {
        const json = await res.json()
        const shifts = json.data?.shifts || json.data || []
        if (shifts.length > 0) {
          const s = shifts[0]
          setActiveShift({ id: s.id, startedAt: s.startedAt, startingCash: Number(s.startingCash || 0), drawerId: s.drawerId || null })
        } else {
          setActiveShift(null)
        }
      }
    } catch {
      // Silently fail
    }
  }, [employee])

  useEffect(() => {
    if (clockStatus.clockedIn) {
      void fetchActiveShift()
    } else {
      setActiveShift(null)
    }
  }, [clockStatus.clockedIn, fetchActiveShift])

  const performClockIn = async (workingRoleId?: string, selectedTipGroupTemplateId?: string | null) => {
    if (!employee) return
    // Optimistic: flip UI to clocked-in immediately
    setClockStatus({ clockedIn: true, entryId: null, clockInTime: new Date().toISOString() })
    useAuthStore.getState().clockIn()
    setClockLoading(true)
    try {
      const res = await fetch('/api/time-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: employee.location.id,
          employeeId: employee.id,
          ...(workingRoleId ? { workingRoleId } : {}),
          ...(selectedTipGroupTemplateId !== undefined ? { selectedTipGroupTemplateId } : {}),
        }),
      })
      if (res.ok) {
        // Background sync to get the real entryId
        void fetchClockStatus()
      } else {
        // Revert optimistic update on failure
        setClockStatus({ clockedIn: false, entryId: null, clockInTime: null })
        useAuthStore.getState().clockOut()
      }
    } catch {
      // Revert optimistic update on failure
      setClockStatus({ clockedIn: false, entryId: null, clockInTime: null })
      useAuthStore.getState().clockOut()
    } finally {
      setClockLoading(false)
    }
  }

  const fetchEligibleTemplates = async (roleId?: string): Promise<boolean> => {
    if (!employee) return false
    try {
      const url = `/api/tips/group-templates/eligible?locationId=${employee.location.id}&employeeId=${employee.id}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        const tmpls = data.data?.templates || []
        const standalone = data.data?.allowStandaloneServers ?? true
        if (tmpls.length > 0) {
          setEligibleTemplates(tmpls)
          setAllowStandaloneServers(standalone)
          setPendingClockInRoleId(roleId)
          setShowGroupPicker(true)
          return true // will handle clock-in after group selection
        }
      }
    } catch {
      // If fetch fails, proceed without group selection
    }
    return false
  }

  const handleGroupSelected = async (templateId: string | null) => {
    setShowGroupPicker(false)
    await performClockIn(pendingClockInRoleId, templateId)
    setPendingClockInRoleId(undefined)
  }

  const handleClockToggle = async () => {
    if (!employee) return
    if (clockStatus.clockedIn && clockStatus.entryId) {
      setShowClockOutConfirm(true)
      return
    }
    // Clock in — check if multi-role
    const availableRoles = employee.availableRoles || []
    if (availableRoles.length > 1) {
      setShowRolePicker(true)
      return
    }
    // Single role — auto-select, then check for group templates
    const roleId = availableRoles.length === 1 ? availableRoles[0].id : undefined
    if (availableRoles.length === 1) {
      useAuthStore.getState().setWorkingRole(availableRoles[0])
    }
    const needsGroupPick = await fetchEligibleTemplates(roleId)
    if (!needsGroupPick) {
      await performClockIn(roleId)
    }
  }

  const handleRoleSelectedForClockIn = async (role: { id: string; name: string; cashHandlingMode: string; isPrimary: boolean }) => {
    useAuthStore.getState().setWorkingRole(role)
    setShowRolePicker(false)
    const needsGroupPick = await fetchEligibleTemplates(role.id)
    if (!needsGroupPick) {
      await performClockIn(role.id)
    }
  }

  const handleConfirmClockOut = async () => {
    if (!employee) return
    setShowClockOutConfirm(false)
    // Optimistic: flip UI to clocked-out immediately
    const previousStatus = { ...clockStatus }
    setClockStatus({ clockedIn: false, entryId: null, clockInTime: null })
    useAuthStore.getState().clockOut()
    setClockLoading(true)
    try {
      const res = await fetch('/api/time-clock', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId: previousStatus.entryId, action: 'clockOut' }),
      })
      if (!res.ok) {
        // Revert the optimistic update
        setClockStatus(previousStatus)
        useAuthStore.getState().clockIn()

        // If the API blocked clock-out because this employee is the last group member,
        // show the last-member modal instead of a generic error.
        try {
          const data = await res.json()
          if (data?.errorCode === 'last_group_member' && data?.groupId) {
            setLastMemberGroupId(data.groupId)
            return
          }
        } catch {
          // If parsing fails, fall through — no toast needed (optimistic revert is sufficient)
        }
      }
    } catch {
      // Revert on failure
      setClockStatus(previousStatus)
      useAuthStore.getState().clockIn()
    } finally {
      setClockLoading(false)
    }
  }

  const handleLogout = () => {
    clearOrder()
    logout()
    router.push('/login')
  }

  if (!hydrated || !employee || !isAuthenticated) return null

  const permissions = employee.permissions || []

  const formatTime = (date: Date) =>
    date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })

  const formatDate = (date: Date) =>
    date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  const clockedInDuration = () => {
    if (!clockStatus.clockInTime) return null
    const diff = currentTime.getTime() - new Date(clockStatus.clockInTime).getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    return `${hours}h ${minutes}m`
  }

  /** Returns 'overtime' | 'warning' | null for the currently clocked-in employee */
  const getOvertimeStatus = (): 'overtime' | 'warning' | null => {
    if (!clockStatus.clockedIn || !clockStatus.clockInTime) return null
    const workedMs = currentTime.getTime() - new Date(clockStatus.clockInTime).getTime()
    const workedMinutes = workedMs / 60_000
    const thresholdMinutes = 8 * 60
    if (workedMinutes >= thresholdMinutes) return 'overtime'
    if (workedMinutes >= thresholdMinutes - overtimeWarningMinutes) return 'warning'
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="max-w-4xl mx-auto mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{employee.displayName}</h1>
            <div className="flex items-center gap-3 mt-1">
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">
                {useAuthStore.getState().workingRole?.name || employee.role.name}
              </span>
              <span className="text-white/40 text-sm">{employee.location.name}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-white text-lg font-mono">{formatTime(currentTime)}</div>
            <div className="text-white/40 text-xs">{formatDate(currentTime)}</div>
            <button
              onClick={handleLogout}
              className="mt-2 px-4 py-1.5 bg-white/10 hover:bg-red-500/30 text-white/70 hover:text-red-300 rounded-lg text-xs font-medium transition-all"
            >
              Log Out
            </button>
          </div>
        </div>
      </div>

      {/* Table Status Summary */}
      {tableSummary && hasPermission(permissions, PERMISSIONS.POS_ACCESS) && (
        <div className="max-w-4xl mx-auto mb-4">
          <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl px-6 py-4 flex items-center gap-4">
            <div className="p-2 rounded-xl bg-cyan-500/20">
              <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-white font-medium">Tables: {tableSummary.occupied}/{tableSummary.total} occupied</span>
              <span className="text-white/30">·</span>
              <span className="text-white/60">{tableSummary.openOrders} open orders</span>
            </div>
          </div>
        </div>
      )}

      {/* Cards Grid */}
      <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Time Clock Card - Always visible */}
        <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-xl bg-blue-500/20">
              <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-white font-semibold text-lg">Time Clock</h2>
          </div>

          {clockStatusLoading ? (
            <div className="text-white/40 text-sm">Loading status...</div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                {clockStatus.clockedIn ? (
                  <>
                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/20 border border-emerald-500/30 text-emerald-400">
                      Clocked In
                    </span>
                    {clockedInDuration() && (
                      <span className="text-white/40 text-xs">{clockedInDuration()}</span>
                    )}
                    {getOvertimeStatus() === 'overtime' && (
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-red-500/20 border border-red-500/30 text-red-400">
                        Overtime
                      </span>
                    )}
                    {getOvertimeStatus() === 'warning' && (
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-500/20 border border-amber-500/30 text-amber-400">
                        Near Overtime
                      </span>
                    )}
                  </>
                ) : (
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-white/10 border border-white/10 text-white/50">
                    Not Clocked In
                  </span>
                )}
              </div>

              <div className={clockStatus.clockedIn && activeShift ? 'grid grid-cols-2 gap-3' : ''}>
                <button
                  onClick={handleClockToggle}
                  disabled={clockLoading}
                  className={`w-full py-3 rounded-xl font-semibold text-sm transition-all ${
                    clockLoading
                      ? 'bg-white/5 text-white/30 cursor-not-allowed'
                      : clockStatus.clockedIn
                      ? 'bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400'
                      : 'bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-400'
                  }`}
                >
                  {clockLoading ? 'Processing...' : clockStatus.clockedIn ? 'Clock Out' : 'Clock In'}
                </button>
                {clockStatus.clockedIn && activeShift && (
                  <button
                    onClick={() => setShowShiftCloseout(true)}
                    className="w-full py-3 rounded-xl font-semibold text-sm transition-all bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-400"
                  >
                    Close Shift
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Count Drawer - Visible when shift is active with a drawer */}
        {clockStatus.clockedIn && activeShift && activeShift.drawerId && (
          <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-xl bg-cyan-500/20">
                <svg className="w-6 h-6 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h2 className="text-white font-semibold text-lg">Count Drawer</h2>
            </div>
            <p className="text-white/40 text-sm mb-4">Preview your drawer count before closing your shift.</p>
            <button
              onClick={() => setShowDrawerCount(true)}
              className="w-full py-3 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/30 text-cyan-400 rounded-xl font-semibold text-sm transition-all"
            >
              Count Drawer
            </button>
          </div>
        )}

        {/* Tip Adjustments - Visible with tips.view_own */}
        {hasPermission(permissions, PERMISSIONS.TIPS_VIEW_OWN) && (
          <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-xl bg-green-500/20">
                <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-white font-semibold text-lg">Tip Bank</h2>
            </div>
            <p className="text-white/40 text-sm mb-4">View your tip bank balance and ledger.</p>
            <button
              onClick={() => router.push('/crew/tip-bank')}
              className="w-full py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-semibold text-sm transition-all"
            >
              View Tip Bank
            </button>
          </div>
        )}

        {/* Tip Group */}
        <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-xl bg-indigo-500/20">
              <svg className="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h2 className="text-white font-semibold text-lg">Tip Group</h2>
          </div>
          <p className="text-white/40 text-sm mb-4">Start or join a tip group to pool tips with coworkers.</p>
          <button
            onClick={() => router.push('/crew/tip-group')}
            className="w-full py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-semibold text-sm transition-all"
          >
            Manage Tip Groups
          </button>
        </div>

        {/* My Shift Report - Always visible */}
        <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-xl bg-purple-500/20">
              <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h2 className="text-white font-semibold text-lg">My Shift Report</h2>
          </div>
          <p className="text-white/40 text-sm mb-4">View your current shift details and sales.</p>
          <button
            onClick={() => router.push('/crew/shift')}
            className="w-full py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-semibold text-sm transition-all"
          >
            View Report
          </button>
        </div>

        {/* Commission Report - Visible with reports.commission */}
        {hasPermission(permissions, PERMISSIONS.REPORTS_COMMISSION) && (
          <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-xl bg-amber-500/20">
                <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h2 className="text-white font-semibold text-lg">Commission Report</h2>
            </div>
            <p className="text-white/40 text-sm mb-4">View your commission earnings.</p>
            <button
              onClick={() => router.push('/crew/commission')}
              className="w-full py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-semibold text-sm transition-all"
            >
              View Commissions
            </button>
          </div>
        )}

        {/* Go to POS - Visible only with pos.access */}
        {hasPermission(permissions, PERMISSIONS.POS_ACCESS) && (
          <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-xl bg-indigo-500/20">
                <svg className="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </div>
              <h2 className="text-white font-semibold text-lg">Go to POS</h2>
            </div>
            <p className="text-white/40 text-sm mb-4">Open the point of sale terminal.</p>
            <button
              onClick={() => router.push('/orders')}
              className="w-full py-3 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-indigo-400 rounded-xl font-semibold text-sm transition-all"
            >
              Open POS
            </button>
          </div>
        )}
      </div>

      {/* Role Picker Dialog */}
      <Modal isOpen={showRolePicker && !!employee.availableRoles} onClose={() => setShowRolePicker(false)} title="Working As" size="sm">
        <div className="text-center">
          <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <p className="text-gray-500 text-sm mb-6">Which role are you working today?</p>
          <div className="flex flex-col gap-3">
            {employee.availableRoles?.map((role) => (
              <button
                key={role.id}
                onClick={() => handleRoleSelectedForClockIn(role)}
                disabled={clockLoading}
                className={`w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50 ${
                  role.isPrimary
                    ? 'bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 text-blue-600'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
              >
                {role.name}
                {role.isPrimary && (
                  <span className="ml-2 text-xs opacity-60">(Primary)</span>
                )}
              </button>
            ))}
            <button
              onClick={() => setShowRolePicker(false)}
              className="py-2 text-gray-400 hover:text-gray-600 text-sm transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* Clock-Out Confirmation Dialog */}
      <Modal isOpen={showClockOutConfirm} onClose={() => setShowClockOutConfirm(false)} title="Clock Out?" size="sm">
        <div className="text-center">
          <div className="w-16 h-16 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-gray-500 text-sm mb-6">Are you sure you want to clock out?</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setShowClockOutConfirm(false)}
              className="py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-semibold text-sm transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmClockOut}
              disabled={clockLoading}
              className="py-3 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-500 rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
            >
              {clockLoading ? 'Processing...' : 'Yes, Clock Out'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Last Member Group Closeout Modal ────────────────────────────────── */}
      <Modal
        isOpen={!!lastMemberGroupId}
        onClose={() => setLastMemberGroupId(null)}
        title="Close Tip Group First"
        size="sm"
      >
        <div className="text-center">
          <div className="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
          </div>
          <p className="text-gray-700 font-semibold text-base mb-2">
            You&apos;re the last person in your tip group.
          </p>
          <p className="text-gray-500 text-sm mb-6">
            Close the group before clocking out so tips are distributed correctly.
          </p>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => {
                setLastMemberGroupId(null)
                router.push('/crew/tip-group')
              }}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition-all"
            >
              Go to Tip Group
            </button>
            <button
              type="button"
              onClick={() => setLastMemberGroupId(null)}
              className="py-2 text-gray-400 hover:text-gray-600 text-sm transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* Shift Closeout Modal */}
      {activeShift && employee && (
        <ShiftCloseoutModal
          isOpen={showShiftCloseout}
          onClose={() => setShowShiftCloseout(false)}
          shift={{
            id: activeShift.id,
            startedAt: activeShift.startedAt,
            startingCash: activeShift.startingCash,
            employee: { id: employee.id, name: employee.displayName },
            locationId: employee.location.id,
          }}
          onCloseoutComplete={(_result) => {
            setShowShiftCloseout(false)
            setActiveShift(null)
            void fetchClockStatus()
          }}
          permissions={permissions}
          cashHandlingMode={useAuthStore.getState().workingRole?.cashHandlingMode}
        />
      )}

      {/* Drawer Count Modal */}
      {activeShift && activeShift.drawerId && (
        <DrawerCountModal
          isOpen={showDrawerCount}
          onClose={() => setShowDrawerCount(false)}
          shiftId={activeShift.id}
          startingCash={activeShift.startingCash}
          employeeId={employee?.id || ''}
          locationId={employee?.location?.id || ''}
        />
      )}

      {/* Tip Group Selection Dialog */}
      <Modal isOpen={showGroupPicker} onClose={() => setShowGroupPicker(false)} title="Choose Your Tip Team" size="sm">
        <div className="text-center">
          <div className="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <p className="text-gray-500 text-sm mb-6">Select which team to pool tips with for this shift</p>
          <div className="flex flex-col gap-3">
            {eligibleTemplates.map(t => (
              <button
                key={t.id}
                onClick={() => handleGroupSelected(t.id)}
                disabled={clockLoading}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
              >
                {t.name}
                <span className="block text-xs font-normal text-indigo-200 mt-0.5">
                  {t.defaultSplitMode === 'equal' ? 'Equal split' : t.defaultSplitMode === 'hours_weighted' ? 'Hours weighted' : 'Role weighted'}
                </span>
              </button>
            ))}
            {allowStandaloneServers && (
              <button
                onClick={() => handleGroupSelected(null)}
                disabled={clockLoading}
                className="w-full py-3 bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-600 rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
              >
                No Group (Keep My Own Tips)
              </button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
