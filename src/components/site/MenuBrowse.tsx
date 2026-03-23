'use client'

/**
 * MenuBrowse — Client orchestrator for menu page.
 *
 * Wires MenuSearch, MenuCategoryTabs, and MenuItemCard grid together.
 * Handles search filtering, scroll-based active category tracking,
 * and tab click → scroll-to-section.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { MenuSearch } from './MenuSearch'
import { MenuCategoryTabs } from './MenuCategoryTabs'
import { MenuItemCard, MenuItemCardSkeleton, type MenuItemData } from './MenuItemCard'

interface MenuCategory {
  id: string
  name: string
  categoryType: string
  items: MenuItemData[]
}

interface MenuBrowseProps {
  categories: MenuCategory[]
  onItemSelect: (itemId: string) => void
}

export function MenuBrowse({ categories, onItemSelect }: MenuBrowseProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(
    categories[0]?.id ?? null
  )
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map())
  const isScrollingToRef = useRef(false)

  // ── Search filter ─────────────────────────────────────────────────────
  const filteredCategories = searchQuery
    ? categories
        .map((cat) => ({
          ...cat,
          items: cat.items.filter(
            (item) =>
              item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              (item.description ?? '').toLowerCase().includes(searchQuery.toLowerCase())
          ),
        }))
        .filter((cat) => cat.items.length > 0)
    : categories

  // ── IntersectionObserver for scroll-based active tab ───────────────────
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (isScrollingToRef.current) return
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveCategoryId(entry.target.id)
            break
          }
        }
      },
      { rootMargin: '-120px 0px -60% 0px', threshold: 0 }
    )

    for (const el of sectionRefs.current.values()) {
      observer.observe(el)
    }

    return () => observer.disconnect()
  }, [filteredCategories])

  // ── Tab click → scroll to section ─────────────────────────────────────
  const handleTabClick = useCallback((categoryId: string) => {
    setActiveCategoryId(categoryId)
    const el = sectionRefs.current.get(categoryId)
    if (el) {
      isScrollingToRef.current = true
      const top = el.getBoundingClientRect().top + window.scrollY - 130
      window.scrollTo({ top, behavior: 'smooth' })
      setTimeout(() => {
        isScrollingToRef.current = false
      }, 600)
    }
  }, [])

  const setSectionRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) {
      sectionRefs.current.set(id, el)
    } else {
      sectionRefs.current.delete(id)
    }
  }, [])

  // ── Empty state (search yielded no results) ───────────────────────────
  const isEmpty = filteredCategories.length === 0

  return (
    <>
      {/* Search */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
        <MenuSearch onSearch={setSearchQuery} />
      </div>

      {/* Category tabs — hidden during search to reduce noise */}
      {!searchQuery && (
        <MenuCategoryTabs
          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
          activeCategoryId={activeCategoryId}
          onTabClick={handleTabClick}
        />
      )}

      {/* Category sections */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pb-16">
        {isEmpty && (
          <div className="text-center py-16">
            <p className="text-lg" style={{ color: 'var(--site-text-muted)' }}>
              No items match &ldquo;{searchQuery}&rdquo;
            </p>
          </div>
        )}

        {filteredCategories.map((cat) => (
          <section
            key={cat.id}
            id={cat.id}
            ref={(el) => setSectionRef(cat.id, el)}
            className="pt-8 first:pt-4"
          >
            <h2
              className="text-xl md:text-2xl mb-4"
              style={{
                fontFamily: 'var(--site-heading-font)',
                fontWeight: 'var(--site-heading-weight, 700)',
                color: 'var(--site-text)',
              }}
            >
              {cat.name}
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {cat.items.map((item) => (
                <MenuItemCard
                  key={item.id}
                  item={item}
                  onSelect={onItemSelect}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  )
}

// ── Skeleton for initial load ─────────────────────────────────────────────────

export function MenuBrowseSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      {/* Search skeleton */}
      <div
        className="h-12 rounded-lg mb-6 animate-pulse"
        style={{ backgroundColor: 'var(--site-bg-secondary)' }}
      />

      {/* Tab skeleton */}
      <div className="flex gap-2 mb-8">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-9 rounded-full animate-pulse"
            style={{
              backgroundColor: 'var(--site-bg-secondary)',
              width: `${60 + i * 15}px`,
            }}
          />
        ))}
      </div>

      {/* Category title skeleton */}
      <div
        className="h-7 rounded w-36 mb-4 animate-pulse"
        style={{ backgroundColor: 'var(--site-bg-secondary)' }}
      />

      {/* Card grid skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <MenuItemCardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}
