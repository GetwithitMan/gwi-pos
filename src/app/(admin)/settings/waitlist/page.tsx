'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow, NumberRow, SettingsSaveBar } from '@/components/admin/settings'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import type { WaitlistSettings } from '@/lib/settings'
import { DEFAULT_WAITLIST_SETTINGS } from '@/lib/settings'

export default function WaitlistSettingsPage() {
  const { employee } = useRequireAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const [waitlist, setWaitlist] = useState<WaitlistSettings | null>(null)

  useUnsavedWarning(isDirty)

  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
        setWaitlist(data.settings.waitlist || DEFAULT_WAITLIST_SETTINGS)
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
    if (!waitlist) return
    try {
      setIsSaving(true)
      const data = await saveSettingsApi({ waitlist }, employee?.id)
      setWaitlist(data.settings.waitlist || DEFAULT_WAITLIST_SETTINGS)
      setIsDirty(false)
      toast.success('Waitlist settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const update = <K extends keyof WaitlistSettings>(key: K, value: WaitlistSettings[K]) => {
    setWaitlist(prev => prev ? { ...prev, [key]: value } : prev)
    setIsDirty(true)
  }

  if (isLoading || !waitlist) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Waitlist"
          subtitle="Loading..."
          breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        />
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-700 text-lg">Loading waitlist settings...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Waitlist"
        subtitle="Configure entertainment waitlist behavior, notifications, and deposit collection."
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

        {/* General Waitlist Settings */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">General</h2>
          <p className="text-sm text-gray-600 mb-5">Control how the entertainment waitlist works for customers.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Enable Waitlist"
              description="Allow customers to join a waitlist for entertainment items (pool tables, bowling lanes, etc.)"
              checked={waitlist.enabled}
              onChange={v => update('enabled', v)}
            />

            <ToggleRow
              label="SMS Notifications"
              description="Send SMS via Twilio when an entertainment item becomes available for the next customer in line"
              checked={waitlist.smsNotifications}
              onChange={v => update('smsNotifications', v)}
              border
            />
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
            <NumberRow
              label="Max Party Size"
              description="Maximum number of people allowed in a single waitlist entry"
              value={waitlist.maxPartySize}
              onChange={v => update('maxPartySize', v)}
              min={1}
              max={100}
            />
            <NumberRow
              label="Estimated Minutes per Turn"
              description="Average wait time per party ahead in the queue. Used to show estimated wait times."
              value={waitlist.estimateMinutesPerTurn}
              onChange={v => update('estimateMinutesPerTurn', v)}
              suffix="min"
              min={1}
              max={240}
            />
            <NumberRow
              label="Max Waitlist Size"
              description="Maximum concurrent entries before the waitlist is considered full"
              value={waitlist.maxWaitlistSize}
              onChange={v => update('maxWaitlistSize', v)}
              min={1}
              max={500}
            />
            <NumberRow
              label="Auto-Remove After"
              description="Remove a notified customer from the waitlist if they are not seated within this many minutes"
              value={waitlist.autoRemoveAfterMinutes}
              onChange={v => update('autoRemoveAfterMinutes', v)}
              suffix="min"
              min={1}
              max={120}
            />
          </div>
        </section>

        {/* Deposit Settings */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Deposits</h2>
          <p className="text-sm text-gray-600 mb-5">Require a deposit to hold a waitlist position. Deposits can be applied to the customer&apos;s order when seated or forfeited on no-show.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Require Deposit"
              description="Collect a deposit when a customer is added to the waitlist"
              checked={waitlist.depositEnabled}
              onChange={v => update('depositEnabled', v)}
            />

            <ToggleRow
              label="Allow Cash Deposits"
              description="Accept cash as a deposit payment method in addition to credit/debit cards"
              checked={waitlist.allowCashDeposit}
              onChange={v => update('allowCashDeposit', v)}
              border
              disabled={!waitlist.depositEnabled}
              disabledNote="Enable deposits first"
            />

            <ToggleRow
              label="Apply Deposit to Order"
              description="Automatically apply the deposit amount as a credit when the customer is seated and starts an order"
              checked={waitlist.applyDepositToOrder}
              onChange={v => update('applyDepositToOrder', v)}
              border
              disabled={!waitlist.depositEnabled}
              disabledNote="Enable deposits first"
            />

            <ToggleRow
              label="Forfeit on No-Show"
              description="If a customer doesn't show up after being notified, keep the deposit instead of refunding it"
              checked={waitlist.forfeitOnNoShow}
              onChange={v => update('forfeitOnNoShow', v)}
              border
              disabled={!waitlist.depositEnabled}
              disabledNote="Enable deposits first"
            />
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
            <NumberRow
              label="Deposit Amount"
              description="Dollar amount to collect as a deposit when a customer joins the waitlist"
              value={waitlist.depositAmount}
              onChange={v => update('depositAmount', v)}
              prefix="$"
              min={1}
              max={500}
            />
          </div>
        </section>

        {/* Bottom save bar */}
        <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} />
      </div>
    </div>
  )
}
