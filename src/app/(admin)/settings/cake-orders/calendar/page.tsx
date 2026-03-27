'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useCakeFeature } from '@/hooks/useCakeFeature'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'

// ── Types ────────────────────────────────────────────────────────────────────

interface CalendarEvent {
  id: string
  type: 'order' | 'block'
  title: string
  start: string
  end: string
  color: string
  // order fields
  status?: string
  orderNumber?: number | string
  assignedTo?: string | null
  eventTimeStart?: string | null
  eventTimeEnd?: string | null
  // block fields
  blockType?: string
  cakeOrderId?: string | null
  employeeId?: string | null
  notes?: string | null
}

interface Employee {
  id: string
  firstName: string
  lastName: string
}

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  deposit_paid: 'Deposit Paid',
  in_production: 'In Production',
  ready: 'Ready',
  delivered: 'Delivered',
  submitted: 'Submitted',
  quoted: 'Quoted',
  approved: 'Approved',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const STATUS_DOT_COLORS: Record<string, string> = {
  deposit_paid: 'bg-purple-500',
  in_production: 'bg-yellow-500',
  ready: 'bg-green-500',
  delivered: 'bg-blue-500',
}

const STATUS_BADGE_COLORS: Record<string, string> = {
  deposit_paid: 'bg-purple-100 text-purple-800',
  in_production: 'bg-yellow-100 text-yellow-800',
  ready: 'bg-green-100 text-green-800',
  delivered: 'bg-blue-100 text-blue-800',
  submitted: 'bg-gray-100 text-gray-800',
  quoted: 'bg-indigo-100 text-indigo-800',
  approved: 'bg-teal-100 text-teal-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-red-100 text-red-800',
}

const BLOCK_TYPE_DOT_COLORS: Record<string, string> = {
  production: 'bg-orange-500',
  decoration: 'bg-pink-500',
  delivery: 'bg-cyan-500',
  blocked: 'bg-red-500',
}

const BLOCK_TYPE_BADGE_COLORS: Record<string, string> = {
  production: 'bg-orange-100 text-orange-800',
  decoration: 'bg-pink-100 text-pink-800',
  delivery: 'bg-cyan-100 text-cyan-800',
  blocked: 'bg-red-100 text-red-800',
}

const BLOCK_TYPE_LABELS: Record<string, string> = {
  production: 'Production',
  decoration: 'Decoration',
  delivery: 'Delivery',
  blocked: 'Blocked',
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ── Helpers ──────────────────────────────────────────────────────────────────

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseDateStr(s: string | Date): string {
  if (s instanceof Date) return toDateKey(s)
  // Handle ISO strings and YYYY-MM-DD
  return s.split('T')[0]
}

function getCalendarGrid(year: number, month: number): Date[][] {
  const firstOfMonth = new Date(year, month, 1)
  const startDow = firstOfMonth.getDay() // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const startDate = new Date(year, month, 1 - startDow)
  const weeks: Date[][] = []
  const current = new Date(startDate)

  for (let w = 0; w < 6; w++) {
    const week: Date[] = []
    for (let d = 0; d < 7; d++) {
      week.push(new Date(current))
      current.setDate(current.getDate() + 1)
    }
    // Only add 6th week if it has days from this month
    if (w < 5 || week[0].getMonth() === month) {
      weeks.push(week)
    }
  }
  return weeks
}

function getMonthBounds(year: number, month: number): { startDate: string; endDate: string } {
  const firstOfMonth = new Date(year, month, 1)
  const startDow = firstOfMonth.getDay()
  const lastOfMonth = new Date(year, month + 1, 0)

  // Calendar grid starts from the Sunday before month start
  const gridStart = new Date(year, month, 1 - startDow)
  // Calendar grid can extend up to 6 rows
  const gridEnd = new Date(gridStart)
  gridEnd.setDate(gridEnd.getDate() + 42)

  return {
    startDate: toDateKey(gridStart),
    endDate: toDateKey(gridEnd > lastOfMonth ? gridEnd : lastOfMonth),
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CakeCalendarPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/settings/cake-orders/calendar' })
  const cakeEnabled = useCakeFeature()
  const locationId = useAuthStore(s => s.locationId)

  const today = new Date()
  const [currentYear, setCurrentYear] = useState(today.getFullYear())
  const [currentMonth, setCurrentMonth] = useState(today.getMonth())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [showBlockModal, setShowBlockModal] = useState(false)
  const [employees, setEmployees] = useState<Employee[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Block form state
  const [blockTitle, setBlockTitle] = useState('')
  const [blockStartDate, setBlockStartDate] = useState('')
  const [blockEndDate, setBlockEndDate] = useState('')
  const [blockType, setBlockType] = useState<string>('production')
  const [blockEmployeeId, setBlockEmployeeId] = useState('')
  const [blockNotes, setBlockNotes] = useState('')
  const [isSavingBlock, setIsSavingBlock] = useState(false)

  const monthLabel = new Date(currentYear, currentMonth).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  const calendarGrid = useMemo(() => getCalendarGrid(currentYear, currentMonth), [currentYear, currentMonth])
  const todayKey = toDateKey(today)

  // ── Index events by date ────────────────────────────────────────────────
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {}
    for (const ev of events) {
      const start = parseDateStr(ev.start)
      const end = parseDateStr(ev.end)
      // For multi-day blocks, add to each day in range
      if (ev.type === 'block' && start !== end) {
        const d = new Date(start + 'T00:00:00')
        const endD = new Date(end + 'T00:00:00')
        while (d <= endD) {
          const key = toDateKey(d)
          if (!map[key]) map[key] = []
          map[key].push(ev)
          d.setDate(d.getDate() + 1)
        }
      } else {
        if (!map[start]) map[start] = []
        map[start].push(ev)
      }
    }
    return map
  }, [events])

  // ── Selected date events ────────────────────────────────────────────────
  const selectedOrders = useMemo(() => {
    if (!selectedDate) return []
    return (eventsByDate[selectedDate] || []).filter(e => e.type === 'order')
  }, [selectedDate, eventsByDate])

  const selectedBlocks = useMemo(() => {
    if (!selectedDate) return []
    return (eventsByDate[selectedDate] || []).filter(e => e.type === 'block')
  }, [selectedDate, eventsByDate])

  // ── Fetch calendar data ─────────────────────────────────────────────────
  const loadCalendar = useCallback(async () => {
    if (!locationId) return
    try {
      const { startDate, endDate } = getMonthBounds(currentYear, currentMonth)
      const params = new URLSearchParams({ locationId, startDate, endDate })
      const res = await fetch(`/api/cake-orders/calendar?${params}`)
      if (!res.ok) throw new Error('Failed to load calendar')
      const json = await res.json()
      setEvents(json.data || [])
    } catch {
      toast.error('Failed to load calendar data')
    } finally {
      setIsLoading(false)
    }
  }, [locationId, currentYear, currentMonth])

  // ── Fetch employees for block form ──────────────────────────────────────
  const loadEmployees = useCallback(async () => {
    if (!locationId) return
    try {
      const res = await fetch(`/api/employees?locationId=${locationId}&isActive=true&limit=200`)
      if (!res.ok) return
      const json = await res.json()
      const empList = (json.data || json.employees || []).map((e: Record<string, unknown>) => ({
        id: e.id as string,
        firstName: (e.firstName || '') as string,
        lastName: (e.lastName || '') as string,
      }))
      setEmployees(empList)
    } catch {
      // Non-critical: employee dropdown just won't populate
    }
  }, [locationId])

  // ── Initial load + month changes ────────────────────────────────────────
  useEffect(() => {
    if (hydrated && locationId) {
      setIsLoading(true)
      loadCalendar()
    }
  }, [hydrated, locationId, loadCalendar])

  useEffect(() => {
    if (hydrated && locationId) {
      loadEmployees()
    }
  }, [hydrated, locationId, loadEmployees])

  // ── Auto-refresh every 30s ──────────────────────────────────────────────
  useEffect(() => {
    if (!hydrated || !locationId) return
    pollRef.current = setInterval(() => {
      loadCalendar()
    }, 30_000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [hydrated, locationId, loadCalendar])

  // ── Navigation ──────────────────────────────────────────────────────────
  const goToPrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentYear(y => y - 1)
      setCurrentMonth(11)
    } else {
      setCurrentMonth(m => m - 1)
    }
    setSelectedDate(null)
  }

  const goToNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentYear(y => y + 1)
      setCurrentMonth(0)
    } else {
      setCurrentMonth(m => m + 1)
    }
    setSelectedDate(null)
  }

  // ── Create block ────────────────────────────────────────────────────────
  const openBlockModal = () => {
    setBlockTitle('')
    setBlockStartDate(selectedDate || toDateKey(today))
    setBlockEndDate(selectedDate || toDateKey(today))
    setBlockType('production')
    setBlockEmployeeId('')
    setBlockNotes('')
    setShowBlockModal(true)
  }

  const saveBlock = async () => {
    if (!blockTitle.trim()) {
      toast.error('Title is required')
      return
    }
    if (!blockStartDate || !blockEndDate) {
      toast.error('Start and end dates are required')
      return
    }
    if (blockEndDate < blockStartDate) {
      toast.error('End date must be on or after start date')
      return
    }
    setIsSavingBlock(true)
    try {
      const res = await fetch('/api/cake-orders/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          title: blockTitle.trim(),
          startDate: blockStartDate,
          endDate: blockEndDate,
          blockType,
          employeeId: blockEmployeeId || undefined,
          notes: blockNotes.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.error || 'Failed to create block')
      }
      toast.success('Calendar block created')
      setShowBlockModal(false)
      loadCalendar()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create block')
    } finally {
      setIsSavingBlock(false)
    }
  }

  if (!hydrated) return null

  if (!cakeEnabled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="max-w-md text-center">
          <h2 className="mb-2 text-xl font-semibold text-gray-900">
            Cake Ordering Not Enabled
          </h2>
          <p className="text-sm text-gray-600">
            Enable cake ordering from Mission Control to access this page.
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Print styles */}
      <style jsx global>{`
        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="min-h-screen bg-gray-50 p-6">
        <AdminPageHeader
          title="Production Calendar"
          subtitle="View and schedule cake orders and production blocks"
          breadcrumbs={[
            { label: 'Settings', href: '/settings' },
            { label: 'Cake Orders', href: '/settings/cake-orders' },
          ]}
          backHref="/settings/cake-orders"
          actions={
            <div className="flex items-center gap-2 no-print">
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                Print
              </Button>
              <Button variant="primary" size="sm" onClick={openBlockModal}>
                Add Block
              </Button>
            </div>
          }
        />

        <div className="max-w-7xl mx-auto mt-6 space-y-4 print-area">
          {/* Month Navigation */}
          <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 p-4">
            <button
              onClick={goToPrevMonth}
              className="no-print px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              &larr; Previous
            </button>
            <h2 className="text-lg font-semibold text-gray-900">{monthLabel}</h2>
            <button
              onClick={goToNextMonth}
              className="no-print px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Next &rarr;
            </button>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 text-xs text-gray-600 no-print">
            <span className="font-medium text-gray-800">Orders:</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-yellow-500" /> In Production</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500" /> Ready</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Delivered</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-purple-500" /> Deposit Paid</span>
            <span className="ml-4 font-medium text-gray-800">Blocks:</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-orange-500" /> Production</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-pink-500" /> Decoration</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-cyan-500" /> Delivery</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Blocked</span>
          </div>

          {/* Calendar Grid */}
          {isLoading ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
              Loading calendar...
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* Header row */}
              <div className="grid grid-cols-7 border-b border-gray-200">
                {WEEKDAY_NAMES.map(d => (
                  <div key={d} className="px-2 py-2 text-xs font-semibold text-gray-600 text-center bg-gray-50">
                    {d}
                  </div>
                ))}
              </div>

              {/* Week rows */}
              {calendarGrid.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7 border-b border-gray-100 last:border-b-0">
                  {week.map((day, di) => {
                    const dateKey = toDateKey(day)
                    const isCurrentMonth = day.getMonth() === currentMonth
                    const isToday = dateKey === todayKey
                    const isSelected = dateKey === selectedDate
                    const dayEvents = eventsByDate[dateKey] || []
                    const orderDots = dayEvents.filter(e => e.type === 'order')
                    const blockDots = dayEvents.filter(e => e.type === 'block')

                    return (
                      <button
                        key={di}
                        onClick={() => setSelectedDate(isSelected ? null : dateKey)}
                        className={`
                          min-h-[80px] p-1.5 text-left transition-colors border-r border-gray-100 last:border-r-0
                          ${isCurrentMonth ? 'bg-white' : 'bg-gray-50'}
                          ${isSelected ? 'ring-2 ring-inset ring-indigo-500' : ''}
                          ${!isSelected ? 'hover:bg-indigo-50' : ''}
                        `}
                      >
                        <div className={`
                          text-xs font-medium mb-1
                          ${isToday ? 'w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center' : ''}
                          ${!isToday && isCurrentMonth ? 'text-gray-900' : ''}
                          ${!isToday && !isCurrentMonth ? 'text-gray-400' : ''}
                        `}>
                          {day.getDate()}
                        </div>
                        {/* Dots */}
                        <div className="flex flex-wrap gap-0.5">
                          {orderDots.slice(0, 4).map(ev => (
                            <span
                              key={ev.id}
                              className={`w-2 h-2 rounded-full ${STATUS_DOT_COLORS[ev.status || ''] || 'bg-gray-400'}`}
                              title={ev.title}
                            />
                          ))}
                          {orderDots.length > 4 && (
                            <span className="text-[9px] text-gray-500 leading-none">+{orderDots.length - 4}</span>
                          )}
                          {blockDots.slice(0, 3).map(ev => (
                            <span
                              key={ev.id}
                              className={`w-2 h-2 rounded-sm ${BLOCK_TYPE_DOT_COLORS[ev.blockType || ''] || 'bg-gray-400'}`}
                              title={ev.title}
                            />
                          ))}
                          {blockDots.length > 3 && (
                            <span className="text-[9px] text-gray-500 leading-none">+{blockDots.length - 3}</span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}

          {/* Selected Date Detail Panel */}
          {selectedDate && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">
                  {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </h3>
                <button
                  onClick={() => setSelectedDate(null)}
                  className="text-xs text-gray-500 hover:text-gray-700 no-print"
                >
                  Close
                </button>
              </div>

              {/* Orders section */}
              {selectedOrders.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                    Cake Orders ({selectedOrders.length})
                  </h4>
                  <div className="space-y-2">
                    {selectedOrders.map(order => (
                      <div
                        key={order.id}
                        className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-gray-900">
                            CK-{order.orderNumber}
                          </span>
                          <span className="text-sm text-gray-600">{order.title.replace(`CK-${order.orderNumber} `, '')}</span>
                          {order.eventTimeStart && (
                            <span className="text-xs text-gray-500">{order.eventTimeStart}</span>
                          )}
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            STATUS_BADGE_COLORS[order.status || ''] || 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {STATUS_LABELS[order.status || ''] || order.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Blocks section */}
              {selectedBlocks.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                    Calendar Blocks ({selectedBlocks.length})
                  </h4>
                  <div className="space-y-2">
                    {selectedBlocks.map(block => {
                      const empName = block.employeeId
                        ? employees.find(e => e.id === block.employeeId)
                        : null
                      return (
                        <div
                          key={block.id}
                          className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-medium text-gray-900">{block.title}</span>
                            {empName && (
                              <span className="text-xs text-gray-500">
                                {empName.firstName} {empName.lastName}
                              </span>
                            )}
                            {block.notes && (
                              <span className="text-xs text-gray-400 italic truncate max-w-[200px]">
                                {block.notes}
                              </span>
                            )}
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              BLOCK_TYPE_BADGE_COLORS[block.blockType || ''] || 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {BLOCK_TYPE_LABELS[block.blockType || ''] || block.blockType}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {selectedOrders.length === 0 && selectedBlocks.length === 0 && (
                <div className="text-sm text-gray-500 text-center py-4">
                  No orders or blocks on this date.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add Block Modal */}
      {showBlockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 no-print">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Add Calendar Block</h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={blockTitle}
                onChange={e => setBlockTitle(e.target.value)}
                placeholder="e.g. Wedding Cake Prep"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={blockStartDate}
                  onChange={e => setBlockStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={blockEndDate}
                  onChange={e => setBlockEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Block Type</label>
              <select
                value={blockType}
                onChange={e => setBlockType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="production">Production</option>
                <option value="decoration">Decoration</option>
                <option value="delivery">Delivery</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Assigned Employee</label>
              <select
                value={blockEmployeeId}
                onChange={e => setBlockEmployeeId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">None</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.firstName} {emp.lastName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={blockNotes}
                onChange={e => setBlockNotes(e.target.value)}
                rows={3}
                placeholder="Optional notes..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowBlockModal(false)}
                disabled={isSavingBlock}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={saveBlock}
                disabled={isSavingBlock}
              >
                {isSavingBlock ? 'Saving...' : 'Create Block'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
