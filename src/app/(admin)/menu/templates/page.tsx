'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from '@/stores/toast-store'
import { Search, Plus, Trash2, Copy, GripVertical, ArchiveRestore } from 'lucide-react'

interface TemplateModifier {
  id?: string
  name: string
  price: number
  allowNo: boolean
  allowLite: boolean
  allowOnSide: boolean
  allowExtra: boolean
  extraPrice: number
  sortOrder: number
  isDefault: boolean
  displayName: string | null
  ingredientId: string | null
  ingredientName: string | null
  inventoryDeductionAmount: number | null
  inventoryDeductionUnit: string | null
  showOnPOS: boolean
  showOnline: boolean
}

interface Template {
  id: string
  name: string
  description: string | null
  minSelections: number
  maxSelections: number
  isRequired: boolean
  allowStacking: boolean
  modifierTypes: string[]
  sortOrder: number
  isActive: boolean
  deletedAt: string | null
  sourceTemplateName?: string | null
  createdAt: string
  updatedAt: string
  modifiers: TemplateModifier[]
}

export default function ModifierTemplatesPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/menu/templates' })

  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [showArchived, setShowArchived] = useState(false)

  // Editable state for selected template
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editMinSelections, setEditMinSelections] = useState(0)
  const [editMaxSelections, setEditMaxSelections] = useState(1)
  const [editIsRequired, setEditIsRequired] = useState(false)
  const [editAllowStacking, setEditAllowStacking] = useState(false)
  const [editModifierTypes, setEditModifierTypes] = useState<string[]>(['food'])
  const [editModifiers, setEditModifiers] = useState<TemplateModifier[]>([])

  const selectedTemplate = templates.find(t => t.id === selectedId) || null

  const fetchTemplates = useCallback(async (includeArchived = false) => {
    try {
      const url = includeArchived
        ? '/api/menu/modifier-templates?includeArchived=true'
        : '/api/menu/modifier-templates'
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch')
      const json = await res.json()
      setTemplates(json.data || [])
    } catch {
      toast.error('Failed to load templates')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (hydrated) fetchTemplates(showArchived)
  }, [hydrated, fetchTemplates, showArchived])

  // Sync editable state when selection changes
  useEffect(() => {
    if (selectedTemplate) {
      setEditName(selectedTemplate.name)
      setEditDescription(selectedTemplate.description || '')
      setEditMinSelections(selectedTemplate.minSelections)
      setEditMaxSelections(selectedTemplate.maxSelections)
      setEditIsRequired(selectedTemplate.isRequired)
      setEditAllowStacking(selectedTemplate.allowStacking ?? false)
      setEditModifierTypes(selectedTemplate.modifierTypes?.length ? selectedTemplate.modifierTypes : ['food'])
      setEditModifiers(selectedTemplate.modifiers.map(m => ({ ...m })))
    }
  }, [selectedId])

  const filteredTemplates = templates.filter(t => {
    // Search filter
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false
    // Type filter
    if (typeFilter !== 'all' && !(t.modifierTypes || []).includes(typeFilter)) return false
    // Archived filter
    if (showArchived) return !!t.deletedAt
    return !t.deletedAt
  })

  const handleCreate = async () => {
    try {
      const res = await fetch('/api/menu/modifier-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Template',
          allowStacking: false,
          modifierTypes: ['food'],
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error || 'Failed to create')
        return
      }
      const json = await res.json()
      setTemplates(prev => [...prev, json.data])
      setSelectedId(json.data.id)
      toast.success('Template created')
    } catch {
      toast.error('Failed to create template')
    }
  }

  const handleSave = async () => {
    if (!selectedId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/menu/modifier-templates/${selectedId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          description: editDescription || null,
          minSelections: editMinSelections,
          maxSelections: editMaxSelections,
          isRequired: editIsRequired,
          allowStacking: editAllowStacking,
          modifierTypes: editModifierTypes,
          modifiers: editModifiers.map((m, i) => ({
            name: m.name,
            price: m.price,
            allowNo: m.allowNo,
            allowLite: m.allowLite,
            allowOnSide: m.allowOnSide,
            allowExtra: m.allowExtra,
            extraPrice: m.extraPrice,
            sortOrder: i,
            isDefault: m.isDefault,
            displayName: m.displayName,
            ingredientId: m.ingredientId,
            ingredientName: m.ingredientName,
            inventoryDeductionAmount: m.inventoryDeductionAmount,
            inventoryDeductionUnit: m.inventoryDeductionUnit,
            showOnPOS: m.showOnPOS,
            showOnline: m.showOnline,
          })),
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error || 'Failed to save')
        return
      }
      const json = await res.json()
      setTemplates(prev => prev.map(t => t.id === selectedId ? json.data : t))
      toast.success('Template saved')
    } catch {
      toast.error('Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedId) return
    try {
      const res = await fetch(`/api/menu/modifier-templates/${selectedId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete')
      setTemplates(prev => prev.filter(t => t.id !== selectedId))
      setSelectedId(null)
      setConfirmDelete(false)
      toast.success('Template archived')
    } catch {
      toast.error('Failed to archive template')
    }
  }

  const handleRestore = async (templateId: string) => {
    try {
      const res = await fetch(`/api/menu/modifier-templates/${templateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restore: true }),
      })
      if (!res.ok) throw new Error('Failed to restore')
      const json = await res.json()
      setTemplates(prev => prev.map(t => t.id === templateId ? json.data : t))
      toast.success('Template restored')
    } catch {
      toast.error('Failed to restore template')
    }
  }

  const handleDuplicate = async (template?: Template) => {
    const tpl = template || selectedTemplate
    if (!tpl) return
    try {
      const res = await fetch('/api/menu/modifier-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${tpl.name} (Copy)`,
          description: tpl.description,
          minSelections: tpl.minSelections,
          maxSelections: tpl.maxSelections,
          isRequired: tpl.isRequired,
          allowStacking: tpl.allowStacking,
          modifierTypes: tpl.modifierTypes,
          modifiers: tpl.modifiers.map((m, i) => ({
            name: m.name,
            price: m.price,
            allowNo: m.allowNo,
            allowLite: m.allowLite,
            allowOnSide: m.allowOnSide,
            allowExtra: m.allowExtra,
            extraPrice: m.extraPrice,
            sortOrder: i,
            isDefault: m.isDefault,
            displayName: m.displayName,
            ingredientId: m.ingredientId,
            ingredientName: m.ingredientName,
            inventoryDeductionAmount: m.inventoryDeductionAmount,
            inventoryDeductionUnit: m.inventoryDeductionUnit,
            showOnPOS: m.showOnPOS,
            showOnline: m.showOnline,
          })),
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error || 'Failed to duplicate')
        return
      }
      const json = await res.json()
      setTemplates(prev => [...prev, json.data])
      setSelectedId(json.data.id)
      toast.success('Template duplicated')
    } catch {
      toast.error('Failed to duplicate template')
    }
  }

  const addModifier = () => {
    setEditModifiers(prev => [
      ...prev,
      {
        name: '',
        price: 0,
        allowNo: true,
        allowLite: false,
        allowOnSide: false,
        allowExtra: false,
        extraPrice: 0,
        sortOrder: prev.length,
        isDefault: false,
        displayName: null,
        ingredientId: null,
        ingredientName: null,
        inventoryDeductionAmount: null,
        inventoryDeductionUnit: null,
        showOnPOS: true,
        showOnline: true,
      },
    ])
  }

  const updateModifier = (index: number, updates: Partial<TemplateModifier>) => {
    setEditModifiers(prev => prev.map((m, i) => i === index ? { ...m, ...updates } : m))
  }

  const removeModifier = (index: number) => {
    setEditModifiers(prev => prev.filter((_, i) => i !== index))
  }

  if (!hydrated) return null

  return (
    <div className="h-full flex flex-col">
      <AdminPageHeader
        title="Modifier Templates"
        breadcrumbs={[{ label: 'Menu', href: '/menu' }]}
        subtitle="Reusable modifier groups to apply across menu items"
      />

      <div className="flex-1 flex gap-6 min-h-0">
        {/* Left panel — template list */}
        <div className="w-80 flex-shrink-0 flex flex-col bg-white rounded-lg border border-gray-200">
          <div className="p-4 border-b border-gray-200 space-y-3">
            <button
              onClick={handleCreate}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Template
            </button>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search templates..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Type filter tabs */}
            <div className="flex gap-1">
              {(['all', 'food', 'liquor', 'universal'] as const).map(filter => (
                <button
                  key={filter}
                  onClick={() => setTypeFilter(filter)}
                  className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    typeFilter === filter
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {filter.charAt(0).toUpperCase() + filter.slice(1)}
                </button>
              ))}
            </div>

            {/* Show Archived toggle */}
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={e => {
                  setShowArchived(e.target.checked)
                  setSelectedId(null)
                }}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
              />
              Show Archived
            </label>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-sm text-gray-500 text-center">Loading...</div>
            ) : filteredTemplates.length === 0 ? (
              <div className="p-4 text-sm text-gray-500 text-center">
                {search || typeFilter !== 'all'
                  ? 'No templates match your filters'
                  : showArchived
                    ? 'No archived templates'
                    : 'No templates yet'}
              </div>
            ) : (
              filteredTemplates.map(t => (
                <div
                  key={t.id}
                  className={`flex items-center border-b border-gray-100 transition-colors ${
                    selectedId === t.id
                      ? 'bg-blue-50 border-l-2 border-l-blue-600'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <button
                    onClick={() => setSelectedId(t.id)}
                    className="flex-1 text-left px-4 py-3 min-w-0"
                  >
                    <div className="font-medium text-sm text-gray-900 truncate">{t.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1 flex-wrap">
                      <span>{t.modifiers.length} modifier{t.modifiers.length !== 1 ? 's' : ''}</span>
                      {t.isRequired && <span className="text-orange-600 font-medium">Required</span>}
                      {(t.modifierTypes || []).map(mt => (
                        <span key={mt} className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px] font-medium uppercase">
                          {mt}
                        </span>
                      ))}
                      {t.deletedAt && <span className="text-red-500 font-medium">Archived</span>}
                    </div>
                  </button>
                  <div className="flex items-center gap-1 pr-2 flex-shrink-0">
                    {t.deletedAt ? (
                      <button
                        onClick={e => { e.stopPropagation(); handleRestore(t.id) }}
                        className="p-1.5 text-gray-400 hover:text-green-600 transition-colors"
                        title="Restore template"
                      >
                        <ArchiveRestore className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); handleDuplicate(t) }}
                        className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors"
                        title="Duplicate template"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right panel — template detail */}
        <div className="flex-1 bg-white rounded-lg border border-gray-200 overflow-y-auto">
          {!selectedTemplate ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              Select a template to edit
            </div>
          ) : (
            <div className="p-6 space-y-6">
              {/* Source template badge */}
              {selectedTemplate.sourceTemplateName && (
                <div className="text-xs text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg inline-block">
                  (from: {selectedTemplate.sourceTemplateName})
                </div>
              )}

              {/* Template name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input
                  type="text"
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  placeholder="Optional description"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Settings */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Min Selections</label>
                  <input
                    type="number"
                    min={0}
                    value={editMinSelections}
                    onChange={e => setEditMinSelections(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Selections</label>
                  <input
                    type="number"
                    min={0}
                    value={editMaxSelections}
                    onChange={e => setEditMaxSelections(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="flex gap-6 flex-wrap">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editIsRequired}
                    onChange={e => setEditIsRequired(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-gray-700">Required</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editAllowStacking}
                    onChange={e => setEditAllowStacking(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-gray-700">Allow Stacking</span>
                </label>
              </div>

              {/* Modifier Types */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Modifier Types</label>
                <div className="flex gap-4">
                  {(['food', 'liquor', 'universal'] as const).map(mt => (
                    <label key={mt} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editModifierTypes.includes(mt)}
                        onChange={e => {
                          if (e.target.checked) {
                            setEditModifierTypes(prev => [...prev, mt])
                          } else {
                            setEditModifierTypes(prev => prev.filter(v => v !== mt))
                          }
                        }}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-gray-700">{mt.charAt(0).toUpperCase() + mt.slice(1)}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Modifiers */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Modifiers ({editModifiers.length})
                  </h3>
                  <button
                    onClick={addModifier}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Add Modifier
                  </button>
                </div>

                {editModifiers.length === 0 ? (
                  <div className="text-sm text-gray-400 text-center py-6 border border-dashed border-gray-300 rounded-lg">
                    No modifiers yet. Click &quot;Add Modifier&quot; to start.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {editModifiers.map((mod, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2"
                      >
                        <div className="flex items-center gap-3">
                          <GripVertical className="w-4 h-4 text-gray-300 flex-shrink-0" />

                          {/* Name */}
                          <input
                            type="text"
                            value={mod.name}
                            onChange={e => updateModifier(idx, { name: e.target.value })}
                            placeholder="Modifier name"
                            className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />

                          {/* Price */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <span className="text-xs text-gray-500">$</span>
                            <input
                              type="number"
                              step="0.01"
                              min={0}
                              value={mod.price}
                              onChange={e => updateModifier(idx, { price: parseFloat(e.target.value) || 0 })}
                              className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>

                          {/* Pre-mod flags */}
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {(['allowNo', 'allowLite', 'allowOnSide', 'allowExtra'] as const).map(flag => (
                              <label
                                key={flag}
                                className="flex items-center gap-1 text-xs text-gray-600"
                                title={flag.replace('allow', '')}
                              >
                                <input
                                  type="checkbox"
                                  checked={mod[flag]}
                                  onChange={e => updateModifier(idx, { [flag]: e.target.checked })}
                                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                                />
                                {flag.replace('allow', '')}
                              </label>
                            ))}
                          </div>

                          {/* Visibility flags */}
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <label className="flex items-center gap-1 text-xs text-gray-600" title="Show on POS">
                              <input
                                type="checkbox"
                                checked={mod.showOnPOS ?? true}
                                onChange={e => updateModifier(idx, { showOnPOS: e.target.checked })}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                              />
                              POS
                            </label>
                            <label className="flex items-center gap-1 text-xs text-gray-600" title="Show Online">
                              <input
                                type="checkbox"
                                checked={mod.showOnline ?? true}
                                onChange={e => updateModifier(idx, { showOnline: e.target.checked })}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                              />
                              Online
                            </label>
                          </div>

                          {/* Delete */}
                          <button
                            onClick={() => removeModifier(idx)}
                            className="p-1 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                            title="Remove modifier"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Ingredient link display (read-only) */}
                        {mod.ingredientName && (
                          <div className="ml-7 text-xs text-gray-500">
                            <span className="font-medium text-gray-600">{mod.ingredientName}</span>
                            <span className="ml-1 text-gray-400">(linked on apply)</span>
                            {mod.inventoryDeductionAmount != null && mod.inventoryDeductionUnit && (
                              <span className="ml-2 text-gray-400">
                                {mod.inventoryDeductionAmount} {mod.inventoryDeductionUnit}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDuplicate()}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <Copy className="w-4 h-4" />
                    Duplicate
                  </button>
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
                <button
                  onClick={handleSave}
                  disabled={saving || !editName.trim()}
                  className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Archive Template"
        description={`Are you sure you want to archive "${selectedTemplate?.name}"? You can restore it later from the archived view.`}
        confirmLabel="Archive"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
