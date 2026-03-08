'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { BarcodeImport } from './BarcodeImport'

interface Barcode {
  id: string
  barcode: string
  label: string | null
  packSize: number
  price: number | null
  menuItemId: string | null
  inventoryItemId: string | null
}

interface BarcodeManagerProps {
  menuItemId?: string
  inventoryItemId?: string
  locationId: string
}

export function BarcodeManager({ menuItemId, inventoryItemId, locationId }: BarcodeManagerProps) {
  const [barcodes, setBarcodes] = useState<Barcode[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)

  // Form state
  const [formBarcode, setFormBarcode] = useState('')
  const [formLabel, setFormLabel] = useState('')
  const [formPackSize, setFormPackSize] = useState('1')
  const [formPrice, setFormPrice] = useState('')

  const loadBarcodes = useCallback(async () => {
    try {
      const params = new URLSearchParams({ locationId })
      if (menuItemId) params.set('menuItemId', menuItemId)
      if (inventoryItemId) params.set('inventoryItemId', inventoryItemId)

      const res = await fetch(`/api/barcode?${params}`)
      if (!res.ok) throw new Error('Failed to load barcodes')
      const raw = await res.json()
      const data = raw.data ?? raw
      setBarcodes(data.barcodes || data || [])
    } catch {
      toast.error('Failed to load barcodes')
    } finally {
      setLoading(false)
    }
  }, [locationId, menuItemId, inventoryItemId])

  useEffect(() => {
    loadBarcodes()
  }, [loadBarcodes])

  const resetForm = () => {
    setFormBarcode('')
    setFormLabel('')
    setFormPackSize('1')
    setFormPrice('')
    setShowForm(false)
  }

  const handleAdd = async () => {
    if (!formBarcode.trim()) {
      toast.error('Barcode is required')
      return
    }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        barcode: formBarcode.trim(),
        label: formLabel.trim() || null,
        packSize: parseInt(formPackSize) || 1,
        price: formPrice ? parseFloat(formPrice) : null,
        locationId,
      }
      if (menuItemId) body.menuItemId = menuItemId
      if (inventoryItemId) body.inventoryItemId = inventoryItemId

      const res = await fetch('/api/barcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to add barcode' }))
        toast.error(err.error || 'Failed to add barcode')
        return
      }

      toast.success('Barcode added')
      resetForm()
      await loadBarcodes()
    } catch {
      toast.error('Failed to add barcode')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this barcode?')) return

    setDeletingId(id)
    try {
      const res = await fetch(`/api/barcode/${id}?locationId=${locationId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to delete barcode' }))
        toast.error(err.error || 'Failed to delete barcode')
        return
      }

      toast.success('Barcode removed')
      await loadBarcodes()
    } catch {
      toast.error('Failed to delete barcode')
    } finally {
      setDeletingId(null)
    }
  }

  const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
  const labelClass = 'block text-xs font-semibold text-gray-500 mb-1'

  if (loading) {
    return <div className="py-8 text-center text-sm text-gray-400">Loading barcodes...</div>
  }

  return (
    <div className="space-y-3">
      {/* Barcode List */}
      {barcodes.length === 0 && !showForm ? (
        <div className="bg-gray-50 rounded-lg p-6 text-center">
          <p className="text-sm text-gray-500">No barcodes assigned</p>
          <p className="text-xs text-gray-400 mt-1">Add barcodes for different pack sizes (single, 6-pack, case, etc.)</p>
        </div>
      ) : (
        <div className="space-y-2">
          {barcodes.map((bc) => (
            <div key={bc.id} className="bg-gray-50 rounded-lg p-3 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-gray-900">{bc.barcode}</span>
                  {bc.label && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                      {bc.label}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-gray-500">
                    Pack: {bc.packSize}
                  </span>
                  <span className="text-xs text-gray-500">
                    {bc.price != null ? `$${Number(bc.price).toFixed(2)}` : 'Base price'}
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleDelete(bc.id)}
                disabled={deletingId === bc.id}
                className="text-red-600 hover:text-red-700 text-xs font-medium shrink-0 disabled:opacity-50"
              >
                {deletingId === bc.id ? 'Removing...' : 'Remove'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add Form */}
      {/* CSV Import */}
      {showImport && (
        <BarcodeImport
          locationId={locationId}
          onComplete={() => {
            loadBarcodes()
            setShowImport(false)
          }}
        />
      )}

      {showForm ? (
        <div className="border border-blue-200 rounded-lg p-3 space-y-3 bg-blue-50/30">
          <div>
            <label className={labelClass}>Barcode *</label>
            <input
              type="text"
              value={formBarcode}
              onChange={(e) => setFormBarcode(e.target.value)}
              placeholder="Scan or type barcode (UPC, EAN, etc.)"
              className={inputClass}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelClass}>Label</label>
              <input
                type="text"
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                placeholder="e.g. 6-Pack"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Pack Size</label>
              <input
                type="number"
                value={formPackSize}
                onChange={(e) => setFormPackSize(e.target.value)}
                placeholder="1"
                min="1"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Price Override ($)</label>
              <input
                type="number"
                value={formPrice}
                onChange={(e) => setFormPrice(e.target.value)}
                placeholder="Base price"
                step="0.01"
                min="0"
                className={inputClass}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {saving ? 'Adding...' : 'Add Barcode'}
            </button>
            <button
              onClick={resetForm}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => setShowForm(true)}
            className="flex-1 py-2 rounded-lg text-sm font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
          >
            + Add Barcode
          </button>
          <button
            onClick={() => setShowImport(!showImport)}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
          >
            {showImport ? 'Hide Import' : 'Import CSV'}
          </button>
        </div>
      )}
    </div>
  )
}
