'use client'

import { RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { CATEGORY_TYPES } from '../types'
import type { Category } from '../types'

interface CategoriesBarProps {
  categories: Category[]
  isLoading: boolean
  selectedCategory: string | null
  categoriesScrollRef: RefObject<HTMLDivElement | null>
  onSelectCategory: (id: string) => void
  onEditCategory: (category: Category) => void
  onAddCategory: () => void
}

export function CategoriesBar({
  categories,
  isLoading,
  selectedCategory,
  categoriesScrollRef,
  onSelectCategory,
  onEditCategory,
  onAddCategory,
}: CategoriesBarProps) {
  return (
    <div className="bg-white border-b px-4 py-1.5 shrink-0">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-gray-500">Categories</span>
        <Button
          variant="ghost"
          size="sm"
          className="text-blue-600 h-6 text-xs px-2"
          onClick={onAddCategory}
        >
          + Add
        </Button>
      </div>
      <div
        ref={categoriesScrollRef}
        className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-gray-300"
      >
        {isLoading ? (
          <div className="space-y-2 py-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton-shimmer rounded-lg h-8" />
            ))}
            <style>{`
              .skeleton-shimmer {
                background: linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%);
                background-size: 200% 100%;
                animation: shimmer 1.5s ease-in-out infinite;
              }
              @keyframes shimmer {
                0% { background-position: 200% 0; }
                100% { background-position: -200% 0; }
              }
            `}</style>
          </div>
        ) : categories.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-gray-400">
            <svg className="w-10 h-10 mb-2 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6z" />
            </svg>
            <p className="text-sm font-medium">No categories yet</p>
            <p className="text-xs mt-1">Click + Add to create your first category.</p>
          </div>
        ) : (
          categories.map(category => {
            const typeInfo = CATEGORY_TYPES.find(t => t.value === category.categoryType)
            const isSelected = selectedCategory === category.id
            return (
              <button
                key={category.id}
                onClick={() => onSelectCategory(category.id)}
                className={`shrink-0 px-3 py-1.5 rounded-lg border-2 transition-all flex items-center gap-1.5 text-sm ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-transparent bg-gray-100 hover:bg-gray-200'
                }`}
              >
                <div
                  className="w-3 h-3 rounded"
                  style={{ backgroundColor: category.color }}
                />
                <span className={`font-medium whitespace-nowrap ${isSelected ? 'text-blue-700' : ''}`}>
                  {category.name}
                </span>
                <span className={`text-sm ${isSelected ? 'text-blue-500' : 'text-gray-400'}`}>
                  ({category.itemCount})
                </span>
                {isSelected && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditCategory(category)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation()
                        onEditCategory(category)
                      }
                    }}
                    className="ml-1 p-1 hover:bg-blue-100 rounded cursor-pointer"
                  >
                    <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
