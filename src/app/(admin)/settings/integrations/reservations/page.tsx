'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/stores/toast-store'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import { SettingsSaveBar } from '@/components/admin/settings/SettingsSaveBar'
import { ToggleRow } from '@/components/admin/settings/ToggleRow'
import type { ReservationIntegration, ReservationPlatform, ReservationIntegrationStatusMapping } from '@/lib/settings'
import { DEFAULT_RESERVATION_INTEGRATION, RESERVATION_PLATFORMS } from '@/lib/settings'
import { useAuthStore } from '@/stores/auth-store'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INTERNAL_STATUSES = ['pending', 'confirmed', 'cancelled', 'no_show', 'checked_in', 'seated', 'completed'] as const

function maskSecret(value?: string): string {
  if (!value) return ''
  if (value.length <= 4) return value.replace(/./g, '\u2022')
  return '\u2022'.repeat(value.length - 4) + value.slice(-4)
}

function formatTimestamp(ts: string | null | undefined) {
  if (!ts) return 'Never'
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReservationIntegrationsPage() {
  const employee = useAuthStore(s => s.employee)
  const [integrations, setIntegrations] = useState<ReservationIntegration[]>([])
  const [expandedPlatform, setExpandedPlatform] = useState<ReservationPlatform | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<ReservationPlatform | null>(null)

  // Secret replacement fields — only submitted when user types a new value
  const [replaceApiKeys, setReplaceApiKeys] = useState<Record<string, string>>({})
  const [replaceWebhookSecrets, setReplaceWebhookSecrets] = useState<Record<string, string>>({})

  // Track which secrets are already configured server-side
  const [hasApiKey, setHasApiKey] = useState<Record<string, boolean>>({})
  const [hasWebhookSecret, setHasWebhookSecret] = useState<Record<string, boolean>>({})

  useEffect(() => {
    async function load() {
      try {
        const settingsData = await loadSettingsApi()
        const saved = settingsData.settings?.reservationIntegrations as ReservationIntegration[] | undefined
        if (saved && Array.isArray(saved)) {
          setIntegrations(saved)
          // Build secret-status maps from saved data
          const apiKeyMap: Record<string, boolean> = {}
          const secretMap: Record<string, boolean> = {}
          for (const ri of saved) {
            apiKeyMap[ri.platform] = Boolean(ri.apiKey)
            secretMap[ri.platform] = Boolean(ri.webhookSecret)
          }
          setHasApiKey(apiKeyMap)
          setHasWebhookSecret(secretMap)
        }
      } catch {
        toast.error('Failed to load reservation integration settings')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  // ─── Integration CRUD Helpers ──────────────────────────────────────

  function getIntegration(platform: ReservationPlatform): ReservationIntegration {
    return integrations.find(i => i.platform === platform) || { ...DEFAULT_RESERVATION_INTEGRATION, platform }
  }

  function updateIntegration(platform: ReservationPlatform, updates: Partial<ReservationIntegration>) {
    setIntegrations(prev => {
      const existing = prev.find(i => i.platform === platform)
      if (existing) {
        return prev.map(i => i.platform === platform ? { ...i, ...updates } : i)
      }
      return [...prev, { ...DEFAULT_RESERVATION_INTEGRATION, platform, ...updates }]
    })
    setIsDirty(true)
  }

  function addStatusMapping(platform: ReservationPlatform) {
    const current = getIntegration(platform)
    const mappings = [...(current.statusMappings || []), { externalStatus: '', internalStatus: 'confirmed' as const }]
    updateIntegration(platform, { statusMappings: mappings })
  }

  function updateStatusMapping(platform: ReservationPlatform, index: number, field: keyof ReservationIntegrationStatusMapping, value: string) {
    const current = getIntegration(platform)
    const mappings = [...(current.statusMappings || [])]
    mappings[index] = { ...mappings[index], [field]: value }
    updateIntegration(platform, { statusMappings: mappings })
  }

  function removeStatusMapping(platform: ReservationPlatform, index: number) {
    const current = getIntegration(platform)
    const mappings = (current.statusMappings || []).filter((_, i) => i !== index)
    updateIntegration(platform, { statusMappings: mappings })
  }

  // ─── Save ──────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true)
    try {
      // Build payload — merge in any new secret values
      const payload = integrations.map(ri => {
        const out = { ...ri }
        const newApiKey = replaceApiKeys[ri.platform]?.trim()
        const newSecret = replaceWebhookSecrets[ri.platform]?.trim()
        if (newApiKey) out.apiKey = newApiKey
        if (newSecret) out.webhookSecret = newSecret
        return out
      })

      await saveSettingsApi({ reservationIntegrations: payload }, employee?.id)

      // Update secret status and clear replacement fields
      const apiKeyMap = { ...hasApiKey }
      const secretMap = { ...hasWebhookSecret }
      for (const ri of payload) {
        if (replaceApiKeys[ri.platform]?.trim()) apiKeyMap[ri.platform] = true
        if (replaceWebhookSecrets[ri.platform]?.trim()) secretMap[ri.platform] = true
      }
      setHasApiKey(apiKeyMap)
      setHasWebhookSecret(secretMap)
      setReplaceApiKeys({})
      setReplaceWebhookSecrets({})
      setIsDirty(false)
      toast.success('Reservation integration settings saved')
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  // ─── Test Connection ───────────────────────────────────────────────

  async function handleTestConnection(platform: ReservationPlatform) {
    setTesting(platform)
    try {
      const res = await fetch(`/api/webhooks/reservations/${platform}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: employee?.id }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        toast.success(data.message || 'Connection test successful')
      } else {
        toast.error(data.error || 'Connection test failed')
      }
    } catch {
      toast.error('Connection test failed')
    } finally {
      setTesting(null)
    }
  }

  // ─── Render ────────────────────────────────────────────────────────

  const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="p-6 max-w-4xl mx-auto pb-32">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Reservation Integrations</h1>
          <p className="text-gray-900">
            Connect third-party reservation platforms to sync bookings automatically.
            Incoming reservations appear in your reservation book with full audit trail.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-500">Loading...</div>
      ) : (
        <div className="space-y-6">
          {/* What this does */}
          <Card>
            <CardHeader><CardTitle>How It Works</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">&#8226;</span>
                  <span><strong>Inbound Webhooks</strong> &mdash; Each platform sends reservation creates, updates, and cancellations to a unique webhook URL. Data is normalized and applied to your reservation book automatically.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">&#8226;</span>
                  <span><strong>Outbound Sync</strong> &mdash; When configured for push or bidirectional, changes made in GWI POS are sent back to the connected platform.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">&#8226;</span>
                  <span><strong>Deduplication</strong> &mdash; Each external reservation is tracked by platform + external ID. Duplicate webhooks are safely ignored.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">&#8226;</span>
                  <span><strong>Custom API</strong> &mdash; For platforms without built-in support, use the Custom API integration with your own field mapping.</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          {/* Platform Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {RESERVATION_PLATFORMS.map(({ platform, name, color, comingSoon }) => {
              const config = getIntegration(platform)
              const isExpanded = expandedPlatform === platform

              return (
                <div
                  key={platform}
                  className={`bg-white border rounded-xl overflow-hidden transition-all ${
                    isExpanded ? 'col-span-full' : ''
                  } ${config.enabled ? 'border-green-200' : 'border-gray-200'}`}
                >
                  {/* Card Header */}
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                        style={{ backgroundColor: color }}
                      >
                        {name.charAt(0)}
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900">{name}</div>
                        <div className="text-xs text-gray-500">
                          {comingSoon
                            ? 'Coming Soon'
                            : config.enabled
                              ? 'Connected'
                              : 'Not Connected'}
                        </div>
                      </div>
                    </div>
                    {!comingSoon && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setExpandedPlatform(isExpanded ? null : platform)}
                      >
                        {isExpanded ? 'Collapse' : config.enabled ? 'Configure' : 'Connect'}
                      </Button>
                    )}
                    {comingSoon && (
                      <span className="px-2 py-1 bg-gray-100 text-gray-500 rounded-full text-xs font-medium">
                        Soon
                      </span>
                    )}
                  </div>

                  {/* Expanded Config */}
                  {isExpanded && !comingSoon && (
                    <div className="border-t border-gray-100 p-4 space-y-5">
                      {/* Enable Toggle */}
                      <ToggleRow
                        label={`Enable ${name}`}
                        description={`Activate ${name} reservation sync. Credentials must be configured below.`}
                        checked={config.enabled}
                        onChange={v => updateIntegration(platform, { enabled: v })}
                      />

                      {/* Webhook URL (read-only) */}
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-1">Webhook URL</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            readOnly
                            value={typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/reservations/${platform}` : `/api/webhooks/reservations/${platform}`}
                            className="flex-1 bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-600 font-mono"
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const url = `${window.location.origin}/api/webhooks/reservations/${platform}`
                              void navigator.clipboard.writeText(url).then(() => toast.success('Webhook URL copied'))
                            }}
                          >
                            Copy
                          </Button>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          Configure this URL in your {name} dashboard as the webhook endpoint.
                        </p>
                      </div>

                      {/* Credentials */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-1">API Key / Token</label>
                          {hasApiKey[platform] && (
                            <div className="flex items-center gap-1.5 text-xs text-green-700 mb-1.5">
                              <span>&#10003; Key configured</span>
                            </div>
                          )}
                          <input
                            type="password"
                            value={replaceApiKeys[platform] ?? ''}
                            onChange={e => {
                              setReplaceApiKeys(prev => ({ ...prev, [platform]: e.target.value }))
                              setIsDirty(true)
                            }}
                            placeholder={hasApiKey[platform] ? 'Enter new key to replace...' : 'Enter API key...'}
                            autoComplete="new-password"
                            className={inputClass}
                          />
                          <p className="text-xs text-gray-500 mt-1">Write-only &mdash; never displayed after saving</p>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-1">Restaurant ID</label>
                          <input
                            type="text"
                            value={config.restaurantId || ''}
                            onChange={e => updateIntegration(platform, { restaurantId: e.target.value || undefined })}
                            placeholder={`Your ${name} restaurant ID`}
                            className={inputClass}
                          />
                          <p className="text-xs text-gray-500 mt-1">The restaurant/venue identifier in {name}</p>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-1">Webhook Secret</label>
                          {hasWebhookSecret[platform] && (
                            <div className="flex items-center gap-1.5 text-xs text-green-700 mb-1.5">
                              <span>&#10003; Secret configured</span>
                            </div>
                          )}
                          <input
                            type="password"
                            value={replaceWebhookSecrets[platform] ?? ''}
                            onChange={e => {
                              setReplaceWebhookSecrets(prev => ({ ...prev, [platform]: e.target.value }))
                              setIsDirty(true)
                            }}
                            placeholder={hasWebhookSecret[platform] ? 'Enter new secret to replace...' : 'Enter webhook secret...'}
                            autoComplete="new-password"
                            className={inputClass}
                          />
                          <p className="text-xs text-gray-500 mt-1">Shared secret for HMAC signature verification</p>
                        </div>
                      </div>

                      {/* Sync Direction */}
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-2">Sync Direction</label>
                        <div className="flex gap-3">
                          {(['pull', 'push', 'bidirectional'] as const).map(dir => (
                            <button
                              key={dir}
                              type="button"
                              onClick={() => updateIntegration(platform, { syncDirection: dir })}
                              className={`flex-1 py-2 px-4 rounded-lg border-2 text-sm font-medium transition-colors ${
                                config.syncDirection === dir
                                  ? 'border-blue-500 bg-blue-50 text-blue-800'
                                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
                              }`}
                            >
                              {dir === 'pull' ? 'Pull Only' : dir === 'push' ? 'Push Only' : 'Bidirectional'}
                            </button>
                          ))}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          Pull = receive from {name}. Push = send to {name}. Bidirectional = both directions.
                        </p>
                      </div>

                      {/* Auto-confirm Toggle */}
                      <ToggleRow
                        label="Auto-Confirm Incoming"
                        description="Automatically confirm incoming reservations instead of leaving them in pending status."
                        checked={config.autoConfirmIncoming}
                        onChange={v => updateIntegration(platform, { autoConfirmIncoming: v })}
                      />

                      {/* Status Mapping */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-sm font-medium text-gray-900">Status Mapping</label>
                          <Button variant="outline" size="sm" onClick={() => addStatusMapping(platform)}>
                            Add Mapping
                          </Button>
                        </div>
                        <p className="text-xs text-gray-500 mb-3">
                          Map {name}&apos;s status names to GWI POS reservation statuses.
                        </p>
                        {(config.statusMappings || []).length === 0 ? (
                          <p className="text-sm text-gray-400 py-2">No custom status mappings. Default mapping will be used.</p>
                        ) : (
                          <div className="space-y-2">
                            {(config.statusMappings || []).map((mapping, idx) => (
                              <div key={idx} className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={mapping.externalStatus}
                                  onChange={e => updateStatusMapping(platform, idx, 'externalStatus', e.target.value)}
                                  placeholder="External status"
                                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <span className="text-gray-400 text-sm">&#8594;</span>
                                <select
                                  value={mapping.internalStatus}
                                  onChange={e => updateStatusMapping(platform, idx, 'internalStatus', e.target.value)}
                                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                  {INTERNAL_STATUSES.map(s => (
                                    <option key={s} value={s}>{s.replace('_', ' ')}</option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => removeStatusMapping(platform, idx)}
                                  className="text-red-500 hover:text-red-700 text-sm px-2"
                                >
                                  &#10005;
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Test Connection + Last Sync */}
                      <div className="flex items-center justify-between pt-3 border-t">
                        <div className="space-y-0.5">
                          <div className="text-sm text-gray-600">Last Sync</div>
                          <div className="text-xs text-gray-500">{formatTimestamp(config.lastSyncAt)}</div>
                          {config.lastError && (
                            <div className="text-xs text-red-600">{config.lastError}</div>
                          )}
                        </div>
                        <Button
                          onClick={() => handleTestConnection(platform)}
                          disabled={!config.enabled || testing === platform}
                          variant="outline"
                          size="sm"
                        >
                          {testing === platform ? 'Testing...' : 'Test Connection'}
                        </Button>
                      </div>

                      {/* Recent Sync Errors */}
                      {(config.syncErrors || []).length > 0 && (
                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-2">Recent Sync Errors</label>
                          <div className="space-y-1 max-h-40 overflow-y-auto">
                            {(config.syncErrors || []).slice(0, 5).map((err, idx) => (
                              <div key={idx} className="flex items-start gap-2 text-xs p-2 bg-red-50 rounded-lg">
                                <span className="text-red-400 flex-shrink-0">{formatTimestamp(err.timestamp)}</span>
                                <span className="text-red-700">{err.message}</span>
                                {err.externalId && (
                                  <span className="text-red-400 flex-shrink-0">#{err.externalId}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Security Notice */}
          <Card>
            <CardContent className="pt-6">
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
                API keys and webhook secrets are stored securely in the POS database on your local server.
                They are never sent to Neon cloud or exposed in API responses after saving.
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <SettingsSaveBar
        isDirty={isDirty}
        onSave={handleSave}
        isSaving={saving}
      />
    </div>
  )
}
