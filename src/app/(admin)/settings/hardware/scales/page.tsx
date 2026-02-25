'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { Modal } from '@/components/ui/modal'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAuthStore } from '@/stores/auth-store'

interface Scale {
  id: string
  name: string
  scaleType: string
  portPath: string
  baudRate: number
  dataBits: number
  parity: string
  stopBits: number
  weightUnit: string
  maxCapacity: number | null
  precision: number
  isActive: boolean
  isConnected: boolean
  lastSeenAt: string | null
  lastError: string | null
}

interface SerialPort {
  path: string
  manufacturer: string | null
  serialNumber: string | null
}

interface ScaleFormData {
  name: string
  scaleType: string
  portPath: string
  baudRate: number
  dataBits: number
  parity: string
  stopBits: number
  weightUnit: string
  maxCapacity: string
  precision: number
}

// Pre-fill serial settings based on scale type
const SCALE_TYPE_DEFAULTS: Record<string, Partial<ScaleFormData>> = {
  CAS_PD_II: {
    baudRate: 9600,
    dataBits: 7,
    parity: 'even',
    stopBits: 1,
  },
}

const DEFAULT_FORM_DATA: ScaleFormData = {
  name: '',
  scaleType: 'CAS_PD_II',
  portPath: '',
  baudRate: 9600,
  dataBits: 7,
  parity: 'even',
  stopBits: 1,
  weightUnit: 'lb',
  maxCapacity: '',
  precision: 2,
}

export default function ScalesPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id
  const [scales, setScales] = useState<Scale[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingScale, setEditingScale] = useState<Scale | null>(null)
  const [formData, setFormData] = useState<ScaleFormData>(DEFAULT_FORM_DATA)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [availablePorts, setAvailablePorts] = useState<SerialPort[]>([])
  const [portsLoading, setPortsLoading] = useState(false)
  const [manualPort, setManualPort] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null)

  const fetchScales = useCallback(async () => {
    if (!locationId) return
    try {
      const res = await fetch(`/api/scales?locationId=${locationId}`)
      if (res.ok) {
        const raw = await res.json()
        setScales(raw.data || [])
      }
    } catch (err) {
      console.error('Failed to fetch scales:', err)
    } finally {
      setLoading(false)
    }
  }, [locationId])

  const fetchPorts = useCallback(async () => {
    setPortsLoading(true)
    try {
      const res = await fetch('/api/system/serial-ports')
      if (res.ok) {
        const raw = await res.json()
        setAvailablePorts(raw.data?.ports || [])
      }
    } catch (err) {
      console.error('Failed to fetch serial ports:', err)
    } finally {
      setPortsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchScales()
  }, [fetchScales])

  const handleAddScale = () => {
    setEditingScale(null)
    setFormData(DEFAULT_FORM_DATA)
    setManualPort(false)
    setError('')
    setShowModal(true)
    fetchPorts()
  }

  const handleEditScale = (scale: Scale) => {
    setEditingScale(scale)
    setFormData({
      name: scale.name,
      scaleType: scale.scaleType,
      portPath: scale.portPath,
      baudRate: scale.baudRate,
      dataBits: scale.dataBits,
      parity: scale.parity,
      stopBits: scale.stopBits,
      weightUnit: scale.weightUnit,
      maxCapacity: scale.maxCapacity != null ? String(scale.maxCapacity) : '',
      precision: scale.precision,
    })
    setManualPort(false)
    setError('')
    setShowModal(true)
    fetchPorts()
  }

  const handleScaleTypeChange = (scaleType: string) => {
    const defaults = SCALE_TYPE_DEFAULTS[scaleType] || {}
    setFormData({
      ...formData,
      scaleType,
      ...defaults,
    })
  }

  const handleSave = async () => {
    if (!formData.name.trim()) {
      setError('Name is required')
      return
    }
    if (!formData.portPath.trim()) {
      setError('Port path is required')
      return
    }

    setSaving(true)
    setError('')

    try {
      const url = editingScale
        ? `/api/scales/${editingScale.id}`
        : '/api/scales'
      const method = editingScale ? 'PUT' : 'POST'

      const payload: Record<string, unknown> = {
        name: formData.name.trim(),
        scaleType: formData.scaleType,
        portPath: formData.portPath.trim(),
        baudRate: formData.baudRate,
        dataBits: formData.dataBits,
        parity: formData.parity,
        stopBits: formData.stopBits,
        weightUnit: formData.weightUnit,
        precision: formData.precision,
      }

      if (formData.maxCapacity.trim()) {
        payload.maxCapacity = parseFloat(formData.maxCapacity)
      } else if (editingScale) {
        payload.maxCapacity = null
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        setShowModal(false)
        fetchScales()
        toast.success(editingScale ? 'Scale updated' : 'Scale added')
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to save scale')
      }
    } catch {
      setError('Failed to save scale')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (scale: Scale) => {
    if (!confirm(`Delete scale "${scale.name}"?`)) return

    try {
      const res = await fetch(`/api/scales/${scale.id}`, { method: 'DELETE' })
      if (res.ok) {
        fetchScales()
        toast.success('Scale deleted')
      }
    } catch {
      toast.error('Failed to delete scale')
    }
  }

  const handleTestConnection = async (scale: Scale) => {
    setTestingId(scale.id)
    setTestResult(null)

    try {
      const res = await fetch(`/api/scales/${scale.id}/test`, { method: 'POST' })
      const raw = await res.json()

      if (res.ok && raw.data) {
        const reading = raw.data
        setTestResult({
          id: scale.id,
          success: true,
          message: `Weight: ${reading.weight} ${reading.unit} ${reading.stable ? '(stable)' : '(unstable)'}`,
        })
      } else {
        setTestResult({
          id: scale.id,
          success: false,
          message: raw.error || 'Connection failed',
        })
      }

      fetchScales()
    } catch {
      setTestResult({
        id: scale.id,
        success: false,
        message: 'Test failed — scale may not be connected',
      })
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <AdminPageHeader
        title="Scales"
        subtitle="Configure weight scales for sold-by-weight items"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Hardware', href: '/settings/hardware' },
        ]}
        actions={
          <button
            onClick={handleAddScale}
            className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
          >
            + Add Scale
          </button>
        }
      />

      <div className="mx-auto max-w-4xl">
        {loading ? (
          <div className="flex h-64 items-center justify-center rounded-xl bg-white shadow">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></div>
          </div>
        ) : scales.length === 0 ? (
          <div className="rounded-xl bg-white p-8 text-center shadow">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
            </svg>
            <h3 className="mt-2 text-lg font-medium text-gray-900">No scales configured</h3>
            <p className="mt-1 text-gray-500">Add your first scale to enable weight-based selling</p>
            <button
              onClick={handleAddScale}
              className="mt-4 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
            >
              Add Scale
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {scales.map((scale) => (
              <div
                key={scale.id}
                className={`rounded-xl bg-white p-4 shadow ${!scale.isActive ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-3 w-3 rounded-full ${scale.isConnected ? 'bg-green-500' : 'bg-red-500'}`}
                      title={scale.isConnected ? 'Connected' : 'Disconnected'}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-gray-900">{scale.name}</h3>
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
                          {scale.scaleType.replace(/_/g, ' ')}
                        </span>
                        {!scale.isActive && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                            Disabled
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-gray-600">
                        {scale.portPath} • {scale.baudRate} baud • {scale.weightUnit}
                        {scale.maxCapacity != null && ` • max ${scale.maxCapacity}${scale.weightUnit}`}
                      </p>
                      {scale.lastSeenAt && (
                        <p className="mt-1 text-xs text-gray-400">
                          Last seen: {new Date(scale.lastSeenAt).toLocaleString()}
                        </p>
                      )}
                      {scale.lastError && (
                        <p className="mt-1 text-xs text-red-500">
                          Last error: {scale.lastError}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEditScale(scale)}
                      className="rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(scale)}
                      className="rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Test Result */}
                {testResult?.id === scale.id && (
                  <div
                    className={`mt-3 flex items-center gap-2 rounded-lg p-2 text-sm ${
                      testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                    }`}
                  >
                    {testResult.success ? (
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    ) : (
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                    {testResult.message}
                  </div>
                )}

                {/* Actions */}
                <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                  <button
                    onClick={() => handleTestConnection(scale)}
                    disabled={testingId === scale.id}
                    className="rounded bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                  >
                    {testingId === scale.id ? 'Testing...' : 'Test Connection'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingScale ? 'Edit Scale' : 'Add Scale'} size="lg">
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              placeholder="Deli Scale"
            />
          </div>

          {/* Scale Type */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Scale Type</label>
            <select
              value={formData.scaleType}
              onChange={(e) => handleScaleTypeChange(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            >
              <option value="CAS_PD_II">CAS PD-II</option>
            </select>
            <p className="mt-1 text-xs text-gray-400">Serial settings auto-fill based on scale type</p>
          </div>

          {/* Port Path */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Serial Port</label>
            {!manualPort ? (
              <div className="space-y-2">
                <select
                  value={formData.portPath}
                  onChange={(e) => setFormData({ ...formData, portPath: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                  disabled={portsLoading}
                >
                  <option value="">{portsLoading ? 'Scanning ports...' : 'Select a port'}</option>
                  {availablePorts.map((p) => (
                    <option key={p.path} value={p.path}>
                      {p.path}{p.manufacturer ? ` (${p.manufacturer})` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setManualPort(true)}
                  className="text-xs text-blue-500 hover:text-blue-700"
                >
                  Enter path manually
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  value={formData.portPath}
                  onChange={(e) => setFormData({ ...formData, portPath: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono focus:border-blue-500 focus:outline-none"
                  placeholder="/dev/ttyUSB0"
                />
                <button
                  type="button"
                  onClick={() => { setManualPort(false); fetchPorts() }}
                  className="text-xs text-blue-500 hover:text-blue-700"
                >
                  Scan for ports
                </button>
              </div>
            )}
          </div>

          {/* Serial Settings */}
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Baud Rate</label>
              <input
                type="number"
                value={formData.baudRate}
                onChange={(e) => setFormData({ ...formData, baudRate: parseInt(e.target.value) || 9600 })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Data Bits</label>
              <select
                value={formData.dataBits}
                onChange={(e) => setFormData({ ...formData, dataBits: parseInt(e.target.value) })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              >
                <option value={5}>5</option>
                <option value={6}>6</option>
                <option value={7}>7</option>
                <option value={8}>8</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Parity</label>
              <select
                value={formData.parity}
                onChange={(e) => setFormData({ ...formData, parity: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              >
                <option value="none">None</option>
                <option value="even">Even</option>
                <option value="odd">Odd</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Stop Bits</label>
              <select
                value={formData.stopBits}
                onChange={(e) => setFormData({ ...formData, stopBits: parseInt(e.target.value) })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </div>
          </div>

          {/* Weight Settings */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Weight Unit</label>
              <select
                value={formData.weightUnit}
                onChange={(e) => setFormData({ ...formData, weightUnit: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              >
                <option value="lb">Pounds (lb)</option>
                <option value="kg">Kilograms (kg)</option>
                <option value="oz">Ounces (oz)</option>
                <option value="g">Grams (g)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Max Capacity</label>
              <input
                type="number"
                value={formData.maxCapacity}
                onChange={(e) => setFormData({ ...formData, maxCapacity: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                placeholder="Optional"
                step="0.01"
                min="0"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Precision</label>
              <select
                value={formData.precision}
                onChange={(e) => setFormData({ ...formData, precision: parseInt(e.target.value) })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              >
                <option value={0}>0 decimal places</option>
                <option value={1}>1 decimal place</option>
                <option value={2}>2 decimal places</option>
                <option value={3}>3 decimal places</option>
              </select>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={() => setShowModal(false)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? 'Saving...' : editingScale ? 'Save Changes' : 'Add Scale'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
