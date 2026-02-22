'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { formatCurrency } from '@/lib/utils'
import { BottleProduct } from './types'

export interface CreateMenuItemModalProps {
  bottle?: BottleProduct | null
  menuCategories: { id: string; name: string }[]
  onSave: (data: { name: string; price: number; categoryId: string; bottleProductId?: string }) => Promise<void>
  onClose: () => void
}

export function CreateMenuItemModal({
  bottle,
  menuCategories,
  onSave,
  onClose,
}: CreateMenuItemModalProps) {
  const [name, setName] = useState(bottle?.name ?? '')
  const [price, setPrice] = useState('')
  const [categoryId, setCategoryId] = useState(() => {
    if (bottle) {
      const match = menuCategories.find(
        c => c.name.toLowerCase() === bottle.spiritCategory.name.toLowerCase()
      )
      return match?.id ?? ''
    }
    return ''
  })
  const [saving, setSaving] = useState(false)

  // Suggest prices based on pour cost with different margins
  const pourCost = bottle?.pourCost || 0
  const suggestedPrices = [
    { margin: 70, price: Math.ceil(pourCost / 0.30) },
    { margin: 75, price: Math.ceil(pourCost / 0.25) },
    { margin: 80, price: Math.ceil(pourCost / 0.20) },
  ]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!price || parseFloat(price) <= 0 || !name.trim() || !categoryId) return
    setSaving(true)
    await onSave({
      name: name.trim(),
      price: parseFloat(price),
      categoryId,
      ...(bottle ? { bottleProductId: bottle.id } : {}),
    })
    setSaving(false)
  }

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={bottle ? 'Create Menu Item from Bottle' : 'Create Menu Item'}
      size="md"
    >
        {bottle && (
          <p className="text-sm text-gray-500 mb-4">
            Create a POS menu item for <strong>{bottle.name}</strong>
          </p>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Bottle Info (only when bottle provided) */}
          {bottle && (
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <div className="flex justify-between mb-1">
                <span className="text-gray-600">Category:</span>
                <span className="font-medium">{bottle.spiritCategory.name}</span>
              </div>
              <div className="flex justify-between mb-1">
                <span className="text-gray-600">Tier:</span>
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                  bottle.tier === 'well' ? 'bg-gray-100 text-gray-700' :
                  bottle.tier === 'call' ? 'bg-blue-100 text-blue-700' :
                  bottle.tier === 'premium' ? 'bg-purple-100 text-purple-700' :
                  'bg-amber-100 text-amber-700'
                }`}>
                  {bottle.tier.replace('_', ' ').toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Pour Cost:</span>
                <span className="font-medium text-green-600">{formatCurrency(pourCost)}</span>
              </div>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1">Menu Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder={bottle?.name ?? 'Enter item name'}
              required
            />
          </div>

          {/* POS Category */}
          <div>
            <label className="block text-sm font-medium mb-1">POS Category *</label>
            <select
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              required
            >
              <option value="">Select a category</option>
              {menuCategories.map(cat => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          {/* Price */}
          <div>
            <label className="block text-sm font-medium mb-1">Sell Price *</label>
            <input
              type="number"
              step="0.25"
              value={price}
              onChange={e => setPrice(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="e.g., 8.00"
              required
            />
          </div>

          {/* Suggested Prices (only when bottle with pour cost) */}
          {bottle && pourCost > 0 && (
            <div>
              <label className="block text-xs text-gray-500 mb-2">Suggested prices (by profit margin):</label>
              <div className="flex gap-2">
                {suggestedPrices.map(({ margin, price: suggested }) => (
                  <button
                    key={margin}
                    type="button"
                    onClick={() => setPrice(suggested.toString())}
                    className={`flex-1 px-2 py-1.5 text-sm border rounded hover:bg-gray-50 ${
                      parseFloat(price) === suggested ? 'border-purple-500 bg-purple-50' : ''
                    }`}
                  >
                    <div className="font-medium">{formatCurrency(suggested)}</div>
                    <div className="text-xs text-gray-500">{margin}% margin</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Profit Preview (only when bottle with pour cost) */}
          {bottle && price && parseFloat(price) > 0 && pourCost > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
              <div className="flex justify-between mb-1">
                <span className="text-green-700">Gross Profit:</span>
                <span className="font-bold text-green-700">
                  {formatCurrency(parseFloat(price) - pourCost)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-green-700">Profit Margin:</span>
                <span className="font-bold text-green-700">
                  {(((parseFloat(price) - pourCost) / parseFloat(price)) * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || !price || parseFloat(price) <= 0 || !name.trim() || !categoryId}
            >
              {saving ? 'Creating...' : 'Create Menu Item'}
            </Button>
          </div>
        </form>
    </Modal>
  )
}
