'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'

interface Template {
  id: string
  name: string
  description: string | null
  minSelections: number
  maxSelections: number
  isRequired: boolean
  createdAt: string
  modifiers: Array<{ id: string; name: string; price: number }>
}

interface TemplatePickerModalProps {
  isOpen: boolean
  onClose: () => void
  onApply: (templateId: string, templateName: string) => void
}

export function TemplatePickerModal({ isOpen, onClose, onApply }: TemplatePickerModalProps) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    fetch('/api/menu/modifier-templates')
      .then(r => r.json())
      .then(res => setTemplates(res.data || []))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false))
  }, [isOpen])

  const filtered = search.trim()
    ? templates.filter(t => t.name.toLowerCase().includes(search.toLowerCase()))
    : templates

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Group from Template" size="md">
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search templates..."
        className="w-full px-3 py-2 text-sm border rounded-lg mb-3"
        autoFocus
      />

      {loading && <div className="text-center text-gray-500 text-sm py-8">Loading templates...</div>}

      {!loading && filtered.length === 0 && (
        <div className="text-center text-gray-500 text-sm py-8">
          {templates.length === 0 ? 'No templates yet. Save a modifier group as a template first.' : 'No templates match your search.'}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-1">
          {filtered.map(t => (
            <button
              key={t.id}
              onClick={() => { onApply(t.id, t.name); onClose() }}
              className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-indigo-50 transition-colors border border-transparent hover:border-indigo-200"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm text-gray-900">{t.name}</span>
                <span className="text-xs text-gray-500">{t.modifiers.length} modifier{t.modifiers.length !== 1 ? 's' : ''}</span>
              </div>
              {t.modifiers.length > 0 && (
                <div className="text-xs text-gray-500 mt-0.5 truncate">
                  {t.modifiers.map(m => m.name).join(', ')}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
