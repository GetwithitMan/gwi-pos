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
  containerType?: string | null
  bottleSizeOz?: number | null
  pourSizeOz?: number | null
}

interface FoodIngredient {
  id: string
  name: string
  parentName?: string | null  // Parent ingredient name (e.g., "Fresh Limes" for "Lime Wedge")
  categoryRelation?: {
    id: string
    name: string
    icon?: string | null
    color?: string | null
  } | null
  standardQuantity?: number | null
  standardUnit?: string | null
  purchaseCost?: number | null
  unitsPerPurchase?: number | null
  inventoryItemId?: string | null
  inventoryItem?: {
    id: string
    costPerUnit: number
    storageUnit: string
  } | null
}

interface FoodCategoryGroup {
  category: {
    id: string
    code: number
    name: string
    icon?: string | null
    color?: string | null
  } | null
  ingredients: FoodIngredient[]
}

interface RecipeIngredient {
  id?: string
  type: 'spirit' | 'food'
  // Spirit fields
  bottleProductId?: string
  bottleProductName?: string
  spiritCategory?: string
  tier?: string
  pourCount: number
  pourCost?: number
  isSubstitutable: boolean
  containerType?: string | null
  pourSizeOz?: number | null
  // Food fields
  ingredientId?: string
  ingredientName?: string
  ingredientCategoryName?: string
  ingredientCategoryIcon?: string | null
  quantity?: number
  unit?: string
  unitCost?: number
  // Common
  sortOrder: number
}

const FOOD_UNITS = ['each', 'oz', 'slice', 'wedge', 'sprig', 'dash', 'splash', 'tbsp', 'tsp', 'cup']

interface RecipeBuilderProps {
  menuItemId: string
  menuItemPrice: number
  locationId: string
  isExpanded: boolean
  onToggle: () => void
}

export function RecipeBuilder({ menuItemId, menuItemPrice, locationId, isExpanded, onToggle }: RecipeBuilderProps) {
  const [bottles, setBottles] = useState<BottleProduct[]>([])
  const [foodCategories, setFoodCategories] = useState<FoodCategoryGroup[]>([])
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [pickerTab, setPickerTab] = useState<'spirits' | 'food'>('spirits')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (isExpanded) {
      loadData()
    }
  }, [isExpanded, menuItemId])

  const loadData = async () => {
    setLoading(true)
    try {
      const [bottlesRes, recipeRes, foodRes] = await Promise.all([
        fetch('/api/liquor/bottles'),
        fetch(`/api/menu/items/${menuItemId}/recipe`),
        fetch(`/api/ingredients?locationId=${locationId}&groupByCategory=true&hierarchy=true`),
      ])

      if (bottlesRes.ok) {
        const bottlesRaw = await bottlesRes.json()
        const bottlesData = bottlesRaw.data ?? bottlesRaw
        setBottles(bottlesData || [])
      }

      if (foodRes.ok) {
        const foodRaw = await foodRes.json()
        const foodData = foodRaw.data ?? foodRaw
        if (Array.isArray(foodData)) {
          // Extract prep/child items from hierarchy — these are the portions used in recipes
          // (e.g., "Lime Wedge" → child "Sliced Lime Wedge" is the actual prep)
          // Also include base items that have no children (standalone items)
          // Cost derivation for children: parent cost ÷ parent yield × child output
          const extractedGroups: FoodCategoryGroup[] = foodData.map((group: any) => {
            const prepItems: FoodIngredient[] = []
            for (const ing of group.ingredients || []) {
              const children = ing.childIngredients || []
              // Calculate parent cost per unit
              const parentCostPerUnit = ing.purchaseCost && ing.unitsPerPurchase
                ? Number(ing.purchaseCost) / Number(ing.unitsPerPurchase)
                : 0

              if (children.length > 0) {
                // Has prep items — add only the children
                for (const child of children) {
                  // Child cost: if child takes 1 parent unit and yields 6 slices,
                  // each slice costs parentCostPerUnit / outputQuantity
                  const outputQty = child.outputQuantity ? Number(child.outputQuantity) : 1
                  const inputQty = child.inputQuantity ? Number(child.inputQuantity) : 1
                  const childCostPerUnit = parentCostPerUnit > 0
                    ? (parentCostPerUnit * inputQty) / outputQty
                    : 0

                  prepItems.push({
                    id: child.id,
                    name: child.name,
                    parentName: ing.name,
                    categoryRelation: ing.categoryRelation,
                    standardQuantity: 1, // Default to 1 for recipe use
                    standardUnit: child.outputUnit || child.standardUnit || 'each',
                    // Store derived cost as purchaseCost=childCostPerUnit, unitsPerPurchase=1
                    purchaseCost: childCostPerUnit,
                    unitsPerPurchase: 1,
                    inventoryItemId: ing.inventoryItemId,
                    inventoryItem: ing.inventoryItem,
                  })
                }
              } else {
                // No children — include the base item itself (standalone ingredient)
                prepItems.push({
                  id: ing.id,
                  name: ing.name,
                  categoryRelation: ing.categoryRelation,
                  standardQuantity: 1, // Default to 1 for recipe use
                  standardUnit: ing.standardUnit || 'each',
                  purchaseCost: ing.purchaseCost,
                  unitsPerPurchase: ing.unitsPerPurchase,
                  inventoryItemId: ing.inventoryItemId,
                  inventoryItem: ing.inventoryItem,
                })
              }
            }
            return { category: group.category, ingredients: prepItems }
          }).filter((g: FoodCategoryGroup) => g.ingredients.length > 0)
          setFoodCategories(extractedGroups)
        } else {
          setFoodCategories([])
        }
      }

      if (recipeRes.ok) {
        const recipeRaw = await recipeRes.json()
        const recipeData = recipeRaw.data ?? recipeRaw
        if (recipeData.ingredients && recipeData.ingredients.length > 0) {
          setIngredients(recipeData.ingredients.map((ing: any) => {
            if (ing.bottleProductId && ing.bottleProduct) {
              return {
                id: ing.id,
                type: 'spirit' as const,
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
              }
            }
            // Food ingredient
            const unitCost = ing.ingredient?.inventoryItem?.costPerUnit
              ? Number(ing.ingredient.inventoryItem.costPerUnit)
              : ing.ingredient?.purchaseCost && ing.ingredient?.unitsPerPurchase
                ? Number(ing.ingredient.purchaseCost) / Number(ing.ingredient.unitsPerPurchase)
                : 0
            return {
              id: ing.id,
              type: 'food' as const,
              ingredientId: ing.ingredientId,
              ingredientName: ing.ingredient?.name,
              ingredientCategoryName: ing.ingredient?.categoryRelation?.name,
              ingredientCategoryIcon: ing.ingredient?.categoryRelation?.icon,
              quantity: ing.quantity || 1,
              unit: ing.unit || ing.ingredient?.standardUnit || 'each',
              unitCost,
              pourCount: 1,
              isSubstitutable: false,
              sortOrder: ing.sortOrder,
            }
          }))
        }
      }
    } catch (error) {
      console.error('Failed to load recipe data:', error)
    } finally {
      setLoading(false)
    }
  }

  const updateIngredient = (index: number, field: string, value: any) => {
    const updated = [...ingredients]
    updated[index] = { ...updated[index], [field]: value }

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
        .filter((ing) => ing.bottleProductId || ing.ingredientId)
        .map((ing, index) => {
          if (ing.type === 'spirit') {
            return {
              bottleProductId: ing.bottleProductId,
              pourCount: ing.pourCount,
              isSubstitutable: ing.isSubstitutable,
              sortOrder: index,
            }
          }
          return {
            ingredientId: ing.ingredientId,
            quantity: ing.quantity || 1,
            unit: ing.unit || 'each',
            pourCount: 1,
            isSubstitutable: false,
            sortOrder: index,
          }
        })

      const res = await fetch(`/api/menu/items/${menuItemId}/recipe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients: payload }),
      })

      if (res.ok) {
        await loadData()
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
  const totalRecipeCost = ingredients.reduce((sum, ing) => {
    if (ing.type === 'spirit') {
      return sum + (ing.pourCost || 0) * ing.pourCount
    }
    return sum + (ing.unitCost || 0) * (ing.quantity || 0)
  }, 0)

  const profitMargin = menuItemPrice > 0 ? ((menuItemPrice - totalRecipeCost) / menuItemPrice) * 100 : 0
  const grossProfit = menuItemPrice - totalRecipeCost

  // Group bottles by category
  const bottlesByCategory = bottles.reduce((acc, bottle) => {
    const cat = bottle.spiritCategory.name
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(bottle)
    return acc
  }, {} as Record<string, BottleProduct[]>)

  // IDs of items already in the recipe
  const addedBottleIds = new Set(ingredients.filter(i => i.type === 'spirit').map((ing) => ing.bottleProductId).filter(Boolean))
  const addedFoodIds = new Set(ingredients.filter(i => i.type === 'food').map((ing) => ing.ingredientId).filter(Boolean))

  // Filter bottles by search
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

  // Filter food items by search
  const filteredFoodCategories = foodCategories
    .map((group) => {
      if (!searchQuery.trim()) return group
      const q = searchQuery.toLowerCase()
      const filtered = group.ingredients.filter((i) => i.name.toLowerCase().includes(q))
      if (filtered.length === 0) return null
      return { ...group, ingredients: filtered }
    })
    .filter(Boolean) as FoodCategoryGroup[]

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }))
  }

  const addBottleFromPicker = (bottle: BottleProduct) => {
    if (addedBottleIds.has(bottle.id)) return
    setIngredients([
      ...ingredients,
      {
        type: 'spirit',
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
    setShowPicker(false)
    setSearchQuery('')
  }

  const addFoodFromPicker = (food: FoodIngredient, categoryName?: string, categoryIcon?: string | null) => {
    if (addedFoodIds.has(food.id)) return
    const unitCost = food.inventoryItem?.costPerUnit
      ? Number(food.inventoryItem.costPerUnit)
      : food.purchaseCost && food.unitsPerPurchase
        ? Number(food.purchaseCost) / Number(food.unitsPerPurchase)
        : 0
    setIngredients([
      ...ingredients,
      {
        type: 'food',
        ingredientId: food.id,
        ingredientName: food.name,
        ingredientCategoryName: categoryName,
        ingredientCategoryIcon: categoryIcon,
        quantity: 1,
        unit: food.standardUnit || 'each',
        unitCost,
        pourCount: 1,
        isSubstitutable: false,
        sortOrder: ingredients.length,
      },
    ])
    setShowPicker(false)
    setSearchQuery('')
  }

  const getPortionLabel = (ing: RecipeIngredient) => {
    const ct = ing.containerType
    if (ct === 'can') return ing.pourCount === 1 ? 'can' : 'cans'
    if (ct === 'draft') return ing.pourCount === 1 ? 'pint' : 'pints'
    if (ct === 'glass') return ing.pourCount === 1 ? 'glass' : 'glasses'
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
          <span className="font-semibold text-amber-900">Recipe</span>
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
            setShowPicker((prev) => !prev)
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
                  <Button size="sm" variant="outline" onClick={() => setShowPicker(true)}>
                    Add First Ingredient
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {ingredients.map((ing, index) => {
                    if (ing.type === 'spirit') {
                      const ingredientCost = (ing.pourCost || 0) * ing.pourCount
                      return (
                        <div key={index} className="border rounded-lg p-3 bg-white">
                          <div className="grid grid-cols-12 gap-2 items-start">
                            <div className="col-span-6">
                              <label className="block text-xs text-gray-500 mb-1">Spirit/Liqueur</label>
                              <select
                                value={ing.bottleProductId || ''}
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
                            <div className="col-span-2">
                              <label className="block text-xs text-gray-500 mb-1">Cost</label>
                              <div className="py-1.5 font-medium text-sm text-center text-red-600">
                                {formatCurrency(ingredientCost)}
                              </div>
                            </div>
                            <div className="col-span-1">
                              <label className="block text-xs text-gray-500 mb-1">Swap</label>
                              <input
                                type="checkbox"
                                checked={ing.isSubstitutable}
                                onChange={(e) => updateIngredient(index, 'isSubstitutable', e.target.checked)}
                                className="w-4 h-4 mt-1"
                              />
                            </div>
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
                    }

                    // Food ingredient row
                    const foodCost = (ing.unitCost || 0) * (ing.quantity || 0)
                    return (
                      <div key={index} className="border rounded-lg p-3 bg-green-50/50 border-green-200">
                        <div className="grid grid-cols-12 gap-2 items-start">
                          <div className="col-span-4">
                            <label className="block text-xs text-gray-500 mb-1">Food Item</label>
                            <div className="flex items-center gap-1.5 py-1.5">
                              {ing.ingredientCategoryIcon && (
                                <span className="text-sm">{ing.ingredientCategoryIcon}</span>
                              )}
                              <span className="text-sm font-medium truncate">{ing.ingredientName}</span>
                              {ing.ingredientCategoryName && (
                                <span className="text-xs text-green-600 bg-green-100 px-1.5 py-0.5 rounded shrink-0">
                                  {ing.ingredientCategoryName}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="col-span-2">
                            <label className="block text-xs text-gray-500 mb-1">Qty</label>
                            <input
                              type="number"
                              step="0.5"
                              min="0.5"
                              value={ing.quantity || 1}
                              onChange={(e) => updateIngredient(index, 'quantity', parseFloat(e.target.value) || 1)}
                              className="w-full border rounded px-2 py-1.5 text-center text-sm"
                            />
                          </div>
                          <div className="col-span-2">
                            <label className="block text-xs text-gray-500 mb-1">Unit</label>
                            <select
                              value={ing.unit || 'each'}
                              onChange={(e) => updateIngredient(index, 'unit', e.target.value)}
                              className="w-full border rounded px-2 py-1.5 text-sm"
                            >
                              {FOOD_UNITS.map((u) => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-2">
                            <label className="block text-xs text-gray-500 mb-1">Cost</label>
                            <div className="py-1.5 font-medium text-sm text-center text-red-600">
                              {formatCurrency(foodCost)}
                            </div>
                          </div>
                          <div className="col-span-1"></div>
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

              {/* Ingredient Picker Panel */}
              {showPicker && (
                <div className="border border-amber-300 rounded-lg shadow-lg bg-white overflow-hidden">
                  <div className="bg-amber-50 px-3 py-2 border-b border-amber-200 flex items-center justify-between">
                    <span className="text-sm font-semibold text-amber-900">Add Ingredient</span>
                    <button
                      onClick={() => { setShowPicker(false); setSearchQuery('') }}
                      className="text-amber-600 hover:text-amber-800 text-lg leading-none"
                    >
                      ×
                    </button>
                  </div>

                  {/* Tab Toggle */}
                  <div className="flex border-b">
                    <button
                      onClick={() => { setPickerTab('spirits'); setSearchQuery('') }}
                      className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                        pickerTab === 'spirits'
                          ? 'text-amber-700 border-b-2 border-amber-500 bg-amber-50/50'
                          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      Spirits
                    </button>
                    <button
                      onClick={() => { setPickerTab('food'); setSearchQuery('') }}
                      className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                        pickerTab === 'food'
                          ? 'text-green-700 border-b-2 border-green-500 bg-green-50/50'
                          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      Food Items
                    </button>
                  </div>

                  <div className="p-3">
                    <input
                      type="text"
                      placeholder={pickerTab === 'spirits' ? 'Search bottles...' : 'Search food items...'}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className={`w-full border rounded px-3 py-1.5 text-sm mb-2 focus:outline-none focus:ring-2 ${
                        pickerTab === 'spirits' ? 'focus:ring-amber-300' : 'focus:ring-green-300'
                      }`}
                      autoFocus
                    />
                    <div className="max-h-64 overflow-y-auto space-y-1">
                      {/* Spirits Tab */}
                      {pickerTab === 'spirits' && (
                        <>
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
                                              {alreadyAdded ? 'Added' : `${formatCurrency(bottle.pourCost || 0)}/pour`}
                                            </span>
                                          </button>
                                        )
                                      })}
                                    </div>
                                  )}
                                </div>
                              ))
                          )}
                        </>
                      )}

                      {/* Food Items Tab */}
                      {pickerTab === 'food' && (
                        <>
                          {filteredFoodCategories.length === 0 ? (
                            <p className="text-gray-400 text-sm text-center py-4">No food items found</p>
                          ) : (
                            filteredFoodCategories.map((group) => {
                              const catKey = group.category?.id || 'uncategorized'
                              const catName = group.category?.name || 'Uncategorized'
                              const catIcon = group.category?.icon
                              return (
                                <div key={catKey}>
                                  <button
                                    onClick={() => toggleCategory(`food-${catKey}`)}
                                    className="w-full flex items-center gap-2 px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded"
                                  >
                                    <span className={`text-xs transition-transform ${expandedCategories[`food-${catKey}`] ? 'rotate-90' : ''}`}>
                                      ▶
                                    </span>
                                    {catIcon && <span className="text-sm">{catIcon}</span>}
                                    <span>{catName}</span>
                                    <span className="text-xs text-gray-400">({group.ingredients.length})</span>
                                  </button>
                                  {expandedCategories[`food-${catKey}`] && (
                                    <div className="ml-4 space-y-0.5">
                                      {group.ingredients.map((food) => {
                                        const alreadyAdded = addedFoodIds.has(food.id)
                                        const costPerUnit = food.inventoryItem?.costPerUnit
                                          ? Number(food.inventoryItem.costPerUnit)
                                          : food.purchaseCost && food.unitsPerPurchase
                                            ? Number(food.purchaseCost) / Number(food.unitsPerPurchase)
                                            : null
                                        return (
                                          <button
                                            key={food.id}
                                            onClick={() => addFoodFromPicker(food, catName, catIcon)}
                                            disabled={alreadyAdded}
                                            className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded text-left ${
                                              alreadyAdded
                                                ? 'opacity-40 cursor-not-allowed bg-gray-50'
                                                : 'hover:bg-green-50 cursor-pointer'
                                            }`}
                                          >
                                            <span className="flex-1 truncate">{food.name}</span>
                                            {food.standardUnit && (
                                              <span className="text-xs text-gray-400">{food.standardUnit}</span>
                                            )}
                                            <span className="text-xs text-gray-500 whitespace-nowrap">
                                              {alreadyAdded ? 'Added' : costPerUnit ? `${formatCurrency(costPerUnit)}/ea` : ''}
                                            </span>
                                          </button>
                                        )
                                      })}
                                    </div>
                                  )}
                                </div>
                              )
                            })
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Add more button when ingredients exist and picker is closed */}
              {ingredients.length > 0 && !showPicker && (
                <button
                  onClick={() => setShowPicker(true)}
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
                      <div className="text-xs text-blue-700 mb-1">Recipe Cost</div>
                      <div className="font-bold text-red-600">{formatCurrency(totalRecipeCost)}</div>
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
