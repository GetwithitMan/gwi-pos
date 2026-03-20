'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/stores/toast-store'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import { SettingsSaveBar } from '@/components/admin/settings/SettingsSaveBar'
import { ToggleRow } from '@/components/admin/settings/ToggleRow'
import type { ThirdPartyDeliverySettings, ThirdPartyDeliveryPlatformSettings, ThirdPartyDeliveryUberEatsSettings } from '@/lib/settings'
import { DEFAULT_THIRD_PARTY_DELIVERY } from '@/lib/settings'
import { useAuthStore } from '@/stores/auth-store'
import { useDeliveryFeature } from '@/hooks/useDeliveryFeature'
import type { DoorDashCredentials, UberEatsCredentials, GrubhubCredentials } from '@/lib/delivery/clients/types'

// ─── Types ──────────────────────────────────────────────────────────────────

type PlatformKey = 'doordash' | 'ubereats' | 'grubhub'

const PLATFORM_CONFIG: Record<PlatformKey, {
  label: string
  color: string
  description: string
  webhookPath: string
}> = {
  doordash: {
    label: 'DoorDash',
    color: 'bg-red-500',
    description: 'Connect DoorDash Drive for delivery order integration',
    webhookPath: '/api/webhooks/doordash',
  },
  ubereats: {
    label: 'UberEats',
    color: 'bg-green-500',
    description: 'Connect UberEats for delivery order integration',
    webhookPath: '/api/webhooks/ubereats',
  },
  grubhub: {
    label: 'Grubhub',
    color: 'bg-orange-500',
    description: 'Connect Grubhub for delivery order integration',
    webhookPath: '/api/webhooks/grubhub',
  },
}

// ─── Default credentials ─────────────────────────────────────────────────

const DEFAULT_DOORDASH_CREDENTIALS: DoorDashCredentials = {
  developerId: '',
  keyId: '',
  signingSecret: '',
  driveEnabled: false,
}

const DEFAULT_UBEREATS_CREDENTIALS: UberEatsCredentials = {
  clientId: '',
  clientSecret: '',
  directEnabled: false,
  directCustomerId: '',
}

const DEFAULT_GRUBHUB_CREDENTIALS: GrubhubCredentials = {
  clientId: '',
  secretKey: '',
  issueDate: '',
  partnerKey: '',
  connectEnabled: false,
}

// ─── Password field with show/hide ──────────────────────────────────────────

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  description,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  description?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg text-sm pr-16"
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => setShow(p => !p)}
          className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-0.5 text-xs text-gray-600 hover:text-gray-900 transition"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {description && <p className="text-xs text-gray-600 mt-1">{description}</p>}
    </div>
  )
}

// ─── Collapsible section ────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition text-left"
      >
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-sm font-medium text-gray-900">{title}</span>
      </button>
      {open && <div className="px-4 py-4 space-y-4 border-t border-gray-200">{children}</div>}
    </div>
  )
}

// ─── Connection status badge ────────────────────────────────────────────────

type ConnectionStatus = 'untested' | 'testing' | 'connected' | 'failed'

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  if (status === 'untested') return null
  const styles: Record<ConnectionStatus, string> = {
    untested: '',
    testing: 'bg-yellow-100 text-yellow-700',
    connected: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  }
  const labels: Record<ConnectionStatus, string> = {
    untested: '',
    testing: 'Testing...',
    connected: 'Connected',
    failed: 'Failed',
  }
  const icons: Record<ConnectionStatus, string> = {
    untested: '',
    testing: '',
    connected: '\u2713',
    failed: '\u2717',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
      {icons[status] && <span>{icons[status]}</span>}
      {labels[status]}
    </span>
  )
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function DeliveryIntegrationSettingsPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = useAuthStore(s => s.locationId)
  const [form, setForm] = useState<ThirdPartyDeliverySettings>(DEFAULT_THIRD_PARTY_DELIVERY)
  const [isDirty, setIsDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingPlatform, setTestingPlatform] = useState<PlatformKey | null>(null)

  // Connection test status per platform
  const [connectionStatus, setConnectionStatus] = useState<Record<PlatformKey, ConnectionStatus>>({
    doordash: 'untested',
    ubereats: 'untested',
    grubhub: 'untested',
  })

  // MC feature gate
  const isDeliveryEnabled = useDeliveryFeature()

  // Menu sync state
  const [syncingMenu, setSyncingMenu] = useState(false)
  const [lastMenuSync, setLastMenuSync] = useState<{ time: string; success: boolean; details?: string } | null>(null)

  // ── Load settings ──────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const data = await loadSettingsApi()
        const delivery = data.settings?.thirdPartyDelivery
        if (delivery) {
          setForm({ ...DEFAULT_THIRD_PARTY_DELIVERY, ...delivery })
        }
      } catch {
        toast.error('Failed to load delivery settings')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  // ── Helpers ────────────────────────────────────────────────────────────

  function updatePlatform<K extends keyof ThirdPartyDeliveryPlatformSettings>(
    platform: PlatformKey,
    key: K,
    value: ThirdPartyDeliveryPlatformSettings[K],
  ) {
    setForm(prev => ({
      ...prev,
      [platform]: { ...prev[platform], [key]: value },
    }))
    setIsDirty(true)
  }

  function updateUberEatsField<K extends keyof ThirdPartyDeliveryUberEatsSettings>(
    key: K,
    value: ThirdPartyDeliveryUberEatsSettings[K],
  ) {
    setForm(prev => ({
      ...prev,
      ubereats: { ...prev.ubereats, [key]: value },
    }))
    setIsDirty(true)
  }

  function updateGlobal<K extends keyof ThirdPartyDeliverySettings>(
    key: K,
    value: ThirdPartyDeliverySettings[K],
  ) {
    setForm(prev => ({ ...prev, [key]: value }))
    setIsDirty(true)
  }

  // ── Credential helpers ──────────────────────────────────────────────────

  const doordashCreds = form.doordashCredentials ?? DEFAULT_DOORDASH_CREDENTIALS
  const uberEatsCreds = form.uberEatsCredentials ?? DEFAULT_UBEREATS_CREDENTIALS
  const grubhubCreds = form.grubhubCredentials ?? DEFAULT_GRUBHUB_CREDENTIALS

  function updateDoordashCreds(patch: Partial<DoorDashCredentials>) {
    setForm(prev => ({
      ...prev,
      doordashCredentials: { ...DEFAULT_DOORDASH_CREDENTIALS, ...prev.doordashCredentials, ...patch },
    }))
    setIsDirty(true)
  }

  function updateUberEatsCreds(patch: Partial<UberEatsCredentials>) {
    setForm(prev => ({
      ...prev,
      uberEatsCredentials: { ...DEFAULT_UBEREATS_CREDENTIALS, ...prev.uberEatsCredentials, ...patch },
    }))
    setIsDirty(true)
  }

  function updateGrubhubCreds(patch: Partial<GrubhubCredentials>) {
    setForm(prev => ({
      ...prev,
      grubhubCredentials: { ...DEFAULT_GRUBHUB_CREDENTIALS, ...prev.grubhubCredentials, ...patch },
    }))
    setIsDirty(true)
  }

  // ── Save ───────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true)
    try {
      await saveSettingsApi({ thirdPartyDelivery: form }, employee?.id)
      setIsDirty(false)
      toast.success('Delivery integration settings saved')
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  // ── Test Webhook ───────────────────────────────────────────────────────

  async function handleTestWebhook(platform: PlatformKey) {
    setTestingPlatform(platform)
    try {
      const webhookUrl = `${window.location.origin}${PLATFORM_CONFIG[platform].webhookPath}`
      const testPayload = {
        event_type: 'ORDER_CREATED',
        order_id: `test-${Date.now()}`,
        store_id: form[platform].storeId,
        order: {
          items: [{ name: 'Test Item', quantity: 1, price: 999 }],
          subtotal: 999,
          tax: 80,
          total: 1079,
          customer_name: 'Test Customer',
        },
      }

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload),
      })

      if (res.ok) {
        toast.success(`Test webhook sent to ${PLATFORM_CONFIG[platform].label}. Check the delivery orders page.`)
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Test webhook failed')
      }
    } catch {
      toast.error('Failed to send test webhook')
    } finally {
      setTestingPlatform(null)
    }
  }

  // ── Test Connection ────────────────────────────────────────────────────

  const handleTestConnection = useCallback(async (platform: PlatformKey) => {
    if (!locationId || !employee?.id) {
      toast.error('Location or employee not available')
      return
    }
    setConnectionStatus(prev => ({ ...prev, [platform]: 'testing' as ConnectionStatus }))
    try {
      const res = await fetch(
        `/api/delivery/platforms?locationId=${encodeURIComponent(locationId)}&employeeId=${encodeURIComponent(employee.id)}`
      )
      if (!res.ok) {
        setConnectionStatus(prev => ({ ...prev, [platform]: 'failed' as ConnectionStatus }))
        toast.error('Failed to check platform status')
        return
      }
      const data = await res.json()
      const platformStatus = data.platforms?.find(
        (p: { platform: string }) => p.platform === platform
      )
      if (platformStatus?.ready) {
        setConnectionStatus(prev => ({ ...prev, [platform]: 'connected' as ConnectionStatus }))
        toast.success(`${PLATFORM_CONFIG[platform].label} is connected and ready`)
      } else {
        setConnectionStatus(prev => ({ ...prev, [platform]: 'failed' as ConnectionStatus }))
        const missing: string[] = []
        if (!platformStatus?.credentialsConfigured) missing.push('credentials')
        if (!platformStatus?.storeIdSet) missing.push('store ID')
        if (!platformStatus?.enabled) missing.push('enabled')
        toast.error(
          missing.length
            ? `${PLATFORM_CONFIG[platform].label} not ready: missing ${missing.join(', ')}`
            : `${PLATFORM_CONFIG[platform].label} is not ready`
        )
      }
    } catch {
      setConnectionStatus(prev => ({ ...prev, [platform]: 'failed' as ConnectionStatus }))
      toast.error('Failed to test connection')
    }
  }, [locationId, employee?.id])

  // ── Menu Sync ──────────────────────────────────────────────────────────

  const handleMenuSync = useCallback(async (platform?: PlatformKey) => {
    if (!locationId || !employee?.id) {
      toast.error('Location or employee not available')
      return
    }
    setSyncingMenu(true)
    try {
      const body: Record<string, string> = {
        locationId,
        employeeId: employee.id,
      }
      if (platform) body.platform = platform

      const res = await fetch('/api/delivery/menu-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        const results = data.results ? Object.values(data.results) as Array<{ platform: string; success: boolean; itemsSynced: number; errors: string[] }> : []
        const successCount = results?.filter(r => r.success).length ?? 0
        const totalItems = results?.reduce((s, r) => s + (r.itemsSynced ?? 0), 0) ?? 0
        setLastMenuSync({
          time: new Date().toLocaleString(),
          success: successCount > 0,
          details: `${totalItems} items synced to ${successCount} platform${successCount !== 1 ? 's' : ''}`,
        })
        toast.success(platform
          ? `Menu synced to ${PLATFORM_CONFIG[platform].label}`
          : `Menu synced to ${successCount} platform${successCount !== 1 ? 's' : ''}`)
      } else {
        setLastMenuSync({ time: new Date().toLocaleString(), success: false, details: data.error || 'Sync failed' })
        toast.error(data.error || 'Menu sync failed')
      }
    } catch {
      setLastMenuSync({ time: new Date().toLocaleString(), success: false, details: 'Network error' })
      toast.error('Failed to sync menu')
    } finally {
      setSyncingMenu(false)
    }
  }, [locationId, employee?.id])

  // Get the webhook URL for display
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Delivery Integrations</h1>
        <div className="text-gray-900">Loading settings...</div>
      </div>
    )
  }

  if (!isDeliveryEnabled) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Delivery Integrations</h1>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
          <div className="text-2xl mb-2">🚚</div>
          <h2 className="text-lg font-semibold text-yellow-800 mb-2">Delivery Module Not Enabled</h2>
          <p className="text-sm text-yellow-700 mb-4">
            Third-party delivery integrations (DoorDash, UberEats, Grubhub) require the Delivery module
            to be enabled for your venue. Contact your administrator or enable it from Mission Control.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Delivery Integrations</h1>
      <p className="text-sm text-gray-900 mb-6">
        Connect DoorDash, UberEats, and Grubhub to receive delivery orders directly in the POS.
        Enter your API credentials below — each platform can be enabled independently.
      </p>

      {/* ── Global Settings ──────────────────────────────────────────── */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">General Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <ToggleRow
            label="Auto-Print Kitchen Ticket"
            description="Automatically print a kitchen ticket when a delivery order is accepted"
            checked={form.autoPrintTicket}
            onChange={v => updateGlobal('autoPrintTicket', v)}
          />
          <ToggleRow
            label="Sound Alert on New Order"
            description="Play an audio alert when a new delivery order arrives"
            checked={form.alertOnNewOrder}
            onChange={v => updateGlobal('alertOnNewOrder', v)}
            border
          />
          <div className="flex items-center justify-between py-3 border-t border-gray-100">
            <div>
              <div className="text-sm text-gray-900">Tax Rate Override</div>
              <div className="text-xs text-gray-600">
                Override tax rate for delivery orders (0 = use location default)
              </div>
            </div>
            <input
              type="number"
              min="0"
              max="20"
              step="0.01"
              value={form.defaultTaxRate}
              onChange={e => updateGlobal('defaultTaxRate', Number(e.target.value))}
              className="w-20 px-2 py-1 border rounded text-sm text-right"
            />
            <span className="text-sm text-gray-900 ml-1">%</span>
          </div>
        </CardContent>
      </Card>

      {/* ── Menu Sync Status + Global Sync Button ──────────────────── */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Menu Sync</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleMenuSync()}
              disabled={syncingMenu}
            >
              {syncingMenu ? 'Syncing...' : 'Sync Menu to All Platforms'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {lastMenuSync ? (
            <div className={`flex items-center gap-2 text-sm ${lastMenuSync.success ? 'text-green-700' : 'text-red-700'}`}>
              <span className={`inline-block w-2 h-2 rounded-full ${lastMenuSync.success ? 'bg-green-500' : 'bg-red-500'}`} />
              <span>Last sync: {lastMenuSync.time}</span>
              {lastMenuSync.details && <span className="text-gray-600">-- {lastMenuSync.details}</span>}
            </div>
          ) : (
            <p className="text-sm text-gray-600">No menu sync performed this session. Push your POS menu to all enabled delivery platforms.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Per-Platform Cards ────────────────────────────────────────── */}
      {(Object.entries(PLATFORM_CONFIG) as [PlatformKey, typeof PLATFORM_CONFIG[PlatformKey]][]).map(([key, config]) => {
        const platformForm = form[key]
        return (
          <Card key={key} className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${config.color}`} />
                  <CardTitle className="text-lg">{config.label}</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <ConnectionBadge status={connectionStatus[key]} />
                  <div className={`px-2 py-0.5 rounded text-xs font-medium ${
                    platformForm.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-900'
                  }`}>
                    {platformForm.enabled ? 'Active' : 'Inactive'}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-900">{config.description}</p>

              <ToggleRow
                label="Enable Integration"
                description={`Receive ${config.label} orders in the POS`}
                checked={platformForm.enabled}
                onChange={v => updatePlatform(key, 'enabled', v)}
              />

              {platformForm.enabled && (
                <>
                  {/* Store / Restaurant ID */}
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-1">
                      {key === 'grubhub' ? 'Restaurant ID' : 'Store ID'}
                    </label>
                    <input
                      type="text"
                      value={platformForm.storeId}
                      onChange={e => updatePlatform(key, 'storeId', e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm"
                      placeholder={key === 'grubhub' ? 'Grubhub restaurant ID' : `${config.label} store ID`}
                    />
                  </div>

                  {/* UberEats Client ID — kept at top level for backward compat */}
                  {key === 'ubereats' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-1">
                        Client ID
                      </label>
                      <input
                        type="text"
                        value={(platformForm as ThirdPartyDeliveryUberEatsSettings).clientId || ''}
                        onChange={e => updateUberEatsField('clientId', e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                        placeholder="UberEats OAuth client ID"
                      />
                    </div>
                  )}

                  {/* Webhook Secret */}
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-1">
                      Webhook Secret
                    </label>
                    <input
                      type="password"
                      value={platformForm.webhookSecret}
                      onChange={e => updatePlatform(key, 'webhookSecret', e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm"
                      placeholder="HMAC webhook signing secret"
                    />
                    <p className="text-xs text-gray-900 mt-1">
                      Used to validate incoming webhook signatures
                    </p>
                  </div>

                  {/* Auto-Accept */}
                  <ToggleRow
                    label="Auto-Accept Orders"
                    description="Automatically accept incoming orders and send to kitchen (skip manual review)"
                    checked={platformForm.autoAccept}
                    onChange={v => updatePlatform(key, 'autoAccept', v)}
                    border
                  />

                  {/* Prep Time */}
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <div className="text-sm text-gray-900">Prep Time</div>
                      <div className="text-xs text-gray-600">Default preparation time for this platform</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="5"
                        max="120"
                        value={platformForm.prepTimeMinutes}
                        onChange={e => updatePlatform(key, 'prepTimeMinutes', Number(e.target.value))}
                        className="w-16 px-2 py-1 border rounded text-sm text-right"
                      />
                      <span className="text-sm text-gray-900">min</span>
                    </div>
                  </div>

                  {/* Webhook URL */}
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xs font-medium text-gray-900 mb-1">Webhook URL</div>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-white px-2 py-1 rounded border flex-1 truncate">
                        {baseUrl}{config.webhookPath}
                      </code>
                      <button
                        onClick={() => {
                          void navigator.clipboard.writeText(`${baseUrl}${config.webhookPath}`)
                          toast.success('Webhook URL copied')
                        }}
                        className="px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded transition"
                      >
                        Copy
                      </button>
                    </div>
                    <p className="text-xs text-gray-900 mt-1">
                      Paste this URL in your {config.label} developer dashboard webhook settings
                    </p>
                  </div>

                  {/* ── API Credentials (collapsible) ────────────────────── */}
                  {key === 'doordash' && (
                    <CollapsibleSection title="API Credentials">
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-1">Developer ID</label>
                        <input
                          type="text"
                          value={doordashCreds.developerId}
                          onChange={e => updateDoordashCreds({ developerId: e.target.value })}
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                          placeholder="DoorDash developer ID"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-1">Key ID</label>
                        <input
                          type="text"
                          value={doordashCreds.keyId}
                          onChange={e => updateDoordashCreds({ keyId: e.target.value })}
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                          placeholder="DoorDash key ID"
                        />
                      </div>
                      <PasswordField
                        label="Signing Secret"
                        value={doordashCreds.signingSecret}
                        onChange={v => updateDoordashCreds({ signingSecret: v })}
                        placeholder="DoorDash JWT signing secret"
                        description="Used to sign API requests to DoorDash"
                      />
                      <ToggleRow
                        label="Enable DoorDash Drive"
                        description="Enable white-label delivery via DoorDash Drive (DaaS)"
                        checked={doordashCreds.driveEnabled}
                        onChange={v => updateDoordashCreds({ driveEnabled: v })}
                        border
                      />
                    </CollapsibleSection>
                  )}

                  {key === 'ubereats' && (
                    <CollapsibleSection title="API Credentials">
                      <p className="text-xs text-gray-600">
                        Client ID is configured above. Add your Client Secret below to enable API access.
                      </p>
                      <PasswordField
                        label="Client Secret"
                        value={uberEatsCreds.clientSecret}
                        onChange={v => updateUberEatsCreds({ clientSecret: v })}
                        placeholder="UberEats OAuth client secret"
                        description="Used for OAuth token exchange with UberEats API"
                      />
                      <ToggleRow
                        label="Enable Uber Direct"
                        description="Enable white-label delivery via Uber Direct (DaaS)"
                        checked={uberEatsCreds.directEnabled}
                        onChange={v => updateUberEatsCreds({ directEnabled: v })}
                        border
                      />
                      {uberEatsCreds.directEnabled && (
                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-1">Uber Direct Customer ID</label>
                          <input
                            type="text"
                            value={uberEatsCreds.directCustomerId || ''}
                            onChange={e => updateUberEatsCreds({ directCustomerId: e.target.value })}
                            className="w-full px-3 py-2 border rounded-lg text-sm"
                            placeholder="Uber Direct customer ID"
                          />
                          <p className="text-xs text-gray-600 mt-1">
                            Your Uber Direct customer ID for white-label delivery requests
                          </p>
                        </div>
                      )}
                    </CollapsibleSection>
                  )}

                  {key === 'grubhub' && (
                    <CollapsibleSection title="API Credentials">
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-1">Client ID</label>
                        <input
                          type="text"
                          value={grubhubCreds.clientId}
                          onChange={e => updateGrubhubCreds({ clientId: e.target.value })}
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                          placeholder="sv:v1:..."
                        />
                        <p className="text-xs text-gray-600 mt-1">Format: sv:v1:... (from Grubhub developer portal)</p>
                      </div>
                      <PasswordField
                        label="Secret Key"
                        value={grubhubCreds.secretKey}
                        onChange={v => updateGrubhubCreds({ secretKey: v })}
                        placeholder="Grubhub shared secret (base64)"
                        description="Base64-encoded shared secret for API authentication"
                      />
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-1">Issue Date</label>
                        <input
                          type="text"
                          value={grubhubCreds.issueDate}
                          onChange={e => updateGrubhubCreds({ issueDate: e.target.value })}
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                          placeholder="Timestamp from Grubhub"
                        />
                        <p className="text-xs text-gray-600 mt-1">Credential issue date provided by Grubhub</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-1">Partner Key</label>
                        <input
                          type="text"
                          value={grubhubCreds.partnerKey}
                          onChange={e => updateGrubhubCreds({ partnerKey: e.target.value })}
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                          placeholder="Grubhub partner key"
                        />
                      </div>
                      <ToggleRow
                        label="Enable Grubhub Connect"
                        description="Enable white-label delivery via Grubhub Connect (DaaS)"
                        checked={grubhubCreds.connectEnabled}
                        onChange={v => updateGrubhubCreds({ connectEnabled: v })}
                        border
                      />
                    </CollapsibleSection>
                  )}

                  {/* ── Action Buttons ──────────────────────────────────── */}
                  <div className="pt-2 flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleTestWebhook(key)}
                      disabled={testingPlatform === key}
                    >
                      {testingPlatform === key ? 'Sending...' : `Send Test Webhook`}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleTestConnection(key)}
                      disabled={connectionStatus[key] === 'testing'}
                    >
                      {connectionStatus[key] === 'testing' ? 'Testing...' : 'Test Connection'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleMenuSync(key)}
                      disabled={syncingMenu}
                    >
                      {syncingMenu ? 'Syncing...' : `Sync Menu`}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )
      })}

      <SettingsSaveBar isDirty={isDirty} isSaving={saving} onSave={handleSave} />
    </div>
  )
}
