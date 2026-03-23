'use client'

/**
 * MenuPageClient — Client boundary for the menu page.
 *
 * Wires MenuBrowse with item selection. When an item is tapped,
 * opens the item detail sheet (MenuItemSheet, added in Task #4).
 * For now, stores selectedItemId in state for the sheet to consume.
 */

import { useState, useCallback } from 'react'
import { MenuBrowse } from '@/components/site/MenuBrowse'
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

  const handleItemSelect = useCallback((itemId: string) => {
    setSelectedItemId(itemId)
  }, [])

  const handleCloseSheet = useCallback(() => {
    setSelectedItemId(null)
  }, [])

  return (
    <>
      <MenuBrowse
        categories={categories}
        onItemSelect={handleItemSelect}
      />

      {/* Item detail sheet — Task #4 will add MenuItemSheet here */}
      {/* {selectedItemId && (
        <MenuItemSheet
          itemId={selectedItemId}
          slug={slug}
          onClose={handleCloseSheet}
        />
      )} */}
    </>
  )
}
