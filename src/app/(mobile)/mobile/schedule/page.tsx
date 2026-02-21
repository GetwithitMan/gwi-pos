'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface ScheduleShift {
  id: string
  date: string
  startTime: string
  endTime: string
  breakMinutes: number
  status: string
  roleName: string | null
  scheduleWeekStart: string | null
  notes: string | null
}

function formatTime(time: string): string {
  const [hourStr, minuteStr] = time.split(':')
  const hour = parseInt(hourStr, 10)
  const minute = minuteStr || '00'
  const period = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 === 0 ? 12 : hour % 12
  return `${displayHour}:${minute} ${period}`
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

  useEffect(() => {
    if (authChecked && employeeId && locationId) {
      loadSchedule()
    }
  }, [authChecked, employeeId, locationId, loadSchedule])

  if (!authChecked) {
    return <div className="min-h-screen bg-gray-950" />
  }

  const weekGroups = groupShiftsByWeek(shifts)

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
          onClick={loadSchedule}
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
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
