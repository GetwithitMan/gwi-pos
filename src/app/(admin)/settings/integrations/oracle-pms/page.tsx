'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/stores/toast-store'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import { SettingsSaveBar } from '@/components/admin/settings/SettingsSaveBar'
import { ToggleRow } from '@/components/admin/settings/ToggleRow'
import type { HotelPmsSettings } from '@/lib/settings'
import { DEFAULT_HOTEL_PMS_SETTINGS } from '@/lib/settings'
import { useAuthStore } from '@/stores/auth-store'

interface OracleStatus {
  configured: boolean
  enabled: boolean
  environment: string
  hotelId: string | null
  chargeCode: string | null
}

export default function OraclePmsIntegrationPage() {
  const employee = useAuthStore(s => s.employee)
  const [status, setStatus] = useState<OracleStatus | null>(null)
  const [form, setForm] = useState<HotelPmsSettings>(DEFAULT_HOTEL_PMS_SETTINGS)
  // P0.1: Server never returns actual secrets — track whether they're set via boolean flags
  const [hasClientSecret, setHasClientSecret] = useState(false)
  const [hasAppKey, setHasAppKey] = useState(false)
  // "Replace secret" fields — only submitted when the user types a new value
  const [replaceClientSecret, setReplaceClientSecret] = useState('')
  const [replaceAppKey, setReplaceAppKey] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [settingsData, statusRes] = await Promise.all([
          loadSettingsApi(),
          fetch('/api/integrations/oracle-pms/status').then(r => r.json()),
        ])
        const pms = settingsData.settings?.hotelPms as (HotelPmsSettings & { hasClientSecret?: boolean; hasAppKey?: boolean }) | undefined
        if (pms) {
          setForm({ ...DEFAULT_HOTEL_PMS_SETTINGS, ...pms, clientSecret: '', appKey: '' })
          setHasClientSecret(pms.hasClientSecret ?? Boolean(pms.clientSecret))
          setHasAppKey(pms.hasAppKey ?? Boolean(pms.appKey))
        }
        setStatus(statusRes.data ?? null)
      } catch {
        toast.error('Failed to load Oracle PMS settings')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  function update<K extends keyof HotelPmsSettings>(key: K, value: HotelPmsSettings[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
    setIsDirty(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      // P0.1: Only include secrets in payload if the user typed a new value.
      // Empty strings are omitted so the server preserves the existing secret.
      const payload: HotelPmsSettings = { ...form }
      if (replaceClientSecret.trim()) payload.clientSecret = replaceClientSecret.trim()
      if (replaceAppKey.trim()) payload.appKey = replaceAppKey.trim()

      await saveSettingsApi({ hotelPms: payload }, employee?.id)

      // Update secret status flags based on what was just saved
      if (replaceClientSecret.trim()) { setHasClientSecret(true); setReplaceClientSecret('') }
      if (replaceAppKey.trim()) { setHasAppKey(true); setReplaceAppKey('') }
      setIsDirty(false)
      // Refresh status badge
      const res = await fetch('/api/integrations/oracle-pms/status').then(r => r.json())
      setStatus(res.data ?? null)
      toast.success('Oracle PMS settings saved')
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    try {
      const res = await fetch('/api/integrations/oracle-pms/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: employee?.id }),
      })
      const data = await res.json()
      if (data.data?.success) {
        toast.success(data.data.message)
      } else {
        toast.error(data.data?.message ?? 'Connection test failed')
      }
    } catch {
      toast.error('Connection test failed')
    } finally {
      setTesting(false)
    }
  }

  const configured = status?.configured ?? false

  return (
    <div className="p-6 max-w-4xl mx-auto pb-32">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Oracle Hotel PMS</h1>
          <p className="text-gray-900">
            Connect to Oracle OPERA Cloud to allow guests to charge restaurant bills directly
            to their hotel room. Requires an active OHIP (Oracle Hospitality Integration Platform)
            subscription and app registration.
          </p>
        </div>
        {!loading && (
          <span className={`flex-shrink-0 ml-4 px-3 py-1 rounded-full text-sm font-medium ${
            configured
              ? 'bg-green-100 text-green-800'
              : 'bg-yellow-100 text-yellow-800'
          }`}>
            {configured ? 'Connected' : 'Not Configured'}
          </span>
        )}
      </div>

      <div className="space-y-6">

        {/* What this does */}
        <Card>
          <CardHeader><CardTitle>What This Integration Does</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">&#8226;</span>
                <span><strong>Bill to Room</strong> — Cashier selects &quot;Bill to Room&quot; at checkout, enters the guest&apos;s room number or last name, confirms their identity, and the charge posts directly to their hotel folio in Oracle OPERA.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">&#8226;</span>
                <span><strong>Live Guest Lookup</strong> — Looks up in-house reservations in real time. Only guests currently checked in can be charged — no accidental charges to departed guests.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">&#8226;</span>
                <span><strong>Folio Integration</strong> — Charges appear on the guest&apos;s hotel bill under your configured F&amp;B charge code and show the order number as reference.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">&#8226;</span>
                <span><strong>Local Record</strong> — Every Bill to Room payment is recorded in GWI POS with the room number, guest name, and OPERA transaction number for full reconciliation.</span>
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* Enable toggle + Connection status */}
        <Card>
          <CardHeader><CardTitle>Connection</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <ToggleRow
              label="Enable Oracle PMS Integration"
              description="Turn on Bill to Room as a payment option. Credentials must be configured below before enabling."
              checked={form.enabled}
              onChange={v => update('enabled', v)}
            />

            <div className="flex items-center justify-between pt-2 border-t">
              <div className="space-y-1">
                <span className="text-sm text-gray-600">Connection status</span>
                <div className={`text-sm font-medium ${configured ? 'text-green-700' : 'text-yellow-700'}`}>
                  {loading ? 'Checking...' : configured ? `Connected — ${status?.environment?.toUpperCase()} (${status?.hotelId})` : 'Not configured'}
                </div>
              </div>
              <Button
                onClick={handleTest}
                disabled={!configured || testing}
                variant="outline"
                size="sm"
                title={!configured ? 'Save your credentials below first, then test the connection.' : 'Test live connection to OPERA Cloud'}
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </Button>
            </div>
            {!configured && !loading && (
              <p className="text-xs text-gray-900">Enter your credentials below and save before testing.</p>
            )}
          </CardContent>
        </Card>

        {/* Credentials */}
        <Card>
          <CardHeader><CardTitle>OPERA Cloud Credentials</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
              These credentials come from your Oracle OHIP app registration. You&apos;ll need to register
              your integration at the Oracle Cloud Marketplace / OHIP developer portal and get approval
              from your hotel&apos;s OPERA administrator before going live.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">API Base URL</label>
                <input
                  type="url"
                  value={form.baseUrl}
                  onChange={e => update('baseUrl', e.target.value)}
                  placeholder="https://your-property.oraclehospitality.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-900 mt-1">Your OPERA Cloud instance URL (no trailing slash)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Hotel ID</label>
                <input
                  type="text"
                  value={form.hotelId}
                  onChange={e => update('hotelId', e.target.value)}
                  placeholder="HOTEL1"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-900 mt-1">The property code in OPERA (x-hotelid)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Client ID</label>
                <input
                  type="text"
                  value={form.clientId}
                  onChange={e => update('clientId', e.target.value)}
                  placeholder="your-ohip-client-id"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-900 mt-1">OAuth client ID from OHIP app registration</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Client Secret</label>
                {hasClientSecret && (
                  <div className="flex items-center gap-1.5 text-xs text-green-700 mb-1.5">
                    <span>✓ Secret configured</span>
                  </div>
                )}
                <input
                  type="password"
                  value={replaceClientSecret}
                  onChange={e => { setReplaceClientSecret(e.target.value); setIsDirty(true) }}
                  placeholder={hasClientSecret ? 'Enter new secret to replace…' : 'Enter client secret…'}
                  autoComplete="new-password"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-900 mt-1">OAuth client secret — write-only, never displayed after saving</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Application Key</label>
                {hasAppKey && (
                  <div className="flex items-center gap-1.5 text-xs text-green-700 mb-1.5">
                    <span>✓ Key configured</span>
                  </div>
                )}
                <input
                  type="password"
                  value={replaceAppKey}
                  onChange={e => { setReplaceAppKey(e.target.value); setIsDirty(true) }}
                  placeholder={hasAppKey ? 'Enter new key to replace…' : 'Enter application key…'}
                  autoComplete="new-password"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-900 mt-1">x-app-key — write-only, never displayed after saving</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">F&amp;B Charge Code</label>
                <input
                  type="text"
                  value={form.chargeCode}
                  onChange={e => update('chargeCode', e.target.value)}
                  placeholder="REST01"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-900 mt-1">Transaction code configured in OPERA for restaurant charges — ask your hotel team</p>
              </div>
            </div>

            {/* Environment */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">Environment</label>
              <div className="flex gap-3">
                {(['cert', 'production'] as const).map(env => (
                  <button
                    key={env}
                    type="button"
                    onClick={() => update('environment', env)}
                    className={`flex-1 py-2 px-4 rounded-lg border-2 text-sm font-medium transition-colors ${
                      form.environment === env
                        ? env === 'production'
                          ? 'border-green-500 bg-green-50 text-green-800'
                          : 'border-blue-500 bg-blue-50 text-blue-800'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {env === 'cert' ? 'Cert / Sandbox' : 'Production (Live)'}
                  </button>
                ))}
              </div>
              {form.environment === 'production' && (
                <p className="text-xs text-amber-600 mt-2 font-medium">Production mode — charges will post to real guest folios.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Options */}
        <Card>
          <CardHeader><CardTitle>Options</CardTitle></CardHeader>
          <CardContent>
            <ToggleRow
              label="Allow Guest Name Lookup"
              description="Let cashiers search by guest last name in addition to room number. Useful when guests don't know their room number."
              checked={form.allowGuestLookup}
              onChange={v => update('allowGuestLookup', v)}
            />
          </CardContent>
        </Card>

        {/* Setup instructions */}
        <Card>
          <CardHeader><CardTitle>Setup Checklist</CardTitle></CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm text-gray-600 list-decimal list-inside">
              <li>
                Register your integration at the <strong>Oracle Cloud Marketplace</strong> or the
                OHIP developer portal — you&apos;ll get a Client ID, Client Secret, and App Key.
              </li>
              <li>
                Work with the hotel&apos;s OPERA administrator to enable the
                <strong> Cashiering API module</strong> and grant your app permission to post
                folio transactions.
              </li>
              <li>
                Get the <strong>F&amp;B Charge Code</strong> from the hotel&apos;s OPERA setup —
                this is the transaction code that will appear on the guest&apos;s bill
                (e.g. <code className="bg-gray-100 px-1 rounded">REST01</code>).
              </li>
              <li>
                Enter all credentials above, set environment to <strong>Cert</strong>, and
                click <strong>Test Connection</strong> to verify.
              </li>
              <li>
                Once confirmed, switch to <strong>Production</strong>, enable the integration,
                and enable <strong>Bill to Room</strong> under{' '}
                <a href="/settings/payments" className="text-blue-600 hover:underline">
                  Settings → Payments
                </a>.
              </li>
            </ol>
            <div className="mt-4 rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
              Credentials are stored securely in the POS database on your local server — they are
              never sent to Neon cloud or any third party other than Oracle OPERA.
            </div>
          </CardContent>
        </Card>

      </div>

      <SettingsSaveBar
        isDirty={isDirty}
        onSave={handleSave}
        isSaving={saving}
      />
    </div>
  )
}
