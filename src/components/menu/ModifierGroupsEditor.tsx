'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'

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
  sortOrder: number
  modifiers: Modifier[]
}

interface MenuItem {
  id: string
  name: string
}

interface ModifierGroupsEditorProps {
  item: MenuItem | null
  onUpdated: () => void
  ingredientsLibrary?: { id: string; name: string; category: string | null }[]
}

export function ModifierGroupsEditor({ item, onUpdated, ingredientsLibrary }: ModifierGroupsEditorProps) {
  const [groups, setGroups] = useState<ModifierGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [editingGroup, setEditingGroup] = useState<string | null>(null)

  // New group form
  const [showNewGroupForm, setShowNewGroupForm] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')

  // New modifier form
  const [addingModifierTo, setAddingModifierTo] = useState<string | null>(null)
  const [newModName, setNewModName] = useState('')
  const [newModPrice, setNewModPrice] = useState('')

  // Ingredient linking
  const [linkingModifier, setLinkingModifier] = useState<{ groupId: string; modId: string } | null>(null)
  const [ingredientSearch, setIngredientSearch] = useState('')

  // Load groups when item changes
  useEffect(() => {
    if (!item?.id) {
      setGroups([])
      return
    }
    loadGroups()
  }, [item?.id])

  const loadGroups = async () => {
    if (!item?.id) return
    setLoading(true)
    try {
      const res = await fetch(`/api/menu/items/${item.id}/modifier-groups`)
      const data = await res.json()
      setGroups(data.data || [])
    } catch (e) {
      console.error('Failed to load groups:', e)
    } finally {
      setLoading(false)
    }
  }

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
      await loadGroups()
      onUpdated()
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
      await loadGroups()
      onUpdated()
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
      await loadGroups()
      onUpdated()
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
      await loadGroups()
      onUpdated()
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
      await loadGroups()
      onUpdated()
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
      await loadGroups()
      onUpdated()
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
      const data = await res.json()
      await loadGroups()
      // Auto-expand the parent group to show the new child
      if (data.data?.id) {
        setExpandedGroup(expandedGroup)
      }
      onUpdated()
    } catch (e) {
      console.error('Failed to create child group:', e)
    } finally {
      setSaving(false)
    }
  }

  const linkIngredient = async (groupId: string, modifierId: string, ingredientId: string | null) => {
    await updateModifier(groupId, modifierId, { ingredientId })
    setLinkingModifier(null)
    setIngredientSearch('')
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

  // Helper to render a modifier row with all controls
  const renderModifierRow = (groupId: string, mod: Modifier, depth: number = 0) => {
    const isLinking = linkingModifier?.groupId === groupId && linkingModifier?.modId === mod.id
    const filteredIngredients = ingredientsLibrary?.filter(ing =>
      ing.name.toLowerCase().includes(ingredientSearch.toLowerCase())
    ) || []

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
          {ingredientsLibrary && (
            <button
              onClick={() => setLinkingModifier(isLinking ? null : { groupId, modId: mod.id })}
              className={`w-5 h-5 rounded text-xs ${isLinking ? 'bg-purple-500 text-white' : 'bg-purple-100 text-purple-600 hover:bg-purple-200'}`}
              title="Link Ingredient"
            >
              🔗
            </button>
          )}

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
              value={ingredientSearch}
              onChange={(e) => setIngredientSearch(e.target.value)}
              placeholder="Search ingredients..."
              className="w-full px-2 py-1 text-xs border rounded mb-1"
              autoFocus
            />
            <div className="max-h-32 overflow-y-auto space-y-0.5">
              {filteredIngredients.length === 0 ? (
                <div className="text-xs text-gray-400 text-center py-2">
                  {ingredientSearch ? 'No matches' : 'Type to search'}
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

  if (!item) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 p-4 bg-gray-50">
        <p className="text-sm text-center">Select an item to manage its modifier groups</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white border-l">
      {/* Header */}
      <div className="p-3 border-b bg-indigo-50 flex items-center justify-between">
        <h3 className="font-semibold text-sm text-indigo-900">Item Modifier Groups</h3>
        <Button
          variant="ghost"
          size="sm"
          className="text-indigo-600 text-xs"
          onClick={() => setShowNewGroupForm(true)}
        >
          + Add
        </Button>
      </div>

      {/* New Group Form */}
      {showNewGroupForm && (
        <div className="p-2 border-b bg-indigo-50/50">
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="Group name..."
            className="w-full px-2 py-1 text-sm border rounded mb-2"
            autoFocus
          />
          <div className="flex gap-1">
            <Button size="sm" variant="primary" onClick={createGroup} disabled={saving || !newGroupName.trim()}>
              Create
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowNewGroupForm(false); setNewGroupName('') }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Groups List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {loading ? (
          <p className="text-center text-gray-400 text-sm py-4">Loading...</p>
        ) : groups.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-4">No modifier groups</p>
        ) : (
          groups.map(group => {
            const isExpanded = expandedGroup === group.id
            const isEmpty = group.modifiers.length === 0
            const childModCount = group.modifiers.filter(m => m.childModifierGroupId).length

            return (
              <div
                key={group.id}
                className={`border rounded-lg overflow-hidden ${group.isRequired ? 'border-l-4 border-red-400' : ''} ${isEmpty ? 'border-dashed' : ''}`}
              >
                {/* Group Header */}
                <div
                  className="px-3 py-2 bg-gray-50 flex items-center gap-2 cursor-pointer"
                  onClick={() => setExpandedGroup(isExpanded ? null : group.id)}
                >
                  <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''} ${group.isRequired && isEmpty ? 'text-red-500' : isEmpty ? 'text-gray-300' : 'text-green-500'}`}>
                    ▶
                  </span>
                  <span className="flex-1 font-medium text-sm truncate">{group.name}</span>
                  <div className="flex items-center gap-1">
                    {childModCount > 0 && (
                      <span className="text-[9px] px-1 bg-indigo-100 text-indigo-600 rounded">
                        {childModCount}▶
                      </span>
                    )}
                    <span className="text-xs text-gray-400">{group.modifiers.length}</span>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="border-t">
                    {/* Group Settings */}
                    <div className="p-2 bg-gray-50/50 border-b">
                      <div className="flex items-center gap-2 text-xs">
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
                          <span className="text-gray-600">Req</span>
                        </label>
                        <label className="flex items-center gap-1 ml-2">
                          <input
                            type="checkbox"
                            checked={group.allowStacking}
                            onChange={(e) => updateGroup(group.id, { allowStacking: e.target.checked })}
                            className="w-3 h-3"
                          />
                          <span className="text-gray-600">Stack</span>
                        </label>
                        <button
                          onClick={() => deleteGroup(group.id)}
                          className="ml-auto text-red-500 hover:text-red-700 text-xs"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {/* Modifiers */}
                    <div className="p-2 space-y-1">
                      {isEmpty && (
                        <div className="text-center text-gray-400 text-xs py-2 italic">
                          Add modifiers to get started
                        </div>
                      )}
                      {group.modifiers.map(mod => renderModifierRow(group.id, mod))}

                      {/* Add Modifier */}
                      {addingModifierTo === group.id ? (
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
                          <Button size="sm" variant="primary" onClick={() => addModifier(group.id)} disabled={!newModName.trim()}>
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
  )
}
