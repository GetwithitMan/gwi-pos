'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow, NumberRow, SettingsSaveBar } from '@/components/admin/settings'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import type { BarTabSettings, PaymentSettings, BarOperationsSettings } from '@/lib/settings'
import { DEFAULT_BAR_OPERATIONS } from '@/lib/settings'

export default function TabSettingsPage() {
  const { employee } = useRequireAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const [barTabs, setBarTabs] = useState<BarTabSettings | null>(null)
  const [payments, setPayments] = useState<PaymentSettings | null>(null)
  const [barOperations, setBarOperations] = useState<BarOperationsSettings | null>(null)

  useUnsavedWarning(isDirty)

  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
        setBarTabs(data.settings.barTabs)
        setPayments(data.settings.payments)
        setBarOperations(data.settings.barOperations ?? DEFAULT_BAR_OPERATIONS)
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
    if (!barTabs || !payments || !barOperations) return
    try {
      setIsSaving(true)
      const data = await saveSettingsApi({ barTabs, payments, barOperations }, employee?.id)
      setBarTabs(data.settings.barTabs)
      setPayments(data.settings.payments)
      setBarOperations(data.settings.barOperations ?? DEFAULT_BAR_OPERATIONS)
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

  const updatePayments = <K extends keyof PaymentSettings>(key: K, value: PaymentSettings[K]) => {
    setPayments(prev => prev ? { ...prev, [key]: value } : prev)
    setIsDirty(true)
  }

  const updateBarOperations = <K extends keyof BarOperationsSettings>(key: K, value: BarOperationsSettings[K]) => {
    setBarOperations(prev => prev ? { ...prev, [key]: value } : prev)
    setIsDirty(true)
  }

  if (isLoading || !barTabs || !payments || !barOperations) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Tabs & Pre-Auth"
          subtitle="Loading..."
          breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        />
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-900 text-lg">Loading tab settings...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Tabs & Pre-Auth"
        subtitle="Control how bar tabs are opened, how cards are held, and what happens if a customer leaves without paying."
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
            Card 1: Bar Tab Policies
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Bar Tab Policies</h2>
          <p className="text-sm text-gray-600 mb-5">Control how tabs are opened and what&apos;s required from customers and staff.</p>

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
              description="Allow opening a tab with just a name, no credit card required. If both are ON, staff can open a tab either way — with a card or with just a name. If Require Card is ON and Allow Name-Only is OFF, a card is always required."
              checked={barTabs.allowNameOnlyTab}
              onChange={v => updateBarTabs('allowNameOnlyTab', v)}
              border
            />

            <ToggleRow
              label="Require Tabs Closed Before Shift End"
              description="Block an employee's shift close if they have any open tabs or orders"
              checked={barTabs.requireCloseTabsBeforeShift}
              onChange={v => updateBarTabs('requireCloseTabsBeforeShift', v)}
              border
            />

            <ToggleRow
              label="Manager Exempt from Tab-Close Requirement"
              description="Managers can close their shift even if open tabs exist"
              checked={barTabs.managerExemptFromTabClose}
              onChange={v => updateBarTabs('managerExemptFromTabClose', v)}
              border
            />

            <div className="flex items-center justify-between py-3 border-t border-gray-100">
              <div>
                <div className="text-sm text-gray-900">Inactivity Warning After</div>
                <div className="text-xs text-gray-600">Show a reminder when a tab hasn&apos;t had any activity for this long. This is a visual warning only — tabs are never automatically closed.</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="15"
                  value={barTabs.tabTimeoutMinutes}
                  onChange={e => updateBarTabs('tabTimeoutMinutes', parseInt(e.target.value) || 0)}
                  aria-label="Inactivity warning minutes"
                  className="w-24 px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-900 text-sm text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <span className="text-sm text-gray-900">min</span>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 2: Pre-Authorization (Bar Tabs)
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Pre-Authorization</h2>
          <p className="text-sm text-gray-600 mb-5">Pre-authorization temporarily holds an amount on the customer&apos;s card when they open a tab. This reserve is released or converted to a real charge when the tab is closed.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Enable Pre-Auth"
              description="Hold a reserved amount on the customer's card when a tab is opened. The actual charge happens at close."
              checked={payments.enablePreAuth}
              onChange={v => updatePayments('enablePreAuth', v)}
            />
            <ToggleRow
              label="Auto-Increment Enabled"
              description="When a tab gets close to the hold limit, automatically request a new hold to make room for more charges — without interrupting service."
              checked={payments.autoIncrementEnabled}
              onChange={v => updatePayments('autoIncrementEnabled', v)}
              border
            />
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
            <NumberRow
              label="Default Pre-Auth Amount"
              description="How much to reserve on the customer's card when they open a tab. Most bars use $50–$100. Too low = frequent re-auth requests. Too high = some cards may decline."
              value={payments.defaultPreAuthAmount}
              onChange={v => updatePayments('defaultPreAuthAmount', v)}
              prefix="$"
              min={1}
              max={9999}
            />
            <NumberRow
              label="Minimum Pre-Auth Amount"
              description="Minimum hold amount required to open a bar tab. Set to 0 for no minimum. Prevents tabs from being opened with holds too small to cover a typical order."
              value={payments.minPreAuthAmount ?? 0}
              onChange={v => updatePayments('minPreAuthAmount', v)}
              prefix="$"
              min={0}
              max={9999}
            />
            <NumberRow
              label="Pre-Auth Expiration"
              description="Days until the card hold is automatically released if the tab is never closed. Most card networks require release within 7 days."
              value={payments.preAuthExpirationDays}
              onChange={v => updatePayments('preAuthExpirationDays', v)}
              suffix="days"
              min={1}
              max={30}
            />
            <NumberRow
              label="Increment Threshold"
              description="When the tab total reaches this percentage of the current hold amount, request an additional authorization. Example: 75% means if the hold is $100 and the tab hits $75, a new hold is requested."
              value={payments.incrementThresholdPercent}
              onChange={v => updatePayments('incrementThresholdPercent', v)}
              suffix="%"
              min={50}
              max={100}
            />
            <NumberRow
              label="Increment Amount"
              description="Fixed dollar amount for each incremental authorization"
              value={payments.incrementAmount}
              onChange={v => updatePayments('incrementAmount', v)}
              prefix="$"
              min={5}
              max={500}
            />
            <NumberRow
              label="Tip Buffer"
              description="Add extra room to the hold to cover a future tip. Example: 20% buffer on a $100 tab holds $120 — the extra $20 covers a typical tip so the final charge won't exceed the hold."
              value={payments.incrementTipBufferPercent}
              onChange={v => updatePayments('incrementTipBufferPercent', v)}
              suffix="%"
              min={0}
              max={100}
            />
            <NumberRow
              label="Max Tab Alert"
              description="Send a manager alert when any open tab exceeds this amount. Useful for catching unusually large orders early."
              value={payments.maxTabAlertAmount}
              onChange={v => updatePayments('maxTabAlertAmount', v)}
              prefix="$"
              min={0}
              max={99999}
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 3: Device Tip Prompt
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Device Tip Prompt</h2>
          <p className="text-sm text-gray-600 mb-5">Settings for the customer-facing tip prompt shown on CFD or card reader during tab close.</p>

          <div className="space-y-4">
            <NumberRow
              label="Tip Prompt Timeout"
              description="How long to wait for the customer to select a tip on the device before falling back to $0 tip and proceeding with capture. Set higher for slower-paced environments."
              value={payments.cfdTipTimeoutSeconds ?? 30}
              onChange={v => updatePayments('cfdTipTimeoutSeconds', v)}
              suffix="sec"
              min={10}
              max={300}
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 4: Walkout & Capture Retries
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Walkout & Capture Retries</h2>
          <p className="text-sm text-gray-600 mb-5">What happens when a tab&apos;s card charge fails — for example, if a customer&apos;s card declines when you try to close their tab.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Auto-Flag Walkout After Max Retries"
              description="After the card fails the set number of times, automatically mark this tab as a walkout (customer left without paying) and stop retrying. The tab will appear in your reports for manual follow-up."
              checked={barTabs.autoFlagWalkoutAfterDeclines}
              onChange={v => updateBarTabs('autoFlagWalkoutAfterDeclines', v)}
            />
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm text-gray-900">Max Capture Retries</div>
                <div className="text-xs text-gray-600">How many times to retry a failed card charge before giving up and flagging the tab as a walkout.</div>
              </div>
              <input
                type="number"
                min="1"
                max="10"
                value={barTabs.maxCaptureRetries}
                onChange={e => updateBarTabs('maxCaptureRetries', parseInt(e.target.value) || 3)}
                aria-label="Max capture retries"
                className="w-24 px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-900 text-sm text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 5: Last Call (Batch Tab Close)
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Last Call</h2>
          <p className="text-sm text-gray-600 mb-5">Batch-close all open bar tabs at end of night. Managers can trigger &quot;Last Call&quot; from the open orders panel to close every remaining tab at once, with auto-gratuity applied to tabs that have no tip.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Enable Last Call"
              description="Show the Last Call button in the open orders panel for managers. When triggered, all open bar tabs are closed at once."
              checked={barOperations.lastCallEnabled}
              onChange={v => updateBarOperations('lastCallEnabled', v)}
            />
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
            <NumberRow
              label="Auto-Gratuity Percentage"
              description="Tip percentage to apply to tabs that don't already have a tip when Last Call is triggered. Set to 0 to close without adding gratuity."
              value={barOperations.lastCallAutoGratuityPercent}
              onChange={v => updateBarOperations('lastCallAutoGratuityPercent', v)}
              suffix="%"
              min={0}
              max={50}
            />
          </div>
        </section>

        {/* Bottom save bar */}
        <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} />
      </div>
    </div>
  )
}
