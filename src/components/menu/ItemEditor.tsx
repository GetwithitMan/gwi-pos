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
  allowNo?: boolean
  allowLite?: boolean
  allowOnSide?: boolean
  allowExtra?: boolean
  extraPrice?: number
  isDefault?: boolean
  sortOrder: number
  ingredientId?: string | null
  ingredientName?: string | null
  childModifierGroupId?: string | null
  childModifierGroup?: ModifierGroup | null
}

interface ModifierGroup {
  id: string
  name: string
  displayName?: string
  minSelections: number
  maxSelections: number
  isRequired: boolean
  allowStacking?: boolean
  tieredPricingConfig?: any
  exclusionGroupKey?: string | null
  sortOrder: number
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
  refreshKey?: number
  onSelectGroup?: (groupId: string | null) => void
}

export function ItemEditor({ item, ingredientsLibrary, onItemUpdated, onToggle86, onDelete, refreshKey, onSelectGroup }: ItemEditorProps) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Collapse states
  const [ingredientsExpanded, setIngredientsExpanded] = useState(false)

  // Forms
  const [showIngredientPicker, setShowIngredientPicker] = useState(false)
  const [ingredientSearch, setIngredientSearch] = useState('')

  // Modifier group editing state
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [showNewGroupForm, setShowNewGroupForm] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [addingModifierTo, setAddingModifierTo] = useState<string | null>(null)
  const [newModName, setNewModName] = useState('')
  const [newModPrice, setNewModPrice] = useState('')
  const [linkingModifier, setLinkingModifier] = useState<{ groupId: string; modId: string } | null>(null)
  const [modIngredientSearch, setModIngredientSearch] = useState('')

  // Load data when item changes or refreshKey updates
  useEffect(() => {
    if (!item?.id) {
      setIngredients([])
      setModifierGroups([])
      return
    }
    loadData()
  }, [item?.id, refreshKey])

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

  // Modifier group CRUD functions
  const createGroup = async () => {
    if (!item?.id || !newGroupName.trim()) return
    setSaving(true)
    try {
      await fetch(`/api/menu/items/${item.id}/modifier-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName.trim(), minSelections: 0, maxSelections: 1 }),
      })
      setNewGroupName('')
      setShowNewGroupForm(false)
      await loadData()
      onItemUpdated()
    } catch (e) {
      console.error('Failed to create group:', e)
    } finally {
      setSaving(false)
    }
  }

  const updateGroup = async (groupId: string, updates: Partial<ModifierGroup>) => {
    if (!item?.id) return
    setSaving(true)
    try {
      await fetch(`/api/menu/items/${item.id}/modifier-groups/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      await loadData()
      onItemUpdated()
    } catch (e) {
      console.error('Failed to update group:', e)
    } finally {
      setSaving(false)
    }
  }

  const deleteGroup = async (groupId: string) => {
    if (!item?.id || !confirm('Delete this modifier group?')) return
    setSaving(true)
    try {
      await fetch(`/api/menu/items/${item.id}/modifier-groups/${groupId}`, { method: 'DELETE' })
      await loadData()
      onItemUpdated()
    } catch (e) {
      console.error('Failed to delete group:', e)
    } finally {
      setSaving(false)
    }
  }

  const addModifier = async (groupId: string) => {
    if (!item?.id || !newModName.trim()) return
    setSaving(true)
    try {
      await fetch(`/api/menu/items/${item.id}/modifier-groups/${groupId}/modifiers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newModName.trim(), price: parseFloat(newModPrice) || 0 }),
      })
      setNewModName('')
      setNewModPrice('')
      setAddingModifierTo(null)
      await loadData()
      onItemUpdated()
    } catch (e) {
      console.error('Failed to add modifier:', e)
    } finally {
      setSaving(false)
    }
  }

  const updateModifier = async (groupId: string, modifierId: string, updates: Partial<Modifier>) => {
    if (!item?.id) return
    setSaving(true)
    try {
      await fetch(`/api/menu/items/${item.id}/modifier-groups/${groupId}/modifiers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modifierId, ...updates }),
      })
      await loadData()
      onItemUpdated()
    } catch (e) {
      console.error('Failed to update modifier:', e)
    } finally {
      setSaving(false)
    }
  }

  const deleteModifier = async (groupId: string, modifierId: string) => {
    if (!item?.id) return
    setSaving(true)
    try {
      await fetch(`/api/menu/items/${item.id}/modifier-groups/${groupId}/modifiers`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modifierId }),
      })
      await loadData()
      onItemUpdated()
    } catch (e) {
      console.error('Failed to delete modifier:', e)
    } finally {
      setSaving(false)
    }
  }

  const createChildGroup = async (parentModifierId: string) => {
    if (!item?.id) return
    setSaving(true)
    try {
      const res = await fetch(`/api/menu/items/${item.id}/modifier-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Sub-Group',
          minSelections: 0,
          maxSelections: 1,
          parentModifierId
        }),
      })
      await loadData()
      onItemUpdated()
    } catch (e) {
      console.error('Failed to create child group:', e)
    } finally {
      setSaving(false)
    }
  }

  const linkIngredient = async (groupId: string, modifierId: string, ingredientId: string | null) => {
    await updateModifier(groupId, modifierId, { ingredientId })
    setLinkingModifier(null)
    setModIngredientSearch('')
  }

  // Helper to render a modifier row with all controls
  const renderModifierRow = (groupId: string, mod: Modifier, depth: number = 0) => {
    const isLinking = linkingModifier?.groupId === groupId && linkingModifier?.modId === mod.id
    const filteredIngredients = ingredientsLibrary.filter(ing =>
      ing.name.toLowerCase().includes(modIngredientSearch.toLowerCase())
    )

    return (
      <div key={mod.id} className="space-y-1">
        <div className="flex items-center gap-2 px-2 py-1.5 bg-white border rounded text-sm">
          <span className="flex-1 truncate">{mod.name}</span>

          {/* Ingredient Link Badge */}
          {mod.ingredientId && mod.ingredientName && (
            <span className="text-[9px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded flex items-center gap-1">
              🔗 {mod.ingredientName}
              <button
                onClick={() => linkIngredient(groupId, mod.id, null)}
                className="hover:text-purple-900"
              >
                ×
              </button>
            </span>
          )}

          {/* Link Ingredient Button */}
          <button
            onClick={() => setLinkingModifier(isLinking ? null : { groupId, modId: mod.id })}
            className={`w-5 h-5 rounded text-xs ${isLinking ? 'bg-purple-500 text-white' : 'bg-purple-100 text-purple-600 hover:bg-purple-200'}`}
            title="Link Ingredient"
          >
            🔗
          </button>

          {/* Pre-modifier toggles */}
          <div className="flex gap-0.5">
            <button
              onClick={() => updateModifier(groupId, mod.id, { allowNo: !mod.allowNo })}
              className={`w-5 h-5 rounded text-[9px] font-bold ${mod.allowNo ? 'bg-red-500 text-white' : 'bg-red-100 text-red-400'}`}
            >
              N
            </button>
            <button
              onClick={() => updateModifier(groupId, mod.id, { allowLite: !mod.allowLite })}
              className={`w-5 h-5 rounded text-[9px] font-bold ${mod.allowLite ? 'bg-yellow-500 text-white' : 'bg-yellow-100 text-yellow-400'}`}
            >
              L
            </button>
            <button
              onClick={() => updateModifier(groupId, mod.id, { allowOnSide: !mod.allowOnSide })}
              className={`w-5 h-5 rounded text-[9px] font-bold ${mod.allowOnSide ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-400'}`}
            >
              S
            </button>
            <button
              onClick={() => updateModifier(groupId, mod.id, { allowExtra: !mod.allowExtra })}
              className={`w-5 h-5 rounded text-[9px] font-bold ${mod.allowExtra ? 'bg-green-500 text-white' : 'bg-green-100 text-green-400'}`}
            >
              E
            </button>
          </div>

          {mod.price > 0 && (
            <span className="text-xs text-green-600">+{formatCurrency(mod.price)}</span>
          )}

          <button
            onClick={() => deleteModifier(groupId, mod.id)}
            className="text-red-400 hover:text-red-600 text-xs"
          >
            ×
          </button>

          {/* Create Child Group Button */}
          {!mod.childModifierGroupId && (
            <button
              onClick={() => createChildGroup(mod.id)}
              className="w-5 h-5 rounded bg-indigo-100 text-indigo-600 hover:bg-indigo-200 text-xs font-bold"
              title="Create Child Group"
            >
              +▶
            </button>
          )}
        </div>

        {/* Ingredient Search Dropdown */}
        {isLinking && (
          <div className="ml-4 p-2 bg-purple-50 border border-purple-200 rounded">
            <input
              type="text"
              value={modIngredientSearch}
              onChange={(e) => setModIngredientSearch(e.target.value)}
              placeholder="Search ingredients..."
              className="w-full px-2 py-1 text-xs border rounded mb-1"
              autoFocus
            />
            <div className="max-h-32 overflow-y-auto space-y-0.5">
              {filteredIngredients.length === 0 ? (
                <div className="text-xs text-gray-400 text-center py-2">
                  {modIngredientSearch ? 'No matches' : 'Type to search'}
                </div>
              ) : (
                filteredIngredients.map(ing => (
                  <button
                    key={ing.id}
                    onClick={() => linkIngredient(groupId, mod.id, ing.id)}
                    className="w-full text-left px-2 py-1 text-xs hover:bg-purple-100 rounded flex justify-between"
                  >
                    <span>{ing.name}</span>
                    {ing.category && <span className="text-gray-400">{ing.category}</span>}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Render Child Group Recursively */}
        {mod.childModifierGroup && renderChildGroup(mod.childModifierGroup, depth + 1)}
      </div>
    )
  }

  // Helper to render child modifier groups recursively
  const renderChildGroup = (childGroup: ModifierGroup, depth: number = 1) => {
    const isExpanded = expandedGroup === childGroup.id
    const isEmpty = childGroup.modifiers.length === 0
    const indentClass = `ml-${depth * 4} pl-3 border-l-2 border-indigo-200`

    return (
      <div key={childGroup.id} className={`mt-2 ${indentClass}`}>
        <div className="text-xs text-gray-500 mb-1">After selecting parent modifier:</div>
        <div className={`border rounded-lg overflow-hidden ${childGroup.isRequired ? 'border-l-4 border-red-400' : ''} ${isEmpty ? 'border-dashed' : ''}`}>
          {/* Child Group Header */}
          <div
            className="px-3 py-2 bg-gray-50 flex items-center gap-2 cursor-pointer"
            onClick={() => setExpandedGroup(isExpanded ? null : childGroup.id)}
          >
            <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''} ${childGroup.isRequired && isEmpty ? 'text-red-500' : isEmpty ? 'text-gray-300' : 'text-green-500'}`}>
              ▶
            </span>
            <span className="flex-1 font-medium text-sm truncate">{childGroup.name}</span>
            <span className="text-xs text-gray-400">{childGroup.modifiers.length}</span>
          </div>

          {/* Child Group Expanded Content */}
          {isExpanded && (
            <div className="border-t">
              {/* Child Group Settings */}
              <div className="p-2 bg-gray-50/50 border-b">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500">Selections:</span>
                  <input
                    type="number"
                    value={childGroup.minSelections}
                    onChange={(e) => updateGroup(childGroup.id, { minSelections: parseInt(e.target.value) || 0 })}
                    className="w-12 px-1 py-0.5 border rounded text-center"
                    min="0"
                  />
                  <span className="text-gray-400">-</span>
                  <input
                    type="number"
                    value={childGroup.maxSelections}
                    onChange={(e) => updateGroup(childGroup.id, { maxSelections: parseInt(e.target.value) || 1 })}
                    className="w-12 px-1 py-0.5 border rounded text-center"
                    min="1"
                  />
                  <label className="flex items-center gap-1 ml-2">
                    <input
                      type="checkbox"
                      checked={childGroup.isRequired}
                      onChange={(e) => updateGroup(childGroup.id, { isRequired: e.target.checked })}
                      className="w-3 h-3"
                    />
                    <span className="text-gray-600">Req</span>
                  </label>
                  <label className="flex items-center gap-1 ml-2">
                    <input
                      type="checkbox"
                      checked={childGroup.allowStacking}
                      onChange={(e) => updateGroup(childGroup.id, { allowStacking: e.target.checked })}
                      className="w-3 h-3"
                    />
                    <span className="text-gray-600">Stack</span>
                  </label>
                  <button
                    onClick={() => deleteGroup(childGroup.id)}
                    className="ml-auto text-red-500 hover:text-red-700 text-xs"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Child Modifiers */}
              <div className="p-2 space-y-1">
                {isEmpty && (
                  <div className="text-center text-gray-400 text-xs py-2 italic">
                    Add modifiers to get started
                  </div>
                )}
                {childGroup.modifiers.map(mod => renderModifierRow(childGroup.id, mod, depth))}

                {/* Add Modifier to Child Group */}
                {addingModifierTo === childGroup.id ? (
                  <div className="flex gap-1 mt-2">
                    <input
                      type="text"
                      value={newModName}
                      onChange={(e) => setNewModName(e.target.value)}
                      placeholder="Name"
                      className="flex-1 px-2 py-1 text-xs border rounded"
                      autoFocus
                    />
                    <input
                      type="number"
                      value={newModPrice}
                      onChange={(e) => setNewModPrice(e.target.value)}
                      placeholder="$"
                      className="w-14 px-2 py-1 text-xs border rounded"
                      step="0.01"
                    />
                    <Button size="sm" variant="primary" onClick={() => addModifier(childGroup.id)} disabled={!newModName.trim()}>
                      +
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setAddingModifierTo(null); setNewModName(''); setNewModPrice('') }}>
                      ×
                    </Button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingModifierTo(childGroup.id)}
                    className="w-full py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded border border-dashed border-indigo-300"
                  >
                    + Add Modifier
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    )
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
                <span
                  role="button"
                  tabIndex={0}
                  className="text-green-600 text-xs font-semibold px-2 py-1 hover:bg-green-100 rounded cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); setShowIngredientPicker(!showIngredientPicker); setIngredientsExpanded(true) }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setShowIngredientPicker(!showIngredientPicker); setIngredientsExpanded(true) } }}
                >
                  + Add
                </span>
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

            {/* MODIFIER GROUPS - Interactive Editor */}
            <div className="border-b">
              <div className="px-4 py-3 bg-indigo-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-indigo-900">⚙️ Modifier Groups</span>
                  <span className="text-sm text-indigo-600">({modifierGroups.length})</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-indigo-600 text-xs"
                  onClick={() => setShowNewGroupForm(true)}
                  disabled={saving}
                >
                  + Add Group
                </Button>
              </div>

              {/* New Group Form */}
              {showNewGroupForm && (
                <div className="p-2 border-b bg-indigo-50/50">
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="Group name"
                    className="w-full px-2 py-1 text-sm border rounded mb-2"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && createGroup()}
                  />
                  <div className="flex gap-1">
                    <Button size="sm" onClick={createGroup} disabled={!newGroupName.trim() || saving}>
                      Create
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setShowNewGroupForm(false); setNewGroupName('') }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Groups List */}
              <div className="p-3 space-y-2">
                {modifierGroups.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-2">No modifier groups</p>
                ) : (
                  modifierGroups.map(group => {
                    const isExpanded = expandedGroup === group.id
                    const isEmpty = group.modifiers.length === 0
                    const childModCount = group.modifiers.filter(m => m.childModifierGroupId).length

                    return (
                      <div key={group.id} className={`border rounded-lg overflow-hidden ${group.isRequired ? 'border-l-4 border-red-400' : ''}`}>
                        {/* Group Header - click to expand */}
                        <div
                          className="px-3 py-2 bg-gray-50 flex items-center gap-2 cursor-pointer"
                          onClick={() => {
                            setExpandedGroup(isExpanded ? null : group.id)
                            onSelectGroup?.(isExpanded ? null : group.id)
                          }}
                        >
                          <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                          <span className="flex-1 font-medium text-sm truncate">{group.name}</span>
                          {childModCount > 0 && <span className="text-[9px] px-1 bg-indigo-100 text-indigo-600 rounded">{childModCount}▶</span>}
                          <span className="text-xs text-gray-400">{group.modifiers.length}</span>
                        </div>

                        {/* Expanded: Settings + Modifiers */}
                        {isExpanded && (
                          <div className="border-t">
                            {/* Settings row: min/max, required, stacking, delete */}
                            <div className="p-2 bg-gray-50/50 border-b">
                              <div className="flex items-center gap-2 text-xs flex-wrap">
                                <span className="text-gray-500">Selections:</span>
                                <input
                                  type="number"
                                  value={group.minSelections}
                                  onChange={(e) => updateGroup(group.id, { minSelections: parseInt(e.target.value) || 0 })}
                                  className="w-12 px-1 py-0.5 border rounded text-center"
                                  min="0"
                                />
                                <span className="text-gray-400">-</span>
                                <input
                                  type="number"
                                  value={group.maxSelections}
                                  onChange={(e) => updateGroup(group.id, { maxSelections: parseInt(e.target.value) || 1 })}
                                  className="w-12 px-1 py-0.5 border rounded text-center"
                                  min="1"
                                />
                                <label className="flex items-center gap-1 ml-2">
                                  <input
                                    type="checkbox"
                                    checked={group.isRequired}
                                    onChange={(e) => updateGroup(group.id, { isRequired: e.target.checked })}
                                    className="w-3 h-3"
                                  />
                                  <span className="text-gray-600">Required</span>
                                </label>
                                <label className="flex items-center gap-1 ml-2">
                                  <input
                                    type="checkbox"
                                    checked={group.allowStacking}
                                    onChange={(e) => updateGroup(group.id, { allowStacking: e.target.checked })}
                                    className="w-3 h-3"
                                  />
                                  <span className="text-gray-600">Stacking</span>
                                </label>
                                <button
                                  onClick={() => deleteGroup(group.id)}
                                  className="ml-auto text-red-500 hover:text-red-700 text-xs px-2 py-1"
                                  disabled={saving}
                                >
                                  Delete Group
                                </button>
                              </div>
                            </div>

                            {/* Modifier rows */}
                            <div className="p-2 space-y-1">
                              {isEmpty && (
                                <div className="text-center text-gray-400 text-xs py-2 italic">
                                  Add modifiers to get started
                                </div>
                              )}
                              {group.modifiers.map(mod => renderModifierRow(group.id, mod))}

                              {/* Add modifier form */}
                              {addingModifierTo === group.id ? (
                                <div className="flex gap-1 mt-2">
                                  <input
                                    type="text"
                                    value={newModName}
                                    onChange={(e) => setNewModName(e.target.value)}
                                    placeholder="Name"
                                    className="flex-1 px-2 py-1 text-xs border rounded"
                                    autoFocus
                                    onKeyDown={(e) => e.key === 'Enter' && addModifier(group.id)}
                                  />
                                  <input
                                    type="number"
                                    value={newModPrice}
                                    onChange={(e) => setNewModPrice(e.target.value)}
                                    placeholder="$"
                                    className="w-14 px-2 py-1 text-xs border rounded"
                                    step="0.01"
                                  />
                                  <Button size="sm" variant="primary" onClick={() => addModifier(group.id)} disabled={!newModName.trim() || saving}>
                                    +
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => { setAddingModifierTo(null); setNewModName(''); setNewModPrice('') }}>
                                    ×
                                  </Button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setAddingModifierTo(group.id)}
                                  className="w-full py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded border border-dashed border-indigo-300"
                                  disabled={saving}
                                >
                                  + Add Modifier
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
