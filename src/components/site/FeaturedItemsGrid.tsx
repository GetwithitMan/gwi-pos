'use client'

/**
 * FeaturedItemsGrid — Client wrapper for homepage featured items.
 *
 * Renders MenuItemCard components in a responsive grid.
 * Tapping any card navigates to the menu page.
 */

import { useRouter } from 'next/navigation'
import { MenuItemCard } from '@/components/site/MenuItemCard'
import type { MenuItemData } from '@/components/site/MenuItemCard'

interface FeaturedItemsGridProps {
  items: MenuItemData[]
}

export function FeaturedItemsGrid({ items }: FeaturedItemsGridProps) {
  const router = useRouter()

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
      {items.map((item) => (
        <MenuItemCard
          key={item.id}
          item={item}
          onSelect={() => router.push('/menu')}
        />
      ))}
    </div>
  )
}
