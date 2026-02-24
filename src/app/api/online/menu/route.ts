/**
 * Public Online Menu API
 *
 * GET /api/online/menu?locationId=xxx
 *   Returns active, online-orderable menu items grouped by category.
 *   No authentication required — this is a public endpoint.
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
 *   middleware.ts (which only runs on authenticated routes). Instead,
 *   we accept locationId directly in the query string and use the db
 *   proxy with the masterClient context — which works for local dev and
 *   single-tenant NUC deployments. The locationId filter provides
 *   sufficient tenant isolation for the public menu endpoint.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db, getDbForVenue } from '@/lib/db'
import { computeIsOrderableOnline, getStockStatus } from '@/lib/online-availability'
import { checkOnlineRateLimit } from '@/lib/online-rate-limiter'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const locationId = searchParams.get('locationId')
    const slug = searchParams.get('slug')

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId query parameter is required' },
        { status: 400 }
      )
    }

    // ── Rate limit (BUG #388) ───────────────────────────────────────────────
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown'

    const rateCheck = checkOnlineRateLimit(ip, locationId, 'menu')
    if (!rateCheck.allowed) {
      const resp = NextResponse.json(
        { error: 'Too many requests. Please try again shortly.' },
        { status: 429 }
      )
      resp.headers.set('Retry-After', String(rateCheck.retryAfterSeconds ?? 60))
      return resp
    }

    // Route to venue DB when slug is provided (cloud/Vercel multi-tenant).
    // Falls back to db proxy (NUC local mode where DATABASE_URL already points
    // to the venue database).
    const venueDb = slug ? getDbForVenue(slug) : db

    // ── Check online ordering is enabled (BUG #394) ─────────────────────────
    const locationRec = await venueDb.location.findFirst({
      where: { id: locationId },
      select: { settings: true },
    })
    const locSettings = locationRec?.settings as Record<string, unknown> | null
    const onlineSettings = locSettings?.onlineOrdering as Record<string, unknown> | null

    if (!onlineSettings?.enabled) {
      return NextResponse.json(
        { error: 'Online ordering is not currently available' },
        { status: 503 }
      )
    }

    // Fetch all active categories that are shown online for this location
    // BUG #387: filter deletedAt: null on categories and items
    const categories = await venueDb.category.findMany({
      where: {
        locationId,
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
            showOnline: true,
            isAvailable: true,
            availableFrom: true,
            availableTo: true,
            availableDays: true,
            trackInventory: true,
            currentStock: true,
            lowStockAlert: true,
            // Modifier groups via direct ownership (ownedModifierGroups)
            ownedModifierGroups: {
              where: { deletedAt: null, showOnline: true },
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                name: true,
                displayName: true,
                minSelections: true,
                maxSelections: true,
                isRequired: true,
                allowStacking: true,
                sortOrder: true,
                modifiers: {
                  where: { isActive: true, showOnline: true, deletedAt: null },
                  orderBy: { sortOrder: 'asc' },
                  select: {
                    id: true,
                    name: true,
                    displayName: true,
                    price: true,
                  },
                },
              },
            },
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
            modifierGroups: item.ownedModifierGroups
              .filter(mg => mg.modifiers.length > 0)
              .map(mg => ({
                id: mg.id,
                name: mg.displayName ?? mg.name,
                minSelections: mg.minSelections,
                maxSelections: mg.maxSelections,
                isRequired: mg.isRequired,
                allowStacking: mg.allowStacking,
                options: mg.modifiers.map(mod => ({
                  id: mod.id,
                  name: mod.displayName ?? mod.name,
                  price: Number(mod.price),
                })),
              })),
          })),
        }
      })
      // Exclude categories with no orderable items
      .filter(cat => cat.items.length > 0)

    return NextResponse.json({ data: { categories: result } })
  } catch (error) {
    console.error('[GET /api/online/menu] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch online menu' },
      { status: 500 }
    )
  }
}
