'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
// Badge inline — no separate component
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/stores/toast-store'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { hasPermission, PERMISSIONS, PERMISSION_GROUPS } from '@/lib/auth-utils'
import { formatDate, formatTime } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { formatCurrency } from '@/lib/utils'
import { getPermissionMeta, getKeysByTab, type PermissionTab } from '@/lib/permission-registry'

// --- Types ---

interface Role {
  id: string
  name: string
  permissions: string[]
}

interface EmployeeData {
  id: string
  firstName: string
  lastName: string
  displayName: string
  email: string | null
  phone: string | null
  role: Role
  location: { id: string; name: string }
  hourlyRate: number | null
  hireDate: string | null
  isActive: boolean
  color: string | null
  avatarUrl: string | null
  defaultScreen: string | null
  defaultOrderType: string | null
  additionalRoles: { id: string; name: string }[]
  createdAt: string
  updatedAt: string
  stats: {
    orderCount: number
    totalSales: number
    totalCommission: number
  }
  // Pay & Tax fields (from employee model)
  paymentMethod?: string | null
  bankName?: string | null
  bankRoutingNumber?: string | null
  bankAccountType?: string | null
  bankAccountLast4?: string | null
  ytdGrossWages?: number | null
  ytdTips?: number | null
  ytdTaxesWithheld?: number | null
  ytdNetPay?: number | null
  federalFilingStatus?: string | null
  federalAllowances?: number | null
  stateFilingStatus?: string | null
  stateAllowances?: number | null
  // 7shifts fields
  sevenShiftsUserId?: string | null
  sevenShiftsRoleId?: string | null
  sevenShiftsDepartmentId?: string | null
}

interface TimeClockPunch {
  id: string
  employeeId: string
  employeeName: string
  hourlyRate: number | null
  clockIn: string
  clockOut: string | null
  breakMinutes: number
  isOnBreak: boolean
  regularHours: number | null
  overtimeHours: number | null
  notes: string | null
  createdAt?: string
  updatedAt?: string
}

interface ScheduledShift {
  id: string
  date: string
  startTime: string
  endTime: string
  roleName?: string
  status: string
}

interface SevenShiftsUser {
  id: number
  first_name: string
  last_name: string
  email: string
}

interface PermissionOverride {
  id: string
  permissionKey: string
  allowed: boolean
  reason: string | null
  setBy: string | null
  createdAt: string
  updatedAt: string
}

type OverrideState = 'inherit' | 'grant' | 'deny'

// --- Color presets ---
const COLOR_PRESETS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#F97316', '#6366F1', '#14B8A6',
]

const TABS = ['Profile', 'Permissions', 'Pay & Tax', 'Time & Attendance', '7shifts'] as const

// All permission keys from PERMISSION_GROUPS
const ALL_PERMISSION_KEYS = Object.values(PERMISSION_GROUPS)
  .flatMap(g => g.permissions.map((p: { key: string }) => p.key))

const PERMISSION_TABS: { key: PermissionTab; label: string }[] = [
  { key: 'SHIFT_SERVICE', label: 'Shift & Service' },
  { key: 'TEAM_TIME', label: 'Team & Time' },
  { key: 'REPORTING', label: 'Reporting' },
  { key: 'BUSINESS_SETUP', label: 'Business Setup' },
]
type Tab = typeof TABS[number]

export default function EmployeeDetailPage() {
  const params = useParams()
  const router = useRouter()
  const employeeId = params.id as string
  const currentEmployee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/employees' })

  const [employee, setEmployee] = useState<EmployeeData | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [activeTab, setActiveTab] = useState<Tab>('Profile')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  // Profile form state
  const [profileForm, setProfileForm] = useState({
    firstName: '',
    lastName: '',
    displayName: '',
    email: '',
    phone: '',
    roleId: '',
    hireDate: '',
    color: '#3B82F6',
    isActive: true,
    defaultScreen: '',
  })

  // Time & Attendance state
  const [punches, setPunches] = useState<TimeClockPunch[]>([])
  const [punchPage, setPunchPage] = useState(0)
  const [punchTotal, setPunchTotal] = useState(0)
  const [scheduledShifts, setScheduledShifts] = useState<ScheduledShift[]>([])
  const [weeklyHours, setWeeklyHours] = useState(0)
  const [periodHours, setPeriodHours] = useState(0)
  const [scheduledCount, setScheduledCount] = useState(0)

  // Edit punch modal
  const [editingPunch, setEditingPunch] = useState<TimeClockPunch | null>(null)
  const [editPunchForm, setEditPunchForm] = useState({
    clockIn: '',
    clockOut: '',
    breakMinutes: '',
    notes: '',
    reason: '',
  })

  // 7shifts state
  const [sevenShiftsUsers, setSevenShiftsUsers] = useState<SevenShiftsUser[]>([])
  const [selectedSevenShiftsUser, setSelectedSevenShiftsUser] = useState('')
  const [sevenShiftsRoleId, setSevenShiftsRoleId] = useState('')
  const [sevenShiftsDeptId, setSevenShiftsDeptId] = useState('')
  const [isLinking, setIsLinking] = useState(false)

  // Permission overrides state
  const [overrides, setOverrides] = useState<PermissionOverride[]>([])
  const [overridesLoaded, setOverridesLoaded] = useState(false)
  const [permSearchQuery, setPermSearchQuery] = useState('')
  const [activePermTab, setActivePermTab] = useState<PermissionTab>('SHIFT_SERVICE')
  const [overrideSaving, setOverrideSaving] = useState<string | null>(null)
  const [reasonInputs, setReasonInputs] = useState<Record<string, string>>({})

  const canEditWages = currentEmployee?.permissions
    ? hasPermission(currentEmployee.permissions as string[], PERMISSIONS.STAFF_EDIT_WAGES)
    : false

  // --- Data loading ---

  const loadEmployee = useCallback(async () => {
    if (!employeeId) return
    try {
      const res = await fetch(`/api/employees/${employeeId}?requestingEmployeeId=${currentEmployee?.id}`)
      if (res.ok) {
        const raw = await res.json()
        const data = raw.data ?? raw
        setEmployee(data)
        setProfileForm({
          firstName: data.firstName,
          lastName: data.lastName,
          displayName: data.displayName || '',
          email: data.email || '',
          phone: data.phone || '',
          roleId: data.role.id,
          hireDate: data.hireDate ? data.hireDate.split('T')[0] : '',
          color: data.color || '#3B82F6',
          isActive: data.isActive,
          defaultScreen: data.defaultScreen || '',
        })
      } else {
        toast.error('Employee not found')
        router.push('/employees')
      }
    } catch {
      toast.error('Failed to load employee')
    } finally {
      setIsLoading(false)
    }
  }, [employeeId, currentEmployee?.id, router])

  const loadRoles = useCallback(async () => {
    if (!currentEmployee?.location?.id) return
    try {
      const res = await fetch(`/api/roles?locationId=${currentEmployee.location.id}`)
      if (res.ok) {
        const data = await res.json()
        setRoles(data.data.roles)
      }
    } catch { /* silent */ }
  }, [currentEmployee?.location?.id])

  const loadPunches = useCallback(async (page = 0) => {
    if (!employeeId || !currentEmployee?.location?.id) return
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    try {
      const params = new URLSearchParams({
        locationId: currentEmployee.location.id,
        employeeId,
        startDate: thirtyDaysAgo.toISOString().split('T')[0],
      })
      const res = await fetch(`/api/time-clock?${params}`)
      if (res.ok) {
        const raw = await res.json()
        const entries = raw.data?.entries || []
        setPunchTotal(entries.length)
        setPunches(entries.slice(page * 20, (page + 1) * 20))

        // Calculate weekly hours
        const weekAgo = new Date()
        weekAgo.setDate(weekAgo.getDate() - 7)
        const weekEntries = entries.filter((e: TimeClockPunch) => new Date(e.clockIn) >= weekAgo)
        const wkHrs = weekEntries.reduce((sum: number, e: TimeClockPunch) => sum + (e.regularHours || 0) + (e.overtimeHours || 0), 0)
        setWeeklyHours(Math.round(wkHrs * 100) / 100)

        // Period hours (14 days)
        const twoWeeksAgo = new Date()
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)
        const periodEntries = entries.filter((e: TimeClockPunch) => new Date(e.clockIn) >= twoWeeksAgo)
        const pHrs = periodEntries.reduce((sum: number, e: TimeClockPunch) => sum + (e.regularHours || 0) + (e.overtimeHours || 0), 0)
        setPeriodHours(Math.round(pHrs * 100) / 100)
      }
    } catch { /* silent */ }
  }, [employeeId, currentEmployee?.location?.id])

  const loadScheduledShifts = useCallback(async () => {
    if (!employeeId || !currentEmployee?.location?.id) return
    try {
      const res = await fetch(`/api/schedules?locationId=${currentEmployee.location.id}`)
      if (res.ok) {
        const raw = await res.json()
        const schedules = raw.data?.schedules || []
        // Load shifts from all schedules for this employee
        const allShifts: ScheduledShift[] = []
        const twoWeeksFromNow = new Date()
        twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14)
        for (const sched of schedules.slice(0, 3)) {
          const shiftRes = await fetch(`/api/schedules/${sched.id}/shifts?employeeId=${employeeId}`)
          if (shiftRes.ok) {
            const shiftData = await shiftRes.json()
            const shifts = shiftData.data?.shifts || []
            allShifts.push(...shifts.filter((s: ScheduledShift) => new Date(s.date) <= twoWeeksFromNow && new Date(s.date) >= new Date()))
          }
        }
        setScheduledShifts(allShifts.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()))
        setScheduledCount(allShifts.length)
      }
    } catch { /* silent */ }
  }, [employeeId, currentEmployee?.location?.id])

  useEffect(() => {
    if (currentEmployee?.location?.id && employeeId) {
      loadEmployee()
      loadRoles()
    }
  }, [currentEmployee?.location?.id, employeeId, loadEmployee, loadRoles])

  useEffect(() => {
    if (activeTab === 'Time & Attendance' && currentEmployee?.location?.id) {
      loadPunches(punchPage)
      loadScheduledShifts()
    }
  }, [activeTab, punchPage, currentEmployee?.location?.id, loadPunches, loadScheduledShifts])

  useEffect(() => {
    if (activeTab === '7shifts') {
      loadSevenShiftsUsers()
    }
  }, [activeTab])

  const loadSevenShiftsUsers = async () => {
    try {
      const res = await fetch('/api/integrations/7shifts/users')
      if (res.ok) {
        const raw = await res.json()
        setSevenShiftsUsers(raw.data?.users || [])
      }
    } catch { /* silent */ }
  }

  const loadOverrides = useCallback(async () => {
    if (!employeeId || !currentEmployee?.location?.id) return
    try {
      const res = await fetch(
        `/api/employees/${employeeId}/permission-overrides?locationId=${currentEmployee.location.id}&requestingEmployeeId=${currentEmployee.id}`
      )
      if (res.ok) {
        const raw = await res.json()
        setOverrides(raw.data || [])
      }
    } catch { /* silent */ }
    setOverridesLoaded(true)
  }, [employeeId, currentEmployee?.location?.id, currentEmployee?.id])

  useEffect(() => {
    if (activeTab === 'Permissions' && !overridesLoaded && currentEmployee?.location?.id) {
      loadOverrides()
    }
  }, [activeTab, overridesLoaded, currentEmployee?.location?.id, loadOverrides])

  const getOverrideState = (key: string): OverrideState => {
    const ov = overrides.find(o => o.permissionKey === key)
    if (!ov) return 'inherit'
    return ov.allowed ? 'grant' : 'deny'
  }

  const handleOverrideChange = async (permissionKey: string, newState: OverrideState) => {
    if (!currentEmployee?.location?.id) return
    setOverrideSaving(permissionKey)

    try {
      if (newState === 'inherit') {
        // DELETE the override
        const res = await fetch(
          `/api/employees/${employeeId}/permission-overrides?permissionKey=${permissionKey}&locationId=${currentEmployee.location.id}&requestingEmployeeId=${currentEmployee.id}`,
          { method: 'DELETE' }
        )
        if (res.ok) {
          setOverrides(prev => prev.filter(o => o.permissionKey !== permissionKey))
          setReasonInputs(prev => { const next = { ...prev }; delete next[permissionKey]; return next })
          toast.success('Override removed')
        } else {
          const err = await res.json()
          toast.error(err.error || 'Failed to remove override')
        }
      } else {
        // POST to create/update override
        const reason = reasonInputs[permissionKey]?.trim() || null
        const res = await fetch(`/api/employees/${employeeId}/permission-overrides`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            permissionKey,
            allowed: newState === 'grant',
            reason,
            locationId: currentEmployee.location.id,
            requestingEmployeeId: currentEmployee.id,
          }),
        })
        if (res.ok) {
          const raw = await res.json()
          setOverrides(prev => {
            const idx = prev.findIndex(o => o.permissionKey === permissionKey)
            if (idx >= 0) {
              const next = [...prev]
              next[idx] = raw.data
              return next
            }
            return [...prev, raw.data]
          })
          toast.success(newState === 'grant' ? 'Permission granted' : 'Permission denied')
        } else {
          const err = await res.json()
          toast.error(err.error || 'Failed to set override')
        }
      }
    } catch {
      toast.error('Failed to update override')
    } finally {
      setOverrideSaving(null)
    }
  }

  // --- Handlers ---

  const handleProfileSave = async () => {
    setIsSaving(true)
    try {
      const res = await fetch(`/api/employees/${employeeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: profileForm.firstName.trim(),
          lastName: profileForm.lastName.trim(),
          displayName: profileForm.displayName.trim() || null,
          email: profileForm.email.trim() || null,
          phone: profileForm.phone.trim() || null,
          roleId: profileForm.roleId,
          hireDate: profileForm.hireDate || null,
          color: profileForm.color,
          defaultScreen: profileForm.defaultScreen || null,
          isActive: profileForm.isActive,
          requestingEmployeeId: currentEmployee?.id,
        }),
      })
      if (res.ok) {
        toast.success('Employee updated')
        loadEmployee()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to save')
      }
    } catch {
      toast.error('Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const openEditPunch = (punch: TimeClockPunch) => {
    setEditingPunch(punch)
    setEditPunchForm({
      clockIn: punch.clockIn ? new Date(punch.clockIn).toISOString().slice(0, 16) : '',
      clockOut: punch.clockOut ? new Date(punch.clockOut).toISOString().slice(0, 16) : '',
      breakMinutes: String(punch.breakMinutes || 0),
      notes: punch.notes || '',
      reason: '',
    })
  }

  const handleEditPunchSave = async () => {
    if (!editingPunch || !editPunchForm.reason.trim()) {
      toast.error('A reason is required for editing time punches')
      return
    }
    setIsSaving(true)
    try {
      const res = await fetch('/api/time-clock', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryId: editingPunch.id,
          clockIn: editPunchForm.clockIn ? new Date(editPunchForm.clockIn).toISOString() : undefined,
          clockOut: editPunchForm.clockOut ? new Date(editPunchForm.clockOut).toISOString() : undefined,
          breakMinutes: parseInt(editPunchForm.breakMinutes) || 0,
          notes: `${editPunchForm.notes}${editPunchForm.notes ? ' | ' : ''}Reason: ${editPunchForm.reason}`,
          performedBy: currentEmployee?.id,
          locationId: currentEmployee?.location?.id,
        }),
      })
      if (res.ok) {
        toast.success('Time punch updated')
        setEditingPunch(null)
        loadPunches(punchPage)
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to update')
      }
    } catch {
      toast.error('Failed to update time punch')
    } finally {
      setIsSaving(false)
    }
  }

  const handleLink7Shifts = async () => {
    if (!selectedSevenShiftsUser) {
      toast.error('Select a 7shifts account')
      return
    }
    setIsLinking(true)
    try {
      const res = await fetch('/api/integrations/7shifts/link-employee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId,
          sevenShiftsUserId: selectedSevenShiftsUser,
          sevenShiftsRoleId: sevenShiftsRoleId || null,
          sevenShiftsDepartmentId: sevenShiftsDeptId || null,
          adminEmployeeId: currentEmployee?.id,
        }),
      })
      if (res.ok) {
        toast.success('7shifts linked')
        loadEmployee()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to link')
      }
    } catch {
      toast.error('Failed to link 7shifts')
    } finally {
      setIsLinking(false)
    }
  }

  const handleUnlink7Shifts = async () => {
    setIsLinking(true)
    try {
      const res = await fetch('/api/integrations/7shifts/link-employee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId,
          sevenShiftsUserId: null,
          sevenShiftsRoleId: null,
          sevenShiftsDepartmentId: null,
          adminEmployeeId: currentEmployee?.id,
        }),
      })
      if (res.ok) {
        toast.success('7shifts unlinked')
        loadEmployee()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to unlink')
      }
    } catch {
      toast.error('Failed to unlink 7shifts')
    } finally {
      setIsLinking(false)
    }
  }

  // --- Helpers ---

  const formatDay = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { weekday: 'short' })

  const formatHours = (hrs: number | null) => {
    if (!hrs) return '0:00'
    const h = Math.floor(hrs)
    const m = Math.round((hrs - h) * 60)
    return `${h}:${m.toString().padStart(2, '0')}`
  }

  const isEdited = (punch: TimeClockPunch) => {
    if (!punch.createdAt || !punch.updatedAt) return false
    const diff = new Date(punch.updatedAt).getTime() - new Date(punch.createdAt).getTime()
    return diff > 5 * 60 * 1000 // 5 min threshold
  }

  if (!hydrated || !currentEmployee) return null

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="text-center py-12 text-gray-900">Loading employee...</div>
      </div>
    )
  }

  if (!employee) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title={employee.displayName}
        actions={
          <Button variant="ghost" onClick={() => router.push('/employees')}>
            &larr; Employees
          </Button>
        }
      />

      {/* Employee header card */}
      <div className="mt-4 flex items-center gap-4 mb-6">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-xl"
          style={{ backgroundColor: employee.color || '#3B82F6' }}
        >
          {employee.firstName.charAt(0)}{employee.lastName.charAt(0)}
        </div>
        <div>
          <h2 className="text-xl font-semibold">{employee.firstName} {employee.lastName}</h2>
          <p className="text-sm text-blue-600">{employee.role.name}</p>
          {!employee.isActive && (
            <span className="mt-1 text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">Inactive</span>
          )}
        </div>
        <div className="ml-auto text-right text-sm text-gray-900">
          <div>{employee.stats.orderCount} orders</div>
          <div>{formatCurrency(employee.stats.totalSales)} total sales</div>
        </div>
      </div>

      {/* Tab buttons */}
      <div className="flex gap-1 mb-6 border-b">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-900 hover:text-gray-900'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* --- Profile Tab --- */}
      {activeTab === 'Profile' && (
        <div className="max-w-2xl space-y-6">
          <Card>
            <CardHeader><CardTitle>Personal Information</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>First Name *</Label>
                  <Input
                    value={profileForm.firstName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProfileForm(f => ({ ...f, firstName: e.target.value }))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Last Name *</Label>
                  <Input
                    value={profileForm.lastName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProfileForm(f => ({ ...f, lastName: e.target.value }))}
                    className="mt-1"
                  />
                </div>
              </div>
              <div>
                <Label>Display Name</Label>
                <Input
                  value={profileForm.displayName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProfileForm(f => ({ ...f, displayName: e.target.value }))}
                  placeholder="e.g., Mike S."
                  className="mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={profileForm.email}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProfileForm(f => ({ ...f, email: e.target.value }))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Phone</Label>
                  <Input
                    value={profileForm.phone}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProfileForm(f => ({ ...f, phone: e.target.value }))}
                    className="mt-1"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Employment</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Role</Label>
                <select
                  value={profileForm.roleId}
                  onChange={(e) => setProfileForm(f => ({ ...f, roleId: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                >
                  {roles.map(role => (
                    <option key={role.id} value={role.id}>{role.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Hire Date</Label>
                  <Input
                    type="date"
                    value={profileForm.hireDate}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProfileForm(f => ({ ...f, hireDate: e.target.value }))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Default Screen</Label>
                  <select
                    value={profileForm.defaultScreen}
                    onChange={(e) => setProfileForm(f => ({ ...f, defaultScreen: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                  >
                    <option value="">Auto</option>
                    <option value="orders">Orders</option>
                    <option value="bar">Bar</option>
                    <option value="kds">KDS</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={profileForm.isActive}
                    onChange={(e) => setProfileForm(f => ({ ...f, isActive: e.target.checked }))}
                    className="rounded"
                  />
                  <span className="text-sm">Active</span>
                </label>
              </div>
              <div>
                <Label>Display Color</Label>
                <div className="flex items-center gap-2 mt-1">
                  {COLOR_PRESETS.map(c => (
                    <button
                      key={c}
                      onClick={() => setProfileForm(f => ({ ...f, color: c }))}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${
                        profileForm.color === c ? 'border-gray-800 scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <input
                    type="color"
                    value={profileForm.color}
                    onChange={(e) => setProfileForm(f => ({ ...f, color: e.target.value }))}
                    className="w-8 h-8 rounded border cursor-pointer"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Button variant="primary" onClick={handleProfileSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Profile'}
          </Button>
        </div>
      )}

      {/* --- Permissions Tab --- */}
      {activeTab === 'Permissions' && employee && (() => {
        const canManageRoles = currentEmployee?.permissions
          ? hasPermission(currentEmployee.permissions as string[], PERMISSIONS.STAFF_MANAGE_ROLES)
          : false

        if (!canManageRoles) {
          return (
            <div className="max-w-3xl">
              <Card>
                <CardContent className="py-8 text-center text-gray-500 text-sm">
                  You need the Manage Roles permission to view and edit permission overrides.
                </CardContent>
              </Card>
            </div>
          )
        }

        const rolePermissions = employee.role.permissions || []
        const overrideCount = overrides.length

        // Get permissions for current tab, filtered by search
        const tabKeys = getKeysByTab(activePermTab, ALL_PERMISSION_KEYS)
        const filteredKeys = permSearchQuery.trim()
          ? tabKeys.filter(key => {
              const meta = getPermissionMeta(key)
              const q = permSearchQuery.toLowerCase()
              return (
                meta.label.toLowerCase().includes(q) ||
                meta.description.toLowerCase().includes(q) ||
                key.toLowerCase().includes(q)
              )
            })
          : tabKeys

        return (
          <div className="max-w-3xl space-y-4">
            {/* Header with override count */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Permission Overrides</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  Override individual permissions beyond what the <span className="font-medium text-blue-600">{employee.role.name}</span> role provides.
                </p>
              </div>
              {overrideCount > 0 && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                  {overrideCount} override{overrideCount !== 1 ? 's' : ''} active
                </span>
              )}
            </div>

            {/* Search input */}
            <div className="relative">
              <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <Input
                value={permSearchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPermSearchQuery(e.target.value)}
                placeholder="Search permissions..."
                className="pl-9"
              />
            </div>

            {/* Permission category tabs */}
            <div className="flex gap-1 border-b">
              {PERMISSION_TABS.map(pt => {
                const ptKeys = getKeysByTab(pt.key, ALL_PERMISSION_KEYS)
                const ptOverrides = ptKeys.filter(k => overrides.some(o => o.permissionKey === k)).length
                return (
                  <button
                    key={pt.key}
                    onClick={() => setActivePermTab(pt.key)}
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activePermTab === pt.key
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {pt.label}
                    {ptOverrides > 0 && (
                      <span className="ml-1.5 text-xs bg-blue-100 text-blue-600 rounded-full px-1.5 py-0.5">{ptOverrides}</span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Permission list */}
            <Card>
              <CardContent className="p-0">
                {filteredKeys.length === 0 ? (
                  <div className="py-8 text-center text-sm text-gray-500">
                    {permSearchQuery ? 'No permissions match your search.' : 'No permissions in this category.'}
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {filteredKeys.map(key => {
                      const meta = getPermissionMeta(key)
                      const roleHas = rolePermissions.includes(key)
                      const state = getOverrideState(key)
                      const override = overrides.find(o => o.permissionKey === key)
                      const isSavingThis = overrideSaving === key

                      return (
                        <div key={key} className="px-4 py-3">
                          <div className="flex items-start justify-between gap-4">
                            {/* Permission info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900">{meta.label}</span>
                                {roleHas && state === 'inherit' && (
                                  <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Role</span>
                                )}
                                {state === 'grant' && (
                                  <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">Granted</span>
                                )}
                                {state === 'deny' && (
                                  <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">Denied</span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{meta.description.split('.')[0]}.</p>
                              {override?.reason && (
                                <p className="text-xs text-gray-400 mt-0.5 italic">Reason: {override.reason}</p>
                              )}
                            </div>

                            {/* 3-state toggle */}
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {isSavingThis ? (
                                <span className="text-xs text-gray-400 w-[168px] text-center">Saving...</span>
                              ) : (
                                <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (state !== 'deny') handleOverrideChange(key, 'deny')
                                    }}
                                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                                      state === 'deny'
                                        ? 'bg-red-600 text-white'
                                        : 'bg-white text-gray-500 hover:bg-red-50 hover:text-red-600'
                                    }`}
                                    title="Deny this permission (blocked even if role has it)"
                                  >
                                    Deny
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (state !== 'inherit') handleOverrideChange(key, 'inherit')
                                    }}
                                    className={`px-3 py-1.5 text-xs font-medium border-x border-gray-200 transition-colors ${
                                      state === 'inherit'
                                        ? 'bg-gray-100 text-gray-900'
                                        : 'bg-white text-gray-500 hover:bg-gray-50'
                                    }`}
                                    title="Inherit from role (no override)"
                                  >
                                    Inherit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (state !== 'grant') handleOverrideChange(key, 'grant')
                                    }}
                                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                                      state === 'grant'
                                        ? 'bg-green-600 text-white'
                                        : 'bg-white text-gray-500 hover:bg-green-50 hover:text-green-600'
                                    }`}
                                    title="Grant this permission (extra beyond role)"
                                  >
                                    Grant
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Reason input — shown when override is active */}
                          {state !== 'inherit' && (
                            <div className="mt-2 flex items-center gap-2">
                              <Input
                                value={reasonInputs[key] ?? override?.reason ?? ''}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                  setReasonInputs(prev => ({ ...prev, [key]: e.target.value }))
                                }
                                placeholder="Reason (optional)"
                                className="text-xs h-7 flex-1"
                              />
                              {(reasonInputs[key] !== undefined && reasonInputs[key] !== (override?.reason ?? '')) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-xs h-7 px-2"
                                  disabled={!!overrideSaving}
                                  onClick={() => handleOverrideChange(key, state)}
                                >
                                  Save reason
                                </Button>
                              )}
                            </div>
                          )}

                          {/* Effective access indicator */}
                          <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                            <span className="text-gray-400">Effective:</span>
                            {(() => {
                              const effective = state === 'grant' || (state === 'inherit' && roleHas)
                              const denied = state === 'deny'
                              if (denied) return <span className="text-red-500 font-medium">Blocked</span>
                              if (effective) return <span className="text-green-600 font-medium">Allowed</span>
                              return <span className="text-gray-400">Not allowed</span>
                            })()}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )
      })()}

      {/* --- Pay & Tax Tab --- */}
      {activeTab === 'Pay & Tax' && (
        <div className="max-w-2xl space-y-6">
          <Card>
            <CardHeader><CardTitle>Compensation</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Hourly Rate</Label>
                {canEditWages ? (
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-2.5 text-gray-900">$</span>
                    <Input
                      type="number"
                      value={employee.hourlyRate?.toString() || ''}
                      className="pl-7"
                      step="0.01"
                      min="0"
                      disabled
                    />
                  </div>
                ) : (
                  <div className="mt-1 p-2 bg-gray-50 rounded text-sm text-gray-900">
                    {employee.hourlyRate ? formatCurrency(employee.hourlyRate) + '/hr' : 'Not set'} — Requires Manager
                  </div>
                )}
              </div>
              <div>
                <Label>Payment Method</Label>
                <div className="mt-1 p-2 bg-gray-50 rounded text-sm">
                  {employee.paymentMethod || 'Not set'}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Bank Information</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-900">Bank Name</span>
                  <p>{employee.bankName || '—'}</p>
                </div>
                <div>
                  <span className="text-gray-900">Account Type</span>
                  <p>{employee.bankAccountType || '—'}</p>
                </div>
              </div>
              {employee.bankAccountLast4 && (
                <div className="text-sm">
                  <span className="text-gray-900">Account ending in </span>
                  <span className="font-mono font-medium">{employee.bankAccountLast4}</span>
                </div>
              )}
              <p className="text-xs text-gray-900">Full account number not stored</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>YTD Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-900">Gross Wages</span>
                  <p className="font-medium">{formatCurrency(employee.ytdGrossWages || 0)}</p>
                </div>
                <div>
                  <span className="text-gray-900">Tips</span>
                  <p className="font-medium">{formatCurrency(employee.ytdTips || 0)}</p>
                </div>
                <div>
                  <span className="text-gray-900">Taxes Withheld</span>
                  <p className="font-medium">{formatCurrency(employee.ytdTaxesWithheld || 0)}</p>
                </div>
                <div>
                  <span className="text-gray-900">Net Pay</span>
                  <p className="font-medium">{formatCurrency(employee.ytdNetPay || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Tax Information</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-900">Federal Filing Status</span>
                  <p>{employee.federalFilingStatus || 'Not set'}</p>
                </div>
                <div>
                  <span className="text-gray-900">Federal Allowances</span>
                  <p>{employee.federalAllowances ?? 'Not set'}</p>
                </div>
                <div>
                  <span className="text-gray-900">State Filing Status</span>
                  <p>{employee.stateFilingStatus || 'Not set'}</p>
                </div>
                <div>
                  <span className="text-gray-900">State Allowances</span>
                  <p>{employee.stateAllowances ?? 'Not set'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Button variant="outline" onClick={() => router.push(`/employees/${employeeId}/payment`)}>
            Full pay details &rarr;
          </Button>
        </div>
      )}

      {/* --- Time & Attendance Tab --- */}
      {activeTab === 'Time & Attendance' && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            <Card className="p-4 text-center">
              <div className="text-2xl font-bold">{formatHours(weeklyHours)}</div>
              <div className="text-xs text-gray-900">Hours this week</div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-2xl font-bold">{formatHours(periodHours)}</div>
              <div className="text-xs text-gray-900">Hours this pay period</div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-2xl font-bold">{scheduledCount}</div>
              <div className="text-xs text-gray-900">Scheduled shifts (14d)</div>
            </Card>
          </div>

          {/* Punch history */}
          <Card>
            <CardHeader><CardTitle>Punch History (Last 30 Days)</CardTitle></CardHeader>
            <CardContent>
              {punches.length === 0 ? (
                <p className="text-sm text-gray-900 py-4 text-center">No punches found</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-gray-900">
                        <th className="pb-2 pr-4">Date</th>
                        <th className="pb-2 pr-4">Clock In</th>
                        <th className="pb-2 pr-4">Clock Out</th>
                        <th className="pb-2 pr-4">Break</th>
                        <th className="pb-2 pr-4">Reg Hrs</th>
                        <th className="pb-2 pr-4">OT Hrs</th>
                        <th className="pb-2 pr-4">Est Pay</th>
                        <th className="pb-2 pr-4">Edited</th>
                        <th className="pb-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {punches.map(punch => (
                        <tr key={punch.id} className="border-b last:border-0">
                          <td className="py-2 pr-4">{formatDate(punch.clockIn)}</td>
                          <td className="py-2 pr-4">{formatTime(punch.clockIn)}</td>
                          <td className="py-2 pr-4">{punch.clockOut ? formatTime(punch.clockOut) : '—'}</td>
                          <td className="py-2 pr-4">{punch.breakMinutes}m</td>
                          <td className="py-2 pr-4">{formatHours(punch.regularHours)}</td>
                          <td className="py-2 pr-4">{formatHours(punch.overtimeHours)}</td>
                          <td className="py-2 pr-4">
                            {punch.hourlyRate
                              ? formatCurrency(
                                  (punch.regularHours || 0) * punch.hourlyRate +
                                  (punch.overtimeHours || 0) * punch.hourlyRate * 1.5
                                )
                              : '—'}
                          </td>
                          <td className="py-2 pr-4">
                            {isEdited(punch) && (
                              <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                                Edited
                              </span>
                            )}
                          </td>
                          <td className="py-2">
                            {canEditWages && (
                              <Button variant="ghost" size="sm" onClick={() => openEditPunch(punch)}>
                                Edit
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {punchTotal > 20 && (
                <div className="flex justify-between items-center mt-4 pt-4 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={punchPage === 0}
                    onClick={() => setPunchPage(p => p - 1)}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-gray-900">
                    Page {punchPage + 1} of {Math.ceil(punchTotal / 20)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(punchPage + 1) * 20 >= punchTotal}
                    onClick={() => setPunchPage(p => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Upcoming scheduled shifts */}
          <Card>
            <CardHeader><CardTitle>Upcoming Scheduled Shifts (Next 14 Days)</CardTitle></CardHeader>
            <CardContent>
              {scheduledShifts.length === 0 ? (
                <p className="text-sm text-gray-900 py-4 text-center">No upcoming shifts scheduled</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-900">
                      <th className="pb-2 pr-4">Date</th>
                      <th className="pb-2 pr-4">Day</th>
                      <th className="pb-2 pr-4">Start</th>
                      <th className="pb-2 pr-4">End</th>
                      <th className="pb-2 pr-4">Role</th>
                      <th className="pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scheduledShifts.map(shift => (
                      <tr key={shift.id} className="border-b last:border-0">
                        <td className="py-2 pr-4">{formatDate(shift.date)}</td>
                        <td className="py-2 pr-4">{formatDay(shift.date)}</td>
                        <td className="py-2 pr-4">{shift.startTime}</td>
                        <td className="py-2 pr-4">{shift.endTime}</td>
                        <td className="py-2 pr-4">{shift.roleName || '—'}</td>
                        <td className="py-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            shift.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                            shift.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {shift.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* --- 7shifts Tab --- */}
      {activeTab === '7shifts' && (
        <div className="max-w-2xl space-y-6">
          <Card>
            <CardHeader><CardTitle>Link Status</CardTitle></CardHeader>
            <CardContent>
              {employee.sevenShiftsUserId ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">Linked</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-900">7shifts User ID</span>
                      <p className="font-mono">{employee.sevenShiftsUserId}</p>
                    </div>
                    <div>
                      <span className="text-gray-900">Role ID</span>
                      <p className="font-mono">{employee.sevenShiftsRoleId || '—'}</p>
                    </div>
                    <div>
                      <span className="text-gray-900">Department ID</span>
                      <p className="font-mono">{employee.sevenShiftsDepartmentId || '—'}</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleUnlink7Shifts} disabled={isLinking}>
                    {isLinking ? 'Unlinking...' : 'Unlink 7shifts'}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-medium">Not Linked</span>
                  </div>
                  <p className="text-sm text-gray-900">
                    Link this employee to a 7shifts account to sync time punches and scheduling data.
                  </p>

                  <div>
                    <Label>Select 7shifts Account</Label>
                    <select
                      value={selectedSevenShiftsUser}
                      onChange={(e) => setSelectedSevenShiftsUser(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                    >
                      <option value="">Select...</option>
                      {sevenShiftsUsers.map(u => (
                        <option key={u.id} value={String(u.id)}>
                          {u.first_name} {u.last_name} — {u.email}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Role ID (optional)</Label>
                      <Input
                        type="number"
                        value={sevenShiftsRoleId}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSevenShiftsRoleId(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label>Department ID (optional)</Label>
                      <Input
                        type="number"
                        value={sevenShiftsDeptId}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSevenShiftsDeptId(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                  </div>

                  <Button variant="primary" onClick={handleLink7Shifts} disabled={isLinking}>
                    {isLinking ? 'Linking...' : 'Link Account'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit Punch Modal */}
      <Modal
        isOpen={!!editingPunch}
        onClose={() => setEditingPunch(null)}
        title="Edit Time Punch"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <Label>Clock In</Label>
            <Input
              type="datetime-local"
              value={editPunchForm.clockIn}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditPunchForm(f => ({ ...f, clockIn: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Clock Out</Label>
            <Input
              type="datetime-local"
              value={editPunchForm.clockOut}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditPunchForm(f => ({ ...f, clockOut: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Break Minutes</Label>
            <Input
              type="number"
              value={editPunchForm.breakMinutes}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditPunchForm(f => ({ ...f, breakMinutes: e.target.value }))}
              className="mt-1"
              min="0"
            />
          </div>
          <div>
            <Label>Notes</Label>
            <Input
              value={editPunchForm.notes}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditPunchForm(f => ({ ...f, notes: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Reason for Edit *</Label>
            <Input
              value={editPunchForm.reason}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditPunchForm(f => ({ ...f, reason: e.target.value }))}
              placeholder="e.g., Forgot to clock out"
              className="mt-1"
            />
            <p className="text-xs text-gray-900 mt-1">Required — will be logged in audit trail</p>
          </div>
          <div className="flex gap-2 pt-4 border-t">
            <Button variant="ghost" className="flex-1" onClick={() => setEditingPunch(null)} disabled={isSaving}>
              Cancel
            </Button>
            <Button variant="primary" className="flex-1" onClick={handleEditPunchSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
