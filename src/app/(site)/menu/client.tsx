'use client'

/**
 * MenuPageClient — Client boundary for the menu page.
 *
 * Wires MenuBrowse with item selection. When an item is tapped,
 * opens the item detail sheet (MenuItemSheet) and handles add-to-cart.
 */

import { useState, useCallback } from 'react'
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

export function MenuPageClient({ categories, slug }: MenuPageClientProps) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const addItem = useSiteCartStore((s) => s.addItem)

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
      <MenuBrowse
        categories={categories}
        onItemSelect={handleItemSelect}
      />

      {selectedItemId && (
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
