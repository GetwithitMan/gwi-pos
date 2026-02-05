'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'

interface Ingredient {
  id: string
  ingredientId: string
  name: string
  isIncluded: boolean
  allowNo: boolean
  allowLite: boolean
  allowExtra: boolean
  allowOnSide: boolean
  allowSwap: boolean
  extraPrice: number
}

interface IngredientLibraryItem {
  id: string
  name: string
  category: string | null
}

interface Modifier {
  id: string
  name: string
  price: number
  childModifierGroupId?: string | null
}

interface ModifierGroup {
  id: string
  name: string
  displayName?: string
  minSelections: number
  maxSelections: number
  isRequired: boolean
  modifiers: Modifier[]
}

interface MenuItem {
  id: string
  name: string
  price: number
  description?: string
  categoryId: string
  categoryType?: string
  isActive: boolean
  isAvailable: boolean
}

interface ItemEditorProps {
  item: MenuItem | null
  ingredientsLibrary: IngredientLibraryItem[]
  onItemUpdated: () => void
  onToggle86?: (item: MenuItem) => void
  onDelete?: (itemId: string) => void
}

export function ItemEditor({ item, ingredientsLibrary, onItemUpdated, onToggle86, onDelete }: ItemEditorProps) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Collapse states
  const [ingredientsExpanded, setIngredientsExpanded] = useState(false)

  // Forms
  const [showIngredientPicker, setShowIngredientPicker] = useState(false)
  const [ingredientSearch, setIngredientSearch] = useState('')

  // Load data when item changes
  useEffect(() => {
    if (!item?.id) {
      setIngredients([])
      setModifierGroups([])
      return
    }
    loadData()
  }, [item?.id])

  const loadData = async () => {
    if (!item?.id) return
    setLoading(true)
    try {
      const [ingRes, groupsRes] = await Promise.all([
        fetch(`/api/menu/items/${item.id}/ingredients`),
        fetch(`/api/menu/items/${item.id}/modifier-groups`),
      ])
      const [ingData, groupsData] = await Promise.all([ingRes.json(), groupsRes.json()])
      setIngredients(ingData.data || [])
      setModifierGroups(groupsData.data || [])
    } catch (e) {
      console.error('Failed to load data:', e)
    } finally {
      setLoading(false)
    }
  }

  // Ingredient functions
  const saveIngredients = async (newIngredients: typeof ingredients) => {
    if (!item?.id) return
    setSaving(true)
    try {
      await fetch(`/api/menu/items/${item.id}/ingredients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredients: newIngredients.map(i => ({
            ingredientId: i.ingredientId,
            isIncluded: i.isIncluded,
            allowNo: i.allowNo,
            allowLite: i.allowLite,
            allowExtra: i.allowExtra,
            allowOnSide: i.allowOnSide,
            allowSwap: i.allowSwap,
            extraPrice: i.extraPrice,
          }))
        }),
      })
      await loadData()
      onItemUpdated()
    } catch (e) {
      console.error('Failed to save:', e)
    } finally {
      setSaving(false)
    }
  }

  const addIngredient = (ingredientId: string) => {
    const lib = ingredientsLibrary.find(i => i.id === ingredientId)
    if (!lib) return
    const newIngredients = [...ingredients, {
      id: '', ingredientId, name: lib.name, isIncluded: true,
      allowNo: true, allowLite: true, allowExtra: true, allowOnSide: true, allowSwap: true, extraPrice: 0,
    }]
    saveIngredients(newIngredients)
    setShowIngredientPicker(false)
    setIngredientSearch('')
  }

  const removeIngredient = (ingredientId: string) => {
    saveIngredients(ingredients.filter(i => i.ingredientId !== ingredientId))
  }

  const toggleIngredientOption = (ingredientId: string, option: 'allowNo' | 'allowLite' | 'allowExtra' | 'allowOnSide' | 'allowSwap') => {
    saveIngredients(ingredients.map(i => i.ingredientId === ingredientId ? { ...i, [option]: !i[option] } : i))
  }

  const updateExtraPrice = (ingredientId: string, price: number) => {
    saveIngredients(ingredients.map(i => i.ingredientId === ingredientId ? { ...i, extraPrice: price } : i))
  }

  const filteredLibrary = ingredientsLibrary.filter(lib =>
    !ingredients.find(i => i.ingredientId === lib.id) &&
    lib.name.toLowerCase().includes(ingredientSearch.toLowerCase())
  )

  if (!item) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 p-4 bg-gray-50">
        <p className="text-sm">Select an item to edit</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Item Header */}
      <div className="p-4 border-b bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{item.name}</h2>
            <p className="text-2xl font-bold mt-1">{formatCurrency(item.price)}</p>
          </div>
          <div className="flex gap-2">
            {onToggle86 && (
              <button
                onClick={() => onToggle86(item)}
                className={`px-3 py-1.5 rounded text-sm font-medium ${
                  !item.isAvailable ? 'bg-white text-blue-600' : 'bg-white/20 hover:bg-white/30'
                }`}
              >
                {!item.isAvailable ? 'Restore' : '86 It'}
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(item.id)}
                className="px-3 py-1.5 rounded text-sm bg-red-500/80 hover:bg-red-500"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : (
          <>
            {/* INGREDIENTS SECTION - Collapsible */}
            <div className="border-b">
              <button
                onClick={() => setIngredientsExpanded(!ingredientsExpanded)}
                className="w-full px-4 py-3 bg-green-50 flex items-center justify-between hover:bg-green-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className={`text-green-600 transition-transform ${ingredientsExpanded ? 'rotate-90' : ''}`}>▶</span>
                  <span className="font-semibold text-green-900">🥗 Ingredients</span>
                  <span className="text-sm text-green-600">({ingredients.length})</span>
                  {(() => {
                    const customizableCount = ingredients.filter(i => i.allowNo || i.allowLite || i.allowExtra || i.allowOnSide || i.allowSwap).length
                    return customizableCount > 0 ? (
                      <span className="text-xs text-green-500">· {customizableCount} customizable</span>
                    ) : null
                  })()}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-green-600 text-xs"
                  onClick={(e) => { e.stopPropagation(); setShowIngredientPicker(!showIngredientPicker); setIngredientsExpanded(true) }}
                >
                  + Add
                </Button>
              </button>

              {ingredientsExpanded && (
                <div className="p-3 space-y-2">
                  {/* Ingredient Picker */}
                  {showIngredientPicker && (
                    <div className="p-2 border rounded bg-green-50/50 mb-2">
                      <input
                        type="text"
                        value={ingredientSearch}
                        onChange={(e) => setIngredientSearch(e.target.value)}
                        placeholder="Search ingredients..."
                        className="w-full px-2 py-1 text-sm border rounded mb-2"
                        autoFocus
                      />
                      <div className="max-h-48 overflow-y-auto space-y-2">
                        {(() => {
                          const limited = filteredLibrary.slice(0, 12)
                          const grouped = limited.reduce((acc, lib) => {
                            const cat = lib.category || 'Other'
                            if (!acc[cat]) acc[cat] = []
                            acc[cat].push(lib)
                            return acc
                          }, {} as Record<string, typeof limited>)
                          return Object.entries(grouped).map(([category, items]) => (
                            <div key={category}>
                              <div className="text-xs font-semibold text-green-700 px-2 py-1">{category}</div>
                              {items.map(lib => (
                                <button
                                  key={lib.id}
                                  onClick={() => addIngredient(lib.id)}
                                  className="w-full text-left px-2 py-1 text-sm hover:bg-green-100 rounded"
                                >
                                  {lib.name}
                                </button>
                              ))}
                            </div>
                          ))
                        })()}
                      </div>
                    </div>
                  )}

                  {ingredients.length === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-2">No ingredients</p>
                  ) : (
                    ingredients.map(ing => (
                      <div key={ing.ingredientId} className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded border">
                        <span className="flex-1 text-sm truncate">{ing.name}</span>
                        <div className="flex gap-0.5 items-center">
                          <button
                            onClick={() => toggleIngredientOption(ing.ingredientId, 'allowNo')}
                            className={`w-5 h-5 rounded text-[9px] font-bold ${ing.allowNo ? 'bg-red-500 text-white' : 'bg-red-100 text-red-400'}`}
                          >
                            N
                          </button>
                          <button
                            onClick={() => toggleIngredientOption(ing.ingredientId, 'allowLite')}
                            className={`w-5 h-5 rounded text-[9px] font-bold ${ing.allowLite ? 'bg-yellow-500 text-white' : 'bg-yellow-100 text-yellow-400'}`}
                          >
                            L
                          </button>
                          <button
                            onClick={() => toggleIngredientOption(ing.ingredientId, 'allowOnSide')}
                            className={`w-5 h-5 rounded text-[9px] font-bold ${ing.allowOnSide ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-400'}`}
                          >
                            S
                          </button>
                          <button
                            onClick={() => toggleIngredientOption(ing.ingredientId, 'allowExtra')}
                            className={`w-5 h-5 rounded text-[9px] font-bold ${ing.allowExtra ? 'bg-green-500 text-white' : 'bg-green-100 text-green-400'}`}
                          >
                            E
                          </button>
                          {ing.allowExtra && (
                            <input
                              type="number"
                              value={ing.extraPrice || ''}
                              onChange={(e) => updateExtraPrice(ing.ingredientId, parseFloat(e.target.value) || 0)}
                              placeholder="$"
                              className="w-12 px-1 text-xs border rounded"
                              step="0.01"
                              min="0"
                            />
                          )}
                          <button
                            onClick={() => toggleIngredientOption(ing.ingredientId, 'allowSwap')}
                            className={`w-5 h-5 rounded text-[9px] font-bold ${ing.allowSwap ? 'bg-purple-500 text-white' : 'bg-purple-100 text-purple-400'}`}
                          >
                            Sw
                          </button>
                        </div>
                        <button onClick={() => removeIngredient(ing.ingredientId)} className="text-red-400 hover:text-red-600">×</button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* ASSIGNED MODIFIER GROUPS - Summary View */}
            <div className="border-b">
              <div className="px-4 py-3 bg-indigo-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-indigo-900">⚙️ Modifier Groups</span>
                  <span className="text-sm text-indigo-600">({modifierGroups.length})</span>
                </div>
                <span className="text-xs text-indigo-500">Edit in right panel →</span>
              </div>

              <div className="p-3">
                {modifierGroups.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-2">
                    No modifier groups assigned.<br />
                    <span className="text-xs">Use the right panel to add groups.</span>
                  </p>
                ) : (
                  <div className="space-y-1">
                    {modifierGroups.map(group => {
                      const childGroupCount = group.modifiers.filter(m => m.childModifierGroupId).length
                      return (
                        <div
                          key={group.id}
                          className={`flex items-center gap-2 px-3 py-2 bg-gray-50 rounded border ${group.isRequired ? 'border-l-4 border-l-red-500' : ''}`}
                        >
                          <span className="flex-1 font-medium text-sm">{group.name}</span>
                          <span className="text-xs text-gray-500">
                            {group.minSelections}-{group.maxSelections}
                          </span>
                          {group.isRequired && (
                            <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Req</span>
                          )}
                          <span className="text-xs text-gray-400">{group.modifiers.length} options</span>
                          {childGroupCount > 0 && (
                            <span className="text-xs text-indigo-500">• {childGroupCount} sub-groups</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
