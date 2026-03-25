'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'
import { toast } from '@/stores/toast-store'

// ── Types ──────────────────────────────────────────────────────────────────

type NotificationMode = 'off' | 'shadow' | 'dry_run' | 'primary' | 'forced_legacy'
type ProviderType = 'jtech' | 'lrs' | 'retekess' | 'sms' | 'display' | 'shelf' | 'voice'
type HealthStatus = 'healthy' | 'degraded' | 'circuit_open'
type DeviceStatus = 'available' | 'assigned' | 'released' | 'returned_pending' | 'missing' | 'disabled' | 'retired'

interface NotificationProvider {
  id: string
  providerType: ProviderType
  name: string
  isActive: boolean
  isDefault: boolean
  priority: number
  config: Record<string, unknown>
  capabilities: Record<string, boolean>
  healthStatus: HealthStatus
  lastHealthCheckAt: string | null
  consecutiveFailures: number
  circuitBreakerOpenUntil: string | null
  createdAt: string
}

interface RoutingRule {
  id: string
  eventType: string
  providerId: string
  providerName?: string
  targetType: string
  enabled: boolean
  priority: number
  condFulfillmentMode: string | null
  condHasPager: boolean | null
  condHasPhone: boolean | null
}

interface NotificationDevice {
  id: string
  deviceNumber: string
  humanLabel: string | null
  deviceType: string
  status: DeviceStatus
  assignedToSubjectType: string | null
  assignedToSubjectId: string | null
  assignedAt: string | null
  lastSeenAt: string | null
  batteryLevel: number | null
}

interface NotificationJob {
  id: string
  eventType: string
  subjectType: string
  subjectId: string
  status: string
  terminalResult: string | null
  targetType: string
  targetValue: string
  dispatchOrigin: string
  createdAt: string
  completedAt: string | null
  currentAttempt: number
  maxAttempts: number
}

// ── Health Badge ───────────────────────────────────────────────────────────

function HealthBadge({ status }: { status: HealthStatus }) {
  const config: Record<HealthStatus, { label: string; color: string; bg: string }> = {
    healthy: { label: 'Healthy', color: 'text-green-700', bg: 'bg-green-100' },
    degraded: { label: 'Degraded', color: 'text-yellow-700', bg: 'bg-yellow-100' },
    circuit_open: { label: 'Circuit Open', color: 'text-red-700', bg: 'bg-red-100' },
  }
  const c = config[status] || config.healthy
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c.color} ${c.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
        status === 'healthy' ? 'bg-green-500' : status === 'degraded' ? 'bg-yellow-500' : 'bg-red-500'
      }`} />
      {c.label}
    </span>
  )
}

// ── Device Status Badge ────────────────────────────────────────────────────

function DeviceStatusBadge({ status }: { status: DeviceStatus }) {
  const colors: Record<DeviceStatus, string> = {
    available: 'bg-green-100 text-green-700',
    assigned: 'bg-blue-100 text-blue-700',
    released: 'bg-gray-100 text-gray-700',
    returned_pending: 'bg-yellow-100 text-yellow-700',
    missing: 'bg-red-100 text-red-700',
    disabled: 'bg-gray-200 text-gray-500',
    retired: 'bg-gray-300 text-gray-500',
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

// ── Job Status Badge ───────────────────────────────────────────────────────

function JobStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    claimed: 'bg-blue-100 text-blue-700',
    processing: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    dead_letter: 'bg-red-200 text-red-800',
    cancelled: 'bg-gray-100 text-gray-600',
    suppressed: 'bg-gray-100 text-gray-500',
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

// ── Section Card ───────────────────────────────────────────────────────────

function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </div>
      <div className="px-6 py-4">{children}</div>
    </div>
  )
}

// ── JTECH Config Form ──────────────────────────────────────────────────────

function JtechConfigForm({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
}) {
  const deliveryMethod = (config.deliveryMethod as string) || 'cloud_alert'
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Method</label>
        <select
          value={deliveryMethod}
          onChange={(e) => onChange({ ...config, deliveryMethod: e.target.value })}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="cloud_alert">CloudAlert (Cloud API)</option>
          <option value="direct_sms">Direct SMS</option>
          <option value="local_http">Local HTTP (NUC)</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Site Code</label>
        <input
          type="text"
          value={(config.siteCode as string) || ''}
          onChange={(e) => onChange({ ...config, siteCode: e.target.value })}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          placeholder="JTECH site code"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">API Token</label>
        <input
          type="password"
          value={(config.apiToken as string) || ''}
          onChange={(e) => onChange({ ...config, apiToken: e.target.value })}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          placeholder={config._apiTokenMasked ? '********' : 'Enter API token'}
        />
      </div>
      {deliveryMethod === 'local_http' && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Local IP Address</label>
            <input
              type="text"
              value={(config.localIp as string) || ''}
              onChange={(e) => onChange({ ...config, localIp: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="192.168.1.100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Local Port</label>
            <input
              type="number"
              value={(config.localPort as number) || 8080}
              onChange={(e) => onChange({ ...config, localPort: parseInt(e.target.value) || 8080 })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="8080"
            />
          </div>
        </>
      )}
    </div>
  )
}

// ── Routing Templates ──────────────────────────────────────────────────────

const ROUTING_TEMPLATES: Record<string, { label: string; description: string }> = {
  quick_service: { label: 'Quick Service', description: 'Pager on order ready, SMS fallback' },
  full_service: { label: 'Full Service', description: 'Staff pager for table notifications' },
  waitlist_only: { label: 'Waitlist Only', description: 'Guest pager/SMS for waitlist events only' },
}

// ── Event Types ────────────────────────────────────────────────────────────

const EVENT_TYPES = [
  'waitlist_ready', 'waitlist_second_call', 'waitlist_final_warning',
  'order_ready', 'order_delayed', 'order_cancelled', 'order_recalled',
  'curbside_arrived', 'server_needed', 'expo_recall', 'staff_alert',
]

// ── Main Page ──────────────────────────────────────────────────────────────

export default function NotificationsSettingsPage() {
  useRequireAuth()

  const [activeTab, setActiveTab] = useState<'providers' | 'routing' | 'devices' | 'log'>('providers')
  const [loading, setLoading] = useState(true)

  // Providers state
  const [providers, setProviders] = useState<NotificationProvider[]>([])
  const [notificationMode, setNotificationMode] = useState<NotificationMode>('off')
  const [editingProvider, setEditingProvider] = useState<NotificationProvider | null>(null)
  const [newProviderType, setNewProviderType] = useState<ProviderType | null>(null)
  const [newProviderConfig, setNewProviderConfig] = useState<Record<string, unknown>>({})
  const [newProviderName, setNewProviderName] = useState('')
  const [testingProvider, setTestingProvider] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ providerId: string; capabilities: Record<string, boolean> } | null>(null)

  // Routing rules state
  const [rules, setRules] = useState<RoutingRule[]>([])

  // Devices state
  const [devices, setDevices] = useState<NotificationDevice[]>([])
  const [addDeviceNumber, setAddDeviceNumber] = useState('')
  const [addDeviceLabel, setAddDeviceLabel] = useState('')

  // Job log state
  const [jobs, setJobs] = useState<NotificationJob[]>([])
  const [jobFilter, setJobFilter] = useState({ eventType: '', status: '', providerId: '' })
  const [showDeadLetter, setShowDeadLetter] = useState(false)

  // ── Data Fetching ─────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [providersRes, rulesRes, devicesRes, modeRes] = await Promise.all([
        fetch('/api/notifications/providers').then(r => r.ok ? r.json() : null),
        fetch('/api/notifications/routing-rules').then(r => r.ok ? r.json() : null),
        fetch('/api/notifications/devices').then(r => r.ok ? r.json() : null),
        fetch('/api/notifications/mode').then(r => r.ok ? r.json() : null),
      ])
      if (providersRes?.data) setProviders(providersRes.data)
      if (rulesRes?.data) setRules(rulesRes.data)
      if (devicesRes?.data) setDevices(devicesRes.data)
      if (modeRes?.data?.mode) setNotificationMode(modeRes.data.mode)
    } catch {
      // Non-fatal — page will show empty state
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // Auto-refresh via socket events
  useReportAutoRefresh({ onRefresh: fetchData })

  const fetchJobs = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (jobFilter.eventType) params.set('eventType', jobFilter.eventType)
      if (jobFilter.status) params.set('status', jobFilter.status)
      if (showDeadLetter) params.set('status', 'dead_letter')
      const res = await fetch(`/api/notifications/jobs?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        if (data?.data) setJobs(data.data)
      }
    } catch {
      // Non-fatal
    }
  }, [jobFilter, showDeadLetter])

  useEffect(() => {
    if (activeTab === 'log') {
      void fetchJobs()
    }
  }, [activeTab, fetchJobs])

  // ── Mode Change ───────────────────────────────────────────────────────

  const handleModeChange = async (mode: NotificationMode) => {
    setNotificationMode(mode)
    try {
      const res = await fetch('/api/notifications/mode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (!res.ok) {
        toast.error('Failed to update notification mode')
        void fetchData()
        return
      }
      toast.success(`Notification mode set to: ${mode}`)
    } catch {
      toast.error('Failed to update notification mode')
      void fetchData()
    }
  }

  // ── Provider CRUD ─────────────────────────────────────────────────────

  const handleSaveProvider = async () => {
    if (!newProviderType || !newProviderName.trim()) {
      toast.error('Provider name and type are required')
      return
    }
    try {
      const res = await fetch('/api/notifications/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerType: newProviderType,
          name: newProviderName,
          config: newProviderConfig,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || 'Failed to save provider')
        return
      }
      toast.success('Provider saved')
      setNewProviderType(null)
      setNewProviderName('')
      setNewProviderConfig({})
      void fetchData()
    } catch {
      toast.error('Failed to save provider')
    }
  }

  const handleDeleteProvider = async (id: string) => {
    try {
      const res = await fetch(`/api/notifications/providers/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error('Failed to remove provider')
        return
      }
      toast.success('Provider removed')
      void fetchData()
    } catch {
      toast.error('Failed to remove provider')
    }
  }

  const handleTestProvider = async (id: string) => {
    setTestingProvider(id)
    setTestResult(null)
    try {
      const res = await fetch(`/api/notifications/providers/${id}/test`, { method: 'POST' })
      const data = await res.json()
      if (res.ok && data?.data) {
        setTestResult({ providerId: id, capabilities: data.data.capabilities || {} })
        toast.success('Connection test passed')
      } else {
        toast.error(data?.error || 'Connection test failed')
      }
    } catch {
      toast.error('Connection test failed')
    } finally {
      setTestingProvider(null)
    }
  }

  // ── Routing Templates ─────────────────────────────────────────────────

  const handleApplyTemplate = async (templateKey: string) => {
    try {
      const res = await fetch('/api/notifications/routing-rules/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: templateKey }),
      })
      if (!res.ok) {
        toast.error('Failed to apply template')
        return
      }
      toast.success(`Applied "${ROUTING_TEMPLATES[templateKey]?.label}" template`)
      void fetchData()
    } catch {
      toast.error('Failed to apply template')
    }
  }

  const handleToggleRule = async (ruleId: string, enabled: boolean) => {
    try {
      await fetch(`/api/notifications/routing-rules/${ruleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled } : r))
    } catch {
      toast.error('Failed to update rule')
    }
  }

  // ── Device Actions ────────────────────────────────────────────────────

  const handleAddDevice = async () => {
    if (!addDeviceNumber.trim()) {
      toast.error('Device number is required')
      return
    }
    try {
      const res = await fetch('/api/notifications/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceNumber: addDeviceNumber,
          humanLabel: addDeviceLabel || null,
          deviceType: 'pager',
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || 'Failed to add device')
        return
      }
      toast.success('Device added')
      setAddDeviceNumber('')
      setAddDeviceLabel('')
      void fetchData()
    } catch {
      toast.error('Failed to add device')
    }
  }

  const handleDeviceAction = async (deviceId: string, action: 'return' | 'mark_lost' | 'retire') => {
    try {
      const res = await fetch(`/api/notifications/devices/${deviceId}/${action}`, {
        method: 'POST',
      })
      if (!res.ok) {
        toast.error(`Failed to ${action.replace('_', ' ')} device`)
        return
      }
      toast.success(`Device ${action.replace('_', ' ')}ed`)
      void fetchData()
    } catch {
      toast.error(`Failed to ${action.replace('_', ' ')} device`)
    }
  }

  // ── Dead Letter Retry ─────────────────────────────────────────────────

  const handleRetryJob = async (jobId: string) => {
    try {
      const res = await fetch(`/api/notifications/jobs/${jobId}/retry`, { method: 'POST' })
      if (!res.ok) {
        toast.error('Failed to retry job')
        return
      }
      toast.success('Job queued for retry')
      void fetchJobs()
    } catch {
      toast.error('Failed to retry job')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Notifications</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-gray-200 rounded w-1/3" />
          <div className="h-48 bg-gray-200 rounded" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Notification Platform</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure guest paging, SMS notifications, and routing rules.
        </p>
      </div>

      {/* Kill Switch — Notification Mode */}
      <div className="mb-6 bg-white border border-gray-200 rounded-lg shadow-sm p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Notification Mode</h3>
            <p className="text-xs text-gray-500 mt-0.5">Controls whether the notification platform is active for this location.</p>
          </div>
          <select
            value={notificationMode}
            onChange={(e) => handleModeChange(e.target.value as NotificationMode)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm font-medium"
          >
            <option value="off">Off (Legacy Only)</option>
            <option value="shadow">Shadow (Log Only)</option>
            <option value="dry_run">Dry Run (No Live Sends)</option>
            <option value="primary">Primary (Live)</option>
            <option value="forced_legacy">Forced Legacy</option>
          </select>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex -mb-px space-x-8">
          {(['providers', 'routing', 'devices', 'log'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-3 px-1 border-b-2 text-sm font-medium ${
                activeTab === tab
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab === 'providers' ? 'Providers' : tab === 'routing' ? 'Routing Rules' : tab === 'devices' ? 'Device Inventory' : 'Notification Log'}
            </button>
          ))}
        </nav>
      </div>

      {/* ── PROVIDERS TAB ──────────────────────────────────────────────── */}
      {activeTab === 'providers' && (
        <div className="space-y-6">
          <SectionCard title="Configured Providers" description="Notification delivery providers for this location.">
            {providers.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No providers configured. Add one below.</p>
            ) : (
              <div className="divide-y divide-gray-200">
                {providers.map(provider => (
                  <div key={provider.id} className="py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{provider.name}</span>
                          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{provider.providerType}</span>
                          {provider.isDefault && (
                            <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">Default</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <HealthBadge status={provider.healthStatus} />
                          {provider.consecutiveFailures > 0 && (
                            <span className="text-xs text-red-600">{provider.consecutiveFailures} consecutive failures</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {testResult?.providerId === provider.id && (
                        <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
                          {Object.entries(testResult.capabilities).filter(([, v]) => v).map(([k]) => k).join(', ') || 'Connected'}
                        </span>
                      )}
                      <button
                        onClick={() => handleTestProvider(provider.id)}
                        disabled={testingProvider === provider.id}
                        className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md disabled:opacity-50"
                      >
                        {testingProvider === provider.id ? 'Testing...' : 'Test'}
                      </button>
                      <button
                        onClick={() => handleDeleteProvider(provider.id)}
                        className="px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add Provider Form */}
            <div className="mt-4 pt-4 border-t border-gray-200">
              <h4 className="text-sm font-semibold text-gray-900 mb-3">Add Provider</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Provider Type</label>
                  <select
                    value={newProviderType || ''}
                    onChange={(e) => {
                      setNewProviderType((e.target.value || null) as ProviderType | null)
                      setNewProviderConfig({})
                    }}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  >
                    <option value="">Select type...</option>
                    <option value="jtech">JTECH</option>
                    <option value="sms">SMS (Twilio)</option>
                    <option value="lrs">LRS</option>
                    <option value="retekess">Retekess</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    type="text"
                    value={newProviderName}
                    onChange={(e) => setNewProviderName(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    placeholder="e.g. JTECH Main"
                  />
                </div>
              </div>

              {newProviderType === 'jtech' && (
                <div className="mt-4">
                  <JtechConfigForm config={newProviderConfig} onChange={setNewProviderConfig} />
                </div>
              )}

              {newProviderType === 'sms' && (
                <div className="mt-4 space-y-3">
                  <p className="text-sm text-gray-500">
                    SMS uses the Twilio credentials configured in Settings &gt; Integrations &gt; SMS.
                  </p>
                </div>
              )}

              {newProviderType && (
                <div className="mt-4">
                  <button
                    onClick={handleSaveProvider}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
                  >
                    Add Provider
                  </button>
                </div>
              )}
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── ROUTING RULES TAB ──────────────────────────────────────────── */}
      {activeTab === 'routing' && (
        <div className="space-y-6">
          {/* Templates */}
          <SectionCard title="Quick Templates" description="Apply a pre-configured routing template. This will replace existing rules.">
            <div className="flex gap-3 flex-wrap">
              {Object.entries(ROUTING_TEMPLATES).map(([key, tmpl]) => (
                <button
                  key={key}
                  onClick={() => handleApplyTemplate(key)}
                  className="px-4 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 rounded-md border border-gray-300"
                >
                  <span className="font-semibold">{tmpl.label}</span>
                  <span className="text-gray-500 ml-2">{tmpl.description}</span>
                </button>
              ))}
            </div>
          </SectionCard>

          {/* Rules List */}
          <SectionCard title="Routing Rules" description="Per-event routing with provider assignment and conditions.">
            {rules.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No routing rules configured. Apply a template above or create rules via the API.</p>
            ) : (
              <div className="divide-y divide-gray-200">
                {rules
                  .sort((a, b) => a.priority - b.priority)
                  .map(rule => (
                    <div key={rule.id} className="py-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-400 font-mono w-6 text-right">{rule.priority}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900 text-sm">{rule.eventType}</span>
                            <span className="text-xs text-gray-500">
                              via {rule.providerName || rule.providerId.slice(0, 8)}
                            </span>
                            <span className="text-xs text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{rule.targetType}</span>
                          </div>
                          {(rule.condFulfillmentMode || rule.condHasPager != null || rule.condHasPhone != null) && (
                            <div className="flex gap-2 mt-0.5">
                              {rule.condFulfillmentMode && (
                                <span className="text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
                                  mode={rule.condFulfillmentMode}
                                </span>
                              )}
                              {rule.condHasPager != null && (
                                <span className="text-xs text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded">
                                  pager={String(rule.condHasPager)}
                                </span>
                              )}
                              {rule.condHasPhone != null && (
                                <span className="text-xs text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                                  phone={String(rule.condHasPhone)}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={(e) => handleToggleRule(rule.id, e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:bg-blue-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
                      </label>
                    </div>
                  ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {/* ── DEVICES TAB ────────────────────────────────────────────────── */}
      {activeTab === 'devices' && (
        <div className="space-y-6">
          <SectionCard title="Device Inventory" description="Manage pager devices for guest notification.">
            {/* Add Device Row */}
            <div className="flex items-end gap-3 mb-4 pb-4 border-b border-gray-200">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Device #</label>
                <input
                  type="text"
                  value={addDeviceNumber}
                  onChange={(e) => setAddDeviceNumber(e.target.value)}
                  className="w-24 border border-gray-300 rounded-md px-3 py-2 text-sm"
                  placeholder="01"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Label (optional)</label>
                <input
                  type="text"
                  value={addDeviceLabel}
                  onChange={(e) => setAddDeviceLabel(e.target.value)}
                  className="w-40 border border-gray-300 rounded-md px-3 py-2 text-sm"
                  placeholder="Red pager"
                />
              </div>
              <button
                onClick={handleAddDevice}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
              >
                Add Device
              </button>
            </div>

            {/* Device Grid */}
            {devices.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No devices registered.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {devices.map(device => (
                  <div key={device.id} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-lg text-gray-900">#{device.deviceNumber}</span>
                      <DeviceStatusBadge status={device.status} />
                    </div>
                    {device.humanLabel && (
                      <p className="text-xs text-gray-500 mb-1">{device.humanLabel}</p>
                    )}
                    {device.status === 'assigned' && device.assignedToSubjectId && (
                      <p className="text-xs text-blue-600 mb-1">
                        Assigned to: {device.assignedToSubjectType} {device.assignedToSubjectId.slice(0, 8)}
                      </p>
                    )}
                    {device.batteryLevel != null && (
                      <p className="text-xs text-gray-500 mb-2">
                        Battery: {device.batteryLevel}%
                      </p>
                    )}
                    <div className="flex gap-1.5 mt-2">
                      {device.status === 'assigned' && (
                        <button
                          onClick={() => handleDeviceAction(device.id, 'return')}
                          className="px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded"
                        >
                          Return
                        </button>
                      )}
                      {device.status !== 'missing' && device.status !== 'retired' && (
                        <button
                          onClick={() => handleDeviceAction(device.id, 'mark_lost')}
                          className="px-2 py-1 text-xs font-medium text-orange-600 hover:text-orange-700 bg-orange-50 hover:bg-orange-100 rounded"
                        >
                          Lost
                        </button>
                      )}
                      {device.status !== 'retired' && (
                        <button
                          onClick={() => handleDeviceAction(device.id, 'retire')}
                          className="px-2 py-1 text-xs font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded"
                        >
                          Retire
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {/* ── NOTIFICATION LOG TAB ───────────────────────────────────────── */}
      {activeTab === 'log' && (
        <div className="space-y-6">
          <SectionCard title="Notification Log" description="Searchable log of all notification jobs.">
            {/* Filters */}
            <div className="flex gap-3 mb-4 flex-wrap">
              <select
                value={jobFilter.eventType}
                onChange={(e) => setJobFilter(prev => ({ ...prev, eventType: e.target.value }))}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="">All Events</option>
                {EVENT_TYPES.map(et => (
                  <option key={et} value={et}>{et}</option>
                ))}
              </select>
              <select
                value={showDeadLetter ? 'dead_letter' : jobFilter.status}
                onChange={(e) => {
                  if (e.target.value === 'dead_letter') {
                    setShowDeadLetter(true)
                    setJobFilter(prev => ({ ...prev, status: '' }))
                  } else {
                    setShowDeadLetter(false)
                    setJobFilter(prev => ({ ...prev, status: e.target.value }))
                  }
                }}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="dead_letter">Dead Letter</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <button
                onClick={fetchJobs}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
              >
                Refresh
              </button>
            </div>

            {/* Job List */}
            {jobs.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No notification jobs found.</p>
            ) : (
              <div className="divide-y divide-gray-200 max-h-[500px] overflow-y-auto">
                {jobs.map(job => (
                  <div key={job.id} className="py-3 flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-gray-900">{job.eventType}</span>
                        <JobStatusBadge status={job.status} />
                        {job.terminalResult && (
                          <span className="text-xs text-gray-500">{job.terminalResult}</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {job.subjectType}:{job.subjectId.slice(0, 8)} | {job.targetType}: {job.targetValue}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {new Date(job.createdAt).toLocaleString()} | Attempt {job.currentAttempt}/{job.maxAttempts}
                        {job.dispatchOrigin !== 'automatic' && ` | ${job.dispatchOrigin}`}
                      </div>
                    </div>
                    {(job.status === 'dead_letter' || job.status === 'failed') && (
                      <button
                        onClick={() => handleRetryJob(job.id)}
                        className="px-3 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  )
}
