'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'

interface ItemDescriptionModalItem {
  id: string
  name: string
  price: number
  description?: string | null
  calories?: number | null
  is86d?: boolean
  categoryType?: string
}

interface ItemDescriptionModalProps {
  item: ItemDescriptionModalItem | null
  isOpen: boolean
  onClose: () => void
  /** Called after the item is successfully 86'd so the parent can refresh */
  onItemUpdated?: () => void
}

export function ItemDescriptionModal({ item, isOpen, onClose, onItemUpdated }: ItemDescriptionModalProps) {
  const [is86ing, setIs86ing] = useState(false)

  if (!item) return null

  const isAlready86d = item.is86d === true

  const handle86 = async () => {
    setIs86ing(true)
    try {
      const res = await fetch(`/api/menu/items/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAvailable: false }),
      })
      if (res.ok) {
        toast.success(`${item.name} marked as 86'd`)
        onItemUpdated?.()
        onClose()
      } else {
        toast.error('Failed to 86 item')
      }
    } catch {
      toast.error('Failed to 86 item')
    } finally {
      setIs86ing(false)
    }
  }

  const handleUn86 = async () => {
    setIs86ing(true)
    try {
      const res = await fetch(`/api/menu/items/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAvailable: true }),
      })
      if (res.ok) {
        toast.success(`${item.name} is back on the menu`)
        onItemUpdated?.()
        onClose()
      } else {
        toast.error('Failed to update item')
      }
    } catch {
      toast.error('Failed to update item')
    } finally {
      setIs86ing(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={item.name} size="sm">
      <div className="space-y-4">
        {/* Price */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Price</span>
          <span className="text-lg font-semibold text-gray-900">{formatCurrency(item.price)}</span>
        </div>

        {/* Category type */}
        {item.categoryType && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Type</span>
            <span className="text-sm font-medium text-gray-700 capitalize">{item.categoryType}</span>
          </div>
        )}

        {/* Calories */}
        {item.calories != null && item.calories > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Calories</span>
            <span className="text-sm font-medium text-gray-700">{item.calories} cal</span>
          </div>
        )}

        {/* Description */}
        {item.description ? (
          <div>
            <span className="text-sm text-gray-500">Description</span>
            <p className="mt-1 text-sm text-gray-800 leading-relaxed">{item.description}</p>
          </div>
        ) : (
          <p className="text-sm text-gray-400 italic">No description set</p>
        )}

        {/* Divider */}
        <div className="border-t border-gray-200 pt-4 flex gap-3">
          {/* 86 / Un-86 button */}
          {isAlready86d ? (
            <button
              onClick={handleUn86}
              disabled={is86ing}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {is86ing ? 'Updating...' : 'Bring Back (Un-86)'}
            </button>
          ) : (
            <button
              onClick={handle86}
              disabled={is86ing}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {is86ing ? 'Updating...' : '86 Item'}
            </button>
          )}

          {/* Close button */}
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
