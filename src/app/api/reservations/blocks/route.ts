import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'
import { getLocationId } from '@/lib/location-cache'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, forbidden, notFound, ok } from '@/lib/api-response'

// GET - List reservation blocks
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }
    const sp = request.nextUrl.searchParams

    const date = sp.get('date')
    const where: Record<string, unknown> = { locationId, deletedAt: null }

    if (date) {
      where.blockDate = new Date(date + 'T00:00:00Z')
    }

    const blocks = await db.reservationBlock.findMany({
      where,
      orderBy: [{ blockDate: 'asc' }, { startTime: 'asc' }],
    })

    return ok(blocks)
  } catch (error) {
    console.error('[reservations/blocks] GET error:', error)
    return err('Failed to fetch blocks', 500)
  }
})

// POST - Create a reservation block
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, name, reason, blockDate, startTime, endTime, isAllDay, reducedCapacityPercent, blockedTableIds, blockedSectionIds } = body

    if (!locationId || !name || !blockDate) {
      return err('locationId, name, and blockDate are required')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, 'floorplan.edit')
    if (!auth.authorized) {
      return forbidden(auth.error || 'Permission denied')
    }

    // Warn about conflicts (don't auto-cancel)
    const conflicting = await db.reservation.findMany({
      where: {
        locationId,
        reservationDate: new Date(blockDate + 'T00:00:00Z'),
        status: { in: ['confirmed', 'pending'] },
        deletedAt: null,
      },
      select: { id: true, guestName: true, reservationTime: true, partySize: true },
      take: 10,
    })

    const block = await db.reservationBlock.create({
      data: {
        locationId,
        name,
        reason: reason || null,
        blockDate: new Date(blockDate + 'T00:00:00Z'),
        startTime: isAllDay ? null : (startTime || null),
        endTime: isAllDay ? null : (endTime || null),
        isAllDay: isAllDay ?? false,
        reducedCapacityPercent: reducedCapacityPercent ?? null,
        blockedTableIds: blockedTableIds || [],
        blockedSectionIds: blockedSectionIds || [],
        createdBy: actor.employeeId,
        lastMutatedBy: 'cloud',
      },
    })

    void notifyDataChanged({ locationId, domain: 'reservations', action: 'created', entityId: block.id })
    void pushUpstream()

    return NextResponse.json({
      data: block,
      warnings: conflicting.length > 0
        ? [`${conflicting.length} existing reservation(s) conflict with this block`]
        : [],
      conflictingReservations: conflicting,
    })
  } catch (error) {
    console.error('[reservations/blocks] POST error:', error)
    return err('Failed to create block', 500)
  }
})

// PUT - Update a reservation block
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, locationId, name, reason, blockDate, startTime, endTime, isAllDay, reducedCapacityPercent, blockedTableIds, blockedSectionIds } = body

    if (!id || !locationId) {
      return err('id and locationId are required')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, 'floorplan.edit')
    if (!auth.authorized) {
      return forbidden(auth.error || 'Permission denied')
    }

    // Verify block belongs to the provided locationId
    const existingBlock = await db.reservationBlock.findFirst({
      where: { id, locationId },
      select: { id: true },
    })
    if (!existingBlock) {
      return notFound('Block not found')
    }

    const block = await db.reservationBlock.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(reason !== undefined ? { reason } : {}),
        ...(blockDate !== undefined ? { blockDate: new Date(blockDate + 'T00:00:00Z') } : {}),
        ...(startTime !== undefined ? { startTime: isAllDay ? null : startTime } : {}),
        ...(endTime !== undefined ? { endTime: isAllDay ? null : endTime } : {}),
        ...(isAllDay !== undefined ? { isAllDay } : {}),
        ...(reducedCapacityPercent !== undefined ? { reducedCapacityPercent } : {}),
        ...(blockedTableIds !== undefined ? { blockedTableIds } : {}),
        ...(blockedSectionIds !== undefined ? { blockedSectionIds } : {}),
        lastMutatedBy: 'cloud',
      },
    })

    void notifyDataChanged({ locationId, domain: 'reservations', action: 'updated', entityId: id })
    void pushUpstream()

    return ok(block)
  } catch (error) {
    console.error('[reservations/blocks] PUT error:', error)
    return err('Failed to update block', 500)
  }
})

// DELETE - Soft delete a reservation block
export const DELETE = withVenue(async function DELETE(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const id = sp.get('id')
    const locationId = sp.get('locationId')

    if (!id || !locationId) {
      return err('id and locationId are required')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, 'floorplan.edit')
    if (!auth.authorized) {
      return forbidden(auth.error || 'Permission denied')
    }

    // Verify block belongs to the provided locationId
    const existingBlock = await db.reservationBlock.findFirst({
      where: { id, locationId },
      select: { id: true },
    })
    if (!existingBlock) {
      return notFound('Block not found')
    }

    await db.reservationBlock.update({
      where: { id },
      data: { deletedAt: new Date(), lastMutatedBy: 'cloud' },
    })

    void notifyDataChanged({ locationId, domain: 'reservations', action: 'deleted', entityId: id })
    void pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('[reservations/blocks] DELETE error:', error)
    return err('Failed to delete block', 500)
  }
})
