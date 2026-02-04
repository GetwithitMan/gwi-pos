'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  OUTPUT_UNITS,
  UNIT_CATEGORIES,
  getUnitPrecision,
} from '@/lib/units'
import type { Ingredient, IngredientCategory, InventoryItemRef, PrepItemRef } from './IngredientLibrary'

// Recipe component type
interface RecipeComponent {
  id: string
  componentId: string
  component: {
    id: string
    name: string
    standardQuantity?: number | null
    standardUnit?: string | null
  }
  quantity: number
  unit: string
}

interface InventoryItemEditorProps {
  ingredient: Ingredient | null
  categories: IngredientCategory[]
  inventoryItems: InventoryItemRef[]
  prepItems: PrepItemRef[]
  onSave: (data: Partial<Ingredient>) => void
  onClose: () => void
  onChangeType: () => void
}

export function InventoryItemEditor({
  ingredient,
  categories,
  inventoryItems,
  prepItems,
  onSave,
  onClose,
  onChangeType,
}: InventoryItemEditorProps) {
  const isEditing = !!ingredient

  // Form data
  const [formData, setFormData] = useState({
    name: ingredient?.name || '',
    description: ingredient?.description || '',
    categoryId: ingredient?.categoryId || '',
    // Source type: delivered vs made
    sourceType: (ingredient as any)?.sourceType || 'delivered',
    // Purchase info (for delivered items)
    purchaseUnit: (ingredient as any)?.purchaseUnit || 'case',
    purchaseCost: (ingredient as any)?.purchaseCost?.toString() || '',
    unitsPerPurchase: (ingredient as any)?.unitsPerPurchase?.toString() || '',
    // Storage unit (what you count/use)
    standardQuantity: ingredient?.standardQuantity?.toString() || '',  // Deprecated - use unitsPerPurchase
    standardUnit: ingredient?.standardUnit || 'lb',
    // Recipe batch yield (for items made from recipes)
    recipeYieldQuantity: (ingredient as any)?.recipeYieldQuantity?.toString() || '',
    recipeYieldUnit: (ingredient as any)?.recipeYieldUnit || 'lb',
    // Inventory link
    inventoryLinkType: ingredient?.inventoryItemId ? 'inventory' : ingredient?.prepItemId ? 'prep' : 'none' as 'none' | 'inventory' | 'prep',
    inventoryItemId: ingredient?.inventoryItemId || '',
    prepItemId: ingredient?.prepItemId || '',
    // Visibility
    visibility: ingredient?.visibility || 'visible',
    isActive: ingredient?.isActive ?? true,
    // Quick 86
    showOnQuick86: (ingredient as any)?.showOnQuick86 || false,
  })

  // Recipe state
  const [recipeComponents, setRecipeComponents] = useState<RecipeComponent[]>([])
  const [ingredientsByCategory, setIngredientsByCategory] = useState<Array<{
    category: { id: string; code: number; name: string; icon: string | null; color: string | null } | null
    ingredients: Array<{ id: string; name: string }>
  }>>([])
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [newComponentId, setNewComponentId] = useState('')
  const [newComponentQty, setNewComponentQty] = useState('')
  const [newComponentUnit, setNewComponentUnit] = useState('oz')
  const [recipeLoading, setRecipeLoading] = useState(false)

  // Cost preview
  const [previewCostPerUnit, setPreviewCostPerUnit] = useState<number | null>(null)
  const [recipeTotalCost, setRecipeTotalCost] = useState<number | null>(null)

  // Load recipe components when editing
  useEffect(() => {
    if (ingredient) {
      // Load recipe components
      fetch(`/api/ingredients/${ingredient.id}/recipe`)
        .then(res => res.json())
        .then(data => {
          if (data.data) {
            setRecipeComponents(data.data)
          }
        })
        .catch(err => console.error('Failed to load recipe:', err))

      // Load available ingredients grouped by category for the dropdown
      fetch(`/api/ingredients?locationId=${ingredient.locationId}&baseOnly=true&groupByCategory=true`)
        .then(res => res.json())
        .then(data => {
          if (data.data) {
            // Filter out the current ingredient from each category group
            const groupedData = data.data.map((group: { category: any; ingredients: Array<{ id: string; name: string }> }) => ({
              category: group.category,
              ingredients: group.ingredients.filter((i: { id: string }) => i.id !== ingredient.id)
            })).filter((group: { ingredients: any[] }) => group.ingredients.length > 0)
            setIngredientsByCategory(groupedData)
          }
        })
        .catch(err => console.error('Failed to load ingredients:', err))
    }
  }, [ingredient])

  // Calculate recipe total cost when components change using aggregated API
  useEffect(() => {
    if (!ingredient?.id) {
      setRecipeTotalCost(null)
      setPreviewCostPerUnit(null)
      return
    }

    if (recipeComponents.length > 0) {
      // Use aggregated recipe-cost API for efficient calculation
      fetch(`/api/ingredients/${ingredient.id}/recipe-cost`)
        .then(res => res.json())
        .then(data => {
          if (data.data) {
            setRecipeTotalCost(data.data.totalRecipeCost)
            setPreviewCostPerUnit(data.data.costPerOutputUnit)
          }
        })
        .catch(err => {
          console.error('Failed to fetch recipe cost:', err)
          setRecipeTotalCost(null)
          setPreviewCostPerUnit(null)
        })
    } else {
      setRecipeTotalCost(null)
      setPreviewCostPerUnit(null)
    }
  }, [ingredient?.id, recipeComponents.length, formData.recipeYieldQuantity])

  // Add a recipe component
  const handleAddRecipeComponent = async () => {
    if (!ingredient || !newComponentId || !newComponentQty) return

    setRecipeLoading(true)
    try {
      const res = await fetch(`/api/ingredients/${ingredient.id}/recipe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          componentId: newComponentId,
          quantity: parseFloat(newComponentQty),
          unit: newComponentUnit,
        }),
      })
      const data = await res.json()
      if (data.data) {
        setRecipeComponents([...recipeComponents, data.data])
        setNewComponentId('')
        setNewComponentQty('')
      }
    } catch (err) {
      console.error('Failed to add component:', err)
    } finally {
      setRecipeLoading(false)
    }
  }

  // Remove a recipe component
  const handleRemoveRecipeComponent = async (recipeId: string) => {
    if (!ingredient) return

    try {
      await fetch(`/api/ingredients/${ingredient.id}/recipe?recipeId=${recipeId}`, {
        method: 'DELETE',
      })
      setRecipeComponents(recipeComponents.filter(c => c.id !== recipeId))
    } catch (err) {
      console.error('Failed to remove component:', err)
    }
  }

  // Update a recipe component (quantity or unit) with error handling and rollback
  const handleUpdateRecipeComponent = async (recipeId: string, quantity: number, unit: string) => {
    if (!ingredient) return

    // Save previous state for rollback
    const previousComponents = [...recipeComponents]

    // Optimistically update UI
    setRecipeComponents(recipeComponents.map(c =>
      c.id === recipeId ? { ...c, quantity, unit } : c
    ))

    try {
      const res = await fetch(`/api/ingredients/${ingredient.id}/recipe`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipeId, quantity, unit }),
      })

      if (!res.ok) {
        throw new Error(`Update failed: ${res.statusText}`)
      }

      const data = await res.json()
      if (data.data) {
        // Confirm update with server response
        setRecipeComponents(recipeComponents.map(c =>
          c.id === recipeId ? { ...c, quantity: data.data.quantity, unit: data.data.unit } : c
        ))
      } else {
        // Server didn't return expected data - rollback
        setRecipeComponents(previousComponents)
      }
    } catch (err) {
      console.error('Failed to update component, rolling back:', err)
      // Rollback to previous state on error
      setRecipeComponents(previousComponents)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const data: Partial<Ingredient> & Record<string, any> = {
      name: formData.name,
      description: formData.description || null,
      categoryId: formData.categoryId || null,
      inventoryItemId: formData.inventoryLinkType === 'inventory' ? formData.inventoryItemId || null : null,
      prepItemId: formData.inventoryLinkType === 'prep' ? formData.prepItemId || null : null,
      visibility: formData.visibility,
      isActive: formData.isActive,

      // Source type
      sourceType: formData.sourceType,

      // Purchase info (for delivered items)
      purchaseUnit: formData.sourceType === 'delivered' ? formData.purchaseUnit : null,
      purchaseCost: formData.sourceType === 'delivered' && formData.purchaseCost
        ? parseFloat(formData.purchaseCost)
        : null,
      unitsPerPurchase: formData.sourceType === 'delivered' && formData.unitsPerPurchase
        ? parseFloat(formData.unitsPerPurchase)
        : null,

      // Storage unit (what you count/use)
      standardQuantity: formData.unitsPerPurchase ? parseFloat(formData.unitsPerPurchase) : null,  // Sync with unitsPerPurchase
      standardUnit: formData.standardUnit || null,

      // Recipe batch yield (if has recipe)
      recipeYieldQuantity: formData.recipeYieldQuantity ? parseFloat(formData.recipeYieldQuantity) : null,
      recipeYieldUnit: formData.recipeYieldUnit || null,

      // Mark as base/inventory item
      isBaseIngredient: true,
      parentIngredientId: null, // Clear any parent relationship

      // Quick 86
      showOnQuick86: formData.showOnQuick86,
    }

    onSave(data)
  }

  return (
    <>
      {/* Header */}
      <div className="p-6 border-b sticky top-0 bg-white z-10">
        <div className="flex items-center justify-between mb-1">
          <span className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs font-bold uppercase">
            Inventory Item
          </span>
          {isEditing && (
            <button
              type="button"
              onClick={onChangeType}
              className="text-xs text-gray-500 hover:text-blue-600 underline"
            >
              Change to Prep Item
            </button>
          )}
        </div>
        <h2 className="text-xl font-bold">
          {isEditing ? 'Edit Inventory Item' : 'Add Inventory Item'}
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          Base ingredient that you purchase from vendors. Prep items can be made from this.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        {/* ========== Source Type Toggle ========== */}
        <div className="space-y-4 p-5 bg-gray-50 rounded-xl border-2 border-gray-300">
          <h3 className="font-bold text-gray-900 text-lg">
            How do you get {formData.name || 'this item'}?
          </h3>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, sourceType: 'delivered' })}
              className={`flex-1 p-4 rounded-xl border-2 transition-all ${
                formData.sourceType === 'delivered'
                  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="text-2xl mb-1">📦</div>
              <div className={`font-bold ${formData.sourceType === 'delivered' ? 'text-blue-900' : 'text-gray-700'}`}>
                Delivered
              </div>
              <div className="text-xs text-gray-500">Purchased from vendor</div>
            </button>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, sourceType: 'made' })}
              className={`flex-1 p-4 rounded-xl border-2 transition-all ${
                formData.sourceType === 'made'
                  ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-200'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="text-2xl mb-1">👨‍🍳</div>
              <div className={`font-bold ${formData.sourceType === 'made' ? 'text-orange-900' : 'text-gray-700'}`}>
                Made In-House
              </div>
              <div className="text-xs text-gray-500">Made from a recipe</div>
            </button>
          </div>
        </div>

        {/* ========== Delivered: Purchase & Contents ========== */}
        {formData.sourceType === 'delivered' && (
          <div className="space-y-4 p-5 bg-blue-50 rounded-xl border-2 border-blue-300">
            {/* What you order */}
            <div className="space-y-2">
              <h3 className="font-bold text-blue-900 text-lg flex items-center gap-2">
                <span>📦</span> What do you order?
              </h3>
              <p className="text-sm text-blue-700">How does this appear on your vendor invoice?</p>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-gray-700 font-medium">1</span>
                <select
                  value={formData.purchaseUnit}
                  onChange={(e) => setFormData({ ...formData, purchaseUnit: e.target.value })}
                  className="px-3 py-2 border-2 border-blue-400 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
                >
                  <option value="case">case</option>
                  <option value="bag">bag</option>
                  <option value="box">box</option>
                  <option value="bottle">bottle</option>
                  <option value="jar">jar</option>
                  <option value="can">can</option>
                  <option value="gallon">gallon</option>
                  <option value="each">each</option>
                  <option value="lb">lb</option>
                </select>
                <span className="text-gray-700 font-medium">costs</span>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.purchaseCost}
                    onChange={(e) => setFormData({ ...formData, purchaseCost: e.target.value })}
                    className="w-28 pl-7 pr-3 py-2 border-2 border-green-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-center text-xl font-bold"
                    placeholder="0.00"
                    aria-label="Purchase cost in dollars"
                  />
                </div>
              </div>
            </div>

            {/* What's inside */}
            <div className="space-y-2 pt-3 border-t border-blue-200">
              <h3 className="font-bold text-blue-900 text-lg flex items-center gap-2">
                <span>📋</span> What's inside?
              </h3>
              <p className="text-sm text-blue-700">How much usable product is in each {formData.purchaseUnit || 'unit'}?</p>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-gray-700 font-medium">Contains</span>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={formData.unitsPerPurchase}
                  onChange={(e) => setFormData({ ...formData, unitsPerPurchase: e.target.value })}
                  className="w-24 px-3 py-2 border-2 border-blue-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-center text-xl font-bold"
                  placeholder="50"
                  aria-label="Units per purchase"
                />
                <select
                  value={formData.standardUnit}
                  onChange={(e) => setFormData({ ...formData, standardUnit: e.target.value })}
                  className="px-3 py-2 border-2 border-blue-400 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
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

            {/* Cost calculation */}
            {formData.unitsPerPurchase && formData.purchaseCost && (
              <div className="p-4 bg-green-100 rounded-lg border border-green-300 space-y-1">
                <div className="text-green-800 font-bold text-lg">
                  💰 Cost per {formData.standardUnit}: ${(parseFloat(formData.purchaseCost) / parseFloat(formData.unitsPerPurchase)).toFixed(4)}
                </div>
                <div className="text-green-700 text-sm">
                  1 {formData.purchaseUnit} @ ${parseFloat(formData.purchaseCost || '0').toFixed(2)} ÷ {formData.unitsPerPurchase} {formData.standardUnit}
                </div>
              </div>
            )}

            {/* Examples */}
            <div className="text-xs text-gray-500 space-y-1 pt-2">
              <p className="font-medium">Examples:</p>
              <p>• Flour: 1 <strong>bag</strong> @ $23 contains <strong>50 lb</strong> → $0.46/lb</p>
              <p>• Cheese: 1 <strong>case</strong> @ $45 contains <strong>120 slices</strong> → $0.375/slice</p>
              <p>• Olive Oil: 1 <strong>gallon</strong> @ $16 contains <strong>128 oz</strong> → $0.125/oz</p>
            </div>
          </div>
        )}

        {/* ========== Made: Recipe Section ========== */}
        {formData.sourceType === 'made' && !ingredient && (
          <div className="space-y-4 p-5 bg-orange-50 rounded-xl border-2 border-orange-300">
            <h3 className="font-bold text-orange-900 text-lg">
              Recipe - What makes this item?
            </h3>
            <p className="text-sm text-orange-800">
              Save the item first, then you can add recipe components.
            </p>
            <div className="p-4 bg-orange-100 rounded-lg border border-orange-200 text-center text-orange-700">
              💡 Click "Create Inventory Item" below, then edit to add recipe ingredients.
            </div>
          </div>
        )}
        {formData.sourceType === 'made' && ingredient && (
          <div className="space-y-4 p-5 bg-orange-50 rounded-xl border-2 border-orange-300">
            <h3 className="font-bold text-orange-900 text-lg">
              Recipe - What makes this item?
            </h3>
            <p className="text-sm text-orange-800">
              Add the ingredients that make up this item. The cost will be calculated automatically from the recipe.
            </p>

              {/* Current recipe components */}
              {recipeComponents.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-medium text-orange-900">Current Recipe:</h4>
                  {recipeComponents.map(comp => (
                    <div
                      key={comp.id}
                      className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-orange-200 gap-2"
                    >
                      <span className="font-medium text-gray-800 min-w-0 truncate flex-shrink">
                        {comp.component.name}
                      </span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <input
                          type="number"
                          step="0.25"
                          min="0"
                          value={comp.quantity}
                          onChange={(e) => {
                            const newQty = parseFloat(e.target.value) || 0
                            // Update local state immediately for responsiveness
                            setRecipeComponents(recipeComponents.map(c =>
                              c.id === comp.id ? { ...c, quantity: newQty } : c
                            ))
                          }}
                          onBlur={(e) => {
                            const newQty = parseFloat(e.target.value) || 0
                            if (newQty !== comp.quantity) {
                              handleUpdateRecipeComponent(comp.id, newQty, comp.unit)
                            }
                          }}
                          className="w-16 px-2 py-1 border border-orange-300 rounded text-center text-sm font-medium focus:outline-none focus:ring-1 focus:ring-orange-400"
                          aria-label={`Quantity of ${comp.component.name}`}
                        />
                        <select
                          value={comp.unit}
                          onChange={(e) => {
                            const newUnit = e.target.value
                            // Update local state immediately
                            setRecipeComponents(recipeComponents.map(c =>
                              c.id === comp.id ? { ...c, unit: newUnit } : c
                            ))
                            // Save to server
                            handleUpdateRecipeComponent(comp.id, comp.quantity, newUnit)
                          }}
                          className="px-2 py-1 border border-orange-300 rounded bg-white text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
                        >
                          {UNIT_CATEGORIES.map(cat => (
                            <optgroup key={cat.key} label={cat.label}>
                              {OUTPUT_UNITS.filter(u => u.category === cat.key).map(unit => (
                                <option key={unit.value} value={unit.value}>{unit.label}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleRemoveRecipeComponent(comp.id)}
                          className="text-red-400 hover:text-red-600 p-1 hover:bg-red-50 rounded transition-colors"
                          title="Remove"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new component */}
              <div className="space-y-3">
                <h4 className="font-medium text-orange-900">Add Ingredient:</h4>

                {/* Category-grouped ingredient selector */}
                <div className="border border-orange-200 rounded-lg bg-white max-h-64 overflow-y-auto">
                  {ingredientsByCategory.length === 0 ? (
                    <div className="p-3 text-gray-500 text-sm text-center">No ingredients available</div>
                  ) : (
                    ingredientsByCategory.map(group => {
                      const categoryKey = group.category?.id || 'uncategorized'
                      const isExpanded = expandedCategories.has(categoryKey)
                      // Filter out already-added components
                      const availableInCategory = group.ingredients.filter(
                        i => !recipeComponents.some(c => c.componentId === i.id)
                      )
                      if (availableInCategory.length === 0) return null

                      return (
                        <div key={categoryKey} className="border-b border-orange-100 last:border-b-0">
                          {/* Category header - clickable to expand/collapse */}
                          <button
                            type="button"
                            onClick={() => {
                              const newExpanded = new Set(expandedCategories)
                              if (isExpanded) {
                                newExpanded.delete(categoryKey)
                              } else {
                                newExpanded.add(categoryKey)
                              }
                              setExpandedCategories(newExpanded)
                            }}
                            className="w-full px-3 py-2 flex items-center justify-between hover:bg-orange-50 transition-colors"
                          >
                            <span className="font-medium text-gray-800 flex items-center gap-2">
                              {group.category?.icon && <span>{group.category.icon}</span>}
                              {group.category?.name || 'Uncategorized'}
                              <span className="text-xs text-gray-500">({availableInCategory.length})</span>
                            </span>
                            <span className="text-gray-400 text-sm">
                              {isExpanded ? '▼' : '▶'}
                            </span>
                          </button>

                          {/* Ingredient list - shown when expanded */}
                          {isExpanded && (
                            <div className="bg-orange-50/50">
                              {availableInCategory.map(ing => {
                                const isSelected = newComponentId === ing.id
                                return (
                                  <button
                                    key={ing.id}
                                    type="button"
                                    onClick={() => setNewComponentId(isSelected ? '' : ing.id)}
                                    className={`w-full px-4 py-1.5 text-left text-sm transition-colors flex items-center gap-2 ${
                                      isSelected
                                        ? 'bg-orange-200 text-orange-900 font-medium'
                                        : 'hover:bg-orange-100 text-gray-700'
                                    }`}
                                  >
                                    <span className={`w-3 h-3 rounded-full border ${
                                      isSelected ? 'bg-orange-500 border-orange-600' : 'border-gray-300'
                                    }`} />
                                    {ing.name}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>

                {/* Selected ingredient display + quantity inputs */}
                {newComponentId && (
                  <div className="flex items-center gap-2 flex-wrap p-2 bg-orange-100 rounded-lg">
                    <span className="text-sm font-medium text-orange-900">
                      Selected: {ingredientsByCategory.flatMap(g => g.ingredients).find(i => i.id === newComponentId)?.name}
                    </span>
                    <div className="flex items-center gap-2 ml-auto">
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        value={newComponentQty}
                        onChange={(e) => setNewComponentQty(e.target.value)}
                        placeholder="Qty"
                        className="w-20 px-2 py-1.5 border rounded-lg text-center text-sm"
                      />
                      <select
                        value={newComponentUnit}
                        onChange={(e) => setNewComponentUnit(e.target.value)}
                        className="px-2 py-1.5 border rounded-lg bg-white text-sm"
                      >
                        {UNIT_CATEGORIES.map(cat => (
                          <optgroup key={cat.key} label={cat.label}>
                            {OUTPUT_UNITS.filter(u => u.category === cat.key).map(unit => (
                              <option key={unit.value} value={unit.value}>{unit.label}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <Button
                        type="button"
                        onClick={handleAddRecipeComponent}
                        disabled={!newComponentQty || recipeLoading}
                        size="sm"
                        className="bg-orange-600 hover:bg-orange-700"
                      >
                        {recipeLoading ? '...' : '+ Add'}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Hint when no ingredient selected */}
                {!newComponentId && (
                  <p className="text-xs text-gray-500">
                    Click a category to expand it, then click an ingredient to select it.
                  </p>
                )}
              </div>

              {/* Recipe Yield Section */}
              {recipeComponents.length > 0 && (
                <div className="space-y-3 p-4 bg-white rounded-lg border border-orange-200">
                  <h4 className="font-bold text-orange-900 flex items-center gap-2">
                    <span>📊</span> Recipe Yield
                  </h4>
                  <p className="text-sm text-gray-600">
                    How much does this recipe make? Prep items will use this to calculate their cost.
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-gray-700 font-medium">This recipe makes</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={formData.recipeYieldQuantity}
                      onChange={(e) => setFormData({ ...formData, recipeYieldQuantity: e.target.value })}
                      className="w-20 px-2 py-2 border-2 border-orange-400 rounded-lg text-center font-bold"
                      placeholder="50"
                      aria-label="Recipe yield quantity"
                    />
                    <select
                      value={formData.recipeYieldUnit}
                      onChange={(e) => setFormData({ ...formData, recipeYieldUnit: e.target.value })}
                      className="px-2 py-2 border-2 border-orange-400 rounded-lg bg-white font-semibold"
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

                  {/* Cost breakdown */}
                  {recipeTotalCost !== null && recipeTotalCost > 0 && (
                    <div className="p-4 bg-green-100 rounded-lg border border-green-300 mt-2 space-y-2">
                      <div className="text-green-800 font-bold text-lg">
                        💰 Recipe cost: ${recipeTotalCost.toFixed(2)}
                      </div>
                      {previewCostPerUnit !== null && formData.recipeYieldQuantity && (
                        <>
                          <div className="text-green-800">
                            Cost per {formData.recipeYieldUnit}: <strong>${previewCostPerUnit.toFixed(4)}</strong>
                          </div>
                          {/* Show cost per oz if yield is in lb */}
                          {formData.recipeYieldUnit === 'lb' && (
                            <div className="text-green-700 text-sm">
                              Cost per oz: <strong>${(previewCostPerUnit / 16).toFixed(4)}</strong>
                              <span className="text-green-600 ml-2">(for prep item costing)</span>
                            </div>
                          )}
                          {/* Show cost per oz if yield is in gallons */}
                          {formData.recipeYieldUnit === 'gallons' && (
                            <div className="text-green-700 text-sm">
                              Cost per oz: <strong>${(previewCostPerUnit / 128).toFixed(4)}</strong>
                              <span className="text-green-600 ml-2">(for prep item costing)</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Hint about prep items */}
                  <p className="text-xs text-gray-500 mt-2">
                    💡 Create prep items (like XL, L, M dough balls) as children of this item. Each prep item specifies how many oz/units it uses.
                  </p>
                </div>
              )}
          </div>
        )}

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
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              placeholder="e.g., Raw Chicken Breast, All-Purpose Flour"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Category
            </label>
            <select
              value={formData.categoryId}
              onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select category...</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>
                  {cat.icon} {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description (optional)
            </label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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

        {/* ========== Inventory Link ========== */}
        <details className="border rounded-lg">
          <summary className="px-4 py-3 cursor-pointer font-medium text-gray-700 hover:bg-gray-50">
            Link to Inventory System (Optional)
          </summary>
          <div className="px-4 pb-4 space-y-4">
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="inventoryLinkType"
                  value="none"
                  checked={formData.inventoryLinkType === 'none'}
                  onChange={() => setFormData({ ...formData, inventoryLinkType: 'none', inventoryItemId: '', prepItemId: '' })}
                  className="w-4 h-4"
                />
                <span>None</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="inventoryLinkType"
                  value="inventory"
                  checked={formData.inventoryLinkType === 'inventory'}
                  onChange={() => setFormData({ ...formData, inventoryLinkType: 'inventory', prepItemId: '' })}
                  className="w-4 h-4"
                />
                <span>Inventory Item</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="inventoryLinkType"
                  value="prep"
                  checked={formData.inventoryLinkType === 'prep'}
                  onChange={() => setFormData({ ...formData, inventoryLinkType: 'prep', inventoryItemId: '' })}
                  className="w-4 h-4"
                />
                <span>Prep Item</span>
              </label>
            </div>

            {formData.inventoryLinkType === 'inventory' && (
              <select
                value={formData.inventoryItemId}
                onChange={(e) => setFormData({ ...formData, inventoryItemId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg bg-white"
              >
                <option value="">Select inventory item...</option>
                {inventoryItems.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.storageUnit})
                  </option>
                ))}
              </select>
            )}

            {formData.inventoryLinkType === 'prep' && (
              <select
                value={formData.prepItemId}
                onChange={(e) => setFormData({ ...formData, prepItemId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg bg-white"
              >
                <option value="">Select prep item...</option>
                {prepItems.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.outputUnit})
                  </option>
                ))}
              </select>
            )}
          </div>
        </details>

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
          <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
            {isEditing ? 'Save Changes' : 'Create Inventory Item'}
          </Button>
        </div>
      </form>
    </>
  )
}
