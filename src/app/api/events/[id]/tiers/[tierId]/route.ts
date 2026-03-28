import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

// GET - Get a single pricing tier
export const GET = withVenue(withAuth('ADMIN', async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tierId: string }> }
) {
  try {
    const { id, tierId } = await params

    const tier = await db.eventPricingTier.findFirst({
      where: {
        id: tierId,
        eventId: id,
        deletedAt: null,
      },
      include: {
        event: {
          select: { id: true, name: true, eventDate: true },
        },
        _count: {
          select: {
            tickets: true,
          },
        },
      },
    })

    if (!tier) {
      return notFound('Pricing tier not found')
    }

    // Get ticket breakdown by status
    const ticketStats = await db.ticket.groupBy({
      by: ['status'],
      where: { pricingTierId: tierId },
      _count: { id: true },
    })

    const ticketCounts = ticketStats.reduce((acc, stat) => {
      acc[stat.status] = stat._count.id
      return acc
    }, {} as Record<string, number>)

    return ok({
      tier: {
        id: tier.id,
        eventId: tier.eventId,
        eventName: tier.event.name,
        eventDate: tier.event.eventDate.toISOString().split('T')[0],
        name: tier.name,
        description: tier.description,
        color: tier.color,
        price: Number(tier.price),
        serviceFee: Number(tier.serviceFee),
        quantityAvailable: tier.quantityAvailable,
        quantitySold: tier.quantitySold,
        remaining: tier.quantityAvailable
          ? tier.quantityAvailable - tier.quantitySold
          : null,
        maxPerOrder: tier.maxPerOrder,
        sectionIds: tier.sectionIds,
        sortOrder: tier.sortOrder,
        isActive: tier.isActive,
        ticketCounts: {
          total: tier._count.tickets,
          held: ticketCounts['held'] || 0,
          sold: ticketCounts['sold'] || 0,
          checkedIn: ticketCounts['checked_in'] || 0,
          cancelled: ticketCounts['cancelled'] || 0,
          refunded: ticketCounts['refunded'] || 0,
        },
        createdAt: tier.createdAt.toISOString(),
        updatedAt: tier.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to fetch pricing tier:', error)
    return err('Failed to fetch pricing tier', 500)
  }
}))

// PUT - Update a pricing tier
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tierId: string }> }
) {
  try {
    const { id, tierId } = await params
    const body = await request.json()

    const tier = await db.eventPricingTier.findFirst({
      where: {
        id: tierId,
        eventId: id,
        deletedAt: null,
      },
      include: {
        event: {
          select: { id: true, status: true },
        },
        _count: {
          select: {
            tickets: {
              where: { status: { in: ['sold', 'checked_in'] } },
            },
          },
        },
      },
    })

    if (!tier) {
      return notFound('Pricing tier not found')
    }

    const hasSoldTickets = tier._count.tickets > 0

    // Restrict what can be changed if tickets have been sold
    const {
      name,
      description,
      color,
      price,
      serviceFee,
      quantityAvailable,
      maxPerOrder,
      sectionIds,
      sortOrder,
      isActive,
    } = body

    // If tickets sold, only allow certain updates
    if (hasSoldTickets) {
      if (price !== undefined && price !== Number(tier.price)) {
        return err('Cannot change price after tickets have been sold')
      }
      if (quantityAvailable !== undefined && quantityAvailable < tier.quantitySold) {
        return err(`Cannot reduce quantity below ${tier.quantitySold} (already sold)`)
      }
    }

    const updated = await db.eventPricingTier.update({
      where: { id: tierId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(price !== undefined && !hasSoldTickets ? { price } : {}),
        ...(serviceFee !== undefined ? { serviceFee } : {}),
        ...(quantityAvailable !== undefined ? { quantityAvailable } : {}),
        ...(maxPerOrder !== undefined ? { maxPerOrder } : {}),
        ...(sectionIds !== undefined ? { sectionIds } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    })

    void notifyDataChanged({ locationId: tier.locationId, domain: 'events', action: 'updated', entityId: tierId })
    void pushUpstream()

    return ok({
      success: true,
      tier: {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        color: updated.color,
        price: Number(updated.price),
        serviceFee: Number(updated.serviceFee),
        quantityAvailable: updated.quantityAvailable,
        quantitySold: updated.quantitySold,
        maxPerOrder: updated.maxPerOrder,
        sectionIds: updated.sectionIds,
        sortOrder: updated.sortOrder,
        isActive: updated.isActive,
      },
    })
  } catch (error) {
    console.error('Failed to update pricing tier:', error)
    return err('Failed to update pricing tier', 500)
  }
}))

// DELETE - Delete/deactivate a pricing tier
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tierId: string }> }
) {
  try {
    const { id, tierId } = await params
    const searchParams = request.nextUrl.searchParams
    const hardDelete = searchParams.get('hard') === 'true'

    const tier = await db.eventPricingTier.findFirst({
      where: {
        id: tierId,
        eventId: id,
        deletedAt: null,
      },
      include: {
        _count: {
          select: {
            tickets: {
              where: { status: { in: ['sold', 'checked_in'] } },
            },
          },
        },
      },
    })

    if (!tier) {
      return notFound('Pricing tier not found')
    }

    // Can't delete tier with sold tickets
    if (tier._count.tickets > 0) {
      return NextResponse.json(
        {
          error: 'Cannot delete tier with sold tickets. Deactivate it instead.',
          soldTickets: tier._count.tickets,
        },
        { status: 400 }
      )
    }

    if (hardDelete) {
      // Soft delete - remove tier and any unsold tickets
      const now = new Date()
      await db.$transaction([
        db.ticket.updateMany({
          where: { pricingTierId: tierId, status: { notIn: ['sold', 'checked_in'] } },
          data: { deletedAt: now },
        }),
        db.eventPricingTier.update({ where: { id: tierId }, data: { deletedAt: now } }),
      ])

      void notifyDataChanged({ locationId: tier.locationId, domain: 'events', action: 'deleted', entityId: tierId })
      void pushUpstream()

      return ok({
        success: true,
        message: 'Pricing tier permanently deleted',
      })
    } else {
      // Soft delete
      await db.eventPricingTier.update({
        where: { id: tierId },
        data: {
          isActive: false,
          deletedAt: new Date(),
        },
      })

      void notifyDataChanged({ locationId: tier.locationId, domain: 'events', action: 'deleted', entityId: tierId })
      void pushUpstream()

      return ok({
        success: true,
        message: 'Pricing tier deactivated',
      })
    }
  } catch (error) {
    console.error('Failed to delete pricing tier:', error)
    return err('Failed to delete pricing tier', 500)
  }
}))
