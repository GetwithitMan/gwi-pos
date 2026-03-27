/**
 * GET /api/cake-orders/production/ingredients
 *
 * Aggregates ingredient requirements across all cake orders in a date range.
 * For each order, parses cakeConfig JSONB, traverses tier modifiers, and looks
 * up Modifier.metadata.requiredIngredients to aggregate quantities by inventoryItemId.
 * JOINs with InventoryItem for name, currentStock, and unit.
 *
 * Permission: cake.view
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { requireCakeFeature } from '@/lib/cake-orders/require-cake-feature'

// ── Types ────────────────────────────────────────────────────────────────────

interface RequiredIngredient {
  inventoryItemId: string
  quantity: number
}

interface ModifierMetadata {
  requiredIngredients?: RequiredIngredient[]
  [key: string]: unknown
}

interface CakeModifierSelection {
  modifierId: string
  modifierName: string
  modifierGroupId: string
  modifierGroupName: string
  price: number
}

interface CakeTierConfig {
  index: number
  menuItemId: string
  menuItemName: string
  menuItemPrice: number
  modifiers: CakeModifierSelection[]
}

interface CakeConfigV1 {
  schemaVersion: number
  buildMode: string
  tiers: CakeTierConfig[]
}

interface IngredientResult {
  inventoryItemId: string
  name: string
  requiredQuantity: number
  currentStock: number
  unit: string
  status: 'ok' | 'low' | 'out'
}

// ── Route Handler ────────────────────────────────────────────────────────────

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }
    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'dateFrom and dateTo are required' }, { status: 400 })
    }

    // ── Permission check ──────────────────────────────────────────────
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || searchParams.get('employeeId')

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.CAKE_VIEW)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    // ── Feature gate ────────────────────────────────────────────────────
    const gate = await requireCakeFeature(locationId)
    if (gate) return gate

    // ── Step 1: Fetch orders with cakeConfig in date range ────────────
    const orders = await db.$queryRawUnsafe<Array<{ id: string; cakeConfig: unknown }>>(
      `SELECT "id", "cakeConfig"
       FROM "CakeOrder"
       WHERE "locationId" = $1
         AND "eventDate" >= $2::date
         AND "eventDate" <= $3::date
         AND "status" IN ('deposit_paid', 'in_production')
         AND "deletedAt" IS NULL`,
      locationId,
      dateFrom,
      dateTo,
    )

    if (orders.length === 0) {
      return NextResponse.json({ data: { ingredients: [] } })
    }

    // ── Step 2: Collect all unique modifier IDs from cakeConfigs ──────
    const modifierIds = new Set<string>()

    for (const order of orders) {
      const config = order.cakeConfig as CakeConfigV1 | null
      if (!config?.tiers) continue
      for (const tier of config.tiers) {
        if (!tier.modifiers) continue
        for (const mod of tier.modifiers) {
          if (mod.modifierId) modifierIds.add(mod.modifierId)
        }
      }
    }

    if (modifierIds.size === 0) {
      return NextResponse.json({ data: { ingredients: [] } })
    }

    // ── Step 3: Fetch modifier metadata for required ingredients ──────
    const idArray = Array.from(modifierIds)
    const placeholders = idArray.map((_, i) => `$${i + 1}`).join(', ')

    const modifiers = await db.$queryRawUnsafe<Array<{ id: string; metadata: unknown }>>(
      `SELECT "id", "metadata"
       FROM "Modifier"
       WHERE "id" IN (${placeholders})
         AND "metadata" IS NOT NULL`,
      ...idArray,
    )

    // Build lookup: modifierId -> requiredIngredients[]
    const modIngredientMap = new Map<string, RequiredIngredient[]>()
    for (const mod of modifiers) {
      const meta = mod.metadata as ModifierMetadata | null
      if (meta?.requiredIngredients && Array.isArray(meta.requiredIngredients)) {
        modIngredientMap.set(mod.id, meta.requiredIngredients)
      }
    }

    if (modIngredientMap.size === 0) {
      return NextResponse.json({ data: { ingredients: [] } })
    }

    // ── Step 4: Aggregate quantities per inventoryItemId ──────────────
    const aggregated = new Map<string, number>()

    for (const order of orders) {
      const config = order.cakeConfig as CakeConfigV1 | null
      if (!config?.tiers) continue
      for (const tier of config.tiers) {
        if (!tier.modifiers) continue
        for (const mod of tier.modifiers) {
          const ingredients = modIngredientMap.get(mod.modifierId)
          if (!ingredients) continue
          for (const ing of ingredients) {
            if (!ing.inventoryItemId || typeof ing.quantity !== 'number') continue
            const prev = aggregated.get(ing.inventoryItemId) || 0
            aggregated.set(ing.inventoryItemId, prev + ing.quantity)
          }
        }
      }
    }

    if (aggregated.size === 0) {
      return NextResponse.json({ data: { ingredients: [] } })
    }

    // ── Step 5: JOIN with InventoryItem for name, stock, unit ─────────
    const invIds = Array.from(aggregated.keys())
    const invPlaceholders = invIds.map((_, i) => `$${i + 1}`).join(', ')

    const inventoryItems = await db.$queryRawUnsafe<
      Array<{ id: string; name: string; currentStock: string | number; storageUnit: string }>
    >(
      `SELECT "id", "name", "currentStock", "storageUnit"
       FROM "InventoryItem"
       WHERE "id" IN (${invPlaceholders})`,
      ...invIds,
    )

    // Build lookup
    const invMap = new Map<string, { name: string; currentStock: number; unit: string }>()
    for (const item of inventoryItems) {
      invMap.set(item.id, {
        name: item.name,
        currentStock: Number(item.currentStock),
        unit: item.storageUnit,
      })
    }

    // ── Step 6: Build response ────────────────────────────────────────
    const ingredients: IngredientResult[] = []

    for (const [inventoryItemId, requiredQuantity] of aggregated) {
      const inv = invMap.get(inventoryItemId)
      const currentStock = inv?.currentStock ?? 0
      const name = inv?.name ?? 'Unknown Item'
      const unit = inv?.unit ?? 'unit'

      let status: 'ok' | 'low' | 'out' = 'ok'
      if (currentStock <= 0) {
        status = 'out'
      } else if (currentStock < requiredQuantity) {
        status = 'low'
      }

      ingredients.push({
        inventoryItemId,
        name,
        requiredQuantity: Math.round(requiredQuantity * 1000) / 1000,
        currentStock: Math.round(currentStock * 1000) / 1000,
        unit,
        status,
      })
    }

    // Sort: out first, then low, then ok; alphabetical within each
    ingredients.sort((a, b) => {
      const priority: Record<string, number> = { out: 0, low: 1, ok: 2 }
      const pa = priority[a.status] ?? 2
      const pb = priority[b.status] ?? 2
      if (pa !== pb) return pa - pb
      return a.name.localeCompare(b.name)
    })

    return NextResponse.json({ data: { ingredients } })
  } catch (error) {
    console.error('[cake-production-ingredients] Failed:', error)
    return NextResponse.json(
      { error: 'Failed to aggregate production ingredients' },
      { status: 500 },
    )
  }
})
