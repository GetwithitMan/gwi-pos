'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from '@/stores/toast-store'

interface ScheduleShift {
  id: string
  date: string
  startTime: string
  endTime: string
  breakMinutes: number
  status: string
  roleName: string | null
  scheduleWeekStart: string | null
  scheduleId: string | null
  notes: string | null
}

interface SwapRequestEmployee {
  id: string
  firstName: string
  lastName: string
  displayName: string | null
}

interface IncomingSwapRequest {
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

function formatTime(time: string): string {
  const [hourStr, minuteStr] = time.split(':')
  const hour = parseInt(hourStr, 10)
  const minute = minuteStr || '00'
  const period = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 === 0 ? 12 : hour % 12
  return `${displayHour}:${minute} ${period}`
}

function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatDayDate(dateStr: string): { day: string; date: string } {
  const date = new Date(dateStr)
  const day = date.toLocaleDateString('en-US', { weekday: 'long' })
  const dateFormatted = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
  return { day, date: dateFormatted }
}

function getWeekLabel(dateStr: string): string {
  const shiftDate = new Date(dateStr)
  shiftDate.setHours(0, 0, 0, 0)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const todayDay = today.getDay()
  const thisWeekStart = new Date(today)
  thisWeekStart.setDate(today.getDate() - todayDay)
  const thisWeekEnd = new Date(thisWeekStart)
  thisWeekEnd.setDate(thisWeekStart.getDate() + 6)

  const nextWeekStart = new Date(thisWeekStart)
  nextWeekStart.setDate(thisWeekStart.getDate() + 7)
  const nextWeekEnd = new Date(nextWeekStart)
  nextWeekEnd.setDate(nextWeekStart.getDate() + 6)

  if (shiftDate >= thisWeekStart && shiftDate <= thisWeekEnd) {
    return 'This Week'
  }
  if (shiftDate >= nextWeekStart && shiftDate <= nextWeekEnd) {
    return 'Next Week'
  }

  const weekStart = new Date(shiftDate)
  weekStart.setDate(shiftDate.getDate() - shiftDate.getDay())
  return `Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

function groupShiftsByWeek(shifts: ScheduleShift[]): Map<string, ScheduleShift[]> {
  const groups = new Map<string, ScheduleShift[]>()
  for (const shift of shifts) {
    const label = getWeekLabel(shift.date)
    if (!groups.has(label)) {
      groups.set(label, [])
    }
    groups.get(label)!.push(shift)
  }
  return groups
}

function getStatusStyle(status: string): string {
  switch (status) {
    case 'confirmed':
      return 'bg-green-500/20 text-green-400 border border-green-500/30'
    case 'scheduled':
      return 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
    case 'called_off':
      return 'bg-red-500/20 text-red-400 border border-red-500/30'
    case 'no_show':
      return 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
    case 'worked':
      return 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
    default:
      return 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'scheduled':
      return 'Scheduled'
    case 'confirmed':
      return 'Confirmed'
    case 'called_off':
      return 'Called Off'
    case 'no_show':
      return 'No Show'
    case 'worked':
      return 'Worked'
    default:
      return status.charAt(0).toUpperCase() + status.slice(1)
  }
}

function empName(emp: SwapRequestEmployee): string {
  return emp.displayName || `${emp.firstName} ${emp.lastName}`
}

export default function MobileSchedulePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <MobileScheduleContent />
    </Suspense>
  )
}

function MobileScheduleContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const locationIdParam = searchParams.get('locationId')
  const [locationId, setLocationId] = useState<string>(locationIdParam ?? '')
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [shifts, setShifts] = useState<ScheduleShift[]>([])
  const [loading, setLoading] = useState(true)
  const [authChecked, setAuthChecked] = useState(false)

  // Incoming swap requests (offers made TO this employee)
  const [incomingSwaps, setIncomingSwaps] = useState<IncomingSwapRequest[]>([])
  const [swapsLoading, setSwapsLoading] = useState(false)

  // Swap request dialog state (for requesting a swap on own shift)
  const [swapDialogShift, setSwapDialogShift] = useState<ScheduleShift | null>(null)
  const [swapNotes, setSwapNotes] = useState('')
  const [swapSubmitting, setSwapSubmitting] = useState(false)

  // Auth check on mount
  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/mobile/device/auth')
        if (res.ok) {
          const data = await res.json()
          setEmployeeId(data.data.employeeId)
          setAuthChecked(true)
          return
        }
      } catch {
        // network error — fall through to redirect
      }

      const loginUrl = locationId
        ? `/mobile/login?locationId=${locationId}`
        : '/mobile/login'
      router.replace(loginUrl)
    }

    checkAuth()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve locationId from localStorage if not in query params
  useEffect(() => {
    if (!locationId && typeof window !== 'undefined') {
      const stored = localStorage.getItem('mobile-locationId')
      if (stored) setLocationId(stored)
    }
  }, [locationId])

  const loadSchedule = useCallback(async () => {
    if (!employeeId || !locationId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        employeeId,
        locationId,
        weeksAhead: '2',
      })
      const res = await fetch(`/api/mobile/schedule?${params}`)
      if (res.ok) {
        const data = await res.json()
        setShifts(data.data.shifts ?? [])
      }
    } catch (err) {
      console.error('Failed to load schedule:', err)
    } finally {
      setLoading(false)
    }
  }, [employeeId, locationId])

  const loadIncomingSwaps = useCallback(async () => {
    if (!employeeId || !locationId) return
    setSwapsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId,
        employeeId,
        status: 'pending',
      })
      const res = await fetch(`/api/shift-swap-requests?${params}`)
      if (res.ok) {
        const data = await res.json()
        setIncomingSwaps(data.data.requests ?? [])
      }
    } catch (err) {
      console.error('Failed to load incoming swap requests:', err)
    } finally {
      setSwapsLoading(false)
    }
  }, [employeeId, locationId])

  useEffect(() => {
    if (authChecked && employeeId && locationId) {
      loadSchedule()
      loadIncomingSwaps()
    }
  }, [authChecked, employeeId, locationId, loadSchedule, loadIncomingSwaps])

  // Submit a swap request for one of the employee's own shifts
  const handleSendSwapRequest = async () => {
    if (!swapDialogShift || !employeeId || !locationId) return
    if (!swapDialogShift.scheduleId) {
      toast.error('Schedule information unavailable for this shift')
      return
    }
    setSwapSubmitting(true)
    try {
      const res = await fetch(
        `/api/schedules/${swapDialogShift.scheduleId}/shifts/${swapDialogShift.id}/swap-requests`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationId,
            requestedByEmployeeId: employeeId,
            notes: swapNotes || undefined,
          }),
        }
      )
      if (res.ok) {
        toast.success('Swap request sent')
        setSwapDialogShift(null)
        setSwapNotes('')
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to send swap request')
      }
    } catch {
      toast.error('Failed to send swap request')
    } finally {
      setSwapSubmitting(false)
    }
  }

  // Accept an incoming swap request
  const handleAcceptSwap = async (req: IncomingSwapRequest) => {
    if (!locationId) return
    try {
      const res = await fetch(
        `/api/shift-swap-requests/${req.id}/accept`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locationId }),
        }
      )
      if (res.ok) {
        toast.success('Swap accepted — awaiting manager approval')
        loadIncomingSwaps()
        loadSchedule()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to accept swap')
      }
    } catch {
      toast.error('Failed to accept swap')
    }
  }

  // Decline an incoming swap request
  const handleDeclineSwap = async (req: IncomingSwapRequest) => {
    if (!locationId) return
    try {
      const res = await fetch(
        `/api/shift-swap-requests/${req.id}/decline`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locationId }),
        }
      )
      if (res.ok) {
        toast.success('Swap declined')
        loadIncomingSwaps()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to decline swap')
      }
    } catch {
      toast.error('Failed to decline swap')
    }
  }

  if (!authChecked) {
    return <div className="min-h-screen bg-gray-950" />
  }

  const weekGroups = groupShiftsByWeek(shifts)

  // Shifts eligible for swap requests (not yet worked / called off)
  const isSwappable = (status: string) =>
    status === 'scheduled' || status === 'confirmed'

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <button
          onClick={() => router.back()}
          className="text-white/60 hover:text-white transition-colors"
          aria-label="Go back"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-bold">My Schedule</h1>
        <button
          onClick={() => { loadSchedule(); loadIncomingSwaps() }}
          className="text-white/60 hover:text-white transition-colors"
          aria-label="Refresh"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : shifts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-white/40">
            <svg className="w-12 h-12 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-lg font-medium">No upcoming shifts scheduled</p>
            <p className="text-sm mt-1 text-white/30">Check back after your manager publishes the schedule.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Array.from(weekGroups.entries()).map(([weekLabel, weekShifts]) => (
              <div key={weekLabel}>
                {/* Week header */}
                <div className="mb-3">
                  <span className="text-xs font-semibold tracking-widest text-white/40 uppercase">
                    {weekLabel}
                  </span>
                </div>

                {/* Shift cards */}
                <div className="space-y-3">
                  {weekShifts.map(shift => {
                    const { day, date } = formatDayDate(shift.date)
                    return (
                      <div
                        key={shift.id}
                        className="bg-gray-800 rounded-xl p-4 border border-white/5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          {/* Left: day + date */}
                          <div className="min-w-0">
                            <p className="font-bold text-white text-base leading-tight">{day}</p>
                            <p className="text-white/50 text-sm">{date}</p>
                          </div>

                          {/* Right: status badge */}
                          <span
                            className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${getStatusStyle(shift.status)}`}
                          >
                            {getStatusLabel(shift.status)}
                          </span>
                        </div>

                        {/* Time range */}
                        <div className="mt-3 flex items-center gap-2 text-white/90">
                          <svg className="w-4 h-4 text-white/40 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="font-medium">
                            {formatTime(shift.startTime)} &ndash; {formatTime(shift.endTime)}
                          </span>
                          {shift.breakMinutes > 0 && (
                            <span className="text-white/40 text-sm">
                              ({shift.breakMinutes}m break)
                            </span>
                          )}
                        </div>

                        {/* Role */}
                        {shift.roleName && (
                          <div className="mt-2 flex items-center gap-2 text-white/60 text-sm">
                            <svg className="w-4 h-4 text-white/30 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            <span>{shift.roleName}</span>
                          </div>
                        )}

                        {/* Notes */}
                        {shift.notes && (
                          <div className="mt-2 text-white/50 text-sm border-t border-white/10 pt-2">
                            {shift.notes}
                          </div>
                        )}

                        {/* Swap request button */}
                        {isSwappable(shift.status) && (
                          <div className="mt-3 pt-3 border-t border-white/10">
                            <button
                              onClick={() => {
                                setSwapDialogShift(shift)
                                setSwapNotes('')
                              }}
                              className="flex items-center gap-1.5 text-xs font-medium text-purple-400 hover:text-purple-300 transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                              </svg>
                              Request Swap
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            {/* ── Incoming Swap Requests ─────────────────────────────────── */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold tracking-widest text-white/40 uppercase">
                  Swap Requests For You
                  {incomingSwaps.length > 0 && (
                    <span className="ml-2 px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded-full text-xs normal-case tracking-normal">
                      {incomingSwaps.length}
                    </span>
                  )}
                </span>
              </div>

              {swapsLoading ? (
                <div className="flex items-center justify-center py-6">
                  <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : incomingSwaps.length === 0 ? (
                <div className="bg-gray-800/50 rounded-xl p-4 border border-white/5 text-center text-white/30 text-sm">
                  No pending swap offers.
                </div>
              ) : (
                <div className="space-y-3">
                  {incomingSwaps.map(req => (
                    <div
                      key={req.id}
                      className="bg-gray-800 rounded-xl p-4 border border-purple-500/20"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <p className="text-sm font-semibold text-white">
                            {formatShortDate(req.shift.date)}
                          </p>
                          <p className="text-white/60 text-xs">
                            {formatTime(req.shift.startTime)} – {formatTime(req.shift.endTime)}
                          </p>
                        </div>
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30 shrink-0">
                          Swap Offer
                        </span>
                      </div>

                      <p className="text-white/50 text-sm mb-3">
                        From: <span className="text-white/80">{empName(req.requestedByEmployee)}</span>
                      </p>

                      {req.notes && (
                        <p className="text-white/40 text-xs mb-3 italic">&ldquo;{req.notes}&rdquo;</p>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAcceptSwap(req)}
                          className="flex-1 py-2 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-500 text-white transition-colors"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => handleDeclineSwap(req)}
                          className="flex-1 py-2 rounded-lg text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white/70 hover:text-white transition-colors"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Swap Request Dialog (bottom sheet style overlay) ──────────────── */}
      {swapDialogShift && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => { setSwapDialogShift(null); setSwapNotes('') }}
          />

          {/* Sheet */}
          <div className="relative w-full max-w-lg bg-gray-900 rounded-t-2xl border-t border-white/10 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Offer Shift for Swap?</h2>
              <button
                onClick={() => { setSwapDialogShift(null); setSwapNotes('') }}
                className="text-white/40 hover:text-white transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="bg-gray-800 rounded-xl p-3 text-sm">
              <p className="font-semibold text-white">{formatShortDate(swapDialogShift.date)}</p>
              <p className="text-white/60 mt-0.5">
                {formatTime(swapDialogShift.startTime)} – {formatTime(swapDialogShift.endTime)}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-1.5">
                Notes (optional)
              </label>
              <textarea
                value={swapNotes}
                onChange={(e) => setSwapNotes(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 bg-gray-800 border border-white/10 rounded-xl text-white text-sm resize-none placeholder:text-white/30 focus:outline-none focus:border-purple-500/50"
                placeholder="Any reason or message..."
              />
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setSwapDialogShift(null); setSwapNotes('') }}
                disabled={swapSubmitting}
                className="flex-1 py-3 rounded-xl text-sm font-medium bg-gray-800 hover:bg-gray-700 text-white/60 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSendSwapRequest}
                disabled={swapSubmitting}
                className="flex-1 py-3 rounded-xl text-sm font-semibold bg-purple-600 hover:bg-purple-500 text-white transition-colors disabled:opacity-60"
              >
                {swapSubmitting ? 'Sending...' : 'Send Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
