/**
 * Online Ordering Page — Dynamic Route
 *
 * Serves customer-facing online ordering at:
 *   ordercontrolcenter.com/{orderCode}/{slug}
 *
 * This is a server component that resolves the venue by slug (set by proxy
 * in x-venue-slug header), fetches the menu, and renders the new ordering
 * components (MenuBrowse + MenuItemSheet + FloatingCartBar).
 *
 * The checkout flow is at /{orderCode}/{slug}/checkout.
 */

import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { getDbForVenue } from '@/lib/db'
import { computeIsOrderableOnline, getStockStatus } from '@/lib/online-availability'
import { MenuBrowseSkeleton } from '@/components/site/MenuBrowse'
import { OnlineOrderClient } from './client'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const readable = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  return {
    title: `Order from ${readable}`,
    description: `Order online from ${readable}. Browse our menu, customize your order, and pay securely.`,
  }
}

async function fetchMenuData(slug: string) {
  const venueDb = await getDbForVenue(slug)

  const location = await venueDb.location.findFirst({
    where: { isActive: true, deletedAt: null },
    select: { id: true, name: true, settings: true },
    orderBy: { createdAt: 'asc' },
  })

  if (!location) return null

  const locSettings = location.settings as Record<string, unknown> | null
  const onlineSettings = locSettings?.onlineOrdering as Record<string, unknown> | null

  // Allow ordering if not explicitly disabled (backward compat)
  if (onlineSettings?.enabled === false) return 'disabled'

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
  const menuCategories = categories
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

  return { categories: menuCategories, locationName: location.name }
}

export default async function OnlineOrderPage({ params }: { params: Promise<{ orderCode: string; slug: string }> }) {
  const { slug } = await params
  const headersList = await headers()
  const venueSlug = headersList.get('x-venue-slug') || slug

  let result: Awaited<ReturnType<typeof fetchMenuData>>
  try {
    result = await fetchMenuData(venueSlug)
  } catch {
    notFound()
  }

  if (result === null) notFound()

  if (result === 'disabled') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center border border-gray-200 shadow-lg">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Online Ordering Unavailable</h1>
          <p className="text-gray-500">This restaurant is not currently accepting online orders. Please check back later.</p>
        </div>
      </div>
    )
  }

  if (result.categories.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center border border-gray-200 shadow-lg">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Menu</h1>
          <p className="text-gray-500">No items are currently available for online ordering.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Suspense fallback={<MenuBrowseSkeleton />}>
        <OnlineOrderClient
          categories={result.categories}
          slug={venueSlug}
          locationName={result.locationName}
        />
      </Suspense>
    </div>
  )
}
