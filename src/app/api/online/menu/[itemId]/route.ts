/**
 * Public Online Menu Item Detail API
 *
 * GET /api/online/menu/[itemId]?slug=xxx
 *   Returns full item detail including recursive modifier groups and pizza config.
 *   No authentication required — this is a public endpoint.
 *
 * Cache: public, s-maxage=60, stale-while-revalidate=30
 * Varies by x-venue-slug header for CDN isolation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDbForVenue } from '@/lib/db'
import { getStockStatus } from '@/lib/online-availability'
import { PrismaClient } from '@/generated/prisma/client'
import { checkOnlineRateLimit } from '@/lib/online-rate-limiter'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ModifierOptionResult {
  id: string
  name: string
  price: number
  priceType: string
  isDefault: boolean
  allowNo: boolean
  allowLite: boolean
  allowOnSide: boolean
  allowExtra: boolean
  extraPrice: number
  swapEnabled: boolean
  swapTargets: unknown
  childModifierGroup: ModifierGroupResult | null
}

interface ModifierGroupResult {
  id: string
  name: string
  minSelections: number
  maxSelections: number
  isRequired: boolean
  allowStacking: boolean
  allowNone: boolean
  allowOpenEntry: boolean
  autoAdvance: boolean
  tieredPricingConfig: unknown
  exclusionGroupKey: string | null
  options: ModifierOptionResult[]
}

// ── Recursive Modifier Expansion ──────────────────────────────────────────────

const MAX_MODIFIER_DEPTH = 5

/**
 * Recursively expand a modifier group and its child groups.
 * Tracks visited groupIds to prevent infinite cycles.
 */
async function expandModifierGroup(
  venueDb: PrismaClient,
  groupId: string,
  depth: number,
  visited: Set<string>
): Promise<ModifierGroupResult | null> {
  if (depth > MAX_MODIFIER_DEPTH) return null
  if (visited.has(groupId)) return null
  visited.add(groupId)

  const group = await venueDb.modifierGroup.findFirst({
    where: {
      id: groupId,
      showOnline: true,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      displayName: true,
      minSelections: true,
      maxSelections: true,
      isRequired: true,
      allowStacking: true,
      allowNone: true,
      allowOpenEntry: true,
      autoAdvance: true,
      tieredPricingConfig: true,
      exclusionGroupKey: true,
      modifiers: {
        where: { isActive: true, showOnline: true, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          name: true,
          displayName: true,
          price: true,
          priceType: true,
          isDefault: true,
          allowNo: true,
          allowLite: true,
          allowOnSide: true,
          allowExtra: true,
          extraPrice: true,
          swapEnabled: true,
          swapTargets: true,
          childModifierGroupId: true,
        },
      },
    },
  })

  if (!group) return null

  // Expand child modifier groups for each modifier that has one
  const options: ModifierOptionResult[] = await Promise.all(
    group.modifiers.map(async (mod): Promise<ModifierOptionResult> => {
      let childGroup: ModifierGroupResult | null = null
      if (mod.childModifierGroupId) {
        childGroup = await expandModifierGroup(
          venueDb,
          mod.childModifierGroupId,
          depth + 1,
          visited
        )
      }

      return {
        id: mod.id,
        name: mod.displayName ?? mod.name,
        price: Number(mod.price),
        priceType: mod.priceType,
        isDefault: mod.isDefault,
        allowNo: mod.allowNo,
        allowLite: mod.allowLite,
        allowOnSide: mod.allowOnSide,
        allowExtra: mod.allowExtra,
        extraPrice: Number(mod.extraPrice),
        swapEnabled: mod.swapEnabled,
        swapTargets: mod.swapTargets,
        childModifierGroup: childGroup,
      }
    })
  )

  return {
    id: group.id,
    name: group.displayName ?? group.name,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections,
    isRequired: group.isRequired,
    allowStacking: group.allowStacking,
    allowNone: group.allowNone,
    allowOpenEntry: group.allowOpenEntry,
    autoAdvance: group.autoAdvance,
    tieredPricingConfig: group.tieredPricingConfig,
    exclusionGroupKey: group.exclusionGroupKey,
    options,
  }
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const { itemId } = await params
    const { searchParams } = request.nextUrl
    const slug = searchParams.get('slug')

    if (!slug) {
      return NextResponse.json(
        { error: 'slug query parameter is required' },
        { status: 400 }
      )
    }

    // ── Rate limit ────────────────────────────────────────────────────────────
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown'

    const rateCheck = checkOnlineRateLimit(ip, slug, 'menu')
    if (!rateCheck.allowed) {
      const resp = NextResponse.json(
        { error: 'Too many requests. Please try again shortly.' },
        { status: 429 }
      )
      resp.headers.set('Retry-After', String(rateCheck.retryAfterSeconds ?? 60))
      return resp
    }

    const venueDb = await getDbForVenue(slug)

    // Fetch the menu item with owned modifier groups
    const item = await venueDb.menuItem.findFirst({
      where: {
        id: itemId,
        isActive: true,
        showOnline: true,
        deletedAt: null,
      },
      select: {
        id: true,
        locationId: true,
        name: true,
        displayName: true,
        description: true,
        price: true,
        onlinePrice: true,
        imageUrl: true,
        itemType: true,
        allergens: true,
        trackInventory: true,
        currentStock: true,
        lowStockAlert: true,
        isAvailable: true,
        ownedModifierGroups: {
          where: { showOnline: true, deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          select: { id: true },
        },
        pizzaSpecialty: {
          select: {
            defaultCrustId: true,
            defaultSauceId: true,
            defaultCheeseId: true,
            sauceAmount: true,
            cheeseAmount: true,
            toppings: true,
            allowSizeChange: true,
            allowCrustChange: true,
            allowSauceChange: true,
            allowCheeseChange: true,
            allowToppingMods: true,
          },
        },
      },
    })

    if (!item) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 }
      )
    }

    // ── Expand modifier groups recursively ──────────────────────────────────
    const modifierGroups: ModifierGroupResult[] = []
    for (const mg of item.ownedModifierGroups) {
      const expanded = await expandModifierGroup(venueDb, mg.id, 1, new Set())
      if (expanded && expanded.options.length > 0) {
        modifierGroups.push(expanded)
      }
    }

    // ── Build base response ─────────────────────────────────────────────────
    const response: Record<string, unknown> = {
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
      allergens: item.allergens,
      modifierGroups,
    }

    // ── Pizza-specific data ─────────────────────────────────────────────────
    if (item.itemType === 'pizza') {
      const locationId = item.locationId

      const [pizzaConfig, pizzaSizes, pizzaCrusts, pizzaSauces, pizzaCheeses, pizzaToppings] =
        await Promise.all([
          venueDb.pizzaConfig.findFirst({
            where: { locationId },
            select: {
              maxSections: true,
              defaultSections: true,
              sectionOptions: true,
              pricingMode: true,
              hybridPricing: true,
              freeToppingsEnabled: true,
              freeToppingsCount: true,
              freeToppingsMode: true,
              extraToppingPrice: true,
              showVisualBuilder: true,
              showToppingList: true,
              defaultToListView: true,
              builderMode: true,
              defaultBuilderMode: true,
              allowModeSwitch: true,
              allowCondimentSections: true,
              condimentDivisionMax: true,
            },
          }),
          venueDb.pizzaSize.findMany({
            where: { locationId, isActive: true, deletedAt: null },
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true,
              name: true,
              displayName: true,
              inches: true,
              slices: true,
              basePrice: true,
              toppingMultiplier: true,
              freeToppings: true,
              isDefault: true,
              sortOrder: true,
            },
          }),
          venueDb.pizzaCrust.findMany({
            where: { locationId, isActive: true, deletedAt: null },
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true,
              name: true,
              displayName: true,
              description: true,
              price: true,
              isDefault: true,
              sortOrder: true,
            },
          }),
          venueDb.pizzaSauce.findMany({
            where: { locationId, isActive: true, deletedAt: null },
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true,
              name: true,
              displayName: true,
              description: true,
              price: true,
              allowLight: true,
              allowExtra: true,
              extraPrice: true,
              isDefault: true,
              sortOrder: true,
            },
          }),
          venueDb.pizzaCheese.findMany({
            where: { locationId, isActive: true, deletedAt: null },
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true,
              name: true,
              displayName: true,
              description: true,
              price: true,
              allowLight: true,
              allowExtra: true,
              extraPrice: true,
              isDefault: true,
              sortOrder: true,
            },
          }),
          venueDb.pizzaTopping.findMany({
            where: { locationId, isActive: true, deletedAt: null },
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true,
              name: true,
              displayName: true,
              category: true,
              price: true,
              extraPrice: true,
              color: true,
              iconUrl: true,
              sortOrder: true,
            },
          }),
        ])

      if (pizzaConfig) {
        response.pizzaConfig = {
          ...pizzaConfig,
          extraToppingPrice: pizzaConfig.extraToppingPrice != null
            ? Number(pizzaConfig.extraToppingPrice)
            : null,
        }
      }

      response.pizzaSizes = pizzaSizes.map(s => ({
        id: s.id,
        name: s.displayName ?? s.name,
        inches: s.inches,
        slices: s.slices,
        basePrice: Number(s.basePrice),
        toppingMultiplier: Number(s.toppingMultiplier),
        freeToppings: s.freeToppings,
        isDefault: s.isDefault,
        isActive: true as const,
        sortOrder: s.sortOrder ?? 0,
      }))

      response.pizzaCrusts = pizzaCrusts.map(c => ({
        id: c.id,
        name: c.displayName ?? c.name,
        description: c.description,
        price: Number(c.price),
        isDefault: c.isDefault,
        isActive: true as const,
        sortOrder: c.sortOrder ?? 0,
      }))

      response.pizzaSauces = pizzaSauces.map(s => ({
        id: s.id,
        name: s.displayName ?? s.name,
        description: s.description,
        price: Number(s.price),
        allowLight: s.allowLight,
        allowExtra: s.allowExtra,
        extraPrice: Number(s.extraPrice),
        isDefault: s.isDefault,
        isActive: true as const,
        sortOrder: s.sortOrder ?? 0,
      }))

      response.pizzaCheeses = pizzaCheeses.map(c => ({
        id: c.id,
        name: c.displayName ?? c.name,
        description: c.description,
        price: Number(c.price),
        allowLight: c.allowLight,
        allowExtra: c.allowExtra,
        extraPrice: Number(c.extraPrice),
        isDefault: c.isDefault,
        isActive: true as const,
        sortOrder: c.sortOrder ?? 0,
      }))

      response.pizzaToppings = pizzaToppings.map(t => ({
        id: t.id,
        name: t.displayName ?? t.name,
        category: t.category,
        price: Number(t.price),
        extraPrice: t.extraPrice != null ? Number(t.extraPrice) : null,
        color: t.color,
        iconUrl: t.iconUrl,
        isActive: true as const,
        sortOrder: t.sortOrder ?? 0,
      }))

      response.pizzaSpecialty = item.pizzaSpecialty ?? null
    }

    // ── Cache headers ───────────────────────────────────────────────────────
    const res = NextResponse.json({ data: response })
    res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30')
    res.headers.set('Vary', 'x-venue-slug')
    return res
  } catch (error) {
    console.error('[GET /api/online/menu/[itemId]] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch item detail' },
      { status: 500 }
    )
  }
}
