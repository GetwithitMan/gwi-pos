'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow, NumberRow, SettingsSaveBar } from '@/components/admin/settings'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import type { AlertSettings } from '@/lib/settings'

export default function AlertSettingsPage() {
  const { employee } = useRequireAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const [alerts, setAlerts] = useState<AlertSettings | null>(null)

  useUnsavedWarning(isDirty)

  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
        setAlerts(data.settings.alerts)
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
    if (!alerts) return
    try {
      setIsSaving(true)
      const data = await saveSettingsApi({ alerts }, employee?.id)
      setAlerts(data.settings.alerts)
      setIsDirty(false)
      toast.success('Alert settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const updateAlerts = <K extends keyof AlertSettings>(key: K, value: AlertSettings[K]) => {
    setAlerts(prev => prev ? { ...prev, [key]: value } : prev)
    setIsDirty(true)
  }

  if (isLoading || !alerts) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Alerts & Notifications"
          subtitle="Loading..."
          breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        />
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-400 text-lg">Loading alert settings...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Alerts & Notifications"
        subtitle="Configure system alerts for unusual activity, large transactions, and time clock events"
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
            Card 1: Master Toggle
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">System Alerts</h2>
          <p className="text-sm text-gray-500 mb-5">Master switch for all alert notifications. When disabled, no alerts will be generated.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Enable System Alerts"
              description="Enable system alerts for unusual activity"
              checked={alerts.enabled}
              onChange={v => updateAlerts('enabled', v)}
              border
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 2: Transaction Alerts
            ═══════════════════════════════════════════ */}
        <section className={`bg-white border border-gray-200 rounded-2xl shadow-sm p-6 ${!alerts.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Transaction Alerts</h2>
          <p className="text-sm text-gray-500 mb-5">Get notified when voids or discounts exceed configured thresholds.</p>

          <div className="space-y-0">
            <NumberRow
              label="Large Void Threshold"
              description="Alert when a void exceeds this amount"
              value={alerts.largeVoidThreshold}
              onChange={v => updateAlerts('largeVoidThreshold', v)}
              suffix="$"
              min={1}
              max={10000}
              step={5}
            />

            <NumberRow
              label="Large Discount Threshold"
              description="Alert when a discount exceeds this amount"
              value={alerts.largeDiscountThreshold}
              onChange={v => updateAlerts('largeDiscountThreshold', v)}
              suffix="$"
              min={1}
              max={10000}
              step={5}
            />

            <NumberRow
              label="Frequent Discount Limit"
              description="Alert when an employee applies more than this many discounts per day"
              value={alerts.frequentDiscountLimit}
              onChange={v => updateAlerts('frequentDiscountLimit', v)}
              suffix="per day"
              min={1}
              max={100}
              step={1}
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 3: Time Clock Alerts
            ═══════════════════════════════════════════ */}
        <section className={`bg-white border border-gray-200 rounded-2xl shadow-sm p-6 ${!alerts.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Time Clock Alerts</h2>
          <p className="text-sm text-gray-500 mb-5">Overtime and labor compliance warnings.</p>

          <div className="space-y-0">
            <NumberRow
              label="Overtime Warning"
              description="Minutes before overtime (8 hours) to show warning"
              value={alerts.overtimeWarningMinutes}
              onChange={v => updateAlerts('overtimeWarningMinutes', v)}
              suffix="min"
              min={5}
              max={120}
              step={5}
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 4: Cash Drawer Alerts
            ═══════════════════════════════════════════ */}
        <section className={`bg-white border border-gray-200 rounded-2xl shadow-sm p-6 ${!alerts.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Cash Drawer</h2>
          <p className="text-sm text-gray-500 mb-5">Alerts for cash drawer activity.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Cash Drawer Open Alerts"
              description="Alert on cash drawer open events"
              checked={alerts.cashDrawerAlertEnabled}
              onChange={v => updateAlerts('cashDrawerAlertEnabled', v)}
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
