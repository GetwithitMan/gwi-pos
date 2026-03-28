/**
 * GET /api/public/cake-order/[slug]/config — Public cake ordering configuration
 *
 * No authentication. Resolves venue by slug. Returns menu items in the
 * configured cake categories with modifier groups and modifiers.
 *
 * Rate limited: 30 requests per minute per IP.
 * Cache-Control: public, max-age=60, stale-while-revalidate=300
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDbForVenue } from '@/lib/db'
import { createRateLimiter } from '@/lib/rate-limiter'
import { getClientIp } from '@/lib/get-client-ip'
import { DEFAULT_CAKE_ORDERING, type CakeOrderingSettings } from '@/lib/settings'

export const dynamic = 'force-dynamic'

const limiter = createRateLimiter({ maxAttempts: 30, windowMs: 60_000 })

export async function GET(
  request: NextRequest,
  context: any,
) {
  try {
    const { slug } = (await context.params) as { slug: string }

    if (!slug) {
      return NextResponse.json({ error: 'Venue slug is required' }, { status: 400 })
    }

    // ── Rate limit ─────────────────────────────────────────────────────
    const ip = getClientIp(request)

    const rl = limiter.check(`cake-config:${ip}`)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      )
    }

    // ── Resolve venue DB ───────────────────────────────────────────────
    let venueDb
    try {
      venueDb = await getDbForVenue(slug)
    } catch {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    // ── Get location + settings ────────────────────────────────────────
    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: { id: true, name: true, settings: true },
    })

    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    const settings = location.settings as Record<string, unknown> | null
    const cakeRaw = settings?.cakeOrdering as Partial<CakeOrderingSettings> | null | undefined
    const cakeSettings: CakeOrderingSettings = cakeRaw
      ? { ...DEFAULT_CAKE_ORDERING, ...cakeRaw }
      : DEFAULT_CAKE_ORDERING

    // ── Check cake ordering enabled + public ordering ──────────────────
    if (!cakeSettings.enabled) {
      return NextResponse.json(
        { error: 'Cake ordering is not available at this location' },
        { status: 403 },
      )
    }

    if (!cakeSettings.allowPublicOrdering) {
      return NextResponse.json(
        { error: 'Online cake ordering is not available at this location' },
        { status: 403 },
      )
    }

    // ── Query menu items in cake categories ────────────────────────────
    const cakeCategoryIds = cakeSettings.cakeCategoryIds
    if (!cakeCategoryIds || cakeCategoryIds.length === 0) {
      return NextResponse.json(
        {
          available: false,
          locationName: location.name,
          categories: [],
          availabilityRules: buildAvailabilityRules(cakeSettings),
        },
        {
          status: 200,
          headers: {
            'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
          },
        },
      )
    }

    // Fetch categories and items in parallel
    const [categories, menuItems] = await Promise.all([
      venueDb.category.findMany({
        where: {
          id: { in: cakeCategoryIds },
          locationId: location.id,
          isActive: true,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          sortOrder: true,
        },
        orderBy: { sortOrder: 'asc' },
      }),
      venueDb.menuItem.findMany({
        where: {
          categoryId: { in: cakeCategoryIds },
          locationId: location.id,
          isActive: true,
          deletedAt: null,
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
                  sortOrder: true,
                },
                orderBy: { sortOrder: 'asc' },
              },
            },
          },
        },
        orderBy: { sortOrder: 'asc' },
      }),
    ])

    // ── Group items by category ────────────────────────────────────────
    const itemsByCategory = new Map<string, typeof menuItems>()
    for (const item of menuItems) {
      const list = itemsByCategory.get(item.categoryId) || []
      list.push(item)
      itemsByCategory.set(item.categoryId, list)
    }

    // ── Build public response ──────────────────────────────────────────
    const publicCategories = categories
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
            price: Number(item.price),
            imageUrl: item.imageUrl,
            modifierGroups: item.ownedModifierGroups.map(mg => ({
              id: mg.id,
              name: mg.name,
              required: mg.isRequired,
              minSelections: mg.minSelections,
              maxSelections: mg.maxSelections,
              modifiers: mg.modifiers.map(mod => ({
                id: mod.id,
                name: mod.name,
                price: Number(mod.price),
              })),
            })),
          })),
        }
      })

    const response = NextResponse.json({
      available: true,
      locationName: location.name,
      categories: publicCategories,
      availabilityRules: buildAvailabilityRules(cakeSettings),
    })

    response.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
    return response
  } catch (error) {
    console.error('[GET /api/public/cake-order/[slug]/config] Error:', error)
    return NextResponse.json({ error: 'Failed to load cake ordering configuration' }, { status: 500 })
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildAvailabilityRules(settings: CakeOrderingSettings) {
  return {
    minimumLeadTimeHours: settings.minimumLeadTimeHours,
    hardMinimumLeadTimeHours: settings.hardMinimumLeadTimeHours,
    maxCapacityPerDay: settings.maxCapacityPerDay,
    deliveryEnabled: settings.deliveryEnabled,
    deliveryMaxMiles: settings.deliveryMaxMiles,
    requireDeposit: settings.requireDeposit,
    depositPercent: settings.depositPercent,
    rushFeeDays: settings.rushFeeDays,
    rushFeeAmount: settings.rushFeeAmount,
    messageChargeAmount: settings.messageChargeAmount,
  }
}
