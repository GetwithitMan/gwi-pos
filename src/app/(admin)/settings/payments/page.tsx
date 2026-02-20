'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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
  const [showTokenKey, setShowTokenKey] = useState(false)

  // Batch management state
  const [batchInfo, setBatchInfo] = useState<{
    batchNo?: string
    transactionCount?: string
    safCount: number
    safAmount: number
    hasSAFPending: boolean
  } | null>(null)
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchClosing, setBatchClosing] = useState(false)
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false)
  const [lastBatchClose, setLastBatchClose] = useState<string | null>(null)
  const [activeReaderId, setActiveReaderId] = useState<string | null>(null)
  const batchLoadedRef = useRef(false)

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

  const locationId = employee?.location?.id

  // Load active reader + batch info when processor is datacap
  const loadBatchInfo = useCallback(async (readerId: string) => {
    if (!locationId) return
    setBatchLoading(true)
    try {
      const res = await fetch(`/api/datacap/batch?locationId=${locationId}&readerId=${readerId}`)
      if (res.ok) {
        const { data } = await res.json()
        setBatchInfo(data)
      }
    } catch {
      // Batch status not critical — fail silently
    } finally {
      setBatchLoading(false)
    }
  }, [locationId])

  useEffect(() => {
    if (!locationId || form?.processor !== 'datacap' || batchLoadedRef.current) return
    batchLoadedRef.current = true
    ;(async () => {
      try {
        const res = await fetch(`/api/hardware/payment-readers?locationId=${locationId}`)
        if (res.ok) {
          const { data } = await res.json()
          const readers = data.readers || []
          const active = readers.find((r: { isActive: boolean }) => r.isActive) || readers[0]
          if (active) {
            setActiveReaderId(active.id)
            loadBatchInfo(active.id)
          }
        }
      } catch {
        // Reader fetch not critical
      }
    })()
  }, [locationId, form?.processor, loadBatchInfo])

  const handleCloseBatch = async () => {
    if (!locationId || !activeReaderId) return
    setBatchClosing(true)
    setBatchConfirmOpen(false)
    try {
      const res = await fetch('/api/datacap/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, readerId: activeReaderId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Batch close failed (HTTP ${res.status})`)
      }
      setLastBatchClose(new Date().toISOString())
      toast.success('Batch closed successfully')
      // Refresh batch summary
      loadBatchInfo(activeReaderId)
    } catch (err) {
      toast.error(`Failed to close batch: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setBatchClosing(false)
    }
  }

  const handleSave = async () => {
    if (!form) return

    // Validate Datacap credentials when processor is datacap
    if (form.processor === 'datacap') {
      if (!form.datacapMerchantId?.trim() || !form.datacapTokenKey?.trim()) {
        toast.error('Merchant ID and Token Key are required for Datacap processing')
        return
      }
    }

    try {
      setIsSaving(true)

      // Parse array fields
      const parseDollar = tipDollarStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n > 0)
      const parsePercent = tipPercentStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n > 0)

      const payload: PaymentSettings = {
        ...form,
        tipDollarSuggestions: parseDollar.length > 0 ? parseDollar : [1, 2, 3],
        tipPercentSuggestions: parsePercent.length > 0 ? parsePercent : [18, 20, 25],
        datacapMerchantId: form.datacapMerchantId?.trim(),
        datacapTokenKey: form.datacapTokenKey?.trim(),
        datacapEnvironment: form.datacapEnvironment || 'cert',
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
            Card 2b: Datacap Credentials
            ═══════════════════════════════════════════ */}
        {form.processor === 'datacap' && (
          <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-semibold text-gray-900">Datacap Credentials</h2>
              {/* Status badge */}
              {!form.datacapMerchantId?.trim() ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                  Not configured — payments will fail at this venue
                </span>
              ) : form.datacapEnvironment === 'production' ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                  Configured (Production)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                  Configured (Certification)
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mb-5">Enter the Datacap credentials provided for this venue.</p>

            <div className="space-y-4">
              {/* Merchant ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Merchant ID (MID)</label>
                <input
                  type="text"
                  value={form.datacapMerchantId || ''}
                  onChange={e => update('datacapMerchantId', e.target.value)}
                  placeholder="Provided by Datacap"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Token Key */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Token Key</label>
                <div className="relative">
                  <input
                    type={showTokenKey ? 'text' : 'password'}
                    value={form.datacapTokenKey || ''}
                    onChange={e => update('datacapTokenKey', e.target.value)}
                    placeholder="32-character hex key"
                    className="w-full px-3 py-2 pr-10 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTokenKey(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                    aria-label={showTokenKey ? 'Hide token key' : 'Show token key'}
                  >
                    {showTokenKey ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Environment */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Environment</label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => update('datacapEnvironment', 'cert')}
                    className={`flex-1 text-left p-3 rounded-xl border transition-all ${
                      (form.datacapEnvironment || 'cert') === 'cert'
                        ? 'border-indigo-500 bg-indigo-500/20 ring-1 ring-indigo-500/40'
                        : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                    }`}
                  >
                    <div className={`text-sm font-medium ${(form.datacapEnvironment || 'cert') === 'cert' ? 'text-indigo-600' : 'text-gray-700'}`}>
                      Certification (Testing)
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">Transactions processed in test mode</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => update('datacapEnvironment', 'production')}
                    className={`flex-1 text-left p-3 rounded-xl border transition-all ${
                      form.datacapEnvironment === 'production'
                        ? 'border-indigo-500 bg-indigo-500/20 ring-1 ring-indigo-500/40'
                        : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                    }`}
                  >
                    <div className={`text-sm font-medium ${form.datacapEnvironment === 'production' ? 'text-indigo-600' : 'text-gray-700'}`}>
                      Production (Live)
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">Real card charges</div>
                  </button>
                </div>
                {form.datacapEnvironment === 'production' && (
                  <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-medium">
                    Production mode charges real cards.
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

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

        {/* ═══════════════════════════════════════════
            Card 9: Batch Management (Datacap only)
            ═══════════════════════════════════════════ */}
        {form.processor === 'datacap' && (
          <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Batch Management</h2>
            <p className="text-sm text-gray-500 mb-5">View current batch status and close the batch to settle pending transactions.</p>

            {/* Batch summary */}
            {batchLoading ? (
              <div className="text-sm text-gray-400 py-4">Loading batch status...</div>
            ) : batchInfo ? (
              <div className="space-y-3 mb-5">
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-600">Current Batch</span>
                  <span className="text-sm font-medium text-gray-900">#{batchInfo.batchNo || '—'}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-600">Transactions</span>
                  <span className="text-sm font-medium text-gray-900">{batchInfo.transactionCount ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-600">SAF Queue</span>
                  <span className={`text-sm font-medium ${batchInfo.hasSAFPending ? 'text-amber-600' : 'text-gray-900'}`}>
                    {batchInfo.hasSAFPending
                      ? `${batchInfo.safCount} pending ($${batchInfo.safAmount.toFixed(2)})`
                      : 'Clear'}
                  </span>
                </div>
                {lastBatchClose && (
                  <div className="flex items-center justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-600">Last Closed</span>
                    <span className="text-sm font-medium text-gray-900">
                      {new Date(lastBatchClose).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            ) : !activeReaderId ? (
              <div className="text-sm text-gray-400 py-4">No payment reader configured. Add a reader in Hardware Settings.</div>
            ) : (
              <div className="text-sm text-gray-400 py-4">Unable to load batch status.</div>
            )}

            {/* Close Batch button */}
            {activeReaderId && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setBatchConfirmOpen(true)}
                  disabled={batchClosing || batchLoading}
                  className="px-5 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {batchClosing ? 'Closing Batch...' : 'Close Batch'}
                </button>

                {/* Confirmation dialog */}
                {batchConfirmOpen && (
                  <div className="mt-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                    <p className="text-sm text-red-800 font-medium mb-3">
                      Are you sure? This closes the current batch and settles all pending transactions.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleCloseBatch}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700"
                      >
                        Yes, Close Batch
                      </button>
                      <button
                        type="button"
                        onClick={() => setBatchConfirmOpen(false)}
                        className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Sticky save bar */}
        <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} />
      </div>
    </div>
  )
}
