'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { SpiritCategory } from './types'

const CATEGORY_TYPES = [
  {
    value: 'spirit',
    label: 'Spirits',
    description: 'Vodka, Tequila, Rum, Whiskey, Gin',
    emoji: '🥃',
    color: 'amber',
  },
  {
    value: 'beer',
    label: 'Beer',
    description: 'Domestic, Import, Craft, Draft',
    emoji: '🍺',
    color: 'yellow',
  },
  {
    value: 'wine',
    label: 'Wine',
    description: 'Red, White, Rosé, Sparkling',
    emoji: '🍷',
    color: 'purple',
  },
] as const

const NAME_PLACEHOLDERS: Record<string, string> = {
  spirit: 'e.g., Tequila, Vodka, Rum',
  beer: 'e.g., Domestic Beers, Craft Selection',
  wine: 'e.g., Red Wines, House Wines',
}

export interface CategoryModalProps {
  category: SpiritCategory | null
  onSave: (data: { name: string; categoryType: string; displayName?: string; description?: string; isActive?: boolean }) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}

export function CategoryModal({
  category,
  onSave,
  onDelete,
  onClose,
}: CategoryModalProps) {
  const [categoryType, setCategoryType] = useState(category?.categoryType || 'spirit')
  const [name, setName] = useState(category?.name || '')
  const [displayName, setDisplayName] = useState(category?.displayName || '')
  const [description, setDescription] = useState(category?.description || '')
  const [isActive, setIsActive] = useState(category?.isActive ?? true)
  const [saving, setSaving] = useState(false)

  const hasBottles = category && category.bottleCount > 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    await onSave({ name, categoryType, displayName: displayName || undefined, description: description || undefined, isActive })
    setSaving(false)
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={category ? 'Edit Category' : 'New Spirit Category'} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Category Type Selector */}
          <div>
            <label className="block text-sm font-medium mb-2">Category Type</label>
            <div className="grid grid-cols-3 gap-2">
              {CATEGORY_TYPES.map(ct => {
                const isSelected = categoryType === ct.value
                const colorClasses = {
                  amber: isSelected ? 'border-amber-500 bg-amber-50 text-amber-900 ring-1 ring-amber-500' : 'border-gray-200 hover:border-amber-300 text-gray-600',
                  yellow: isSelected ? 'border-yellow-500 bg-yellow-50 text-yellow-900 ring-1 ring-yellow-500' : 'border-gray-200 hover:border-yellow-300 text-gray-600',
                  purple: isSelected ? 'border-purple-500 bg-purple-50 text-purple-900 ring-1 ring-purple-500' : 'border-gray-200 hover:border-purple-300 text-gray-600',
                }
                return (
                  <button
                    key={ct.value}
                    type="button"
                    onClick={() => setCategoryType(ct.value)}
                    className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all ${colorClasses[ct.color]}`}
                  >
                    <span className="text-2xl">{ct.emoji}</span>
                    <span className="text-sm font-semibold">{ct.label}</span>
                    <span className="text-[10px] leading-tight text-center opacity-70">{ct.description}</span>
                  </button>
                )
              })}
            </div>
            {hasBottles && category?.categoryType !== categoryType && (
              <p className="mt-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                This category has {category.bottleCount} bottle{category.bottleCount !== 1 ? 's' : ''}. Changing the type may affect how they display.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder={NAME_PLACEHOLDERS[categoryType] || NAME_PLACEHOLDERS.spirit}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Optional display name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              rows={2}
            />
          </div>
          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
              />
              <span>Active</span>
            </label>
          </div>
          <div className="flex justify-between pt-4 border-t">
            <div>
              {onDelete && (
                <Button type="button" variant="danger" onClick={onDelete}>
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? 'Saving...' : category ? 'Save Changes' : 'Create'}
              </Button>
            </div>
          </div>
        </form>
    </Modal>
  )
}
