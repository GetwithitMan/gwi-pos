'use client'

import { RefObject } from 'react'
import Link from 'next/link'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
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
  selectedItemIds: Set<string>
  categories: Category[]
  onItemClick: (item: MenuItem) => void
  onCreateItem: () => void
  onItemSearch: (value: string) => void
  onDragOverItem: (itemId: string | null) => void
  onCopyModifierGroup: (groupId: string, sourceItemId: string, targetItemId: string, groupName: string) => void
  onToggleSelection: (itemId: string) => void
  onMoveSelected: (targetCategoryId: string) => void
}

/** Individual draggable item button */
function DraggableItemButton({
  item,
  isSelected,
  isChecked,
  dragOverItemId,
  onItemClick,
  onDragOverItem,
  onCopyModifierGroup,
  onToggleSelection,
}: {
  item: MenuItem
  isSelected: boolean
  isChecked: boolean
  dragOverItemId: string | null
  onItemClick: (item: MenuItem) => void
  onDragOverItem: (itemId: string | null) => void
  onCopyModifierGroup: (groupId: string, sourceItemId: string, targetItemId: string, groupName: string) => void
  onToggleSelection: (itemId: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `item-drag-${item.id}`,
    data: { type: 'menu-item', itemId: item.id, itemName: item.name },
  })

  const style = transform ? {
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 50 : undefined,
  } : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`shrink-0 flex items-stretch ${isDragging ? 'opacity-50' : ''}`}
    >
      {/* Checkbox for batch selection */}
      <label
        className="flex items-center px-1 cursor-pointer"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => onToggleSelection(item.id)}
          className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
        />
      </label>

      <button
        {...listeners}
        {...attributes}
        onClick={() => onItemClick(item)}
        onDragOver={(e) => {
          // Only accept modifier group drags (native HTML drag)
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
              onCopyModifierGroup(groupId, sourceItemId, item.id, groupName)
            }
          }
        }}
        className={`px-3 py-1.5 rounded-lg border-2 transition-all text-left min-w-[120px] cursor-grab active:cursor-grabbing ${
          dragOverItemId === item.id
            ? 'ring-2 ring-indigo-400 bg-indigo-50'
            : isChecked
            ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
            : isSelected
            ? 'border-blue-500 bg-blue-50'
            : !item.isAvailable
            ? 'border-transparent bg-gray-100 opacity-50'
            : 'border-transparent bg-gray-100 hover:bg-gray-200'
        }`}
      >
        <div className="flex items-center justify-between gap-1">
          <span className={`font-medium text-xs ${isSelected ? 'text-blue-700' : 'text-gray-800'}`}>
            {item.name}
          </span>
          {!item.isAvailable && (
            <span className="text-[9px] bg-red-100 text-red-700 px-1 rounded">86</span>
          )}
          {(item.availableFromDate || item.availableUntilDate) && (
            <span className="text-[9px] bg-amber-100 text-amber-700 px-1 rounded">Seasonal</span>
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
    </div>
  )
}

export function ItemsBar({
  filteredItems,
  selectedCategoryData,
  selectedItemForEditor,
  dragOverItemId,
  itemSearch,
  itemSearchRef,
  itemsScrollRef,
  selectedItemIds,
  categories,
  onItemClick,
  onCreateItem,
  onItemSearch,
  onDragOverItem,
  onCopyModifierGroup,
  onToggleSelection,
  onMoveSelected,
}: ItemsBarProps) {
  const hasSelection = selectedItemIds.size > 0

  return (
    <div className="bg-white border-b px-4 py-1.5 shrink-0">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-gray-900">
          {selectedCategoryData?.name} Items
        </span>
        {selectedCategoryData?.categoryType === 'liquor' && (
          <Link href="/liquor-builder" className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full hover:bg-purple-200">
            → Bottles & Recipes in Liquor Builder
          </Link>
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
        {hasSelection && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-blue-600 font-medium">
              {selectedItemIds.size} selected
            </span>
            <select
              className="h-6 text-xs px-2 border rounded bg-blue-50 text-blue-700 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  onMoveSelected(e.target.value)
                  e.target.value = ''
                }
              }}
            >
              <option value="" disabled>Move to...</option>
              {categories
                .filter(c => c.id !== selectedCategoryData?.id)
                .map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))
              }
            </select>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-blue-600 h-6 text-xs px-2"
          onClick={onCreateItem}
        >
          + Add Item
        </Button>
        <span className="text-[10px] text-gray-900 ml-auto">
          Drag items to categories above
        </span>
      </div>
      <div
        ref={itemsScrollRef}
        className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-gray-300"
      >
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-gray-900">
            <svg className="w-10 h-10 mb-2 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-medium">No menu items</p>
            <p className="text-xs mt-1">Click + Add Item to create one.</p>
          </div>
        ) : (
          filteredItems.map(item => (
            <DraggableItemButton
              key={item.id}
              item={item}
              isSelected={selectedItemForEditor?.id === item.id}
              isChecked={selectedItemIds.has(item.id)}
              dragOverItemId={dragOverItemId}
              onItemClick={onItemClick}
              onDragOverItem={onDragOverItem}
              onCopyModifierGroup={onCopyModifierGroup}
              onToggleSelection={onToggleSelection}
            />
          ))
        )}
      </div>
    </div>
  )
}
