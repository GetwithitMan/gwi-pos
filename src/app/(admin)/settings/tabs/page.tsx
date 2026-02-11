'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow, SettingsSaveBar } from '@/components/admin/settings'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import type { BarTabSettings, ClockOutSettings } from '@/lib/settings'

export default function TabSettingsPage() {
  const { employee } = useRequireAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const [barTabs, setBarTabs] = useState<BarTabSettings | null>(null)
  const [clockOut, setClockOut] = useState<ClockOutSettings | null>(null)

  useUnsavedWarning(isDirty)

  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
        setBarTabs(data.settings.barTabs)
        setClockOut(data.settings.clockOut)
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
    if (!barTabs || !clockOut) return
    try {
      setIsSaving(true)
      const data = await saveSettingsApi({ barTabs, clockOut }, employee?.id)
      setBarTabs(data.settings.barTabs)
      setClockOut(data.settings.clockOut)
      setIsDirty(false)
      toast.success('Tab settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const updateBarTabs = <K extends keyof BarTabSettings>(key: K, value: BarTabSettings[K]) => {
    setBarTabs(prev => prev ? { ...prev, [key]: value } : prev)
    setIsDirty(true)
  }

  const updateClockOut = <K extends keyof ClockOutSettings>(key: K, value: ClockOutSettings[K]) => {
    setClockOut(prev => prev ? { ...prev, [key]: value } : prev)
    setIsDirty(true)
  }

  if (isLoading || !barTabs || !clockOut) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Tabs & Policies"
          subtitle="Loading..."
          breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        />
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-400 text-lg">Loading tab settings...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Tabs & Policies"
        subtitle="Bar tab policies, pre-authorization, and clock-out requirements"
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
            Card 1: Bar Tab Policies
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Bar Tab Policies</h2>
          <p className="text-sm text-gray-500 mb-5">Control how bar tabs are opened and managed.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Require Credit Card to Open Tab"
              description="Customers must provide a card before starting a tab"
              checked={barTabs.requireCardForTab}
              onChange={v => updateBarTabs('requireCardForTab', v)}
            />

            <ToggleRow
              label="Auto-Fill Customer Name from Card"
              description="Use cardholder name to populate tab name automatically"
              checked={barTabs.pullCustomerFromCard}
              onChange={v => updateBarTabs('pullCustomerFromCard', v)}
              border
            />

            <ToggleRow
              label="Allow Name-Only Tabs"
              description="Allow opening a tab with just a name, no credit card required"
              checked={barTabs.allowNameOnlyTab}
              onChange={v => updateBarTabs('allowNameOnlyTab', v)}
              border
            />

            <div className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm text-gray-700">Inactivity Warning After (minutes)</div>
                <div className="text-xs text-gray-400">Show timeout warning when a tab has been inactive for this long</div>
              </div>
              <input
                type="number"
                min="0"
                step="15"
                value={barTabs.tabTimeoutMinutes}
                onChange={e => updateBarTabs('tabTimeoutMinutes', parseInt(e.target.value) || 0)}
                aria-label="Inactivity warning minutes"
                className="w-24 px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-900 text-sm text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 2: Clock-Out Policies
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Clock-Out Policies</h2>
          <p className="text-sm text-gray-500 mb-5">Requirements employees must meet before clocking out.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Require All Tabs/Orders Settled"
              description="Employees cannot clock out with open tabs or unsettled orders"
              checked={clockOut.requireSettledBeforeClockOut}
              onChange={v => updateClockOut('requireSettledBeforeClockOut', v)}
            />

            <ToggleRow
              label="Require All Tips Adjusted"
              description="Employees must adjust all pending credit card tips before clocking out"
              checked={clockOut.requireTipsAdjusted}
              onChange={v => updateClockOut('requireTipsAdjusted', v)}
              border
            />

            <ToggleRow
              label="Allow Transferring Open Tabs on Clock-Out"
              description="Employees can transfer their open tabs/orders to another employee when clocking out"
              checked={clockOut.allowTransferOnClockOut}
              onChange={v => updateClockOut('allowTransferOnClockOut', v)}
              border
            />
          </div>
        </section>

        {/* Bottom save bar */}
        <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} />
      </div>
    </div>
  )
}
