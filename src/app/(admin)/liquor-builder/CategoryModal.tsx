'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { SpiritCategory } from './types'

export interface CategoryModalProps {
  category: SpiritCategory | null
  onSave: (data: { name: string; displayName?: string; description?: string; isActive?: boolean }) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}

export function CategoryModal({
  category,
  onSave,
  onDelete,
  onClose,
}: CategoryModalProps) {
  const [name, setName] = useState(category?.name || '')
  const [displayName, setDisplayName] = useState(category?.displayName || '')
  const [description, setDescription] = useState(category?.description || '')
  const [isActive, setIsActive] = useState(category?.isActive ?? true)
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    await onSave({ name, displayName: displayName || undefined, description: description || undefined, isActive })
    setSaving(false)
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={category ? 'Edit Category' : 'New Spirit Category'} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="e.g., Tequila, Vodka, Rum"
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
