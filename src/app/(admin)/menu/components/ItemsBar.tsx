'use client'

import { RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import type { MenuItem, Category } from '../types'

interface ItemsBarProps {
  filteredItems: MenuItem[]
  selectedCategoryData: Category | undefined
  selectedItemForEditor: MenuItem | null
  dragOverItemId: string | null
  itemSearch: string
  itemSearchRef: RefObject<HTMLInputElement | null>
  itemsScrollRef: RefObject<HTMLDivElement | null>
  onItemClick: (item: MenuItem) => void
  onCreateItem: () => void
  onItemSearch: (value: string) => void
  onDragOverItem: (itemId: string | null) => void
  onCopyModifierGroup: (groupId: string, sourceItemId: string, targetItemId: string, groupName: string) => void
}

export function ItemsBar({
  filteredItems,
  selectedCategoryData,
  selectedItemForEditor,
  dragOverItemId,
  itemSearch,
  itemSearchRef,
  itemsScrollRef,
  onItemClick,
  onCreateItem,
  onItemSearch,
  onDragOverItem,
  onCopyModifierGroup,
}: ItemsBarProps) {
  return (
    <div className="bg-white border-b px-4 py-1.5 shrink-0">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-gray-500">
          {selectedCategoryData?.name} Items
        </span>
        {selectedCategoryData?.categoryType === 'liquor' && (
          <a href="/liquor-builder" className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full hover:bg-purple-200">
            → Bottles & Recipes in Liquor Builder
          </a>
        )}
        {selectedCategoryData?.categoryType === 'entertainment' && (
          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
            → Opens in Entertainment Builder
          </span>
        )}
        <input
          ref={itemSearchRef}
          type="text"
          value={itemSearch}
          onChange={(e) => onItemSearch(e.target.value)}
          placeholder="Search items... ( / )"
          className="h-6 text-xs px-2 border rounded w-36 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <Button
          variant="ghost"
          size="sm"
          className="text-blue-600 h-6 text-xs px-2"
          onClick={onCreateItem}
        >
          + Add Item
        </Button>
      </div>
      <div
        ref={itemsScrollRef}
        className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-gray-300"
      >
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-gray-400">
            <svg className="w-10 h-10 mb-2 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-medium">No menu items</p>
            <p className="text-xs mt-1">Click + Add Item to create one.</p>
          </div>
        ) : (
          filteredItems.map(item => {
            const isSelected = selectedItemForEditor?.id === item.id
            return (
              <button
                key={item.id}
                onClick={() => onItemClick(item)}
                onDragOver={(e) => {
                  // Only accept modifier group drags
                  if (e.dataTransfer.types.includes('application/x-modifier-group')) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'copy'
                    onDragOverItem(item.id)
                  }
                }}
                onDragLeave={() => {
                  onDragOverItem(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  onDragOverItem(null)
                  const data = e.dataTransfer.getData('application/x-modifier-group')
                  if (data) {
                    const { groupId, sourceItemId, groupName } = JSON.parse(data)
                    if (sourceItemId !== item.id) {
                      // Call the cross-item copy handler
                      onCopyModifierGroup(groupId, sourceItemId, item.id, groupName)
                    }
                  }
                }}
                className={`shrink-0 px-3 py-1.5 rounded-lg border-2 transition-all text-left min-w-[120px] ${
                  dragOverItemId === item.id
                    ? 'ring-2 ring-indigo-400 bg-indigo-50'
                    : isSelected
                    ? 'border-blue-500 bg-blue-50'
                    : !item.isAvailable
                    ? 'border-transparent bg-gray-100 opacity-50'
                    : 'border-transparent bg-gray-100 hover:bg-gray-200'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className={`font-medium text-xs ${isSelected ? 'text-blue-700' : ''}`}>
                    {item.name}
                  </span>
                  {!item.isAvailable && (
                    <span className="text-[9px] bg-red-100 text-red-700 px-1 rounded">86</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${isSelected ? 'text-blue-600' : 'text-green-600'}`}>
                    {formatCurrency(item.price)}
                  </span>
                  {item.modifierGroupCount && item.modifierGroupCount > 0 && (
                    <span className="text-[9px] text-purple-600">
                      {item.modifierGroupCount} mod
                    </span>
                  )}
                </div>
                {item.itemType === 'timed_rental' && (
                  <div className={`text-[9px] ${
                    item.entertainmentStatus === 'in_use' ? 'text-red-600' : 'text-green-600'
                  }`}>
                    {item.entertainmentStatus === 'in_use' ? '● IN USE' : '● AVAILABLE'}
                  </div>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
