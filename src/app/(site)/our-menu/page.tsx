/**
 * Menu Page — Server component that fetches lightweight menu data
 * and renders the client-side menu browse experience.
 *
 * Reads x-venue-slug from proxy headers, fetches categories + items
 * directly from venue DB (no HTTP hop), passes to MenuPageClient.
 */

import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { getDbForVenue } from '@/lib/db'
import { computeIsOrderableOnline, getStockStatus } from '@/lib/online-availability'
import { MenuBrowseSkeleton } from '@/components/site/MenuBrowse'
import { MenuPageClient } from './client'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Menu',
}

async function fetchMenuData(slug: string) {
  const venueDb = await getDbForVenue(slug)

  // Resolve location
  const location = await venueDb.location.findFirst({
    where: { isActive: true, deletedAt: null },
    select: { id: true, settings: true },
    orderBy: { createdAt: 'asc' },
  })

  if (!location) return null

  // Check if online ordering is enabled
  const locSettings = location.settings as Record<string, unknown> | null
  const onlineSettings = locSettings?.onlineOrdering as Record<string, unknown> | null
  if (!onlineSettings?.enabled) return 'disabled'

  // Fetch lightweight browse data (same shape as /api/online/menu)
  const categories = await venueDb.category.findMany({
    where: {
      locationId: location.id,
      isActive: true,
      showOnline: true,
      deletedAt: null,
    },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      name: true,
      displayName: true,
      categoryType: true,
      menuItems: {
        where: {
          isActive: true,
          showOnline: true,
          deletedAt: null,
        },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          name: true,
          displayName: true,
          description: true,
          price: true,
          onlinePrice: true,
          imageUrl: true,
          itemType: true,
          showOnline: true,
          isAvailable: true,
          availableFrom: true,
          availableTo: true,
          availableDays: true,
          trackInventory: true,
          currentStock: true,
          lowStockAlert: true,
        },
      },
    },
  })

  const now = new Date()
  return categories
    .map((category) => {
      const orderableItems = category.menuItems.filter((item) =>
        computeIsOrderableOnline(
          {
            showOnline: item.showOnline,
            isAvailable: item.isAvailable,
            availableFrom: item.availableFrom,
            availableTo: item.availableTo,
            availableDays: item.availableDays,
            currentStock: item.currentStock,
            trackInventory: item.trackInventory,
            lowStockAlert: item.lowStockAlert,
          },
          now
        )
      )

      return {
        id: category.id,
        name: category.displayName ?? category.name,
        categoryType: category.categoryType,
        items: orderableItems.map((item) => ({
          id: item.id,
          name: item.displayName ?? item.name,
          description: item.description,
          price: item.onlinePrice != null ? Number(item.onlinePrice) : Number(item.price),
          imageUrl: item.imageUrl,
          stockStatus: getStockStatus({
            trackInventory: item.trackInventory,
            currentStock: item.currentStock,
            lowStockAlert: item.lowStockAlert,
            isAvailable: item.isAvailable,
          }),
          itemType: item.itemType,
        })),
      }
    })
    .filter((cat) => cat.items.length > 0)
}

export default async function MenuPage() {
  const headersList = await headers()
  const slug = headersList.get('x-venue-slug')

  if (!slug) notFound()

  let result: Awaited<ReturnType<typeof fetchMenuData>>
  try {
    result = await fetchMenuData(slug)
  } catch {
    notFound()
  }

  // Venue not found
  if (result === null) notFound()

  // Online ordering disabled
  if (result === 'disabled') {
    return (
      <div className="flex items-center justify-center py-24 px-6">
        <div className="text-center">
          <h1
            className="text-2xl mb-2"
            style={{
              fontFamily: 'var(--site-heading-font)',
              fontWeight: 'var(--site-heading-weight, 700)',
              color: 'var(--site-text)',
            }}
          >
            Menu Unavailable
          </h1>
          <p style={{ color: 'var(--site-text-muted)' }}>
            Online ordering is not currently available. Please check back later.
          </p>
        </div>
      </div>
    )
  }

  // Empty menu
  if (result.length === 0) {
    return (
      <div className="flex items-center justify-center py-24 px-6">
        <div className="text-center">
          <h1
            className="text-2xl mb-2"
            style={{
              fontFamily: 'var(--site-heading-font)',
              fontWeight: 'var(--site-heading-weight, 700)',
              color: 'var(--site-text)',
            }}
          >
            Menu
          </h1>
          <p style={{ color: 'var(--site-text-muted)' }}>
            No items are currently available. Please check back later.
          </p>
        </div>
      </div>
    )
  }

  return (
    <Suspense fallback={<MenuBrowseSkeleton />}>
      <MenuPageClient categories={result} slug={slug} />
    </Suspense>
  )
}
