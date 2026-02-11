'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow, NumberRow, SettingsSaveBar } from '@/components/admin/settings'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import type { PaymentSettings } from '@/lib/settings'

const PROCESSOR_OPTIONS: { value: PaymentSettings['processor']; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'No card processing -- cash only' },
  { value: 'simulated', label: 'Simulated', description: 'Test mode with simulated transactions' },
  { value: 'datacap', label: 'Datacap', description: 'Datacap Direct integration for live card processing' },
]

export default function PaymentSettingsPage() {
  const { employee } = useRequireAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [form, setForm] = useState<PaymentSettings | null>(null)

  // Array fields stored as comma-separated strings for editing
  const [tipDollarStr, setTipDollarStr] = useState('')
  const [tipPercentStr, setTipPercentStr] = useState('')

  useUnsavedWarning(isDirty)

  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
        const payments = data.settings.payments
        setForm(payments)
        setTipDollarStr((payments.tipDollarSuggestions ?? []).join(', '))
        setTipPercentStr((payments.tipPercentSuggestions ?? []).join(', '))
      } catch (err) {
        if ((err as DOMException).name !== 'AbortError') {
          toast.error('Failed to load payment settings')
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
    if (!form) return
    try {
      setIsSaving(true)

      // Parse array fields
      const parseDollar = tipDollarStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n > 0)
      const parsePercent = tipPercentStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n > 0)

      const payload: PaymentSettings = {
        ...form,
        tipDollarSuggestions: parseDollar.length > 0 ? parseDollar : [1, 2, 3],
        tipPercentSuggestions: parsePercent.length > 0 ? parsePercent : [18, 20, 25],
      }

      const data = await saveSettingsApi({ payments: payload }, employee?.id)
      const saved = data.settings.payments
      setForm(saved)
      setTipDollarStr((saved.tipDollarSuggestions ?? []).join(', '))
      setTipPercentStr((saved.tipPercentSuggestions ?? []).join(', '))
      setIsDirty(false)
      toast.success('Payment settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save payment settings')
    } finally {
      setIsSaving(false)
    }
  }

  const update = <K extends keyof PaymentSettings>(key: K, value: PaymentSettings[K]) => {
    setForm(prev => prev ? { ...prev, [key]: value } : prev)
    setIsDirty(true)
  }

  if (isLoading || !form) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Payment Configuration"
          subtitle="Loading..."
          breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        />
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-400 text-lg">Loading payment settings...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Payment Configuration"
        subtitle="Payment processing, Quick Pay, tip suggestions, signature threshold, and walkout recovery"
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
            Card 1: Payment Methods
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Payment Methods</h2>
          <p className="text-sm text-gray-500 mb-5">Choose which payment methods are accepted at this location.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Accept Cash"
              description="Allow cash payments at the register"
              checked={form.acceptCash}
              onChange={v => update('acceptCash', v)}
            />
            <ToggleRow
              label="Accept Credit Cards"
              description="Allow credit card payments"
              checked={form.acceptCredit}
              onChange={v => update('acceptCredit', v)}
              border
            />
            <ToggleRow
              label="Accept Debit Cards"
              description="Allow debit card payments"
              checked={form.acceptDebit}
              onChange={v => update('acceptDebit', v)}
              border
            />
            <ToggleRow
              label="Accept Gift Cards"
              description="Allow gift card redemption as payment"
              checked={form.acceptGiftCards}
              onChange={v => update('acceptGiftCards', v)}
              border
            />
            <ToggleRow
              label="Accept House Accounts"
              description="Allow customers to charge to a house account"
              checked={form.acceptHouseAccounts}
              onChange={v => update('acceptHouseAccounts', v)}
              border
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 2: Card Processing
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Card Processing</h2>
          <p className="text-sm text-gray-500 mb-5">Configure the card payment processor and reader behavior.</p>

          <label className="block text-sm font-medium text-gray-600 mb-2">Processor</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            {PROCESSOR_OPTIONS.map(opt => (
              <button
                type="button"
                key={opt.value}
                onClick={() => update('processor', opt.value)}
                className={`text-left p-3 rounded-xl border transition-all ${
                  form.processor === opt.value
                    ? 'border-indigo-500 bg-indigo-500/20 ring-1 ring-indigo-500/40'
                    : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                }`}
              >
                <div className={`text-sm font-medium ${form.processor === opt.value ? 'text-indigo-600' : 'text-gray-700'}`}>
                  {opt.label}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{opt.description}</div>
              </button>
            ))}
          </div>

          <div className="space-y-0 border-t border-gray-100">
            <ToggleRow
              label="Test Mode"
              description="Process transactions in test/sandbox mode (no real charges)"
              checked={form.testMode}
              onChange={v => update('testMode', v)}
            />
            <ToggleRow
              label="Auto-Swap on Failure"
              description="Automatically offer to switch readers when one goes offline"
              checked={form.autoSwapOnFailure}
              onChange={v => update('autoSwapOnFailure', v)}
              border
            />
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100">
            <NumberRow
              label="Reader Timeout"
              description="Seconds to wait for reader response before timing out"
              value={form.readerTimeoutSeconds}
              onChange={v => update('readerTimeoutSeconds', v)}
              suffix="sec"
              min={5}
              max={120}
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 3: Quick Pay & Tips
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Quick Pay & Tips</h2>
          <p className="text-sm text-gray-500 mb-5">Configure the Quick Pay single-transaction mode and tip suggestion behavior.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Enable Quick Pay"
              description="Allow single-tap card payment without opening a tab"
              checked={form.quickPayEnabled}
              onChange={v => update('quickPayEnabled', v)}
            />
            <ToggleRow
              label="Require Custom for Zero Tip"
              description="Customers must tap Custom to skip the tip (no silent zero option)"
              checked={form.requireCustomForZeroTip}
              onChange={v => update('requireCustomForZeroTip', v)}
              border
            />
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
            <NumberRow
              label="Dollar/Percent Threshold"
              description="Orders under this amount show dollar tip buttons; above shows percentage buttons"
              value={form.tipDollarAmountThreshold}
              onChange={v => update('tipDollarAmountThreshold', v)}
              prefix="$"
              min={0}
              max={999}
            />

            <div>
              <label className="block text-sm text-gray-700 mb-1">Dollar Tip Suggestions</label>
              <p className="text-xs text-gray-400 mb-2">Comma-separated dollar amounts shown when order is under threshold</p>
              <input
                type="text"
                value={tipDollarStr}
                onChange={e => { setTipDollarStr(e.target.value); setIsDirty(true) }}
                onBlur={e => setTipDollarStr(e.target.value.split(',').map(s => s.trim()).filter(Boolean).join(', '))}
                placeholder="1, 2, 3"
                aria-label="Dollar tip suggestions"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-700 mb-1">Percent Tip Suggestions</label>
              <p className="text-xs text-gray-400 mb-2">Comma-separated percentages shown when order is over threshold</p>
              <input
                type="text"
                value={tipPercentStr}
                onChange={e => { setTipPercentStr(e.target.value); setIsDirty(true) }}
                onBlur={e => setTipPercentStr(e.target.value.split(',').map(s => s.trim()).filter(Boolean).join(', '))}
                placeholder="18, 20, 25"
                aria-label="Percent tip suggestions"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 4: Pre-Authorization (Bar Tabs)
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Pre-Authorization (Bar Tabs)</h2>
          <p className="text-sm text-gray-500 mb-5">Control card pre-authorization behavior for bar tabs, auto-increment thresholds, and tip buffer.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Enable Pre-Auth"
              description="Allow pre-authorization holds when opening bar tabs"
              checked={form.enablePreAuth}
              onChange={v => update('enablePreAuth', v)}
            />
            <ToggleRow
              label="Auto-Increment Enabled"
              description="Automatically request additional authorization when tab approaches hold limit"
              checked={form.autoIncrementEnabled}
              onChange={v => update('autoIncrementEnabled', v)}
              border
            />
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
            <NumberRow
              label="Default Pre-Auth Amount"
              description="Initial hold amount when a tab is opened with a card"
              value={form.defaultPreAuthAmount}
              onChange={v => update('defaultPreAuthAmount', v)}
              prefix="$"
              min={1}
              max={9999}
            />
            <NumberRow
              label="Pre-Auth Expiration"
              description="Days before an unused pre-auth hold automatically releases"
              value={form.preAuthExpirationDays}
              onChange={v => update('preAuthExpirationDays', v)}
              suffix="days"
              min={1}
              max={30}
            />
            <NumberRow
              label="Increment Threshold"
              description="Fire auto-increment when tab reaches this % of the current hold"
              value={form.incrementThresholdPercent}
              onChange={v => update('incrementThresholdPercent', v)}
              suffix="%"
              min={50}
              max={100}
            />
            <NumberRow
              label="Increment Amount"
              description="Fixed dollar amount for each incremental authorization"
              value={form.incrementAmount}
              onChange={v => update('incrementAmount', v)}
              prefix="$"
              min={5}
              max={500}
            />
            <NumberRow
              label="Tip Buffer"
              description="Extra % added to hold to cover a potential tip (0 = disabled)"
              value={form.incrementTipBufferPercent}
              onChange={v => update('incrementTipBufferPercent', v)}
              suffix="%"
              min={0}
              max={100}
            />
            <NumberRow
              label="Max Tab Alert"
              description="Alert the manager when any tab exceeds this dollar amount"
              value={form.maxTabAlertAmount}
              onChange={v => update('maxTabAlertAmount', v)}
              prefix="$"
              min={0}
              max={99999}
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 5: Signature & Receipts
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Signature & Receipts</h2>
          <p className="text-sm text-gray-500 mb-5">Configure signature requirements and digital receipt retention.</p>

          <div className="space-y-4">
            <NumberRow
              label="Require Signature Above"
              description="Transactions over this dollar amount require a customer signature"
              value={form.requireSignatureAbove}
              onChange={v => update('requireSignatureAbove', v)}
              prefix="$"
              min={0}
              max={999}
            />
            <NumberRow
              label="Digital Receipt Retention"
              description="Days to keep digital receipts on the local server before archiving"
              value={form.digitalReceiptRetentionDays}
              onChange={v => update('digitalReceiptRetentionDays', v)}
              suffix="days"
              min={7}
              max={365}
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 6: Walkout Recovery
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Walkout Recovery</h2>
          <p className="text-sm text-gray-500 mb-5">Automatically detect and attempt to recover unpaid walkout tabs.</p>

          <ToggleRow
            label="Enable Walkout Retry"
            description="Automatically retry charging walkout tabs on file"
            checked={form.walkoutRetryEnabled}
            onChange={v => update('walkoutRetryEnabled', v)}
          />

          {form.walkoutRetryEnabled && (
            <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
              <NumberRow
                label="Retry Frequency"
                description="Days between automatic retry attempts"
                value={form.walkoutRetryFrequencyDays}
                onChange={v => update('walkoutRetryFrequencyDays', v)}
                suffix="days"
                min={1}
                max={30}
              />
              <NumberRow
                label="Max Retry Duration"
                description="Stop retrying after this many days"
                value={form.walkoutMaxRetryDays}
                onChange={v => update('walkoutMaxRetryDays', v)}
                suffix="days"
                min={1}
                max={365}
              />
              <NumberRow
                label="Auto-Detect Timeout"
                description="Mark a tab as walkout if idle for this many minutes"
                value={form.walkoutAutoDetectMinutes}
                onChange={v => update('walkoutAutoDetectMinutes', v)}
                suffix="min"
                min={30}
                max={1440}
              />
            </div>
          )}
        </section>

        {/* ═══════════════════════════════════════════
            Card 7: Card Recognition
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Card Recognition</h2>
          <p className="text-sm text-gray-500 mb-5">Track repeat customers by card token to personalize the experience.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Enable Card Recognition"
              description="Recognize repeat customers by their payment card"
              checked={form.cardRecognitionEnabled}
              onChange={v => update('cardRecognitionEnabled', v)}
            />
            <ToggleRow
              label="Show Welcome-Back Toast"
              description="Display a toast notification when a recognized customer returns"
              checked={form.cardRecognitionToastEnabled}
              onChange={v => update('cardRecognitionToastEnabled', v)}
              border
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 8: Bottle Service
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Bottle Service</h2>
          <p className="text-sm text-gray-500 mb-5">Configure bottle service tab type, auto-gratuity, and minimum spend enforcement.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Enable Bottle Service"
              description="Allow bottle service tabs with deposit pre-auth and tier management"
              checked={form.bottleServiceEnabled}
              onChange={v => update('bottleServiceEnabled', v)}
            />
          </div>

          {form.bottleServiceEnabled && (
            <>
              <div className="mt-4 pt-4 border-t border-gray-100 space-y-0">
                <ToggleRow
                  label="Re-Auth Alert"
                  description="Alert the bartender when a bottle service tab reaches the deposit amount"
                  checked={form.bottleServiceReAuthAlertEnabled}
                  onChange={v => update('bottleServiceReAuthAlertEnabled', v)}
                />
                <ToggleRow
                  label="Enforce Minimum Spend"
                  description="Require manager override to close a bottle service tab under the minimum spend"
                  checked={form.bottleServiceMinSpendEnforced}
                  onChange={v => update('bottleServiceMinSpendEnforced', v)}
                  border
                />
              </div>

              <div className="mt-4 pt-4 border-t border-gray-100">
                <NumberRow
                  label="Auto-Gratuity"
                  description="Default automatic gratuity percentage for bottle service tabs"
                  value={form.bottleServiceAutoGratuityPercent}
                  onChange={v => update('bottleServiceAutoGratuityPercent', v)}
                  suffix="%"
                  min={0}
                  max={100}
                />
              </div>
            </>
          )}
        </section>

        {/* Sticky save bar */}
        <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} />
      </div>
    </div>
  )
}
