'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'

interface BottleProduct {
  id: string
  name: string
  brand?: string | null
  tier: string
  pourCost: number | null
  spiritCategory: {
    id: string
    name: string
  }
}

interface RecipeIngredient {
  id?: string
  bottleProductId: string
  bottleProductName?: string
  spiritCategory?: string
  tier?: string
  pourCount: number
  pourCost?: number
  isSubstitutable: boolean
  sortOrder: number
}

interface RecipeBuilderProps {
  menuItemId: string
  menuItemPrice: number
  isExpanded: boolean
  onToggle: () => void
}

export function RecipeBuilder({ menuItemId, menuItemPrice, isExpanded, onToggle }: RecipeBuilderProps) {
  const [bottles, setBottles] = useState<BottleProduct[]>([])
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Load bottles and existing recipe
  useEffect(() => {
    if (isExpanded) {
      loadData()
    }
  }, [isExpanded, menuItemId])

  const loadData = async () => {
    setLoading(true)
    try {
      const [bottlesRes, recipeRes] = await Promise.all([
        fetch('/api/liquor/bottles'),
        fetch(`/api/menu/items/${menuItemId}/recipe`),
      ])

      if (bottlesRes.ok) {
        const bottlesData = await bottlesRes.json()
        setBottles(bottlesData || [])
      }

      if (recipeRes.ok) {
        const recipeData = await recipeRes.json()
        if (recipeData.ingredients && recipeData.ingredients.length > 0) {
          setIngredients(recipeData.ingredients.map((ing: any) => ({
            id: ing.id,
            bottleProductId: ing.bottleProductId,
            bottleProductName: ing.bottleProduct?.name,
            spiritCategory: ing.bottleProduct?.spiritCategory?.name,
            tier: ing.bottleProduct?.tier,
            pourCount: ing.pourCount,
            pourCost: ing.bottleProduct?.pourCost || 0,
            isSubstitutable: ing.isSubstitutable,
            sortOrder: ing.sortOrder,
          })))
        }
      }
    } catch (error) {
      console.error('Failed to load recipe data:', error)
    } finally {
      setLoading(false)
    }
  }

  const addIngredient = () => {
    setIngredients([
      ...ingredients,
      {
        bottleProductId: '',
        pourCount: 1,
        isSubstitutable: true,
        sortOrder: ingredients.length,
      },
    ])
  }

  const updateIngredient = (index: number, field: string, value: any) => {
    const updated = [...ingredients]
    updated[index] = { ...updated[index], [field]: value }

    // Update calculated fields when bottle changes
    if (field === 'bottleProductId') {
      const bottle = bottles.find((b) => b.id === value)
      if (bottle) {
        updated[index].bottleProductName = bottle.name
        updated[index].spiritCategory = bottle.spiritCategory.name
        updated[index].tier = bottle.tier
        updated[index].pourCost = bottle.pourCost || 0
      }
    }

    setIngredients(updated)
  }

  const removeIngredient = (index: number) => {
    setIngredients(ingredients.filter((_, i) => i !== index))
  }

  const saveRecipe = async () => {
    setSaving(true)
    try {
      const payload = ingredients
        .filter((ing) => ing.bottleProductId)
        .map((ing, index) => ({
          bottleProductId: ing.bottleProductId,
          pourCount: ing.pourCount,
          isSubstitutable: ing.isSubstitutable,
          sortOrder: index,
        }))

      const res = await fetch(`/api/menu/items/${menuItemId}/recipe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients: payload }),
      })

      if (res.ok) {
        await loadData() // Reload to get updated IDs and cost calc
      } else {
        const error = await res.json()
        alert(`Failed to save recipe: ${error.error}`)
      }
    } catch (error) {
      console.error('Failed to save recipe:', error)
      alert('Failed to save recipe')
    } finally {
      setSaving(false)
    }
  }

  // Calculate totals
  const totalPourCost = ingredients.reduce((sum, ing) => {
    const cost = (ing.pourCost || 0) * ing.pourCount
    return sum + cost
  }, 0)

  const profitMargin = menuItemPrice > 0 ? ((menuItemPrice - totalPourCost) / menuItemPrice) * 100 : 0
  const grossProfit = menuItemPrice - totalPourCost

  // Group bottles by category for easier selection
  const bottlesByCategory = bottles.reduce((acc, bottle) => {
    const cat = bottle.spiritCategory.name
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(bottle)
    return acc
  }, {} as Record<string, BottleProduct[]>)

  return (
    <div className="border-b">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 bg-amber-50 flex items-center justify-between hover:bg-amber-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={`text-amber-600 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
          <span className="font-semibold text-amber-900">🥃 Recipe</span>
          <span className="text-sm text-amber-600">({ingredients.length} ingredients)</span>
          {ingredients.length > 0 && (
            <span className={`text-xs px-2 py-0.5 rounded ${
              profitMargin >= 70 ? 'bg-green-100 text-green-700' :
              profitMargin >= 50 ? 'bg-yellow-100 text-yellow-700' :
              'bg-red-100 text-red-700'
            }`}>
              {profitMargin.toFixed(0)}% margin
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-amber-600 text-xs"
          onClick={(e) => { e.stopPropagation(); addIngredient(); onToggle() }}
        >
          + Add Ingredient
        </Button>
      </button>

      {isExpanded && (
        <div className="p-4 space-y-3">
          {loading ? (
            <p className="text-center text-gray-400 text-sm py-4">Loading recipe...</p>
          ) : (
            <>
              {ingredients.length === 0 ? (
                <div className="text-center py-6 bg-amber-50/50 rounded border border-amber-200">
                  <p className="text-gray-500 text-sm mb-2">No recipe ingredients</p>
                  <Button size="sm" variant="outline" onClick={addIngredient}>
                    Add First Ingredient
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {ingredients.map((ing, index) => {
                    const ingredientCost = (ing.pourCost || 0) * ing.pourCount
                    return (
                      <div key={index} className="border rounded-lg p-3 bg-white">
                        <div className="grid grid-cols-12 gap-2 items-start">
                          {/* Spirit Selection */}
                          <div className="col-span-6">
                            <label className="block text-xs text-gray-500 mb-1">Spirit/Liqueur</label>
                            <select
                              value={ing.bottleProductId}
                              onChange={(e) => updateIngredient(index, 'bottleProductId', e.target.value)}
                              className="w-full border rounded px-2 py-1.5 text-sm"
                            >
                              <option value="">Select...</option>
                              {Object.entries(bottlesByCategory).map(([category, catBottles]) => (
                                <optgroup key={category} label={category}>
                                  {catBottles.map((b) => (
                                    <option key={b.id} value={b.id}>
                                      {b.name} ({b.tier}) - {formatCurrency(b.pourCost || 0)}/pour
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          </div>

                          {/* Pour Count */}
                          <div className="col-span-2">
                            <label className="block text-xs text-gray-500 mb-1">Pours</label>
                            <input
                              type="number"
                              step="0.5"
                              min="0.5"
                              value={ing.pourCount}
                              onChange={(e) => updateIngredient(index, 'pourCount', parseFloat(e.target.value) || 1)}
                              className="w-full border rounded px-2 py-1.5 text-center text-sm"
                            />
                          </div>

                          {/* Cost */}
                          <div className="col-span-2">
                            <label className="block text-xs text-gray-500 mb-1">Cost</label>
                            <div className="py-1.5 font-medium text-sm text-center text-red-600">
                              {formatCurrency(ingredientCost)}
                            </div>
                          </div>

                          {/* Substitutable */}
                          <div className="col-span-1">
                            <label className="block text-xs text-gray-500 mb-1">Swap</label>
                            <input
                              type="checkbox"
                              checked={ing.isSubstitutable}
                              onChange={(e) => updateIngredient(index, 'isSubstitutable', e.target.checked)}
                              className="w-4 h-4 mt-1"
                            />
                          </div>

                          {/* Remove */}
                          <div className="col-span-1 pt-5">
                            <button
                              onClick={() => removeIngredient(index)}
                              className="text-red-500 hover:text-red-700 text-lg"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Cost Summary */}
              {ingredients.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="grid grid-cols-4 gap-3 text-center text-sm">
                    <div>
                      <div className="text-xs text-blue-700 mb-1">Sell Price</div>
                      <div className="font-bold">{formatCurrency(menuItemPrice)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-blue-700 mb-1">Pour Cost</div>
                      <div className="font-bold text-red-600">{formatCurrency(totalPourCost)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-blue-700 mb-1">Profit</div>
                      <div className="font-bold text-green-600">{formatCurrency(grossProfit)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-blue-700 mb-1">Margin</div>
                      <div className={`font-bold ${
                        profitMargin >= 70 ? 'text-green-600' :
                        profitMargin >= 50 ? 'text-yellow-600' :
                        'text-red-600'
                      }`}>
                        {profitMargin.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Save Button */}
              <div className="flex justify-end pt-2">
                <Button onClick={saveRecipe} disabled={saving} size="sm">
                  {saving ? 'Saving...' : 'Save Recipe'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
