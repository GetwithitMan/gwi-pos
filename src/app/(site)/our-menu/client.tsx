'use client'

/**
 * MenuPageClient — Client boundary for the menu page.
 *
 * Desktop (lg+): Clicking an item replaces the menu grid with a full-pane
 * inline customizer. The cart sidebar on the left stays visible.
 *
 * Mobile: Opens a bottom-sheet modal over the menu grid.
 */

import { useState, useCallback, useEffect } from 'react'
import { MenuBrowse } from '@/components/site/MenuBrowse'
import { MenuItemSheet } from '@/components/site/MenuItemSheet'
import { useSiteCartStore } from '@/stores/site-cart-store'
import type { MenuItemData } from '@/components/site/MenuItemCard'

interface MenuCategory {
  id: string
  name: string
  categoryType: string
  items: MenuItemData[]
}

interface MenuPageClientProps {
  categories: MenuCategory[]
  slug: string
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    setIsDesktop(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isDesktop
}

export function MenuPageClient({ categories, slug }: MenuPageClientProps) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const addItem = useSiteCartStore((s) => s.addItem)
  const isDesktop = useIsDesktop()

  const handleItemSelect = useCallback((itemId: string) => {
    setSelectedItemId(itemId)
  }, [])

  const handleCloseSheet = useCallback(() => {
    setSelectedItemId(null)
  }, [])

  const handleAddToCart = useCallback((item: {
    menuItemId: string
    name: string
    price: number
    quantity: number
    modifiers: Array<{ modifierId: string; name: string; price: number; quantity: number; preModifier: string | null }>
    specialInstructions?: string
    pizzaConfig?: unknown
  }) => {
    addItem({
      id: crypto.randomUUID(),
      menuItemId: item.menuItemId,
      name: item.name,
      basePrice: item.price,
      quantity: item.quantity,
      itemType: 'standard',
      modifiers: item.modifiers.map((m) => ({ ...m, depth: 0 })),
      pizzaData: item.pizzaConfig as undefined,
    })
    setSelectedItemId(null)
  }, [addItem])

  // ── Desktop: inline customizer replaces menu grid ─────────────────────

  if (isDesktop && selectedItemId) {
    return (
      <div
        className="flex flex-col"
        style={{ height: 'calc(100vh - 64px)' }}
      >
        <MenuItemSheet
          itemId={selectedItemId}
          slug={slug}
          onClose={handleCloseSheet}
          onAdd={handleAddToCart}
          inline
        />
      </div>
    )
  }

  // ── Default: menu grid + mobile sheet overlay ─────────────────────────

  return (
    <>
      <MenuBrowse
        categories={categories}
        onItemSelect={handleItemSelect}
      />

      {selectedItemId && !isDesktop && (
        <MenuItemSheet
          itemId={selectedItemId}
          slug={slug}
          onClose={handleCloseSheet}
          onAdd={handleAddToCart}
        />
      )}
    </>
  )
}
