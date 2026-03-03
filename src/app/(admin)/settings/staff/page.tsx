'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow, SettingsSaveBar } from '@/components/admin/settings'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import type { ClockOutSettings, BusinessDaySettings } from '@/lib/settings'

export default function StaffShiftsPage() {
  const { employee } = useRequireAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const [clockOut, setClockOut] = useState<ClockOutSettings | null>(null)
  const [businessDay, setBusinessDay] = useState<BusinessDaySettings | null>(null)

  useUnsavedWarning(isDirty)

  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
        setClockOut(data.settings.clockOut)
        setBusinessDay(data.settings.businessDay)
      } catch (err) {
        if ((err as DOMException).name !== 'AbortError') {
          toast.error('Failed to load settings')
        }
      } finally {
        setIsLoading(false)
      }
    })()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const cleanup = loadSettings()
    return cleanup
  }, [loadSettings])

  const handleSave = async () => {
    if (!clockOut || !businessDay) return
    try {
      setIsSaving(true)
      const data = await saveSettingsApi({ clockOut, businessDay }, employee?.id)
      setClockOut(data.settings.clockOut)
      setBusinessDay(data.settings.businessDay)
      setIsDirty(false)
      toast.success('Staff & Shifts settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const updateClockOut = <K extends keyof ClockOutSettings>(key: K, value: ClockOutSettings[K]) => {
    setClockOut(prev => prev ? { ...prev, [key]: value } : prev)
    setIsDirty(true)
  }

  const updateBusinessDay = <K extends keyof BusinessDaySettings>(key: K, value: BusinessDaySettings[K]) => {
    setBusinessDay(prev => prev ? { ...prev, [key]: value } : prev)
    setIsDirty(true)
  }

  if (isLoading || !clockOut || !businessDay) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Staff & Shifts"
          subtitle="Loading..."
          breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        />
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-400 text-lg">Loading settings...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Staff & Shifts"
        subtitle="Clock-out requirements and business day boundary enforcement"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        actions={
          <div className="flex items-center gap-3">
            {isDirty && (
              <span className="text-sm text-amber-600 font-medium">Unsaved changes</span>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !isDirty}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
                isDirty
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        }
      />

      <div className="max-w-3xl mx-auto space-y-6 pb-16">

        {/* ═══════════════════════════════════════════
            Card 1: Clock-Out Requirements
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Clock-Out Requirements</h2>
          <p className="text-sm text-gray-500 mb-5">Requirements employees must meet before clocking out at any time.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Require All Tabs/Orders Settled"
              description="Employees cannot clock out if they have any open orders or unclosed tabs assigned to them."
              checked={clockOut.requireSettledBeforeClockOut}
              onChange={v => updateClockOut('requireSettledBeforeClockOut', v)}
            />

            <ToggleRow
              label="Require All Tips Adjusted"
              description="Some credit card tips may need adjustment before they're finalized. This ensures employees review and confirm their tips before ending their shift."
              checked={clockOut.requireTipsAdjusted}
              onChange={v => updateClockOut('requireTipsAdjusted', v)}
              border
            />

            <ToggleRow
              label="Allow Transferring Open Tabs on Clock-Out"
              description="If enabled, employees can clock out by transferring their open tabs to another staff member instead of settling them. This works together with the 'Require Settled' rule above — transferring counts as resolving the tab."
              checked={clockOut.allowTransferOnClockOut}
              onChange={v => updateClockOut('allowTransferOnClockOut', v)}
              border
            />
          </div>

          <p className="mt-4 text-xs text-gray-400 border-t border-gray-100 pt-4">
            These rules apply whenever an employee clocks out. They are independent of — and additive with — the business day boundary rules below.
          </p>
        </section>

        {/* ═══════════════════════════════════════════
            Card 2: Business Day Boundary
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">End-of-Day Automatic Rules</h2>
          <p className="text-sm text-gray-500 mb-5">These rules run automatically at a set time each day — separate from the per-shift rules above.</p>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-5">
            <p className="text-xs text-amber-800">The rules above (Clock-Out Requirements) run every time an employee manually clocks out. The rules below run automatically at the end of each business day. Both sets of rules can be active at the same time.</p>
          </div>

          {/* Day Start Time */}
          <div className="flex items-center justify-between py-3 border-b border-gray-100">
            <div>
              <div className="text-sm text-gray-700">Day Start Time</div>
              <div className="text-xs text-gray-400">The time your business day resets. Orders and reports before this time are counted as the previous day. For venues open past midnight, use 4:00 AM. For day-only venues, midnight is fine.</div>
            </div>
            <input
              type="time"
              value={businessDay.dayStartTime}
              onChange={e => updateBusinessDay('dayStartTime', e.target.value)}
              aria-label="Business day start time"
              className="w-32 px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-0 mt-2">
            <ToggleRow
              label="Require Tabs Closed at Day End"
              description="Force all open tabs to be settled when the business day ends. This is the day-end version of the per-shift rule above."
              checked={businessDay.enforceTabClose}
              onChange={v => updateBusinessDay('enforceTabClose', v)}
            />

            <ToggleRow
              label="Enforce Clock-Out at Day Boundary"
              description="Automatically clock out any employees still clocked in when the business day ends. Useful for venues where staff sometimes forget."
              checked={businessDay.enforceClockOut}
              onChange={v => updateBusinessDay('enforceClockOut', v)}
              border
            />

            <ToggleRow
              label="Close Batch at Day End"
              description="Automatically run card batch settlement when the business day ends. This sends the day's transactions to your bank for deposit. WARNING: Batch settlement may temporarily pause new card payments while it runs."
              checked={businessDay.batchAtDayEnd}
              onChange={v => updateBusinessDay('batchAtDayEnd', v)}
              border
            />
          </div>

          {/* Grace Period */}
          <div className="flex items-center justify-between py-3 mt-2 border-t border-gray-100">
            <div>
              <div className="text-sm text-gray-700">Grace Period</div>
              <div className="text-xs text-gray-400">Extra minutes after the day-end time before rules are enforced. Use 5–15 minutes to give staff time to close out last-minute tabs. Set to 0 for immediate enforcement.</div>
            </div>
            <input
              type="number"
              min="0"
              max="120"
              step="5"
              value={businessDay.graceMinutes}
              onChange={e => updateBusinessDay('graceMinutes', parseInt(e.target.value) || 0)}
              aria-label="Grace period minutes"
              className="w-24 px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-900 text-sm text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <p className="mt-4 text-xs text-gray-400 border-t border-gray-100 pt-4">
            These rules apply specifically at the business day boundary — not at individual clock-out time. Both rule sets are additive: a bartender with open tabs will be blocked at clock-out (above) AND force-closed when the day resets.
          </p>
        </section>

        {/* Bottom save bar */}
        <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} />
      </div>
    </div>
  )
}
