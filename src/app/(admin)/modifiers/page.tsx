'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'

// Modifier type definitions
const MODIFIER_TYPES = [
  { value: 'universal', label: 'Universal', color: '#6b7280', description: 'Available to all item types' },
  { value: 'food', label: 'Food', color: '#22c55e', description: 'Food item modifiers (cooking temps, sides, etc.)' },
  { value: 'liquor', label: 'Liquor', color: '#8b5cf6', description: 'Spirit/drink modifiers (brands, mixers, etc.)' },
  { value: 'retail', label: 'Retail', color: '#f59e0b', description: 'Retail item modifiers (sizes, colors, etc.)' },
  { value: 'entertainment', label: 'Entertainment', color: '#f97316', description: 'Entertainment modifiers (add-ons, upgrades)' },
  { value: 'combo', label: 'Combo', color: '#ec4899', description: 'Combo/bundle modifiers' },
]

interface Modifier {
  id: string
  name: string
  displayName?: string
  price: number
  upsellPrice?: number | null
  allowedPreModifiers?: string[] | null
  extraPrice?: number | null
  extraUpsellPrice?: number | null
  isDefault: boolean
  isActive: boolean
  childModifierGroupId?: string | null
  commissionType?: string | null
  commissionValue?: number | null
}

interface ModifierGroup {
  id: string
  name: string
  displayName?: string
  modifierTypes: string[]
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
  const [typeFilter, setTypeFilter] = useState<string>('all')

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/modifiers')
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
    modifierTypes: string[]
    minSelections: number
    maxSelections: number
    isRequired: boolean
    modifiers: { id?: string; name: string; price: number; upsellPrice?: number | null; allowedPreModifiers?: string[] | null; extraPrice?: number | null; extraUpsellPrice?: number | null; isDefault?: boolean; isActive?: boolean; childModifierGroupId?: string | null; commissionType?: string | null; commissionValue?: number | null }[]
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
          {/* Type Filter */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Type</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Types</option>
              {MODIFIER_TYPES.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            {modifierGroups.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No modifier groups yet</p>
            ) : (
              modifierGroups
                .filter(group => typeFilter === 'all' || (group.modifierTypes || ['universal']).includes(typeFilter))
                .map(group => {
                  const groupTypes = group.modifierTypes || ['universal']
                  return (
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
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1 flex-wrap">
                            <h3 className="font-medium truncate mr-1">{group.name}</h3>
                            {groupTypes.slice(0, 2).map(type => {
                              const typeInfo = MODIFIER_TYPES.find(t => t.value === type) || MODIFIER_TYPES[0]
                              return (
                                <span
                                  key={type}
                                  className="px-1.5 py-0.5 text-[10px] font-medium rounded text-white flex-shrink-0"
                                  style={{ backgroundColor: typeInfo.color }}
                                >
                                  {typeInfo.label}
                                </span>
                              )
                            })}
                            {groupTypes.length > 2 && (
                              <span className="text-[10px] text-gray-500">+{groupTypes.length - 2}</span>
                            )}
                          </div>
                          <p className="text-sm text-gray-500">
                            {group.modifiers.length} options
                            {group.isRequired && (
                              <span className="ml-2 text-red-500">Required</span>
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })
            )}
          </div>
        </div>

        {/* Main Content - Selected Group Details */}
        <div className="flex-1 p-6">
          {selectedGroup ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <CardTitle>{selectedGroup.name}</CardTitle>
                    <div className="flex gap-1">
                      {(selectedGroup.modifierTypes || ['universal']).map(type => {
                        const typeInfo = MODIFIER_TYPES.find(t => t.value === type) || MODIFIER_TYPES[0]
                        return (
                          <span
                            key={type}
                            className="px-2 py-1 text-xs font-medium rounded-full text-white"
                            style={{ backgroundColor: typeInfo.color }}
                          >
                            {typeInfo.label}
                          </span>
                        )
                      })}
                    </div>
                  </div>
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
                  {selectedGroup.modifiers.map(mod => {
                    const childGroup = mod.childModifierGroupId
                      ? modifierGroups.find(g => g.id === mod.childModifierGroupId)
                      : null
                    return (
                      <div
                        key={mod.id}
                        className={`p-3 rounded border ${
                          mod.isActive ? 'bg-white' : 'bg-gray-100 opacity-60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-wrap">
                            {mod.isDefault && (
                              <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded">
                                Default
                              </span>
                            )}
                            {mod.allowedPreModifiers && mod.allowedPreModifiers.length > 0 && (
                              <span className="bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded">
                                {mod.allowedPreModifiers.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')}
                              </span>
                            )}
                            <span className={mod.isActive ? 'font-medium' : 'line-through'}>{mod.name}</span>
                          </div>
                          <div className="text-right flex flex-wrap items-center justify-end gap-1">
                            <span className={mod.price > 0 ? 'text-green-600 font-medium' : 'text-gray-400'}>
                              {mod.price > 0 ? `+${formatCurrency(mod.price)}` : 'No charge'}
                            </span>
                            {mod.upsellPrice !== null && mod.upsellPrice !== undefined && (
                              <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                                Upsell: {formatCurrency(mod.upsellPrice)}
                              </span>
                            )}
                            {mod.extraPrice !== null && mod.extraPrice !== undefined && (
                              <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">
                                Extra: +{formatCurrency(mod.extraPrice)}
                              </span>
                            )}
                            {mod.extraUpsellPrice !== null && mod.extraUpsellPrice !== undefined && (
                              <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                                Extra Upsell: {formatCurrency(mod.extraUpsellPrice)}
                              </span>
                            )}
                            {mod.commissionType && mod.commissionValue && (
                              <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
                                Comm: {mod.commissionType === 'fixed' ? formatCurrency(mod.commissionValue) : `${mod.commissionValue}%`}
                              </span>
                            )}
                          </div>
                        </div>
                        {childGroup && (
                          <div className="mt-2 ml-4 flex items-center gap-2 text-sm text-gray-600">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                            <span>Prompts: <strong>{childGroup.name}</strong></span>
                            <span className="text-gray-400">({childGroup.modifiers.length} options)</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
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
          allGroups={modifierGroups}
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
  allGroups,
  onSave,
  onClose,
}: {
  group: ModifierGroup | null
  allGroups: ModifierGroup[]
  onSave: (data: {
    name: string
    displayName?: string
    modifierTypes: string[]
    minSelections: number
    maxSelections: number
    isRequired: boolean
    modifiers: { id?: string; name: string; price: number; upsellPrice?: number | null; allowedPreModifiers?: string[] | null; extraPrice?: number | null; extraUpsellPrice?: number | null; isDefault?: boolean; isActive?: boolean; childModifierGroupId?: string | null; commissionType?: string | null; commissionValue?: number | null }[]
  }) => void
  onClose: () => void
}) {
  const [name, setName] = useState(group?.name || '')
  const [displayName, setDisplayName] = useState(group?.displayName || '')
  const [modifierTypes, setModifierTypes] = useState<string[]>(group?.modifierTypes || ['universal'])
  const [minSelections, setMinSelections] = useState(group?.minSelections || 0)
  const [maxSelections, setMaxSelections] = useState(group?.maxSelections || 1)
  const [isRequired, setIsRequired] = useState(group?.isRequired || false)
  const [modifiers, setModifiers] = useState<{
    id?: string
    name: string
    price: number
    upsellPrice?: number | null
    allowedPreModifiers?: string[] | null
    extraPrice?: number | null
    extraUpsellPrice?: number | null
    isDefault?: boolean
    isActive?: boolean
    childModifierGroupId?: string | null
    commissionType?: string | null
    commissionValue?: number | null
  }[]>(
    group?.modifiers.map(m => ({
      id: m.id,
      name: m.name,
      price: m.price,
      upsellPrice: m.upsellPrice,
      allowedPreModifiers: m.allowedPreModifiers,
      extraPrice: m.extraPrice,
      extraUpsellPrice: m.extraUpsellPrice,
      isDefault: m.isDefault,
      isActive: m.isActive,
      childModifierGroupId: m.childModifierGroupId,
      commissionType: m.commissionType,
      commissionValue: m.commissionValue,
    })) || []
  )

  // Filter out the current group from selectable child groups to prevent circular references
  const availableChildGroups = allGroups.filter(g => g.id !== group?.id)

  const addModifier = () => {
    setModifiers([...modifiers, { name: '', price: 0, upsellPrice: null, allowedPreModifiers: null, extraPrice: null, extraUpsellPrice: null, isDefault: false, isActive: true, childModifierGroupId: null, commissionType: null, commissionValue: null }])
  }

  const togglePreModifier = (index: number, prefix: string) => {
    const updated = [...modifiers]
    const current = updated[index].allowedPreModifiers || []
    if (current.includes(prefix)) {
      updated[index].allowedPreModifiers = current.filter(p => p !== prefix)
      if (updated[index].allowedPreModifiers?.length === 0) {
        updated[index].allowedPreModifiers = null
      }
    } else {
      updated[index].allowedPreModifiers = [...current, prefix]
    }
    setModifiers(updated)
  }

  const updateModifier = (index: number, field: string, value: string | number | boolean | null) => {
    const updated = [...modifiers]
    updated[index] = { ...updated[index], [field]: value }
    setModifiers(updated)
  }

  const removeModifier = (index: number) => {
    setModifiers(modifiers.filter((_, i) => i !== index))
  }

  const handleSubmit = () => {
    if (!name.trim()) return
    if (modifierTypes.length === 0) {
      setModifierTypes(['universal'])
    }
    onSave({
      name: name.trim(),
      displayName: displayName.trim() || undefined,
      modifierTypes: modifierTypes.length > 0 ? modifierTypes : ['universal'],
      minSelections,
      maxSelections,
      isRequired,
      modifiers: modifiers.filter(m => m.name.trim()),
    })
  }

  const toggleModifierType = (typeValue: string) => {
    if (modifierTypes.includes(typeValue)) {
      // Don't allow removing the last type
      if (modifierTypes.length > 1) {
        setModifierTypes(modifierTypes.filter(t => t !== typeValue))
      }
    } else {
      setModifierTypes([...modifierTypes, typeValue])
    }
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

          {/* Modifier Types Selection (Multiple) */}
          <div>
            <label className="block text-sm font-medium mb-2">Modifier Types (select all that apply)</label>
            <div className="grid grid-cols-3 gap-2">
              {MODIFIER_TYPES.map(type => {
                const isSelected = modifierTypes.includes(type.value)
                return (
                  <label
                    key={type.value}
                    className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                      isSelected
                        ? 'border-2 bg-opacity-10'
                        : 'hover:bg-gray-50 border'
                    }`}
                    style={isSelected ? { borderColor: type.color, backgroundColor: `${type.color}15` } : {}}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleModifierType(type.value)}
                      className="sr-only"
                    />
                    <span
                      className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center ${
                        isSelected ? 'text-white' : 'border-2 border-gray-300'
                      }`}
                      style={isSelected ? { backgroundColor: type.color } : {}}
                    >
                      {isSelected && (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{type.label}</div>
                      <div className="text-xs text-gray-500 truncate">{type.description}</div>
                    </div>
                  </label>
                )
              })}
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
            <div className="space-y-3">
              {modifiers.map((mod, index) => (
                <div key={index} className="border rounded-lg p-3 bg-gray-50">
                  {/* Show labels only on first modifier */}
                  {index === 0 && (
                    <div className="flex gap-2 items-center mb-1 text-xs text-gray-500 font-medium">
                      <div className="flex-1">Name</div>
                      <div className="w-20 text-center">Price</div>
                      <div className="w-20 text-center">Upsell $</div>
                      <div className="w-16"></div>
                      <div className="w-6"></div>
                    </div>
                  )}
                  <div className="flex gap-2 items-center mb-2">
                    <input
                      type="text"
                      value={mod.name}
                      onChange={e => updateModifier(index, 'name', e.target.value)}
                      className="flex-1 border rounded-lg px-3 py-2"
                      placeholder="Modifier name"
                    />
                    <div className="w-20">
                      <input
                        type="number"
                        value={mod.price}
                        onChange={e => updateModifier(index, 'price', parseFloat(e.target.value) || 0)}
                        className="w-full border rounded-lg px-2 py-2 text-sm text-center"
                        placeholder="0.00"
                        step="0.01"
                        min="0"
                      />
                    </div>
                    <div className="w-20">
                      <input
                        type="number"
                        value={mod.upsellPrice ?? ''}
                        onChange={e => updateModifier(index, 'upsellPrice', e.target.value ? parseFloat(e.target.value) : null)}
                        className="w-full border rounded-lg px-2 py-2 text-sm bg-green-50 text-center"
                        placeholder="—"
                        step="0.01"
                        min="0"
                      />
                    </div>
                    <label className="flex items-center gap-1 text-sm whitespace-nowrap w-16">
                      <input
                        type="checkbox"
                        checked={mod.isDefault || false}
                        onChange={e => updateModifier(index, 'isDefault', e.target.checked)}
                      />
                      Default
                    </label>
                    <button
                      onClick={() => removeModifier(index)}
                      className="text-red-500 hover:text-red-700 p-1 w-6"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  {/* Prefix options row */}
                  <div className="flex items-center gap-4 mb-2 text-sm">
                    <span className="text-gray-500 whitespace-nowrap">Prefixes:</span>
                    {['no', 'lite', 'extra', 'side'].map(prefix => (
                      <label key={prefix} className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={mod.allowedPreModifiers?.includes(prefix) || false}
                          onChange={() => togglePreModifier(index, prefix)}
                          className="w-3.5 h-3.5"
                        />
                        <span className="capitalize">{prefix}</span>
                      </label>
                    ))}
                    {mod.allowedPreModifiers?.includes('extra') && (
                      <div className="border-l pl-3 ml-2 flex items-center gap-2">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-gray-400">Extra $</span>
                          <input
                            type="number"
                            value={mod.extraPrice ?? ''}
                            onChange={e => updateModifier(index, 'extraPrice', e.target.value ? parseFloat(e.target.value) : null)}
                            className="w-16 border rounded px-2 py-1 text-sm text-center"
                            placeholder="—"
                            step="0.01"
                            min="0"
                          />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-gray-400">Extra Upsell $</span>
                          <input
                            type="number"
                            value={mod.extraUpsellPrice ?? ''}
                            onChange={e => updateModifier(index, 'extraUpsellPrice', e.target.value ? parseFloat(e.target.value) : null)}
                            className="w-16 border rounded px-2 py-1 text-sm bg-green-50 text-center"
                            placeholder="—"
                            step="0.01"
                            min="0"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Sub-modifier group selection */}
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500">Sub-modifier:</span>
                    <select
                      value={mod.childModifierGroupId || ''}
                      onChange={e => updateModifier(index, 'childModifierGroupId', e.target.value || null)}
                      className="flex-1 border rounded-lg px-2 py-1.5 text-sm bg-white"
                    >
                      <option value="">None - no follow-up options</option>
                      {availableChildGroups.map(g => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.modifiers.length} options)
                        </option>
                      ))}
                    </select>
                    {mod.childModifierGroupId && (
                      <span className="text-blue-600 text-xs">
                        Will prompt for additional choices
                      </span>
                    )}
                  </div>
                  {/* Commission row */}
                  <div className="flex items-center gap-2 text-sm mt-2 pt-2 border-t border-gray-200">
                    <span className="text-gray-500">Commission:</span>
                    <select
                      value={mod.commissionType || ''}
                      onChange={e => {
                        updateModifier(index, 'commissionType', e.target.value || null)
                        if (!e.target.value) updateModifier(index, 'commissionValue', null)
                      }}
                      className="border rounded-lg px-2 py-1.5 text-sm bg-white"
                    >
                      <option value="">None</option>
                      <option value="fixed">Fixed $</option>
                      <option value="percent">Percent %</option>
                    </select>
                    {mod.commissionType && (
                      <div className="flex items-center gap-1">
                        <span className="text-gray-400">
                          {mod.commissionType === 'fixed' ? '$' : '%'}
                        </span>
                        <input
                          type="number"
                          value={mod.commissionValue ?? ''}
                          onChange={e => updateModifier(index, 'commissionValue', e.target.value ? parseFloat(e.target.value) : null)}
                          className="w-16 border rounded px-2 py-1 text-sm text-center"
                          placeholder="0"
                          step={mod.commissionType === 'fixed' ? '0.01' : '0.1'}
                          min="0"
                        />
                      </div>
                    )}
                  </div>
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
