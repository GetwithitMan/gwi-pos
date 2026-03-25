'use client'

/**
 * OnlineOrderClient — Client component for the orderCode/slug ordering page.
 *
 * Renders the full ordering experience: menu browse with item detail sheet,
 * floating cart bar, and cart drawer. Uses the same components as the (site)
 * route group but doesn't depend on the site layout/shell.
 */

import { useState, useCallback, useEffect } from 'react'
import { MenuBrowse } from '@/components/site/MenuBrowse'
import { MenuItemSheet } from '@/components/site/MenuItemSheet'
import { FloatingCartBar } from '@/components/site/FloatingCartBar'
import { useSiteCartStore } from '@/stores/site-cart-store'
import { useCartItemCount } from '@/stores/site-cart-store'
import type { MenuItemData } from '@/components/site/MenuItemCard'

/** Modern preset CSS variables — injected so the (site) components render correctly outside the site layout shell. */
const THEME_CSS = `
:root, [data-site-theme] {
  --site-bg: #ffffff;
  --site-bg-secondary: #f9fafb;
  --site-surface: #ffffff;
  --site-text: #111827;
  --site-text-muted: #6b7280;
  --site-text-on-brand: #ffffff;
  --site-border: #e5e7eb;
  --site-border-radius: 0.75rem;
  --site-shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --site-shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1);
  --site-shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.1);
  --site-heading-font: 'Inter', system-ui, -apple-system, sans-serif;
  --site-body-font: 'Inter', system-ui, sans-serif;
  --site-heading-weight: 700;
  --site-brand: #3B82F6;
  --site-brand-secondary: #3B82F6;
  --site-brand-rgb: 59,130,246;
  --site-brand-text: #ffffff;
  --site-primary: #3B82F6;
  --site-primary-light: rgba(59,130,246,0.1);
  --site-success: #16a34a;
  --site-section-padding: 4rem 1.5rem;
  --site-card-padding: 1.5rem;
  --site-hero-overlay: rgba(0,0,0,0.4);
  --site-hero-text: #ffffff;
  --site-hero-min-height: 28rem;
  --site-btn-radius: 0.5rem;
  --site-btn-font-weight: 600;
  --site-btn-text-transform: none;
  --site-radius: 1rem;
  --site-shadow: 0 1px 3px rgba(0,0,0,0.1);
  --site-card-bg: #f9fafb;
  --site-text-secondary: #6b7280;
}
`

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
  const cartCount = useCartItemCount()

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
      {/* Inject theme CSS variables so (site) components render correctly */}
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />

      <div data-site-theme="" style={{ backgroundColor: 'var(--site-bg)', color: 'var(--site-text)', minHeight: '100vh' }}>
        {/* Header */}
        <header
          className="sticky top-0 z-40 border-b"
          style={{
            backgroundColor: 'var(--site-surface)',
            borderColor: 'var(--site-border)',
            boxShadow: 'var(--site-shadow-sm)',
          }}
        >
          <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
            <h1
              className="text-lg truncate"
              style={{ fontFamily: 'var(--site-heading-font)', fontWeight: 'var(--site-heading-weight)' as unknown as number }}
            >
              {locationName}
            </h1>

            <div className="flex items-center gap-3">
              <span className="text-xs hidden sm:block" style={{ color: 'var(--site-text-muted)' }}>
                Online Ordering
              </span>
              {/* Cart badge */}
              {mounted && cartCount > 0 && (
                <div
                  className="relative flex items-center justify-center w-9 h-9 rounded-full"
                  style={{ backgroundColor: 'var(--site-primary-light)' }}
                >
                  <svg className="h-5 w-5" style={{ color: 'var(--site-primary)' }} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
                  </svg>
                  <span
                    className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold"
                    style={{ backgroundColor: 'var(--site-primary)', color: 'var(--site-text-on-brand)' }}
                  >
                    {cartCount}
                  </span>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Menu content */}
        <div className="max-w-6xl mx-auto px-4 pb-24">
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
      </div>
    </>
  )
}
