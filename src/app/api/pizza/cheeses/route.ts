import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, ok } from '@/lib/api-response'

// GET /api/pizza/cheeses - Get all pizza cheeses
export const GET = withVenue(async function GET() {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const cheeses = await db.pizzaCheese.findMany({
      where: { locationId, isActive: true },
      orderBy: { sortOrder: 'asc' }
    })

    return ok(cheeses.map(cheese => ({
      ...cheese,
      price: Number(cheese.price),
      extraPrice: Number(cheese.extraPrice),
    })))
  } catch (error) {
    console.error('Failed to get pizza cheeses:', error)
    return err('Failed to get pizza cheeses', 500)
  }
})

// POST /api/pizza/cheeses - Create pizza cheese
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, displayName, description, price, allowLight, allowExtra, extraPrice, isDefault, ingredientId, inventoryItemId, usageQuantity, usageUnit } = body

    if (!name?.trim()) {
      return err('Name is required')
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const maxSort = await db.pizzaCheese.aggregate({
      where: { locationId },
      _max: { sortOrder: true }
    })

    if (isDefault) {
      await db.pizzaCheese.updateMany({
        where: { locationId, isDefault: true },
        data: { isDefault: false }
      })
    }

    const cheese = await db.pizzaCheese.create({
      data: {
        locationId,
        name: name.trim(),
        displayName: displayName?.trim() || null,
        description: description?.trim() || null,
        price: price || 0,
        allowLight: allowLight ?? true,
        allowExtra: allowExtra ?? true,
        extraPrice: extraPrice || 0,
        isDefault: isDefault || false,
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
      ...cheese,
      price: Number(cheese.price),
      extraPrice: Number(cheese.extraPrice),
    })
  } catch (error) {
    console.error('Failed to create pizza cheese:', error)
    return err('Failed to create pizza cheese', 500)
  }
}))
