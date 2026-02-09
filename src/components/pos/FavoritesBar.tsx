'use client'

import { useMemo } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion, AnimatePresence } from 'framer-motion'
import { formatCurrency } from '@/lib/utils'
import type { MenuItem } from '@/types'

interface FavoriteItem {
  id: string
  name: string
  price: number
}

interface FavoritesBarProps {
  favoriteIds: string[]
  menuItems: MenuItem[]
  onItemClick: (item: MenuItem) => void
  onReorder: (newOrder: string[]) => void
  onRemove: (itemId: string) => void
  canEdit: boolean
  currentMode: 'bar' | 'food'
  showPrices?: boolean
  isEditing?: boolean
  cardPriceMultiplier?: number
}

// Sortable favorite item component
function SortableFavoriteItem({
  item,
  menuItem,
  onClick,
  onRemove,
  isEditing,
  showPrice,
  accentColor,
}: {
  item: FavoriteItem
  menuItem?: MenuItem
  onClick: () => void
  onRemove: () => void
  isEditing: boolean
  showPrice: boolean
  accentColor: string
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !isEditing })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    touchAction: isEditing ? 'none' : 'auto',
  }

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ duration: 0.15 }}
      className="relative"
      {...(isEditing ? { ...attributes, ...listeners } : {})}
    >
      <button
        type="button"
        onClick={isEditing ? undefined : onClick}
        className={`
          flex flex-col items-center justify-center
          min-w-[90px] h-[72px] px-4 py-3
          rounded-xl transition-all duration-200 select-none
          ${isDragging
            ? 'shadow-xl scale-105'
            : 'shadow-md shadow-black/5 hover:shadow-lg hover:scale-[1.02]'
          }
          ${isEditing
            ? 'border-2 border-dashed border-gray-400/60 bg-white/60 backdrop-blur-sm cursor-grab active:cursor-grabbing'
            : 'border border-white/40 bg-white/80 backdrop-blur-sm hover:bg-white/90 cursor-pointer'
          }
        `}
        style={{
          borderColor: isDragging ? accentColor : undefined,
          backgroundColor: isDragging ? `${accentColor}15` : undefined,
          boxShadow: isDragging ? `0 10px 40px ${accentColor}30` : undefined,
        }}
      >
        <span className="text-sm font-medium text-gray-900 text-center leading-tight line-clamp-2">
          {item.name}
        </span>
        {showPrice && (
          <span className="text-xs text-gray-500 mt-0.5">
            {formatCurrency(item.price)}
          </span>
        )}
      </button>

      {/* Remove button (edit mode) */}
      {isEditing && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs font-bold hover:bg-red-600 shadow-sm z-10"
        >
          ×
        </button>
      )}
    </motion.div>
  )
}

export function FavoritesBar({
  favoriteIds,
  menuItems,
  onItemClick,
  onReorder,
  onRemove,
  canEdit,
  currentMode,
  showPrices = true,
  isEditing = false,
  cardPriceMultiplier,
}: FavoritesBarProps) {
  const cpm = cardPriceMultiplier || 1
  const accentColor = currentMode === 'bar' ? 'blue' : 'orange'

  // Map favorite IDs to items
  const favoriteItems = useMemo(() => {
    return favoriteIds
      .map(id => {
        const menuItem = menuItems.find(m => m.id === id)
        if (!menuItem) return null
        return {
          id: menuItem.id,
          name: menuItem.name,
          price: menuItem.price * cpm,
        }
      })
      .filter((item): item is FavoriteItem => item !== null)
  }, [favoriteIds, menuItems, cpm])

  // DnD sensors - PointerSensor for mouse, TouchSensor for touch devices
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Lower distance for quicker activation
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150, // Short delay to distinguish from tap
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Handle drag end
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = favoriteIds.indexOf(active.id as string)
      const newIndex = favoriteIds.indexOf(over.id as string)
      const newOrder = arrayMove(favoriteIds, oldIndex, newIndex)
      onReorder(newOrder)
    }
  }

  if (favoriteItems.length === 0 && !canEdit) {
    return null
  }

  return (
    <div
      className={`
        px-4 py-3 border-b backdrop-blur-md
        ${currentMode === 'bar'
          ? 'bg-gradient-to-r from-blue-500/10 via-cyan-500/5 to-transparent border-blue-200/30'
          : 'bg-gradient-to-r from-orange-500/10 via-amber-500/5 to-transparent border-orange-200/30'
        }
      `}
    >
      <div className="flex items-center gap-3">
        {/* Star icon and label */}
        <div className="flex items-center gap-1.5 shrink-0">
          <svg
            className={`w-4 h-4 ${currentMode === 'bar' ? 'text-blue-500' : 'text-orange-500'}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
          <span className={`text-xs font-semibold uppercase tracking-wide ${
            currentMode === 'bar' ? 'text-blue-600' : 'text-orange-600'
          }`}>
            Quick
          </span>
        </div>

        {/* Favorites items */}
        <div className="flex-1 overflow-x-auto">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={favoriteIds}
              strategy={horizontalListSortingStrategy}
            >
              <div className="flex items-center gap-2">
                <AnimatePresence mode="popLayout">
                  {favoriteItems.map(item => (
                    <SortableFavoriteItem
                      key={item.id}
                      item={item}
                      menuItem={menuItems.find(m => m.id === item.id)}
                      onClick={() => {
                        const menuItem = menuItems.find(m => m.id === item.id)
                        if (menuItem) onItemClick(menuItem)
                      }}
                      onRemove={() => onRemove(item.id)}
                      isEditing={isEditing}
                      showPrice={showPrices}
                      accentColor={currentMode === 'bar' ? '#3b82f6' : '#f97316'}
                    />
                  ))}
                </AnimatePresence>

                {/* Empty state / Add button */}
                {favoriteItems.length === 0 && (
                  <div className="text-sm text-gray-500 py-4 px-4">
                    No favorites yet. {canEdit && 'Long-press items to add.'}
                  </div>
                )}

                {/* Add more placeholder (edit mode) */}
                {isEditing && favoriteItems.length < 8 && (
                  <div className="min-w-[80px] h-16 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 text-xs">
                    + Add
                  </div>
                )}
              </div>
            </SortableContext>
          </DndContext>
        </div>

      </div>
    </div>
  )
}
