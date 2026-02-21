'use client'

import { useState, useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface DayHours {
  day: number
  open: string
  close: string
  closed: boolean
}

const DAY_NAMES: Record<number, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
}

// Display order: Mon-Sun
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

const DEFAULT_HOURS: DayHours[] = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  day,
  open: '11:00',
  close: '22:00',
  closed: false,
}))

export default function OnlineHoursPage() {
  const hydrated = useAuthenticationGuard()
  const employee = useAuthStore(s => s.employee)
  const [hours, setHours] = useState<DayHours[]>(DEFAULT_HOURS)
  const [isLoading, setIsLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const locationId = employee?.location?.id

  useEffect(() => {
    if (!locationId) return
    const load = async () => {
      try {
        const res = await fetch(`/api/settings/online-ordering?locationId=${locationId}`)
        if (res.ok) {
          const json = await res.json()
          if (json.data?.hours && Array.isArray(json.data.hours)) {
            setHours(json.data.hours)
          }
        }
      } catch (err) {
        console.error('Failed to load hours:', err)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [locationId])

  const updateDay = (dayNum: number, field: keyof DayHours, value: string | boolean) => {
    setHours(prev =>
      prev.map(h => (h.day === dayNum ? { ...h, [field]: value } : h))
    )
  }

  const applyToAll = (open: string, close: string, closed: boolean) => {
    setHours(prev => prev.map(h => ({ ...h, open, close, closed })))
  }

  const handleSave = async () => {
    if (!locationId || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/settings/online-ordering', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          employeeId: employee?.id,
          settings: { onlineOrdering: { hours } },
        }),
      })
      if (res.ok) {
        toast.success('Online hours saved')
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to save')
      }
    } catch {
      toast.error('Failed to save hours')
    } finally {
      setSaving(false)
    }
  }

  if (!hydrated) return null

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Online Hours"
        subtitle="Set when customers can place online orders"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Online Ordering', href: '/settings/online-ordering' },
        ]}
      />

      <div className="max-w-3xl mx-auto space-y-6">
        {/* Info Banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-blue-700">
            When closed, customers see &quot;We&apos;re not accepting online orders right now.&quot;
          </p>
        </div>

        {/* Quick Fill Buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => applyToAll('11:00', '22:00', false)}
            className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-gray-700 font-medium"
          >
            Open 11am - 10pm daily
          </button>
          <button
            onClick={() => applyToAll('11:00', '22:00', true)}
            className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-gray-700 font-medium"
          >
            Closed all week
          </button>
        </div>

        {/* Weekly Schedule */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">Weekly Schedule</h2>
          </div>

          <div className="divide-y divide-gray-100">
            {DISPLAY_ORDER.map((dayNum) => {
              const dayHours = hours.find(h => h.day === dayNum) || {
                day: dayNum,
                open: '11:00',
                close: '22:00',
                closed: false,
              }

              return (
                <div
                  key={dayNum}
                  className={`px-6 py-4 flex items-center gap-4 ${
                    dayHours.closed ? 'bg-gray-50' : ''
                  }`}
                >
                  {/* Day name */}
                  <span className="w-28 text-sm font-medium text-gray-700 flex-shrink-0">
                    {DAY_NAMES[dayNum]}
                  </span>

                  {/* Closed toggle */}
                  <label className="flex items-center gap-2 flex-shrink-0 cursor-pointer">
                    <button
                      onClick={() => updateDay(dayNum, 'closed', !dayHours.closed)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        dayHours.closed ? 'bg-red-400' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          dayHours.closed ? 'translate-x-4.5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                    <span className={`text-xs font-medium ${dayHours.closed ? 'text-red-500' : 'text-gray-400'}`}>
                      Closed
                    </span>
                  </label>

                  {/* Time inputs */}
                  <div className={`flex items-center gap-2 flex-1 ${dayHours.closed ? 'opacity-30 pointer-events-none' : ''}`}>
                    <input
                      type="time"
                      value={dayHours.open}
                      onChange={(e) => updateDay(dayNum, 'open', e.target.value)}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <span className="text-gray-400 text-sm">to</span>
                    <input
                      type="time"
                      value={dayHours.close}
                      onChange={(e) => updateDay(dayNum, 'close', e.target.value)}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Save */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-6 py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors ${
              saving ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
