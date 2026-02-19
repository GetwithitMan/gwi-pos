'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { formatCurrency } from '@/lib/utils'
import { SPIRIT_TIERS, BOTTLE_SIZES, LIQUOR_DEFAULTS } from '@/lib/constants'
import { SpiritCategory, BottleProduct } from './types'

export interface BottleModalProps {
  bottle: BottleProduct | null
  categories: SpiritCategory[]
  onSave: (data: any) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
  onMenuItemChange?: () => void
}

export function BottleModal({
  bottle,
  categories,
  onSave,
  onDelete,
  onClose,
  onMenuItemChange,
}: BottleModalProps) {
  const [name, setName] = useState(bottle?.name || '')
  const [brand, setBrand] = useState(bottle?.brand || '')
  const [spiritCategoryId, setSpiritCategoryId] = useState(bottle?.spiritCategoryId || categories[0]?.id || '')
  const [tier, setTier] = useState(bottle?.tier || 'well')
  const [bottleSizeMl, setBottleSizeMl] = useState(bottle?.bottleSizeMl?.toString() || '750')
  const [unitCost, setUnitCost] = useState(bottle?.unitCost?.toString() || '')
  const [pourSizeOz, setPourSizeOz] = useState(bottle?.pourSizeOz?.toString() || '')
  const [currentStock, setCurrentStock] = useState(bottle?.currentStock?.toString() || '0')
  const [lowStockAlert, setLowStockAlert] = useState(bottle?.lowStockAlert?.toString() || '')
  const [isActive, setIsActive] = useState(bottle?.isActive ?? true)
  const [saving, setSaving] = useState(false)

  // POS Menu state
  const [showOnPOS, setShowOnPOS] = useState(bottle?.hasMenuItem ?? false)
  const [menuPrice, setMenuPrice] = useState(bottle?.linkedMenuItems?.[0]?.price?.toString() || '')
  const [savingMenu, setSavingMenu] = useState(false)

  // Calculate pour metrics preview
  const effectivePourSizeOz = pourSizeOz ? parseFloat(pourSizeOz) : LIQUOR_DEFAULTS.pourSizeOz
  const bottleMl = parseInt(bottleSizeMl) || 0
  const cost = parseFloat(unitCost) || 0
  const poursPerBottle = bottleMl > 0 ? Math.floor(bottleMl / (effectivePourSizeOz * LIQUOR_DEFAULTS.mlPerOz)) : 0
  const pourCost = poursPerBottle > 0 ? cost / poursPerBottle : 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !spiritCategoryId || !bottleSizeMl || !unitCost) return
    setSaving(true)
    await onSave({
      name,
      brand: brand || undefined,
      spiritCategoryId,
      tier,
      bottleSizeMl: parseInt(bottleSizeMl),
      unitCost: parseFloat(unitCost),
      pourSizeOz: pourSizeOz ? parseFloat(pourSizeOz) : undefined,
      currentStock: parseInt(currentStock) || 0,
      lowStockAlert: lowStockAlert ? parseInt(lowStockAlert) : undefined,
      isActive,
    })
    setSaving(false)
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={bottle ? 'Edit Bottle' : 'New Bottle Product'} size="2xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Product Name *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="e.g., Patron Silver"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Brand</label>
              <input
                type="text"
                value={brand}
                onChange={e => setBrand(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="e.g., Patron"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Spirit Category *</label>
              <select
                value={spiritCategoryId}
                onChange={e => setSpiritCategoryId(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                required
              >
                <option value="">Select Category</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tier *</label>
              <select
                value={tier}
                onChange={e => setTier(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
              >
                {SPIRIT_TIERS.map(t => (
                  <option key={t.value} value={t.value}>{t.label} - {t.description}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Bottle Size (mL) *</label>
              <select
                value={bottleSizeMl}
                onChange={e => setBottleSizeMl(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
              >
                {BOTTLE_SIZES.map(size => (
                  <option key={size.value} value={size.value}>{size.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Unit Cost ($) *</label>
              <input
                type="number"
                step="0.01"
                value={unitCost}
                onChange={e => setUnitCost(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="e.g., 42.99"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Pour Size (oz)</label>
              <input
                type="number"
                step="0.25"
                value={pourSizeOz}
                onChange={e => setPourSizeOz(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder={`Default: ${LIQUOR_DEFAULTS.pourSizeOz}`}
              />
            </div>
          </div>

          {/* Calculated Preview */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="font-medium text-blue-900 mb-2">Calculated Metrics</h4>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-blue-700">Pours per Bottle:</span>
                <span className="ml-2 font-bold text-blue-900">{poursPerBottle}</span>
              </div>
              <div>
                <span className="text-blue-700">Pour Cost:</span>
                <span className="ml-2 font-bold text-green-600">{formatCurrency(pourCost)}</span>
              </div>
              <div>
                <span className="text-blue-700">Pour Size:</span>
                <span className="ml-2 font-bold text-blue-900">{effectivePourSizeOz} oz</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Current Stock (bottles)</label>
              <input
                type="number"
                value={currentStock}
                onChange={e => setCurrentStock(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Low Stock Alert</label>
              <input
                type="number"
                value={lowStockAlert}
                onChange={e => setLowStockAlert(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="Alert when below this"
              />
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
              />
              <span>Active</span>
            </label>
          </div>

          {/* Show on POS Menu */}
          {bottle && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium text-purple-900">Show on POS Menu</h4>
                <button
                  type="button"
                  onClick={async () => {
                    if (!showOnPOS) {
                      // Turning ON - need a price
                      if (!menuPrice || parseFloat(menuPrice) <= 0) {
                        // Set a suggested price based on 75% margin
                        const suggested = pourCost > 0 ? Math.ceil(pourCost / 0.25) : 0
                        setMenuPrice(suggested.toString())
                      }
                      setShowOnPOS(true)
                    } else {
                      // Turning OFF - remove from POS
                      if (bottle.linkedMenuItems?.[0]?.id) {
                        setSavingMenu(true)
                        await fetch(`/api/menu/items/${bottle.linkedMenuItems[0].id}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ deletedAt: new Date().toISOString() }),
                        })
                        setSavingMenu(false)
                        onMenuItemChange?.()
                      }
                      setShowOnPOS(false)
                      setMenuPrice('')
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    showOnPOS ? 'bg-purple-600' : 'bg-gray-300'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    showOnPOS ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              {showOnPOS && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-purple-800 mb-1">Sell Price *</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.25"
                        value={menuPrice}
                        onChange={e => setMenuPrice(e.target.value)}
                        className="flex-1 border rounded-lg px-3 py-2"
                        placeholder="e.g., 8.00"
                      />
                      <button
                        type="button"
                        disabled={savingMenu || !menuPrice || parseFloat(menuPrice) <= 0}
                        onClick={async () => {
                          if (!menuPrice || parseFloat(menuPrice) <= 0) return
                          setSavingMenu(true)

                          if (bottle.linkedMenuItems?.[0]?.id) {
                            // Update existing
                            await fetch(`/api/menu/items/${bottle.linkedMenuItems[0].id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ price: parseFloat(menuPrice) }),
                            })
                          } else {
                            // Create new
                            await fetch(`/api/liquor/bottles/${bottle.id}/create-menu-item`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ price: parseFloat(menuPrice) }),
                            })
                          }

                          setSavingMenu(false)
                          onMenuItemChange?.()
                        }}
                        className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                      >
                        {savingMenu ? '...' : bottle.hasMenuItem ? 'Update' : 'Add to POS'}
                      </button>
                    </div>
                  </div>

                  {/* Margin preview */}
                  {menuPrice && parseFloat(menuPrice) > 0 && pourCost > 0 && (
                    <div className="text-sm text-purple-700">
                      Margin: <span className={`font-bold ${
                        ((parseFloat(menuPrice) - pourCost) / parseFloat(menuPrice)) * 100 >= 70
                          ? 'text-green-600'
                          : 'text-yellow-600'
                      }`}>
                        {(((parseFloat(menuPrice) - pourCost) / parseFloat(menuPrice)) * 100).toFixed(0)}%
                      </span>
                      {' '}(Profit: {formatCurrency(parseFloat(menuPrice) - pourCost)})
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between pt-4 border-t">
            <div>
              {onDelete && (
                <Button type="button" variant="danger" onClick={onDelete}>
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim() || !spiritCategoryId || !unitCost}>
                {saving ? 'Saving...' : bottle ? 'Save Changes' : 'Create'}
              </Button>
            </div>
          </div>
        </form>
    </Modal>
  )
}
