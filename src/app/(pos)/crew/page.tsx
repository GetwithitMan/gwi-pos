'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission, PERMISSIONS } from '@/lib/auth-utils'
import { Modal } from '@/components/ui/modal'

export default function CrewHubPage() {
  const router = useRouter()
  const employee = useAuthStore(s => s.employee)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const logout = useAuthStore(s => s.logout)
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
        // Revert on failure
        setClockStatus(previousStatus)
        useAuthStore.getState().clockIn()
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
              <div className="flex items-center gap-2 mb-4">
                {clockStatus.clockedIn ? (
                  <>
                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/20 border border-emerald-500/30 text-emerald-400">
                      Clocked In
                    </span>
                    {clockedInDuration() && (
                      <span className="text-white/40 text-xs">{clockedInDuration()}</span>
                    )}
                  </>
                ) : (
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-white/10 border border-white/10 text-white/50">
                    Not Clocked In
                  </span>
                )}
              </div>

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
            </>
          )}
        </div>

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
