'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'

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
  containerType?: string | null  // 'bottle' | 'can' | 'draft' | 'glass'
  bottleSizeOz?: number | null
  pourSizeOz?: number | null
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
  containerType?: string | null
  pourSizeOz?: number | null
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
  const [showBottlePicker, setShowBottlePicker] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({})

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
        const bottlesRaw = await bottlesRes.json()
        const bottlesData = bottlesRaw.data ?? bottlesRaw
        setBottles(bottlesData || [])
      }

      if (recipeRes.ok) {
        const recipeRaw = await recipeRes.json()
        const recipeData = recipeRaw.data ?? recipeRaw
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
            containerType: ing.bottleProduct?.containerType || null,
            pourSizeOz: ing.bottleProduct?.pourSizeOz || null,
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
        updated[index].containerType = bottle.containerType || null
        updated[index].pourSizeOz = bottle.pourSizeOz || null
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
        toast.error(`Failed to save recipe: ${error.error}`)
      }
    } catch (error) {
      console.error('Failed to save recipe:', error)
      toast.error('Failed to save recipe')
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

  // IDs of bottles already in the recipe
  const addedBottleIds = new Set(ingredients.map((ing) => ing.bottleProductId).filter(Boolean))

  // Filter bottles by search query
  const filteredBottlesByCategory = Object.entries(bottlesByCategory).reduce((acc, [cat, catBottles]) => {
    if (!searchQuery.trim()) {
      acc[cat] = catBottles
    } else {
      const q = searchQuery.toLowerCase()
      const filtered = catBottles.filter(
        (b) => b.name.toLowerCase().includes(q) || (b.brand && b.brand.toLowerCase().includes(q))
      )
      if (filtered.length > 0) acc[cat] = filtered
    }
    return acc
  }, {} as Record<string, BottleProduct[]>)

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }))
  }

  const addBottleFromPicker = (bottle: BottleProduct) => {
    if (addedBottleIds.has(bottle.id)) return
    setIngredients([
      ...ingredients,
      {
        bottleProductId: bottle.id,
        bottleProductName: bottle.name,
        spiritCategory: bottle.spiritCategory.name,
        tier: bottle.tier,
        pourCount: 1,
        pourCost: bottle.pourCost || 0,
        isSubstitutable: true,
        sortOrder: ingredients.length,
        containerType: bottle.containerType || null,
        pourSizeOz: bottle.pourSizeOz || null,
      },
    ])
    setShowBottlePicker(false)
    setSearchQuery('')
  }

  const getPortionLabel = (ing: RecipeIngredient) => {
    const ct = ing.containerType
    if (ct === 'can') return ing.pourCount === 1 ? 'can' : 'cans'
    if (ct === 'draft') return ing.pourCount === 1 ? 'pint' : 'pints'
    if (ct === 'glass') return ing.pourCount === 1 ? 'glass' : 'glasses'
    // Default: spirits (bottle or null)
    const ozLabel = ing.pourSizeOz ? ` (${ing.pourSizeOz}oz)` : ''
    return ing.pourCount === 1 ? `pour${ozLabel}` : `pours${ozLabel}`
  }

  const tierColor = (tier: string) => {
    switch (tier?.toLowerCase()) {
      case 'well': return 'bg-gray-100 text-gray-700'
      case 'call': return 'bg-blue-100 text-blue-700'
      case 'premium': return 'bg-amber-100 text-amber-700'
      case 'top shelf': return 'bg-purple-100 text-purple-700'
      default: return 'bg-gray-100 text-gray-600'
    }
  }

  return (
    <div className="border-b">
      <div
        onClick={onToggle}
        className="w-full px-4 py-3 bg-amber-50 flex items-center justify-between hover:bg-amber-100 transition-colors cursor-pointer"
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
          onClick={(e) => {
            e.stopPropagation()
            if (!isExpanded) onToggle()
            setShowBottlePicker((prev) => !prev)
          }}
        >
          + Add Ingredient
        </Button>
      </div>

      {isExpanded && (
        <div className="p-4 space-y-3">
          {loading ? (
            <p className="text-center text-gray-400 text-sm py-4">Loading recipe...</p>
          ) : (
            <>
              {ingredients.length === 0 ? (
                <div className="text-center py-6 bg-amber-50/50 rounded border border-amber-200">
                  <p className="text-gray-500 text-sm mb-2">No recipe ingredients</p>
                  <Button size="sm" variant="outline" onClick={() => setShowBottlePicker(true)}>
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
                            <label className="block text-xs text-gray-500 mb-1 capitalize">{getPortionLabel(ing)}</label>
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

              {/* Bottle Picker Panel */}
              {showBottlePicker && (
                <div className="border border-amber-300 rounded-lg shadow-lg bg-white overflow-hidden">
                  <div className="bg-amber-50 px-3 py-2 border-b border-amber-200 flex items-center justify-between">
                    <span className="text-sm font-semibold text-amber-900">Add Ingredient</span>
                    <button
                      onClick={() => { setShowBottlePicker(false); setSearchQuery('') }}
                      className="text-amber-600 hover:text-amber-800 text-lg leading-none"
                    >
                      ×
                    </button>
                  </div>
                  <div className="p-3">
                    <input
                      type="text"
                      placeholder="Search bottles..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full border rounded px-3 py-1.5 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-amber-300"
                      autoFocus
                    />
                    <div className="max-h-64 overflow-y-auto space-y-1">
                      {Object.keys(filteredBottlesByCategory).length === 0 ? (
                        <p className="text-gray-400 text-sm text-center py-4">No bottles found</p>
                      ) : (
                        Object.entries(filteredBottlesByCategory)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([category, catBottles]) => (
                            <div key={category}>
                              <button
                                onClick={() => toggleCategory(category)}
                                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded"
                              >
                                <span className={`text-xs transition-transform ${expandedCategories[category] ? 'rotate-90' : ''}`}>
                                  ▶
                                </span>
                                <span>{category}</span>
                                <span className="text-xs text-gray-400">({catBottles.length})</span>
                              </button>
                              {expandedCategories[category] && (
                                <div className="ml-4 space-y-0.5">
                                  {catBottles.map((bottle) => {
                                    const alreadyAdded = addedBottleIds.has(bottle.id)
                                    return (
                                      <button
                                        key={bottle.id}
                                        onClick={() => addBottleFromPicker(bottle)}
                                        disabled={alreadyAdded}
                                        className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded text-left ${
                                          alreadyAdded
                                            ? 'opacity-40 cursor-not-allowed bg-gray-50'
                                            : 'hover:bg-amber-50 cursor-pointer'
                                        }`}
                                      >
                                        <span className="flex-1 truncate">{bottle.name}</span>
                                        <span className={`text-xs px-1.5 py-0.5 rounded ${tierColor(bottle.tier)}`}>
                                          {bottle.tier}
                                        </span>
                                        <span className="text-xs text-gray-500 whitespace-nowrap">
                                          {alreadyAdded ? 'Already added' : `${formatCurrency(bottle.pourCost || 0)}/pour`}
                                        </span>
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          ))
                      )}
                    </div>
                    <div className="border-t mt-2 pt-2">
                      <button
                        onClick={() => { addIngredient(); setShowBottlePicker(false); setSearchQuery('') }}
                        className="text-xs text-gray-500 hover:text-gray-700 underline"
                      >
                        Manual entry
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Add more button when ingredients exist and picker is closed */}
              {ingredients.length > 0 && !showBottlePicker && (
                <button
                  onClick={() => setShowBottlePicker(true)}
                  className="w-full py-2 border border-dashed border-amber-300 rounded-lg text-sm text-amber-600 hover:bg-amber-50 transition-colors"
                >
                  + Add Ingredient
                </button>
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
