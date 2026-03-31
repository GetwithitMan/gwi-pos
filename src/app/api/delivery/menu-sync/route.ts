/**
 * Menu Sync — Push POS menu to third-party delivery platforms
 *
 * POST /api/delivery/menu-sync
 * Body: { locationId, employeeId, platform?: 'doordash' | 'ubereats' | 'grubhub' }
 *
 * If platform is provided, sync to that platform only. Otherwise sync to all enabled platforms.
 * Loads menu items, categories, and modifier groups from the POS database, converts to
 * MenuSyncItem[] format (prices in cents), and pushes to each platform via their client.
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { getPlatformClient, getActivePlatformClients } from '@/lib/delivery/clients/platform-registry'
import type { DeliveryPlatformId, MenuSyncItem, MenuSyncModifierGroup, MenuSyncResult } from '@/lib/delivery/clients/types'
import { err, ok } from '@/lib/api-response'

// ─── Delivery markup helpers ────────────────────────────────────────────────

function applyMarkup(priceInDollars: number, markupPercent: number, roundingRule: string): number {
  if (markupPercent <= 0 || priceInDollars <= 0) return priceInDollars
  const marked = priceInDollars * (1 + markupPercent / 100)
  return applyRounding(marked, roundingRule)
}

function applyRounding(price: number, rule: string): number {
  if (price <= 0) return Math.max(0, price)
  switch (rule) {
    case 'nearest_99': return Math.ceil(price) - 0.01
    case 'nearest_49': {
      // Round to nearest X.49 at or above the marked-up price
      const floored = Math.floor(price)
      const candidate = floored + 0.49
      return candidate >= price ? candidate : candidate + 1
    }
    case 'nearest_quarter': return Math.ceil(price * 4) / 4
    case 'round_up': return Math.ceil(price)
    default: return Math.round(price * 100) / 100
  }
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, employeeId, platform } = body as {
      locationId: string
      employeeId: string
      platform?: DeliveryPlatformId
    }

    if (!locationId) {
      return err('Location ID is required')
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_EDIT)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Load settings
    const settings = parseSettings(await getLocationSettings(locationId))

    // Determine which platform clients to sync to
    const clients: Array<{ platform: DeliveryPlatformId; client: NonNullable<ReturnType<typeof getPlatformClient>> }> = []

    if (platform) {
      const client = getPlatformClient(platform, settings)
      if (!client) {
        return err(`Platform "${platform}" is not enabled or credentials are missing`)
      }
      clients.push({ platform, client })
    } else {
      const activeClients = getActivePlatformClients(settings)
      if (!activeClients.length) {
        return err('No delivery platforms are enabled')
      }
      clients.push(...activeClients)
    }

    // Load categories
    const categories = await db.$queryRaw<Array<{ id: string; name: string }>>`SELECT id, name FROM "Category"
       WHERE "locationId" = ${locationId} AND "deletedAt" IS NULL`
    const categoryMap = new Map(categories.map(c => [c.id, c.name]))

    // Load active menu items
    const menuItems = await db.$queryRaw<Array<{
      id: string
      name: string
      description: string | null
      price: number | string
      categoryId: string
    }>>`SELECT id, name, description, price, "categoryId"
       FROM "MenuItem"
       WHERE "locationId" = ${locationId} AND "deletedAt" IS NULL AND "isActive" = true`

    // Load modifier groups + modifiers for all items in one query
    const modifierGroups = await db.$queryRaw<Array<{
      id: string
      name: string
      menuItemId: string | null
      minSelections: number
      maxSelections: number
    }>>`SELECT mg.id, mg.name, mg."menuItemId", mg."minSelections", mg."maxSelections"
       FROM "ModifierGroup" mg
       WHERE mg."locationId" = ${locationId} AND mg."deletedAt" IS NULL`

    const modifiers = await db.$queryRaw<Array<{
      id: string
      name: string
      price: number | string
      modifierGroupId: string
      isActive: boolean
    }>>`SELECT m.id, m.name, m.price, m."modifierGroupId", m."isActive"
       FROM "Modifier" m
       JOIN "ModifierGroup" mg ON mg.id = m."modifierGroupId"
       WHERE mg."locationId" = ${locationId} AND m."deletedAt" IS NULL`

    // Build modifier group map keyed by menuItemId
    const modsByGroup = new Map<string, typeof modifiers>()
    for (const mod of modifiers) {
      const existing = modsByGroup.get(mod.modifierGroupId) || []
      existing.push(mod)
      modsByGroup.set(mod.modifierGroupId, existing)
    }

    const mgByItemId = new Map<string, typeof modifierGroups>()
    for (const mg of modifierGroups) {
      if (!mg.menuItemId) continue
      const existing = mgByItemId.get(mg.menuItemId) || []
      existing.push(mg)
      mgByItemId.set(mg.menuItemId, existing)
    }

    // Resolve delivery markup settings
    const markup = settings.thirdPartyDelivery?.deliveryMarkup
    const markupEnabled = markup?.enabled && (markup.defaultPercent > 0 || Object.values(markup.platformOverrides || {}).some(v => v != null && v > 0))
    const roundingRule = markup?.roundingRule ?? 'none'
    const markupModifiers = markup?.applyToModifiers ?? true

    // Build sync items per-platform (markup may differ per platform)
    function buildSyncItems(platformId: DeliveryPlatformId): MenuSyncItem[] {
      const effectiveMarkup = markupEnabled
        ? (markup!.platformOverrides?.[platformId as keyof typeof markup.platformOverrides] ?? markup!.defaultPercent)
        : 0

      return menuItems.map(item => {
        const priceInDollars = typeof item.price === 'string' ? parseFloat(item.price) : Number(item.price)
        const markedPrice = effectiveMarkup > 0 ? applyMarkup(priceInDollars, effectiveMarkup, roundingRule) : priceInDollars
        const priceCents = Math.round(markedPrice * 100)

        const itemModGroups = mgByItemId.get(item.id) || []
        const modifierGroupsSynced: MenuSyncModifierGroup[] = itemModGroups.map(mg => {
          const groupMods = modsByGroup.get(mg.id) || []
          return {
            externalId: mg.id,
            name: mg.name,
            minSelections: mg.minSelections,
            maxSelections: mg.maxSelections,
            options: groupMods.map(mod => {
              const modPrice = typeof mod.price === 'string' ? parseFloat(mod.price) : Number(mod.price)
              const markedModPrice = (effectiveMarkup > 0 && markupModifiers) ? applyMarkup(modPrice, effectiveMarkup, roundingRule) : modPrice
              return {
                externalId: mod.id,
                name: mod.name,
                price: Math.round(markedModPrice * 100),
                available: mod.isActive,
              }
            }),
          }
        })

        return {
          externalId: item.id,
          name: item.name,
          description: item.description || undefined,
          price: priceCents,
          categoryName: categoryMap.get(item.categoryId) || 'Uncategorized',
          categoryExternalId: item.categoryId,
          available: true,
          modifierGroups: modifierGroupsSynced.length > 0 ? modifierGroupsSynced : undefined,
        }
      })
    }

    // Sync to each platform
    const results: Record<string, MenuSyncResult> = {}
    for (const { platform: p, client } of clients) {
      try {
        const syncItems = buildSyncItems(p)
        results[p] = await client.syncMenu(syncItems)
      } catch (err) {
        results[p] = {
          platform: p,
          success: false,
          itemsSynced: 0,
          errors: [err instanceof Error ? err.message : String(err)],
        }
      }
    }

    // Build markup info for response
    const markupInfo = markupEnabled ? {
      enabled: true,
      defaultPercent: markup!.defaultPercent,
      roundingRule,
      applyToModifiers: markupModifiers,
      platformOverrides: markup!.platformOverrides,
      sample: (() => {
        const base = 12.00
        const pct = markup!.defaultPercent
        const marked = applyMarkup(base, pct, roundingRule)
        return { basePrice: base, markupPercent: pct, finalPrice: marked }
      })(),
    } : { enabled: false }

    return ok({
        itemCount: menuItems.length,
        results,
        markup: markupInfo,
      })
  } catch (error) {
    console.error('[POST /api/delivery/menu-sync] Error:', error)
    return err('Failed to sync menu', 500)
  }
})
