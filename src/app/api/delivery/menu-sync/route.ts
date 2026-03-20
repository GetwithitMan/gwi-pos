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

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { getPlatformClient, getActivePlatformClients } from '@/lib/delivery/clients/platform-registry'
import type { DeliveryPlatformId, MenuSyncItem, MenuSyncModifierGroup, MenuSyncResult } from '@/lib/delivery/clients/types'

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, employeeId, platform } = body as {
      locationId: string
      employeeId: string
      platform?: DeliveryPlatformId
    }

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_EDIT)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Load settings
    const settings = parseSettings(await getLocationSettings(locationId))

    // Determine which platform clients to sync to
    const clients: Array<{ platform: DeliveryPlatformId; client: NonNullable<ReturnType<typeof getPlatformClient>> }> = []

    if (platform) {
      const client = getPlatformClient(platform, settings)
      if (!client) {
        return NextResponse.json(
          { error: `Platform "${platform}" is not enabled or credentials are missing` },
          { status: 400 },
        )
      }
      clients.push({ platform, client })
    } else {
      const activeClients = getActivePlatformClients(settings)
      if (!activeClients.length) {
        return NextResponse.json(
          { error: 'No delivery platforms are enabled' },
          { status: 400 },
        )
      }
      clients.push(...activeClients)
    }

    // Load categories
    const categories = await db.$queryRawUnsafe<Array<{ id: string; name: string }>>(
      `SELECT id, name FROM "Category"
       WHERE "locationId" = $1 AND "deletedAt" IS NULL`,
      locationId,
    )
    const categoryMap = new Map(categories.map(c => [c.id, c.name]))

    // Load active menu items
    const menuItems = await db.$queryRawUnsafe<Array<{
      id: string
      name: string
      description: string | null
      price: number | string
      categoryId: string
    }>>(
      `SELECT id, name, description, price, "categoryId"
       FROM "MenuItem"
       WHERE "locationId" = $1 AND "deletedAt" IS NULL AND "isActive" = true`,
      locationId,
    )

    // Load modifier groups + modifiers for all items in one query
    const modifierGroups = await db.$queryRawUnsafe<Array<{
      id: string
      name: string
      menuItemId: string | null
      minSelections: number
      maxSelections: number
    }>>(
      `SELECT mg.id, mg.name, mg."menuItemId", mg."minSelections", mg."maxSelections"
       FROM "ModifierGroup" mg
       WHERE mg."locationId" = $1 AND mg."deletedAt" IS NULL`,
      locationId,
    )

    const modifiers = await db.$queryRawUnsafe<Array<{
      id: string
      name: string
      price: number | string
      modifierGroupId: string
      isActive: boolean
    }>>(
      `SELECT m.id, m.name, m.price, m."modifierGroupId", m."isActive"
       FROM "Modifier" m
       JOIN "ModifierGroup" mg ON mg.id = m."modifierGroupId"
       WHERE mg."locationId" = $1 AND m."deletedAt" IS NULL`,
      locationId,
    )

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

    // Convert to MenuSyncItem[] (prices in cents — multiply dollars by 100)
    const syncItems: MenuSyncItem[] = menuItems.map(item => {
      const priceInDollars = typeof item.price === 'string' ? parseFloat(item.price) : Number(item.price)
      const priceCents = Math.round(priceInDollars * 100)

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
            return {
              externalId: mod.id,
              name: mod.name,
              price: Math.round(modPrice * 100),
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

    // Sync to each platform
    const results: Record<string, MenuSyncResult> = {}
    for (const { platform: p, client } of clients) {
      try {
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

    return NextResponse.json({
      data: {
        itemCount: syncItems.length,
        results,
      },
    })
  } catch (error) {
    console.error('[POST /api/delivery/menu-sync] Error:', error)
    return NextResponse.json({ error: 'Failed to sync menu' }, { status: 500 })
  }
})
