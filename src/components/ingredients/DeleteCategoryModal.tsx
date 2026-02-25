'use client'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import type { IngredientCategory, DeleteCategoryInfo } from './types'

interface DeleteCategoryModalProps {
  category: IngredientCategory
  info: DeleteCategoryInfo
  confirmText: string
  onConfirmTextChange: (text: string) => void
  loading: boolean
  onConfirm: () => void
  onClose: () => void
}

export function DeleteCategoryModal({
  category,
  info,
  confirmText,
  onConfirmTextChange,
  loading,
  onConfirm,
  onClose,
}: DeleteCategoryModalProps) {
  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`Delete \u201c${category.name}\u201d?`}
      size="md"
      variant="default"
    >
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
            <p className="font-semibold text-amber-900 mb-2">
              This category contains:
            </p>
            <ul className="text-sm text-amber-800 space-y-1">
              {info.ingredientCount > 0 && (
                <li>
                  {info.ingredientCount} inventory item{info.ingredientCount !== 1 ? 's' : ''}
                </li>
              )}
              {info.childCount > 0 && (
                <li>
                  {info.childCount} prep item{info.childCount !== 1 ? 's' : ''}
                </li>
              )}
            </ul>
            <p className="text-sm text-red-700 font-medium mt-3">
              All {info.totalCount} item{info.totalCount !== 1 ? 's' : ''} will be moved to the Deleted section.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Type <span className="font-bold text-red-600">DELETE</span> to confirm
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => onConfirmTextChange(e.target.value)}
              className="w-full px-3 py-2 border-2 border-red-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
              placeholder="Type DELETE here"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="outline"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              onClick={onConfirm}
              disabled={confirmText !== 'DELETE' || loading}
              className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
            >
              {loading ? 'Deleting...' : `Delete Category + ${info.totalCount} Item${info.totalCount !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>
    </Modal>
  )
}
