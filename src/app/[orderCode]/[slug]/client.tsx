'use client'

/**
 * OnlineOrderClient — Client component for the orderCode/slug ordering page.
 *
 * Renders the full ordering experience: menu browse with item detail sheet,
 * floating cart bar, and cart drawer. Uses the same components as the (site)
 * route group but doesn't depend on the site layout/shell.
 */

import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { MenuBrowse } from '@/components/site/MenuBrowse'
import { MenuItemSheet } from '@/components/site/MenuItemSheet'
import { FloatingCartBar } from '@/components/site/FloatingCartBar'
import { useSiteCartStore } from '@/stores/site-cart-store'
import type { MenuItemData } from '@/components/site/MenuItemCard'

interface MenuCategory {
  id: string
  name: string
  categoryType: string
  items: MenuItemData[]
}

interface OnlineOrderClientProps {
  categories: MenuCategory[]
  slug: string
  locationName: string
}

export function OnlineOrderClient({ categories, slug, locationName }: OnlineOrderClientProps) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const addItem = useSiteCartStore((s) => s.addItem)
  const setSlug = useSiteCartStore((s) => s.setSlug)

  useEffect(() => {
    setMounted(true)
    setSlug(slug)
  }, [slug, setSlug])

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

  return (
    <>
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900 truncate">{locationName}</h1>
          <span className="text-xs text-gray-400 hidden sm:block">Online Ordering</span>
        </div>
      </header>

      {/* Menu */}
      <div className="max-w-5xl mx-auto">
        <MenuBrowse
          categories={categories}
          onItemSelect={handleItemSelect}
        />
      </div>

      {/* Item Detail Sheet */}
      {selectedItemId && (
        <MenuItemSheet
          itemId={selectedItemId}
          slug={slug}
          onClose={handleCloseSheet}
          onAdd={handleAddToCart}
        />
      )}

      {/* Floating Cart Bar */}
      {mounted && <FloatingCartBar />}
    </>
  )
}
