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
  childModifierGroupId?: string
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
}

export function ModifierGroupsEditor({ item, onUpdated }: ModifierGroupsEditorProps) {
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
            const isEditing = editingGroup === group.id

            return (
              <div key={group.id} className="border rounded-lg overflow-hidden">
                {/* Group Header */}
                <div
                  className="px-3 py-2 bg-gray-50 flex items-center gap-2 cursor-pointer"
                  onClick={() => setExpandedGroup(isExpanded ? null : group.id)}
                >
                  <span className={`text-gray-400 text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                    ▶
                  </span>
                  <span className="flex-1 font-medium text-sm truncate">{group.name}</span>
                  <span className="text-xs text-gray-400">{group.modifiers.length}</span>
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
                      {group.modifiers.map(mod => (
                        <div key={mod.id} className="flex items-center gap-2 px-2 py-1.5 bg-white border rounded text-sm">
                          <span className="flex-1 truncate">{mod.name}</span>
                          {/* Pre-modifier toggles */}
                          <div className="flex gap-0.5">
                            <button
                              onClick={() => updateModifier(group.id, mod.id, { allowNo: !mod.allowNo })}
                              className={`w-5 h-5 rounded text-[9px] font-bold ${mod.allowNo ? 'bg-red-500 text-white' : 'bg-red-100 text-red-400'}`}
                            >
                              N
                            </button>
                            <button
                              onClick={() => updateModifier(group.id, mod.id, { allowLite: !mod.allowLite })}
                              className={`w-5 h-5 rounded text-[9px] font-bold ${mod.allowLite ? 'bg-yellow-500 text-white' : 'bg-yellow-100 text-yellow-400'}`}
                            >
                              L
                            </button>
                            <button
                              onClick={() => updateModifier(group.id, mod.id, { allowOnSide: !mod.allowOnSide })}
                              className={`w-5 h-5 rounded text-[9px] font-bold ${mod.allowOnSide ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-400'}`}
                            >
                              S
                            </button>
                            <button
                              onClick={() => updateModifier(group.id, mod.id, { allowExtra: !mod.allowExtra })}
                              className={`w-5 h-5 rounded text-[9px] font-bold ${mod.allowExtra ? 'bg-green-500 text-white' : 'bg-green-100 text-green-400'}`}
                            >
                              E
                            </button>
                          </div>
                          {mod.price > 0 && (
                            <span className="text-xs text-green-600">+{formatCurrency(mod.price)}</span>
                          )}
                          <button
                            onClick={() => deleteModifier(group.id, mod.id)}
                            className="text-red-400 hover:text-red-600 text-xs"
                          >
                            ×
                          </button>
                        </div>
                      ))}

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
