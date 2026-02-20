'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import {
  CreditCardIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  SignalIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PencilIcon,
  TrashIcon,
  PlusCircleIcon,
  ComputerDesktopIcon,
  WifiIcon,
  SpeakerWaveIcon,
  BoltIcon,
} from '@heroicons/react/24/outline'
import { toast } from '@/stores/toast-store'
import { useAuthStore } from '@/stores/auth-store'

// ─── Types ────────────────────────────────────────────────────────────────────

type ConnectionType = 'USB' | 'IP' | 'BLUETOOTH' | 'WIFI'

interface RegisteredReader {
  id: string
  name: string
  serialNumber: string
  serialNumberMasked: string
  connectionType: ConnectionType
  ipAddress: string
  port: number
  communicationMode: string
  isActive: boolean
  isOnline: boolean
  lastSeenAt: string | null
  lastError: string | null
  firmwareVersion: string | null
  avgResponseTime: number | null
  successRate: number | null
  merchantId: string | null
  terminals: { id: string; name: string; category: string }[]
}

interface ScannedDevice {
  serialNumber: string
  model?: string
  vendor?: string
  ipAddress?: string
  port?: number
  connectionType: ConnectionType
  alreadyRegistered: boolean
  registeredAs: string | null
  readerId: string | null
}

interface Terminal {
  id: string
  name: string
  category: string
  paymentReaderId: string | null
}

interface RegisterFormData {
  name: string
  connectionType: ConnectionType
  ipAddress: string
  port: number
  assignTerminalIds: string[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CONNECTION_LABELS: Record<ConnectionType, string> = {
  USB: 'USB',
  IP: 'Network / IP',
  BLUETOOTH: 'Bluetooth',
  WIFI: 'Wi-Fi',
}

const CONNECTION_COLORS: Record<ConnectionType, string> = {
  USB: 'bg-blue-100 text-blue-700',
  IP: 'bg-green-100 text-green-700',
  BLUETOOTH: 'bg-purple-100 text-purple-700',
  WIFI: 'bg-cyan-100 text-cyan-700',
}

const CONNECTION_ICONS: Record<ConnectionType, React.ReactNode> = {
  USB: <ComputerDesktopIcon className="w-3 h-3" />,
  IP: <SignalIcon className="w-3 h-3" />,
  BLUETOOTH: <WifiIcon className="w-3 h-3" />,
  WIFI: <WifiIcon className="w-3 h-3" />,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ConnectionBadge({ type }: { type: ConnectionType }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${CONNECTION_COLORS[type]}`}>
      {CONNECTION_ICONS[type]}
      {CONNECTION_LABELS[type]}
    </span>
  )
}

function StatusDot({ online }: { online: boolean }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${online ? 'bg-green-500' : 'bg-gray-300'}`} />
  )
}

function formatLastSeen(dateString: string | null): string {
  if (!dateString) return 'Never seen'
  const diff = Date.now() - new Date(dateString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return new Date(dateString).toLocaleDateString()
}

// ─── Register / Edit Modal ────────────────────────────────────────────────────

interface ReaderModalProps {
  mode: 'register' | 'edit'
  scanned?: ScannedDevice
  existing?: RegisteredReader
  terminals: Terminal[]
  locationId: string
  onClose: () => void
  onSaved: () => void
}

function ReaderModal({ mode, scanned, existing, terminals, locationId, onClose, onSaved }: ReaderModalProps) {
  const isEdit = mode === 'edit'
  const prefilled = scanned || existing

  const [form, setForm] = useState<RegisterFormData>({
    name: existing?.name ?? '',
    connectionType: scanned?.connectionType ?? existing?.connectionType ?? 'IP',
    ipAddress: scanned?.ipAddress ?? (existing?.connectionType === 'IP' || existing?.connectionType === 'WIFI' ? existing?.ipAddress ?? '' : '') ?? '',
    port: scanned?.port ?? existing?.port ?? 8080,
    assignTerminalIds: existing?.terminals.map(t => t.id) ?? [],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isNetworkType = form.connectionType === 'IP' || form.connectionType === 'WIFI'

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return }
    if (isNetworkType && !form.ipAddress) { setError('IP address is required for network readers'); return }
    setSaving(true)
    setError('')
    try {
      let url = '/api/hardware/payment-readers'
      let method = 'POST'
      let body: Record<string, unknown> = {
        locationId,
        name: form.name.trim(),
        connectionType: form.connectionType,
        ipAddress: form.ipAddress,
        port: form.port,
        assignTerminalIds: form.assignTerminalIds,
      }

      if (isEdit && existing) {
        url = `/api/hardware/payment-readers/${existing.id}`
        method = 'PUT'
      } else {
        // New reader — add serial from scanned device
        body.serialNumber = scanned?.serialNumber ?? ''
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      toast.success(isEdit ? 'Reader updated' : 'Reader registered')
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {isEdit ? 'Edit Reader' : 'Register Reader'}
            </h2>
            {prefilled && (
              <p className="text-sm text-gray-500 font-mono mt-0.5">
                SN: {isEdit ? existing?.serialNumber : scanned?.serialNumber}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
            <XCircleIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
          )}

          {/* Device info for new registration */}
          {!isEdit && scanned && (
            <div className="p-3 bg-blue-50 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-blue-900">{scanned.model || 'Payment Reader'}</span>
                <ConnectionBadge type={scanned.connectionType} />
              </div>
              <p className="text-xs text-blue-600 mt-1">{scanned.vendor}</p>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reader Name <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder={scanned?.model ? `${scanned.model} - Bar` : 'Bar Reader 1'}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              autoFocus
            />
          </div>

          {/* Connection type — always selectable */}
          {scanned ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Connection Type</label>
              <div className="flex items-center gap-2">
                <ConnectionBadge type={form.connectionType} />
                <span className="text-xs text-gray-500">(detected from scan)</span>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Connection Type</label>
              <select
                value={form.connectionType}
                onChange={e => setForm(f => ({ ...f, connectionType: e.target.value as ConnectionType }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="USB">USB</option>
                <option value="IP">Network / IP</option>
                <option value="WIFI">Wi-Fi</option>
                <option value="BLUETOOTH">Bluetooth</option>
              </select>
            </div>
          )}

          {/* IP settings — only for network types */}
          {isNetworkType && (
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">IP Address <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.ipAddress}
                  onChange={e => setForm(f => ({ ...f, ipAddress: e.target.value }))}
                  placeholder="192.168.1.50"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
                <input
                  type="number"
                  value={form.port}
                  onChange={e => setForm(f => ({ ...f, port: parseInt(e.target.value) || 8080 }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                />
              </div>
            </div>
          )}

          {/* USB info */}
          {form.connectionType === 'USB' && (
            <div className="p-3 bg-amber-50 rounded-lg text-sm text-amber-800">
              USB readers connect via Datacap DC Direct (local middleware on port 8080). No IP address needed — DC Direct is installed on this station.
            </div>
          )}

          {/* Assign to Terminals */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Assign to Terminals</label>
            {terminals.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No terminals configured yet</p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {terminals.map(t => (
                  <label key={t.id} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.assignTerminalIds.includes(t.id)}
                      onChange={e => {
                        setForm(f => ({
                          ...f,
                          assignTerminalIds: e.target.checked
                            ? [...f.assignTerminalIds, t.id]
                            : f.assignTerminalIds.filter(id => id !== t.id),
                        }))
                      }}
                      className="rounded text-blue-600"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900">{t.name}</span>
                      <span className="text-xs text-gray-400 ml-1.5">{t.category.replace('_', ' ')}</span>
                      {t.paymentReaderId && t.paymentReaderId !== existing?.id && (
                        <span className="text-xs text-amber-600 ml-1.5">(has reader)</span>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 p-5 pt-0">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <ArrowPathIcon className="w-4 h-4 animate-spin" />}
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Register Reader'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PaymentReadersPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id

  const [readers, setReaders] = useState<RegisteredReader[]>([])
  const [terminals, setTerminals] = useState<Terminal[]>([])
  const [loadingReaders, setLoadingReaders] = useState(true)

  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<{ usb: ScannedDevice[]; network: ScannedDevice[] } | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [scanError, setScanError] = useState('')

  const [modal, setModal] = useState<{
    mode: 'register' | 'edit'
    scanned?: ScannedDevice
    existing?: RegisteredReader
  } | null>(null)

  const [pingingId, setPingingId] = useState<string | null>(null)
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [initializingId, setInitializingId] = useState<string | null>(null)

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const fetchReaders = useCallback(async () => {
    if (!locationId) return
    try {
      const res = await fetch(`/api/hardware/payment-readers?locationId=${locationId}`)
      if (res.ok) {
        const data = await res.json()
        setReaders(data.data.readers || [])
      }
    } finally {
      setLoadingReaders(false)
    }
  }, [locationId])

  const fetchTerminals = useCallback(async () => {
    if (!locationId) return
    try {
      const res = await fetch(`/api/hardware/terminals?locationId=${locationId}`)
      if (res.ok) {
        const data = await res.json()
        setTerminals(data.data?.terminals || data.data || [])
      }
    } catch {}
  }, [locationId])

  useEffect(() => {
    fetchReaders()
    fetchTerminals()
  }, [fetchReaders, fetchTerminals])

  // ─── Scan ──────────────────────────────────────────────────────────────────

  const handleScan = async () => {
    if (!locationId) return
    setScanning(true)
    setScanError('')
    setScanOpen(true)
    try {
      const res = await fetch(`/api/hardware/payment-readers/scan?locationId=${locationId}&networkTimeoutMs=4000`)
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Scan failed')
      }
      const data = await res.json()
      setScanResults(data.data)
      if (data.data.total === 0) setScanError('No readers found. Make sure USB readers are plugged in or network readers are powered on.')
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  // ─── Reader Actions ────────────────────────────────────────────────────────

  const handlePing = async (reader: RegisteredReader) => {
    setPingingId(reader.id)
    try {
      const res = await fetch(`/api/hardware/payment-readers/${reader.id}/ping`, { method: 'POST' })
      const data = await res.json()
      if (data.data?.isOnline) {
        toast.success(`${reader.name} is online (${data.data.responseTimeMs}ms)`)
      } else {
        toast.error(`${reader.name} offline: ${data.data?.error || 'No response'}`)
      }
      await fetchReaders()
    } catch {
      toast.error('Ping failed')
    } finally {
      setPingingId(null)
    }
  }

  const handleVerify = async (reader: RegisteredReader) => {
    setVerifyingId(reader.id)
    try {
      const res = await fetch(`/api/hardware/payment-readers/${reader.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerBeep: true }),
      })
      const data = await res.json()
      if (data.verified) {
        toast.success(`${reader.name} verified — serial matches!`)
      } else {
        toast.error(`Verification failed: ${data.error || 'Serial mismatch'}`)
      }
      await fetchReaders()
    } catch {
      toast.error('Verify failed')
    } finally {
      setVerifyingId(null)
    }
  }

  const handleToggleActive = async (reader: RegisteredReader) => {
    setTogglingId(reader.id)
    try {
      const res = await fetch(`/api/hardware/payment-readers/${reader.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !reader.isActive }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Update failed')
      }
      toast.success(reader.isActive ? `${reader.name} disabled` : `${reader.name} enabled`)
      await fetchReaders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setTogglingId(null)
    }
  }

  const handleInitialize = async (reader: RegisteredReader) => {
    setInitializingId(reader.id)
    try {
      // Step 1: pad-reset to clear any degraded state
      await fetch('/api/datacap/pad-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: locationId!, readerId: reader.id }),
      })
      // Step 2: EMVParamDownload — required once on every new Datacap reader
      const res = await fetch('/api/datacap/param-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: locationId!, readerId: reader.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Initialization failed')
      toast.success(`${reader.name} initialized — ready to accept payments`)
      await fetchReaders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Initialization failed')
    } finally {
      setInitializingId(null)
    }
  }

  const handleDelete = async (reader: RegisteredReader) => {
    if (!confirm(`Delete "${reader.name}"? This cannot be undone.`)) return
    setDeletingId(reader.id)
    try {
      const res = await fetch(`/api/hardware/payment-readers/${reader.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Delete failed')
      }
      toast.success('Reader removed')
      await fetchReaders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  const allScanned = scanResults ? [...scanResults.usb, ...scanResults.network] : []
  const unregisteredScanned = allScanned.filter(d => !d.alreadyRegistered)
  const alreadyRegisteredScanned = allScanned.filter(d => d.alreadyRegistered)

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loadingReaders) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6 max-w-4xl mx-auto">
        <AdminPageHeader
          title="Payment Readers"
          subtitle="Scan for readers and assign them to terminals"
          breadcrumbs={[
            { label: 'Settings', href: '/settings' },
            { label: 'Hardware', href: '/settings/hardware' },
          ]}
          actions={
            <button
              onClick={handleScan}
              disabled={scanning}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors font-medium text-sm"
            >
              {scanning
                ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
                : <MagnifyingGlassIcon className="w-4 h-4" />
              }
              {scanning ? 'Scanning...' : 'Scan for Readers'}
            </button>
          }
        />

        {/* ── Scan Results Panel ── */}
        {(scanning || scanResults !== null || scanError) && (
          <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 overflow-hidden">
            {/* Scan header */}
            <button
              onClick={() => setScanOpen(o => !o)}
              className="w-full flex items-center justify-between px-5 py-3"
            >
              <div className="flex items-center gap-2">
                {scanning
                  ? <ArrowPathIcon className="w-4 h-4 text-blue-600 animate-spin" />
                  : scanError
                    ? <XCircleIcon className="w-4 h-4 text-amber-500" />
                    : <CheckCircleIcon className="w-4 h-4 text-blue-600" />
                }
                <span className="text-sm font-semibold text-blue-900">
                  {scanning
                    ? 'Scanning USB and network...'
                    : scanError
                      ? 'Scan complete'
                      : `Found ${allScanned.length} reader${allScanned.length !== 1 ? 's' : ''}`
                  }
                </span>
                {!scanning && unregisteredScanned.length > 0 && (
                  <span className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded-full font-medium">
                    {unregisteredScanned.length} new
                  </span>
                )}
              </div>
              {!scanning && (
                scanOpen
                  ? <ChevronUpIcon className="w-4 h-4 text-blue-600" />
                  : <ChevronDownIcon className="w-4 h-4 text-blue-600" />
              )}
            </button>

            {/* Scan body */}
            {scanOpen && !scanning && (
              <div className="border-t border-blue-200 bg-white px-5 py-4 space-y-3">
                {scanError && (
                  <p className="text-sm text-amber-700">{scanError}</p>
                )}

                {unregisteredScanned.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">New — Ready to Register</p>
                    <div className="space-y-2">
                      {unregisteredScanned.map(d => (
                        <div key={d.serialNumber} className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg">
                          <div className="flex items-center gap-3">
                            <CreditCardIcon className="w-8 h-8 text-gray-300" />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-gray-900">{d.model || 'Payment Reader'}</span>
                                <ConnectionBadge type={d.connectionType} />
                              </div>
                              <p className="text-xs text-gray-500 font-mono mt-0.5">
                                SN: {d.serialNumber}
                                {d.ipAddress && ` · ${d.ipAddress}:${d.port}`}
                              </p>
                              {d.vendor && <p className="text-xs text-gray-400">{d.vendor}</p>}
                            </div>
                          </div>
                          <button
                            onClick={() => setModal({ mode: 'register', scanned: d })}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
                          >
                            <PlusCircleIcon className="w-4 h-4" />
                            Register
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {alreadyRegisteredScanned.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Already Registered</p>
                    <div className="space-y-1">
                      {alreadyRegisteredScanned.map(d => (
                        <div key={d.serialNumber} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg">
                          <CheckCircleIcon className="w-4 h-4 text-green-500 flex-shrink-0" />
                          <span className="text-sm text-gray-700 font-medium">{d.registeredAs}</span>
                          <ConnectionBadge type={d.connectionType} />
                          <span className="text-xs text-gray-400 font-mono">...{d.serialNumber.slice(-8)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Registered Readers ── */}
        {readers.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border-2 border-dashed border-gray-200">
            <CreditCardIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 font-medium mb-1">No readers registered</p>
            <p className="text-sm text-gray-400">
              Click <strong>Scan for Readers</strong> to find connected devices
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Registered Readers ({readers.length})
            </p>
            {readers.map(reader => (
              <div
                key={reader.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
              >
                {/* Reader header row */}
                <div className="flex items-center gap-4 px-5 py-4">
                  {/* Status + Icon */}
                  <div className="relative flex-shrink-0">
                    <CreditCardIcon className="w-9 h-9 text-gray-300" />
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${reader.isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                  </div>

                  {/* Name + badges */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-base font-semibold ${reader.isActive ? 'text-gray-900' : 'text-gray-400'}`}>{reader.name}</span>
                      <ConnectionBadge type={reader.connectionType} />
                      {reader.communicationMode === 'simulated' && (
                        <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded-full font-medium">SIMULATED</span>
                      )}
                      {!reader.isActive && (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded-full">Disabled</span>
                      )}
                    </div>

                    {/* Serial + connection details */}
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="text-xs text-gray-500 font-mono">
                        SN: ...{reader.serialNumber.slice(-8)}
                      </span>
                      {(reader.connectionType === 'IP' || reader.connectionType === 'WIFI') && (
                        <span className="text-xs text-gray-400 font-mono">{reader.ipAddress}:{reader.port}</span>
                      )}
                      {reader.merchantId ? (
                        <span className="text-xs font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded" title="Datacap Merchant ID — managed by GWI">
                          MID: {reader.merchantId}
                        </span>
                      ) : (
                        <span className="text-xs text-red-500 bg-red-50 px-1.5 py-0.5 rounded" title="No Merchant ID set — contact GWI to provision">
                          MID: not set
                        </span>
                      )}
                      {reader.firmwareVersion && (
                        <span className="text-xs text-gray-400">FW: {reader.firmwareVersion}</span>
                      )}
                      {reader.avgResponseTime && (
                        <span className="text-xs text-gray-400">{reader.avgResponseTime}ms</span>
                      )}
                      <span className="text-xs text-gray-400">{formatLastSeen(reader.lastSeenAt)}</span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {reader.communicationMode !== 'simulated' && (
                      <>
                        <button
                          onClick={() => handlePing(reader)}
                          disabled={pingingId === reader.id}
                          title="Ping reader"
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {pingingId === reader.id
                            ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
                            : <SignalIcon className="w-4 h-4" />
                          }
                        </button>
                        <button
                          onClick={() => handleVerify(reader)}
                          disabled={verifyingId === reader.id}
                          title="Verify serial (beep)"
                          className="p-2 text-gray-400 hover:text-cyan-600 hover:bg-cyan-50 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {verifyingId === reader.id
                            ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
                            : <SpeakerWaveIcon className="w-4 h-4" />
                          }
                        </button>
                      </>
                    )}
                    {/* Enable / Disable toggle */}
                    <button
                      onClick={() => handleToggleActive(reader)}
                      disabled={togglingId === reader.id}
                      title={reader.isActive ? 'Disable reader' : 'Enable reader'}
                      className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${
                        reader.isActive
                          ? 'text-green-600 hover:text-gray-500 hover:bg-gray-100'
                          : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
                      }`}
                    >
                      {togglingId === reader.id
                        ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
                        : <CheckCircleIcon className="w-4 h-4" />
                      }
                    </button>
                    {reader.communicationMode !== 'simulated' && (
                      <button
                        onClick={() => handleInitialize(reader)}
                        disabled={initializingId === reader.id}
                        title="Initialize reader (EMVParamDownload) — run once on first setup or after factory reset"
                        className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {initializingId === reader.id
                          ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
                          : <BoltIcon className="w-4 h-4" />
                        }
                      </button>
                    )}
                    <button
                      onClick={() => setModal({ mode: 'edit', existing: reader })}
                      title="Edit reader"
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <PencilIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(reader)}
                      disabled={deletingId === reader.id}
                      title="Remove reader"
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {deletingId === reader.id
                        ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
                        : <TrashIcon className="w-4 h-4" />
                      }
                    </button>
                  </div>
                </div>

                {/* Error bar */}
                {reader.lastError && !reader.isOnline && (
                  <div className="px-5 py-2 bg-red-50 border-t border-red-100 text-xs text-red-600 flex items-center gap-2">
                    <XCircleIcon className="w-3.5 h-3.5 flex-shrink-0" />
                    {reader.lastError}
                  </div>
                )}

                {/* Terminal assignments */}
                <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center gap-3">
                  <span className="text-xs text-gray-400 font-medium flex-shrink-0">
                    {reader.terminals.length > 0 ? 'Assigned to:' : 'Not assigned'}
                  </span>
                  {reader.terminals.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {reader.terminals.map(t => (
                        <span key={t.id} className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-md">
                          {t.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <button
                      onClick={() => setModal({ mode: 'edit', existing: reader })}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                      Assign to terminal →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {modal && locationId && (
        <ReaderModal
          mode={modal.mode}
          scanned={modal.scanned}
          existing={modal.existing}
          terminals={terminals}
          locationId={locationId}
          onClose={() => setModal(null)}
          onSaved={() => {
            fetchReaders()
            fetchTerminals()
            // Refresh scan results to update alreadyRegistered flags
            if (scanResults) handleScan()
          }}
        />
      )}
    </div>
  )
}
