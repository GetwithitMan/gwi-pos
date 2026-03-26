import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'
import { getLocationId } from '@/lib/location-cache'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

// GET - List reservation blocks
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
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

    return NextResponse.json({ data: blocks })
  } catch (error) {
    console.error('[reservations/blocks] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch blocks' }, { status: 500 })
  }
})

// POST - Create a reservation block
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, name, reason, blockDate, startTime, endTime, isAllDay, reducedCapacityPercent, blockedTableIds, blockedSectionIds } = body

    if (!locationId || !name || !blockDate) {
      return NextResponse.json({ error: 'locationId, name, and blockDate are required' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, 'floorplan.edit')
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'Permission denied' }, { status: 403 })
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
    return NextResponse.json({ error: 'Failed to create block' }, { status: 500 })
  }
})

// PUT - Update a reservation block
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, locationId, name, reason, blockDate, startTime, endTime, isAllDay, reducedCapacityPercent, blockedTableIds, blockedSectionIds } = body

    if (!id || !locationId) {
      return NextResponse.json({ error: 'id and locationId are required' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, 'floorplan.edit')
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'Permission denied' }, { status: 403 })
    }

    // Verify block belongs to the provided locationId
    const existingBlock = await db.reservationBlock.findFirst({
      where: { id, locationId },
      select: { id: true },
    })
    if (!existingBlock) {
      return NextResponse.json({ error: 'Block not found' }, { status: 404 })
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
      },
    })

    void notifyDataChanged({ locationId, domain: 'reservations', action: 'updated', entityId: id })
    void pushUpstream()

    return NextResponse.json({ data: block })
  } catch (error) {
    console.error('[reservations/blocks] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update block' }, { status: 500 })
  }
})

// DELETE - Soft delete a reservation block
export const DELETE = withVenue(async function DELETE(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const id = sp.get('id')
    const locationId = sp.get('locationId')

    if (!id || !locationId) {
      return NextResponse.json({ error: 'id and locationId are required' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, 'floorplan.edit')
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'Permission denied' }, { status: 403 })
    }

    // Verify block belongs to the provided locationId
    const existingBlock = await db.reservationBlock.findFirst({
      where: { id, locationId },
      select: { id: true },
    })
    if (!existingBlock) {
      return NextResponse.json({ error: 'Block not found' }, { status: 404 })
    }

    await db.reservationBlock.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    void notifyDataChanged({ locationId, domain: 'reservations', action: 'deleted', entityId: id })
    void pushUpstream()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[reservations/blocks] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete block' }, { status: 500 })
  }
})
