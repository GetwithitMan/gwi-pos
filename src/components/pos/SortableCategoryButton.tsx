'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Category } from '@/types'

interface SortableCategoryButtonProps {
  category: Category
  isSelected: boolean
  isEditing: boolean
  categorySize: 'sm' | 'md' | 'lg'
  isPriority: boolean
  getCategoryStyles: (isPriority: boolean) => React.CSSProperties
  onClick: () => void
  onColorClick?: () => void
  hasCustomColor?: boolean
}

export function SortableCategoryButton({
  category,
  isSelected,
  isEditing,
  categorySize,
  isPriority,
  getCategoryStyles,
  onClick,
  onColorClick,
  hasCustomColor,
}: SortableCategoryButtonProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id, disabled: !isEditing })

  const style: React.CSSProperties = {
    ...getCategoryStyles(isPriority),
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.9 : 1,
    cursor: isEditing ? 'grab' : 'pointer',
  }

  // Priority buttons get larger sizing
  const prioritySizeClasses = {
    sm: 'px-4 py-2 text-sm',
    md: 'px-5 py-3 text-base',
    lg: 'px-7 py-4 text-lg',
  }

  const regularSizeClasses = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-3 py-1.5 text-sm',
    lg: 'px-4 py-2 text-base',
  }

  const sizeClasses = isPriority ? prioritySizeClasses : regularSizeClasses

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        ${sizeClasses[categorySize]}
        rounded-xl font-semibold text-center relative
        ${isEditing
          ? 'border-2 border-dashed !border-gray-400 !bg-white/80'
          : 'hover:scale-[1.02] active:scale-[0.98]'
        }
        ${isDragging ? 'shadow-xl scale-105' : ''}
        transition-all duration-200
      `}
      onClick={onClick}
      {...(isEditing ? { ...attributes, ...listeners } : {})}
    >
      {/* Color picker button in edit mode */}
      {isEditing && onColorClick && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onColorClick()
          }}
          className={`absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs shadow-md z-10 ${
            hasCustomColor ? 'bg-purple-500 hover:bg-purple-600' : 'bg-gray-500 hover:bg-gray-600'
          }`}
          title="Change color"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
          </svg>
        </button>
      )}
      {isEditing && (
        <span className="mr-1 opacity-50">⋮⋮</span>
      )}
      {category.name}
    </div>
  )
}
