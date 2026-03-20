/**
 * Public Menu API for QR Ordering
 *
 * GET /api/public/menu?slug=venue-slug&categoryIds=id1,id2
 *
 * No authentication required. Returns active menu items suitable
 * for customer-facing QR ordering.
 *
 * Rate limited: 30 requests per minute per IP.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDbForVenue } from '@/lib/db'

// ── Simple in-memory rate limiter ───────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 30
const RATE_WINDOW_MS = 60_000

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }

  if (entry.count >= RATE_LIMIT) return false
  entry.count++
  return true
}

// Periodic cleanup (every 5 minutes, remove stale entries)
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of rateLimitMap) {
    if (now > val.resetAt) rateLimitMap.delete(key)
  }
}, 300_000)

export async function GET(request: NextRequest) {
  try {
    // Rate limit
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown'

    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      )
    }

    const { searchParams } = request.nextUrl
    const slug = searchParams.get('slug')
    const categoryIds = searchParams.get('categoryIds')?.split(',').filter(Boolean) || []

    if (!slug) {
      return NextResponse.json({ error: 'slug query parameter is required' }, { status: 400 })
    }

    // Resolve venue DB
    let venueDb
    try {
      venueDb = await getDbForVenue(slug)
    } catch {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    // Get location + settings
    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: { id: true, name: true, settings: true },
    })

    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    // Check QR ordering enabled
    const settings = location.settings as Record<string, unknown> | null
    const qrSettings = settings?.qrOrdering as Record<string, unknown> | null | undefined
    if (qrSettings?.enabled === false) {
      return NextResponse.json({ error: 'QR ordering is not available at this location' }, { status: 403 })
    }

    const showPrices = qrSettings?.showPrices !== false
    const menuCategoryFilter = (qrSettings?.menuCategoryFilter as string[]) || []

    // Build category filter
    const categoryWhere: Record<string, unknown> = {
      locationId: location.id,
      isActive: true,
      deletedAt: null,
    }

    // Apply category filter: explicit request > settings filter > all
    if (categoryIds.length > 0) {
      categoryWhere.id = { in: categoryIds }
    } else if (menuCategoryFilter.length > 0) {
      categoryWhere.id = { in: menuCategoryFilter }
    }

    // Fetch categories and items in parallel
    const [categories, menuItems] = await Promise.all([
      venueDb.category.findMany({
        where: categoryWhere,
        select: {
          id: true,
          name: true,
          sortOrder: true,
        },
        orderBy: { sortOrder: 'asc' },
      }),
      venueDb.menuItem.findMany({
        where: {
          locationId: location.id,
          isActive: true,
          showOnline: true,
          deletedAt: null,
          isAvailable: true,
          ...(categoryIds.length > 0
            ? { categoryId: { in: categoryIds } }
            : menuCategoryFilter.length > 0
              ? { categoryId: { in: menuCategoryFilter } }
              : {}),
        },
        include: {
          ownedModifierGroups: {
            where: { deletedAt: null },
            orderBy: { sortOrder: 'asc' },
            include: {
              modifiers: {
                where: { isActive: true, deletedAt: null },
                select: {
                  id: true,
                  name: true,
                  price: true,
                },
                orderBy: { sortOrder: 'asc' },
              },
            },
          },
        },
        orderBy: { sortOrder: 'asc' },
      }),
    ])

    // Group items by categoryId
    const itemsByCategory = new Map<string, typeof menuItems>()
    for (const item of menuItems) {
      const list = itemsByCategory.get(item.categoryId) || []
      list.push(item)
      itemsByCategory.set(item.categoryId, list)
    }

    // Build public menu response
    const publicMenu = categories
      .filter(cat => {
        const items = itemsByCategory.get(cat.id)
        return items && items.length > 0
      })
      .map(cat => {
        const items = itemsByCategory.get(cat.id) || []
        return {
          id: cat.id,
          name: cat.name,
          sortOrder: cat.sortOrder,
          items: items.map(item => ({
            id: item.id,
            name: item.name,
            description: item.description,
            price: showPrices ? Number(item.onlinePrice ?? item.price) : undefined,
            imageUrl: item.imageUrl,
            inStock: item.currentStock === null || item.currentStock > 0,
            modifierGroups: item.ownedModifierGroups.map(mg => ({
              id: mg.id,
              name: mg.name,
              required: mg.isRequired,
              minSelections: mg.minSelections,
              maxSelections: mg.maxSelections,
              modifiers: mg.modifiers.map(mod => ({
                id: mod.id,
                name: mod.name,
                price: showPrices ? Number(mod.price) : undefined,
              })),
            })),
          })),
        }
      })

    return NextResponse.json({
      locationName: location.name,
      categories: publicMenu,
    })
  } catch (error) {
    console.error('[GET /api/public/menu] Error:', error)
    return NextResponse.json({ error: 'Failed to load menu' }, { status: 500 })
  }
}
