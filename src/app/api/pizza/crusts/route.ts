import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, ok } from '@/lib/api-response'

// GET /api/pizza/crusts - Get all pizza crusts
export const GET = withVenue(async function GET() {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const crusts = await db.pizzaCrust.findMany({
      where: { locationId, isActive: true },
      orderBy: { sortOrder: 'asc' }
    })

    return ok(crusts.map(crust => ({
      ...crust,
      price: Number(crust.price),
    })))
  } catch (error) {
    console.error('Failed to get pizza crusts:', error)
    return err('Failed to get pizza crusts', 500)
  }
})

// POST /api/pizza/crusts - Create pizza crust
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, displayName, description, price, isDefault, ingredientId, inventoryItemId, usageQuantity, usageUnit } = body

    if (!name?.trim()) {
      return err('Name is required')
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const maxSort = await db.pizzaCrust.aggregate({
      where: { locationId },
      _max: { sortOrder: true }
    })

    if (isDefault) {
      await db.pizzaCrust.updateMany({
        where: { locationId, isDefault: true },
        data: { isDefault: false }
      })
    }

    const crust = await db.pizzaCrust.create({
      data: {
        locationId,
        name: name.trim(),
        displayName: displayName?.trim() || null,
        description: description?.trim() || null,
        price: price || 0,
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
      ...crust,
      price: Number(crust.price),
    })
  } catch (error) {
    console.error('Failed to create pizza crust:', error)
    return err('Failed to create pizza crust', 500)
  }
}))
