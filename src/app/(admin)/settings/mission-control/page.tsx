'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow, NumberRow, SettingsSaveBar } from '@/components/admin/settings'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import type { PaymentSettings } from '@/lib/settings'
import { Button } from '@/components/ui/button'

const PROCESSOR_OPTIONS: { value: PaymentSettings['processor']; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'No card processing -- cash only' },
  { value: 'datacap', label: 'Datacap', description: 'Datacap Direct integration for live card processing' },
]

export default function MissionControlSettingsPage() {
  const { employee } = useRequireAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [form, setForm] = useState<PaymentSettings | null>(null)
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

  // NUC Registration state
  const [regCode, setRegCode] = useState<string | null>(null)
  const [regStatus, setRegStatus] = useState<'none' | 'active' | 'expired' | 'used' | 'revoked'>('none')
  const [regExpiresAt, setRegExpiresAt] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)

  useUnsavedWarning(isDirty)

  const locationId = employee?.location?.id

  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
        setForm(data.settings.payments)
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

  // Load NUC registration status
  useEffect(() => {
    if (!locationId) return
    ;(async () => {
      try {
        const res = await fetch(`/api/registration/code?locationId=${locationId}`)
        if (res.ok) {
          const { data } = await res.json()
          setRegCode(data.code)
          setRegStatus(data.status || 'none')
          setRegExpiresAt(data.expiresAt)
        }
      } catch {
        // Not critical
      }
    })()
  }, [locationId])

  // Load batch info when processor is datacap
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
      // Batch status not critical
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
      loadBatchInfo(activeReaderId)
    } catch (err) {
      toast.error(`Failed to close batch: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setBatchClosing(false)
    }
  }

  const handleGenerateCode = async () => {
    if (!locationId) return
    setIsGenerating(true)
    try {
      const res = await fetch('/api/registration/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId }),
      })
      if (!res.ok) throw new Error('Failed to generate code')
      const { data } = await res.json()
      setRegCode(data.code)
      setRegStatus('active')
      setRegExpiresAt(data.expiresAt)
      toast.success('Registration code generated')
    } catch {
      toast.error('Failed to generate registration code')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCopyCode = () => {
    if (regCode) {
      navigator.clipboard.writeText(regCode)
      toast.success('Code copied')
    }
  }

  const handleSave = async () => {
    if (!form) return
    if (form.processor === 'datacap') {
      if (!form.datacapMerchantId?.trim() || !form.datacapTokenKey?.trim()) {
        toast.error('Merchant ID and Token Key are required for Datacap processing')
        return
      }
    }
    try {
      setIsSaving(true)
      const payload: PaymentSettings = {
        ...form,
        datacapMerchantId: form.datacapMerchantId?.trim(),
        datacapTokenKey: form.datacapTokenKey?.trim(),
        datacapEnvironment: form.datacapEnvironment || 'cert',
      }
      const data = await saveSettingsApi({ payments: payload }, employee?.id)
      setForm(data.settings.payments)
      setIsDirty(false)
      toast.success('Settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const update = <K extends keyof PaymentSettings>(key: K, value: PaymentSettings[K]) => {
    setForm(prev => prev ? { ...prev, [key]: value } : prev)
    setIsDirty(true)
  }

  const formatExpiry = (iso: string) => {
    const diff = new Date(iso).getTime() - Date.now()
    if (diff <= 0) return 'Expired'
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''}`
    const hrs = Math.floor(mins / 60)
    return `${hrs} hour${hrs !== 1 ? 's' : ''}`
  }

  if (isLoading || !form) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Mission Control"
          subtitle="Loading..."
          breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        />
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-700 text-lg">Loading...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Mission Control"
        subtitle="Internal configuration for card processing, credentials, and infrastructure. These settings are managed by GWI support — not visible to venue operators."
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

        {/* Card Processing */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Card Processing</h2>
          <p className="text-sm text-gray-600 mb-5">Configure the card payment processor and reader behavior.</p>

          <label className="block text-sm font-medium text-gray-700 mb-2">Processor</label>
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
                <div className="text-xs text-gray-600 mt-0.5">{opt.description}</div>
              </button>
            ))}
          </div>

          <div className="space-y-0 border-t border-gray-100">
            <ToggleRow
              label="Test Mode"
              description="Process test transactions with no real charges. Turn OFF when ready to go live."
              checked={form.testMode}
              onChange={v => update('testMode', v)}
            />
            <ToggleRow
              label="Auto-Swap on Failure"
              description="Prompt staff to switch to a backup payment reader if this one goes offline."
              checked={form.autoSwapOnFailure}
              onChange={v => update('autoSwapOnFailure', v)}
              border
            />
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100">
            <NumberRow
              label="Reader Timeout"
              description="How long to wait for the card reader before canceling the transaction."
              value={form.readerTimeoutSeconds}
              onChange={v => update('readerTimeoutSeconds', v)}
              suffix="sec"
              min={5}
              max={120}
            />
          </div>
        </section>

        {/* Datacap Credentials */}
        {form.processor === 'datacap' && (
          <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-semibold text-gray-900">Datacap Credentials</h2>
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
                  Configured (Test Mode)
                </span>
              )}
            </div>
            <p className="text-sm text-gray-600 mb-5">Enter the Datacap credentials provided for this venue.</p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Merchant ID (MID)</label>
                <p className="text-xs text-gray-600 mb-1">Your unique account number from Datacap.</p>
                <input
                  type="text"
                  value={form.datacapMerchantId || ''}
                  onChange={e => update('datacapMerchantId', e.target.value)}
                  placeholder="Provided by Datacap"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

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
                      Test Mode (no real charges)
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">Transactions processed in test mode</div>
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
                    <div className="text-xs text-gray-600 mt-0.5">Real card charges</div>
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

        {/* Batch Management */}
        {form.processor === 'datacap' && (
          <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Batch Management</h2>
            <p className="text-sm text-gray-600 mb-5">Close the current batch to settle card transactions.</p>

            {batchLoading ? (
              <div className="text-sm text-gray-700 py-4">Loading batch status...</div>
            ) : batchInfo ? (
              <div className="space-y-3 mb-5">
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-600">Current Batch</span>
                  <span className="text-sm font-medium text-gray-900">#{batchInfo.batchNo || '\u2014'}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-600">Transactions</span>
                  <span className="text-sm font-medium text-gray-900">{batchInfo.transactionCount ?? '\u2014'}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <div>
                    <span className="text-sm text-gray-700">SAF (Store and Forward)</span>
                    <p className="text-xs text-gray-600">Payments saved offline, waiting to be sent to the bank.</p>
                  </div>
                  <span className={`text-sm font-medium flex-shrink-0 ml-4 ${batchInfo.hasSAFPending ? 'text-amber-600' : 'text-gray-900'}`}>
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
              <div className="text-sm text-gray-700 py-4">No payment reader configured.</div>
            ) : (
              <div className="text-sm text-gray-700 py-4">Unable to load batch status.</div>
            )}

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

        {/* NUC Registration */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold text-gray-900">NUC Registration</h2>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              regStatus === 'active' ? 'bg-green-100 text-green-700' :
              regStatus === 'expired' ? 'bg-red-100 text-red-700' :
              regStatus === 'used' ? 'bg-gray-200 text-gray-600' :
              'bg-gray-100 text-gray-500'
            }`}>
              {regStatus === 'active' ? 'Active' :
               regStatus === 'expired' ? 'Expired' :
               regStatus === 'used' ? 'Used' :
               regStatus === 'revoked' ? 'Revoked' :
               'No Code'}
            </span>
          </div>
          <p className="text-sm text-gray-600 mb-5">Generate a code for NUC installation. Used by IT / support only.</p>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-gray-50 border rounded px-4 py-3 font-mono text-2xl tracking-widest text-center select-all">
                {regCode || '\u2014'}
              </div>
              {regCode && regStatus === 'active' && (
                <Button variant="outline" onClick={handleCopyCode} className="shrink-0">
                  Copy
                </Button>
              )}
            </div>

            {regExpiresAt && regStatus === 'active' && (
              <p className="text-sm text-gray-600">
                Expires in {formatExpiry(regExpiresAt)}
              </p>
            )}
            {regStatus === 'expired' && (
              <p className="text-sm text-red-500">Code has expired. Generate a new one.</p>
            )}

            <Button
              variant={regStatus === 'active' ? 'outline' : 'primary'}
              onClick={handleGenerateCode}
              disabled={isGenerating}
              isLoading={isGenerating}
              className="w-full"
            >
              {isGenerating ? 'Generating...' :
               regStatus === 'active' ? 'Regenerate Code' : 'Generate Code'}
            </Button>

            <details className="text-xs text-gray-600">
              <summary className="cursor-pointer hover:text-gray-700">Show for IT</summary>
              <p className="mt-2">
                Use this code during NUC installation:{' '}
                <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700">
                  curl -fsSL https://app.thepasspos.com/installer.run -o installer.run && chmod +x installer.run && sudo ./installer.run
                </code>
              </p>
            </details>
          </div>
        </section>

        <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} />
      </div>
    </div>
  )
}
