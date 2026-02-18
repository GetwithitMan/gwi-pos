'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { useAuthStore } from '@/stores/auth-store'
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

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const TIME_SLOTS = [
  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00',
  '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00',
  '20:00', '21:00', '22:00', '23:00', '00:00', '01:00', '02:00'
]

export default function SchedulingPage() {
  const router = useRouter()
  const { isAuthenticated, employee } = useAuthStore()
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
    if (!isAuthenticated) {
      router.push('/login?redirect=/scheduling')
      return
    }
    if (employee?.location?.id) {
      loadSchedules()
      loadEmployees()
    }
  }, [isAuthenticated, router, employee?.location?.id, currentWeekStart])

  const loadSchedules = async () => {
    if (!employee?.location?.id) return

    setIsLoading(true)
    try {
      const response = await fetch(`/api/schedules?locationId=${employee.location.id}`)
      if (response.ok) {
        const data = await response.json()
        setSchedules(data.schedules)
        // Auto-select current week schedule
        const currentWeek = data.schedules.find((s: Schedule) => {
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
        setEmployees(data.employees.map((e: { id: string; displayName?: string; firstName: string; lastName: string; role?: { name: string }; hourlyRate?: number }) => ({
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
        // Reload schedule
        const scheduleResponse = await fetch(`/api/schedules/${selectedSchedule.id}`)
        if (scheduleResponse.ok) {
          const data = await scheduleResponse.json()
          setSelectedSchedule({ ...selectedSchedule, shifts: data.shifts })
        }
        loadSchedules()
      } else {
        const error = await response.json()
        toast.error(error.error || 'Failed to add shift')
      }
    } catch (error) {
      console.error('Failed to add shift:', error)
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

  if (!isAuthenticated) return null

  const weekDates = getWeekDates()

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
                                  className="bg-blue-100 border border-blue-200 rounded p-2 text-xs"
                                >
                                  <div className="font-medium">{shift.employee.name}</div>
                                  <div className="text-gray-600">
                                    {shift.startTime} - {shift.endTime}
                                  </div>
                                  {shift.role && (
                                    <div className="text-gray-500">{shift.role.name}</div>
                                  )}
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
    </div>
  )
}
