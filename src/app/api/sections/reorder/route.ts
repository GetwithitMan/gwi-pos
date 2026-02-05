import { db } from '@/lib/db'
import { NextResponse } from 'next/server'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'

// PUT - Reorder sections by updating sortOrder
export async function PUT(req: Request) {
  try {
    const body = await req.json()
    const { locationId, roomIds } = body

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    if (!roomIds || !Array.isArray(roomIds)) {
      return NextResponse.json({ error: 'roomIds array required' }, { status: 400 })
    }

    // Verify all sections belong to this location before updating
    const sections = await db.section.findMany({
      where: {
        id: { in: roomIds },
        locationId,
        deletedAt: null,
      },
      select: { id: true },
    })

    if (sections.length !== roomIds.length) {
      return NextResponse.json({ error: 'One or more sections not found or access denied' }, { status: 404 })
    }

    // Update sortOrder for each section in order
    await db.$transaction(
      roomIds.map((id: string, index: number) =>
        db.section.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    )

    dispatchFloorPlanUpdate(locationId, { async: true })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[sections/reorder] PUT error:', error)
    return NextResponse.json({ error: 'Failed to reorder sections' }, { status: 500 })
  }
}
