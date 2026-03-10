'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/stores/toast-store'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import { SettingsSaveBar } from '@/components/admin/settings/SettingsSaveBar'
import { ToggleRow } from '@/components/admin/settings/ToggleRow'
import type { ThirdPartyDeliverySettings, ThirdPartyDeliveryPlatformSettings, ThirdPartyDeliveryUberEatsSettings } from '@/lib/settings'
import { DEFAULT_THIRD_PARTY_DELIVERY } from '@/lib/settings'
import { useAuthStore } from '@/stores/auth-store'

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

// ─── Component ──────────────────────────────────────────────────────────────

export default function DeliveryIntegrationSettingsPage() {
  const employee = useAuthStore(s => s.employee)
  const [form, setForm] = useState<ThirdPartyDeliverySettings>(DEFAULT_THIRD_PARTY_DELIVERY)
  const [isDirty, setIsDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingPlatform, setTestingPlatform] = useState<PlatformKey | null>(null)

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

  // Get the webhook URL for display
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Delivery Integrations</h1>
        <div className="text-gray-500">Loading settings...</div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Delivery Integrations</h1>
      <p className="text-sm text-gray-500 mb-6">
        Connect DoorDash, UberEats, and Grubhub to receive delivery orders directly in the POS.
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
            <span className="text-sm text-gray-500 ml-1">%</span>
          </div>
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
                <div className={`px-2 py-0.5 rounded text-xs font-medium ${
                  platformForm.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {platformForm.enabled ? 'Active' : 'Inactive'}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-500">{config.description}</p>

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
                    <label className="block text-sm font-medium text-gray-700 mb-1">
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

                  {/* UberEats Client ID */}
                  {key === 'ubereats' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Webhook Secret
                    </label>
                    <input
                      type="password"
                      value={platformForm.webhookSecret}
                      onChange={e => updatePlatform(key, 'webhookSecret', e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm"
                      placeholder="HMAC webhook signing secret"
                    />
                    <p className="text-xs text-gray-400 mt-1">
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
                      <span className="text-sm text-gray-500">min</span>
                    </div>
                  </div>

                  {/* Webhook URL */}
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xs font-medium text-gray-700 mb-1">Webhook URL</div>
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
                    <p className="text-xs text-gray-400 mt-1">
                      Paste this URL in your {config.label} developer dashboard webhook settings
                    </p>
                  </div>

                  {/* Test Button */}
                  <div className="pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleTestWebhook(key)}
                      disabled={testingPlatform === key}
                    >
                      {testingPlatform === key ? 'Sending...' : `Send Test ${config.label} Webhook`}
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
