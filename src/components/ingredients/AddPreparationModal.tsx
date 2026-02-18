'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import type { Ingredient, InventoryItemRef, PrepItemRef } from './IngredientLibrary'

interface AddPreparationModalProps {
  parentIngredient: Ingredient
  inventoryItems: InventoryItemRef[]
  prepItems: PrepItemRef[]
  onSave: (data: {
    name: string
    preparationType: string
    yieldPercent: number | null
    inventoryItemId: string | null
    prepItemId: string | null
    standardQuantity: number | null
    standardUnit: string | null
  }) => void
  onClose: () => void
}

// Common preparation types
const PREPARATION_TYPES = [
  'Grilled',
  'Fried',
  'Crispy',
  'Blackened',
  'Roasted',
  'Baked',
  'Sautéed',
  'Shredded',
  'Pulled',
  'Diced',
  'Cubed',
  'Sliced',
  'Chopped',
  'Minced',
  'Ground',
  'Marinated',
  'Breaded',
  'Smoked',
  'Raw',
  'Other',
]

// Common portion units
const PORTION_UNITS = [
  { value: 'oz', label: 'oz (ounces)' },
  { value: 'g', label: 'g (grams)' },
  { value: 'lb', label: 'lb (pounds)' },
  { value: 'cup', label: 'cup' },
  { value: 'tbsp', label: 'tbsp (tablespoon)' },
  { value: 'tsp', label: 'tsp (teaspoon)' },
  { value: 'slice', label: 'slice' },
  { value: 'piece', label: 'piece' },
  { value: 'each', label: 'each' },
  { value: 'portion', label: 'portion' },
]

export function AddPreparationModal({
  parentIngredient,
  inventoryItems,
  prepItems,
  onSave,
  onClose,
}: AddPreparationModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    preparationType: '',
    customPreparationType: '',
    yieldPercent: '80', // Default 80% yield
    portionAmount: '4', // Default 4 oz
    portionUnit: 'oz',
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const prepType = formData.preparationType === 'Other'
      ? formData.customPreparationType
      : formData.preparationType

    // Auto-generate name if not provided
    const finalName = formData.name || `${prepType} ${parentIngredient.name}`

    onSave({
      name: finalName,
      preparationType: prepType,
      yieldPercent: formData.yieldPercent ? parseFloat(formData.yieldPercent) / 100 : null,
      inventoryItemId: null, // Inherits from parent
      prepItemId: null,
      standardQuantity: formData.portionAmount ? parseFloat(formData.portionAmount) : null,
      standardUnit: formData.portionUnit || null,
    })
  }

  // Preview the auto-generated name
  const prepType = formData.preparationType === 'Other'
    ? formData.customPreparationType
    : formData.preparationType
  const previewName = formData.name || (prepType ? `${prepType} ${parentIngredient.name}` : `[Type] ${parentIngredient.name}`)

  // Calculate raw inventory needed
  const portionAmount = parseFloat(formData.portionAmount) || 0
  const yieldPercent = parseFloat(formData.yieldPercent) || 100
  const rawNeeded = yieldPercent > 0 ? portionAmount / (yieldPercent / 100) : 0

  // Get parent's standard quantity for reference
  const parentPortion = parentIngredient.standardQuantity || 6
  const parentUnit = parentIngredient.standardUnit || 'oz'

  return (
    <Modal isOpen={true} onClose={onClose} title="Add Prep Item" size="lg" variant="default">
      <div className="flex items-center gap-2 mb-1">
        <span className="px-2 py-0.5 bg-green-600 text-white rounded text-xs font-bold uppercase">
          New Prep Item
        </span>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        How is <span className="font-semibold text-blue-600">{parentIngredient.name}</span> prepared?
      </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Step 1: Preparation Type */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-sm font-bold">1</span>
              <h3 className="font-semibold text-gray-900">How is it prepared?</h3>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {PREPARATION_TYPES.slice(0, 12).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFormData({ ...formData, preparationType: type })}
                  className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                    formData.preparationType === type
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            <select
              value={formData.preparationType}
              onChange={(e) => setFormData({ ...formData, preparationType: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Or select from all types...</option>
              {PREPARATION_TYPES.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>

            {formData.preparationType === 'Other' && (
              <input
                type="text"
                value={formData.customPreparationType}
                onChange={(e) => setFormData({ ...formData, customPreparationType: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter custom preparation type..."
                required
              />
            )}
          </div>

          {/* Step 2: Yield Percent */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-sm font-bold">2</span>
              <h3 className="font-semibold text-gray-900">What's the yield?</h3>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="number"
                step="5"
                min="10"
                max="150"
                value={formData.yieldPercent}
                onChange={(e) => setFormData({ ...formData, yieldPercent: e.target.value })}
                className="w-24 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-center text-lg font-semibold"
              />
              <span className="text-lg">%</span>
              <span className="text-sm text-gray-500">
                of raw weight becomes this prep
              </span>
            </div>

            <div className="flex gap-2">
              {[70, 75, 80, 85, 90].map(pct => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setFormData({ ...formData, yieldPercent: pct.toString() })}
                  className={`px-3 py-1 text-sm rounded border ${
                    formData.yieldPercent === pct.toString()
                      ? 'bg-amber-100 border-amber-400 text-amber-800'
                      : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {pct}%
                </button>
              ))}
            </div>

            <p className="text-xs text-gray-500">
              Example: 6 oz raw chicken at {formData.yieldPercent}% yield = {(6 * (parseFloat(formData.yieldPercent) || 100) / 100).toFixed(1)} oz cooked
            </p>
          </div>

          {/* Step 3: Portion Size - THE KEY PART */}
          <div className="space-y-4 p-4 bg-green-50 rounded-lg border-2 border-green-300">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-green-600 text-white text-sm font-bold">3</span>
              <h3 className="font-semibold text-green-900">Portion size on menu items</h3>
            </div>

            <p className="text-sm text-green-800">
              When <strong>{previewName}</strong> is added to a sandwich, salad, etc. - how much?
            </p>

            <div className="flex items-center gap-3">
              <input
                type="number"
                step="0.5"
                min="0.5"
                value={formData.portionAmount}
                onChange={(e) => setFormData({ ...formData, portionAmount: e.target.value })}
                className="w-24 px-3 py-2 border-2 border-green-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-center text-lg font-semibold"
                required
              />
              <select
                value={formData.portionUnit}
                onChange={(e) => setFormData({ ...formData, portionUnit: e.target.value })}
                className="px-3 py-2 border-2 border-green-400 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-green-500 font-medium"
                required
              >
                {PORTION_UNITS.map(unit => (
                  <option key={unit.value} value={unit.value}>{unit.label}</option>
                ))}
              </select>
            </div>

            {/* The Math - Show how it connects */}
            {portionAmount > 0 && (
              <div className="p-3 bg-white rounded-lg border border-green-200">
                <p className="font-semibold text-gray-900 mb-2">📊 Inventory Math:</p>
                <div className="space-y-1 text-sm">
                  <p className="text-gray-700">
                    <span className="font-medium">{formData.portionAmount} {formData.portionUnit}</span> {previewName} on a menu item
                  </p>
                  <p className="text-gray-500">↓</p>
                  <p className="text-gray-700">
                    Deducts <span className="font-medium text-blue-600">{rawNeeded.toFixed(2)} {formData.portionUnit}</span> from {parentIngredient.name} inventory
                  </p>
                  <p className="text-xs text-gray-500 mt-2">
                    ({formData.portionAmount} ÷ {formData.yieldPercent}% = {rawNeeded.toFixed(2)} raw)
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Name Preview */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Name (auto-generated, or customize)
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={previewName}
            />
            <p className="text-sm text-gray-500">
              Will be named: <strong>{previewName}</strong>
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-green-600 hover:bg-green-700"
              disabled={!formData.preparationType || !formData.portionAmount}
            >
              Add Prep Item
            </Button>
          </div>
        </form>
    </Modal>
  )
}
