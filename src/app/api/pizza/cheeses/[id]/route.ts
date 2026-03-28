import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// PATCH /api/pizza/cheeses/[id] - Update pizza cheese
export const PATCH = withVenue(withAuth('ADMIN', async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const existing = await db.pizzaCheese.findUnique({ where: { id } })
    if (!existing || existing.locationId !== locationId) {
      return notFound('Cheese not found')
    }

    if (body.isDefault) {
      await db.pizzaCheese.updateMany({
        where: { locationId: existing.locationId, isDefault: true, id: { not: id } },
        data: { isDefault: false }
      })
    }

    const cheese = await db.pizzaCheese.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.displayName !== undefined && { displayName: body.displayName?.trim() || null }),
        ...(body.description !== undefined && { description: body.description?.trim() || null }),
        ...(body.price !== undefined && { price: body.price }),
        ...(body.allowLight !== undefined && { allowLight: body.allowLight }),
        ...(body.allowExtra !== undefined && { allowExtra: body.allowExtra }),
        ...(body.extraPrice !== undefined && { extraPrice: body.extraPrice }),
        ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
        ...(body.ingredientId !== undefined && { ingredientId: body.ingredientId || null }),
        ...(body.inventoryItemId !== undefined && { inventoryItemId: body.inventoryItemId || null }),
        ...(body.usageQuantity !== undefined && { usageQuantity: body.usageQuantity }),
        ...(body.usageUnit !== undefined && { usageUnit: body.usageUnit || null }),
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
    console.error('Failed to update pizza cheese:', error)
    return err('Failed to update pizza cheese', 500)
  }
}))

// DELETE /api/pizza/cheeses/[id] - Delete pizza cheese (soft delete)
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const existing = await db.pizzaCheese.findUnique({ where: { id } })
    if (!existing || existing.locationId !== locationId) {
      return notFound('Cheese not found')
    }

    await db.pizzaCheese.update({
      where: { id },
      data: { isActive: false, lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local' }
    })
    pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('Failed to delete pizza cheese:', error)
    return err('Failed to delete pizza cheese', 500)
  }
}))
