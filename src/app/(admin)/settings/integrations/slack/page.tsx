'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/stores/toast-store'
import { useAuthStore } from '@/stores/auth-store'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import type { AlertSettings } from '@/lib/settings'

export default function SlackIntegrationPage() {
  const employeeId = useAuthStore(s => s.employee?.id)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [savedUrl, setSavedUrl] = useState('')
  const [alertSettings, setAlertSettings] = useState<AlertSettings | null>(null)
  const [testing, setTesting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [envConfigured, setEnvConfigured] = useState(false)

  const isDirty = webhookUrl !== savedUrl
  useUnsavedWarning(isDirty)

  // Load settings from DB + check env status
  const loadData = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setLoading(true)
        const [settingsData, statusRes] = await Promise.all([
          loadSettingsApi(controller.signal),
          fetch('/api/integrations/status', { signal: controller.signal }).then(r => r.json()),
        ])
        setAlertSettings(settingsData.settings.alerts)
        const dbUrl = settingsData.settings.alerts?.slackWebhookUrl || ''
        setWebhookUrl(dbUrl)
        setSavedUrl(dbUrl)
        // Status route returns true if EITHER DB or env is configured
        // We only show "env configured" if there's no DB URL but status says configured
        setEnvConfigured(!dbUrl && !!statusRes.data?.slack?.configured)
      } catch (err) {
        if ((err as DOMException).name !== 'AbortError') {
          toast.error('Failed to load settings')
        }
      } finally {
        setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const cleanup = loadData()
    return cleanup
  }, [loadData])

  const configured = !!(webhookUrl || envConfigured)

  async function handleSave() {
    if (!alertSettings) return
    setSaving(true)
    try {
      const data = await saveSettingsApi({
        alerts: { ...alertSettings, slackWebhookUrl: webhookUrl || undefined },
      }, employeeId)
      setAlertSettings(data.settings.alerts)
      const newUrl = data.settings.alerts?.slackWebhookUrl || ''
      setSavedUrl(newUrl)
      setWebhookUrl(newUrl)
      toast.success('Slack webhook URL saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    if (!alertSettings) return
    setSaving(true)
    try {
      const updated = { ...alertSettings }
      delete updated.slackWebhookUrl
      const data = await saveSettingsApi({ alerts: updated }, employeeId)
      setAlertSettings(data.settings.alerts)
      const newUrl = data.settings.alerts?.slackWebhookUrl || ''
      setSavedUrl(newUrl)
      setWebhookUrl(newUrl)
      toast.success('Slack webhook URL removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    try {
      const res = await fetch('/api/integrations/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: 'slack', employeeId }),
      })
      const data = await res.json()
      if (data.data?.success) {
        toast.success(data.data.message)
      } else {
        toast.error(data.data?.message || 'Test failed')
      }
    } catch {
      toast.error('Failed to test connection')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Slack Integration</h1>
          <p className="text-gray-900">Send real-time alerts and notifications to your Slack workspace.</p>
        </div>
        {!loading && (
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
            configured ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
          }`}>
            {configured ? 'Connected' : 'Not Configured'}
          </span>
        )}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>What This Integration Does</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">&#8226;</span>
                <span><strong>Real-Time Error Alerts</strong> -- Critical and high-severity system errors are posted to your Slack channel immediately.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">&#8226;</span>
                <span><strong>Low Stock Alerts</strong> -- Inventory items below threshold trigger Slack notifications.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">&#8226;</span>
                <span><strong>Walkout / Failed Payment Alerts</strong> -- Walkouts and failed payments are flagged for manager visibility.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">&#8226;</span>
                <span><strong>Shift Variance Alerts</strong> -- Large cash drawer variances at shift close.</span>
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Webhook URL</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <label htmlFor="webhook-url" className="block text-sm font-medium text-gray-700 mb-1">
                  Slack Incoming Webhook URL
                </label>
                <input
                  id="webhook-url"
                  type="url"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/services/T00/B00/xxxx"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={loading}
                />
                {envConfigured && !webhookUrl && (
                  <p className="text-xs text-green-700 mt-1">
                    Using webhook URL from server environment variable (SLACK_WEBHOOK_URL). Adding a URL here will override it.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleSave}
                  disabled={!isDirty || saving || loading}
                  size="sm"
                >
                  {saving ? 'Saving...' : 'Save'}
                </Button>
                {savedUrl && (
                  <Button
                    onClick={handleRemove}
                    disabled={saving || loading}
                    variant="outline"
                    size="sm"
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Connection Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Status</span>
                <span className={`text-sm font-medium ${configured ? 'text-green-700' : 'text-yellow-700'}`}>
                  {loading ? 'Checking...' : configured ? 'Webhook configured' : 'Not configured'}
                </span>
              </div>
              <div className="pt-2">
                <Button
                  onClick={handleTest}
                  disabled={!configured || testing}
                  variant="outline"
                  size="sm"
                >
                  {testing ? 'Testing...' : 'Test Connection'}
                </Button>
                {configured && (
                  <p className="text-xs text-gray-900 mt-2">Sends a test message to your configured Slack channel.</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Setup Instructions</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm text-gray-600 list-decimal list-inside">
              <li>Open your Slack workspace and go to <strong>Apps</strong> &gt; <strong>Incoming Webhooks</strong></li>
              <li>Create a new webhook and select the channel for alerts</li>
              <li>Copy the webhook URL and paste it in the <strong>Webhook URL</strong> field above</li>
              <li>Click <strong>Save</strong>, then use <strong>Test Connection</strong> to verify</li>
            </ol>
            <p className="text-xs text-gray-500 mt-4">
              Alternatively, you can set the <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">SLACK_WEBHOOK_URL</code> environment variable on the server (requires restart). The URL saved here takes priority over the environment variable.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
