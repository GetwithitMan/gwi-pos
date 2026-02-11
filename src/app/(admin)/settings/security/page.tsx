'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow, NumberRow, SettingsSaveBar } from '@/components/admin/settings'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import type { BusinessDaySettings } from '@/lib/settings'

export default function SecuritySettingsPage() {
  const { employee } = useRequireAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const [businessDay, setBusinessDay] = useState<BusinessDaySettings | null>(null)

  useUnsavedWarning(isDirty)

  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
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
    if (!businessDay) return
    try {
      setIsSaving(true)
      const data = await saveSettingsApi({ businessDay }, employee?.id)
      setBusinessDay(data.settings.businessDay)
      setIsDirty(false)
      toast.success('Security settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const updateBusinessDay = <K extends keyof BusinessDaySettings>(key: K, value: BusinessDaySettings[K]) => {
    setBusinessDay(prev => prev ? { ...prev, [key]: value } : prev)
    setIsDirty(true)
  }

  if (isLoading || !businessDay) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Security Settings"
          subtitle="Loading..."
          breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        />
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-400 text-lg">Loading security settings...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Security Settings"
        subtitle="PIN lockout, business day boundaries, and security configuration"
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
            Card 1: PIN & Access (Read-Only Info)
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">PIN & Access</h2>
          <p className="text-sm text-gray-500 mb-5">Current security policies for PIN login and void approval.</p>

          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border border-gray-200">
              <div className="mt-0.5 w-5 h-5 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-3 h-3 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <div className="text-sm text-gray-700">Manager PIN lockout after 3 failed attempts</div>
                <div className="text-xs text-gray-400 mt-0.5">Prevents brute-force PIN guessing</div>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border border-gray-200">
              <div className="mt-0.5 w-5 h-5 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-3 h-3 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <div className="text-sm text-gray-700">Void approval tokens expire after 30 minutes, codes after 5 minutes</div>
                <div className="text-xs text-gray-400 mt-0.5">Limits window for using void approval</div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200">
              <p className="text-xs text-indigo-600">
                These values are currently hardcoded for security. They will be configurable in a future update.
              </p>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 2: Business Day
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Business Day</h2>
          <p className="text-sm text-gray-500 mb-5">Define when the business day starts and what happens at the day boundary.</p>

          <div className="space-y-0">
            <div className="flex items-center justify-between py-3 border-b border-gray-100">
              <div>
                <div className="text-sm text-gray-700">Business Day Starts At</div>
                <div className="text-xs text-gray-400">Orders before this time count toward the previous business day</div>
              </div>
              <input
                type="time"
                value={businessDay.dayStartTime}
                onChange={e => updateBusinessDay('dayStartTime', e.target.value)}
                aria-label="Business day start time"
                className="px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <ToggleRow
              label="Force Clock-Out at Day Boundary"
              description="Automatically clock out employees when the business day ends"
              checked={businessDay.enforceClockOut}
              onChange={v => updateBusinessDay('enforceClockOut', v)}
              border
            />

            <ToggleRow
              label="Force Tab Close at Day Boundary"
              description="Automatically close all open tabs when the business day ends"
              checked={businessDay.enforceTabClose}
              onChange={v => updateBusinessDay('enforceTabClose', v)}
              border
            />

            <ToggleRow
              label="Run Daily Batch at Day Boundary"
              description="Trigger end-of-day batch processing (reports, sync, cleanup)"
              checked={businessDay.batchAtDayEnd}
              onChange={v => updateBusinessDay('batchAtDayEnd', v)}
              border
            />

            <NumberRow
              label="Grace Period"
              description="Extra time after the day boundary before enforcement kicks in"
              value={businessDay.graceMinutes}
              onChange={v => updateBusinessDay('graceMinutes', v)}
              suffix="min"
              min={0}
              max={120}
              step={5}
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 3: Coming Soon
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 opacity-60">
          <h2 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
            Advanced Security
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Coming Soon</span>
          </h2>
          <p className="text-sm text-gray-400 mt-2">The following features will be available in a future update:</p>
          <ul className="mt-3 space-y-2 text-sm text-gray-400">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-200" />
              Blocked card management
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-200" />
              Suspicious tip alerts
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-200" />
              Auto-gratuity configuration
            </li>
          </ul>
        </section>

        {/* Bottom save bar */}
        <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} />
      </div>
    </div>
  )
}
