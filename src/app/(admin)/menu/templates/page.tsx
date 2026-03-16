'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import { Search, Plus, Trash2, Copy, GripVertical } from 'lucide-react'

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
}

interface Template {
  id: string
  name: string
  description: string | null
  minSelections: number
  maxSelections: number
  isRequired: boolean
  sortOrder: number
  isActive: boolean
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

  // Editable state for selected template
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editMinSelections, setEditMinSelections] = useState(0)
  const [editMaxSelections, setEditMaxSelections] = useState(1)
  const [editIsRequired, setEditIsRequired] = useState(false)
  const [editAllowStacking, setEditAllowStacking] = useState(false)
  const [editModifiers, setEditModifiers] = useState<TemplateModifier[]>([])

  const selectedTemplate = templates.find(t => t.id === selectedId) || null

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/menu/modifier-templates')
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
    if (hydrated) fetchTemplates()
  }, [hydrated, fetchTemplates])

  // Sync editable state when selection changes
  useEffect(() => {
    if (selectedTemplate) {
      setEditName(selectedTemplate.name)
      setEditDescription(selectedTemplate.description || '')
      setEditMinSelections(selectedTemplate.minSelections)
      setEditMaxSelections(selectedTemplate.maxSelections)
      setEditIsRequired(selectedTemplate.isRequired)
      setEditAllowStacking(false)
      setEditModifiers(selectedTemplate.modifiers.map(m => ({ ...m })))
    }
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredTemplates = templates.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase())
  )

  const handleCreate = async () => {
    try {
      const res = await fetch('/api/menu/modifier-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Template' }),
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
      toast.success('Template deleted')
    } catch {
      toast.error('Failed to delete template')
    }
  }

  const handleDuplicate = async () => {
    if (!selectedTemplate) return
    try {
      const res = await fetch('/api/menu/modifier-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${selectedTemplate.name} (Copy)`,
          description: selectedTemplate.description,
          minSelections: selectedTemplate.minSelections,
          maxSelections: selectedTemplate.maxSelections,
          isRequired: selectedTemplate.isRequired,
          modifiers: selectedTemplate.modifiers.map((m, i) => ({
            name: m.name,
            price: m.price,
            allowNo: m.allowNo,
            allowLite: m.allowLite,
            allowOnSide: m.allowOnSide,
            allowExtra: m.allowExtra,
            extraPrice: m.extraPrice,
            sortOrder: i,
            isDefault: m.isDefault,
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
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-sm text-gray-500 text-center">Loading...</div>
            ) : filteredTemplates.length === 0 ? (
              <div className="p-4 text-sm text-gray-500 text-center">
                {search ? 'No templates match your search' : 'No templates yet'}
              </div>
            ) : (
              filteredTemplates.map(t => (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${
                    selectedId === t.id
                      ? 'bg-blue-50 border-l-2 border-l-blue-600'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="font-medium text-sm text-gray-900">{t.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {t.modifiers.length} modifier{t.modifiers.length !== 1 ? 's' : ''}
                    {t.isRequired && <span className="ml-2 text-orange-600 font-medium">Required</span>}
                  </div>
                </button>
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

              <div className="flex gap-6">
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
                        className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
                      >
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

                        {/* Delete */}
                        <button
                          onClick={() => removeModifier(idx)}
                          className="p-1 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                          title="Remove modifier"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                <div className="flex gap-2">
                  <button
                    onClick={handleDuplicate}
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
        title="Delete Template"
        description={`Are you sure you want to delete "${selectedTemplate?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
