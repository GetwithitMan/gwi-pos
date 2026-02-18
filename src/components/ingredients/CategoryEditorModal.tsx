'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import type { IngredientCategory } from './IngredientLibrary'

interface CategoryEditorModalProps {
  category: IngredientCategory | null
  onSave: (data: Partial<IngredientCategory>) => void
  onClose: () => void
}

// Common emoji options for categories
const EMOJI_OPTIONS = [
  '🥬', '🍖', '🧀', '🥫', '🍞', '🧅', '🧂', '🥩', '🍗', '🥓',
  '🥚', '🥛', '🧈', '🌶️', '🍅', '🥒', '🥕', '🌽', '🥔', '🍋',
  '🧄', '🫛', '🫒', '🥜', '🌰', '🥗', '🍄', '🥝', '🍇', '🍓',
]

// Color presets
const COLOR_PRESETS = [
  '#22c55e', // green
  '#ef4444', // red
  '#eab308', // yellow
  '#f97316', // orange
  '#a16207', // amber
  '#8b5cf6', // purple
  '#3b82f6', // blue
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#6b7280', // gray
]

export function CategoryEditorModal({
  category,
  onSave,
  onClose,
}: CategoryEditorModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    icon: '🥬',
    color: '#22c55e',
    sortOrder: 0,
    isActive: true,
  })

  useEffect(() => {
    if (category) {
      setFormData({
        name: category.name,
        description: category.description || '',
        icon: category.icon || '🥬',
        color: category.color || '#22c55e',
        sortOrder: category.sortOrder,
        isActive: category.isActive,
      })
    }
  }, [category])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({
      name: formData.name,
      description: formData.description || null,
      icon: formData.icon,
      color: formData.color,
      sortOrder: formData.sortOrder,
      isActive: formData.isActive,
    })
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={category ? 'Edit Category' : 'Add Category'} size="md" variant="default">
      {category && (
        <p className="text-sm text-gray-500 mb-4">
          ID: {category.code} (immutable)
        </p>
      )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              placeholder="e.g., Produce, Protein, Sauce"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optional description"
            />
          </div>

          {/* Icon Picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Icon
            </label>
            <div className="grid grid-cols-10 gap-1 p-2 border rounded-lg">
              {EMOJI_OPTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setFormData({ ...formData, icon: emoji })}
                  className={`text-2xl p-1 rounded hover:bg-gray-100 transition-colors ${
                    formData.icon === emoji ? 'bg-blue-100 ring-2 ring-blue-500' : ''
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-sm text-gray-500">Custom:</span>
              <input
                type="text"
                value={formData.icon}
                onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                className="w-16 px-2 py-1 border rounded text-center text-xl"
                maxLength={2}
              />
            </div>
          </div>

          {/* Color Picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Color
            </label>
            <div className="flex flex-wrap gap-2 p-2 border rounded-lg">
              {COLOR_PRESETS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setFormData({ ...formData, color })}
                  className={`w-8 h-8 rounded-lg transition-transform ${
                    formData.color === color ? 'ring-2 ring-gray-800 scale-110' : ''
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-sm text-gray-500">Custom:</span>
              <input
                type="color"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="w-10 h-8 rounded cursor-pointer"
              />
              <input
                type="text"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="w-24 px-2 py-1 border rounded text-sm"
                placeholder="#22c55e"
              />
            </div>
          </div>

          {/* Sort Order */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sort Order
            </label>
            <input
              type="number"
              value={formData.sortOrder}
              onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
              className="w-24 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Active */}
          <div className="border-t pt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                className="w-4 h-4"
              />
              <span className="font-medium">Active</span>
            </label>
          </div>

          {/* Preview */}
          <div className="border-t pt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Preview
            </label>
            <div
              className="px-4 py-3 rounded-lg flex items-center gap-3"
              style={{ borderLeft: `4px solid ${formData.color}`, backgroundColor: '#f9fafb' }}
            >
              <span className="text-2xl">{formData.icon}</span>
              <span className="font-semibold">{formData.name || 'Category Name'}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              {category ? 'Save Changes' : 'Create Category'}
            </Button>
          </div>
        </form>
    </Modal>
  )
}
