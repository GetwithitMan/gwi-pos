'use client'

import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useDeliveryFeature } from '@/hooks/useDeliveryFeature'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { toast } from '@/stores/toast-store'

// ─── Types ──────────────────────────────────────────────────────────────────

interface DeliveryZone {
  id: string
  name: string
  color: string
  type: 'radius' | 'polygon' | 'zipcode'
  // Radius
  centerLat: number | null
  centerLng: number | null
  radiusMiles: number | null
  // Polygon (GeoJSON)
  polygon: [number, number][] | null
  // Zipcode
  zipcodes: string[] | null
  // Zone config
  deliveryFee: number
  minimumOrder: number
  estimatedMinutes: number
  cutoffTime: string | null
  activeDays: string[] // ['mon','tue',...]
  isActive: boolean
  createdAt: string
}

interface ZoneFormData {
  name: string
  color: string
  type: 'radius' | 'polygon' | 'zipcode'
  centerLat: string
  centerLng: string
  radiusMiles: string
  polygonJson: string
  zipcodes: string
  deliveryFee: string
  minimumOrder: string
  estimatedMinutes: string
  cutoffTime: string
  activeDays: string[]
}

const EMPTY_FORM: ZoneFormData = {
  name: '',
  color: '#3b82f6',
  type: 'radius',
  centerLat: '',
  centerLng: '',
  radiusMiles: '5',
  polygonJson: '',
  zipcodes: '',
  deliveryFee: '5.00',
  minimumOrder: '0',
  estimatedMinutes: '45',
  cutoffTime: '',
  activeDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
}

const DAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]

const PRESET_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#06b6d4',
]

// ─── Component ──────────────────────────────────────────────────────────────

export default function ZoneManagementPage() {
  const { employee } = useRequireAuth()
  const deliveryEnabled = useDeliveryFeature()

  const [zones, setZones] = useState<DeliveryZone[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Modal state
  const [editModal, setEditModal] = useState(false)
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null)
  const [form, setForm] = useState<ZoneFormData>(EMPTY_FORM)
  const [isSaving, setIsSaving] = useState(false)

  // Delete
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; zoneId: string | null }>({ open: false, zoneId: null })

  // ─── Load ──────────────────────────────────────────────────────────

  const loadZones = useCallback(async () => {
    try {
      const res = await fetch('/api/delivery/zones')
      if (!res.ok) return
      const json = await res.json()
      setZones(json.data ?? [])
    } catch (error) {
      console.error('Failed to load zones:', error)
      toast.error('Failed to load delivery zones')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (deliveryEnabled) {
      loadZones()
    } else {
      setIsLoading(false)
    }
  }, [deliveryEnabled, loadZones])

  // ─── Open Edit/Create ─────────────────────────────────────────────

  function openCreate() {
    setEditingZoneId(null)
    setForm(EMPTY_FORM)
    setEditModal(true)
  }

  function openEdit(zone: DeliveryZone) {
    setEditingZoneId(zone.id)
    setForm({
      name: zone.name,
      color: zone.color,
      type: zone.type,
      centerLat: zone.centerLat?.toString() ?? '',
      centerLng: zone.centerLng?.toString() ?? '',
      radiusMiles: zone.radiusMiles?.toString() ?? '5',
      polygonJson: zone.polygon ? JSON.stringify(zone.polygon, null, 2) : '',
      zipcodes: zone.zipcodes?.join(', ') ?? '',
      deliveryFee: zone.deliveryFee.toFixed(2),
      minimumOrder: zone.minimumOrder.toFixed(2),
      estimatedMinutes: zone.estimatedMinutes.toString(),
      cutoffTime: zone.cutoffTime ?? '',
      activeDays: zone.activeDays.length > 0 ? zone.activeDays : EMPTY_FORM.activeDays,
    })
    setEditModal(true)
  }

  // ─── Save ──────────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error('Zone name is required')
      return
    }

    // Validate type-specific fields
    if (form.type === 'radius') {
      if (!form.centerLat || !form.centerLng || !form.radiusMiles) {
        toast.error('Radius zone requires center coordinates and radius')
        return
      }
    }
    if (form.type === 'polygon') {
      try {
        if (form.polygonJson.trim()) {
          const parsed = JSON.parse(form.polygonJson)
          if (!Array.isArray(parsed) || parsed.length < 3) {
            toast.error('Polygon requires at least 3 points')
            return
          }
        } else {
          toast.error('Polygon GeoJSON is required')
          return
        }
      } catch {
        toast.error('Invalid polygon GeoJSON format')
        return
      }
    }
    if (form.type === 'zipcode' && !form.zipcodes.trim()) {
      toast.error('At least one ZIP code is required')
      return
    }

    setIsSaving(true)
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        color: form.color,
        type: form.type,
        deliveryFee: parseFloat(form.deliveryFee) || 0,
        minimumOrder: parseFloat(form.minimumOrder) || 0,
        estimatedMinutes: parseInt(form.estimatedMinutes) || 45,
        cutoffTime: form.cutoffTime || null,
        activeDays: form.activeDays,
      }

      if (form.type === 'radius') {
        body.centerLat = parseFloat(form.centerLat)
        body.centerLng = parseFloat(form.centerLng)
        body.radiusMiles = parseFloat(form.radiusMiles)
      } else if (form.type === 'polygon') {
        body.polygon = JSON.parse(form.polygonJson)
      } else if (form.type === 'zipcode') {
        body.zipcodes = form.zipcodes.split(',').map(z => z.trim()).filter(Boolean)
      }

      const url = editingZoneId
        ? `/api/delivery/zones/${editingZoneId}`
        : '/api/delivery/zones'
      const method = editingZoneId ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Failed to save zone')
        return
      }

      toast.success(editingZoneId ? 'Zone updated' : 'Zone created')
      setEditModal(false)
      void loadZones()
    } catch (error) {
      toast.error('Failed to save zone')
    } finally {
      setIsSaving(false)
    }
  }

  // ─── Delete ────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!deleteConfirm.zoneId) return
    try {
      const res = await fetch(`/api/delivery/zones/${deleteConfirm.zoneId}`, {
        method: 'DELETE',
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Failed to delete zone')
        return
      }
      toast.success('Zone deleted')
      setDeleteConfirm({ open: false, zoneId: null })
      void loadZones()
    } catch {
      toast.error('Failed to delete zone')
    }
  }

  // ─── Toggle active ────────────────────────────────────────────────

  async function handleToggleActive(zone: DeliveryZone) {
    try {
      const res = await fetch(`/api/delivery/zones/${zone.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !zone.isActive }),
      })
      if (!res.ok) {
        toast.error('Failed to update zone')
        return
      }
      toast.success(zone.isActive ? 'Zone deactivated' : 'Zone activated')
      void loadZones()
    } catch {
      toast.error('Failed to update zone')
    }
  }

  // ─── Render guards ────────────────────────────────────────────────

  if (!deliveryEnabled) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Delivery Module Not Enabled</h2>
          <p className="text-gray-600 text-sm">
            Enable the delivery module from Mission Control to manage delivery zones.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Delivery Zones"
        subtitle={`${zones.filter(z => z.isActive).length} active zone${zones.filter(z => z.isActive).length !== 1 ? 's' : ''}`}
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Delivery', href: '/settings/delivery' },
        ]}
        actions={
          <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700">
            New Zone
          </Button>
        }
      />

      <div className="max-w-5xl mx-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></div>
          </div>
        ) : zones.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-4xl mb-3">📍</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">No Delivery Zones</h3>
            <p className="text-gray-500 text-sm mb-4">
              Create zones to define delivery areas and set zone-specific fees.
            </p>
            <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700">
              Create First Zone
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {zones.map(zone => (
              <div
                key={zone.id}
                className={`rounded-xl bg-white p-5 shadow-sm border transition-all ${
                  zone.isActive ? 'border-gray-200' : 'border-gray-100 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-4 h-4 rounded-full border-2 border-white shadow-sm"
                      style={{ backgroundColor: zone.color }}
                    />
                    <h3 className="font-semibold text-gray-900">{zone.name}</h3>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase ${
                      zone.isActive
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {zone.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5 text-sm text-gray-600">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Type:</span>
                    <span className="capitalize font-medium">{zone.type}</span>
                  </div>
                  {zone.type === 'radius' && zone.radiusMiles && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Radius:</span>
                      <span>{zone.radiusMiles} miles</span>
                    </div>
                  )}
                  {zone.type === 'zipcode' && zone.zipcodes && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">ZIP codes:</span>
                      <span className="text-xs">{zone.zipcodes.length} codes</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Fee:</span>
                    <span>${zone.deliveryFee.toFixed(2)}</span>
                  </div>
                  {zone.minimumOrder > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Min order:</span>
                      <span>${zone.minimumOrder.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Est. time:</span>
                    <span>{zone.estimatedMinutes} min</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-gray-100">
                  <button
                    onClick={() => openEdit(zone)}
                    className="flex-1 text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleToggleActive(zone)}
                    className={`flex-1 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                      zone.isActive
                        ? 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                        : 'bg-green-50 text-green-700 hover:bg-green-100'
                    }`}
                  >
                    {zone.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm({ open: true, zoneId: zone.id })}
                    className="text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 font-medium transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Create/Edit Zone Modal ────────────────────────────────────── */}
      <Modal
        isOpen={editModal}
        onClose={() => setEditModal(false)}
        title={editingZoneId ? 'Edit Zone' : 'Create Zone'}
        size="lg"
      >
        <div className="space-y-5">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Zone Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Downtown"
            />
          </div>

          {/* Color */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
            <div className="flex items-center gap-2">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setForm(prev => ({ ...prev, color: c }))}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    form.color === c ? 'border-gray-800 scale-110' : 'border-transparent hover:border-gray-300'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={form.color}
                onChange={e => setForm(prev => ({ ...prev, color: e.target.value }))}
                className="w-7 h-7 rounded-full cursor-pointer border-0"
              />
            </div>
          </div>

          {/* Zone Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Zone Type</label>
            <div className="flex gap-2">
              {(['radius', 'polygon', 'zipcode'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setForm(prev => ({ ...prev, type: t }))}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    form.type === t
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {t === 'radius' ? 'Radius' : t === 'polygon' ? 'Polygon' : 'ZIP Code'}
                </button>
              ))}
            </div>
          </div>

          {/* Type-specific fields */}
          {form.type === 'radius' && (
            <div className="space-y-3 bg-gray-50 rounded-lg p-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Center Latitude</label>
                  <input
                    type="number"
                    value={form.centerLat}
                    onChange={e => setForm(prev => ({ ...prev, centerLat: e.target.value }))}
                    step="0.0001"
                    placeholder="40.7128"
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Center Longitude</label>
                  <input
                    type="number"
                    value={form.centerLng}
                    onChange={e => setForm(prev => ({ ...prev, centerLng: e.target.value }))}
                    step="0.0001"
                    placeholder="-74.0060"
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Radius (miles)</label>
                <input
                  type="number"
                  value={form.radiusMiles}
                  onChange={e => setForm(prev => ({ ...prev, radiusMiles: e.target.value }))}
                  min="0.5"
                  max="50"
                  step="0.5"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <p className="text-[10px] text-gray-400">
                Coordinates auto-fill from your location settings. Override if this zone has a different center.
              </p>
            </div>
          )}

          {form.type === 'polygon' && (
            <div className="space-y-2 bg-gray-50 rounded-lg p-4">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                GeoJSON Polygon Coordinates
              </label>
              <textarea
                value={form.polygonJson}
                onChange={e => setForm(prev => ({ ...prev, polygonJson: e.target.value }))}
                rows={5}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder={'[\n  [40.7128, -74.0060],\n  [40.7180, -74.0020],\n  [40.7200, -74.0080],\n  [40.7128, -74.0060]\n]'}
              />
              <p className="text-[10px] text-gray-400">
                Array of [lat, lng] pairs forming a closed polygon. Minimum 3 points.
              </p>
            </div>
          )}

          {form.type === 'zipcode' && (
            <div className="space-y-2 bg-gray-50 rounded-lg p-4">
              <label className="block text-xs font-medium text-gray-600 mb-1">ZIP Codes</label>
              <input
                type="text"
                value={form.zipcodes}
                onChange={e => setForm(prev => ({ ...prev, zipcodes: e.target.value }))}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="10001, 10002, 10003"
              />
              <p className="text-[10px] text-gray-400">Comma-separated list of ZIP codes in this zone.</p>
            </div>
          )}

          {/* Zone Configuration */}
          <div className="border-t border-gray-200 pt-4 space-y-3">
            <h3 className="text-sm font-medium text-gray-700">Zone Configuration</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Delivery Fee</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    value={form.deliveryFee}
                    onChange={e => setForm(prev => ({ ...prev, deliveryFee: e.target.value }))}
                    min="0"
                    step="0.50"
                    className="w-full pl-7 pr-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Min Order</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    value={form.minimumOrder}
                    onChange={e => setForm(prev => ({ ...prev, minimumOrder: e.target.value }))}
                    min="0"
                    step="1"
                    className="w-full pl-7 pr-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Est. Minutes</label>
                <input
                  type="number"
                  value={form.estimatedMinutes}
                  onChange={e => setForm(prev => ({ ...prev, estimatedMinutes: e.target.value }))}
                  min="5"
                  max="180"
                  step="5"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Cutoff Time */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Cutoff Time (optional)</label>
              <input
                type="time"
                value={form.cutoffTime}
                onChange={e => setForm(prev => ({ ...prev, cutoffTime: e.target.value }))}
                className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="text-[10px] text-gray-400 mt-0.5">No deliveries to this zone after this time</p>
            </div>

            {/* Active Days */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Active Days</label>
              <div className="flex gap-1.5">
                {DAYS.map(day => (
                  <button
                    key={day.key}
                    onClick={() => {
                      setForm(prev => ({
                        ...prev,
                        activeDays: prev.activeDays.includes(day.key)
                          ? prev.activeDays.filter(d => d !== day.key)
                          : [...prev.activeDays, day.key],
                      }))
                    }}
                    className={`w-10 h-8 rounded-md text-xs font-medium border transition-colors ${
                      form.activeDays.includes(day.key)
                        ? 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'bg-white border-gray-200 text-gray-400'
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <Button variant="outline" onClick={() => setEditModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isSaving ? 'Saving...' : editingZoneId ? 'Update Zone' : 'Create Zone'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ─── Delete Confirmation ───────────────────────────────────────── */}
      <ConfirmDialog
        open={deleteConfirm.open}
        title="Delete Zone"
        description="Are you sure you want to delete this delivery zone? This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirm({ open: false, zoneId: null })}
      />
    </div>
  )
}
