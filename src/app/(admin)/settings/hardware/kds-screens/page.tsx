'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface PrepStation {
  id: string
  name: string
  displayName: string | null
  stationType: string
  color: string | null
}

interface KDSScreen {
  id: string
  name: string
  slug: string | null
  screenType: 'kds' | 'entertainment'
  columns: number
  fontSize: 'small' | 'normal' | 'large'
  colorScheme: 'dark' | 'light'
  agingWarning: number
  lateWarning: number
  playSound: boolean
  flashOnNew: boolean
  isActive: boolean
  isOnline: boolean
  lastSeenAt: string | null
  isPaired: boolean
  lastKnownIp: string | null
  staticIp: string | null
  enforceStaticIp: boolean
  stationCount: number
  stations: Array<{
    id: string
    stationId: string
    sortOrder: number
    station: PrepStation
  }>
}

interface PairingModal {
  screen: KDSScreen
  code: string | null
  expiresAt: string | null
  loading: boolean
  error: string | null
}

interface FormData {
  name: string
  screenType: 'kds' | 'entertainment'
  columns: number
  fontSize: 'small' | 'normal' | 'large'
  colorScheme: 'dark' | 'light'
  agingWarning: number
  lateWarning: number
  playSound: boolean
  flashOnNew: boolean
  stationIds: string[]
  staticIp: string
  enforceStaticIp: boolean
}

const DEFAULT_FORM_DATA: FormData = {
  name: '',
  screenType: 'kds',
  columns: 4,
  fontSize: 'normal',
  colorScheme: 'dark',
  agingWarning: 8,
  lateWarning: 15,
  playSound: true,
  flashOnNew: true,
  stationIds: [],
  staticIp: '',
  enforceStaticIp: false,
}

export default function KDSScreensPage() {
  const [screens, setScreens] = useState<KDSScreen[]>([])
  const [prepStations, setPrepStations] = useState<PrepStation[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingScreen, setEditingScreen] = useState<KDSScreen | null>(null)
  const [formData, setFormData] = useState<FormData>(DEFAULT_FORM_DATA)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pairingModal, setPairingModal] = useState<PairingModal | null>(null)
  const [copySuccess, setCopySuccess] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [screensRes, stationsRes] = await Promise.all([
        fetch('/api/hardware/kds-screens?locationId=loc-1'),
        fetch('/api/prep-stations?locationId=loc-1'),
      ])

      if (screensRes.ok) {
        const data = await screensRes.json()
        setScreens(data.screens || [])
      }

      if (stationsRes.ok) {
        const data = await stationsRes.json()
        setPrepStations(data.stations || [])
      }
    } catch (error) {
      console.error('Failed to fetch data:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleAdd = () => {
    setEditingScreen(null)
    setFormData(DEFAULT_FORM_DATA)
    setError('')
    setShowModal(true)
  }

  const handleEdit = (screen: KDSScreen) => {
    setEditingScreen(screen)
    setFormData({
      name: screen.name,
      screenType: screen.screenType,
      columns: screen.columns,
      fontSize: screen.fontSize,
      colorScheme: screen.colorScheme,
      agingWarning: screen.agingWarning,
      lateWarning: screen.lateWarning,
      playSound: screen.playSound,
      flashOnNew: screen.flashOnNew,
      stationIds: screen.stations.map((s) => s.stationId),
      staticIp: screen.staticIp || '',
      enforceStaticIp: screen.enforceStaticIp,
    })
    setError('')
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!formData.name.trim()) {
      setError('Name is required')
      return
    }

    setSaving(true)
    setError('')

    try {
      const url = editingScreen
        ? `/api/hardware/kds-screens/${editingScreen.id}`
        : '/api/hardware/kds-screens'
      const method = editingScreen ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          locationId: 'loc-1',
        }),
      })

      if (res.ok) {
        setShowModal(false)
        fetchData()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to save screen')
      }
    } catch (error) {
      console.error('Failed to save screen:', error)
      setError('Failed to save screen')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (screen: KDSScreen) => {
    if (!confirm(`Delete KDS screen "${screen.name}"?`)) return

    try {
      const res = await fetch(`/api/hardware/kds-screens/${screen.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        fetchData()
      }
    } catch (error) {
      console.error('Failed to delete screen:', error)
    }
  }

  const toggleStation = (stationId: string) => {
    setFormData((prev) => ({
      ...prev,
      stationIds: prev.stationIds.includes(stationId)
        ? prev.stationIds.filter((id) => id !== stationId)
        : [...prev.stationIds, stationId],
    }))
  }

  const handleGeneratePairingCode = async (screen: KDSScreen) => {
    setPairingModal({ screen, code: null, expiresAt: null, loading: true, error: null })

    try {
      const res = await fetch(`/api/hardware/kds-screens/${screen.id}/generate-code`, {
        method: 'POST',
      })

      const data = await res.json()

      if (res.ok) {
        setPairingModal({
          screen,
          code: data.pairingCode,
          expiresAt: data.expiresAt,
          loading: false,
          error: null,
        })
      } else {
        setPairingModal({
          screen,
          code: null,
          expiresAt: null,
          loading: false,
          error: data.error || 'Failed to generate code',
        })
      }
    } catch (error) {
      console.error('Failed to generate pairing code:', error)
      setPairingModal({
        screen,
        code: null,
        expiresAt: null,
        loading: false,
        error: 'Failed to generate code',
      })
    }
  }

  const handleUnpair = async (screen: KDSScreen) => {
    if (!confirm(`Unpair device from "${screen.name}"? The device will need to re-pair to access this screen.`)) return

    try {
      const res = await fetch(`/api/hardware/kds-screens/${screen.id}/unpair`, {
        method: 'POST',
      })

      if (res.ok) {
        fetchData()
      }
    } catch (error) {
      console.error('Failed to unpair device:', error)
    }
  }

  const handleCopyUrl = async (screen: KDSScreen) => {
    const baseUrl = window.location.origin
    const url = screen.slug
      ? `${baseUrl}/kds?screen=${screen.slug}`
      : `${baseUrl}/kds?screen=${screen.id}`

    try {
      await navigator.clipboard.writeText(url)
      setCopySuccess(screen.id)
      setTimeout(() => setCopySuccess(null), 2000)
    } catch (error) {
      console.error('Failed to copy URL:', error)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <AdminPageHeader
        title="KDS Screens"
        subtitle="Configure kitchen display screens"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Hardware', href: '/settings/hardware' },
        ]}
        actions={
          <button
            onClick={handleAdd}
            className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
          >
            + Add Screen
          </button>
        }
      />

      <div className="mx-auto max-w-4xl">
        {/* Screens List */}
        {loading ? (
          <div className="flex h-64 items-center justify-center rounded-xl bg-white shadow">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></div>
          </div>
        ) : screens.length === 0 ? (
          <div className="rounded-xl bg-white p-8 text-center shadow">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <h3 className="mt-2 text-lg font-medium text-gray-900">No KDS screens configured</h3>
            <p className="mt-1 text-gray-500">Add your first KDS screen to get started</p>
            <button
              onClick={handleAdd}
              className="mt-4 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
            >
              Add Screen
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {screens.map((screen) => (
              <div
                key={screen.id}
                className={`rounded-xl bg-white p-4 shadow ${!screen.isActive ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-3 w-3 rounded-full ${screen.isOnline ? 'bg-green-500' : 'bg-gray-300'}`}
                      title={screen.isOnline ? 'Online' : 'Offline'}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-gray-900">{screen.name}</h3>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                          {screen.screenType}
                        </span>
                        {screen.isPaired ? (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                            Paired
                          </span>
                        ) : (
                          <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                            Not Paired
                          </span>
                        )}
                        {!screen.isActive && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                            Disabled
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-gray-600">
                        {screen.columns} columns • {screen.fontSize} font • {screen.colorScheme}{' '}
                        theme
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {screen.stations.map((s) => (
                          <span
                            key={s.id}
                            className="rounded-full px-2 py-0.5 text-xs font-medium"
                            style={{
                              backgroundColor: s.station.color
                                ? `${s.station.color}20`
                                : '#f3f4f6',
                              color: s.station.color || '#6b7280',
                            }}
                          >
                            {s.station.displayName || s.station.name}
                          </span>
                        ))}
                        {screen.stations.length === 0 && (
                          <span className="text-xs text-gray-400">No stations assigned</span>
                        )}
                      </div>
                      {screen.lastSeenAt && (
                        <p className="mt-1 text-xs text-gray-400">
                          Last seen: {new Date(screen.lastSeenAt).toLocaleString()}
                          {screen.lastKnownIp && (
                            <span className="ml-2 text-gray-500">IP: {screen.lastKnownIp}</span>
                          )}
                        </p>
                      )}
                      {screen.slug && (
                        <p className="mt-1 text-xs text-gray-400">
                          URL slug: <code className="bg-gray-100 px-1 rounded">{screen.slug}</code>
                        </p>
                      )}
                      {screen.staticIp && (
                        <p className="mt-1 text-xs text-gray-400">
                          Static IP: <code className="bg-gray-100 px-1 rounded">{screen.staticIp}</code>
                          {screen.enforceStaticIp && (
                            <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-blue-700 font-medium">
                              Enforced
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Pairing Controls */}
                    <button
                      onClick={() => handleGeneratePairingCode(screen)}
                      className="rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-purple-600"
                      title="Generate Pairing Code"
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleCopyUrl(screen)}
                      className={`rounded p-2 transition-colors ${
                        copySuccess === screen.id
                          ? 'bg-green-100 text-green-600'
                          : 'text-gray-400 hover:bg-gray-100 hover:text-blue-600'
                      }`}
                      title={copySuccess === screen.id ? 'Copied!' : 'Copy KDS URL'}
                    >
                      {copySuccess === screen.id ? (
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                        </svg>
                      )}
                    </button>
                    <Link
                      href={`/kds?screen=${screen.slug || screen.id}`}
                      target="_blank"
                      className="rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-blue-600"
                      title="Open KDS"
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </Link>
                    <button
                      onClick={() => handleEdit(screen)}
                      className="rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                      title="Edit Screen"
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    {screen.isPaired && (
                      <button
                        onClick={() => handleUnpair(screen)}
                        className="rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-orange-600"
                        title="Unpair Device"
                      >
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(screen)}
                      className="rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                      title="Delete Screen"
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
            <h2 className="mb-4 text-lg font-semibold">
              {editingScreen ? 'Edit KDS Screen' : 'Add KDS Screen'}
            </h2>

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
                  placeholder="Kitchen Main"
                />
              </div>

              {/* Type */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Screen Type</label>
                <select
                  value={formData.screenType}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      screenType: e.target.value as 'kds' | 'entertainment',
                    })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                >
                  <option value="kds">Kitchen Display (KDS)</option>
                  <option value="entertainment">Entertainment Display</option>
                </select>
              </div>

              {/* Display Settings */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Columns</label>
                  <select
                    value={formData.columns}
                    onChange={(e) =>
                      setFormData({ ...formData, columns: parseInt(e.target.value) })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                  >
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={4}>4</option>
                    <option value={5}>5</option>
                    <option value={6}>6</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Font Size</label>
                  <select
                    value={formData.fontSize}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        fontSize: e.target.value as 'small' | 'normal' | 'large',
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="small">Small</option>
                    <option value="normal">Normal</option>
                    <option value="large">Large</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Theme</label>
                  <select
                    value={formData.colorScheme}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        colorScheme: e.target.value as 'dark' | 'light',
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </div>
              </div>

              {/* Timing */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Aging Warning (min)
                  </label>
                  <input
                    type="number"
                    value={formData.agingWarning}
                    onChange={(e) =>
                      setFormData({ ...formData, agingWarning: parseInt(e.target.value) })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                    min={1}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Late Warning (min)
                  </label>
                  <input
                    type="number"
                    value={formData.lateWarning}
                    onChange={(e) =>
                      setFormData({ ...formData, lateWarning: parseInt(e.target.value) })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                    min={1}
                  />
                </div>
              </div>

              {/* Checkboxes */}
              <div className="flex gap-6">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.playSound}
                    onChange={(e) => setFormData({ ...formData, playSound: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">Play sound on new orders</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.flashOnNew}
                    onChange={(e) => setFormData({ ...formData, flashOnNew: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">Flash on new orders</span>
                </label>
              </div>

              {/* Stations */}
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Prep Stations
                </label>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 p-2">
                  {prepStations.length === 0 ? (
                    <p className="py-2 text-center text-sm text-gray-500">
                      No prep stations configured
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {prepStations.map((station) => (
                        <label
                          key={station.id}
                          className="flex cursor-pointer items-center gap-2 rounded p-2 hover:bg-gray-50"
                        >
                          <input
                            type="checkbox"
                            checked={formData.stationIds.includes(station.id)}
                            onChange={() => toggleStation(station.id)}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                          <span
                            className="inline-block h-3 w-3 rounded-full"
                            style={{ backgroundColor: station.color || '#9ca3af' }}
                          />
                          <span className="text-sm text-gray-700">
                            {station.displayName || station.name}
                          </span>
                          <span className="text-xs text-gray-400">({station.stationType})</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Static IP Configuration */}
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <span className="font-medium text-blue-900">Network Security (UniFi)</span>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Static IP Address
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={formData.staticIp}
                        onChange={(e) => setFormData({ ...formData, staticIp: e.target.value })}
                        className="flex-1 rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                        placeholder="192.168.1.50"
                      />
                      {editingScreen?.lastKnownIp && editingScreen.lastKnownIp !== formData.staticIp && (
                        <button
                          type="button"
                          onClick={() => setFormData({ ...formData, staticIp: editingScreen.lastKnownIp || '' })}
                          className="whitespace-nowrap rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
                          title={`Use ${editingScreen.lastKnownIp}`}
                        >
                          Use Current
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      The static IP assigned to this KDS device in your UniFi network
                      {editingScreen?.lastKnownIp && (
                        <span className="ml-1">(Current: {editingScreen.lastKnownIp})</span>
                      )}
                    </p>
                  </div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.enforceStaticIp}
                      onChange={(e) => setFormData({ ...formData, enforceStaticIp: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300"
                      disabled={!formData.staticIp}
                    />
                    <span className={`text-sm ${formData.staticIp ? 'text-gray-700' : 'text-gray-400'}`}>
                      Enforce IP address (reject requests from other IPs)
                    </span>
                  </label>
                  {formData.enforceStaticIp && formData.staticIp && (
                    <div className="rounded bg-yellow-100 p-2 text-xs text-yellow-800">
                      <strong>Warning:</strong> When enforced, only requests from {formData.staticIp} will be accepted.
                      Make sure the device has a static IP lease in your router.
                    </div>
                  )}
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
                {saving ? 'Saving...' : editingScreen ? 'Save Changes' : 'Add Screen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pairing Code Modal */}
      {pairingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-purple-100">
                <svg className="h-8 w-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <h2 className="mb-2 text-xl font-semibold text-gray-900">
                Pair Device to &quot;{pairingModal.screen.name}&quot;
              </h2>

              {pairingModal.loading ? (
                <div className="py-8">
                  <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-purple-500 border-t-transparent"></div>
                  <p className="mt-4 text-gray-500">Generating pairing code...</p>
                </div>
              ) : pairingModal.error ? (
                <div className="py-4">
                  <div className="rounded-lg bg-red-50 p-4 text-red-700">
                    {pairingModal.error}
                  </div>
                </div>
              ) : (
                <>
                  <p className="mb-6 text-gray-500">
                    Enter this code on the KDS display to pair it
                  </p>

                  {/* Large Code Display */}
                  <div className="mb-6 rounded-xl bg-gray-100 px-6 py-8">
                    <div className="flex justify-center gap-3">
                      {pairingModal.code?.split('').map((digit, index) => (
                        <span
                          key={index}
                          className="flex h-14 w-12 items-center justify-center rounded-lg bg-white text-3xl font-bold text-gray-900 shadow-sm"
                        >
                          {digit}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Expiration */}
                  {pairingModal.expiresAt && (
                    <p className="mb-4 text-sm text-gray-500">
                      Code expires in 5 minutes
                    </p>
                  )}

                  {/* Instructions */}
                  <div className="mb-6 rounded-lg bg-blue-50 p-4 text-left text-sm text-blue-800">
                    <p className="font-medium">On the display device:</p>
                    <ol className="mt-2 list-inside list-decimal space-y-1">
                      <li>Open the browser</li>
                      <li>Go to <code className="rounded bg-blue-100 px-1">{window.location.origin}/kds/pair</code></li>
                      <li>Enter the 6-digit code above</li>
                    </ol>
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setPairingModal(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Close
              </button>
              {!pairingModal.loading && !pairingModal.error && (
                <button
                  onClick={() => handleGeneratePairingCode(pairingModal.screen)}
                  className="rounded-lg bg-purple-500 px-4 py-2 text-sm font-medium text-white hover:bg-purple-600"
                >
                  Generate New Code
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
