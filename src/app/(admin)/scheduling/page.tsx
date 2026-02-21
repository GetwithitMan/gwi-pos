'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { toast } from '@/stores/toast-store'

interface Employee {
  id: string
  name: string
  role: string
  hourlyRate: number
}

interface ScheduledShift {
  id: string
  employee: {
    id: string
    name: string
  }
  role: { id: string; name: string } | null
  date: string
  startTime: string
  endTime: string
  breakMinutes: number
  status: string
  notes?: string
}

interface Schedule {
  id: string
  weekStart: string
  weekEnd: string
  status: 'draft' | 'published' | 'archived'
  publishedAt: string | null
  notes: string | null
  shifts: ScheduledShift[]
}

interface SwapRequestEmployee {
  id: string
  firstName: string
  lastName: string
  displayName: string | null
}

interface SwapRequest {
  id: string
  status: string
  notes: string | null
  createdAt: string
  shift: {
    id: string
    date: string
    startTime: string
    endTime: string
    status: string
  }
  requestedByEmployee: SwapRequestEmployee
  requestedToEmployee: SwapRequestEmployee | null
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const TIME_SLOTS = [
  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00',
  '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00',
  '20:00', '21:00', '22:00', '23:00', '00:00', '01:00', '02:00'
]

function employeeDisplayName(emp: SwapRequestEmployee): string {
  return emp.displayName || `${emp.firstName} ${emp.lastName}`
}

function formatShiftDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function SwapStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800',
    accepted: 'bg-blue-100 text-blue-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-gray-100 text-gray-600',
    cancelled: 'bg-gray-100 text-gray-500',
  }
  const labels: Record<string, string> = {
    pending: 'Pending',
    accepted: 'Awaiting Approval',
    approved: 'Approved',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {labels[status] ?? status}
    </span>
  )
}

// ─── ShiftSwapRequestModal ───────────────────────────────────────────────────

interface ShiftSwapRequestModalProps {
  isOpen: boolean
  shift: ScheduledShift | null
  scheduleId: string
  locationId: string
  requestedByEmployeeId: string
  employees: Employee[]
  onClose: () => void
  onSuccess: () => void
}

function ShiftSwapRequestModal({
  isOpen,
  shift,
  scheduleId,
  locationId,
  requestedByEmployeeId,
  employees,
  onClose,
  onSuccess,
}: ShiftSwapRequestModalProps) {
  const [targetEmployeeId, setTargetEmployeeId] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setTargetEmployeeId('')
      setNotes('')
    }
  }, [isOpen])

  const handleSubmit = async () => {
    if (!shift) return
    setSubmitting(true)
    try {
      const res = await fetch(
        `/api/schedules/${scheduleId}/shifts/${shift.id}/swap-requests`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationId,
            requestedByEmployeeId,
            requestedToEmployeeId: targetEmployeeId || undefined,
            notes: notes || undefined,
          }),
        }
      )
      if (res.ok) {
        toast.success('Swap request created')
        onSuccess()
        onClose()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to create swap request')
      }
    } catch {
      toast.error('Failed to create swap request')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen && !!shift}
      onClose={onClose}
      title="Request Shift Swap"
      size="md"
    >
      <div className="space-y-4">
        {shift && (
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <p className="font-medium text-gray-900">{formatShiftDate(shift.date)}</p>
            <p className="text-gray-600">{shift.startTime} – {shift.endTime}</p>
            <p className="text-gray-500 mt-0.5">Currently: {shift.employee.name}</p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Offer this shift to (optional)
          </label>
          <select
            value={targetEmployeeId}
            onChange={(e) => setTargetEmployeeId(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          >
            <option value="">Open request (any employee)</option>
            {employees
              .filter(e => shift ? e.id !== shift.employee.id : true)
              .map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.role})
                </option>
              ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border rounded-lg text-sm resize-none"
            placeholder="Any notes about this swap request..."
          />
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Creating...' : 'Create Request'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SchedulingPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/scheduling' })
  const employee = useAuthStore(s => s.employee)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showAddShiftModal, setShowAddShiftModal] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  // New shift form
  const [newShiftEmployeeId, setNewShiftEmployeeId] = useState('')
  const [newShiftStartTime, setNewShiftStartTime] = useState('09:00')
  const [newShiftEndTime, setNewShiftEndTime] = useState('17:00')

  // Edit shift state
  const [showEditShiftModal, setShowEditShiftModal] = useState(false)
  const [editingShift, setEditingShift] = useState<ScheduledShift | null>(null)
  const [editShiftEmployeeId, setEditShiftEmployeeId] = useState('')
  const [editShiftDate, setEditShiftDate] = useState('')
  const [editShiftStartTime, setEditShiftStartTime] = useState('09:00')
  const [editShiftEndTime, setEditShiftEndTime] = useState('17:00')
  const [editShiftNotes, setEditShiftNotes] = useState('')
  const [editShiftRoleId, setEditShiftRoleId] = useState('')

  // Swap request state
  const [swapRequests, setSwapRequests] = useState<SwapRequest[]>([])
  const [swapRequestsLoading, setSwapRequestsLoading] = useState(false)
  const [showSwapModal, setShowSwapModal] = useState(false)
  const [swapTargetShift, setSwapTargetShift] = useState<ScheduledShift | null>(null)

  // Current week
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const now = new Date()
    const day = now.getDay()
    const diff = now.getDate() - day // Adjust for Sunday start
    const sunday = new Date(now.setDate(diff))
    sunday.setHours(0, 0, 0, 0)
    return sunday
  })

  useEffect(() => {
    if (employee?.location?.id) {
      loadSchedules()
      loadEmployees()
    }
  }, [employee?.location?.id, currentWeekStart])

  // Load swap requests whenever selected schedule changes
  useEffect(() => {
    if (selectedSchedule && employee?.location?.id) {
      loadSwapRequests()
    } else {
      setSwapRequests([])
    }
  }, [selectedSchedule?.id, employee?.location?.id])

  const loadSchedules = async () => {
    if (!employee?.location?.id) return

    setIsLoading(true)
    try {
      const response = await fetch(`/api/schedules?locationId=${employee.location.id}`)
      if (response.ok) {
        const data = await response.json()
        setSchedules(data.data.schedules)
        // Auto-select current week schedule
        const currentWeek = data.data.schedules.find((s: Schedule) => {
          const start = new Date(s.weekStart)
          return start.toDateString() === currentWeekStart.toDateString()
        })
        if (currentWeek) {
          setSelectedSchedule(currentWeek)
        }
      }
    } catch (error) {
      console.error('Failed to load schedules:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const loadEmployees = async () => {
    if (!employee?.location?.id) return

    try {
      const response = await fetch(`/api/employees?locationId=${employee.location.id}`)
      if (response.ok) {
        const data = await response.json()
        setEmployees(data.data.employees.map((e: { id: string; displayName?: string; firstName: string; lastName: string; role?: { name: string }; hourlyRate?: number }) => ({
          id: e.id,
          name: e.displayName || `${e.firstName} ${e.lastName}`,
          role: e.role?.name || 'Staff',
          hourlyRate: e.hourlyRate || 0,
        })))
      }
    } catch (error) {
      console.error('Failed to load employees:', error)
    }
  }

  const loadSwapRequests = async () => {
    if (!employee?.location?.id) return
    setSwapRequestsLoading(true)
    try {
      const res = await fetch(
        `/api/shift-swap-requests?locationId=${employee.location.id}`
      )
      if (res.ok) {
        const data = await res.json()
        // Filter to only requests for shifts in the selected schedule
        const scheduleShiftIds = new Set(selectedSchedule?.shifts.map(s => s.id) ?? [])
        const filtered = (data.data.requests as SwapRequest[]).filter(
          r => scheduleShiftIds.has(r.shift.id)
        )
        setSwapRequests(filtered)
      }
    } catch (err) {
      console.error('Failed to load swap requests:', err)
    } finally {
      setSwapRequestsLoading(false)
    }
  }

  const refreshSelectedSchedule = async (scheduleId: string) => {
    const scheduleResponse = await fetch(`/api/schedules/${scheduleId}`)
    if (scheduleResponse.ok) {
      const data = await scheduleResponse.json()
      setSelectedSchedule(prev =>
        prev ? { ...prev, shifts: data.data.shifts } : null
      )
    }
  }

  const createSchedule = async () => {
    if (!employee?.location?.id) return

    try {
      const response = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: employee.location.id,
          weekStart: currentWeekStart.toISOString(),
        }),
      })

      if (response.ok) {
        loadSchedules()
      } else {
        const error = await response.json()
        toast.error(error.error || 'Failed to create schedule')
      }
    } catch (error) {
      console.error('Failed to create schedule:', error)
    }
  }

  const addShift = async () => {
    if (!selectedSchedule || !selectedDate || !newShiftEmployeeId) return

    try {
      const response = await fetch(`/api/schedules/${selectedSchedule.id}/shifts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: newShiftEmployeeId,
          date: selectedDate.toISOString(),
          startTime: newShiftStartTime,
          endTime: newShiftEndTime,
        }),
      })

      if (response.ok) {
        setShowAddShiftModal(false)
        setNewShiftEmployeeId('')
        await refreshSelectedSchedule(selectedSchedule.id)
        loadSchedules()
      } else {
        const error = await response.json()
        toast.error(error.error || 'Failed to add shift')
      }
    } catch (error) {
      console.error('Failed to add shift:', error)
    }
  }

  const openEditShift = (shift: ScheduledShift) => {
    setEditingShift(shift)
    setEditShiftEmployeeId(shift.employee.id)
    setEditShiftDate(shift.date.split('T')[0])
    setEditShiftStartTime(shift.startTime)
    setEditShiftEndTime(shift.endTime)
    setEditShiftNotes(shift.notes || '')
    setEditShiftRoleId(shift.role?.id || '')
    setShowEditShiftModal(true)
  }

  const saveEditShift = async () => {
    if (!editingShift || !selectedSchedule) return

    try {
      const response = await fetch(
        `/api/schedules/${selectedSchedule.id}/shifts/${editingShift.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employeeId: editShiftEmployeeId,
            date: new Date(editShiftDate).toISOString(),
            startTime: editShiftStartTime,
            endTime: editShiftEndTime,
            roleId: editShiftRoleId || null,
            notes: editShiftNotes || null,
          }),
        }
      )

      if (response.ok) {
        setShowEditShiftModal(false)
        setEditingShift(null)
        toast.success('Shift updated')
        await refreshSelectedSchedule(selectedSchedule.id)
        loadSchedules()
      } else {
        const error = await response.json()
        toast.error(error.error || 'Failed to update shift')
      }
    } catch (error) {
      console.error('Failed to update shift:', error)
      toast.error('Failed to update shift')
    }
  }

  const deleteShift = async (shift: ScheduledShift) => {
    if (!selectedSchedule) return
    if (!window.confirm(`Delete shift for ${shift.employee.name}? This cannot be undone.`)) return

    try {
      const response = await fetch(
        `/api/schedules/${selectedSchedule.id}/shifts/${shift.id}`,
        { method: 'DELETE' }
      )

      if (response.ok) {
        toast.success('Shift deleted')
        await refreshSelectedSchedule(selectedSchedule.id)
        loadSchedules()
      } else {
        const error = await response.json()
        toast.error(error.error || 'Failed to delete shift')
      }
    } catch (error) {
      console.error('Failed to delete shift:', error)
      toast.error('Failed to delete shift')
    }
  }

  const publishSchedule = async () => {
    if (!selectedSchedule) return

    try {
      const response = await fetch(`/api/schedules/${selectedSchedule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'publish',
          publishedBy: employee?.id,
        }),
      })

      if (response.ok) {
        loadSchedules()
      }
    } catch (error) {
      console.error('Failed to publish schedule:', error)
    }
  }

  // Manager approves a swap request.
  // The API /approve requires status === 'accepted', so if it's still 'pending'
  // (manager bypassing employee step) we first call /accept then /approve.
  const approveSwapRequest = async (req: SwapRequest) => {
    if (!employee?.location?.id || !employee?.id || !selectedSchedule) return
    try {
      // If pending, move to accepted first so the approve endpoint is happy
      if (req.status === 'pending') {
        const acceptRes = await fetch(
          `/api/shift-swap-requests/${req.id}/accept`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locationId: employee.location.id }),
          }
        )
        if (!acceptRes.ok) {
          const err = await acceptRes.json()
          toast.error(err.error || 'Failed to approve swap request')
          return
        }
      }

      const res = await fetch(
        `/api/shift-swap-requests/${req.id}/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationId: employee.location.id,
            approvedByEmployeeId: employee.id,
          }),
        }
      )
      if (res.ok) {
        toast.success('Swap approved — shift reassigned')
        await refreshSelectedSchedule(selectedSchedule.id)
        loadSwapRequests()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to approve swap request')
      }
    } catch {
      toast.error('Failed to approve swap request')
    }
  }

  const rejectSwapRequest = async (req: SwapRequest) => {
    if (!employee?.location?.id || !selectedSchedule) return
    try {
      const res = await fetch(
        `/api/shift-swap-requests/${req.id}/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locationId: employee.location.id }),
        }
      )
      if (res.ok) {
        toast.success('Swap request rejected')
        loadSwapRequests()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to reject swap request')
      }
    } catch {
      toast.error('Failed to reject swap request')
    }
  }

  const getWeekDates = () => {
    const dates: Date[] = []
    for (let i = 0; i < 7; i++) {
      const date = new Date(currentWeekStart)
      date.setDate(date.getDate() + i)
      dates.push(date)
    }
    return dates
  }

  const getShiftsForDate = (date: Date) => {
    if (!selectedSchedule) return []
    const dateStr = date.toISOString().split('T')[0]
    return selectedSchedule.shifts.filter(s => s.date.split('T')[0] === dateStr)
  }

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const navigateWeek = (direction: number) => {
    const newWeek = new Date(currentWeekStart)
    newWeek.setDate(newWeek.getDate() + direction * 7)
    setCurrentWeekStart(newWeek)
    setSelectedSchedule(null)
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      draft: 'bg-yellow-100 text-yellow-800',
      published: 'bg-green-100 text-green-800',
      archived: 'bg-gray-100 text-gray-800',
    }
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100'}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    )
  }

  if (!hydrated) return null

  const weekDates = getWeekDates()

  // Active swap requests = pending + accepted (not terminal states)
  const activeSwapRequests = swapRequests.filter(r =>
    r.status === 'pending' || r.status === 'accepted'
  )
  const terminalSwapRequests = swapRequests.filter(r =>
    r.status === 'approved' || r.status === 'rejected' || r.status === 'cancelled'
  )

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Employee Scheduling"
      />

      <div className="max-w-7xl mx-auto mt-6">
        {/* Week Navigation */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => navigateWeek(-1)}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Button>
            <h2 className="text-xl font-semibold">
              Week of {formatDate(currentWeekStart)}
            </h2>
            <Button variant="outline" onClick={() => navigateWeek(1)}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {selectedSchedule ? (
              <>
                {getStatusBadge(selectedSchedule.status)}
                {selectedSchedule.status === 'draft' && (
                  <Button variant="primary" onClick={publishSchedule}>
                    Publish Schedule
                  </Button>
                )}
              </>
            ) : (
              <Button variant="primary" onClick={createSchedule}>
                Create Schedule
              </Button>
            )}
          </div>
        </div>

        {/* Schedule Grid */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="text-center py-8 text-gray-500">Loading...</div>
            ) : !selectedSchedule ? (
              <div className="text-center py-12 text-gray-500">
                <p className="mb-4">No schedule for this week yet.</p>
                <Button variant="primary" onClick={createSchedule}>
                  Create Schedule
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      {weekDates.map((date, index) => (
                        <th key={index} className="px-4 py-3 text-center min-w-[150px]">
                          <div className="text-sm font-medium text-gray-900">
                            {DAYS[date.getDay()]}
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatDate(date)}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {weekDates.map((date, index) => {
                        const shifts = getShiftsForDate(date)
                        return (
                          <td key={index} className="border-r last:border-r-0 align-top p-2">
                            <div className="space-y-2 min-h-[200px]">
                              {shifts.map(shift => (
                                <div
                                  key={shift.id}
                                  className="bg-blue-100 border border-blue-200 rounded p-2 text-xs relative group"
                                >
                                  <div className="font-medium pr-10">{shift.employee.name}</div>
                                  <div className="text-gray-600">
                                    {shift.startTime} - {shift.endTime}
                                  </div>
                                  {shift.role && (
                                    <div className="text-gray-500">{shift.role.name}</div>
                                  )}
                                  {/* Action buttons — visible on hover */}
                                  <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {/* Swap button — always show on published schedules */}
                                    {selectedSchedule.status === 'published' && (
                                      <button
                                        onClick={() => {
                                          setSwapTargetShift(shift)
                                          setShowSwapModal(true)
                                        }}
                                        className="p-0.5 rounded bg-white/80 hover:bg-white text-purple-600 hover:text-purple-800 shadow-sm"
                                        title="Request shift swap"
                                        aria-label="Request shift swap"
                                      >
                                        {/* Swap arrows icon */}
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                            d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                                        </svg>
                                      </button>
                                    )}
                                    {/* Edit / Delete — only in draft */}
                                    {selectedSchedule.status === 'draft' && (
                                      <>
                                        <button
                                          onClick={() => openEditShift(shift)}
                                          className="p-0.5 rounded bg-white/80 hover:bg-white text-blue-600 hover:text-blue-800 shadow-sm"
                                          title="Edit shift"
                                          aria-label="Edit shift"
                                        >
                                          {/* Pencil icon */}
                                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                              d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H7v-3a2 2 0 01.586-1.414z" />
                                          </svg>
                                        </button>
                                        <button
                                          onClick={() => deleteShift(shift)}
                                          className="p-0.5 rounded bg-white/80 hover:bg-white text-red-500 hover:text-red-700 shadow-sm"
                                          title="Delete shift"
                                          aria-label="Delete shift"
                                        >
                                          {/* X icon */}
                                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                              d="M6 18L18 6M6 6l12 12" />
                                          </svg>
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              ))}
                              {selectedSchedule.status === 'draft' && (
                                <button
                                  className="w-full p-2 border-2 border-dashed border-gray-300 rounded text-gray-400 text-xs hover:border-blue-400 hover:text-blue-600 transition-colors"
                                  onClick={() => {
                                    setSelectedDate(date)
                                    setShowAddShiftModal(true)
                                  }}
                                >
                                  + Add Shift
                                </button>
                              )}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Summary */}
        {selectedSchedule && selectedSchedule.shifts.length > 0 && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Schedule Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-500">Total Shifts</p>
                  <p className="text-xl font-bold">{selectedSchedule.shifts.length}</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-500">Employees Scheduled</p>
                  <p className="text-xl font-bold">
                    {new Set(selectedSchedule.shifts.map(s => s.employee.id)).size}
                  </p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-500">Total Hours</p>
                  <p className="text-xl font-bold">
                    {selectedSchedule.shifts.reduce((sum, s) => {
                      const [startH, startM] = s.startTime.split(':').map(Number)
                      const [endH, endM] = s.endTime.split(':').map(Number)
                      let hours = (endH + endM / 60) - (startH + startM / 60)
                      if (hours < 0) hours += 24 // Overnight shift
                      return sum + hours - (s.breakMinutes / 60)
                    }, 0).toFixed(1)}
                  </p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-500">Status</p>
                  <div className="mt-1">{getStatusBadge(selectedSchedule.status)}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Swap Requests Panel ─────────────────────────────────────────── */}
        {selectedSchedule && (
          <Card className="mt-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>
                  Swap Requests
                  {swapRequests.length > 0 && (
                    <span className="ml-2 px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-full">
                      {swapRequests.length}
                    </span>
                  )}
                </CardTitle>
                <button
                  onClick={loadSwapRequests}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label="Refresh swap requests"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {swapRequestsLoading ? (
                <div className="text-center py-6 text-gray-400 text-sm">Loading swap requests...</div>
              ) : swapRequests.length === 0 ? (
                <div className="text-center py-6 text-gray-400 text-sm">
                  No swap requests for this schedule.
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Active requests first */}
                  {activeSwapRequests.length > 0 && (
                    <div className="space-y-2">
                      {activeSwapRequests.map(req => (
                        <SwapRequestRow
                          key={req.id}
                          req={req}
                          onApprove={() => approveSwapRequest(req)}
                          onReject={() => rejectSwapRequest(req)}
                        />
                      ))}
                    </div>
                  )}

                  {/* Terminal requests */}
                  {terminalSwapRequests.length > 0 && (
                    <>
                      {activeSwapRequests.length > 0 && (
                        <div className="border-t pt-3 mt-3">
                          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Resolved</p>
                        </div>
                      )}
                      <div className="space-y-2">
                        {terminalSwapRequests.map(req => (
                          <SwapRequestRow
                            key={req.id}
                            req={req}
                            onApprove={() => approveSwapRequest(req)}
                            onReject={() => rejectSwapRequest(req)}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add Shift Modal */}
      <Modal
        isOpen={showAddShiftModal && !!selectedDate}
        onClose={() => setShowAddShiftModal(false)}
        title={selectedDate ? `Add Shift - ${DAYS[selectedDate.getDay()]}, ${formatDate(selectedDate)}` : 'Add Shift'}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Employee
            </label>
            <select
              value={newShiftEmployeeId}
              onChange={(e) => setNewShiftEmployeeId(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="">Select employee...</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.role})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Time
              </label>
              <select
                value={newShiftStartTime}
                onChange={(e) => setNewShiftStartTime(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg"
              >
                {TIME_SLOTS.map(time => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Time
              </label>
              <select
                value={newShiftEndTime}
                onChange={(e) => setNewShiftEndTime(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg"
              >
                {TIME_SLOTS.map(time => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-4">
            <Button variant="outline" onClick={() => setShowAddShiftModal(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={addShift}
              disabled={!newShiftEmployeeId}
            >
              Add Shift
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Shift Modal */}
      <Modal
        isOpen={showEditShiftModal && !!editingShift}
        onClose={() => { setShowEditShiftModal(false); setEditingShift(null) }}
        title="Edit Shift"
        size="md"
      >
        <div className="space-y-4">
          {/* Employee */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Employee
            </label>
            <select
              value={editShiftEmployeeId}
              onChange={(e) => setEditShiftEmployeeId(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="">Select employee...</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.role})
                </option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date
            </label>
            <input
              type="date"
              value={editShiftDate}
              onChange={(e) => setEditShiftDate(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>

          {/* Start / End time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Time
              </label>
              <select
                value={editShiftStartTime}
                onChange={(e) => setEditShiftStartTime(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg"
              >
                {TIME_SLOTS.map(time => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Time
              </label>
              <select
                value={editShiftEndTime}
                onChange={(e) => setEditShiftEndTime(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg"
              >
                {TIME_SLOTS.map(time => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Role (optional)
            </label>
            <select
              value={editShiftRoleId}
              onChange={(e) => setEditShiftRoleId(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="">No specific role</option>
              {/* Roles are not separately loaded; show current role as an option */}
              {editingShift?.role && (
                <option value={editingShift.role.id}>{editingShift.role.name}</option>
              )}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes (optional)
            </label>
            <textarea
              value={editShiftNotes}
              onChange={(e) => setEditShiftNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border rounded-lg resize-none"
              placeholder="Any notes for this shift..."
            />
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <Button
              variant="outline"
              onClick={() => { setShowEditShiftModal(false); setEditingShift(null) }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={saveEditShift}
              disabled={!editShiftEmployeeId || !editShiftDate}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </Modal>

      {/* Shift Swap Request Modal */}
      {selectedSchedule && employee && (
        <ShiftSwapRequestModal
          isOpen={showSwapModal}
          shift={swapTargetShift}
          scheduleId={selectedSchedule.id}
          locationId={employee.location?.id ?? ''}
          requestedByEmployeeId={employee.id}
          employees={employees}
          onClose={() => { setShowSwapModal(false); setSwapTargetShift(null) }}
          onSuccess={loadSwapRequests}
        />
      )}
    </div>
  )
}

// ── SwapRequestRow sub-component ──────────────────────────────────────────────

function SwapRequestRow({
  req,
  onApprove,
  onReject,
}: {
  req: SwapRequest
  onApprove: () => void
  onReject: () => void
}) {
  const isActionable = req.status === 'pending' || req.status === 'accepted'
  const isTerminal = req.status === 'approved' || req.status === 'rejected' || req.status === 'cancelled'

  return (
    <div className={`flex items-center justify-between gap-4 p-3 rounded-lg border ${isTerminal ? 'bg-gray-50 border-gray-100' : 'bg-white border-gray-200'}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-900">
            {formatShiftDate(req.shift.date)}
          </span>
          <span className="text-xs text-gray-500">
            {req.shift.startTime} – {req.shift.endTime}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 text-sm text-gray-600">
          <span>{employeeDisplayName(req.requestedByEmployee)}</span>
          <span className="text-gray-400">→</span>
          <span>{req.requestedToEmployee ? employeeDisplayName(req.requestedToEmployee) : 'Open'}</span>
        </div>
        {req.notes && (
          <p className="text-xs text-gray-400 mt-0.5 truncate">{req.notes}</p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <SwapStatusBadge status={req.status} />
        {isActionable && (
          <div className="flex gap-1.5">
            <button
              onClick={onApprove}
              className="px-2.5 py-1 text-xs font-medium rounded bg-green-600 text-white hover:bg-green-700 transition-colors"
            >
              Approve
            </button>
            <button
              onClick={onReject}
              className="px-2.5 py-1 text-xs font-medium rounded bg-white text-red-600 border border-red-200 hover:bg-red-50 transition-colors"
            >
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
