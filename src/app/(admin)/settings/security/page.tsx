'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow, NumberRow, SettingsSaveBar } from '@/components/admin/settings'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import type { SecuritySettings } from '@/lib/settings'

const IDLE_LOCK_OPTIONS = [0, 1, 3, 5, 10, 15, 30] as const

export default function SecuritySettingsPage() {
  const { employee } = useRequireAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const [security, setSecurity] = useState<SecuritySettings | null>(null)

  useUnsavedWarning(isDirty)

  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
        setSecurity(data.settings.security)
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
    if (!security) return
    try {
      setIsSaving(true)
      const data = await saveSettingsApi({ security }, employee?.id)
      setSecurity(data.settings.security)
      setIsDirty(false)
      toast.success('Security settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const updateSecurity = <K extends keyof SecuritySettings>(key: K, value: SecuritySettings[K]) => {
    setSecurity(prev => prev ? { ...prev, [key]: value } : prev)
    setIsDirty(true)
  }

  if (isLoading || !security) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Security Settings"
          subtitle="Loading..."
          breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        />
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-900 text-lg">Loading security settings...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Security Settings"
        subtitle="PIN lockout, screen lock, buddy-punch detection, and 2FA configuration"
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
                  : 'bg-gray-200 text-gray-900 cursor-not-allowed'
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
          <p className="text-sm text-gray-900 mb-5">Current security policies for PIN login and void approval.</p>

          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border border-gray-200">
              <div className="mt-0.5 w-5 h-5 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-3 h-3 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <div className="text-sm text-gray-900">Manager PIN lockout after 3 failed attempts</div>
                <div className="text-xs text-gray-900 mt-0.5">After 3 failed PIN attempts, the account is locked for 15 minutes. A manager can reset it from the employee&apos;s profile.</div>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border border-gray-200">
              <div className="mt-0.5 w-5 h-5 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-3 h-3 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <div className="text-sm text-gray-900">Approval expiration</div>
                <div className="text-xs text-gray-900 mt-0.5">When a manager approves via SMS, they receive a one-time code (valid 5 minutes). Approval links are valid for 30 minutes. Both can only be used once.</div>
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
            Card 2: Screen Lock & Buddy Punch
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Screen Lock & Time Clock</h2>
          <p className="text-sm text-gray-900 mb-5">Control idle lockout and buddy-punch detection for time clock events.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Require PIN After Each Payment"
              description="Staff must re-enter their PIN after every transaction. Adds security but slows down high-volume service."
              checked={security.requirePinAfterPayment}
              onChange={v => updateSecurity('requirePinAfterPayment', v)}
              border
            />

            <div className="flex items-center justify-between py-3 border-b border-gray-100">
              <div>
                <div className="text-sm text-gray-900">Lock Screen After Idle</div>
                <div className="text-xs text-gray-900">Require PIN re-entry after period of inactivity (0 = disabled)</div>
              </div>
              <select
                value={security.idleLockMinutes}
                onChange={e => updateSecurity('idleLockMinutes', Number(e.target.value))}
                className="px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {IDLE_LOCK_OPTIONS.map(min => (
                  <option key={min} value={min}>
                    {min === 0 ? 'Disabled' : `${min} min`}
                  </option>
                ))}
              </select>
            </div>

            <ToggleRow
              label="Detect Possible Time Fraud (Buddy-Punch)"
              description="Alert if an employee clocks in from a new device or unusual location. Helps prevent one employee clocking in for another. The first use of a new device won't trigger an alert \u2014 only unexpected changes."
              checked={security.enableBuddyPunchDetection}
              onChange={v => updateSecurity('enableBuddyPunchDetection', v)}
              border
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 3: 2FA for High-Value Actions
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">SMS Manager Approval (2-Factor Security)</h2>
          <p className="text-sm text-gray-900 mb-5">For high-value actions like large refunds or voids, a manager receives a text message with approval details. They must respond before the action proceeds.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Require Remote Approval for Large Refunds"
              description="Refunds above the threshold require SMS manager approval"
              checked={security.require2FAForLargeRefunds}
              onChange={v => updateSecurity('require2FAForLargeRefunds', v)}
              border
            />

            {security.require2FAForLargeRefunds && (
              <NumberRow
                label="Refund Approval Threshold"
                description="Refunds above this dollar amount require remote approval"
                value={security.refund2FAThreshold}
                onChange={v => updateSecurity('refund2FAThreshold', v)}
                suffix="$"
                min={1}
                max={10000}
                step={25}
              />
            )}

            <ToggleRow
              label="Require Remote Approval for Large Voids"
              description="Voids above the threshold require SMS manager approval (not just local PIN)"
              checked={security.require2FAForLargeVoids}
              onChange={v => updateSecurity('require2FAForLargeVoids', v)}
              border
            />

            {security.require2FAForLargeVoids && (
              <NumberRow
                label="Void Approval Threshold"
                description="Voids above this dollar amount require remote SMS approval"
                value={security.void2FAThreshold}
                onChange={v => updateSecurity('void2FAThreshold', v)}
                suffix="$"
                min={1}
                max={10000}
                step={25}
              />
            )}
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 4: Business Day (moved to Staff & Shifts)
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Business Day</h2>
          <p className="text-sm text-gray-900 mb-3">Business Day settings have moved. Configure end-of-day rules in Staff &amp; Shifts settings.</p>
          <Link
            href="/settings/staff"
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition-all"
          >
            Go to Staff &amp; Shifts
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </section>

        {/* ═══════════════════════════════════════════
            Card 5: Coming Soon
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 opacity-60">
          <h2 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
            Advanced Security
            <span className="text-xs bg-gray-100 text-gray-900 px-2 py-0.5 rounded-full">Coming Soon</span>
          </h2>
          <p className="text-sm text-gray-900 mt-2">The following features will be available in a future update:</p>
          <ul className="mt-3 space-y-2 text-sm text-gray-900">
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
