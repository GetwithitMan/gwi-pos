'use client'

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import {
  OUTPUT_UNITS,
  UNIT_CATEGORIES,
  getUnitPrecision,
  getUnitCategory,
  getSuggestedUnits,
  type UnitDefinition,
} from '@/lib/units'
import {
  calculateYield,
  formatTransformation,
  canConvert,
} from '@/lib/unit-conversions'
import { useIngredientCost } from '@/hooks/useIngredientCost'
import type { Ingredient, IngredientCategory, InventoryItemRef } from './IngredientLibrary'

interface BaseIngredient {
  id: string
  name: string
  standardQuantity?: number | null
  standardUnit?: string | null
  categoryId?: string | null
}

interface PrepItemEditorProps {
  ingredient: Ingredient | null
  categories: IngredientCategory[]
  inventoryItems: InventoryItemRef[]
  selectedParentId?: string  // Parent ID passed from modal (for new items)
  onSave: (data: Partial<Ingredient>) => void
  onClose: () => void
  onChangeType: () => void
  onChangeParent?: () => void  // Callback to go back to parent selection
}

export function PrepItemEditor({
  ingredient,
  categories,
  inventoryItems,
  selectedParentId: propParentId,
  onSave,
  onClose,
  onChangeType,
  onChangeParent,
}: PrepItemEditorProps) {
  const isEditing = !!ingredient

  // Use parent ID from props or ingredient
  const selectedParentId = propParentId || ingredient?.parentIngredientId || ''
  const [baseIngredients, setBaseIngredients] = useState<BaseIngredient[]>([])
  const [loadingBases, setLoadingBases] = useState(false)

  // Form data
  const [formData, setFormData] = useState({
    name: ingredient?.name || '',
    description: ingredient?.description || '',
    categoryId: ingredient?.categoryId || '',
    // Explicit Input → Output model
    inputQuantity: ingredient?.inputQuantity?.toString() ||
                   ingredient?.portionSize?.toString() || '', // Fallback to legacy
    inputUnit: ingredient?.inputUnit ||
               ingredient?.portionUnit || 'oz',
    outputQuantity: ingredient?.outputQuantity?.toString() || '1',
    outputUnit: ingredient?.outputUnit || 'each',
    // Yield
    yieldPercent: ingredient?.yieldPercent
      ? (Number(ingredient.yieldPercent) * 100).toString()
      : '100',
    yieldMode: 'manual' as 'auto' | 'manual', // 'auto' calculates from input/output
    // Daily count settings
    isDailyCountItem: ingredient?.isDailyCountItem || false,
    countPrecision: ingredient?.countPrecision || 'whole',
    lowStockThreshold: ingredient?.lowStockThreshold?.toString() || '',
    criticalStockThreshold: ingredient?.criticalStockThreshold?.toString() || '',
    // Visibility
    visibility: ingredient?.visibility || 'visible',
    isActive: ingredient?.isActive ?? true,
    // Quick 86
    showOnQuick86: ingredient?.showOnQuick86 || false,
  })

  // Validation state
  const [validationError, setValidationError] = useState<string | null>(null)
  const [validationWarning, setValidationWarning] = useState<string | null>(null)

  // Get parent info (must be above hook that uses parentUnit)
  const parent = useMemo(() => {
    if (ingredient?.parentIngredient) {
      return ingredient.parentIngredient
    }
    return baseIngredients.find(b => b.id === selectedParentId)
  }, [ingredient?.parentIngredient, baseIngredients, selectedParentId])

  const parentName = parent?.name || 'the parent item'
  const parentUnit = parent?.standardUnit || 'lb'
  const parentQuantity = parent?.standardQuantity

  // Use shared cost calculation hook
  const { previewCost, parentCostPerUnit, derivedYield: hookDerivedYield, isLoading: costLoading } = useIngredientCost({
    parentIngredientId: selectedParentId || ingredient?.parentIngredientId || null,
    inputQuantity: formData.inputQuantity,
    inputUnit: formData.inputUnit,
    outputQuantity: formData.outputQuantity,
    outputUnit: formData.outputUnit,
    yieldPercent: formData.yieldPercent,
    parentUnit,
  })

  // Load base ingredients for parent selection and info
  useEffect(() => {
    // Load if: creating new item OR we have a propParentId but no parent info yet
    const needsParentInfo = propParentId && baseIngredients.length === 0
    if ((!isEditing || needsParentInfo) && baseIngredients.length === 0 && !loadingBases) {
      setLoadingBases(true)
      // Get locationId from ingredient or from global context/props
      const locationId = ingredient?.locationId || 'loc-1' // TODO: Pass locationId as prop
      fetch(`/api/ingredients?locationId=${locationId}&baseOnly=true&includeInactive=false`)
        .then(res => res.json())
        .then(data => {
          setBaseIngredients(data.data || [])
        })
        .catch(err => console.error('Failed to load base ingredients:', err))
        .finally(() => setLoadingBases(false))
    }
  }, [isEditing, baseIngredients.length, propParentId, loadingBases, ingredient])

  // Auto-default input unit to parent's unit when parent is selected
  useEffect(() => {
    if (parent && !formData.inputUnit) {
      setFormData(prev => ({ ...prev, inputUnit: parentUnit }))
    }
  }, [parent, parentUnit, formData.inputUnit])

  // Get suggested units based on parent
  const suggestedUnits = useMemo(() => {
    if (parent?.standardUnit) {
      return getSuggestedUnits(parent.standardUnit)
    }
    return OUTPUT_UNITS
  }, [parent?.standardUnit])

  // Use derived yield from hook if available, otherwise calculate locally
  const derivedYield = hookDerivedYield !== null ? hookDerivedYield : useMemo(() => {
    const inputQty = parseFloat(formData.inputQuantity) || 0
    const outputQty = parseFloat(formData.outputQuantity) || 0

    if (inputQty <= 0 || outputQty <= 0) return null

    return calculateYield(inputQty, formData.inputUnit, outputQty, formData.outputUnit)
  }, [formData.inputQuantity, formData.inputUnit, formData.outputQuantity, formData.outputUnit])

  // Validation
  useEffect(() => {
    const inputQty = parseFloat(formData.inputQuantity) || 0
    const outputQty = parseFloat(formData.outputQuantity) || 0
    const yieldVal = parseFloat(formData.yieldPercent) || 100

    setValidationError(null)
    setValidationWarning(null)

    if (inputQty < 0) {
      setValidationError('Input amount cannot be negative')
    } else if (outputQty < 0) {
      setValidationError('Output amount cannot be negative')
    } else if (yieldVal < 0 || yieldVal > 200) {
      setValidationError('Yield % should be between 0 and 200')
    } else if (inputQty > 0 && parentQuantity && inputQty > Number(parentQuantity)) {
      setValidationWarning(`This uses more than one full ${parentName} (${parentQuantity} ${parentUnit}). Is that intended?`)
    }

    // Check unit compatibility
    if (formData.inputUnit && formData.outputUnit) {
      const inputCat = getUnitCategory(formData.inputUnit)
      const outputCat = getUnitCategory(formData.outputUnit)

      // Warn if units are from different categories and not count
      if (inputCat && outputCat && inputCat !== outputCat &&
          inputCat !== 'count' && outputCat !== 'count') {
        setValidationWarning(`Input (${formData.inputUnit}) and output (${formData.outputUnit}) are different unit types. Yield calculation may not be accurate.`)
      }
    }
  }, [formData, parentQuantity, parentName, parentUnit])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (validationError) {
      return // Don't submit if there's an error
    }

    const inputQty = parseFloat(formData.inputQuantity) || null
    const outputQty = parseFloat(formData.outputQuantity) || 1

    // Determine yield: use auto-calculated if units are compatible and mode is auto
    let yieldPercent = parseFloat(formData.yieldPercent) / 100
    if (formData.yieldMode === 'auto' && derivedYield !== null) {
      yieldPercent = derivedYield / 100
    }

    const data: Partial<Ingredient> & Record<string, any> = {
      name: formData.name,
      description: formData.description || null,
      categoryId: formData.categoryId || null,
      visibility: formData.visibility,
      isActive: formData.isActive,

      // Explicit Input → Output
      inputQuantity: inputQty,
      inputUnit: formData.inputUnit || null,
      outputQuantity: outputQty,
      outputUnit: formData.outputUnit || 'each',

      // Set standard quantity/unit from output (for display/tracking)
      standardQuantity: outputQty,
      standardUnit: formData.outputUnit || 'each',

      // Yield
      yieldPercent: yieldPercent,

      // Daily count settings
      isDailyCountItem: formData.isDailyCountItem,
      countPrecision: formData.countPrecision,
      lowStockThreshold: formData.lowStockThreshold ? parseFloat(formData.lowStockThreshold) : null,
      criticalStockThreshold: formData.criticalStockThreshold ? parseFloat(formData.criticalStockThreshold) : null,

      // Mark as prep item
      isBaseIngredient: false,

      // Quick 86
      showOnQuick86: formData.showOnQuick86,
    }

    // Set parent ID:
    // - For new items: use selectedParentId
    // - For existing items being converted: use selectedParentId (from props)
    // - For existing prep items changing parent: use selectedParentId if different
    const effectiveParentId = selectedParentId || ingredient?.parentIngredientId
    if (effectiveParentId) {
      data.parentIngredientId = effectiveParentId
    }

    onSave(data)
  }

  // Format the transformation for display
  const transformationText = formData.inputQuantity && formData.outputQuantity
    ? formatTransformation(
        parseFloat(formData.inputQuantity),
        formData.inputUnit,
        parseFloat(formData.outputQuantity),
        formData.outputUnit
      )
    : null

  return (
    <>
      {/* Header */}
      <div className="p-6 border-b sticky top-0 bg-white z-10">
        <div className="flex items-center justify-between mb-1">
          <span className="px-2 py-0.5 bg-green-600 text-white rounded text-xs font-bold uppercase">
            Prep Item
          </span>
          {isEditing && (
            <button
              type="button"
              onClick={onChangeType}
              className="text-xs text-gray-500 hover:text-blue-600 underline"
            >
              Change to Inventory Item
            </button>
          )}
        </div>
        <h2 className="text-xl font-bold">
          {isEditing ? 'Edit Prep Item' : 'Add Prep Item'}
        </h2>
        {/* Show transformation summary */}
        {parent && (
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-gray-600">
              Made from: <strong className="text-blue-600">{parentName}</strong>
              {transformationText && (
                <span className="text-gray-500 ml-2">({transformationText})</span>
              )}
            </p>
            {onChangeParent && (
              <button
                type="button"
                onClick={onChangeParent}
                className="text-xs text-gray-500 hover:text-blue-600 underline"
              >
                Change parent
              </button>
            )}
          </div>
        )}
        <p className="text-xs text-gray-500 mt-1">
          Define how much of the parent item is used to make this prep item. Cost is calculated automatically.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        {/* Parent Selection (only if no parent was provided via props or ingredient) */}
        {!isEditing && !propParentId && !selectedParentId && (
          <div className="space-y-2 p-4 bg-blue-50 rounded-xl border border-blue-200">
            <label className="block font-medium text-blue-900">
              What is this made from?
            </label>
            <select
              value={selectedParentId}
              onChange={(e) => {/* Parent selection handled by modal wrapper */}}
              className="w-full px-3 py-2 border-2 border-blue-400 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Select parent ingredient...</option>
              {loadingBases ? (
                <option disabled>Loading...</option>
              ) : (
                baseIngredients.map(ing => (
                  <option key={ing.id} value={ing.id}>
                    {ing.name} {ing.standardQuantity && ing.standardUnit && `(${ing.standardQuantity} ${ing.standardUnit})`}
                  </option>
                ))
              )}
            </select>
          </div>
        )}

        {/* ========== THE KEY QUESTION: Input → Output ========== */}
        <div className="space-y-4 p-5 bg-green-50 rounded-xl border-2 border-green-400">
          <div>
            <h3 className="font-bold text-green-900 text-lg">
              How much of {parentName} makes this prep item?
            </h3>
            <p className="text-sm text-green-700 mt-1">
              Define the transformation: [input amount] of parent produces [output amount] of this prep.
            </p>
          </div>

          {/* Input → Output Fields */}
          <div className="flex flex-wrap items-center gap-3 bg-white p-4 rounded-lg border border-green-200">
            {/* Input */}
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.inputQuantity}
                onChange={(e) => setFormData({ ...formData, inputQuantity: e.target.value })}
                className="w-24 px-3 py-2 border-2 border-green-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-center text-xl font-bold text-green-700"
                placeholder="6"
                aria-label="Input quantity from parent ingredient"
              />
              <select
                value={formData.inputUnit}
                onChange={(e) => {
                  const newUnit = e.target.value
                  const newPrecision = getUnitPrecision(newUnit)
                  setFormData({ ...formData, inputUnit: newUnit })
                }}
                className="px-3 py-2 border-2 border-green-500 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-green-500 font-semibold text-green-700"
              >
                {UNIT_CATEGORIES.map(cat => (
                  <optgroup key={cat.key} label={cat.label}>
                    {OUTPUT_UNITS.filter(u => u.category === cat.key).map(unit => (
                      <option key={unit.value} value={unit.value}>{unit.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <span className="text-gray-600 font-medium">of {parentName} makes</span>

            {/* Output */}
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.outputQuantity}
                onChange={(e) => setFormData({ ...formData, outputQuantity: e.target.value })}
                className="w-24 px-3 py-2 border-2 border-green-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-center text-xl font-bold text-green-700"
                placeholder="2"
                aria-label="Output quantity produced"
              />
              <select
                value={formData.outputUnit}
                onChange={(e) => {
                  const newUnit = e.target.value
                  const newPrecision = getUnitPrecision(newUnit)
                  setFormData({ ...formData, outputUnit: newUnit, countPrecision: newPrecision })
                }}
                className="px-3 py-2 border-2 border-green-500 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-green-500 font-semibold text-green-700"
              >
                {UNIT_CATEGORIES.map(cat => (
                  <optgroup key={cat.key} label={cat.label}>
                    {OUTPUT_UNITS.filter(u => u.category === cat.key).map(unit => (
                      <option key={unit.value} value={unit.value}>{unit.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          {/* Quick Examples */}
          <div className="text-sm text-green-700">
            <p className="font-medium mb-1">Examples:</p>
            <ul className="text-xs text-gray-600 space-y-0.5">
              <li>6 oz Raw Chicken makes 2 oz Shredded Chicken (bulk → bulk)</li>
              <li>1 ball Dough makes 1 crust (discrete → discrete)</li>
              <li>1 lb Cheese makes 16 slices (bulk → count)</li>
            </ul>
          </div>

          {/* Validation Messages */}
          {validationError && (
            <p className="text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg border border-red-200">
              {validationError}
            </p>
          )}
          {validationWarning && !validationError && (
            <p className="text-amber-700 text-sm bg-amber-50 px-3 py-2 rounded-lg border border-amber-200">
              {validationWarning}
            </p>
          )}

          {/* Cost Preview */}
          {previewCost !== null ? (
            <div className="text-sm text-green-800 bg-white px-3 py-2 rounded-lg border border-green-200">
              <span className="font-semibold">Estimated cost:</span>{' '}
              <span className="text-lg font-bold">${previewCost.toFixed(2)}</span>{' '}
              per {formData.outputUnit}
              {derivedYield !== null && (
                <span className="text-gray-500 ml-2">
                  ({derivedYield.toFixed(1)}% yield)
                </span>
              )}
            </div>
          ) : selectedParentId && formData.inputQuantity && !costLoading ? (
            <div className="text-sm text-amber-800 bg-amber-50 px-3 py-2 rounded-lg border border-amber-300">
              <span className="font-semibold">Cost unavailable</span>
              <span className="text-amber-600 ml-1">
                — Add purchase costs to {parentName}&apos;s recipe ingredients to calculate cost automatically
              </span>
            </div>
          ) : null}
        </div>

        {/* ========== Yield % (Cooking/Prep Loss) ========== */}
        <details className="border border-amber-300 rounded-xl overflow-hidden bg-amber-50">
          <summary className="px-4 py-3 cursor-pointer font-medium text-amber-900 hover:bg-amber-100 flex items-center justify-between">
            <span>Cooking Yield (Optional)</span>
            <span className="text-sm font-normal text-amber-600">
              {derivedYield !== null
                ? `Auto: ${derivedYield.toFixed(1)}%`
                : formData.yieldPercent !== '100'
                  ? `${formData.yieldPercent}%`
                  : 'No loss'}
            </span>
          </summary>
          <div className="px-4 pb-4 pt-2 space-y-3 border-t border-amber-200">
            <p className="text-sm text-amber-700">
              If the input/output units are compatible, yield is calculated automatically.
              Override manually if needed (e.g., for cooking shrinkage not captured in the output).
            </p>

            {/* Auto vs Manual toggle */}
            {derivedYield !== null && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, yieldMode: 'auto' })}
                  className={`px-3 py-1 text-sm rounded-lg border transition-colors ${
                    formData.yieldMode === 'auto'
                      ? 'bg-amber-600 text-white border-amber-600'
                      : 'bg-white text-amber-700 border-amber-300 hover:border-amber-500'
                  }`}
                >
                  Auto ({derivedYield.toFixed(1)}%)
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, yieldMode: 'manual' })}
                  className={`px-3 py-1 text-sm rounded-lg border transition-colors ${
                    formData.yieldMode === 'manual'
                      ? 'bg-amber-600 text-white border-amber-600'
                      : 'bg-white text-amber-700 border-amber-300 hover:border-amber-500'
                  }`}
                >
                  Manual
                </button>
              </div>
            )}

            {/* Manual yield input */}
            {(formData.yieldMode === 'manual' || derivedYield === null) && (
              <>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    step="1"
                    min="1"
                    max="200"
                    value={formData.yieldPercent}
                    onChange={(e) => setFormData({ ...formData, yieldPercent: e.target.value })}
                    className="w-20 px-3 py-2 border-2 border-amber-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 text-center text-lg font-bold"
                    aria-label="Yield percentage"
                  />
                  <span className="text-amber-800 font-bold">% usable</span>
                </div>
                <div className="flex gap-2">
                  {[75, 85, 90, 100].map(pct => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setFormData({ ...formData, yieldPercent: pct.toString() })}
                      className={`px-3 py-1 text-sm rounded-lg border transition-colors ${
                        formData.yieldPercent === pct.toString()
                          ? 'bg-amber-600 text-white border-amber-600'
                          : 'bg-white text-amber-700 border-amber-300 hover:border-amber-500'
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </details>

        {/* ========== Daily Count Settings ========== */}
        <details className="border border-purple-300 rounded-xl overflow-hidden bg-purple-50">
          <summary className="px-4 py-3 cursor-pointer font-medium text-purple-900 hover:bg-purple-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={formData.isDailyCountItem}
                onChange={(e) => {
                  e.stopPropagation()
                  setFormData({ ...formData, isDailyCountItem: e.target.checked })
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-5 h-5 rounded border-purple-400 text-purple-600 focus:ring-purple-500"
              />
              <span>Daily Count Item</span>
            </div>
            <span className="text-sm font-normal text-purple-600">
              {formData.isDailyCountItem ? 'Tracked' : 'Not tracked'}
            </span>
          </summary>
          <div className="px-4 pb-4 pt-2 space-y-4 border-t border-purple-200">
            <p className="text-sm text-purple-700">
              Include in morning prep count. Set stock alerts to show warnings on POS.
            </p>

            {/* Stock Alert Thresholds */}
            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-yellow-300">
                <span className="text-yellow-700 text-sm">Low:</span>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={formData.lowStockThreshold}
                  onChange={(e) => setFormData({ ...formData, lowStockThreshold: e.target.value })}
                  className="w-16 px-2 py-1 border rounded text-center text-sm"
                  placeholder="10"
                  aria-label="Low stock threshold"
                />
              </div>
              <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-red-300">
                <span className="text-red-700 text-sm">Critical:</span>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={formData.criticalStockThreshold}
                  onChange={(e) => setFormData({ ...formData, criticalStockThreshold: e.target.value })}
                  className="w-16 px-2 py-1 border rounded text-center text-sm"
                  placeholder="3"
                  aria-label="Critical stock threshold"
                />
              </div>
            </div>
          </div>
        </details>

        {/* ========== Basic Info ========== */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 border-b pb-2">Basic Info</h3>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              required
              placeholder="e.g., Grilled Chicken, Sliced American"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description (optional)
            </label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="Optional notes"
            />
          </div>
        </div>

        {/* ========== Quick 86 ========== */}
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.showOnQuick86}
              onChange={(e) => setFormData({ ...formData, showOnQuick86: e.target.checked })}
              className="w-5 h-5 rounded border-red-400 text-red-600 focus:ring-red-500"
            />
            <div>
              <span className="font-medium text-red-900">Show on Quick 86 List</span>
              <p className="text-xs text-red-700 mt-0.5">
                Add to the quick access list at the top of the 86 page for fast marking as out of stock
              </p>
            </div>
          </label>
        </div>

        {/* ========== Visibility ========== */}
        <details className="border rounded-lg">
          <summary className="px-4 py-3 cursor-pointer font-medium text-gray-700 hover:bg-gray-50">
            Visibility & Status
          </summary>
          <div className="px-4 pb-4 space-y-4">
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="visibility"
                  value="visible"
                  checked={formData.visibility === 'visible'}
                  onChange={() => setFormData({ ...formData, visibility: 'visible' })}
                  className="w-4 h-4"
                />
                <span>Visible</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="visibility"
                  value="admin_only"
                  checked={formData.visibility === 'admin_only'}
                  onChange={() => setFormData({ ...formData, visibility: 'admin_only' })}
                  className="w-4 h-4"
                />
                <span>Admin Only</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="visibility"
                  value="hidden"
                  checked={formData.visibility === 'hidden'}
                  onChange={() => setFormData({ ...formData, visibility: 'hidden' })}
                  className="w-4 h-4"
                />
                <span>Hidden</span>
              </label>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                className="w-4 h-4"
              />
              <span className="font-medium">Active</span>
            </label>
          </div>
        </details>

        {/* ========== Actions ========== */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            className="bg-green-600 hover:bg-green-700"
            disabled={!!validationError}
          >
            {isEditing ? 'Save Changes' : 'Create Prep Item'}
          </Button>
        </div>
      </form>
    </>
  )
}
