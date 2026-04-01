'use client'

import { useState } from 'react'

export interface MenuCategoryModalProps {
  category: { id: string; name: string; color: string } | null
  onSave: (data: { name: string; color: string }) => void
  onDelete?: () => void
  onClose: () => void
}

const COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
]

export function MenuCategoryModal({
  category,
  onSave,
  onDelete,
  onClose,
}: MenuCategoryModalProps) {
  const [name, setName] = useState(category?.name || '')
  const [color, setColor] = useState(category?.color || '#8b5cf6')

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{category ? 'Edit Category' : 'New Menu Category'}</h2>
          <button onClick={onClose} className="text-gray-900 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              placeholder="e.g. Whiskey, Cocktails, Beer"
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Color</label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-9 h-9 rounded-lg transition-all ${color === c ? 'ring-2 ring-offset-2 ring-gray-500 scale-110' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          {onDelete && (
            <button
              onClick={onDelete}
              className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
            >
              Delete
            </button>
          )}
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => onSave({ name: name.trim(), color })}
            disabled={!name.trim()}
            className="flex-1 px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            {category ? 'Save Changes' : 'Create Category'}
          </button>
        </div>
      </div>
    </div>
  )
}
