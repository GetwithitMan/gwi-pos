'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/stores/toast-store'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import { SettingsSaveBar } from '@/components/admin/settings/SettingsSaveBar'
import { ToggleRow } from '@/components/admin/settings/ToggleRow'
import type { SevenShiftsSettings } from '@/lib/settings'
import { DEFAULT_SEVEN_SHIFTS_SETTINGS } from '@/lib/settings'
import { useAuthStore } from '@/stores/auth-store'
import Link from 'next/link'

interface SevenShiftsStatus {
  configured: boolean
  enabled: boolean
  environment: string
  companyId: number | null
  locationId: number | null
  webhooksRegistered?: boolean
  employeesLinked?: number
}

interface PreSyncCheck {
  businessDate: string
  issues: {
    unmappedEmployeesWithPunches: Array<{ employeeId: string; name: string; punchCount: number }>
    openPunches: Array<{ entryId: string; employeeName: string; clockIn: string }>
    missingHourlyRates: Array<{ employeeId: string; name: string }>
    breakAnomalies: Array<{ entryId: string; employeeName: string; shiftHours: number; breakMinutes: number; required: number }>
  }
  counts: {
    totalPunches: number
    readyPunches: number
    alreadyPushed: number
    willSkip: number
  }
  isReadyToSync: boolean
  lastPushAt: string | null
  lastPushStatus: string | null
}

export default function SevenShiftsIntegrationPage() {
  const employee = useAuthStore(s => s.employee)
  const [status, setStatus] = useState<SevenShiftsStatus | null>(null)
  const [preSyncCheck, setPreSyncCheck] = useState<PreSyncCheck | null>(null)
  const [preSyncLoading, setPreSyncLoading] = useState(false)
  const [form, setForm] = useState<SevenShiftsSettings>(DEFAULT_SEVEN_SHIFTS_SETTINGS)
  // Server never returns actual secrets — track whether they're set via boolean flags
  const [hasClientSecret, setHasClientSecret] = useState(false)
  const [hasWebhookSecret, setHasWebhookSecret] = useState(false)
  // "Replace secret" fields — only submitted when the user types a new value
  const [replaceClientSecret, setReplaceClientSecret] = useState('')
  const [replaceWebhookSecret, setReplaceWebhookSecret] = useState('')
  const [showClientSecret, setShowClientSecret] = useState(false)
  const [showWebhookSecret, setShowWebhookSecret] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [registeringWebhooks, setRegisteringWebhooks] = useState(false)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [settingsData, statusRes] = await Promise.all([
          loadSettingsApi(),
          fetch('/api/integrations/7shifts/status').then(r => r.json()),
        ])
        const s7 = settingsData.settings?.sevenShifts as (SevenShiftsSettings & { hasClientSecret?: boolean; hasWebhookSecret?: boolean }) | undefined
        if (s7) {
          setForm({ ...DEFAULT_SEVEN_SHIFTS_SETTINGS, ...s7, clientSecret: '', webhookSecret: '' })
          setHasClientSecret(s7.hasClientSecret ?? Boolean(s7.clientSecret))
          setHasWebhookSecret(s7.hasWebhookSecret ?? Boolean(s7.webhookSecret))
        }
        setStatus(statusRes.data ?? null)
      } catch {
        toast.error('Failed to load 7shifts settings')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  // Load pre-sync check
  useEffect(() => {
    async function loadPreSync() {
      if (!employee?.location?.id) return
      setPreSyncLoading(true)
      try {
        const res = await fetch(`/api/integrations/7shifts/pre-sync-check?locationId=${employee.location.id}`)
        if (res.ok) {
          const json = await res.json()
          setPreSyncCheck(json.data ?? null)
        }
      } catch {
        // Silently fail — widget is informational
      } finally {
        setPreSyncLoading(false)
      }
    }
    void loadPreSync()
  }, [employee?.location?.id])

  function update<K extends keyof SevenShiftsSettings>(key: K, value: SevenShiftsSettings[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
    setIsDirty(true)
  }

  function updateSyncOption(key: keyof SevenShiftsSettings['syncOptions'], value: boolean) {
    setForm(prev => ({ ...prev, syncOptions: { ...prev.syncOptions, [key]: value } }))
    setIsDirty(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const payload: SevenShiftsSettings = { ...form }
      if (replaceClientSecret.trim()) payload.clientSecret = replaceClientSecret.trim()
      if (replaceWebhookSecret.trim()) payload.webhookSecret = replaceWebhookSecret.trim()

      await saveSettingsApi({ sevenShifts: payload }, employee?.id)

      if (replaceClientSecret.trim()) { setHasClientSecret(true); setReplaceClientSecret('') }
      if (replaceWebhookSecret.trim()) { setHasWebhookSecret(true); setReplaceWebhookSecret('') }
      setIsDirty(false)
      // Refresh status badge
      const res = await fetch('/api/integrations/7shifts/status').then(r => r.json())
      setStatus(res.data ?? null)
      toast.success('7shifts settings saved')
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    try {
      const res = await fetch('/api/integrations/7shifts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: employee?.id }),
      })
      const data = await res.json()
      if (data.data?.success) {
        toast.success(data.data.message ?? 'Connection successful')
      } else {
        toast.error(data.data?.message ?? 'Connection test failed')
      }
    } catch {
      toast.error('Connection test failed')
    } finally {
      setTesting(false)
    }
  }

  async function handleRegisterWebhooks() {
    setRegisteringWebhooks(true)
    try {
      const res = await fetch('/api/integrations/7shifts/register-webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: employee?.id }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(data.data?.message ?? 'Webhooks registered')
        // Refresh status
        const statusRes = await fetch('/api/integrations/7shifts/status').then(r => r.json())
        setStatus(statusRes.data ?? null)
      } else {
        toast.error(data.error ?? 'Failed to register webhooks')
      }
    } catch {
      toast.error('Failed to register webhooks')
    } finally {
      setRegisteringWebhooks(false)
    }
  }

  async function handleSyncNow() {
    setSyncing(true)
    try {
      const res = await fetch('/api/integrations/7shifts/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: employee?.id }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(data.data?.message ?? 'Sync triggered')
        // Refresh status for updated timestamps
        const statusRes = await fetch('/api/integrations/7shifts/status').then(r => r.json())
        setStatus(statusRes.data ?? null)
        // Also reload settings for updated sync timestamps
        const settingsData = await loadSettingsApi()
        const s7 = settingsData.settings?.sevenShifts
        if (s7) {
          setForm(prev => ({
            ...prev,
            lastSalesPushAt: s7.lastSalesPushAt ?? null,
            lastSalesPushStatus: s7.lastSalesPushStatus ?? null,
            lastSalesPushError: s7.lastSalesPushError ?? null,
            lastPunchPushAt: s7.lastPunchPushAt ?? null,
            lastPunchPushStatus: s7.lastPunchPushStatus ?? null,
            lastPunchPushError: s7.lastPunchPushError ?? null,
            lastSchedulePullAt: s7.lastSchedulePullAt ?? null,
            lastSchedulePullStatus: s7.lastSchedulePullStatus ?? null,
            lastSchedulePullError: s7.lastSchedulePullError ?? null,
          }))
        }
      } else {
        toast.error(data.error ?? 'Sync failed')
      }
    } catch {
      toast.error('Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  function formatTimestamp(ts: string | null) {
    if (!ts) return 'Never'
    try {
      return new Date(ts).toLocaleString()
    } catch {
      return ts
    }
  }

  function syncStatusBadge(status: 'success' | 'error' | null) {
    if (status === 'success') return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Success</span>
    if (status === 'error') return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Error</span>
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Never</span>
  }

  const configured = status?.configured ?? false

  const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="p-6 max-w-4xl mx-auto pb-32">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">7shifts</h1>
          <p className="text-gray-900">
            Connect to 7shifts to push daily sales summaries, sync employee time punches,
            pull schedules, and receive real-time webhooks for labor management.
          </p>
        </div>
        {!loading && (
          <span className={`flex-shrink-0 ml-4 px-3 py-1 rounded-full text-sm font-medium ${
            configured
              ? 'bg-green-100 text-green-800'
              : 'bg-gray-100 text-gray-600'
          }`}>
            {configured ? 'Connected' : 'Not Configured'}
          </span>
        )}
      </div>

      <div className="space-y-6">

        {/* What This Integration Does */}
        <Card>
          <CardHeader><CardTitle>What This Integration Does</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">&#8226;</span>
                <span><strong>Daily Sales Push</strong> — Sends end-of-day sales totals (net sales, tax, discounts, tips) to 7shifts so labor cost % is calculated automatically.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">&#8226;</span>
                <span><strong>Time Punch Sync</strong> — Pushes employee clock-in/clock-out punches from GWI POS to 7shifts, keeping timesheets in sync without double-entry.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">&#8226;</span>
                <span><strong>Schedule Pull</strong> — Pulls published schedules from 7shifts so managers can view who&apos;s scheduled directly inside GWI POS.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">&#8226;</span>
                <span><strong>Webhooks</strong> — Receives real-time notifications from 7shifts when shifts are published, swapped, or employees are updated.</span>
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* Enable toggle + Connection status */}
        <Card>
          <CardHeader><CardTitle>Connection</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <ToggleRow
              label="Enable 7shifts Integration"
              description="Turn on 7shifts sync. Credentials must be configured below before enabling."
              checked={form.enabled}
              onChange={v => update('enabled', v)}
            />

            <div className="flex items-center justify-between pt-2 border-t">
              <div className="space-y-1">
                <span className="text-sm text-gray-600">Connection status</span>
                <div className={`text-sm font-medium ${configured ? 'text-green-700' : 'text-yellow-700'}`}>
                  {loading ? 'Checking...' : configured ? `Connected — ${(status?.environment ?? 'sandbox').toUpperCase()} (Company ${status?.companyId})` : 'Not configured'}
                </div>
              </div>
              <Button
                onClick={handleTest}
                disabled={!configured || testing}
                variant="outline"
                size="sm"
                title={!configured ? 'Save your credentials below first, then test the connection.' : 'Test live connection to 7shifts API'}
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
          <CardHeader><CardTitle>API Credentials</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
              These credentials come from your 7shifts developer app. Create an OAuth application
              in 7shifts Developer Portal to get your Client ID and Client Secret.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Client ID</label>
                <input
                  type="text"
                  value={form.clientId}
                  onChange={e => update('clientId', e.target.value)}
                  placeholder="your-7shifts-client-id"
                  className={inputClass}
                />
                <p className="text-xs text-gray-900 mt-1">OAuth Client ID from 7shifts Developer Portal</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Client Secret</label>
                {hasClientSecret && (
                  <div className="flex items-center gap-1.5 text-xs text-green-700 mb-1.5">
                    <span>&#10003; Secret configured</span>
                  </div>
                )}
                <div className="relative">
                  <input
                    type={showClientSecret ? 'text' : 'password'}
                    value={replaceClientSecret}
                    onChange={e => { setReplaceClientSecret(e.target.value); setIsDirty(true) }}
                    placeholder={hasClientSecret ? 'Enter new secret to replace...' : 'Enter client secret...'}
                    autoComplete="new-password"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => setShowClientSecret(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-900 hover:text-gray-900"
                  >
                    {showClientSecret ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p className="text-xs text-gray-900 mt-1">OAuth Client Secret — write-only, never displayed after saving</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Company ID</label>
                <input
                  type="number"
                  value={form.companyId || ''}
                  onChange={e => update('companyId', parseInt(e.target.value) || 0)}
                  placeholder="123456"
                  className={inputClass}
                />
                <p className="text-xs text-gray-900 mt-1">Your 7shifts numeric company ID</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Company GUID</label>
                <input
                  type="text"
                  value={form.companyGuid}
                  onChange={e => update('companyGuid', e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className={inputClass}
                />
                <p className="text-xs text-gray-900 mt-1">UUID — required as x-company-guid header on every API call</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">7shifts Location ID</label>
                <input
                  type="number"
                  value={form.locationId7s || ''}
                  onChange={e => update('locationId7s', parseInt(e.target.value) || 0)}
                  placeholder="789012"
                  className={inputClass}
                />
                <p className="text-xs text-gray-900 mt-1">The 7shifts location ID that maps to this GWI POS venue</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Webhook Secret</label>
                {hasWebhookSecret && (
                  <div className="flex items-center gap-1.5 text-xs text-green-700 mb-1.5">
                    <span>&#10003; Secret configured</span>
                  </div>
                )}
                <div className="relative">
                  <input
                    type={showWebhookSecret ? 'text' : 'password'}
                    value={replaceWebhookSecret}
                    onChange={e => { setReplaceWebhookSecret(e.target.value); setIsDirty(true) }}
                    placeholder={hasWebhookSecret ? 'Enter new secret to replace...' : 'Enter webhook secret...'}
                    autoComplete="new-password"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => setShowWebhookSecret(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-900 hover:text-gray-900"
                  >
                    {showWebhookSecret ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p className="text-xs text-gray-900 mt-1">Shared secret for verifying incoming webhook payloads</p>
              </div>
            </div>

            {/* Environment */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">Environment</label>
              <div className="flex gap-3">
                {(['sandbox', 'production'] as const).map(env => (
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
                    {env === 'sandbox' ? 'Sandbox' : 'Production (Live)'}
                  </button>
                ))}
              </div>
              {form.environment === 'production' && (
                <p className="text-xs text-amber-600 mt-2 font-medium">Production mode — data will sync with live 7shifts account.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Sync Options */}
        <Card>
          <CardHeader><CardTitle>Sync Options</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <ToggleRow
              label="Push Daily Sales"
              description="Send end-of-day sales totals to 7shifts for labor cost tracking."
              checked={form.syncOptions.pushSales}
              onChange={v => updateSyncOption('pushSales', v)}
            />
            <ToggleRow
              label="Push Time Punches"
              description="Sync employee clock-in/clock-out punches to 7shifts timesheets."
              checked={form.syncOptions.pushTimePunches}
              onChange={v => updateSyncOption('pushTimePunches', v)}
            />
            <ToggleRow
              label="Pull Schedule"
              description="Pull published schedules from 7shifts into GWI POS."
              checked={form.syncOptions.pullSchedule}
              onChange={v => updateSyncOption('pullSchedule', v)}
            />
          </CardContent>
        </Card>

        {/* Last Sync Status */}
        <Card>
          <CardHeader><CardTitle>Last Sync Status</CardTitle></CardHeader>
          <CardContent>
            <div className="divide-y">
              {([
                { label: 'Sales', at: form.lastSalesPushAt, status: form.lastSalesPushStatus, error: form.lastSalesPushError },
                { label: 'Time Punches', at: form.lastPunchPushAt, status: form.lastPunchPushStatus, error: form.lastPunchPushError },
                { label: 'Schedule', at: form.lastSchedulePullAt, status: form.lastSchedulePullStatus, error: form.lastSchedulePullError },
              ] as const).map(row => (
                <div key={row.label} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium text-gray-900">{row.label}</div>
                    <div className="text-xs text-gray-900">{formatTimestamp(row.at)}</div>
                    {row.status === 'error' && row.error && (
                      <div className="text-xs text-red-600">{row.error}</div>
                    )}
                  </div>
                  {syncStatusBadge(row.status)}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Sync Readiness */}
        <Card>
          <CardHeader><CardTitle>Sync Readiness</CardTitle></CardHeader>
          <CardContent>
            {preSyncLoading ? (
              <p className="text-sm text-gray-900">Checking sync readiness...</p>
            ) : !preSyncCheck ? (
              <p className="text-sm text-gray-900">Unable to load pre-sync check.</p>
            ) : (() => {
              const { issues, counts, isReadyToSync, businessDate } = preSyncCheck
              const hasBlockers = issues.openPunches.length > 0 || issues.unmappedEmployeesWithPunches.length > 0
              const hasWarnings = issues.missingHourlyRates.length > 0 || issues.breakAnomalies.length > 0

              const color = isReadyToSync && !hasWarnings
                ? 'border-green-200 bg-green-50'
                : hasBlockers
                  ? 'border-red-200 bg-red-50'
                  : 'border-amber-200 bg-amber-50'

              return (
                <div className="space-y-3">
                  <p className="text-xs text-gray-900">Business date: {businessDate}</p>

                  <div className={`rounded-lg border p-3 ${color}`}>
                    {isReadyToSync && !hasWarnings ? (
                      <p className="text-sm text-green-800 font-medium">
                        &#10003; {counts.readyPunches} punches ready to sync
                        {counts.alreadyPushed > 0 && ` (${counts.alreadyPushed} already pushed)`}
                      </p>
                    ) : (
                      <div className="space-y-2 text-sm">
                        {issues.unmappedEmployeesWithPunches.length > 0 && (
                          <div className="text-red-800">
                            <span className="font-medium">&#9888; {issues.unmappedEmployeesWithPunches.length} unmapped employee(s) with punches:</span>
                            <ul className="ml-4 mt-1 text-xs space-y-0.5">
                              {issues.unmappedEmployeesWithPunches.map(e => (
                                <li key={e.employeeId}>{e.name} ({e.punchCount} punch{e.punchCount > 1 ? 'es' : ''})</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {issues.openPunches.length > 0 && (
                          <div className="text-red-800">
                            <span className="font-medium">&#9888; {issues.openPunches.length} open punch(es) — missing clock-out</span>
                          </div>
                        )}
                        {issues.missingHourlyRates.length > 0 && (
                          <div className="text-amber-800">
                            <span className="font-medium">&#9888; {issues.missingHourlyRates.length} employee(s) missing hourly rates</span>
                          </div>
                        )}
                        {issues.breakAnomalies.length > 0 && (
                          <div className="text-amber-800">
                            <span className="font-medium">&#9888; {issues.breakAnomalies.length} break anomal{issues.breakAnomalies.length > 1 ? 'ies' : 'y'}</span>
                          </div>
                        )}
                        {counts.readyPunches > 0 && (
                          <p className="text-gray-600 pt-1 border-t">
                            {counts.readyPunches} punch{counts.readyPunches > 1 ? 'es' : ''} ready
                            {counts.willSkip > 0 && `, ${counts.willSkip} will be skipped`}
                            {counts.alreadyPushed > 0 && `, ${counts.alreadyPushed} already pushed`}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}
          </CardContent>
        </Card>

        {/* Actions */}
        <Card>
          <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
          <CardContent className="flex gap-3">
            <Button
              onClick={handleRegisterWebhooks}
              disabled={!configured || registeringWebhooks}
              variant="outline"
              size="sm"
            >
              {registeringWebhooks ? 'Registering...' : 'Register Webhooks'}
            </Button>
            <Button
              onClick={handleSyncNow}
              disabled={!configured || syncing}
              variant="outline"
              size="sm"
            >
              {syncing ? 'Syncing...' : 'Sync Now'}
            </Button>
          </CardContent>
        </Card>

        {/* Setup Checklist */}
        <Card>
          <CardHeader><CardTitle>Setup Checklist</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <span className={hasClientSecret && form.companyId > 0 && form.companyGuid ? 'text-green-600' : 'text-gray-900'}>
                  {hasClientSecret && form.companyId > 0 && form.companyGuid ? '&#10003;' : '&#10007;'}
                </span>
                <span className="text-gray-900">Credentials configured</span>
              </li>
              <li className="flex items-center gap-2">
                <span className={status?.webhooksRegistered ? 'text-green-600' : 'text-gray-900'}>
                  {status?.webhooksRegistered ? '&#10003;' : '&#10007;'}
                </span>
                <span className="text-gray-900">Webhooks registered</span>
              </li>
              <li className="flex items-center gap-2">
                <span className={(status?.employeesLinked ?? 0) > 0 ? 'text-green-600' : 'text-gray-900'}>
                  {(status?.employeesLinked ?? 0) > 0 ? '&#10003;' : '&#10007;'}
                </span>
                <span className="text-gray-900">
                  Employees linked
                  {(status?.employeesLinked ?? 0) > 0 && ` (${status!.employeesLinked})`}
                </span>
                <Link href="/settings/integrations/7shifts/employees" className="text-blue-600 text-xs hover:underline ml-auto">
                  Manage
                </Link>
              </li>
            </ul>

            <div className="mt-4 rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
              Credentials are stored securely in the POS database on your local server — they are
              never sent to Neon cloud or any third party other than 7shifts.
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
