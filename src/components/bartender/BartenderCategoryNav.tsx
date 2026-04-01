'use client'

import { memo, useRef, useCallback } from 'react'
import {
  type CategoryRows,
  type CategoryDisplaySettings,
  CATEGORY_SIZES,
  isLightColor,
} from '@/components/bartender/bartender-settings'
import type { CategoryFloorPlan as Category } from '@/types'

// ============================================================================
// TYPES
// ============================================================================

interface BartenderCategoryNavProps {
  categories: Category[]
  selectedCategoryId: string | null
  categorySettings: CategoryDisplaySettings
  categoryOrder: string[]
  isEditing: boolean
  draggedCategoryId: string | null
  menuSection: 'bar' | 'food' | 'entertainment'
  /** Reference to the scroll container, shared with parent for reset-on-section-change */
  scrollRef?: React.RefObject<HTMLDivElement | null>
  onCategoryClick: (categoryId: string) => void
  onDragStart: (categoryId: string) => void
  onDragOver: (categoryId: string) => void
  onDragEnd: () => void
  // Settings panel callbacks
  onSaveCategorySettings: (settings: CategoryDisplaySettings) => void
  onResetCategoryOrder: () => void
  onStopEditing: () => void
  // Long-press binding for the vertical label
  categoryLongPressProps: Record<string, any>
}

// ============================================================================
// COMPONENT
// ============================================================================

export const BartenderCategoryNav = memo(function BartenderCategoryNav({
  categories,
  selectedCategoryId,
  categorySettings,
  categoryOrder,
  isEditing,
  draggedCategoryId,
  menuSection,
  scrollRef,
  onCategoryClick,
  onDragStart,
  onDragOver,
  onDragEnd,
  onSaveCategorySettings,
  onResetCategoryOrder,
  onStopEditing,
  categoryLongPressProps,
}: BartenderCategoryNavProps) {
  // Fallback ref if parent doesn't pass one
  const internalScrollRef = useRef<HTMLDivElement>(null)
  const categoryScrollRef = scrollRef || internalScrollRef
  const currentSizeConfig = CATEGORY_SIZES.find(s => s.value === categorySettings.size) || CATEGORY_SIZES[3]

  const handleScrollRight = useCallback(() => {
    if (categoryScrollRef.current) {
      const scrollAmount = currentSizeConfig.px * 3
      categoryScrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' })
    }
  }, [categoryScrollRef, currentSizeConfig.px])

  return (
    <div className="flex-shrink-0 bg-slate-800/30 border-b border-white/10 p-2">
      {/* Settings Panel - shown when editing */}
      {isEditing && (
        <div className="mb-2 p-2 bg-slate-700/30 rounded-lg flex items-center gap-4 flex-wrap">
          {/* Rows */}
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-xs">Rows:</span>
            <div className="flex gap-1">
              {[1, 2].map(r => (
                <button
                  key={r}
                  onClick={() => onSaveCategorySettings({ ...categorySettings, rows: r as CategoryRows })}
                  className={`w-10 h-10 rounded text-sm font-bold transition-all ${
                    categorySettings.rows === r
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                  }`}
                  aria-label={`Set category rows to ${r}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Size */}
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-xs">Size:</span>
            <div className="flex gap-1">
              {CATEGORY_SIZES.map(s => (
                <button
                  key={s.value}
                  onClick={() => onSaveCategorySettings({ ...categorySettings, size: s.value })}
                  className={`px-2 h-8 rounded text-xs font-bold transition-all ${
                    categorySettings.size === s.value
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Reset Order */}
          {categoryOrder.length > 0 && (
            <button
              onClick={onResetCategoryOrder}
              className="px-2 h-8 rounded text-xs font-bold bg-orange-600 text-white hover:bg-orange-500 transition-all"
            >
              Reset Order
            </button>
          )}

          <span className="text-slate-500 text-xs italic">Drag categories to reorder</span>

          <button
            onClick={onStopEditing}
            className="ml-auto px-3 py-1 bg-green-600 text-white text-xs font-bold rounded hover:bg-green-500"
          >
            Done
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* Vertical Label - Long press to edit */}
        <div
          className="flex-shrink-0 w-6 flex items-center justify-center cursor-pointer select-none"
          {...categoryLongPressProps}
          title="Long-press to edit display"
        >
          <span
            className="text-slate-500 text-[10px] font-bold tracking-wider"
            style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
          >
            {menuSection === 'bar' ? 'BAR' : 'FOOD'}
          </span>
        </div>

        {/* Categories Grid - Horizontal scroll with dynamic rows */}
        <div
          ref={categoryScrollRef}
          className="flex-1 grid grid-flow-col gap-2 overflow-x-auto overflow-y-hidden scroll-smooth [&::-webkit-scrollbar]:hidden"
          style={{
            gridTemplateRows: `repeat(${categorySettings.rows}, 1fr)`,
            gridAutoColumns: `${currentSizeConfig.px}px`,
            scrollbarWidth: 'none',
          }}
        >
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => !isEditing && onCategoryClick(cat.id)}
              draggable={isEditing}
              onDragStart={() => onDragStart(cat.id)}
              onDragOver={(e) => {
                e.preventDefault()
                onDragOver(cat.id)
              }}
              onDragEnd={onDragEnd}
              onTouchStart={() => {
                if (isEditing) {
                  onDragStart(cat.id)
                }
              }}
              onTouchMove={(e) => {
                if (isEditing && draggedCategoryId) {
                  const touch = e.touches[0]
                  const element = document.elementFromPoint(touch.clientX, touch.clientY)
                  const catButton = element?.closest('[data-category-id]') as HTMLElement
                  if (catButton) {
                    const targetId = catButton.dataset.categoryId
                    if (targetId) onDragOver(targetId)
                  }
                }
              }}
              onTouchEnd={() => {
                if (isEditing) {
                  onDragEnd()
                }
              }}
              data-category-id={cat.id}
              className={`relative rounded-xl font-bold flex items-center justify-center text-center leading-tight p-2 transition-all duration-200 border-2 ${currentSizeConfig.text} ${
                isEditing
                  ? draggedCategoryId === cat.id
                    ? 'opacity-50 ring-2 ring-indigo-400 scale-95'
                    : 'ring-1 ring-dashed ring-slate-500 cursor-grab'
                  : selectedCategoryId === cat.id
                    ? 'scale-110 ring-4 ring-white/50 shadow-2xl border-white'
                    : 'hover:scale-105 hover:brightness-110 border-black/20 shadow-lg'
              }`}
              style={{
                width: `${currentSizeConfig.px}px`,
                height: `${currentSizeConfig.px}px`,
                backgroundColor: cat.color || '#475569',
                color: isLightColor(cat.color || '') ? '#1e293b' : '#ffffff',
                textShadow: isLightColor(cat.color || '') ? 'none' : '0 1px 2px rgba(0,0,0,0.5)',
                ...(selectedCategoryId === cat.id && !isEditing ? {
                  boxShadow: `0 0 20px ${cat.color || '#6366f1'}, 0 0 40px ${cat.color || '#6366f1'}50`,
                } : {})
              }}
            >
              {isEditing && (
                <span className="absolute top-0.5 left-0.5 text-[8px] text-slate-400">{'\u22EE\u22EE'}</span>
              )}
              <span className="line-clamp-2">{cat.name}</span>
            </button>
          ))}
        </div>

        {/* Right Arrow - scrolls right */}
        {categories.length > 3 && (
          <button
            onClick={handleScrollRight}
            className="flex-shrink-0 w-12 h-full min-h-[48px] rounded-lg flex items-center justify-center transition-all bg-slate-700/60 text-white hover:bg-slate-600 active:scale-95"
            aria-label="Scroll categories right"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {categories.length === 0 && (
        <div className="text-center py-3 text-slate-500 text-sm">
          No {menuSection === 'bar' ? 'bar' : 'food'} categories configured
        </div>
      )}
    </div>
  )
})
