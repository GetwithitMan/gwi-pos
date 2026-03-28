import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, ok } from '@/lib/api-response'

// GET /api/pizza/sizes - Get all pizza sizes
export const GET = withVenue(async function GET() {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const sizes = await db.pizzaSize.findMany({
      where: { locationId, isActive: true },
      orderBy: { sortOrder: 'asc' }
    })

    return ok(sizes.map(size => ({
      ...size,
      basePrice: Number(size.basePrice),
      priceMultiplier: Number(size.priceMultiplier),
      toppingMultiplier: Number(size.toppingMultiplier),
      inventoryMultiplier: Number(size.inventoryMultiplier),
    })))
  } catch (error) {
    console.error('Failed to get pizza sizes:', error)
    return err('Failed to get pizza sizes', 500)
  }
})

// POST /api/pizza/sizes - Create pizza size
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, displayName, inches, slices, basePrice, priceMultiplier, toppingMultiplier, freeToppings, isDefault, inventoryMultiplier, ingredientId, inventoryItemId, usageQuantity, usageUnit } = body

    if (!name?.trim()) {
      return err('Name is required')
    }
    if (basePrice === undefined || basePrice < 0) {
      return err('Valid base price is required')
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Get max sort order
    const maxSort = await db.pizzaSize.aggregate({
      where: { locationId },
      _max: { sortOrder: true }
    })

    // If this is default, unset other defaults
    if (isDefault) {
      await db.pizzaSize.updateMany({
        where: { locationId, isDefault: true },
        data: { isDefault: false }
      })
    }

    const size = await db.pizzaSize.create({
      data: {
        locationId,
        name: name.trim(),
        displayName: displayName?.trim() || null,
        inches: inches || null,
        slices: slices || 8,
        basePrice,
        priceMultiplier: priceMultiplier || 1.0,
        toppingMultiplier: toppingMultiplier || 1.0,
        inventoryMultiplier: inventoryMultiplier || 1.0,
        ingredientId: ingredientId || null,
        inventoryItemId: inventoryItemId || null,
        usageQuantity: usageQuantity ?? null,
        usageUnit: usageUnit || null,
        freeToppings: freeToppings || 0,
        isDefault: isDefault || false,
        sortOrder: (maxSort._max.sortOrder || 0) + 1,
        lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
      }
    })
    pushUpstream()

    return ok({
      ...size,
      basePrice: Number(size.basePrice),
      priceMultiplier: Number(size.priceMultiplier),
      toppingMultiplier: Number(size.toppingMultiplier),
      inventoryMultiplier: Number(size.inventoryMultiplier),
      usageQuantity: size.usageQuantity ? Number(size.usageQuantity) : null,
    })
  } catch (error) {
    console.error('Failed to create pizza size:', error)
    return err('Failed to create pizza size', 500)
  }
}))
