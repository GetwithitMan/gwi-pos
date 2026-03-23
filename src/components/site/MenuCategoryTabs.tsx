'use client'

/**
 * MenuCategoryTabs — Horizontal scrollable category tabs (sticky on scroll).
 *
 * Active tab highlights with brand color. Click scrolls to the category
 * section in the DOM. IntersectionObserver auto-selects the active tab
 * as the user scrolls.
 */

import { useRef, useEffect, useState, useCallback } from 'react'

interface CategoryTab {
  id: string
  name: string
}

interface MenuCategoryTabsProps {
  categories: CategoryTab[]
  activeCategoryId: string | null
  onTabClick: (categoryId: string) => void
}

export function MenuCategoryTabs({ categories, activeCategoryId, onTabClick }: MenuCategoryTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  // Auto-scroll the active tab into view
  useEffect(() => {
    if (!activeCategoryId) return
    const tab = tabRefs.current.get(activeCategoryId)
    if (tab && scrollRef.current) {
      const container = scrollRef.current
      const tabLeft = tab.offsetLeft
      const tabWidth = tab.offsetWidth
      const containerWidth = container.offsetWidth
      const scrollLeft = container.scrollLeft

      // If tab is not fully visible, scroll it into view
      if (tabLeft < scrollLeft || tabLeft + tabWidth > scrollLeft + containerWidth) {
        container.scrollTo({
          left: tabLeft - containerWidth / 2 + tabWidth / 2,
          behavior: 'smooth',
        })
      }
    }
  }, [activeCategoryId])

  const setTabRef = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (el) {
      tabRefs.current.set(id, el)
    } else {
      tabRefs.current.delete(id)
    }
  }, [])

  if (categories.length === 0) return null

  return (
    <div
      className="sticky top-16 z-40 border-b backdrop-blur-md"
      style={{
        backgroundColor: 'rgba(255,255,255,0.95)',
        borderColor: 'var(--site-border)',
      }}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div
          ref={scrollRef}
          className="flex gap-1 overflow-x-auto scrollbar-hide py-2"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {categories.map((cat) => {
            const isActive = cat.id === activeCategoryId
            return (
              <button
                key={cat.id}
                ref={(el) => setTabRef(cat.id, el)}
                onClick={() => onTabClick(cat.id)}
                className="shrink-0 px-4 py-2 text-sm font-medium rounded-full transition-all whitespace-nowrap"
                style={{
                  backgroundColor: isActive ? 'var(--site-brand)' : 'transparent',
                  color: isActive ? 'var(--site-text-on-brand)' : 'var(--site-text-muted)',
                }}
                aria-current={isActive ? 'true' : undefined}
              >
                {cat.name}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
