import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, ok } from '@/lib/api-response'

// GET /api/pizza/toppings - Get all pizza toppings
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')
    const includeInactive = searchParams.get('includeInactive') === 'true'

    const toppings = await db.pizzaTopping.findMany({
      where: {
        locationId,
        ...(category && { category }),
        ...(!includeInactive && { isActive: true }),
      },
      include: {
        ingredient: { select: { id: true, name: true } },
        inventoryItem: { select: { id: true, name: true } },
      },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }]
    })

    return ok(toppings.map(topping => ({
      ...topping,
      price: Number(topping.price),
      extraPrice: topping.extraPrice ? Number(topping.extraPrice) : null,
      inventoryItemName: topping.inventoryItem?.name || topping.ingredient?.name || null,
      ingredient: undefined,
      inventoryItem: undefined,
    })))
  } catch (error) {
    console.error('Failed to get pizza toppings:', error)
    return err('Failed to get pizza toppings', 500)
  }
})

// POST /api/pizza/toppings - Create pizza topping
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, displayName, description, category, price, extraPrice, color, iconUrl, ingredientId, inventoryItemId, usageQuantity, usageUnit } = body

    if (!name?.trim()) {
      return err('Name is required')
    }
    if (price === undefined || price < 0) {
      return err('Valid price is required')
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const maxSort = await db.pizzaTopping.aggregate({
      where: { locationId, category: category || 'standard' },
      _max: { sortOrder: true }
    })

    const topping = await db.pizzaTopping.create({
      data: {
        locationId,
        name: name.trim(),
        displayName: displayName?.trim() || null,
        description: description?.trim() || null,
        category: category || 'standard',
        price,
        extraPrice: extraPrice || null,
        color: color || null,
        iconUrl: iconUrl || null,
        ingredientId: ingredientId || null,
        inventoryItemId: inventoryItemId || null,
        usageQuantity: usageQuantity ?? null,
        usageUnit: usageUnit || null,
        sortOrder: (maxSort._max.sortOrder || 0) + 1,
        lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
      }
    })
    pushUpstream()

    return ok({
      ...topping,
      price: Number(topping.price),
      extraPrice: topping.extraPrice ? Number(topping.extraPrice) : null,
    })
  } catch (error) {
    console.error('Failed to create pizza topping:', error)
    return err('Failed to create pizza topping', 500)
  }
}))
