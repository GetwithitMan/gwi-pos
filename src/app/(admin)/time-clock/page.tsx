'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/stores/toast-store'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { hasPermission, PERMISSIONS } from '@/lib/auth-utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { formatCurrency } from '@/lib/utils'

interface TimeClockEntry {
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
}

interface BreakRecord {
  id: string
  breakType: string
  startedAt: string
  endedAt: string | null
  duration: number | null
  status: string
}

interface Employee {
  id: string
  firstName: string
  lastName: string
  displayName: string
}

type StatusFilter = 'all' | 'active' | 'break' | 'completed'

const OVERTIME_THRESHOLD_HOURS = 8 // Standard overtime threshold

export default function TimeClockPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/time-clock' })
  const employee = useAuthStore(s => s.employee)
  const permissions = employee?.permissions || []

  const canView = hasPermission(permissions, PERMISSIONS.STAFF_VIEW)
  const canEdit = hasPermission(permissions, PERMISSIONS.STAFF_EDIT_WAGES)

  const [entries, setEntries] = useState<TimeClockEntry[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [overtimeWarningMinutes, setOvertimeWarningMinutes] = useState(30)
  const [now, setNow] = useState(() => new Date())

  // Filters
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0])
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const [filterEmployeeId, setFilterEmployeeId] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // Edit modal
  const [editEntry, setEditEntry] = useState<TimeClockEntry | null>(null)
  const [editForm, setEditForm] = useState({
    clockIn: '',
    clockOut: '',
    breakMinutes: 0,
    notes: '',
    reason: '',
  })
  const [isSaving, setIsSaving] = useState(false)

  // Expanded rows for breaks
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [breaksByEntry, setBreaksByEntry] = useState<Record<string, BreakRecord[]>>({})

  // Live clock for overtime badge (updates every 30s)
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(interval)
  }, [])

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
      .catch(err => console.warn('Operation failed:', err))
  }, [employee?.location?.id])

  /**
   * Returns 'overtime' | 'warning' | null for an active (not clocked-out) entry.
   * - 'overtime'  — worked >= 8 hours
   * - 'warning'   — within overtimeWarningMinutes of 8 hours
   */
  function getOvertimeStatus(entry: TimeClockEntry): 'overtime' | 'warning' | null {
    if (entry.clockOut) return null // completed — use recorded overtimeHours instead
    const clockInMs = new Date(entry.clockIn).getTime()
    const workedMs = now.getTime() - clockInMs
    const workedMinutes = workedMs / 60_000
    const thresholdMinutes = OVERTIME_THRESHOLD_HOURS * 60
    if (workedMinutes >= thresholdMinutes) return 'overtime'
    if (workedMinutes >= thresholdMinutes - overtimeWarningMinutes) return 'warning'
    return null
  }

  const loadEntries = useCallback(async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        startDate,
        endDate,
      })
      if (filterEmployeeId) params.set('employeeId', filterEmployeeId)

      const res = await fetch(`/api/time-clock?${params}`)
      if (res.ok) {
        const json = await res.json()
        setEntries(json.data.entries)
      }
    } catch (err) {
      console.error('Failed to load time clock entries:', err)
    } finally {
      setIsLoading(false)
    }
  }, [employee?.location?.id, startDate, endDate, filterEmployeeId])

  const loadEmployees = useCallback(async () => {
    if (!employee?.location?.id) return
    try {
      const res = await fetch(`/api/employees?locationId=${employee.location.id}&requestingEmployeeId=${employee.id}`)
      if (res.ok) {
        const json = await res.json()
        setEmployees(json.data.employees || [])
      }
    } catch (err) {
      console.error('Failed to load employees:', err)
    }
  }, [employee?.location?.id, employee?.id])

  useEffect(() => {
    if (employee?.location?.id) {
      loadEntries()
      loadEmployees()
    }
  }, [employee?.location?.id, loadEntries, loadEmployees])

  // Filter entries by status
  const filteredEntries = entries.filter(entry => {
    if (statusFilter === 'all') return true
    const status = getEntryStatus(entry)
    if (statusFilter === 'active') return status === 'Active'
    if (statusFilter === 'break') return status === 'On Break'
    if (statusFilter === 'completed') return status === 'Complete'
    return true
  })

  // Summary calculations
  const todayStr = new Date().toISOString().split('T')[0]
  const isToday = startDate === todayStr && endDate === todayStr
  const totalClockIns = entries.length
  const currentlyActive = entries.filter(e => !e.clockOut && !e.isOnBreak).length
  const onBreak = entries.filter(e => e.isOnBreak).length
  const totalHours = entries.reduce((sum, e) => sum + (e.regularHours || 0) + (e.overtimeHours || 0), 0)

  function getEntryStatus(entry: TimeClockEntry): string {
    if (entry.isOnBreak) return 'On Break'
    if (!entry.clockOut) {
      // Check if missing out (previous day punch with no clock out)
      const clockInDate = new Date(entry.clockIn).toISOString().split('T')[0]
      const today = new Date().toISOString().split('T')[0]
      if (clockInDate < today) return 'Missing Out'
      return 'Active'
    }
    return 'Complete'
  }

  function statusBadge(entry: TimeClockEntry) {
    const status = getEntryStatus(entry)
    const config: Record<string, string> = {
      'Active': 'bg-green-100 text-green-800',
      'On Break': 'bg-amber-100 text-amber-800',
      'Complete': 'bg-gray-100 text-gray-600',
      'Missing Out': 'bg-red-100 text-red-800',
    }
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${config[status] || 'bg-gray-100 text-gray-600'}`}>
        {status}
      </span>
    )
  }

  function formatTime(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  function calcEstPay(entry: TimeClockEntry): string {
    if (!entry.hourlyRate) return '—'
    const reg = (entry.regularHours || 0) * entry.hourlyRate
    const ot = (entry.overtimeHours || 0) * entry.hourlyRate * 1.5
    return formatCurrency(reg + ot)
  }

  function openEditModal(entry: TimeClockEntry) {
    setEditEntry(entry)
    setEditForm({
      clockIn: entry.clockIn.slice(0, 16), // datetime-local format
      clockOut: entry.clockOut ? entry.clockOut.slice(0, 16) : '',
      breakMinutes: entry.breakMinutes || 0,
      notes: entry.notes || '',
      reason: '',
    })
  }

  async function handleSaveEdit() {
    if (!editEntry || !employee) return
    if (!editForm.reason.trim()) {
      toast.error('Reason for edit is required')
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch('/api/time-clock', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryId: editEntry.id,
          clockIn: editForm.clockIn ? new Date(editForm.clockIn).toISOString() : undefined,
          clockOut: editForm.clockOut ? new Date(editForm.clockOut).toISOString() : undefined,
          breakMinutes: editForm.breakMinutes,
          notes: editForm.notes || editEntry.notes,
          performedBy: employee.id,
          locationId: employee.location?.id,
        }),
      })

      if (res.ok) {
        toast.success('Time punch updated')
        setEditEntry(null)
        loadEntries()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update time punch')
      }
    } catch {
      toast.error('Failed to update time punch')
    } finally {
      setIsSaving(false)
    }
  }

  async function toggleBreaks(entryId: string) {
    const next = new Set(expandedRows)
    if (next.has(entryId)) {
      next.delete(entryId)
      setExpandedRows(next)
      return
    }
    // Fetch breaks if not cached
    if (!breaksByEntry[entryId]) {
      try {
        const res = await fetch(`/api/breaks?timeClockEntryId=${entryId}`)
        if (res.ok) {
          const json = await res.json()
          setBreaksByEntry(prev => ({ ...prev, [entryId]: json.data.breaks }))
        }
      } catch {
        toast.error('Failed to load breaks')
        return
      }
    }
    next.add(entryId)
    setExpandedRows(next)
  }

  function breakTypeBadge(type: string) {
    const config: Record<string, string> = {
      meal: 'bg-blue-100 text-blue-700',
      paid: 'bg-green-100 text-green-700',
      unpaid: 'bg-gray-100 text-gray-600',
    }
    return (
      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${config[type] || 'bg-gray-100 text-gray-600'}`}>
        {(type || 'unpaid').charAt(0).toUpperCase() + (type || 'unpaid').slice(1)}
      </span>
    )
  }

  if (!hydrated) return null
  if (!canView) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <AdminPageHeader title="Time Clock" backHref="/employees" />
        <p className="text-center text-gray-900 mt-12">You do not have permission to view time clock data.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Time Clock"
        backHref="/employees"
        actions={
          canEdit ? (
            <Button variant="primary" onClick={() => toast.info('Use POS floor plan to clock in/out employees')}>
              Correct Punch
            </Button>
          ) : undefined
        }
      />

      <div className="max-w-7xl mx-auto space-y-6">
        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-xs text-gray-900 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-900 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-900 mb-1">Employee</label>
                <select
                  value={filterEmployeeId}
                  onChange={e => setFilterEmployeeId(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="">All Employees</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.displayName || `${emp.firstName} ${emp.lastName}`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-900 mb-1">Status</label>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as StatusFilter)}
                  className="px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="break">On Break</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
              <Button variant="outline" onClick={loadEntries} disabled={isLoading}>
                {isLoading ? 'Loading...' : 'Refresh'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-sm text-gray-900">{isToday ? "Today's" : 'Total'} Clock-Ins</div>
              <div className="text-2xl font-bold">{totalClockIns}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-sm text-gray-900">Currently Active</div>
              <div className="text-2xl font-bold text-green-600">{currentlyActive}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-sm text-gray-900">On Break</div>
              <div className="text-2xl font-bold text-amber-600">{onBreak}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-sm text-gray-900">Total Hours</div>
              <div className="text-2xl font-bold">{totalHours.toFixed(1)}</div>
            </CardContent>
          </Card>
        </div>

        {/* Main Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Time Entries</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-gray-900">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
                Loading time clock data...
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="text-center py-12 text-gray-900">
                <svg className="w-12 h-12 mx-auto mb-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                No punches found for this date range
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-900">
                      <th className="py-2 pr-3">Employee</th>
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">Clock In</th>
                      <th className="py-2 pr-3">Clock Out</th>
                      <th className="py-2 pr-3 text-right">Break</th>
                      <th className="py-2 pr-3 text-right">Reg Hrs</th>
                      <th className="py-2 pr-3 text-right">OT Hrs</th>
                      <th className="py-2 pr-3 text-right">Est. Pay</th>
                      <th className="py-2 pr-3">Notes</th>
                      <th className="py-2 pr-3">Status</th>
                      {canEdit && <th className="py-2">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.map(entry => (
                      <>
                        <tr
                          key={entry.id}
                          className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                          onClick={() => toggleBreaks(entry.id)}
                        >
                          <td className="py-2 pr-3 font-medium">{entry.employeeName}</td>
                          <td className="py-2 pr-3">{formatDate(entry.clockIn)}</td>
                          <td className="py-2 pr-3">{formatTime(entry.clockIn)}</td>
                          <td className="py-2 pr-3">{formatTime(entry.clockOut)}</td>
                          <td className="py-2 pr-3 text-right">{entry.breakMinutes ? `${entry.breakMinutes}m` : '—'}</td>
                          <td className="py-2 pr-3 text-right">{entry.regularHours?.toFixed(1) ?? '—'}</td>
                          <td className="py-2 pr-3 text-right">{entry.overtimeHours?.toFixed(1) ?? '—'}</td>
                          <td className="py-2 pr-3 text-right">{calcEstPay(entry)}</td>
                          <td className="py-2 pr-3 max-w-[120px] truncate text-gray-900">{entry.notes || '—'}</td>
                          <td className="py-2 pr-3">
                            <span className="flex items-center gap-1.5">
                              {statusBadge(entry)}
                              {(() => {
                                const ot = getOvertimeStatus(entry)
                                if (ot === 'overtime') return (
                                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">OT</span>
                                )
                                if (ot === 'warning') return (
                                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Near OT</span>
                                )
                                // For completed entries, show OT badge if they logged overtime hours
                                if (entry.clockOut && entry.overtimeHours && entry.overtimeHours > 0) return (
                                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">OT</span>
                                )
                                return null
                              })()}
                            </span>
                          </td>
                          {canEdit && (
                            <td className="py-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e: React.MouseEvent) => {
                                  e.stopPropagation()
                                  openEditModal(entry)
                                }}
                              >
                                Edit
                              </Button>
                            </td>
                          )}
                        </tr>
                        {/* Expanded breaks */}
                        {expandedRows.has(entry.id) && (
                          <tr key={`${entry.id}-breaks`}>
                            <td colSpan={canEdit ? 11 : 10} className="bg-gray-50 px-6 py-3">
                              {!breaksByEntry[entry.id] ? (
                                <span className="text-xs text-gray-900">Loading breaks...</span>
                              ) : breaksByEntry[entry.id].length === 0 ? (
                                <span className="text-xs text-gray-900">No breaks recorded</span>
                              ) : (
                                <div className="space-y-1">
                                  <div className="text-xs font-medium text-gray-900 mb-2">Breaks</div>
                                  {breaksByEntry[entry.id].map(b => (
                                    <div key={b.id} className="flex items-center gap-4 text-xs">
                                      {breakTypeBadge(b.breakType)}
                                      <span>{formatTime(b.startedAt)}</span>
                                      <span className="text-gray-900">to</span>
                                      <span>{b.endedAt ? formatTime(b.endedAt) : 'ongoing'}</span>
                                      <span className="text-gray-900">{b.duration ? `${b.duration}m` : '—'}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit Punch Modal */}
      <Modal
        isOpen={!!editEntry}
        onClose={() => setEditEntry(null)}
        title="Edit Time Punch"
        size="md"
      >
        {editEntry && (
          <div className="space-y-4">
            <div className="text-sm text-gray-600 font-medium">
              {editEntry.employeeName} &mdash; {formatDate(editEntry.clockIn)}
            </div>

            <div>
              <label className="block text-xs text-gray-900 mb-1">Clock In</label>
              <input
                type="datetime-local"
                value={editForm.clockIn}
                onChange={e => setEditForm({ ...editForm, clockIn: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-900 mb-1">Clock Out</label>
              <input
                type="datetime-local"
                value={editForm.clockOut}
                onChange={e => setEditForm({ ...editForm, clockOut: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-900 mb-1">Break Minutes</label>
              <input
                type="number"
                value={editForm.breakMinutes}
                onChange={e => setEditForm({ ...editForm, breakMinutes: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                min={0}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-900 mb-1">Notes</label>
              <textarea
                value={editForm.notes}
                onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                rows={2}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-900 mb-1">Reason for Edit *</label>
              <textarea
                value={editForm.reason}
                onChange={e => setEditForm({ ...editForm, reason: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                rows={2}
                placeholder="Required — logged for audit"
              />
            </div>

            {editEntry.clockIn !== editEntry.clockOut && (
              <p className="text-xs text-gray-900 italic">
                {new Date(editEntry.clockIn).getTime() !== new Date(editEntry.clockIn).getTime()
                  ? ''
                  : `Last updated: ${new Date(editEntry.clockIn).toLocaleString()}`}
              </p>
            )}

            <div className="flex gap-2 pt-4 border-t">
              <Button variant="ghost" className="flex-1" onClick={() => setEditEntry(null)} disabled={isSaving}>
                Cancel
              </Button>
              <Button variant="primary" className="flex-1" onClick={handleSaveEdit} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
