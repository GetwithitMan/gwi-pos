'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Modal } from '@/components/ui/modal'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import {
  CreditCardIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  SignalIcon,
  SpeakerWaveIcon,
} from '@heroicons/react/24/outline'
import { toast } from '@/stores/toast-store'
import { useAuthStore } from '@/stores/auth-store'

interface PaymentReader {
  id: string
  name: string
  serialNumber: string
  serialNumberMasked: string
  ipAddress: string
  port: number
  verificationType: 'SERIAL_HANDSHAKE' | 'IP_ONLY'
  isActive: boolean
  isOnline: boolean
  lastSeenAt: string | null
  lastError: string | null
  firmwareVersion: string | null
  avgResponseTime: number | null
  successRate: number | null
  terminals: { id: string; name: string; category: string }[]
}

interface ReaderFormData {
  name: string
  serialNumber: string
  ipAddress: string
  port: number
  verificationType: 'SERIAL_HANDSHAKE' | 'IP_ONLY'
}

const DEFAULT_FORM_DATA: ReaderFormData = {
  name: '',
  serialNumber: '',
  ipAddress: '',
  port: 8080,
  verificationType: 'SERIAL_HANDSHAKE',
}

export default function PaymentReadersPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id
  const [readers, setReaders] = useState<PaymentReader[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingReader, setEditingReader] = useState<PaymentReader | null>(null)
  const [formData, setFormData] = useState<ReaderFormData>(DEFAULT_FORM_DATA)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pingingId, setPingingId] = useState<string | null>(null)
  const [verifyingId, setVerifyingId] = useState<string | null>(null)

  const fetchReaders = useCallback(async () => {
    if (!locationId) return
    try {
      const res = await fetch(`/api/hardware/payment-readers?locationId=${locationId}`)
      if (res.ok) {
        const data = await res.json()
        setReaders(data.data.readers || [])
      }
    } catch (error) {
      console.error('Failed to fetch payment readers:', error)
    } finally {
      setLoading(false)
    }
  }, [locationId])

  useEffect(() => {
    fetchReaders()
  }, [fetchReaders])

  const handleAddReader = () => {
    setEditingReader(null)
    setFormData(DEFAULT_FORM_DATA)
    setError('')
    setShowModal(true)
  }

  const handleEditReader = (reader: PaymentReader) => {
    setEditingReader(reader)
    setFormData({
      name: reader.name,
      serialNumber: reader.serialNumber,
      ipAddress: reader.ipAddress,
      port: reader.port,
      verificationType: reader.verificationType,
    })
    setError('')
    setShowModal(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')

    try {
      const url = editingReader
        ? `/api/hardware/payment-readers/${editingReader.id}`
        : '/api/hardware/payment-readers'

      const res = await fetch(url, {
        method: editingReader ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          ...formData,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save reader')
      }

      await fetchReaders()
      setShowModal(false)
      toast.success(editingReader ? 'Reader updated' : 'Reader added')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this reader?')) return

    try {
      const res = await fetch(`/api/hardware/payment-readers/${id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete')
      }

      await fetchReaders()
      toast.success('Reader deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const handlePing = async (reader: PaymentReader) => {
    setPingingId(reader.id)
    try {
      const res = await fetch(`/api/hardware/payment-readers/${reader.id}/ping`, {
        method: 'POST',
      })
      const data = await res.json()

      if (data.isOnline) {
        toast.success(`${reader.name} is online (${data.responseTimeMs}ms)`)
      } else {
        toast.error(`${reader.name} is offline: ${data.error}`)
      }

      await fetchReaders()
    } catch (err) {
      toast.error('Failed to ping reader')
    } finally {
      setPingingId(null)
    }
  }

  const handleVerify = async (reader: PaymentReader) => {
    setVerifyingId(reader.id)
    try {
      const res = await fetch(`/api/hardware/payment-readers/${reader.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerBeep: true }),
      })
      const data = await res.json()

      if (data.verified) {
        toast.success(`${reader.name} verified - serial matches!`)
      } else if (data.isOnline && !data.serialMatch) {
        toast.error(`Serial mismatch! Expected: ${reader.serialNumber.slice(-6)}`)
      } else {
        toast.error(`Verification failed: ${data.error}`)
      }

      await fetchReaders()
    } catch (err) {
      toast.error('Failed to verify reader')
    } finally {
      setVerifyingId(null)
    }
  }

  const formatLastSeen = (dateString: string | null) => {
    if (!dateString) return 'Never'
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`
    return date.toLocaleDateString()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Payment Readers"
        subtitle="Datacap Direct card readers for payment processing"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Hardware', href: '/settings/hardware' },
        ]}
        actions={
          <button
            onClick={handleAddReader}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <PlusIcon className="w-5 h-5" />
            Add Reader
          </button>
        }
      />

      {/* Reader Grid */}
      {readers.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
          <CreditCardIcon className="w-12 h-12 mx-auto text-gray-400 mb-3" />
          <p className="text-gray-500 mb-2">No payment readers configured</p>
          <button
            onClick={handleAddReader}
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            Add your first reader
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {readers.map((reader) => (
            <div
              key={reader.id}
              className={`rounded-xl border p-4 transition-all ${
                reader.isOnline
                  ? 'bg-white border-gray-200 shadow-sm'
                  : 'bg-gray-50 border-gray-200'
              }`}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      reader.isOnline ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  />
                  <h3 className="font-semibold text-gray-900">{reader.name}</h3>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleEditReader(reader)}
                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Edit"
                  >
                    <PencilIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(reader.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Details */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">IP Address</span>
                  <span className="font-mono text-gray-700">
                    {reader.ipAddress}:{reader.port}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Serial</span>
                  <span className="font-mono text-gray-700">
                    {reader.serialNumberMasked}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Verification</span>
                  <span className="text-gray-700">
                    {reader.verificationType === 'SERIAL_HANDSHAKE'
                      ? 'Serial Handshake'
                      : 'IP Only'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Last Seen</span>
                  <span className="text-gray-700">
                    {formatLastSeen(reader.lastSeenAt)}
                  </span>
                </div>
                {reader.avgResponseTime && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Avg Response</span>
                    <span className="text-gray-700">{reader.avgResponseTime}ms</span>
                  </div>
                )}
              </div>

              {/* Bound Terminals */}
              {reader.terminals.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <span className="text-xs text-gray-500 uppercase tracking-wider">
                    Bound to:
                  </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {reader.terminals.map((t) => (
                      <span
                        key={t.id}
                        className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded"
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Error Display */}
              {reader.lastError && !reader.isOnline && (
                <div className="mt-3 p-2 bg-red-50 rounded text-xs text-red-600">
                  {reader.lastError}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 mt-4 pt-3 border-t border-gray-100">
                <button
                  onClick={() => handlePing(reader)}
                  disabled={pingingId === reader.id}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
                >
                  {pingingId === reader.id ? (
                    <ArrowPathIcon className="w-4 h-4 animate-spin" />
                  ) : (
                    <SignalIcon className="w-4 h-4" />
                  )}
                  Ping
                </button>
                <button
                  onClick={() => handleVerify(reader)}
                  disabled={verifyingId === reader.id}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-cyan-700 bg-cyan-50 hover:bg-cyan-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  {verifyingId === reader.id ? (
                    <ArrowPathIcon className="w-4 h-4 animate-spin" />
                  ) : (
                    <SpeakerWaveIcon className="w-4 h-4" />
                  )}
                  Verify
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingReader ? 'Edit Reader' : 'Add Payment Reader'} size="md">
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Bar Reader"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              {/* Serial Number */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Serial Number
                </label>
                <input
                  type="text"
                  value={formData.serialNumber}
                  onChange={(e) =>
                    setFormData({ ...formData, serialNumber: e.target.value })
                  }
                  placeholder="DATACAP-123456"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Found on the back of the reader
                </p>
              </div>

              {/* IP Address & Port */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    IP Address
                  </label>
                  <input
                    type="text"
                    value={formData.ipAddress}
                    onChange={(e) =>
                      setFormData({ ...formData, ipAddress: e.target.value })
                    }
                    placeholder="192.168.1.50"
                    pattern="^(\d{1,3}\.){3}\d{1,3}$"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Port
                  </label>
                  <input
                    type="number"
                    value={formData.port}
                    onChange={(e) =>
                      setFormData({ ...formData, port: parseInt(e.target.value) || 8080 })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
                    required
                  />
                </div>
              </div>

              {/* Verification Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Verification Type
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="verificationType"
                      value="SERIAL_HANDSHAKE"
                      checked={formData.verificationType === 'SERIAL_HANDSHAKE'}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          verificationType: e.target.value as 'SERIAL_HANDSHAKE',
                        })
                      }
                      className="text-blue-600"
                    />
                    <span className="text-sm">Serial Handshake</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="verificationType"
                      value="IP_ONLY"
                      checked={formData.verificationType === 'IP_ONLY'}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          verificationType: e.target.value as 'IP_ONLY',
                        })
                      }
                      className="text-blue-600"
                    />
                    <span className="text-sm">IP Only (Faster)</span>
                  </label>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Serial Handshake prevents accidental cross-pairing
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-2 px-4 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingReader ? 'Save Changes' : 'Add Reader'}
                </button>
              </div>
            </form>
      </Modal>
    </div>
  )
}
