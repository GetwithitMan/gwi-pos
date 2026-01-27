'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'

interface Modifier {
  id: string
  name: string
  displayName?: string
  price: number
  preModifier?: string
  isDefault: boolean
  isActive: boolean
}

interface ModifierGroup {
  id: string
  name: string
  displayName?: string
  minSelections: number
  maxSelections: number
  isRequired: boolean
  modifiers: Modifier[]
  linkedItems: { id: string; name: string }[]
}

export default function ModifiersPage() {
  const router = useRouter()
  const { isAuthenticated } = useAuthStore()
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedGroup, setSelectedGroup] = useState<ModifierGroup | null>(null)
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ModifierGroup | null>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login')
      return
    }
    loadModifiers()
  }, [isAuthenticated, router])

  const loadModifiers = async () => {
    try {
      const response = await fetch('/api/menu/modifiers')
      if (response.ok) {
        const data = await response.json()
        setModifierGroups(data.modifierGroups)
        if (data.modifierGroups.length > 0 && !selectedGroup) {
          setSelectedGroup(data.modifierGroups[0])
        }
      }
    } catch (error) {
      console.error('Failed to load modifiers:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveGroup = async (groupData: {
    name: string
    displayName?: string
    minSelections: number
    maxSelections: number
    isRequired: boolean
    modifiers: { id?: string; name: string; price: number; preModifier?: string; isDefault?: boolean; isActive?: boolean }[]
  }) => {
    try {
      const method = editingGroup ? 'PUT' : 'POST'
      const url = editingGroup
        ? `/api/menu/modifiers/${editingGroup.id}`
        : '/api/menu/modifiers'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(groupData),
      })

      if (response.ok) {
        loadModifiers()
        setShowGroupModal(false)
        setEditingGroup(null)
      }
    } catch (error) {
      console.error('Failed to save modifier group:', error)
    }
  }

  const handleDeleteGroup = async (groupId: string) => {
    if (!confirm('Delete this modifier group and all its modifiers?')) return

    try {
      const response = await fetch(`/api/menu/modifiers/${groupId}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        loadModifiers()
        if (selectedGroup?.id === groupId) {
          setSelectedGroup(null)
        }
      }
    } catch (error) {
      console.error('Failed to delete modifier group:', error)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-500">Loading modifiers...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.push('/menu')}>
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Menu
          </Button>
          <h1 className="text-2xl font-bold text-gray-900">Modifier Groups</h1>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setEditingGroup(null)
            setShowGroupModal(true)
          }}
        >
          + New Modifier Group
        </Button>
      </header>

      <div className="flex">
        {/* Sidebar - Modifier Groups List */}
        <div className="w-80 bg-white border-r min-h-[calc(100vh-73px)] p-4">
          <div className="space-y-2">
            {modifierGroups.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No modifier groups yet</p>
            ) : (
              modifierGroups.map(group => (
                <div
                  key={group.id}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${
                    selectedGroup?.id === group.id
                      ? 'bg-blue-50 border-2 border-blue-500'
                      : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                  }`}
                  onClick={() => setSelectedGroup(group)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">{group.name}</h3>
                      <p className="text-sm text-gray-500">
                        {group.modifiers.length} options
                        {group.isRequired && (
                          <span className="ml-2 text-red-500">Required</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Main Content - Selected Group Details */}
        <div className="flex-1 p-6">
          {selectedGroup ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>{selectedGroup.name}</CardTitle>
                  {selectedGroup.displayName && (
                    <p className="text-sm text-gray-500">Display: {selectedGroup.displayName}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingGroup(selectedGroup)
                      setShowGroupModal(true)
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleDeleteGroup(selectedGroup.id)}
                  >
                    Delete
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 mb-6 text-sm">
                  <div className="bg-gray-50 p-3 rounded">
                    <p className="text-gray-500">Min Selections</p>
                    <p className="font-semibold">{selectedGroup.minSelections}</p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded">
                    <p className="text-gray-500">Max Selections</p>
                    <p className="font-semibold">{selectedGroup.maxSelections}</p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded">
                    <p className="text-gray-500">Required</p>
                    <p className="font-semibold">{selectedGroup.isRequired ? 'Yes' : 'No'}</p>
                  </div>
                </div>

                <h4 className="font-semibold mb-3">Modifiers</h4>
                <div className="space-y-2">
                  {selectedGroup.modifiers.map(mod => (
                    <div
                      key={mod.id}
                      className={`flex items-center justify-between p-3 rounded border ${
                        mod.isActive ? 'bg-white' : 'bg-gray-100 opacity-60'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {mod.isDefault && (
                          <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded">
                            Default
                          </span>
                        )}
                        {mod.preModifier && (
                          <span className="bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded">
                            {mod.preModifier}
                          </span>
                        )}
                        <span className={mod.isActive ? '' : 'line-through'}>{mod.name}</span>
                      </div>
                      <span className={mod.price > 0 ? 'text-green-600 font-medium' : 'text-gray-400'}>
                        {mod.price > 0 ? `+${formatCurrency(mod.price)}` : 'No charge'}
                      </span>
                    </div>
                  ))}
                </div>

                {selectedGroup.linkedItems.length > 0 && (
                  <>
                    <h4 className="font-semibold mt-6 mb-3">Linked Menu Items</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedGroup.linkedItems.map(item => (
                        <span
                          key={item.id}
                          className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-sm"
                        >
                          {item.name}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="flex items-center justify-center h-64 text-gray-500">
              Select a modifier group to view details
            </div>
          )}
        </div>
      </div>

      {/* Modifier Group Modal */}
      {showGroupModal && (
        <ModifierGroupModal
          group={editingGroup}
          onSave={handleSaveGroup}
          onClose={() => {
            setShowGroupModal(false)
            setEditingGroup(null)
          }}
        />
      )}
    </div>
  )
}

// Modifier Group Modal Component
function ModifierGroupModal({
  group,
  onSave,
  onClose,
}: {
  group: ModifierGroup | null
  onSave: (data: {
    name: string
    displayName?: string
    minSelections: number
    maxSelections: number
    isRequired: boolean
    modifiers: { id?: string; name: string; price: number; preModifier?: string; isDefault?: boolean; isActive?: boolean }[]
  }) => void
  onClose: () => void
}) {
  const [name, setName] = useState(group?.name || '')
  const [displayName, setDisplayName] = useState(group?.displayName || '')
  const [minSelections, setMinSelections] = useState(group?.minSelections || 0)
  const [maxSelections, setMaxSelections] = useState(group?.maxSelections || 1)
  const [isRequired, setIsRequired] = useState(group?.isRequired || false)
  const [modifiers, setModifiers] = useState<{
    id?: string
    name: string
    price: number
    preModifier?: string
    isDefault?: boolean
    isActive?: boolean
  }[]>(
    group?.modifiers.map(m => ({
      id: m.id,
      name: m.name,
      price: m.price,
      preModifier: m.preModifier,
      isDefault: m.isDefault,
      isActive: m.isActive,
    })) || []
  )

  const addModifier = () => {
    setModifiers([...modifiers, { name: '', price: 0, isDefault: false, isActive: true }])
  }

  const updateModifier = (index: number, field: string, value: string | number | boolean) => {
    const updated = [...modifiers]
    updated[index] = { ...updated[index], [field]: value }
    setModifiers(updated)
  }

  const removeModifier = (index: number) => {
    setModifiers(modifiers.filter((_, i) => i !== index))
  }

  const handleSubmit = () => {
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      displayName: displayName.trim() || undefined,
      minSelections,
      maxSelections,
      isRequired,
      modifiers: modifiers.filter(m => m.name.trim()),
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold">
            {group ? 'Edit Modifier Group' : 'New Modifier Group'}
          </h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="e.g., Steak Temperature"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="e.g., How would you like it cooked?"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Min Selections</label>
              <input
                type="number"
                value={minSelections}
                onChange={e => setMinSelections(parseInt(e.target.value) || 0)}
                className="w-full border rounded-lg px-3 py-2"
                min="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Max Selections</label>
              <input
                type="number"
                value={maxSelections}
                onChange={e => setMaxSelections(parseInt(e.target.value) || 1)}
                className="w-full border rounded-lg px-3 py-2"
                min="1"
              />
            </div>
            <div className="flex items-center pt-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isRequired}
                  onChange={e => setIsRequired(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm font-medium">Required</span>
              </label>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium">Modifiers</label>
              <Button variant="ghost" size="sm" onClick={addModifier}>
                + Add Modifier
              </Button>
            </div>
            <div className="space-y-2">
              {modifiers.map((mod, index) => (
                <div key={index} className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={mod.name}
                    onChange={e => updateModifier(index, 'name', e.target.value)}
                    className="flex-1 border rounded-lg px-3 py-2"
                    placeholder="Modifier name"
                  />
                  <div className="w-24">
                    <input
                      type="number"
                      value={mod.price}
                      onChange={e => updateModifier(index, 'price', parseFloat(e.target.value) || 0)}
                      className="w-full border rounded-lg px-3 py-2"
                      placeholder="Price"
                      step="0.01"
                      min="0"
                    />
                  </div>
                  <select
                    value={mod.preModifier || ''}
                    onChange={e => updateModifier(index, 'preModifier', e.target.value)}
                    className="border rounded-lg px-2 py-2 text-sm"
                  >
                    <option value="">No prefix</option>
                    <option value="no">No</option>
                    <option value="lite">Lite</option>
                    <option value="extra">Extra</option>
                    <option value="side">Side</option>
                  </select>
                  <label className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={mod.isDefault || false}
                      onChange={e => updateModifier(index, 'isDefault', e.target.checked)}
                    />
                    Default
                  </label>
                  <button
                    onClick={() => removeModifier(index)}
                    className="text-red-500 hover:text-red-700 p-1"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              {modifiers.length === 0 && (
                <p className="text-gray-400 text-sm text-center py-4">
                  No modifiers yet. Click &quot;+ Add Modifier&quot; to add options.
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="p-6 border-t bg-gray-50 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!name.trim()}>
            {group ? 'Save Changes' : 'Create Group'}
          </Button>
        </div>
      </div>
    </div>
  )
}
