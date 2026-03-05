'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/stores/toast-store'
import { loadSettings, saveSettings } from '@/lib/api/settings-client'
import { useAuthStore } from '@/stores/auth-store'
import Link from 'next/link'

interface ListenEvent {
  id: string
  receivedAt: string
  deviceId: string
  pluNumber: number
  rawPacket: string
  modifierBytes: string | null
  parseStatus: string
  lrcReceived: string
  lrcCalculated: string
  lrcValid: boolean
  status: string
  unmatchedType: string | null
  ackLatencyMs: number | null
  orderId: string | null
  pluMapping: { description: string } | null
  device: { name: string } | null
}

interface PluMapping {
  id: string
  pluNumber: number
  description: string
  menuItemId: string | null
  pourSizeOz: number | null
  active: boolean
  modifierRule?: unknown
}

interface PluFormData {
  pluNumber: number | ''
  description: string
  menuItemId: string
  pourSizeOz: number | ''
  active: boolean
  modifierRuleStr: string
}

interface BergDevice {
  id: string
  name: string
  model: string
  portName: string
  lastSeenAt: string | null
  ackTimeoutMs: number
  pourReleaseMode: string
  autoRingMode: string
}

interface DeviceFormData {
  name: string
  model: string
  portName: string
  ackTimeoutMs: number
  pourReleaseMode: string
  autoRingMode: string
  timeoutPolicy: string
  autoRingOnlyWhenSingleOpenOrder: boolean
}

const MODEL_OPTIONS = [
  { value: 'MODEL_1504_704', label: 'Berg 1504/704' },
  { value: 'LASER', label: 'Berg LASER' },
  { value: 'ALL_BOTTLE_ABID', label: 'All-Bottle ABID' },
  { value: 'TAP2', label: 'TAP2' },
  { value: 'FLOW_MONITOR', label: 'Flow Monitor' },
]

const MODEL_PLU_HINTS: Record<string, string> = {
  MODEL_1504_704: 'Typical: PLU 1\u2013600+ (base + offsets for 15/7 levels \u00d7 4 portions)',
  LASER: 'Typical: PLU 1\u201364 (up to 16 brands + 48 cocktails)',
  ALL_BOTTLE_ABID: 'Typical: PLU 1\u2013800+ (up to 200 brands \u00d7 4 portions)',
  TAP2: 'Typical: 8 portions \u00d7 4 prices per tap (non-traditional PLUs)',
  FLOW_MONITOR: 'Volume-based \u2014 no PLUs used for individual pours',
}

const emptyPluForm: PluFormData = { pluNumber: '', description: '', menuItemId: '', pourSizeOz: '', active: true, modifierRuleStr: '' }
const emptyDeviceForm: DeviceFormData = { name: '', model: 'MODEL_1504_704', portName: '', ackTimeoutMs: 3000, pourReleaseMode: 'BEST_EFFORT', autoRingMode: 'AUTO_RING', timeoutPolicy: 'ACK_ON_TIMEOUT', autoRingOnlyWhenSingleOpenOrder: false }

function getPluRangeWarning(pluNumber: number, model: string): string | null {
  const ranges: Record<string, { min: number; max: number; hint: string }> = {
    MODEL_1504_704: { min: 1, max: 600, hint: 'Typical: 1–600+ for 1504/704' },
    LASER: { min: 1, max: 64, hint: 'Typical: 1–64 for LASER' },
    ALL_BOTTLE_ABID: { min: 1, max: 800, hint: 'Typical: 1–800+ for All-Bottle' },
    TAP2: { min: 1, max: 32, hint: 'Typical: 1–32 for TAP2' },
    FLOW_MONITOR: { min: 0, max: 0, hint: 'Flow Monitor uses volume tracking, not PLUs' },
  }
  const range = ranges[model]
  if (!range || range.max === 0) return null
  if (pluNumber < range.min || pluNumber > range.max) {
    return `⚠ PLU ${pluNumber} is outside the typical range for this model (${range.hint}). This may be correct for your ECU firmware — check your Berg programming sheet.`
  }
  return null
}

export default function BergSettingsPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [mappings, setMappings] = useState<PluMapping[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<PluFormData>(emptyPluForm)

  // Device management state
  const [devices, setDevices] = useState<BergDevice[]>([])
  const [showAddDevice, setShowAddDevice] = useState(false)
  const [deviceForm, setDeviceForm] = useState<DeviceFormData>(emptyDeviceForm)
  const [detectedPorts, setDetectedPorts] = useState<string[]>([])
  const [showPortDropdown, setShowPortDropdown] = useState(false)
  const [newSecretAlert, setNewSecretAlert] = useState<string | null>(null)
  const [savingDevice, setSavingDevice] = useState(false)
  const [detectingPorts, setDetectingPorts] = useState(false)
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null)

  // Listen Mode state
  const [listenDeviceId, setListenDeviceId] = useState<string | null>(null)
  const [listenEvents, setListenEvents] = useState<ListenEvent[]>([])
  const [listenSince, setListenSince] = useState<string | null>(null)
  const listenScrollRef = useRef<HTMLDivElement>(null)
  const listenIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const listenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const LISTEN_AUTO_STOP_MS = 5 * 60 * 1000 // 5 minutes

  const loadMappings = useCallback(async () => {
    if (!locationId || !employee?.id) return
    try {
      const res = await fetch(`/api/berg/plu-mappings?locationId=${locationId}&employeeId=${employee.id}`)
      if (res.ok) {
        const data = await res.json()
        setMappings(data.data ?? [])
      }
    } catch {
      // silent
    }
  }, [locationId, employee?.id])

  const loadDevices = useCallback(async () => {
    if (!locationId || !employee?.id) return
    try {
      const res = await fetch(`/api/berg/devices?locationId=${locationId}&employeeId=${employee.id}`)
      if (res.ok) {
        const data = await res.json()
        setDevices(data.data ?? [])
      }
    } catch {
      // silent
    }
  }, [locationId, employee?.id])

  useEffect(() => {
    async function load() {
      try {
        const settingsData = await loadSettings()
        const berg = settingsData.settings?.bergReportsEnabled
        setEnabled(berg === true)
      } catch {
        toast.error('Failed to load settings')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  useEffect(() => {
    if (enabled) {
      void loadMappings()
      void loadDevices()
    }
  }, [enabled, loadMappings, loadDevices])

  async function handleToggle(val: boolean) {
    setEnabled(val)
    setSaving(true)
    try {
      await saveSettings({ bergReportsEnabled: val }, employee?.id)
      toast.success(val ? 'Berg reports enabled' : 'Berg reports disabled')
    } catch {
      setEnabled(!val)
      toast.error('Failed to save setting')
    } finally {
      setSaving(false)
    }
  }

  function openAdd() {
    setForm(emptyPluForm)
    setEditingId(null)
    setShowForm(true)
  }

  function openEdit(m: PluMapping) {
    setForm({
      pluNumber: m.pluNumber,
      description: m.description,
      menuItemId: m.menuItemId ?? '',
      pourSizeOz: m.pourSizeOz ?? '',
      active: m.active,
      modifierRuleStr: m.modifierRule ? JSON.stringify(m.modifierRule, null, 2) : '',
    })
    setEditingId(m.id)
    setShowForm(true)
  }

  async function handleSubmit() {
    if (!form.pluNumber || !form.description) {
      toast.error('PLU number and description are required')
      return
    }
    let modifierRule: unknown = undefined
    if (form.modifierRuleStr) {
      try { modifierRule = JSON.parse(form.modifierRuleStr) } catch { /* skip invalid JSON */ }
    }
    const body = {
      pluNumber: Number(form.pluNumber),
      description: form.description,
      menuItemId: form.menuItemId || null,
      pourSizeOz: form.pourSizeOz ? Number(form.pourSizeOz) : null,
      active: form.active,
      employeeId: employee?.id,
      locationId,
      ...(modifierRule !== undefined ? { modifierRule } : {}),
    }
    try {
      if (editingId) {
        const res = await fetch(`/api/berg/plu-mappings/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error()
        toast.success('Mapping updated')
      } else {
        const res = await fetch('/api/berg/plu-mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error()
        toast.success('Mapping created')
      }
      setShowForm(false)
      setEditingId(null)
      await loadMappings()
    } catch {
      toast.error('Failed to save mapping')
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this PLU mapping?')) return
    try {
      const res = await fetch(`/api/berg/plu-mappings/${id}?locationId=${locationId}&employeeId=${employee?.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error()
      toast.success('Mapping deleted')
      await loadMappings()
    } catch {
      toast.error('Failed to delete mapping')
    }
  }

  const stopListening = useCallback(() => {
    if (listenIntervalRef.current) clearInterval(listenIntervalRef.current)
    if (listenTimeoutRef.current) clearTimeout(listenTimeoutRef.current)
    listenIntervalRef.current = null
    listenTimeoutRef.current = null
    setListenDeviceId(null)
    setListenSince(null)
  }, [])

  const pollListen = useCallback(async (devId: string, since: string | null) => {
    if (!locationId || !employee?.id) return null
    try {
      const params = new URLSearchParams({ locationId, employeeId: employee.id, deviceId: devId, limit: '30' })
      if (since) params.set('since', since)
      const res = await fetch(`/api/berg/listen?${params}`)
      if (!res.ok) return null
      const data = await res.json()
      return data.events as ListenEvent[]
    } catch { return null }
  }, [locationId, employee?.id])

  const startListening = useCallback(async (devId: string) => {
    if (listenIntervalRef.current) clearInterval(listenIntervalRef.current)
    if (listenTimeoutRef.current) clearTimeout(listenTimeoutRef.current)

    setListenDeviceId(devId)
    setListenEvents([])
    setListenSince(null)

    // Initial load
    const initial = await pollListen(devId, null)
    if (initial) {
      setListenEvents(initial)
      const last = initial[initial.length - 1]
      setListenSince(last ? last.receivedAt : new Date().toISOString())
    } else {
      setListenSince(new Date().toISOString())
    }

    // Poll every 2 seconds for new events
    listenIntervalRef.current = setInterval(async () => {
      setListenSince(prev => {
        void (async (sinceVal: string | null) => {
          const newEvents = await pollListen(devId, sinceVal)
          if (newEvents && newEvents.length > 0) {
            setListenEvents(prev2 => {
              const combined = [...prev2, ...newEvents].slice(-100) // keep last 100
              return combined
            })
            setListenSince(newEvents[newEvents.length - 1].receivedAt)
            // Scroll to bottom
            requestAnimationFrame(() => {
              if (listenScrollRef.current) {
                listenScrollRef.current.scrollTop = listenScrollRef.current.scrollHeight
              }
            })
          }
        })(prev)
        return prev
      })
    }, 2000)

    // Auto-stop after 5 minutes
    listenTimeoutRef.current = setTimeout(() => {
      stopListening()
      toast.info('Listen Mode stopped after 5 minutes')
    }, LISTEN_AUTO_STOP_MS)
  }, [pollListen, stopListening, LISTEN_AUTO_STOP_MS])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (listenIntervalRef.current) clearInterval(listenIntervalRef.current)
      if (listenTimeoutRef.current) clearTimeout(listenTimeoutRef.current)
    }
  }, [])

  async function handleDetectPorts() {
    if (!locationId || !employee?.id) return
    setDetectingPorts(true)
    try {
      const res = await fetch(`/api/berg/detect-ports?locationId=${locationId}&employeeId=${employee.id}`)
      if (res.ok) {
        const data = await res.json()
        const ports = data.data ?? []
        setDetectedPorts(ports)
        setShowPortDropdown(true)
        if (ports.length === 0) toast.info('No serial ports detected')
      } else {
        toast.error('Failed to detect ports')
      }
    } catch {
      toast.error('Failed to detect ports')
    } finally {
      setDetectingPorts(false)
    }
  }

  function openEditDevice(d: BergDevice) {
    setDeviceForm({
      name: d.name,
      model: d.model,
      portName: d.portName,
      ackTimeoutMs: d.ackTimeoutMs,
      pourReleaseMode: d.pourReleaseMode,
      autoRingMode: d.autoRingMode,
      timeoutPolicy: 'ACK_ON_TIMEOUT',
      autoRingOnlyWhenSingleOpenOrder: (d as BergDevice & { autoRingOnlyWhenSingleOpenOrder?: boolean }).autoRingOnlyWhenSingleOpenOrder ?? false,
    })
    setEditingDeviceId(d.id)
    setShowAddDevice(true)
  }

  async function handleAddDevice() {
    if (!deviceForm.name || !deviceForm.portName) {
      toast.error('Name and port name are required')
      return
    }
    setSavingDevice(true)
    try {
      const url = editingDeviceId
        ? `/api/berg/devices/${editingDeviceId}`
        : '/api/berg/devices'
      const res = await fetch(url, {
        method: editingDeviceId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...deviceForm,
          locationId,
          employeeId: employee?.id,
        }),
      })
      if (!res.ok) throw new Error()
      if (!editingDeviceId) {
        const data = await res.json()
        const secret = data.bridgeSecret ?? data.data?.bridgeSecret
        if (secret) {
          setNewSecretAlert(secret)
        }
      }
      toast.success(editingDeviceId ? 'Device updated' : 'Device added')
      setShowAddDevice(false)
      setEditingDeviceId(null)
      setDeviceForm(emptyDeviceForm)
      await loadDevices()
    } catch {
      toast.error(editingDeviceId ? 'Failed to update device' : 'Failed to add device')
    } finally {
      setSavingDevice(false)
    }
  }

  async function handleDeactivateDevice(id: string) {
    if (!window.confirm('Deactivate this device? It will no longer accept pours.')) return
    try {
      const res = await fetch(`/api/berg/devices/${id}?locationId=${locationId}&employeeId=${employee?.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error()
      toast.success('Device deactivated')
      await loadDevices()
    } catch {
      toast.error('Failed to deactivate device')
    }
  }

  function isDeviceConnected(lastSeenAt: string | null): boolean {
    if (!lastSeenAt) return false
    const fiveMinAgo = Date.now() - 5 * 60 * 1000
    return new Date(lastSeenAt).getTime() > fiveMinAgo
  }

  if (loading) return <div className="p-6 text-gray-500">Loading...</div>

  const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="p-6 max-w-4xl mx-auto pb-32">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Berg Controls</h1>
          <p className="text-gray-500">
            Compare Berg liquor system pours against POS sales data by mapping PLU numbers to menu items.
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Enable Toggle */}
        <Card>
          <CardHeader><CardTitle>Berg Reports</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700">Enable Berg Comparison Reports</div>
                <div className="text-xs text-gray-400">Turn on to start mapping PLU numbers and running comparison reports.</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                disabled={saving}
                onClick={() => handleToggle(!enabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-blue-600' : 'bg-gray-200'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </CardContent>
        </Card>

        {!enabled && (
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-sm text-gray-500">
            Enable Berg comparison reports to start mapping PLU numbers to your POS items.
          </div>
        )}

        {enabled && (
          <>
            {/* Link to report */}
            <div className="flex justify-end">
              <Link href="/reports/berg-comparison" className="text-blue-600 text-sm hover:underline font-medium">
                View Berg Comparison Report &rarr;
              </Link>
            </div>

            {/* New Secret Alert */}
            {newSecretAlert && (
              <div className="rounded-lg border-2 border-yellow-400 bg-yellow-50 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-bold text-yellow-800 mb-1">Save This Bridge Secret — Shown Once Only</div>
                    <div className="text-xs text-yellow-700 mb-2">
                      Add this to your NUC&apos;s <code className="bg-yellow-100 px-1 rounded">/opt/gwi-pos/.env</code> in the <code className="bg-yellow-100 px-1 rounded">GWI_BRIDGE_SECRETS</code> JSON map.
                    </div>
                    <code className="block bg-white border border-yellow-300 rounded px-3 py-2 text-sm font-mono text-yellow-900 select-all break-all">
                      {newSecretAlert}
                    </code>
                  </div>
                  <button onClick={() => setNewSecretAlert(null)} className="text-yellow-600 hover:text-yellow-800 text-lg font-bold ml-4">&times;</button>
                </div>
              </div>
            )}

            {/* Berg Devices */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Berg Devices</CardTitle>
                    <p className="text-xs text-gray-400 mt-1">Connect physical Berg ECU hardware. Requires the berg-bridge service running on your NUC.</p>
                  </div>
                  <Button onClick={() => { setShowAddDevice(!showAddDevice); setDeviceForm(emptyDeviceForm); setEditingDeviceId(null); setNewSecretAlert(null) }} size="sm">
                    {showAddDevice ? 'Cancel' : 'Add Device'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* Add Device Form */}
                {showAddDevice && (
                  <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
                    <div className="text-sm font-medium text-gray-700 mb-2">{editingDeviceId ? 'Edit Device' : 'Add Device'}</div>
                    {/* Mode Presets */}
                    <div className="mb-4">
                      <label className="block text-xs font-medium text-gray-600 mb-2">Quick Preset</label>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          {
                            label: 'Bar Friendly',
                            description: 'ACK immediately, ring if possible',
                            pourReleaseMode: 'BEST_EFFORT',
                            autoRingMode: 'AUTO_RING',
                            ackTimeoutMs: 3000,
                            color: 'green',
                          },
                          {
                            label: 'Maximum Control',
                            description: 'Require open ticket — strictest',
                            pourReleaseMode: 'REQUIRES_OPEN_ORDER',
                            autoRingMode: 'AUTO_RING',
                            ackTimeoutMs: 3000,
                            color: 'red',
                          },
                          {
                            label: 'Log Only',
                            description: 'ACK always, never auto-ring',
                            pourReleaseMode: 'BEST_EFFORT',
                            autoRingMode: 'OFF',
                            ackTimeoutMs: 3000,
                            color: 'gray',
                          },
                        ].map(preset => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => setDeviceForm(f => ({
                              ...f,
                              pourReleaseMode: preset.pourReleaseMode,
                              autoRingMode: preset.autoRingMode,
                              ackTimeoutMs: preset.ackTimeoutMs,
                            }))}
                            className={`text-left rounded-lg border p-2 text-xs transition-colors ${
                              deviceForm.pourReleaseMode === preset.pourReleaseMode && deviceForm.autoRingMode === preset.autoRingMode
                                ? preset.color === 'green' ? 'border-green-500 bg-green-50' : preset.color === 'red' ? 'border-red-500 bg-red-50' : 'border-gray-400 bg-gray-100'
                                : 'border-gray-200 hover:border-gray-400 bg-white'
                            }`}
                          >
                            <div className="font-medium">{preset.label}</div>
                            <div className="text-gray-500 mt-0.5">{preset.description}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                        <input
                          type="text"
                          value={deviceForm.name}
                          onChange={e => setDeviceForm(f => ({ ...f, name: e.target.value }))}
                          placeholder="e.g. Bar 1 ECU"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Model</label>
                        <select
                          value={deviceForm.model}
                          onChange={e => setDeviceForm(f => ({ ...f, model: e.target.value }))}
                          className={inputClass}
                        >
                          {MODEL_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {deviceForm.model && MODEL_PLU_HINTS[deviceForm.model] && (
                          <p className="text-xs text-gray-400 mt-1">{MODEL_PLU_HINTS[deviceForm.model]}</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Port Name</label>
                        <div className="flex gap-2 relative">
                          <input
                            type="text"
                            value={deviceForm.portName}
                            onChange={e => { setDeviceForm(f => ({ ...f, portName: e.target.value })); setShowPortDropdown(false) }}
                            placeholder="/dev/ttyUSB0"
                            className={inputClass}
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={handleDetectPorts}
                            disabled={detectingPorts}
                          >
                            {detectingPorts ? 'Detecting...' : 'Detect Ports'}
                          </Button>
                        </div>
                        {showPortDropdown && detectedPorts.length > 0 && (
                          <div className="mt-1 border border-gray-200 rounded-lg bg-white shadow-sm">
                            {detectedPorts.map(port => (
                              <button
                                key={port}
                                type="button"
                                onClick={() => { setDeviceForm(f => ({ ...f, portName: port })); setShowPortDropdown(false) }}
                                className="block w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 font-mono"
                              >
                                {port}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">ACK Timeout (ms)</label>
                        <input
                          type="number"
                          value={deviceForm.ackTimeoutMs}
                          onChange={e => setDeviceForm(f => ({ ...f, ackTimeoutMs: Number(e.target.value) || 3000 }))}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Pour Release Mode</label>
                        <select
                          value={deviceForm.pourReleaseMode}
                          onChange={e => setDeviceForm(f => ({ ...f, pourReleaseMode: e.target.value }))}
                          className={inputClass}
                        >
                          <option value="BEST_EFFORT">Bar Friendly (Best Effort)</option>
                          <option value="REQUIRES_OPEN_ORDER">Requires Open Order</option>
                        </select>
                      </div>
                      {deviceForm.pourReleaseMode === 'REQUIRES_OPEN_ORDER' && (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">On Timeout</label>
                          <select
                            value={deviceForm.timeoutPolicy || 'ACK_ON_TIMEOUT'}
                            onChange={e => setDeviceForm(f => ({ ...f, timeoutPolicy: e.target.value }))}
                            className={inputClass}
                          >
                            <option value="ACK_ON_TIMEOUT">ACK on timeout (log uncertainty)</option>
                            <option value="NAK_ON_TIMEOUT">NAK on timeout (strictest)</option>
                          </select>
                          <p className="text-xs text-gray-400 mt-1">Only applies when Requires Open Order mode is active</p>
                        </div>
                      )}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Auto Ring</label>
                        <select
                          value={deviceForm.autoRingMode}
                          onChange={e => setDeviceForm(f => ({ ...f, autoRingMode: e.target.value }))}
                          className={inputClass}
                        >
                          <option value="AUTO_RING">Auto-Ring to Order</option>
                          <option value="OFF">Log Only</option>
                        </select>
                      </div>
                    </div>
                    {deviceForm.autoRingMode === 'AUTO_RING' && (
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="autoRingOnlySingle"
                          checked={deviceForm.autoRingOnlyWhenSingleOpenOrder ?? false}
                          onChange={e => setDeviceForm(f => ({ ...f, autoRingOnlyWhenSingleOpenOrder: e.target.checked }))}
                          className="rounded"
                        />
                        <label htmlFor="autoRingOnlySingle" className="text-sm">
                          Only auto-ring when single open ticket on terminal
                          <span className="block text-xs text-gray-400">Prevents ambiguous multi-tab pours</span>
                        </label>
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" onClick={handleAddDevice} disabled={savingDevice}>
                        {savingDevice ? 'Saving...' : editingDeviceId ? 'Update Device' : 'Save Device'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setShowAddDevice(false); setEditingDeviceId(null) }}>Cancel</Button>
                    </div>
                  </div>
                )}

                {/* Device List */}
                {devices.length === 0 && !showAddDevice ? (
                  <p className="text-sm text-gray-400">No devices registered. Click &quot;Add Device&quot; to connect Berg hardware.</p>
                ) : (
                  <div className="space-y-2">
                    {devices.map(d => {
                      const connected = isDeviceConnected(d.lastSeenAt)
                      const modelLabel = MODEL_OPTIONS.find(o => o.value === d.model)?.label ?? d.model
                      return (
                        <div key={d.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div>
                              <div className="text-sm font-medium text-gray-800">{d.name}</div>
                              <div className="text-xs text-gray-400">{d.portName}</div>
                            </div>
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                              {modelLabel}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${connected ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                              {connected ? 'Connected' : 'Idle'}
                            </span>
                            <button
                              onClick={() => listenDeviceId === d.id ? stopListening() : startListening(d.id)}
                              className={`px-2 py-0.5 rounded text-xs font-medium ${listenDeviceId === d.id ? 'bg-orange-100 text-orange-800 hover:bg-orange-200' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                              title="Stream raw packets from this device"
                            >
                              {listenDeviceId === d.id ? 'Stop' : 'Listen'}
                            </button>
                            <button onClick={() => openEditDevice(d)} className="text-blue-600 hover:underline text-xs">Edit</button>
                            <button onClick={() => handleDeactivateDevice(d.id)} className="text-red-500 hover:text-red-700 text-xs" title="Deactivate device">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Listen Mode Panel */}
            {listenDeviceId && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Live Packet Stream</CardTitle>
                      <p className="text-xs text-gray-400 mt-1">
                        Showing raw packets from {devices.find(d => d.id === listenDeviceId)?.name ?? listenDeviceId} &mdash; polling every 2s &mdash; auto-stops after 5 min
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={stopListening}>Stop Listening</Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div
                    ref={listenScrollRef}
                    className="bg-gray-950 rounded-b-lg overflow-y-auto max-h-80 font-mono text-xs text-green-400 p-3 space-y-0.5"
                  >
                    {listenEvents.length === 0 ? (
                      <div className="text-gray-500 py-4 text-center">Waiting for packets&hellip;</div>
                    ) : (
                      listenEvents.map((ev) => {
                        const ts = new Date(ev.receivedAt).toLocaleTimeString()
                        const lrcTag = ev.lrcValid ? '' : ' [BAD_LRC]'
                        const statusTag = ev.status === 'ACK' || ev.status === 'ACK_BEST_EFFORT' ? ' ACK' : ` ${ev.status}`
                        const pluDesc = ev.pluMapping?.description ? ` (${ev.pluMapping.description})` : ''
                        const latTag = ev.ackLatencyMs != null ? ` ${ev.ackLatencyMs}ms` : ''
                        return (
                          <div
                            key={ev.id}
                            className={`leading-5 ${!ev.lrcValid ? 'text-red-400' : ev.status === 'NAK' || ev.status === 'NAK_TIMEOUT' ? 'text-yellow-400' : 'text-green-400'}`}
                          >
                            <span className="text-gray-500">{ts}</span>
                            {' '}PLU <span className="font-bold">{ev.pluNumber}</span>
                            {pluDesc}
                            <span className="text-gray-300">{lrcTag}</span>
                            <span className={ev.status === 'ACK' || ev.status === 'ACK_BEST_EFFORT' ? 'text-green-300' : 'text-red-300'}>{statusTag}</span>
                            {latTag && <span className="text-gray-500">{latTag}</span>}
                            {ev.unmatchedType && <span className="text-orange-400"> [{ev.unmatchedType}]</span>}
                            <span className="text-gray-700 ml-2 text-xs">{ev.rawPacket}</span>
                          </div>
                        )
                      })
                    )}
                  </div>
                  <div className="px-3 py-2 text-xs text-gray-400 border-t border-gray-100">
                    {listenEvents.length} packet{listenEvents.length !== 1 ? 's' : ''} captured &mdash; last 100 shown
                  </div>
                </CardContent>
              </Card>
            )}

            {/* PLU Mapping Table */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>PLU Mappings</CardTitle>
                  <Button onClick={openAdd} size="sm">Add Mapping</Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* Add/Edit Form */}
                {showForm && (
                  <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
                    <div className="text-sm font-medium text-gray-700 mb-2">{editingId ? 'Edit Mapping' : 'Add Mapping'}</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">PLU Number</label>
                        <input
                          type="number"
                          value={form.pluNumber}
                          onChange={e => setForm(f => ({ ...f, pluNumber: e.target.value ? Number(e.target.value) : '' }))}
                          placeholder="e.g. 101"
                          className={inputClass}
                        />
                        {form.pluNumber !== '' && devices.length > 0 && (() => {
                          const warning = getPluRangeWarning(Number(form.pluNumber), devices[0].model)
                          return warning ? <p className="text-xs text-yellow-600 mt-1">{warning}</p> : null
                        })()}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                        <input
                          type="text"
                          value={form.description}
                          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                          placeholder="e.g. Tito's Vodka 1oz"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Menu Item ID</label>
                        <input
                          type="text"
                          value={form.menuItemId}
                          onChange={e => setForm(f => ({ ...f, menuItemId: e.target.value }))}
                          placeholder="Menu Item ID"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Pour Size Override (oz)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={form.pourSizeOz}
                          onChange={e => setForm(f => ({ ...f, pourSizeOz: e.target.value ? Number(e.target.value) : '' }))}
                          placeholder="e.g. 1.5"
                          className={inputClass}
                        />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={form.active}
                        onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                        className="rounded border-gray-300"
                      />
                      Active
                    </label>
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" onClick={handleSubmit}>{editingId ? 'Update' : 'Save'}</Button>
                      <Button size="sm" variant="outline" onClick={() => { setShowForm(false); setEditingId(null) }}>Cancel</Button>
                    </div>
                  </div>
                )}

                {/* Table */}
                {mappings.length === 0 ? (
                  <p className="text-sm text-gray-400">No PLU mappings yet. Click &quot;Add Mapping&quot; to get started.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-gray-500">
                          <th className="py-2 pr-3 font-medium">PLU #</th>
                          <th className="py-2 pr-3 font-medium">Description</th>
                          <th className="py-2 pr-3 font-medium">Mapped Item</th>
                          <th className="py-2 pr-3 font-medium">Pour Size (oz)</th>
                          <th className="py-2 pr-3 font-medium">Status</th>
                          <th className="py-2 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {mappings.map(m => (
                          <tr key={m.id}>
                            <td className="py-2 pr-3 font-mono">{m.pluNumber}</td>
                            <td className="py-2 pr-3">{m.description}</td>
                            <td className="py-2 pr-3 text-gray-500">{m.menuItemId ?? '—'}</td>
                            <td className="py-2 pr-3">{m.pourSizeOz != null ? `${m.pourSizeOz} oz` : '—'}</td>
                            <td className="py-2 pr-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${m.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                                {m.active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="py-2">
                              <div className="flex gap-2">
                                <button onClick={() => openEdit(m)} className="text-blue-600 hover:underline text-xs">Edit</button>
                                <button onClick={() => handleDelete(m.id)} className="text-red-600 hover:underline text-xs">Delete</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
