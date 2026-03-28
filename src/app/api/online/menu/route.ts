/**
 * Public Online Menu API — Lightweight Browse
 *
 * GET /api/online/menu?slug=xxx          (preferred — resolves locationId)
 * GET /api/online/menu?locationId=xxx    (legacy — direct locationId)
 *
 *   Returns active, online-orderable menu items grouped by category.
 *   No authentication required — this is a public endpoint.
 *   Modifier groups are NOT included — use GET /api/online/menu/[itemId] for detail.
 *
 * Security:
 *   - Rate limited per IP+location (BUG #388)
 *   - Online ordering must be enabled in location settings (BUG #394)
 *   - Soft-deleted categories and items filtered out (BUG #387)
 *   - onlinePrice returned when set (BUG #385)
 *
 * Architectural note:
 *   This route does NOT use withVenue() because it is a public route.
 *   In the multi-tenant model, withVenue() reads x-venue-slug set by
 *   proxy.ts (which only runs on authenticated routes). Instead,
 *   we accept slug or locationId in the query string. When slug is provided,
 *   we resolve the venue DB via getDbForVenue() and find the location automatically.
 *   The locationId filter provides sufficient tenant isolation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db, getDbForVenue } from '@/lib/db'
import { computeIsOrderableOnline, getStockStatus } from '@/lib/online-availability'
import { checkOnlineRateLimit } from '@/lib/online-rate-limiter'
import { getClientIp } from '@/lib/get-client-ip'
import { err, notFound, ok } from '@/lib/api-response'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    let locationId = searchParams.get('locationId')
    const slug = searchParams.get('slug')

    if (!locationId && !slug) {
      return err('Either slug or locationId query parameter is required')
    }

    // Route to venue DB when slug is provided (cloud/Vercel multi-tenant).
    // Falls back to db proxy (NUC local mode where DATABASE_URL already points
    // to the venue database).
    const venueDb = slug ? await getDbForVenue(slug) : db

    // When slug is provided without locationId, resolve it from the venue DB
    if (!locationId && slug) {
      const loc = await venueDb.location.findFirst({
        where: { isActive: true, deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      })
      if (!loc) {
        return notFound('Venue not found')
      }
      locationId = loc.id
    }

    // ── Rate limit (BUG #388) ───────────────────────────────────────────────
    const ip = getClientIp(request)

    const rateCheck = checkOnlineRateLimit(ip, locationId!, 'menu')
    if (!rateCheck.allowed) {
      const resp = NextResponse.json(
        { error: 'Too many requests. Please try again shortly.' },
        { status: 429 }
      )
      resp.headers.set('Retry-After', String(rateCheck.retryAfterSeconds ?? 60))
      return resp
    }

    // ── Check online ordering is enabled (BUG #394) ─────────────────────────
    const locationRec = await venueDb.location.findFirst({
      where: { id: locationId!, deletedAt: null },
      select: { settings: true },
    })
    const locSettings = locationRec?.settings as Record<string, unknown> | null
    const onlineSettings = locSettings?.onlineOrdering as Record<string, unknown> | null

    if (!onlineSettings?.enabled) {
      return err('Online ordering is not currently available', 503)
    }

    // Fetch all active categories that are shown online for this location
    // BUG #387: filter deletedAt: null on categories and items
    // Lightweight browse — no modifierGroups (moved to item detail endpoint)
    const categories = await venueDb.category.findMany({
      where: {
        locationId: locationId!,
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
        sortOrder: true,
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

    // Filter items by online availability using computeIsOrderableOnline()
    const now = new Date()
    const result = categories
      .map(category => {
        const orderableItems = category.menuItems.filter(item =>
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
          items: orderableItems.map(item => ({
            id: item.id,
            name: item.displayName ?? item.name,
            description: item.description,
            // BUG #385: Return onlinePrice when set, otherwise base price
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
      // Exclude categories with no orderable items
      .filter(cat => cat.items.length > 0)

    return ok({ categories: result })
  } catch (error) {
    console.error('[GET /api/online/menu] Error:', error)
    return err('Failed to fetch online menu', 500)
  }
}
