import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { withAuth } from '@/lib/api-auth-middleware'
import { emitToLocation } from '@/lib/socket-server'
import { err, notFound, ok } from '@/lib/api-response'

// GET - Get a single bottle service tier
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const { id } = await params

    const tier = await db.bottleServiceTier.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!tier) {
      return notFound('Tier not found')
    }

    return ok({
        id: tier.id,
        name: tier.name,
        description: tier.description,
        color: tier.color,
        depositAmount: Number(tier.depositAmount),
        minimumSpend: Number(tier.minimumSpend),
        autoGratuityPercent: tier.autoGratuityPercent ? Number(tier.autoGratuityPercent) : null,
        sortOrder: tier.sortOrder,
        isActive: tier.isActive,
      })
  } catch (error) {
    console.error('Failed to get bottle service tier:', error)
    return err('Failed to get bottle service tier', 500)
  }
})

// PUT - Update a bottle service tier
export const PUT = withVenue(withAuth('SETTINGS_EDIT', async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const { id } = await params
    const body = await request.json()
    const { name, description, color, depositAmount, minimumSpend, autoGratuityPercent, sortOrder, isActive } = body

    const existing = await db.bottleServiceTier.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!existing) {
      return notFound('Tier not found')
    }

    // Check active orders before deactivation
    if (isActive === false && existing.isActive) {
      const activeOrders = await db.order.count({
        where: {
          locationId,
          bottleServiceTierId: id,
          status: { in: ['open', 'in_progress', 'sent'] },
        },
      })
      if (activeOrders > 0) {
        return err(`Cannot deactivate tier with ${activeOrders} active order(s)`)
      }
    }

    const tier = await db.bottleServiceTier.update({
      where: { id, locationId },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(color !== undefined && { color }),
        ...(depositAmount !== undefined && { depositAmount }),
        ...(minimumSpend !== undefined && { minimumSpend }),
        ...(autoGratuityPercent !== undefined && { autoGratuityPercent }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isActive !== undefined && { isActive }),
        lastMutatedBy: 'cloud',
      },
    })

    void emitToLocation(locationId, 'settings:updated', { source: 'bottle-service-tier', action: 'updated', tierId: id }).catch(console.error)

    return ok({
        id: tier.id,
        name: tier.name,
        description: tier.description,
        color: tier.color,
        depositAmount: Number(tier.depositAmount),
        minimumSpend: Number(tier.minimumSpend),
        autoGratuityPercent: tier.autoGratuityPercent ? Number(tier.autoGratuityPercent) : null,
        sortOrder: tier.sortOrder,
        isActive: tier.isActive,
      })
  } catch (error) {
    console.error('Failed to update bottle service tier:', error)
    return err('Failed to update bottle service tier', 500)
  }
}))

// DELETE - Soft delete a bottle service tier
export const DELETE = withVenue(withAuth('SETTINGS_EDIT', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const { id } = await params

    const existing = await db.bottleServiceTier.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!existing) {
      return notFound('Tier not found')
    }

    // Check active orders before deletion
    const activeOrders = await db.order.count({
      where: {
        locationId,
        bottleServiceTierId: id,
        status: { in: ['open', 'in_progress', 'sent'] },
      },
    })
    if (activeOrders > 0) {
      return err(`Cannot delete tier with ${activeOrders} active order(s)`)
    }

    await db.bottleServiceTier.update({
      where: { id },
      data: { deletedAt: new Date(), lastMutatedBy: 'cloud' },
    })

    void emitToLocation(locationId, 'settings:updated', { source: 'bottle-service-tier', action: 'deleted', tierId: id }).catch(console.error)

    return ok({ success: true })
  } catch (error) {
    console.error('Failed to delete bottle service tier:', error)
    return err('Failed to delete bottle service tier', 500)
  }
}))
